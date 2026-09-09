import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import {
  commitTemporaryFile,
  createStageReceipt,
  operationFingerprint,
  requireStudioMode,
  writeStageReceipt,
} from "./pipeline-operation.mjs";
import { createAdapterContract } from "./adapter-contract.mjs";

export const HYBRID_COMPOSITION_SCHEMA = "mkt-videos/hybrid-composition@1";
export const HYBRID_COMPOSITION_PLAN_SCHEMA = "mkt-videos/hybrid-composition-plan@1";

const TRACK_KINDS = new Set(["video-base", "video-alpha", "audio", "captions"]);
const AUDIO_MODES = new Set(["preserve-base", "replace-base", "mix"]);
const CAPTION_EXTENSIONS = new Set([".ass", ".srt", ".vtt"]);

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function safeId(value, label) {
  const normalized = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized) || /[\\/]/.test(normalized)) {
    throw new Error(`${label} contém um identificador inválido.`);
  }
  return normalized;
}

function positiveInteger(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} deve ser um inteiro não negativo.`);
  return number;
}

function positiveNumber(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} deve ser um número não negativo.`);
  return number;
}

function rational(value, label) {
  const numerator = positiveInteger(value?.numerator, `${label}.numerator`);
  const denominator = positiveInteger(value?.denominator, `${label}.denominator`);
  if (denominator === 0) throw new Error(`${label}.denominator deve ser maior que zero.`);
  return { numerator, denominator };
}

function frameSeconds(frame, fps) {
  return (Number(frame) * fps.denominator / fps.numerator).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function escapeFilterPath(file) {
  return path.resolve(file).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function normalizeTrack(track, index) {
  if (!track || typeof track !== "object") throw new Error(`Track ${index + 1} inválida.`);
  const kind = text(track.kind, `tracks[${index}].kind`);
  if (!TRACK_KINDS.has(kind)) throw new Error(`Tipo de track híbrida inválido: ${kind}.`);
  const normalized = {
    id: safeId(track.id, `tracks[${index}].id`),
    kind,
    file: path.resolve(text(track.file, `tracks[${index}].file`)),
    startFrame: positiveInteger(track.startFrame ?? 0, `tracks[${index}].startFrame`),
    endFrameExclusive: positiveInteger(track.endFrameExclusive, `tracks[${index}].endFrameExclusive`, { nullable: true }),
    zIndex: Number(track.zIndex ?? 0),
  };
  if (!Number.isInteger(normalized.zIndex)) throw new Error(`tracks[${index}].zIndex deve ser inteiro.`);
  if (normalized.endFrameExclusive != null && normalized.endFrameExclusive <= normalized.startFrame) {
    throw new Error(`tracks[${index}] possui intervalo de frames vazio.`);
  }
  if (kind === "video-base" && normalized.startFrame !== 0) throw new Error("A track video-base deve começar no frame zero.");
  if (kind === "video-alpha") {
    if (normalized.endFrameExclusive == null) throw new Error("Track video-alpha exige endFrameExclusive.");
    if (normalized.zIndex <= 0) throw new Error("Track video-alpha deve ter zIndex maior que zero.");
    normalized.alpha = track.alpha !== false;
    if (!normalized.alpha) throw new Error("Track video-alpha precisa declarar alpha=true.");
    normalized.position = {
      x: positiveNumber(track.position?.x ?? 0, `tracks[${index}].position.x`),
      y: positiveNumber(track.position?.y ?? 0, `tracks[${index}].position.y`),
    };
  }
  if (kind === "audio") normalized.role = text(track.role ?? "external", `tracks[${index}].role`);
  if (kind === "captions") {
    const extension = path.extname(normalized.file).toLowerCase();
    if (!CAPTION_EXTENSIONS.has(extension)) throw new Error(`Formato de captions não suportado: ${extension || "sem extensão"}.`);
  }
  return normalized;
}

function canonicalManifestBody(value) {
  const fps = rational(value.fps, "fps");
  const durationFrames = positiveInteger(value.durationFrames, "durationFrames");
  if (!Array.isArray(value.tracks) || value.tracks.length < 1) throw new Error("Composição híbrida exige tracks.");
  const tracks = value.tracks.map(normalizeTrack);
  const baseTracks = tracks.filter((track) => track.kind === "video-base");
  if (baseTracks.length !== 1) throw new Error("Composição híbrida exige exatamente uma track video-base.");
  const ids = new Set();
  for (const track of tracks) {
    if (ids.has(track.id)) throw new Error(`Track híbrida duplicada: ${track.id}.`);
    ids.add(track.id);
  }
  const alphaTracks = tracks.filter((track) => track.kind === "video-alpha");
  const audioTracks = tracks.filter((track) => track.kind === "audio");
  const captionsTracks = tracks.filter((track) => track.kind === "captions");
  const audioMode = String(value.audio?.mode ?? "preserve-base");
  if (!AUDIO_MODES.has(audioMode)) throw new Error(`Modo de áudio híbrido inválido: ${audioMode}.`);
  if (audioMode === "replace-base" && audioTracks.length !== 1) throw new Error("replace-base exige exatamente uma track de áudio externa.");
  if (audioMode === "mix" && audioTracks.length < 1) throw new Error("mix exige ao menos uma track de áudio externa.");
  if (captionsTracks.length > 1) throw new Error("A composição aceita no máximo uma track de captions.");
  if (alphaTracks.some((track) => track.endFrameExclusive > durationFrames)) throw new Error("Overlay ultrapassa a duração da composição.");
  const body = {
    schema: HYBRID_COMPOSITION_SCHEMA,
    mode: requireStudioMode(value.mode ?? "studio", "Compositor híbrido"),
    fps,
    durationFrames,
    timelineFingerprint: text(value.timelineFingerprint, "timelineFingerprint"),
    tracks,
    audio: { mode: audioMode },
    captions: captionsTracks.length ? { trackId: captionsTracks[0].id } : null,
    cache: {
      strategy: "content-addressed",
      reuseApproved: value.cache?.reuseApproved === true,
    },
    metadata: structuredClone(value.metadata ?? {}),
  };
  return body;
}

export function createHybridCompositionManifest(value = {}) {
  const body = canonicalManifestBody(value);
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertHybridCompositionManifest(value) {
  const body = canonicalManifestBody(value);
  if (value?.schema !== HYBRID_COMPOSITION_SCHEMA) throw new Error("Manifest de composição híbrida inválido.");
  if (value?.fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint da composição híbrida divergente.");
  return true;
}

export function buildHybridCompositionPlan({ manifest, inputArtifacts = [], toolchain = {} } = {}) {
  assertHybridCompositionManifest(manifest);
  const artifactByFile = new Map(inputArtifacts.map((artifact) => [path.resolve(String(artifact?.file ?? "")), artifact]));
  const inputs = manifest.tracks.map((track) => ({
    id: track.id,
    kind: track.kind,
    file: track.file,
    artifactId: artifactByFile.get(track.file)?.id ?? null,
    hash: artifactByFile.get(track.file)?.hash?.value ?? null,
  }));
  if (inputs.some((entry) => !entry.artifactId)) throw new Error("Plano híbrido exige artefato hash-atestado para cada track.");
  const cacheKey = operationFingerprint({ manifestFingerprint: manifest.fingerprint, inputs: inputs.map(({ id, kind, artifactId, hash }) => ({ id, kind, artifactId, hash })), toolchain: structuredClone(toolchain ?? {}) });
  return {
    schema: HYBRID_COMPOSITION_PLAN_SCHEMA,
    manifestFingerprint: manifest.fingerprint,
    timelineFingerprint: manifest.timelineFingerprint,
    inputs,
    toolchain: structuredClone(toolchain ?? {}),
    cache: { strategy: "content-addressed", key: cacheKey, reuseApproved: manifest.cache.reuseApproved },
    execution: { provider: "ffmpeg", paid: false, mode: "studio", recovery: "atomic-temp-no-overwrite" },
    fingerprint: operationFingerprint({ manifestFingerprint: manifest.fingerprint, inputs, toolchain: structuredClone(toolchain ?? {}), cacheKey }),
  };
}

function buildFilterGraph(manifest, probes) {
  const base = manifest.tracks.find((track) => track.kind === "video-base");
  const overlays = manifest.tracks.filter((track) => track.kind === "video-alpha").sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const captions = manifest.tracks.find((track) => track.kind === "captions");
  const fps = manifest.fps;
  const duration = frameSeconds(manifest.durationFrames, fps);
  const filters = [`[0:v]setpts=PTS-STARTPTS[base0]`];
  let current = "base0";
  for (let index = 0; index < overlays.length; index += 1) {
    const track = overlays[index];
    const inputIndex = manifest.tracks.indexOf(track);
    const start = frameSeconds(track.startFrame, fps);
    const end = frameSeconds(track.endFrameExclusive, fps);
    const label = `alpha${index}`;
    const out = `comp${index}`;
    if (!probes[inputIndex]?.video) throw new Error(`Overlay sem stream de vídeo: ${track.id}.`);
    filters.push(`[${inputIndex}:v]format=rgba,setpts=PTS-STARTPTS+${start}/TB[${label}]`);
    filters.push(`[${current}][${label}]overlay=x=${Math.round(track.position.x)}:y=${Math.round(track.position.y)}:eof_action=pass:repeatlast=0:format=auto:enable=between(t\\,${start}\\,${end})[${out}]`);
    current = out;
  }
  if (captions) {
    const escaped = escapeFilterPath(captions.file);
    const out = "captioned";
    filters.push(`[${current}]subtitles='${escaped}'[${out}]`);
    current = out;
  }
  filters.push(`[${current}]trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p[vout]`);
  return { graph: filters.join(";"), outputLabel: "vout", duration };
}

function buildAudioFilter(manifest) {
  const audioTracks = manifest.tracks.filter((track) => track.kind === "audio");
  if (manifest.audio.mode === "preserve-base") return null;
  const baseIndex = manifest.tracks.findIndex((track) => track.kind === "video-base");
  if (manifest.audio.mode === "replace-base") return { graph: `[${manifest.tracks.indexOf(audioTracks[0])}:a]aresample=async=1:first_pts=0,atrim=duration=${frameSeconds(manifest.durationFrames, manifest.fps)}[aout]`, outputLabel: "aout" };
  const inputs = [`[${baseIndex}:a]`];
  for (let index = 0; index < audioTracks.length; index += 1) inputs.push(`[${manifest.tracks.indexOf(audioTracks[index])}:a]`);
  return { graph: `${inputs.join("")}amix=inputs=${inputs.length}:duration=first:dropout_transition=0,atrim=duration=${frameSeconds(manifest.durationFrames, manifest.fps)}[aout]`, outputLabel: "aout" };
}

export async function composeHybridVideo({ manifest, outputFile, receiptFile = `${outputFile}.receipt.json`, parentReceipts = [], metadata = {}, toolchain = {} } = {}) {
  assertHybridCompositionManifest(manifest);
  const target = path.resolve(text(outputFile, "outputFile"));
  const tracks = manifest.tracks;
  await Promise.all(tracks.map((track) => access(track.file)));
  if (tracks.some((track) => path.resolve(track.file) === target)) throw new Error("A saída híbrida não pode sobrescrever uma track de entrada.");
  const artifacts = await Promise.all(tracks.map((track) => createArtifactFromFile({ file: track.file, kind: track.kind === "captions" ? "text" : track.kind === "audio" ? "audio" : "video", role: track.kind })));
  const probes = await Promise.all(tracks.map((track) => track.kind === "captions" ? null : probeMedia(track.file)));
  const baseIndex = tracks.findIndex((track) => track.kind === "video-base");
  if (!probes[baseIndex]?.video) throw new Error("A track video-base precisa conter vídeo.");
  const videoPlan = buildFilterGraph(manifest, probes);
  const audioPlan = buildAudioFilter(manifest);
  const graph = [videoPlan.graph, ...(audioPlan ? [audioPlan.graph] : [])].join(";");
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const args = ["-y"];
  for (const track of tracks) args.push("-i", track.file);
  args.push("-filter_complex", graph, "-map", `[${videoPlan.outputLabel}]`);
  if (audioPlan) args.push("-map", `[${audioPlan.outputLabel}]`, "-c:a", "aac", "-b:a", "192k");
  else args.push("-map", `${baseIndex}:a?`);
  args.push("-t", videoPlan.duration, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", temporary);
  const startedAt = new Date();
  try {
    await runFfmpeg(args);
    await commitTemporaryFile(temporary, target, { label: "Master híbrido" });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const [outputArtifact, outputProbe] = await Promise.all([
    createArtifactFromFile({ file: target, kind: "video", role: "hybrid-master", source: { provider: "ffmpeg" } }),
    probeMedia(target),
  ]);
  const plan = buildHybridCompositionPlan({ manifest, inputArtifacts: artifacts, toolchain });
  const receipt = createStageReceipt({
    operation: "compose-hybrid-video",
    provider: "ffmpeg",
    mode: "studio",
    stage: "hybrid-composite",
    parameters: { schema: HYBRID_COMPOSITION_SCHEMA, manifestFingerprint: manifest.fingerprint, planFingerprint: plan.fingerprint, timelineFingerprint: manifest.timelineFingerprint, audioMode: manifest.audio.mode },
    inputs: artifacts,
    artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), plan, outputProbe, assetsPreserved: true, cacheKey: plan.cache.key, recovery: "atomic-temp-no-overwrite" },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, plan, probe: outputProbe };
}

/**
 * Local, unpaid adapter projection for the existing compositor. It deliberately
 * delegates to composeHybridVideo and does not create another executor.
 */
export function createHybridCompositorAdapter() {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: "ffmpeg-hybrid-compositor",
    providerId: "ffmpeg-local",
    kind: "video",
    operations: ["hybrid-compose"],
    authMode: "none",
    authContract: "local-process",
    paidOperations: [],
    reconcileOperations: [],
    resultKinds: ["video"],
    estimate: async () => ({ paidCalls: 0, localOperations: 1, provider: "ffmpeg" }),
    execute: async ({ request } = {}) => {
      const result = await composeHybridVideo(request);
      return {
        status: "ready",
        artifacts: result.receipt.artifacts,
        receipt: result.receipt,
        file: result.file,
        metadata: { probe: result.probe, planFingerprint: result.plan.fingerprint },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
