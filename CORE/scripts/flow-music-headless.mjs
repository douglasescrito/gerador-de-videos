import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fitMusicToDuration } from "../lib/media-pipeline/audio-first.mjs";
import { probeMedia, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import {
  assertPathAvailable,
  replaceJsonAtomic,
  writeFileAtomic,
  writeJsonAtomic,
} from "../lib/media-pipeline/pipeline-operation.mjs";
import { CliError, ERROR_CODES } from "../lib/cli/cli-errors.mjs";
import { PROVIDER_WAIT_POLICY, providerWaitProjection } from "../lib/media-pipeline/performance-policy.mjs";
import { DEFAULT_CHROME } from "./persistent-session.mjs";
import {
  cleanupHeadlessResources,
  dismissOverlays,
  openStudioPage,
} from "./ai-studio-headless.mjs";
import {
  DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
  resolveAudioEnhancementFilter,
  resolveFlowMusicGenerationModel,
} from "../lib/media-pipeline/flow-music.mjs";

export const FLOW_MUSIC_MODEL = "flow-music-web";
export const FLOW_MUSIC_ATTEMPT_SCHEMA = "mkt-videos/flow-music-attempt@1";
const FLOW_COMPOSE_URL = "https://www.flowmusic.app/session";

function promptHash(prompt) {
  return createHash("sha256").update(String(prompt)).digest("hex");
}

function flowClipIdFromHref(href) {
  try {
    const url = new URL(String(href));
    const match = /^\/song\/([^/?#]+)$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function flowConversationIdFromHref(href) {
  try {
    const url = new URL(String(href));
    if (!/^(?:www\.)?flowmusic\.app$/iu.test(url.hostname)) return null;
    return /^\/session\/([A-Za-z0-9_-]+)$/u.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

function normalizedClip(candidate) {
  const audioUrl = String(candidate?.audio_url ?? candidate?.audioUrl ?? "").trim();
  const id = String(candidate?.id ?? candidate?.clip_id ?? candidate?.clipId ?? "").trim();
  if (!audioUrl || !id) return null;
  return {
    audioUrl,
    id,
    operationId: String(candidate?.op_id ?? candidate?.operation_id ?? candidate?.operationId ?? "").trim() || null,
    title: String(candidate?.title ?? "Untitled").trim() || "Untitled",
    durationSeconds: Number(candidate?.duration_s ?? candidate?.durationSeconds ?? candidate?.duration ?? null),
  };
}

export function flowClipFromProviderHandle(providerHandle) {
  const id = String(providerHandle?.clipId ?? "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return {
    audioUrl: `https://storage.googleapis.com/producer-app-public/clips/${encodeURIComponent(id)}.m4a`,
    id,
    operationId: String(providerHandle?.operationId ?? "").trim() || null,
    title: "Untitled",
    durationSeconds: 0,
  };
}

export function collectFlowMusicClips(value, {
  maxDepth = 12,
  maxNodes = 20_000,
  expectedPrompt = null,
} = {}) {
  const clips = new Map();
  const seen = new Set();
  let visited = 0;
  function visit(node, depth) {
    if (depth > maxDepth || visited >= maxNodes || node == null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    visited += 1;
    const clip = normalizedClip(node);
    if (clip && (expectedPrompt == null || node.operation?.sound_prompt === expectedPrompt)) clips.set(clip.id, clip);
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    for (const entry of Object.values(node)) visit(entry, depth + 1);
  }
  visit(value, 0);
  return [...clips.values()];
}

export function createFlowMusicResponseCollector({
  baselineClipIds = [],
  expectedPrompt = null,
} = {}) {
  const baseline = new Set(baselineClipIds);
  const candidates = new Map();
  const pending = new Set();
  let active = false;
  async function inspect(response) {
    if (!active || response.status() < 200 || response.status() >= 300) return;
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (!/^(?:www\.)?flowmusic\.app$/i.test(url.hostname) || !url.pathname.startsWith("/__api/")) return;
    const contentType = String(response.headers()["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("json")) return;
    let payload;
    try { payload = await response.json(); } catch { return; }
    for (const clip of collectFlowMusicClips(payload, { expectedPrompt })) {
      if (!baseline.has(clip.id)) candidates.set(clip.id, clip);
    }
  }
  return {
    start() { active = true; },
    observe(response) {
      const task = inspect(response).finally(() => pending.delete(task));
      pending.add(task);
    },
    async settle() {
      await Promise.allSettled([...pending]);
    },
    values() {
      return [...candidates.values()];
    },
    scrub() {
      for (const clip of candidates.values()) clip.audioUrl = "";
      candidates.clear();
      baseline.clear();
    },
  };
}

function extensionForAudio(contentType, audioUrl) {
  const mime = String(contentType ?? "").toLowerCase().split(";")[0].trim();
  if (mime === "audio/mpeg" || mime === "audio/mp3") return ".mp3";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return ".m4a";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") return ".wav";
  if (mime === "audio/ogg") return ".ogg";
  try {
    const extension = path.extname(new URL(audioUrl).pathname).toLowerCase();
    if (new Set([".mp3", ".m4a", ".wav", ".ogg"]).has(extension)) return extension;
  } catch {}
  return ".audio";
}

function providerCandidates(outputFile) {
  const parsed = path.parse(path.resolve(outputFile));
  return [".mp3", ".m4a", ".wav", ".ogg", ".audio"].map((extension) =>
    path.join(parsed.dir, `${parsed.name}.provider${extension}`));
}

export async function waitForGeneratedClip({
  page,
  collector,
  baselineHrefs,
  baselineConversationHrefs = null,
  timeoutMs,
  softBudgetMs,
  onProviderEvidence = null,
  onPerformanceBudgetExceeded = null,
  now = Date.now,
}) {
  const started = now();
  const deadline = started + timeoutMs;
  const softDeadline = started + Number(softBudgetMs ?? timeoutMs);
  let budgetReported = false;
  let observedBusy = false;
  let newSongHref = null;
  let newConversationHref = null;
  let lastConversationRead = started - 10_000;
  while (now() < deadline) {
    if (!budgetReported && now() >= softDeadline) {
      budgetReported = true;
      await onPerformanceBudgetExceeded?.({
        elapsedMs: Math.max(0, Number(softBudgetMs ?? 0)),
        observedBusy,
        clipId: flowClipIdFromHref(newSongHref),
      });
    }
    await collector.settle();
    const clips = collector.values();
    if (clips.length) {
      await onProviderEvidence?.({ clipId: clips[0].id, operationId: clips[0].operationId, source: "flow-json-response" });
      await page.waitForTimeout(2_000);
      await collector.settle();
      return collector.values()[0];
    }
    // A UI nova cria /session/<id> e consulta os clips por uma leitura POST.
    // Reabrir somente a conversa nova é observação da mesma tentativa, nunca Generate.
    // O collector desta rota exige o sound_prompt exato antes de aceitar seu áudio.
    if (baselineConversationHrefs) {
      const hrefs = await page.locator('a[href*="/session/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href)).catch(() => []);
      const candidates = [...new Set([page.url(), ...hrefs].filter((href) => flowConversationIdFromHref(href) && !baselineConversationHrefs.has(href)))];
      if (candidates.length > 1) throw new CliError("Mais de uma conversa Flow nova; associação automática bloqueada.", { code: ERROR_CODES.AMBIGUOUS_STATE });
      newConversationHref = candidates[0] ?? newConversationHref;
      if (newConversationHref && now() - lastConversationRead >= 30_000) {
        const conversationId = flowConversationIdFromHref(newConversationHref);
        await onProviderEvidence?.({ conversationId, source: "flow-conversation-link" });
        lastConversationRead = now();
        await page.goto(newConversationHref, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(1_500);
        await collector.settle();
        continue;
      }
    }
    const generate = page.getByRole("button", { name: "Generate", exact: true });
    const disabled = await generate.isDisabled().catch(() => false);
    observedBusy ||= disabled;
    const hrefs = await page.locator('a[href*="/song/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href)).catch(() => []);
    newSongHref = hrefs.find((href) => !baselineHrefs.has(href)) ?? newSongHref;
    const hrefClipId = flowClipIdFromHref(newSongHref);
    if (hrefClipId) await onProviderEvidence?.({ clipId: hrefClipId, operationId: null, source: "flow-song-link" });
    const body = String(await page.locator("body").innerText().catch(() => ""));
    const failure = /(not enough credits|generation failed|something went wrong|blocked by moderation|permission denied)/i.exec(body);
    if (failure && observedBusy) {
      throw new CliError(`Flow Music rejeitou a geração: ${failure[0]}.`, {
        code: ERROR_CODES.PROVIDER_REJECTED,
      });
    }
    if (observedBusy && !disabled && newSongHref) {
      await page.goto(newSongHref, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(5_000);
      await collector.settle();
      if (collector.values().length) return collector.values()[0];
    }
    await page.waitForTimeout(750);
  }
  throw new CliError("Flow Music não publicou um clip verificável dentro do tempo limite.", {
    code: ERROR_CODES.AMBIGUOUS_STATE,
    hint: "Não repita automaticamente. Revise o estado de tentativa e a sessão do Flow Music.",
  });
}

async function openFlowComposer(page) {
  const sound = page.locator('textarea[aria-label="Sound description"]:visible');
  if (await sound.count()) return sound.first();
  const toggle = page.locator('button[aria-label="Toggle compose panel"]:visible');
  if (await toggle.count() !== 1) {
    throw new Error("Flow Music mudou a UI: painel Compose e seu controle não foram encontrados.");
  }
  await toggle.click();
  await sound.first().waitFor({ state: "visible", timeout: 15_000 });
  return sound.first();
}

async function flowMusicModelButton(page) {
  const label = page.locator("label:visible").filter({ hasText: /^Model$/ });
  if (await label.count() !== 1) {
    throw new Error("Flow Music mudou a UI: campo Model não encontrado no painel Advanced.");
  }
  const button = label.first().locator("..").getByRole("button");
  if (await button.count() !== 1) {
    throw new Error("Flow Music mudou a UI: seletor do campo Model não foi identificado.");
  }
  await button.first().waitFor({ state: "visible", timeout: 15_000 });
  return button.first();
}

async function waitForLoadedModelLabel(page, button, expectedLabel = null) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const label = String(await button.innerText().catch(() => "")).trim();
    if (expectedLabel ? label === expectedLabel : Boolean(label && label !== "Model")) return label;
    await page.waitForTimeout(100);
  }
  throw new Error(expectedLabel
    ? `Flow Music não confirmou o modelo ${expectedLabel} no seletor.`
    : "Flow Music não carregou o valor atual do seletor Model.");
}

export async function selectFlowMusicGenerationModel(
  page,
  requestedModel = DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
) {
  const model = resolveFlowMusicGenerationModel(requestedModel);
  const advanced = page.getByRole("switch", { name: "Toggle advanced sound mode", exact: true });
  if (await advanced.count() !== 1) {
    throw new Error("Flow Music mudou a UI: controle Advanced não encontrado.");
  }
  if ((await advanced.getAttribute("aria-checked")) !== "true") {
    await advanced.click();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && (await advanced.getAttribute("aria-checked")) !== "true") {
      await page.waitForTimeout(100);
    }
  }
  if ((await advanced.getAttribute("aria-checked")) !== "true") {
    throw new Error("Flow Music não ativou o painel Advanced.");
  }

  const initialButton = await flowMusicModelButton(page);
  const previousModelLabel = await waitForLoadedModelLabel(page, initialButton);
  await initialButton.click();
  const option = page.getByText(model.label, { exact: true }).last();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();

  const selectedButton = await flowMusicModelButton(page);
  const selectedModelLabel = await waitForLoadedModelLabel(page, selectedButton, model.label);
  return {
    requestedModel: model.id,
    requestedModelLabel: model.label,
    previousModelLabel,
    selectedModel: model.id,
    selectedModelLabel,
    selectionMethod: "playwright-ui-model-menu",
    verifiedAt: new Date().toISOString(),
  };
}

async function downloadClipAudio({ request, clip, timeoutMs }) {
  const response = await request.get(clip.audioUrl, { timeout: timeoutMs });
  if (!response.ok()) {
    throw new CliError(`Flow Music retornou ${response.status()} ao baixar o áudio gerado.`, {
      code: ERROR_CODES.PROVIDER_REJECTED,
    });
  }
  const bytes = await response.body();
  if (!Buffer.isBuffer(bytes) || bytes.length < 1_024) {
    throw new CliError("Flow Music retornou um arquivo de áudio vazio ou inválido.", {
      code: ERROR_CODES.INTEGRITY_FAILURE,
    });
  }
  return {
    bytes,
    contentType: String(response.headers()["content-type"] ?? ""),
  };
}

export async function generateFlowMusicWithBrowserAuth({
  prompt,
  outputFile,
  model = DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
  durationSeconds = 30,
  preserveOriginalDuration = false,
  audioProfile = "broadcast-master",
  vocals = false,
  timeoutMs = PROVIDER_WAIT_POLICY.flow.defaultMs,
  softBudgetMs = PROVIDER_WAIT_POLICY.flow.softBudgetMs,
  harFile = null,
  openPage = openStudioPage,
  fitMusic = fitMusicToDuration,
} = {}) {
  if (harFile) {
    throw new CliError("Flow Music ainda aceita somente --auth credential-manager.", {
      code: ERROR_CODES.POLICY_DENIED,
    });
  }
  const normalizedPrompt = String(prompt ?? "").trim();
  if (!normalizedPrompt) throw new Error("prompt é obrigatório para Flow Music.");
  const requestedModel = resolveFlowMusicGenerationModel(model);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < 5 || duration > 120) {
    throw new Error("A duração do Flow Music deve ficar entre 5 e 120 segundos.");
  }
  const target = path.resolve(String(outputFile ?? ""));
  const wait = { ...providerWaitProjection("flow", timeoutMs), softBudgetMs: Number(softBudgetMs) };
  if (!Number.isFinite(wait.softBudgetMs) || wait.softBudgetMs <= 0) throw new Error("softBudgetMs do Flow deve ser positivo.");
  if (path.extname(target).toLowerCase() !== ".wav") {
    throw new Error("Flow Music publica o master local em WAV; use --out com extensão .wav.");
  }
  const receiptFile = `${target}.receipt.json`;
  const fitReceiptFile = `${target}.fit.receipt.json`;
  const attemptFile = `${target}.flow-attempt.json`;
  await Promise.all([
    assertPathAvailable(target, "Trilha Flow Music"),
    assertPathAvailable(receiptFile, "Recibo Flow Music"),
    assertPathAvailable(fitReceiptFile, "Recibo de ajuste da trilha"),
    assertPathAvailable(attemptFile, "Estado da tentativa Flow Music"),
    ...providerCandidates(target).map((file) => assertPathAvailable(file, "Original Flow Music")),
  ]);

  const attemptId = randomUUID();
  const startedAt = new Date();
  const baseAttempt = {
    schema: FLOW_MUSIC_ATTEMPT_SCHEMA,
    attemptId,
    status: "prepared",
    provider: "flow-music",
    adapterModel: FLOW_MUSIC_MODEL,
    requestedModel: requestedModel.id,
    requestedModelLabel: requestedModel.label,
    promptHash: promptHash(normalizedPrompt),
    requestedDurationSeconds: duration,
    waitBudget: wait,
    outputFile: target,
    auth: {
      mode: "windows-credential-manager",
      secretMaterialPersisted: false,
    },
    startedAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  };
  await writeJsonAtomic(attemptFile, baseAttempt, { label: "Estado da tentativa Flow Music" });

  let opened = null;
  let collector = null;
  let operationError = null;
  let submitted = false;
  let providerHandle = null;
  let performanceState = null;
  let modelSelection = null;
  try {
    opened = await openPage({
      chrome: process.env.CHROME_PATH ?? DEFAULT_CHROME,
      targetUrl: FLOW_COMPOSE_URL,
      harFile: null,
    });
    const page = opened.page;
    await dismissOverlays(page);
    if (/signin|login/i.test(page.url())) {
      throw new CliError("A sessão Flow Music exige novo login.", {
        code: ERROR_CODES.POLICY_DENIED,
        hint: "Execute npm run session -- setup --provider flow-music.",
      });
    }
    const baselineHrefs = new Set(
      await page.locator('a[href*="/song/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href)),
    );
    const baselineClipIds = [...baselineHrefs].map(flowClipIdFromHref).filter(Boolean);
    const baselineConversationHrefs = new Set(await page.locator('a[href*="/session/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href)));
    const currentConversation = flowConversationIdFromHref(page.url());
    if (currentConversation) baselineConversationHrefs.add(page.url());
    // The exact submitted wrapper is the binding to a clip in the new Flow UI.
    const expectedPrompt = vocals
      ? `[Format: ${duration}-second commercial radio cue with Brazilian Portuguese vocals]\n\n${normalizedPrompt}\n\n[Constraints: ${duration} seconds duration, clear vocals, clean resolved finish]`
      : `[Format: ${duration}-second short commercial radio cue, instrumental, no vocals]\n\n${normalizedPrompt}\n\n[Constraints: ${duration} seconds duration. Clean resolved stinger finish, no vocals, no fade out]`;
    collector = createFlowMusicResponseCollector({ baselineClipIds, expectedPrompt });
    page.on("response", (response) => collector.observe(response));

    const sound = await openFlowComposer(page);
    modelSelection = await selectFlowMusicGenerationModel(page, requestedModel.id);
    await replaceJsonAtomic(attemptFile, {
      ...baseAttempt,
      status: "model-selected",
      modelSelection,
      updatedAt: modelSelection.verifiedAt,
    }, { label: "Estado da tentativa Flow Music" });
    await sound.fill(expectedPrompt);
    const instrumental = page.locator('button[role="switch"][aria-label="Toggle instrumental mode"]:visible');
    if (await instrumental.count() === 1) {
      const isChecked = (await instrumental.getAttribute("aria-checked")) === "true";
      if (vocals && isChecked) {
        await instrumental.click();
      } else if (!vocals && !isChecked) {
        await instrumental.click();
      }
    }
    const generate = page.locator("button:visible").filter({ hasText: /^Generate$/ });
    if (await generate.count() !== 1) throw new Error("Flow Music mudou a UI: botão Generate não encontrado.");
    await generate.waitFor({ state: "visible", timeout: 15_000 });
    if (await generate.isDisabled()) throw new Error("Flow Music não habilitou Generate após preencher a direção.");

    collector.start();
    submitted = true;
    await generate.click();
    await replaceJsonAtomic(attemptFile, {
      ...baseAttempt,
      status: "submitted",
      modelSelection,
      updatedAt: new Date().toISOString(),
    }, { label: "Estado da tentativa Flow Music" });

    const clip = await waitForGeneratedClip({
      page,
      collector,
      baselineHrefs,
      baselineConversationHrefs,
      timeoutMs: wait.effectiveMs,
      softBudgetMs: wait.softBudgetMs,
      onProviderEvidence: async (evidence) => {
        const next = {
          clipId: String(evidence?.clipId ?? providerHandle?.clipId ?? "") || null,
          operationId: String(evidence?.operationId ?? providerHandle?.operationId ?? "") || null,
          conversationId: String(evidence?.conversationId ?? providerHandle?.conversationId ?? "") || null,
          source: String(evidence?.source ?? providerHandle?.source ?? "flow"),
          observedAt: new Date().toISOString(),
        };
        if (next.clipId === providerHandle?.clipId && next.operationId === providerHandle?.operationId && next.conversationId === providerHandle?.conversationId) return;
        providerHandle = next;
        await replaceJsonAtomic(attemptFile, {
          ...baseAttempt,
          status: "submitted",
          modelSelection,
          providerHandle,
          ...(performanceState ? { performance: performanceState } : {}),
          updatedAt: providerHandle.observedAt,
        }, { label: "Estado da tentativa Flow Music" });
      },
      onPerformanceBudgetExceeded: async (observation) => {
        performanceState = {
          status: "over-budget-running",
          targetMs: wait.softBudgetMs,
          elapsedMs: Number(observation.elapsedMs),
          observedBusy: Boolean(observation.observedBusy),
          observedClipId: observation.clipId ?? null,
          exceededAt: new Date().toISOString(),
          action: "continue-and-reconcile-same-attempt",
        };
        await replaceJsonAtomic(attemptFile, {
          ...baseAttempt,
          status: "submitted",
          modelSelection,
          ...(providerHandle ? { providerHandle } : {}),
          performance: performanceState,
          updatedAt: performanceState.exceededAt,
        }, { label: "Estado da tentativa Flow Music" });
      },
    });
    const request = opened.session?.context?.request ?? opened.context?.request;
    if (!request) throw new Error("Contexto autenticado do Flow Music não expôs o downloader.");
    const download = await downloadClipAudio({
      request,
      clip,
      timeoutMs: Math.min(wait.effectiveMs, 120_000),
    });
    const extension = extensionForAudio(download.contentType, clip.audioUrl);
    const parsed = path.parse(target);
    const providerFile = path.join(parsed.dir, `${parsed.name}.provider${extension}`);
    await writeFileAtomic(providerFile, download.bytes, { label: "Original Flow Music" });
    const sourceProbe = await probeMedia(providerFile);
    if (!sourceProbe.audio || !sourceProbe.duration) {
      throw new CliError("O original baixado do Flow Music não contém áudio reproduzível.", {
        code: ERROR_CODES.INTEGRITY_FAILURE,
      });
    }
    let finalDuration = sourceProbe.duration;
    let fitReceiptId = null;
    let effectiveFitReceiptFile = fitReceiptFile;
    if (preserveOriginalDuration) {
      const dspFilter = resolveAudioEnhancementFilter(audioProfile);
      const filterArgs = dspFilter ? ["-af", dspFilter] : [];
      await runFfmpeg(["-y", "-i", providerFile, ...filterArgs, "-c:a", "pcm_s24le", "-ar", "48000", target]);
      const convertedProbe = await probeMedia(target);
      finalDuration = convertedProbe.duration ?? sourceProbe.duration;
      effectiveFitReceiptFile = null;
    } else {
      const fit = await fitMusic({
        sourceFile: providerFile,
        targetDuration: duration,
        outputFile: target,
        receiptFile: fitReceiptFile,
        fadeOutSeconds: 0,
        metadata: {
          sourceProvider: "flow-music",
          requestedDurationSeconds: duration,
          cleanCut: true,
        },
      });
      finalDuration = fit.probe.duration;
      fitReceiptId = fit.receipt.id;
    }
    const completedAt = new Date();
    await replaceJsonAtomic(attemptFile, {
      ...baseAttempt,
      status: "completed",
      modelSelection,
      clipId: clip.id,
      operationId: clip.operationId,
      providerHandle: providerHandle ?? { clipId: clip.id, operationId: clip.operationId, source: "flow-json-response", observedAt: completedAt.toISOString() },
      ...(performanceState ? { performance: { ...performanceState, status: "completed-over-budget" } } : {}),
      providerFile,
      fitReceiptFile: effectiveFitReceiptFile,
      completedAt: completedAt.toISOString(),
      updatedAt: completedAt.toISOString(),
    }, { label: "Estado da tentativa Flow Music" });
    return {
      file: target,
      providerFile,
      fitReceiptFile: effectiveFitReceiptFile,
      fitReceiptId,
      attemptFile,
      attemptId,
      clipId: clip.id,
      operationId: clip.operationId,
      title: clip.title,
      model: modelSelection.selectedModel,
      modelLabel: modelSelection.selectedModelLabel,
      adapterModel: FLOW_MUSIC_MODEL,
      modelSelection,
      requestedDurationSeconds: duration,
      sourceDurationSeconds: sourceProbe.duration,
      durationSeconds: finalDuration,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      authSource: "credential-manager",
    };
  } catch (error) {
    operationError = error;
    const failedAt = new Date().toISOString();
    await replaceJsonAtomic(attemptFile, {
      ...baseAttempt,
      status: submitted ? "ambiguous" : "failed-before-submit",
      ...(modelSelection ? { modelSelection } : {}),
      ...(providerHandle ? { providerHandle } : {}),
      ...(performanceState ? { performance: performanceState } : {}),
      errorCode: error?.code ?? "unknown",
      failedAt,
      updatedAt: failedAt,
    }, { label: "Estado da tentativa Flow Music" }).catch(() => {});
    throw error;
  } finally {
    collector?.scrub();
    const cleanupErrors = await cleanupHeadlessResources({
      session: opened?.session ?? null,
      context: opened?.context ?? null,
      browser: opened?.browser ?? null,
      temporaryProfile: opened?.temporaryProfile ?? null,
      credentialCookies: opened?.credentialCookies ?? [],
    });
    if (!operationError && cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Falha ao limpar recursos do Flow Music headless.");
    }
  }
}

export async function reconcileFlowMusicWithBrowserAuth({
  attemptFile,
  outputFile,
  timeoutMs = PROVIDER_WAIT_POLICY.flow.defaultMs,
  softBudgetMs = PROVIDER_WAIT_POLICY.flow.softBudgetMs,
  openPage = openStudioPage,
  fitMusic = fitMusicToDuration,
} = {}) {
  const attemptPath = path.resolve(String(attemptFile ?? ""));
  const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
  if (attempt?.schema !== FLOW_MUSIC_ATTEMPT_SCHEMA || attempt.status !== "ambiguous") {
    throw new Error("Reconciliação Flow exige uma tentativa ambígua flow-music-attempt@1.");
  }
  const target = path.resolve(String(outputFile ?? attempt.outputFile ?? ""));
  if (target !== path.resolve(String(attempt.outputFile))) throw new Error("Reconciliação Flow diverge do outputFile da tentativa.");
  const duration = Number(attempt.requestedDurationSeconds);
  const reconciledModel = resolveFlowMusicGenerationModel(
    attempt.modelSelection?.selectedModel ?? attempt.requestedModel ?? DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
  );
  const wait = { ...providerWaitProjection("flow", timeoutMs), softBudgetMs: Number(softBudgetMs) };
  const fitReceiptFile = `${target}.fit.receipt.json`;
  await Promise.all([
    assertPathAvailable(target, "Trilha Flow Music reconciliada"),
    assertPathAvailable(fitReceiptFile, "Recibo de ajuste da trilha reconciliada"),
    ...providerCandidates(target).map((file) => assertPathAvailable(file, "Original Flow Music reconciliado")),
  ]);

  let opened = null;
  let collector = null;
  let operationError = null;
  try {
    opened = await openPage({
      chrome: process.env.CHROME_PATH ?? DEFAULT_CHROME,
      targetUrl: FLOW_COMPOSE_URL,
      harFile: null,
    });
    const page = opened.page;
    await dismissOverlays(page);
    if (/signin|login/i.test(page.url())) throw new CliError("A sessão Flow Music exige novo login.", { code: ERROR_CODES.POLICY_DENIED });
    const initialHrefs = await page.locator('a[href*="/song/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
    const generate = page.getByRole("button", { name: "Generate", exact: true });
    const busy = await generate.isDisabled().catch(() => false);
    if (!attempt.providerHandle?.clipId && initialHrefs.length && !busy) {
      throw new CliError("A tentativa Flow não possui handle e a sessão já está ociosa com clips preexistentes; associação automática bloqueada.", {
        code: ERROR_CODES.AMBIGUOUS_STATE,
      });
    }
    const baselineHrefs = new Set(initialHrefs);
    const baselineClipIds = [...baselineHrefs].map(flowClipIdFromHref).filter(Boolean);
    collector = createFlowMusicResponseCollector({ baselineClipIds });
    page.on("response", (response) => collector.observe(response));
    collector.start();

    const request = opened.session?.context?.request ?? opened.context?.request;
    if (!request) throw new Error("Contexto autenticado do Flow Music não expôs o downloader.");
    let clip = flowClipFromProviderHandle(attempt.providerHandle);
    let download = null;
    if (clip) {
      try {
        download = await downloadClipAudio({
          request,
          clip,
          timeoutMs: Math.min(wait.effectiveMs, 120_000),
        });
      } catch {
        download = null;
      }
    }
    if (!download && attempt.providerHandle?.clipId) {
      const href = `https://www.flowmusic.app/song/${encodeURIComponent(attempt.providerHandle.clipId)}`;
      baselineHrefs.delete(href);
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    if (!download) {
      clip = await waitForGeneratedClip({
        page,
        collector,
        baselineHrefs,
        timeoutMs: wait.effectiveMs,
        softBudgetMs: wait.softBudgetMs,
        onProviderEvidence: async (evidence) => {
          const providerHandle = {
            clipId: String(evidence?.clipId ?? "") || null,
            operationId: String(evidence?.operationId ?? "") || null,
            source: String(evidence?.source ?? "flow-reconciliation"),
            observedAt: new Date().toISOString(),
          };
          await replaceJsonAtomic(attemptPath, {
            ...attempt,
            status: "ambiguous",
            providerHandle,
            reconciliation: { zeroPost: true, status: "provider-evidence", checkedAt: providerHandle.observedAt },
            updatedAt: providerHandle.observedAt,
          }, { label: "Reconciliação da tentativa Flow Music" });
        },
      });
      download = await downloadClipAudio({ request, clip, timeoutMs: Math.min(wait.effectiveMs, 120_000) });
    }
    const extension = extensionForAudio(download.contentType, clip.audioUrl);
    const parsed = path.parse(target);
    const providerFile = path.join(parsed.dir, `${parsed.name}.provider${extension}`);
    await writeFileAtomic(providerFile, download.bytes, { label: "Original Flow Music reconciliado" });
    const sourceProbe = await probeMedia(providerFile);
    if (!sourceProbe.audio || !sourceProbe.duration) throw new CliError("O original reconciliado do Flow Music não contém áudio reproduzível.", { code: ERROR_CODES.INTEGRITY_FAILURE });
    const fit = await fitMusic({
      sourceFile: providerFile,
      targetDuration: duration,
      outputFile: target,
      receiptFile: fitReceiptFile,
      fadeOutSeconds: 0,
      metadata: { sourceProvider: "flow-music", requestedDurationSeconds: duration, cleanCut: true, reconciliation: { zeroPost: true } },
    });
    const completedAt = new Date();
    await replaceJsonAtomic(attemptPath, {
      ...attempt,
      status: "completed",
      clipId: clip.id,
      operationId: clip.operationId,
      providerHandle: { clipId: clip.id, operationId: clip.operationId, source: "flow-reconciliation", observedAt: completedAt.toISOString() },
      reconciliation: { zeroPost: true, status: "completed", checkedAt: completedAt.toISOString() },
      providerFile,
      fitReceiptFile,
      completedAt: completedAt.toISOString(),
      updatedAt: completedAt.toISOString(),
    }, { label: "Reconciliação da tentativa Flow Music" });
    return {
      file: target,
      providerFile,
      fitReceiptFile,
      fitReceiptId: fit.receipt.id,
      attemptFile: attemptPath,
      attemptId: attempt.attemptId,
      clipId: clip.id,
      operationId: clip.operationId,
      title: clip.title,
      model: reconciledModel.id,
      modelLabel: attempt.modelSelection?.selectedModelLabel ?? reconciledModel.label,
      adapterModel: attempt.adapterModel ?? FLOW_MUSIC_MODEL,
      modelSelection: attempt.modelSelection ?? null,
      requestedDurationSeconds: duration,
      sourceDurationSeconds: sourceProbe.duration,
      durationSeconds: fit.probe.duration,
      startedAt: attempt.startedAt,
      completedAt: completedAt.toISOString(),
      authSource: "credential-manager",
      reconciliation: { zeroPost: true },
    };
  } catch (error) {
    operationError = error;
    const checkedAt = new Date().toISOString();
    await replaceJsonAtomic(attemptPath, {
      ...attempt,
      status: "ambiguous",
      reconciliation: { zeroPost: true, status: "pending", checkedAt, errorCode: error?.code ?? "unknown" },
      updatedAt: checkedAt,
    }, { label: "Reconciliação da tentativa Flow Music" }).catch(() => {});
    throw error;
  } finally {
    collector?.scrub();
    const cleanupErrors = await cleanupHeadlessResources({
      session: opened?.session ?? null,
      context: opened?.context ?? null,
      browser: opened?.browser ?? null,
      temporaryProfile: opened?.temporaryProfile ?? null,
      credentialCookies: opened?.credentialCookies ?? [],
    });
    if (!operationError && cleanupErrors.length) throw new AggregateError(cleanupErrors, "Falha ao limpar recursos da reconciliação Flow Music.");
  }
}
