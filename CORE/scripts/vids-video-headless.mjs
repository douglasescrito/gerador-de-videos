#!/usr/bin/env node
import { studioLocalPath } from '../lib/studio-local-config.mjs';

/**
 * Adapter cookie-only de geração de vídeo pelo Google Vids.
 *
 * Caminho secundário ao `gemini-omni`: o Vids expõe o mesmo modelo Omni por um
 * upstream próprio (`appsgenaiserver-pa.clients6.google.com/v1/genai/generate`),
 * que permanece de pé quando o app empacotado do AI Studio devolve 404.
 *
 * A resposta de `/v1/genai/generate` é síncrona e já carrega a URL assinada do
 * MP4 pronto, num bucket temporário. Por isso o adapter intercepta a resposta e
 * baixa os bytes na mesma sessão: não existe reconciliação posterior.
 *
 * Doutrina herdada do adapter de narração: submete uma vez só e nunca repete
 * automaticamente um estado ambíguo.
 */

import path from "node:path";
import { assertPathAvailable, writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  cleanupHeadlessResources,
  dismissOverlays,
  openStudioPage,
  sanitizeSensitiveText,
  sanitizedUrl,
} from "./ai-studio-headless.mjs";
import { commitNewFileAtomically, validateMp4Download } from "./omni-product-studio-submit.mjs";

export const VIDS_VIDEO_ATTEMPT_SCHEMA = "google-vids-video-attempt@1";
export const VIDS_VIDEO_MODEL = "google-vids-omni-720p";
export const VIDS_CREATE_URL = "https://docs.google.com/videos/create";
export const VIDS_DOCUMENT_PREFIX = "https://docs.google.com/videos/d/";
export const VIDS_GENERATE_ENDPOINT = "/v1/genai/generate";
export const VIDS_QUOTA_ENDPOINT = "/v1/genai/quotaSummary";
export const VIDS_CLIP_SECONDS = 10;
export const VIDS_ASPECT_LABELS = Object.freeze({ "16:9": "Paisagem", "9:16": "Retrato" });

const DEFAULT_CHROME = studioLocalPath('chromePath') ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MEDIA_FILENAME_MARKER = "filename=video.mp4";
const DOUBLE_QUOTE = String.fromCharCode(34);

/** Proporções que o seletor do Vids oferece hoje. */
export function resolveVidsAspect(aspect = "16:9") {
  const normalized = String(aspect ?? "16:9").trim();
  const label = VIDS_ASPECT_LABELS[normalized];
  if (!label) {
    throw new Error(`O Google Vids só aceita ${Object.keys(VIDS_ASPECT_LABELS).join(" ou ")}; recebido: ${normalized || "(vazio)"}.`);
  }
  return { aspect: normalized, label, option: `${label} ${normalized}` };
}

function mediaNodeFrom(node) {
  if (!Array.isArray(node)) return null;
  for (let index = 0; index < node.length; index += 1) {
    const value = node[index];
    if (typeof value !== "string" || !value.includes(MEDIA_FILENAME_MARKER)) continue;
    const width = Number(node[index + 1]);
    const height = Number(node[index + 2]);
    const rawDuration = Array.isArray(node[index + 3]) ? node[index + 3][0] : null;
    const durationSeconds = Number(rawDuration);
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    return {
      mediaUrl: value,
      width,
      height,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    };
  }
  return null;
}

function walkForMedia(node) {
  const direct = mediaNodeFrom(node);
  if (direct) return direct;
  if (!Array.isArray(node)) return null;
  for (const child of node) {
    const found = walkForMedia(child);
    if (found) return found;
  }
  return null;
}

function scanForMedia(text) {
  const marker = text.indexOf(MEDIA_FILENAME_MARKER);
  if (marker < 0) return null;
  const start = text.lastIndexOf("https://", marker);
  if (start < 0) return null;
  const stop = text.indexOf(DOUBLE_QUOTE, marker);
  const mediaUrl = text.slice(start, stop === -1 ? undefined : stop);
  const tail = text.slice(stop === -1 ? marker : stop);
  const dimensions = tail.match(/^",(\d{2,5}),(\d{2,5}),\["(\d+(?:\.\d+)?)"\]/);
  return {
    mediaUrl,
    width: dimensions ? Number(dimensions[1]) : null,
    height: dimensions ? Number(dimensions[2]) : null,
    durationSeconds: dimensions ? Number(dimensions[3]) : null,
  };
}

function stripAntiHijackPrefix(text) {
  const value = String(text ?? "");
  if (!value.startsWith(")]}'")) return value;
  const newline = value.indexOf("\n");
  return newline === -1 ? "" : value.slice(newline + 1);
}

/**
 * Extrai a URL temporária do MP4 e as dimensões da resposta de
 * `/v1/genai/generate`. A resposta é JSPB posicional; a leitura estruturada é a
 * preferida e a varredura textual existe só como rede de segurança.
 */
export function parseVidsGenerateResponse(rawText) {
  const text = stripAntiHijackPrefix(rawText);
  if (!text.includes(MEDIA_FILENAME_MARKER)) return null;
  try {
    const structured = walkForMedia(JSON.parse(text));
    if (structured) return structured;
  } catch {
    // Resposta não é JSON puro; cai na varredura textual abaixo.
  }
  return scanForMedia(text);
}

/**
 * Lê o balde de cota do Vids: `[[null,[limite,null,restante,...],usadas,...]]`.
 */
export function parseVidsQuotaSummary(rawText) {
  const text = stripAntiHijackPrefix(rawText);
  let tree = null;
  try { tree = JSON.parse(text); } catch { return null; }
  const entry = Array.isArray(tree) ? tree[0] : null;
  const bucket = Array.isArray(entry) ? entry[1] : null;
  if (!Array.isArray(bucket)) return null;
  const limit = Number(bucket[0]);
  const remaining = Number(bucket[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  const used = Number(entry[2]);
  const resetsAt = Array.isArray(bucket[6]) && bucket[6][0] != null ? new Date(Number(bucket[6][0]) * 1000).toISOString() : null;
  return { limit, remaining, used: Number.isFinite(used) ? used : null, resetsAt };
}

/**
 * O Vids avisa na própria UI que só o inglês produz bom resultado. Não é motivo
 * para bloquear a submissão, mas fica registrado no recibo.
 */
export function detectNonEnglishPrompt(prompt) {
  const value = String(prompt ?? "");
  if (/[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇñÑ]/.test(value)) return true;
  return /\b(não|uma|com|para|dos|das|pelo|pela|você|esse|essa|isso|então|também)\b/i.test(value);
}

function requireDocumentUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return VIDS_CREATE_URL;
  if (url === VIDS_CREATE_URL) return url;
  if (!url.startsWith(VIDS_DOCUMENT_PREFIX)) {
    throw new Error(`--document-url deve apontar para um documento do Google Vids (${VIDS_DOCUMENT_PREFIX}...) ou ser omitido para criar um documento novo.`);
  }
  return url;
}

async function openAiVideoPanel(page) {
  const entry = page.getByRole("button", { name: "Gerar um vídeo com IA", exact: false }).first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();
  await page.waitForTimeout(6_000);
  await page.locator("[aria-label='Abrir'], [aria-label='Expandir']").first().click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
}

async function selectAspect(page, aspect) {
  const target = resolveVidsAspect(aspect);
  const chip = page.locator("button, [role='button']").filter({ hasText: /^(Paisagem|Retrato)$/ }).first();
  await chip.waitFor({ state: "visible", timeout: 20_000 });
  const current = String(await chip.innerText().catch(() => "")).trim();
  if (current !== target.label) {
    await chip.click();
    await page.waitForTimeout(2_000);
    const option = page.getByText(target.option, { exact: false }).first();
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.click();
    await page.waitForTimeout(1_500);
  }
  const confirmed = String(await chip.innerText().catch(() => "")).trim();
  if (confirmed !== target.label) {
    throw new Error(`O Google Vids não confirmou a proporção ${target.aspect}; nenhuma geração foi submetida.`);
  }
  return target;
}

async function fillPrompt(page, prompt) {
  const box = page.locator("[contenteditable='true'], textarea").last();
  await box.waitFor({ state: "visible", timeout: 20_000 });
  await box.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(1_500);
  const persisted = String(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  if (!persisted.includes(prompt.replace(/\s+/g, " "))) {
    throw new Error("O Google Vids não persistiu o comando completo no compositor; nenhuma geração foi submetida.");
  }
}

async function downloadClip(page, mediaUrl) {
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include" });
    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < buffer.length; offset += 8_192) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + 8_192));
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      contentLength: response.headers.get("content-length") ?? null,
      bytes: buffer.length,
      data: btoa(binary),
    };
  }, mediaUrl);
  if (payload.status < 200 || payload.status >= 300) {
    throw new Error(`Download do clipe do Google Vids falhou: HTTP ${payload.status}.`);
  }
  const buffer = Buffer.from(payload.data, "base64");
  validateMp4Download({
    buffer,
    contentType: payload.contentType || "video/mp4",
    reportedBytes: payload.bytes,
    contentLength: payload.contentLength,
  });
  return buffer;
}

/**
 * Gera um clipe pelo Google Vids e devolve o MP4 já em disco.
 *
 * @param {{prompt: string, out?: string, receipt?: string, "document-url"?: string,
 *          aspect?: string, timeout?: number, chrome?: string}} options
 */
export async function runVidsVideo(options = {}) {
  if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Vids real é proibido em NODE_ENV=test.");
  const prompt = String(options.prompt ?? "").trim();
  if (!prompt) throw new Error("--prompt é obrigatório.");
  const documentUrl = requireDocumentUrl(options["document-url"] ?? options.documentUrl ?? options.url);
  const aspect = resolveVidsAspect(options.aspect ?? "16:9");
  const videoPath = path.resolve(options.out ?? "outputs/google-vids-video/clipe.mp4");
  const receiptPath = path.resolve(options.receipt ?? `${videoPath}.vids-attempt.json`);
  const chrome = options.chrome ?? DEFAULT_CHROME;
  const timeoutMs = Number(options.timeout ?? 300_000);
  const promptLooksNonEnglish = detectNonEnglishPrompt(prompt);

  await assertPathAvailable(videoPath, "Vídeo do Google Vids");
  await assertPathAvailable(receiptPath, "Recibo do Google Vids");

  let resources = null;
  let submitted = false;
  let operationError = null;
  let media = null;
  let quota = null;
  const startedAt = new Date().toISOString();

  try {
    resources = await openStudioPage({
      chrome,
      targetUrl: documentUrl,
      beforeNavigate: async (page) => {
        page.on("response", async (response) => {
          const url = response.url();
          if (url.includes(VIDS_QUOTA_ENDPOINT)) {
            const parsed = await response.text().then(parseVidsQuotaSummary).catch(() => null);
            if (parsed && parsed.limit < 999_999) quota = parsed;
            return;
          }
          if (!url.includes(VIDS_GENERATE_ENDPOINT) || media) return;
          const parsed = await response.text().then(parseVidsGenerateResponse).catch(() => null);
          if (parsed?.mediaUrl) media = parsed;
        });
      },
    });
    const { page } = resources;
    if (/accounts\.google\.com|signin|login/i.test(page.url())) throw new Error("A sessão descartável não autenticou no Google Vids.");
    if (!/Google Vids/i.test(await page.title())) throw new Error("A página autenticada não foi reconhecida como Google Vids.");
    await dismissOverlays(page);
    await page.waitForTimeout(3_000);
    const resolvedDocumentUrl = sanitizedUrl(page.url());

    await openAiVideoPanel(page);
    await selectAspect(page, aspect.aspect);
    await fillPrompt(page, prompt);

    const submitButton = page.locator("[aria-label='Gerar']").first();
    await submitButton.waitFor({ state: "visible", timeout: 20_000 });
    submitted = true;
    await submitButton.click();
    console.log(JSON.stringify({ stage: "submitted", provider: "google-vids-video", retryAllowed: false }));

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !media) {
      await page.waitForTimeout(2_500);
    }

    if (!media?.mediaUrl) {
      const pageState = sanitizeSensitiveText(await page.locator("body").innerText().catch(() => ""), 4_000);
      await writeJsonAtomic(receiptPath, {
        schema: VIDS_VIDEO_ATTEMPT_SCHEMA,
        status: "ambiguous",
        submitted,
        retryAllowed: false,
        startedAt,
        completedAt: new Date().toISOString(),
        authSource: "windows-credential-manager",
        documentUrl: resolvedDocumentUrl,
        aspect: aspect.aspect,
        promptLooksNonEnglish,
        timeoutMs,
        quota,
        pageState,
      }, { label: "Recibo do Google Vids" });
      throw new Error("O clipe foi submetido uma vez, mas nenhuma URL de vídeo apareceu na resposta do provedor. Estado ambíguo; repetição automática bloqueada.");
    }

    const buffer = await downloadClip(page, media.mediaUrl);
    await commitNewFileAtomically(videoPath, buffer, "Vídeo do Google Vids");

    const receipt = {
      schema: VIDS_VIDEO_ATTEMPT_SCHEMA,
      status: "succeeded",
      submitted: true,
      retryAllowed: false,
      startedAt,
      completedAt: new Date().toISOString(),
      authSource: "windows-credential-manager",
      documentUrl: resolvedDocumentUrl,
      model: VIDS_VIDEO_MODEL,
      aspect: aspect.aspect,
      promptLooksNonEnglish,
      promptVerifiedBeforeSubmission: true,
      quota,
      video: {
        path: videoPath,
        bytes: buffer.length,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        contentType: "video/mp4",
        sourceUrl: sanitizedUrl(media.mediaUrl),
        visibleWatermark: "sparkle-bottom-right",
      },
    };
    await writeJsonAtomic(receiptPath, receipt, { label: "Recibo do Google Vids" });
    console.log(JSON.stringify({ ok: true, video: videoPath, receipt: receiptPath, bytes: buffer.length, width: media.width, height: media.height, durationSeconds: media.durationSeconds }, null, 2));
    return {
      file: videoPath,
      videoPath,
      receiptFile: receiptPath,
      receipt,
      model: VIDS_VIDEO_MODEL,
      aspect: aspect.aspect,
      documentUrl: resolvedDocumentUrl,
      width: media.width,
      height: media.height,
      durationSeconds: media.durationSeconds,
      quota,
      startedAt,
      completedAt: receipt.completedAt,
    };
  } catch (error) {
    operationError = error;
    if (error && typeof error === "object") error.submitted = submitted;
    throw error;
  } finally {
    const cleanupErrors = resources ? await cleanupHeadlessResources(resources) : [];
    if (!operationError && cleanupErrors.length) throw new AggregateError(cleanupErrors, "Falha ao limpar o contexto descartável do Google Vids.");
  }
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runVidsVideo(readOptions(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
