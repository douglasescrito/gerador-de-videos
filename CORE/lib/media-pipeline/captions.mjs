import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, writeFileAtomic, writeStageReceipt } from "./pipeline-operation.mjs";

export const CAPTION_STYLE_SCHEMA = "mkt-videos/caption-style@1";
export const CAPTION_STYLES = Object.freeze({
  "kinetic-word@1": Object.freeze({
    schema: CAPTION_STYLE_SCHEMA,
    id: "kinetic-word@1",
    fontName: "Arial",
    fontSize: 92,
    primaryColour: "&H00FFFFFF",
    outlineColour: "&H00120B32",
    backColour: "&H96000000",
    palette: Object.freeze(["&H00FFB347", "&H00FF78C4", "&H00F7F7F7", "&H00B4A7FF"]),
    positions: Object.freeze([[0.5, 0.5], [0.5, 0.653], [0.398, 0.528], [0.602, 0.486], [0.5, 0.403]]),
    outline: 6,
    shadow: 4,
    normalScale: 116,
    emphasisScale: 132,
    safeAreas: Object.freeze({ "16:9": Object.freeze({ left: 0.08, right: 0.08, top: 0.08, bottom: 0.1 }), "9:16": Object.freeze({ left: 0.1, right: 0.1, top: 0.12, bottom: 0.18 }) }),
  }),
});

export function resolveCaptionStyle(value = "kinetic-word@1") {
  const style = typeof value === "string" ? CAPTION_STYLES[value] : value;
  if (!style || style.schema !== CAPTION_STYLE_SCHEMA || !style.id) throw new Error(`Caption style inválido: ${typeof value === "string" ? value : "objeto"}.`);
  return structuredClone(style);
}

function assTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor((total % 360000) / 6000);
  const wholeSeconds = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function assText(value) {
  return String(value ?? "").trim().replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, " ");
}

export function captionWords(payload) {
  const words = Array.isArray(payload) ? payload : payload?.words ?? payload?.segments?.flatMap((segment) => segment.words ?? []);
  if (!Array.isArray(words) || !words.length) throw new Error("O JSON não contém palavras com tempos.");
  return words.map((word, index) => {
    const start = Number(word.start);
    const end = Number(word.end);
    const text = assText(word.word);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`Palavra ${index + 1} inválida.`);
    return { start, end: end > start ? end : start + 0.01, text, emphasis: Boolean(word.emphasis) };
  });
}

async function applySourceScript(words, file) {
  if (!file) return words;
  const text = await readFile(file, "utf8");
  const sourceWords = text.match(/[^\s]+/g)?.map(assText).filter(Boolean) ?? [];
  if (sourceWords.length !== words.length) throw new Error(`O texto-base tem ${sourceWords.length} palavras, mas o alinhamento tem ${words.length}.`);
  return words.map((word, index) => ({ ...word, text: sourceWords[index] }));
}

export function captionAssDocument(words, { style = "kinetic-word@1", aspect = "16:9" } = {}) {
  const resolved = resolveCaptionStyle(style);
  const initialScale = resolved.initialScale ?? 72;
  const fadeInMs = resolved.fadeInMs ?? 55;
  const fadeOutMs = resolved.fadeOutMs ?? 85;
  if (!Number.isFinite(initialScale) || initialScale <= 0 || initialScale > 200
    || ![fadeInMs, fadeOutMs].every(value => Number.isFinite(value) && value >= 0 && value <= 1000)) throw new Error("Movimento de captions inválido.");
  const [playResX, playResY] = aspect === "9:16" ? [720, 1280] : aspect === "16:9" ? [1280, 720] : (() => { throw new Error(`Aspecto de captions inválido: ${aspect}.`); })();
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${playResX}\nPlayResY: ${playResY}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Word,${resolved.fontName},${resolved.fontSize},${resolved.primaryColour},${resolved.primaryColour},${resolved.outlineColour},${resolved.backColour},1,0,0,0,100,100,0,0,1,${resolved.outline},${resolved.shadow},5,80,80,72,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = words.map((word, index) => {
    const [relativeX, relativeY] = resolved.positions[index % resolved.positions.length];
    const safe = resolved.safeAreas?.[aspect];
    if (safe && (relativeX < safe.left || relativeX > 1 - safe.right || relativeY < safe.top || relativeY > 1 - safe.bottom)) throw new Error(`Caption style ${resolved.id} posiciona palavra fora da safe area ${aspect}.`);
    const [x, y] = [Math.round(relativeX * playResX), Math.round(relativeY * playResY)];
    const color = resolved.palette[index % resolved.palette.length];
    const scale = word.emphasis ? resolved.emphasisScale : resolved.normalScale;
    return `Dialogue: 0,${assTime(word.start)},${assTime(word.end)},Word,,0,0,0,,{\\an5\\pos(${x},${y})\\fad(${fadeInMs},${fadeOutMs})\\1c${color}\\3c${resolved.outlineColour}\\bord${resolved.outline}\\shad${resolved.shadow}\\fscx${initialScale}\\fscy${initialScale}\\t(0,120,\\fscx${scale}\\fscy${scale})\\t(120,220,\\fscx100\\fscy100)}${word.text}`;
  });
  return `${header}${events.join("\n")}\n`;
}

function sidecarTime(seconds, separator) {
  const total = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((total % 60_000) / 1000);
  const milliseconds = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}${separator}${String(milliseconds).padStart(3, "0")}`;
}

export function captionSrtDocument(words) {
  return `${words.map((word, index) => `${index + 1}\n${sidecarTime(word.start, ",")} --> ${sidecarTime(word.end, ",")}\n${word.text}`).join("\n\n")}\n`;
}

export function captionVttDocument(words) {
  return `WEBVTT\n\n${words.map((word) => `${sidecarTime(word.start, ".")} --> ${sidecarTime(word.end, ".")}\n${word.text}`).join("\n\n")}\n`;
}

export async function renderWordCaptions({
  videoFile,
  wordsFile,
  scriptFile = null,
  outputFile,
  assFile = `${outputFile}.words.ass`,
  receiptFile = `${outputFile}.receipt.json`,
  parentReceipts = [],
  style = "kinetic-word@1",
  aspect = "16:9",
  sidecars = [],
  metadata = {},
} = {}) {
  const video = path.resolve(String(videoFile));
  const wordsPath = path.resolve(String(wordsFile));
  await Promise.all([access(video), access(wordsPath), ...(scriptFile ? [access(path.resolve(scriptFile))] : [])]);
  const words = await applySourceScript(captionWords(JSON.parse(await readFile(wordsPath, "utf8"))), scriptFile ? path.resolve(scriptFile) : null);
  const resolvedStyle = resolveCaptionStyle(style);
  await writeFileAtomic(assFile, captionAssDocument(words, { style: resolvedStyle, aspect }), { label: "Legenda ASS", encoding: "utf8" });
  const sidecarFiles = [];
  for (const format of [...new Set(sidecars.map((value) => String(value).toLowerCase()))]) {
    if (!new Set(["srt", "vtt"]).has(format)) throw new Error(`Sidecar de captions inválido: ${format}.`);
    const file = `${outputFile}.${format}`;
    await writeFileAtomic(file, format === "srt" ? captionSrtDocument(words) : captionVttDocument(words), { label: `Legenda ${format.toUpperCase()}`, encoding: "utf8" });
    sidecarFiles.push(path.resolve(file));
  }
  const target = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const assFilterPath = path.resolve(assFile).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", "-i", video, "-vf", `subtitles='${assFilterPath}'`, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "copy", "-movflags", "+faststart", temporary]);
    await commitTemporaryFile(temporary, target, { label: "Vídeo legendado" });
  } catch (error) {
    await Promise.all([rm(temporary, { force: true }), rm(path.resolve(assFile), { force: true }), ...sidecarFiles.map((file) => rm(file, { force: true }))]);
    throw error;
  }
  const [videoArtifact, wordsArtifact, assArtifact, outputArtifact, ...sidecarArtifacts] = await Promise.all([
    createArtifactFromFile({ file: video, kind: "video", role: "caption-source" }),
    createArtifactFromFile({ file: wordsPath, kind: "data", role: "word-timestamps" }),
    createArtifactFromFile({ file: assFile, kind: "text", role: "subtitle-ass" }),
    createArtifactFromFile({ file: target, kind: "video", role: "captioned-video", source: { provider: "ffmpeg" } }),
    ...sidecarFiles.map((file) => createArtifactFromFile({ file, kind: "text", role: `subtitle-${path.extname(file).slice(1)}` })),
  ]);
  const receipt = createStageReceipt({
    operation: "render-word-captions",
    provider: "ffmpeg-libass",
    mode: "studio",
    stage: "captions",
    parameters: { wordCount: words.length, scriptFile: scriptFile ? path.resolve(scriptFile) : null, captionStyle: resolvedStyle.id, captionStyleSchema: resolvedStyle.schema, aspect, sidecars: sidecarFiles.map((file) => path.extname(file).slice(1)) },
    inputs: [videoArtifact, wordsArtifact],
    artifacts: [assArtifact, outputArtifact, ...sidecarArtifacts],
    metadata: structuredClone(metadata ?? {}),
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, assFile: path.resolve(assFile), sidecarFiles, receiptFile: path.resolve(receiptFile), receipt, wordCount: words.length };
}
