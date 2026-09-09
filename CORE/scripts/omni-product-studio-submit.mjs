#!/usr/bin/env node
import { studioLocalPath } from '../lib/studio-local-config.mjs';

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { loadHarCookies } from "./ai-studio-headless.mjs";
import { refreshPersistentSession } from "./persistent-session.mjs";
import { PROVIDER_WAIT_POLICY, providerWaitProjection, resolveProviderWaitMs } from "../lib/media-pipeline/performance-policy.mjs";
import { classifyOmniRemoteState } from "../lib/media-pipeline/omni-video.mjs";
import { measureExecutionPhase } from "../lib/media-pipeline/execution-timing.mjs";
import { buildProductPromptRequest, requestProductPrompt, PRODUCT_PROMPT_MODEL } from "../lib/media-pipeline/product-prompt.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
// O applet é servido num host próprio do Cloud Run, diferente em cada
// instalação. O caminho oficial é abrir o AI Studio e achar o iframe do
// applet, que é o que a rota por HAR já fazia. Quem quiser o atalho direto
// aponta OMNI_PRODUCT_STUDIO_URL para o próprio host.
const DIRECT_TARGET_URL = String(process.env.OMNI_PRODUCT_STUDIO_URL ?? "").trim() || null;
const AI_STUDIO_TARGET_URL = "https://aistudio.google.com/app/apps/bundled/omni-product-studio?showPreview=true&showAssistant=true";
const CHROME = studioLocalPath('chromePath') ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ACCEPTED_MP4_CONTENT_TYPES = new Set(["video/mp4", "application/mp4", "application/octet-stream"]);
const IMAGE_MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const VIDEO_TASKS = new Set(["auto", "text_to_video", "image_to_video", "reference_to_video", "edit"]);

function optionsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Uso: --imagem arquivo --atmosfera "direção" [--prompt "direção direta"] [--out recibo.json]`);
    }
    options[key.slice(2)] = value;
    i += 1;
  }
  return options;
}

function sanitizedUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function redact(value, key = "") {
  if (/authorization|cookie|token|secret|api.?key/i.test(key)) return "<redacted>";
  if (key === "data" && typeof value === "string") return `<omitted binary: ${value.length} chars>`;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  if (typeof value === "string" && (/^data:.*;base64,/i.test(value) || value.length > 2_000)) return `<omitted string: ${value.length} chars>`;
  return value;
}

async function readRedactedJson(response) {
  const text = await response.text();
  try {
    return redact(JSON.parse(text));
  } catch {
    return `<non-JSON response omitted: ${text.length} chars>`;
  }
}

function imagePartFromDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl ?? "");
  if (!match) throw new Error("Imagem gerada não retornou um data URL base64 válido.");
  return { mimeType: match[1], data: match[2] };
}

function defaultVideoPath(output) {
  return output.toLowerCase().endsWith(".json") ? `${output.slice(0, -5)}.mp4` : `${output}.mp4`;
}

async function assertFileAbsent(file, label) {
  try {
    await lstat(file);
    throw new Error(`${label} já existe e não será sobrescrito: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function assertOutputsAvailable(receiptPath, videoPath) {
  await assertFileAbsent(receiptPath, "Recibo");
  await assertFileAbsent(videoPath, "MP4");
}

export function validateMp4Download({ buffer, contentType, reportedBytes = null, contentLength = null }) {
  const mimeType = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_MP4_CONTENT_TYPES.has(mimeType)) {
    throw new Error(`Download retornou Content-Type incompatível com MP4: ${mimeType || "ausente"}.`);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Download retornou um vídeo vazio.");
  if (reportedBytes !== null && Number(reportedBytes) !== buffer.length) {
    throw new Error(`Download retornou tamanho divergente: navegador=${reportedBytes}, decodificado=${buffer.length}.`);
  }
  if (contentLength !== null && contentLength !== "") {
    if (!/^\d+$/.test(String(contentLength)) || Number(contentLength) !== buffer.length) {
      throw new Error(`Download retornou Content-Length divergente: cabeçalho=${contentLength}, recebido=${buffer.length}.`);
    }
  }
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    throw new Error("Download não contém a assinatura ftyp de um MP4 válido.");
  }
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize !== 0 && (boxSize < 12 || boxSize > buffer.length)) {
    throw new Error("Download contém uma caixa ftyp MP4 truncada ou inválida.");
  }
  return { bytes: buffer.length, contentType: "video/mp4" };
}

export async function commitNewFileAtomically(file, data, label = "Arquivo") {
  return measureExecutionPhase("publication", async () => {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await assertFileAbsent(target, label);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await assertFileAbsent(target, label);
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`${label} já existe e não será sobrescrito: ${target}`);
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
  });
}

export function requireSuccessfulVideoPayload(ok, status, payload) {
  if (!ok) throw new Error(`Falha ao gerar vídeo: HTTP ${status}: ${typeof payload === "object" ? JSON.stringify(payload) : String(payload)}`);
  if (!payload || typeof payload !== "object" || !payload.fileId) {
    throw new Error("A resposta de geração de vídeo não retornou fileId.");
  }
  return payload.fileId;
}

async function readVideoStatus(frame, fileId, { timeoutMs = 30_000 } = {}) {
  return measureExecutionPhase("polling", () => frame.evaluate(async ({ id, timeoutMs }) => {
      const response = await fetch(`/api/file-status/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
      return { ok: response.ok, status: response.status, payload };
    }, { id: fileId, timeoutMs }));
}

async function pollAndDownloadVideo(frame, fileId, videoPath, { timeoutMs = PROVIDER_WAIT_POLICY.omni.defaultMs, pollIntervalMs = 3_000 } = {}) {
  const states = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await readVideoStatus(frame, fileId);
    states.push(status.payload?.state ?? `HTTP_${status.status}`);
    if (status.payload?.state === "ACTIVE") break;
    if (status.payload?.state === "FAILED") throw new Error(`Render falhou para fileId ${fileId}.`);
    await measureExecutionPhase("pending-wait", () => new Promise((resolve) => setTimeout(resolve, pollIntervalMs)));
  }
  if (states[states.length - 1] !== "ACTIVE") throw new Error(`Render não ficou ACTIVE. Último estado: ${states[states.length - 1]}`);

  return { ...await downloadVideo(frame, fileId, videoPath, { timeoutMs }), states };
}

async function downloadVideo(frame, fileId, videoPath, { timeoutMs = 120_000 } = {}) {
  const video = await measureExecutionPhase("download", () => frame.evaluate(async ({ id, timeoutMs }) => {
    const response = await fetch(`/api/video/${encodeURIComponent(id)}`, { credentials: "include", signal: AbortSignal.timeout(timeoutMs) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      bytes: bytes.length,
      base64: btoa(binary),
    };
  }, { id: fileId, timeoutMs }));
  if (!video.ok) throw new Error(`Download do video falhou: HTTP ${video.status}`);
  const buffer = Buffer.from(video.base64, "base64");
  const validated = validateMp4Download({
    buffer,
    contentType: video.contentType,
    reportedBytes: video.bytes,
    contentLength: video.contentLength,
  });
  const committedPath = await commitNewFileAtomically(videoPath, buffer, "MP4");
  return { path: committedPath, bytes: validated.bytes, contentType: validated.contentType };
}

function resolveCredentialScriptPath() {
  const candidates = [
    path.join(import.meta.dirname, "credential-cookies.ps1"),
    path.join(import.meta.dirname, "..", "scripts", "credential-cookies.ps1"),
    path.join(import.meta.dirname, "..", "..", "scripts", "credential-cookies.ps1"),
    path.resolve(process.cwd(), "scripts", "credential-cookies.ps1"),
    path.resolve(process.cwd(), "CORE", "scripts", "credential-cookies.ps1"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return path.resolve(import.meta.dirname, "credential-cookies.ps1");
}

async function loadCredentialManagerService(service) {
  const script = resolveCredentialScriptPath();
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", "Get", "-Service", service], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const cookies = JSON.parse(Buffer.from(stdout.trim(), "base64").toString("utf8"));
  if (!Array.isArray(cookies) || !cookies.length) throw new Error(`Cookies ausentes para ${service}.`);
  return cookies;
}

async function loadCredentialManagerCookies() {
  for (const service of ["GoogleAIStudio", "OmniProductStudio"]) {
    try { return await loadCredentialManagerService(service); }
    catch {}
  }
  // Auto-refresh transparente da sessão persistente do navegador
  try {
    const { refreshPersistentSession } = await import("./persistent-session.mjs");
    await refreshPersistentSession({ provider: "google" });
    for (const service of ["GoogleAIStudio", "OmniProductStudio"]) {
      try { return await loadCredentialManagerService(service); }
      catch {}
    }
  } catch {}
  throw new Error("Cookies Google ausentes no Gerenciador de Credenciais.");
}

export async function loadProductStudioCookies({ harFile = null } = {}) {
  return harFile ? loadHarCookies(harFile) : loadCredentialManagerCookies();
}

function scrubCookies(cookies) {
  for (const cookie of cookies) {
    if (cookie && typeof cookie === "object") {
      for (const key of Object.keys(cookie)) cookie[key] = "";
    }
  }
  cookies.splice(0, cookies.length);
}

async function imagePartFromFile(file) {
  const absolute = path.resolve(String(file));
  const mimeType = IMAGE_MIME_BY_EXTENSION.get(path.extname(absolute).toLowerCase());
  if (!mimeType) throw new Error(`Formato de imagem não suportado no Product Studio: ${absolute}`);
  const data = await readFile(absolute);
  return { mimeType, data: data.toString("base64") };
}

export function buildVideoBrowserRequest({ prompt, images = [], referenceVideo = null, task = "auto", aspectRatio = "16:9", model = null } = {}) {
  const normalizedPrompt = String(prompt ?? "").trim();
  if (!normalizedPrompt) throw new Error("prompt é obrigatório.");
  if (!VIDEO_TASKS.has(task)) throw new Error(`Task inválida: ${task}.`);
  if (!new Set(["16:9", "9:16"]).has(aspectRatio)) throw new Error(`Aspecto inválido: ${aspectRatio}.`);
  if (!Array.isArray(images) || images.length > 4) throw new Error("São permitidas no máximo quatro imagens de referência.");
  if (task === "text_to_video" && (images.length || referenceVideo)) throw new Error("text_to_video não aceita imagens nem vídeo.");
  if (task === "image_to_video" && (images.length < 1 || images.length > 2 || referenceVideo)) throw new Error("image_to_video exige uma ou duas imagens e não aceita vídeo.");
  if (task === "reference_to_video" && (!images.length || referenceVideo)) throw new Error("reference_to_video exige imagens e não aceita vídeo.");
  if (task === "edit" && (!referenceVideo || images.length)) throw new Error("edit exige referenceVideo e não aceita imagens.");
  return {
    prompt: normalizedPrompt,
    aspectRatio,
    ...(model ? { model } : {}),
    ...(task !== "auto" && task !== "edit" ? { task } : {}),
    ...(images.length ? { productImages: images } : {}),
    ...(referenceVideo ? { referenceVideo } : {}),
  };
}

export function buildImageBrowserRequest({ prompt, images = [], model = "gemini-3.1-flash-image", aspectRatio = "1:1", imageSize = "2K" } = {}) {
  const normalizedPrompt = String(prompt ?? "").trim();
  if (!normalizedPrompt) throw new Error("prompt é obrigatório.");
  if (!Array.isArray(images) || images.length > 4) throw new Error("São permitidas no máximo quatro imagens de referência.");
  return {
    prompt: normalizedPrompt,
    productImages: images,
    model,
    aspectRatio,
    imageSize,
  };
}

async function openAuthenticatedProductStudio({ harFile = null } = {}) {
  if (!harFile) await refreshPersistentSession({ provider: "google", timeoutMs: 15_000 }).catch(() => null);
  const cookies = await loadProductStudioCookies({ harFile });
  let browser = null;
  let context = null;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-background-networking"] });
    context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const requests = [];
    const responses = [];
    page.on("request", (request) => {
      if (!request.url().includes("run.app/api/")) return;
      let postData = null;
      try { postData = redact(JSON.parse(request.postData() ?? "null")); } catch { postData = "<non-JSON body omitted>"; }
      requests.push({ method: request.method(), url: sanitizedUrl(request.url()), postData });
    });
    page.on("response", (response) => {
      if (!response.url().includes("run.app/api/")) return;
      responses.push({ method: response.request().method(), status: response.status(), url: sanitizedUrl(response.url()) });
    });
    await page.goto(harFile || !DIRECT_TARGET_URL ? AI_STUDIO_TARGET_URL : DIRECT_TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(8_000);
    const skip = page.getByRole("button", { name: "Skip", exact: true });
    if (await skip.count() === 1) await skip.click();
    const frame = page.frames().find((candidate) => candidate.url().includes("omni-product-studio-") && candidate.url().includes("run.app"));
    if (!frame) throw new Error("A página autenticada do Omni Product Studio não carregou.");
    return { browser, context, frame, cookies, requests, responses, authSource: harFile ? "har" : "credential-manager" };
  } catch (error) {
    await Promise.allSettled([context?.close(), browser?.close()].filter(Boolean));
    scrubCookies(cookies);
    throw error;
  }
}

async function closeAuthenticatedProductStudio(session) {
  await Promise.allSettled([session?.context?.close(), session?.browser?.close()].filter(Boolean));
  scrubCookies(session?.cookies ?? []);
}

function videoOutputFile(outputFile) {
  if (!String(outputFile ?? "").trim()) throw new Error("outputFile é obrigatório.");
  const output = path.resolve(String(outputFile));
  if (output === ROOT) throw new Error("outputFile é obrigatório.");
  return output;
}

function persistedFileId(value) {
  const fileId = String(value ?? "").trim();
  if (!fileId) throw new Error("Operação cookie-only exige fileId persistido.");
  return fileId;
}

async function prepareVideoSubmission({ prompt, images = [], videoFile = null, task = "auto", model = "nano-banana-pro-preview", aspectRatio = "16:9", outputFile } = {}, { requireOutput = true } = {}) {
  return measureExecutionPhase("preparation", async () => {
  const output = requireOutput || outputFile != null ? videoOutputFile(outputFile) : null;
  if (output) await assertFileAbsent(output, "MP4");
  const imageParts = await Promise.all(images.map(imagePartFromFile));
  const referenceVideo = videoFile ? { mimeType: "video/mp4", data: (await readFile(path.resolve(String(videoFile)))).toString("base64") } : null;
  const body = buildVideoBrowserRequest({ prompt, images: imageParts, referenceVideo, task, aspectRatio, model });
  return { output, body };
  });
}

// Esses fatos acompanham inclusive falhas de persistência do handle. Perder a
// resposta local depois do POST nunca pode ser confundido com ausência de POST.
function submissionError(error, { postStarted, fileId = null, httpStatus = null }) {
  const result = error instanceof Error ? error : new Error("Falha na submissão Omni.");
  const facts = { postStarted, submissionAmbiguous: postStarted, ...(fileId ? { fileId } : {}), ...(httpStatus != null ? { httpStatus } : {}) };
  try { return Object.assign(result, facts); }
  catch { return Object.assign(new Error(result.message, { cause: error }), facts); }
}

async function submitVideoInSession(session, body, { attemptId = null, onBeforeSubmit = null, onProviderHandle = null, timeoutMs = PROVIDER_WAIT_POLICY.omni.defaultMs } = {}) {
  const startedAt = new Date().toISOString();
  let postStarted = false;
  let fileId = null;
  let httpStatus = null;
  try {
    const effectiveTimeoutMs = resolveProviderWaitMs("omni", timeoutMs);
    const waitBudget = providerWaitProjection("omni", timeoutMs);
    // A reserva durável e a autoridade do executor precisam estar gravadas
    // antes do único POST. Os dois callbacks são obrigatoriamente aguardados.
    if (onBeforeSubmit) await onBeforeSubmit({ attemptId, startedAt });
    postStarted = true;
    const raw = await measureExecutionPhase("submission", () => session.frame.evaluate(async (requestBody) => {
      const response = await fetch("/api/generate-video", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    }, body));
    httpStatus = raw.status;
    let payload;
    try { payload = JSON.parse(raw.text); } catch { payload = null; }
    fileId = requireSuccessfulVideoPayload(raw.ok, raw.status, redact(payload));
    const submittedAt = new Date().toISOString();
    const handle = { attemptId, fileId, interactionId: payload?.interactionId ?? null, expirationTime: payload?.expirationTime ?? null, auth: "cookie-session", startedAt, submittedAt };
    if (onProviderHandle) await onProviderHandle(handle);
    return {
      ...handle,
      status: "pending",
      response: redact(payload),
      requests: session.requests,
      responses: session.responses,
      authSource: session.authSource,
      cookieCount: session.cookies.length,
      timeoutMs: effectiveTimeoutMs,
      requestedTimeoutMs: Number(timeoutMs),
      waitBudget,
    };
  } catch (error) {
    throw submissionError(error, { postStarted, fileId, httpStatus });
  }
}

// A fábrica permite testar as três fases sem cookies e reutiliza o mesmo
// transporte do generate legado. Não mantém fila, journal ou novo executor.
export function createOmniVideoBrowserOperations({ openSession = openAuthenticatedProductStudio, closeSession = closeAuthenticatedProductStudio } = {}) {
  async function withSession(harFile, operation) {
    const session = await measureExecutionPhase("preparation", () => openSession({ harFile }));
    try { return await operation(session); }
    finally {
      // Cleanup não apaga a evidência de aceite nem substitui o erro de POST.
      // O encerramento padrão também tenta fechar todos os recursos sem lançar.
      try { await closeSession(session); } catch {}
    }
  }

  async function submit(options = {}) {
    try {
      const { body } = await prepareVideoSubmission(options, { requireOutput: false });
      return await withSession(options.harFile ?? null, (session) => submitVideoInSession(session, body, options));
    } catch (error) {
      if (typeof error?.postStarted === "boolean") throw error;
      throw submissionError(error, { postStarted: false });
    }
  }

  async function observeMany({ requests = [], harFile = null, timeoutMs = 30_000 } = {}) {
    if (!Array.isArray(requests)) throw new Error("observeMany exige requests como array de handles.");
    const handles = requests.map((request) => ({ fileId: persistedFileId(request?.fileId), expirationTime: request?.expirationTime ?? null }));
    if (!handles.length) return [];
    const timeout = Number(timeoutMs);
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("timeoutMs da observação deve ser inteiro positivo.");
    return withSession(harFile, async (session) => {
      // Uma autenticação atende todos os handles vencidos deste lote. Cada
      // handle faz somente um GET; pending devolve a decisão ao runner.
      const results = new Array(handles.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, handles.length) }, async () => {
        while (cursor < handles.length) {
          const index = cursor++;
          const handle = handles[index];
          const checkedAt = new Date().toISOString();
          try {
            const status = await readVideoStatus(session.frame, handle.fileId, { timeoutMs: timeout });
            const state = String(status.payload?.state ?? "UNKNOWN");
            const expirationTime = status.payload?.expirationTime ?? handle.expirationTime;
            results[index] = {
              fileId: handle.fileId,
              classification: classifyOmniRemoteState({ httpStatus: status.status, state, expirationTime }),
              state,
              httpStatus: status.status,
              expirationTime,
              checkedAt,
              zeroPost: true,
            };
          } catch {
            results[index] = { fileId: handle.fileId, classification: "upstream_unreachable", state: "UNKNOWN", httpStatus: null, expirationTime: handle.expirationTime, checkedAt, zeroPost: true };
          }
        }
      }));
      return results;
    });
  }

  async function collect({ fileId, outputFile, harFile = null, timeoutMs = 120_000, startedAt = null, attemptId = null, interactionId = null } = {}) {
    const id = persistedFileId(fileId);
    const output = videoOutputFile(outputFile);
    await assertFileAbsent(output, "MP4");
    const checkedAt = new Date().toISOString();
    return withSession(harFile, async (session) => ({
      ...await downloadVideo(session.frame, id, output, { timeoutMs }),
      status: "ready", classification: "ready", zeroPost: true, fileId: id,
      attemptId, interactionId, startedAt: startedAt ?? checkedAt, checkedAt,
      completedAt: new Date().toISOString(), authSource: session.authSource,
      responses: session.responses,
    }));
  }

  async function generate(options = {}) {
    const { output, body } = await prepareVideoSubmission(options);
    return withSession(options.harFile ?? null, async (session) => {
      const submitted = await submitVideoInSession(session, body, options);
      try {
        const video = await pollAndDownloadVideo(session.frame, submitted.fileId, output, {
          timeoutMs: submitted.timeoutMs,
          pollIntervalMs: options.pollIntervalMs ?? 3_000,
        });
        return { ...submitted, ...video, status: "ready", completedAt: new Date().toISOString() };
      } catch (error) {
        throw submissionError(error, { postStarted: true, fileId: submitted.fileId });
      }
    });
  }

  return { submit, observeMany, observe: async (options) => (await observeMany({ ...options, requests: [options] }))[0], collect, generate };
}

export async function submitVideoWithBrowserAuth(options = {}) {
  return createOmniVideoBrowserOperations().submit(options);
}

export async function observeVideosWithBrowserAuth(options = {}) {
  return createOmniVideoBrowserOperations().observeMany(options);
}

export async function collectVideoWithBrowserAuth(options = {}) {
  return createOmniVideoBrowserOperations().collect(options);
}

export async function generateVideoWithBrowserAuth(options = {}) {
  return createOmniVideoBrowserOperations().generate(options);
}

export async function reconcileVideoWithBrowserAuth({ fileId, outputFile, harFile = null, timeoutMs = 120_000, pollIntervalMs = 3_000 } = {}) {
  const id = String(fileId ?? "").trim();
  if (!id) throw new Error("Reconcile cookie-only exige fileId persistido.");
  const output = path.resolve(String(outputFile ?? ""));
  if (!output || output === ROOT) throw new Error("outputFile é obrigatório.");
  await assertFileAbsent(output, "MP4");
  const session = await openAuthenticatedProductStudio({ harFile });
  const checkedAt = new Date().toISOString();
  try {
    const video = await pollAndDownloadVideo(session.frame, id, output, { timeoutMs, pollIntervalMs });
    return { ...video, fileId: id, classification: "ready", zeroPost: true, checkedAt, authSource: session.authSource };
  } finally {
    await closeAuthenticatedProductStudio(session);
  }
}

export async function generateProductPromptWithBrowserAuth(input = {}) {
  if (process.env.NODE_ENV === 'test') throw new Error('Provider-free test guard: sessão real proibida.');
  const body = buildProductPromptRequest(input);
  const { loadEffectiveProviderCapabilities } = await import('../lib/media-pipeline/provider-registry.mjs');
  const capabilities = await loadEffectiveProviderCapabilities();
  const capability = capabilities['gemini-product-text'];
  if (capability?.status !== 'supported') throw new Error('Capacidade de texto bloqueada ou expirada.');
  const session = await openAuthenticatedProductStudio();
  try {
    const text = await requestProductPrompt(session.frame, body);
    return { text, model: PRODUCT_PROMPT_MODEL, modelProvenance: 'upstream-source-2026-09-06', auth: 'credential-manager', operation: 'product-prompt', mediaGenerated: false };
  } finally { await closeAuthenticatedProductStudio(session); }
}

export async function generateImageWithBrowserAuth({ prompt, images = [], model, aspectRatio, imageSize, outputFile, harFile = null } = {}) {
  const output = path.resolve(String(outputFile ?? ""));
  if (!output || output === ROOT) throw new Error("outputFile é obrigatório.");
  await assertFileAbsent(output, "Imagem");
  const imageParts = await Promise.all(images.map(imagePartFromFile));
  const body = buildImageBrowserRequest({ prompt, images: imageParts, model, aspectRatio, imageSize });
  const session = await openAuthenticatedProductStudio({ harFile });
  const startedAt = new Date().toISOString();
  try {
    const raw = await session.frame.evaluate(async (requestBody) => {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    }, body);
    let payload;
    try { payload = JSON.parse(raw.text); } catch { payload = null; }
    if (!raw.ok) throw new Error(`Falha ao gerar imagem: HTTP ${raw.status}.`);
    const part = imagePartFromDataUrl(payload?.imageUrl);
    const buffer = Buffer.from(part.data, "base64");
    if (!buffer.length) throw new Error("Geração de imagem retornou dados vazios.");
    await commitNewFileAtomically(output, buffer, "Imagem");
    return {
      file: output,
      bytes: buffer.length,
      mimeType: part.mimeType,
      interactionId: payload?.interactionId ?? null,
      response: redact(payload),
      requests: session.requests,
      responses: session.responses,
      authSource: session.authSource,
      cookieCount: session.cookies.length,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await closeAuthenticatedProductStudio(session);
  }
}

/**
 * Edição de MP4 pelo mesmo caminho autenticado usado pelo Omni Product Studio.
 * O vídeo é enviado como referenceVideo e o prompt segue sem reescrita.
 */
export async function editUploadedVideoWithCredentialCookies({ prompt, videoFile, outputFile, timeoutMs = PROVIDER_WAIT_POLICY.omni.defaultMs, harFile = null } = {}) {
  const result = await generateVideoWithBrowserAuth({ prompt, videoFile, task: "edit", outputFile, timeoutMs, harFile });
  return { ...result, credentialCookieCount: result.cookieCount };
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (options.video !== undefined) {
    const prompt = String(options.prompt ?? "").trim();
    const video = path.resolve(String(options.video));
    const output = path.resolve(options.out ?? path.join(ROOT, "outputs", "omni-product-studio-uploaded-edit.json"));
    const videoPath = defaultVideoPath(output);
    const receiptPath = output.toLowerCase().endsWith(".json") ? output : `${output}.receipt.json`;
    await assertOutputsAvailable(receiptPath, videoPath);
    const result = await editUploadedVideoWithCredentialCookies({ prompt, videoFile: video, outputFile: videoPath, harFile: options.har ? path.resolve(String(options.har)) : null });
    const receipt = {
      schema: "mkt-videos/playwright-uploaded-video-edit@1",
      mode: "playwright-headless-uploaded-video-edit",
      submittedAt: result.startedAt,
      completedAt: result.completedAt,
      input: { video: path.basename(video), prompt },
      credentialCookies: result.credentialCookieCount,
      videoResponse: { status: result.responses.at(-1)?.status ?? null, payload: result.response },
      videoFile: result,
    };
    await commitNewFileAtomically(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "Recibo");
    console.log(JSON.stringify({ ok: true, output: receiptPath, video: result.path, interactionId: result.interactionId, fileId: result.fileId }, null, 2));
    return;
  }
  const image = path.resolve(options.imagem ?? options.image ?? "");
  const atmosphere = String(options.atmosfera ?? options.atmosphere ?? "").trim();
  const directPrompt = String(options.prompt ?? "").trim();
  if (!image || image === ROOT || !atmosphere) throw new Error("--imagem e --atmosfera são obrigatórios.");
  const output = path.resolve(options.out ?? path.join(ROOT, "outputs", "omni-product-studio-headless-test.json"));
  const videoPath = defaultVideoPath(output);
  await assertOutputsAvailable(output, videoPath);
  const cookies = await loadProductStudioCookies({ harFile: options.har ? path.resolve(String(options.har)) : null });
  let browser = null;
  let context = null;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-background-networking"] });
    context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const requests = [];
    const responses = [];
    page.on("request", (request) => {
      if (!request.url().includes("run.app/api/")) return;
      let postData = null;
      try { postData = redact(JSON.parse(request.postData() ?? "null")); } catch { postData = "<non-JSON body omitted>"; }
      requests.push({ method: request.method(), url: sanitizedUrl(request.url()), postData });
    });
    page.on("response", (response) => {
      if (!response.url().includes("run.app/api/")) return;
      responses.push({ method: response.request().method(), status: response.status(), url: sanitizedUrl(response.url()) });
    });

    await context.addCookies(cookies);
    await page.goto(DIRECT_TARGET_URL ?? AI_STUDIO_TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(8_000);
    const skip = page.getByRole("button", { name: "Skip", exact: true });
    if (await skip.count() === 1) await skip.click();
    const frame = page.frames().find((candidate) => candidate.url().includes("omni-product-studio-") && candidate.url().includes("run.app"));
    if (!frame) throw new Error("Iframe do Omni Product Studio não carregou.");

    const uploadInputs = frame.locator('input[type="file"]');
    const uploadCount = await uploadInputs.count();
    if (uploadCount !== 2) throw new Error(`Esperava dois campos de upload; encontrei ${uploadCount}.`);
    await uploadInputs.nth(0).setInputFiles(image);
    await frame.getByText("Uploaded reference photo", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    const selectedImages = frame.locator('img[referrerpolicy="no-referrer"]');
    const productDataUrl = await selectedImages.first().getAttribute("src");
    const productImage = imagePartFromDataUrl(productDataUrl);

    const atmospherePrompt = frame.getByPlaceholder('Describe the desired atmosphere (e.g. "a colorful ceramic mug on a table"...)', { exact: true });
    if (await atmospherePrompt.count() !== 1) throw new Error("Campo de atmosfera não encontrado.");
    await atmospherePrompt.fill(atmosphere);

    const generateAtmosphere = frame.getByRole("button", { name: "Generate atmosphere image", exact: true });
    if (await generateAtmosphere.count() !== 1) throw new Error("Botão Generate atmosphere image não encontrado.");
    const atmosphereResponsePromise = page.waitForResponse((response) => {
      const url = sanitizedUrl(response.url());
      return url.endsWith("/api/generate-image") || url.endsWith("/api/generate-atmosphere");
    }, { timeout: 240_000 });
    await generateAtmosphere.click();
    const atmosphereResponse = await atmosphereResponsePromise;
    const atmospherePayload = await readRedactedJson(atmosphereResponse);
    if (!atmosphereResponse.ok()) throw new Error(`Falha ao gerar atmosfera: HTTP ${atmosphereResponse.status()}`);
    for (let i = 0; i < 80 && (await selectedImages.count()) < 2; i += 1) await page.waitForTimeout(250);
    if ((await selectedImages.count()) < 2) throw new Error("Imagem de atmosfera não apareceu na UI.");
    const atmosphereDataUrl = await selectedImages.nth(1).getAttribute("src");
    const atmosphereImage = imagePartFromDataUrl(atmosphereDataUrl);

    const submit = frame.getByRole("button", { name: "Submit", exact: true });
    if (await submit.count() !== 1) throw new Error("Botão Submit não encontrado.");
    for (let i = 0; i < 80 && !(await submit.isEnabled()); i += 1) await page.waitForTimeout(250);
    if (!(await submit.isEnabled())) throw new Error("O Product Studio não habilitou Submit após o upload.");

    if (directPrompt) {
      const videoPayloadRaw = await frame.evaluate(async (body) => {
        const response = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: response.ok, status: response.status, text: await response.text() };
      }, {
        prompt: directPrompt,
        productImages: [productImage],
        atmosphereImages: [atmosphereImage],
      });
      let videoPayload;
      try {
        videoPayload = redact(JSON.parse(videoPayloadRaw.text));
      } catch {
        videoPayload = `<non-JSON response omitted: ${videoPayloadRaw.text.length} chars>`;
      }
      const fileId = requireSuccessfulVideoPayload(videoPayloadRaw.ok, videoPayloadRaw.status, videoPayload);
      const videoFile = await pollAndDownloadVideo(frame, fileId, videoPath);
      const receipt = {
        mode: "playwright-headless-direct-prompt",
        submittedAt: new Date().toISOString(),
        input: { image: path.basename(image), atmosphere, prompt: directPrompt },
        credentialCookies: cookies.length,
        atmosphereResponse: { status: atmosphereResponse.status(), payload: atmospherePayload },
        videoResponse: { status: videoPayloadRaw.status, payload: videoPayload },
        videoFile,
        requests,
        responses,
      };
      try {
        await commitNewFileAtomically(output, `${JSON.stringify(receipt, null, 2)}\n`, "Recibo");
      } catch (error) {
        await rm(videoFile.path, { force: true });
        throw error;
      }
      console.log(JSON.stringify({ ok: videoPayloadRaw.ok, output, interactionId: videoPayload?.interactionId ?? null, fileId: videoPayload?.fileId ?? null }, null, 2));
      return;
    }

    const promptResponsePromise = page.waitForResponse((response) => sanitizedUrl(response.url()).endsWith("/api/generate-prompt"), { timeout: 180_000 });
    const videoResponsePromise = page.waitForResponse((response) => sanitizedUrl(response.url()).endsWith("/api/generate-video"), { timeout: 300_000 });
    await submit.click();
    const [promptResponse, videoResponse] = await Promise.all([promptResponsePromise, videoResponsePromise]);
    const promptPayload = await readRedactedJson(promptResponse);
    const videoPayload = await readRedactedJson(videoResponse);
    const fileId = requireSuccessfulVideoPayload(videoResponse.ok(), videoResponse.status(), videoPayload);
    const videoFile = await pollAndDownloadVideo(frame, fileId, videoPath);
    const receipt = {
      mode: "playwright-headless",
      submittedAt: new Date().toISOString(),
      input: { image: path.basename(image), atmosphere },
      credentialCookies: cookies.length,
      atmosphereResponse: { status: atmosphereResponse.status(), payload: atmospherePayload },
      promptResponse: { status: promptResponse.status(), payload: promptPayload },
      videoResponse: { status: videoResponse.status(), payload: videoPayload },
      videoFile,
      requests,
      responses,
    };
    try {
      await commitNewFileAtomically(output, `${JSON.stringify(receipt, null, 2)}\n`, "Recibo");
    } catch (error) {
      await rm(videoFile.path, { force: true });
      throw error;
    }
    console.log(JSON.stringify({ ok: videoResponse.ok(), output, interactionId: videoPayload?.interactionId ?? null, fileId: videoPayload?.fileId ?? null }, null, 2));
  } finally {
    const cleanup = [];
    if (context) cleanup.push(context.close());
    if (browser) cleanup.push(browser.close());
    await Promise.allSettled(cleanup);
    for (const cookie of cookies) {
      if (cookie && typeof cookie === "object") {
        for (const key of Object.keys(cookie)) cookie[key] = "";
      }
    }
    cookies.splice(0, cookies.length);
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === "omni-product-studio-submit.mjs" && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
