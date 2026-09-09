import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactFromFile, inferMimeType } from "./artifact.mjs";
import { mapWithConcurrency } from "./concurrency.mjs";
import { probeMedia, runCommand, runFfmpeg } from "./media-tools.mjs";
import { createStageReceipt, readVerifiedReceipt, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { createStageMetrics } from "./stage-metrics.mjs";

export const QA_REPORT_SCHEMA = "mkt-videos/qa-report@1";

// As verificações são independentes entre si: probe de vídeo, probe de áudio,
// detecção de preto/congelamento, silêncio, loudness, amostragem de quadros e
// integridade de recibos não dependem do resultado uma da outra. Rodam juntas.
// O que continua indivisível é a DECISÃO: os warnings só são avaliados depois
// que todas as verificações terminaram, e o veredito continua sendo um só.
const QA_CHECK_CONCURRENCY = 4;

export function evaluateQaGate(report, { mode = "block", blockingWarnings = null } = {}) {
  if (!new Set(["block", "warn"]).has(mode)) throw new Error(`Modo de gate QA inválido: ${mode}.`);
  const warnings = [...new Set((report?.warnings ?? []).map(String))];
  const configured = blockingWarnings == null ? null : [...new Set(blockingWarnings.map(String))];
  const blocking = mode === "warn"
    ? []
    : configured == null
      ? warnings
      : warnings.filter((warning) => configured.includes(warning));
  return {
    mode,
    status: blocking.length ? "blocked" : warnings.length ? "warning" : "pass",
    warnings,
    blockingWarnings: blocking,
    evaluatedAt: new Date().toISOString(),
  };
}

export function contextualizeQaWarnings(report, {
  allowedTerminalBlackSeconds = 0,
  toleranceSeconds = 0.25,
  allowedPreMasterTruePeakDb = null,
} = {}) {
  const warnings = [...new Set((report?.warnings ?? []).map(String))];
  const contextualAllowances = [];
  const preMasterPeakLimit = allowedPreMasterTruePeakDb == null ? null : Number(allowedPreMasterTruePeakDb);
  const measuredTruePeakDb = Number(report?.detections?.truePeakDb);
  if (warnings.includes("audio_clipping")
    && Number.isFinite(preMasterPeakLimit)
    && Number.isFinite(measuredTruePeakDb)
    && measuredTruePeakDb <= preMasterPeakLimit) {
    contextualAllowances.push({
      code: "audio_clipping",
      reason: "pre-master-true-peak-tolerance",
      measuredTruePeakDb,
      allowedPreMasterTruePeakDb: preMasterPeakLimit,
    });
  }
  const contextualWarnings = contextualAllowances.some((entry) => entry.code === "audio_clipping")
    ? warnings.filter((warning) => warning !== "audio_clipping")
    : warnings;
  const allowedSeconds = Number(allowedTerminalBlackSeconds);
  const duration = Number(report?.probe?.duration);
  const tolerance = Number(toleranceSeconds);
  const black = (report?.detections?.black ?? []).filter((entry) => Number(entry.duration) >= 1);
  if (!warnings.includes("black_interval")
    || !Number.isFinite(allowedSeconds)
    || allowedSeconds <= 0
    || !Number.isFinite(duration)
    || duration <= 0
    || !Number.isFinite(tolerance)
    || tolerance < 0
    || !black.length) {
    return { warnings: contextualWarnings, contextualAllowances };
  }

  const terminalWindowStart = Math.max(0, duration - allowedSeconds - tolerance);
  const allInsideTerminalWindow = black.every((entry) => Number(entry.start) >= terminalWindowStart);
  const reachesEnd = Math.max(...black.map((entry) => Number(entry.end))) >= duration - tolerance;
  if (!allInsideTerminalWindow || !reachesEnd) return { warnings: contextualWarnings, contextualAllowances };
  contextualAllowances.push({
    code: "black_interval",
    reason: "intentional-terminal-dip-to-black",
    allowedTerminalBlackSeconds: allowedSeconds,
    terminalWindowStart,
    toleranceSeconds: tolerance,
    intervals: structuredClone(black),
  });
  return {
    warnings: contextualWarnings.filter((warning) => warning !== "black_interval"),
    contextualAllowances,
  };
}

export function parseDetectionLog(stderr) {
  const black = [...String(stderr).matchAll(/black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
  const freezeStarts = [...String(stderr).matchAll(/freeze_start:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const freezeEnds = [...String(stderr).matchAll(/freeze_end:\s*(\d+(?:\.\d+)?)\s*\|\s*freeze_duration:\s*(\d+(?:\.\d+)?)/g)]
    .map((match, index) => ({ start: freezeStarts[index] ?? null, end: Number(match[1]), duration: Number(match[2]) }));
  const silenceStarts = [...String(stderr).matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const silenceEnds = [...String(stderr).matchAll(/silence_end:\s*(\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)/g)]
    .map((match, index) => ({ start: silenceStarts[index] ?? null, end: Number(match[1]), duration: Number(match[2]) }));
  const integrated = [...String(stderr).matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)];
  const peaks = [...String(stderr).matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/g)];
  return {
    black,
    freezes: freezeEnds,
    silence: silenceEnds,
    integratedLufs: integrated.length ? Number(integrated.at(-1)[1]) : null,
    truePeakDb: peaks.length ? Number(peaks.at(-1)[1]) : null,
  };
}

// As duas passadas de detecção leem o mesmo arquivo por caminhos diferentes
// (uma só vídeo, outra só áudio) e não trocam nada entre si: rodam juntas.
async function detectMedia(file, hasAudio) {
  const [video, audio] = await Promise.all([
    runCommand("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-50dB:d=1", "-an", "-f", "null", "-"]),
    hasAudio
      ? runCommand("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=n=-50dB:d=1,ebur128=peak=true", "-vn", "-f", "null", "-"])
      : Promise.resolve({ stderr: "" }),
  ]);
  return parseDetectionLog(`${video.stderr}\n${audio.stderr}`);
}

async function extractFrames(videoFile, duration, directory, count = 3) {
  const positions = Array.from({ length: count }, (_, index) => {
    const fraction = (index + 1) / (count + 1);
    return {
      at: Math.max(0, (duration || count) * fraction),
      file: path.join(directory, `frame-${String(index + 1).padStart(2, "0")}.jpg`),
    };
  });
  // Cada quadro é um seek independente; a ordem do resultado é preservada.
  return mapWithConcurrency(positions, QA_CHECK_CONCURRENCY, async ({ at, file }) => {
    await runFfmpeg(["-y", "-ss", at.toFixed(3), "-i", videoFile, "-frames:v", "1", "-q:v", "2", file]);
    return { at, file };
  });
}

async function ocrFrames(frames, expectedText) {
  if (!expectedText) return { requested: false, available: null, expectedText: null, recognized: [], matched: null };
  try {
    await runCommand("tesseract", ["--version"]);
  } catch {
    return { requested: true, available: false, expectedText, recognized: [], matched: null };
  }
  const recognized = await mapWithConcurrency(frames, QA_CHECK_CONCURRENCY, async (frame) => {
    try {
      const { stdout } = await runCommand("tesseract", [frame.file, "stdout", "-l", "por+eng"]);
      return { at: frame.at, text: stdout.replace(/\s+/g, " ").trim() };
    } catch (error) {
      return { at: frame.at, text: "", error: error.message };
    }
  });
  const normalize = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  const expected = normalize(expectedText);
  const matched = recognized.some((item) => normalize(item.text).includes(expected));
  return { requested: true, available: true, expectedText, recognized, matched };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.outputText === "string") return payload.outputText;
  const parts = payload?.steps?.flatMap((step) => step?.content ?? []) ?? [];
  return parts.filter((part) => part?.type === "text" && part.text).map((part) => part.text).join("\n") || null;
}

async function semanticReview({ frames, direction, references, model, client }) {
  const input = [];
  for (const frame of frames) {
    input.push({ type: "image", data: (await readFile(frame.file)).toString("base64"), mime_type: "image/jpeg" });
  }
  for (const reference of references ?? []) {
    const file = path.resolve(String(reference));
    input.push({ type: "image", data: (await readFile(file)).toString("base64"), mime_type: inferMimeType(file) });
  }
  input.push({
    type: "text",
    text: `Review the sampled video frames against this authorized direction: ${JSON.stringify(String(direction ?? ""))}. Evaluate visual coherence, requested objects, text legibility, and general consistency with supplied references. Do not perform face recognition, identity matching, or biometric scoring. Return concise JSON with fields score (0-100), findings, and suggestedRefineInstruction.`,
  });
  const payload = await client.create({ model, input, responseFormat: { type: "text" }, timeoutMs: 300_000 });
  const text = outputText(payload);
  let parsed = null;
  try { parsed = JSON.parse(String(text).replace(/^```json\s*|\s*```$/g, "")); } catch {}
  return { model, interactionId: payload.id ?? null, result: parsed ?? { raw: text } };
}

export async function runQa({
  videoFile,
  outputFile = `${videoFile}.qa.json`,
  receiptFile = `${outputFile}.receipt.json`,
  expectedText = null,
  expectedDuration = null,
  direction = null,
  semantic = false,
  semanticModel = "gemini-3.5-flash",
  references = [],
  sourceReceipts = [],
  expectedParts = null,
  actualParts = null,
  client = null,
  parentReceipts = [],
  requireAudio = true,
  metadata = {},
} = {}) {
  if (semantic && !client?.create) throw new Error("QA semântico exige um adapter cookie-only verificável; GEMINI_API_KEY não é suportada.");
  const source = path.resolve(String(videoFile));
  const startedAt = new Date();
  const metrics = createStageMetrics({ run: "qa" });
  const probe = await metrics.measure("probe", () => probeMedia(source));
  if (!probe.video) throw new Error("O arquivo não contém faixa de vídeo reproduzível.");
  const temp = await mkdtemp(path.join(os.tmpdir(), "mkt-video-qa-"));
  try {
    // Verificações independentes, todas ao mesmo tempo. Nenhuma delas decide
    // nada sozinha: cada uma só produz a evidência que a decisão vai ler.
    const [detections, frames, receiptIntegrity] = await Promise.all([
      metrics.measure("detect", () => detectMedia(source, Boolean(probe.audio))),
      metrics.measure("frames", () => extractFrames(source, probe.duration, temp, semantic || expectedText ? 3 : 1)),
      metrics.measure("receipt-integrity", () => mapWithConcurrency(sourceReceipts ?? [], QA_CHECK_CONCURRENCY, async (receiptFile) => {
        const file = path.resolve(String(receiptFile));
        try {
          const receipt = await readVerifiedReceipt(file);
          return { file, valid: true, id: receipt.id };
        } catch (error) {
          return { file, valid: false, error: error?.message ?? String(error) };
        }
      })),
    ]);
    const ocr = await metrics.measure("ocr", () => ocrFrames(frames, expectedText));

    // A partir daqui é decisão: uma só, depois de tudo medido, na mesma ordem
    // de sempre para que o conjunto de warnings continue comparável.
    const warnings = [];
    for (const entry of receiptIntegrity) if (!entry.valid) warnings.push("receipt_invalid");
    if (requireAudio && !probe.audio) warnings.push("audio_missing");
    if (expectedDuration != null && Math.abs(Number(expectedDuration) - Number(probe.duration)) > 0.25) warnings.push("duration_mismatch");
    if (detections.black.some((entry) => entry.duration >= 1)) warnings.push("black_interval");
    if (detections.freezes.some((entry) => entry.duration >= Math.max(2, (probe.duration ?? 0) * 0.5))) warnings.push("long_freeze");
    if (detections.truePeakDb != null && detections.truePeakDb >= 0) warnings.push("audio_clipping");
    if (ocr.available && ocr.matched === false) warnings.push("expected_text_not_found");
    if (expectedParts != null && actualParts != null && Number(expectedParts) !== Number(actualParts)) warnings.push("part_count_mismatch");
    // Report-only por contrato: o QA semântico nunca vira warning e nunca
    // dispara correção automática. Ele entra no relatório como leitura, não
    // como veredito.
    const semanticResult = semantic
      ? await metrics.measure("semantic", () => semanticReview({ frames, direction, references, model: semanticModel, client }))
      : null;
    const metricsDocument = metrics.snapshot();
    const report = {
      schema: QA_REPORT_SCHEMA,
      videoFile: source,
      status: warnings.length ? "warning" : "pass",
      completedAt: new Date().toISOString(),
      probe,
      detections,
      expectedDuration: expectedDuration == null ? null : Number(expectedDuration),
      ocr,
      receiptIntegrity,
      parts: { expected: expectedParts == null ? null : Number(expectedParts), actual: actualParts == null ? null : Number(actualParts) },
      warnings,
      semantic: semanticResult,
      suggestedRefineInstruction: semanticResult?.result?.suggestedRefineInstruction ?? null,
      metrics: { wallMs: metricsDocument.wallMs, stages: metricsDocument.stages },
      policy: { biometricScoring: false, autoRefine: false, decision: "single-verdict-after-all-checks" },
    };
    await writeJsonAtomic(outputFile, report, { label: "Relatório QA" });
    const [videoArtifact, reportArtifact] = await Promise.all([
      createArtifactFromFile({ file: source, kind: "video", role: "qa-source" }),
      createArtifactFromFile({ file: outputFile, kind: "data", role: "qa-report", source: { provider: semantic ? semanticModel : "local-technical-qa" } }),
    ]);
    const receipt = createStageReceipt({
      operation: "qa-video",
      provider: semantic ? "local+gemini-interactions" : "local-ffmpeg",
      model: semantic ? semanticModel : null,
      mode: "studio",
      stage: "qa",
      prompt: direction,
      parameters: { expectedText, expectedDuration, expectedParts, actualParts, semantic, semanticModel: semantic ? semanticModel : null, frameCount: frames.length, sourceReceipts: receiptIntegrity.map((entry) => entry.file), requireAudio },
      inputs: [videoArtifact],
      artifacts: [reportArtifact],
      providerResponse: semanticResult ? { interactionId: semanticResult.interactionId } : {},
      metadata: { ...structuredClone(metadata ?? {}), status: report.status, warnings, autoRefine: false },
      parentReceipts,
      startedAt,
      completedAt: new Date(),
    });
    await writeStageReceipt(receiptFile, receipt);
    return { report, file: path.resolve(outputFile), receiptFile: path.resolve(receiptFile), receipt };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
