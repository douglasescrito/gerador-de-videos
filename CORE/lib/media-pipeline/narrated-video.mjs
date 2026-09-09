import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { assertPathAvailable } from "./pipeline-operation.mjs";
import { commitOrVerifyLocalFile } from "./local-publication-recovery.mjs";

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} inválido.`);
  return number;
}

function cleanWord(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function readWordTimeline(file) {
  await access(file);
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`--word-timestamps não contém JSON válido: ${error.message}`);
  }
  const raw = Array.isArray(payload) ? payload : payload?.words ?? payload?.palavras ?? payload?.segments?.flatMap((segment) => segment.words ?? []);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("--word-timestamps precisa conter palavras com start e end.");
  const words = raw.map((item, index) => {
    const word = cleanWord(item?.word);
    if (!word) throw new Error(`Palavra ${index + 1} inválida no alinhamento.`);
    const start = finite(item?.start, `Início da palavra ${index + 1}`);
    const end = finite(item?.end, `Fim da palavra ${index + 1}`);
    if (end < start) throw new Error(`Fim anterior ao início na palavra ${index + 1}.`);
    return { word, start, end, ...(Number.isFinite(Number(item?.probability)) ? { probability: Number(item.probability) } : {}) };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  return words;
}

export async function applyNarrationScript(words, file) {
  const text = await readFile(file, "utf8");
  const sourceWords = text.match(/[^\s]+/g)?.map(cleanWord).filter(Boolean) ?? [];
  if (sourceWords.length !== words.length) throw new Error(`--narration-script-file tem ${sourceWords.length} palavras; o alinhamento tem ${words.length}.`);
  return words.map((word, index) => ({ ...word, word: sourceWords[index] }));
}

export function buildNarrationTimingGuide(words, { maxSegments = 12 } = {}) {
  if (!Array.isArray(words) || words.length === 0) throw new Error("Não há palavras para montar o guia de narração.");
  const segments = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const text = current.map((item) => item.word).join(" ");
    const ending = /[.!?…]$/.test(word.word);
    if (ending || current.length >= 18) {
      segments.push({ start: current[0].start, end: current.at(-1).end, text });
      current = [];
    }
  }
  if (current.length) segments.push({ start: current[0].start, end: current.at(-1).end, text: current.map((item) => item.word).join(" ") });
  const selected = segments.slice(0, maxSegments);
  return selected.map((segment) => `[${segment.start.toFixed(2)}s–${segment.end.toFixed(2)}s] ${segment.text}`).join("\n");
}

export function withNarrationTimingGuide(prompt, guide, { renderWords = false } = {}) {
  const instruction = renderWords
    ? "Render each listed Portuguese word exactly as written, on screen, only during its precise interval. Make the words a native part of the motion design with elegant transitions. Do not replace, omit, translate, or invent any listed word."
    : "Use it to pace visual changes; do not add subtitles, captions, or on-screen text unless the direction explicitly asks for them.";
  return `${prompt}\n\nNarration timing reference (${instruction}):\n${guide}`;
}

export async function mediaDuration(file) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => status === 0 ? resolve(stdout) : reject(new Error(`ffprobe falhou (${status}): ${stderr.trim()}`)));
  });
  const duration = Number(JSON.parse(output)?.format?.duration);
  return finite(duration, "Duração de mídia");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => status === 0 ? resolve() : reject(new Error(`ffmpeg falhou (${status}): ${stderr.trim()}`)));
  });
}

export async function replaceVideoAudio({ videoFile, audioFile, outputFile, fit = "error", recoverExisting = false }) {
  if (!new Set(["error", "loop"]).has(fit)) throw new Error("--video-fit aceita error ou loop.");
  await Promise.all([access(videoFile), access(audioFile)]);
  const [videoDuration, audioDuration] = await Promise.all([mediaDuration(videoFile), mediaDuration(audioFile)]);
  if (fit === "error" && videoDuration + 0.05 < audioDuration) {
    throw new Error(`A narração (${audioDuration.toFixed(2)}s) é maior que o vídeo Omni (${videoDuration.toFixed(2)}s). Use --video-fit loop para repetir o vídeo sem cortar a narração.`);
  }
  const input = fit === "loop" ? ["-stream_loop", "-1", "-i", videoFile] : ["-i", videoFile];
  // `-shortest` alone can retain a buffered tail when the visual input is looped.
  // The measured narration duration is the delivery contract, so cap the mux explicitly.
  const target = recoverExisting ? path.resolve(outputFile) : await assertPathAvailable(outputFile, "Vídeo narrado");
  const parsed = path.parse(target);
  const temporary = path.join(parsed.dir, `.${parsed.name}.${process.pid}.${randomUUID()}.tmp${parsed.ext || ".mp4"}`);
  try {
    await runFfmpeg([...input, "-i", audioFile, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-t", audioDuration.toFixed(6), "-movflags", "+faststart", temporary]);
    await commitOrVerifyLocalFile(temporary, target, { label: "Vídeo narrado", recoverExisting });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { videoDuration, audioDuration, outputDuration: await mediaDuration(target), fit };
}
