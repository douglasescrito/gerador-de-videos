import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, writeFileAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { recipeFromReceipt } from "./recipe.mjs";

export const MOTION_GRAPHICS_SCHEMA = "mkt-videos/motion-graphics@1";
const CONSUMER = Object.freeze({ id: "render-motion-graphics", version: "motion-graphics@1.2.0" });

function motionParameters({ cards, aspect = "16:9", preserveAudio = true, timelineFingerprint = null, brandKitHash = null }) {
  return { schema: MOTION_GRAPHICS_SCHEMA, consumer: CONSUMER, textEncoding: "libass-literal@1", aspect, preserveAudio, timelineFingerprint, brandKitHash, safeArea: MOTION_SAFE_AREAS[aspect], cards };
}

export async function motionGraphicsRecipe(options) {
  const input = await createArtifactFromFile({ file: options.videoFile, kind: "video", role: "motion-source" });
  return recipeFromReceipt(createStageReceipt({ operation: "render-motion-graphics", provider: "ffmpeg", stage: "motion-graphics", parameters: motionParameters(options), inputs: [input], metadata: options.metadata ?? {} }));
}
export const MOTION_SAFE_AREAS = Object.freeze({
  "16:9": Object.freeze({ left: 0.07, right: 0.07, top: 0.08, bottom: 0.1 }),
  "9:16": Object.freeze({ left: 0.09, right: 0.09, top: 0.12, bottom: 0.18 }),
  "1:1": Object.freeze({ left: 0.08, right: 0.08, top: 0.1, bottom: 0.12 }),
});

function assTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100));
  return `${Math.floor(total / 360000)}:${String(Math.floor((total % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((total % 6000) / 100)).padStart(2, "0")}.${String(total % 100).padStart(2, "0")}`;
}

function assText(value) {
  const text = String(value ?? "");
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error("Texto motion contém controle não renderizável; use espaços e quebras de linha reais.");
  // libass aceita \{ e \}, mas não tem escape para a própria barra.
  // WORD JOINER não desenha um glifo e impede que a barra forme \N/\n/\h.
  // O texto original permanece intacto nos cards do recibo.
  return text.replace(/\\|[{}]|\r\n|\r|\n/g, token => token === "\\" ? "\\\u2060" : token === "{" || token === "}" ? `\\${token}` : "\\N");
}

function dimensions(aspect) {
  return ({ "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] })[aspect] ?? (() => { throw new Error(`Aspecto motion inválido: ${aspect}.`); })();
}

function assColour(value) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value ?? ""));
  return match ? `&H00${match[3]}${match[2]}${match[1]}&` : null;
}

function assFontName(value) {
  const sanitized = String(value ?? "").replace(/[\\{}\r\n]/g, "").trim();
  return sanitized || null;
}

function motionOverrides(card, { width, height, marginL, marginV }) {
  const effect = String(card.effect ?? "fade");
  const positions = {
    "top-left": [marginL, Math.round(height * 0.09), 7],
    upper: [Math.round(width / 2), Math.round(height * 0.22), 5],
    center: [Math.round(width / 2), Math.round(height / 2), 5],
    lower: [Math.round(width / 2), Math.round(height * 0.74), 5],
  };
  const [x, y, alignment] = positions[card.position] ?? positions.lower;
  const tags = [`\\fad(${Number(card.fadeInMs ?? 120)},${Number(card.fadeOutMs ?? 120)})`];
  if (effect === "punch") tags.push(`\\an5\\pos(${x},${y})\\fscx70\\fscy70\\t(0,260,\\fscx108\\fscy108)\\t(260,420,\\fscx100\\fscy100)`);
  else if (effect === "impact") tags.push(`\\an${alignment}\\pos(${x},${y})\\fscx185\\fscy185\\blur6\\t(0,300,\\fscx96\\fscy96\\blur0)\\t(300,430,\\fscx100\\fscy100)`);
  else if (effect === "flow") tags.push(`\\an${alignment}\\move(${-Math.round(width * 0.22)},${y + Math.round(height * 0.05)},${x},${y},0,520)\\fscx112\\fscy112\\frz-4\\blur2\\t(0,520,\\fscx100\\fscy100\\frz0\\blur0)`);
  else if (effect === "rise") tags.push(`\\an5\\move(${x},${y + Math.round(height * 0.08)},${x},${y},0,420)\\fscx94\\fscy94\\t(0,420,\\fscx100\\fscy100)`);
  else if (effect === "slide-left") tags.push(`\\an5\\move(${width + Math.round(width * 0.3)},${y},${x},${y},0,460)`);
  else if (effect === "slide-right") tags.push(`\\an5\\move(${-Math.round(width * 0.3)},${y},${x},${y},0,460)`);
  else if (card.position) tags.push(`\\an${alignment}\\pos(${x},${y})`);
  const fontName = assFontName(card.fontName);
  if (fontName) tags.push(`\\fn${fontName}`);
  if (Number.isFinite(Number(card.fontSize))) tags.push(`\\fs${Math.round(Number(card.fontSize))}`);
  if (Number.isFinite(Number(card.tracking))) tags.push(`\\fsp${Number(card.tracking)}`);
  if (Number.isFinite(Number(card.outline))) tags.push(`\\bord${Math.max(0, Number(card.outline))}`);
  if (Number.isFinite(Number(card.shadow))) tags.push(`\\shad${Math.max(0, Number(card.shadow))}`);
  if (Number.isFinite(Number(card.blur))) tags.push(`\\blur${Math.max(0, Number(card.blur))}`);
  const colour = assColour(card.color);
  if (colour) tags.push(`\\c${colour}`);
  return tags.join("");
}

export function motionAssDocument(cards, { aspect = "16:9" } = {}) {
  const [width, height] = dimensions(aspect);
  const safe = MOTION_SAFE_AREAS[aspect];
  const marginL = Math.round(width * safe.left);
  const marginR = Math.round(width * safe.right);
  const marginV = Math.round(height * safe.bottom);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Motion,Arial,${Math.round(height * 0.06)},&H00FFFFFF,&H00FFFFFF,&H0020140A,&H70000000,1,0,0,0,100,100,0,0,1,4,2,2,${marginL},${marginR},${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = cards.map((card, index) => {
    const start = Number(card.start);
    const end = Number(card.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Card ${index + 1} exige start/end válidos.`);
    if (!String(card.text ?? "").trim()) throw new Error(`Card ${index + 1} exige texto exato.`);
    const overrides = motionOverrides(card, { width, height, marginL, marginV });
    return `Dialogue: ${Number(card.layer ?? 0)},${assTime(start)},${assTime(end)},Motion,,0,0,0,,{${overrides}}${assText(card.text)}`;
  });
  return `${header}${events.join("\n")}\n`;
}

export async function renderMotionGraphics({ videoFile, cards, outputFile, assFile = `${outputFile}.motion.ass`, receiptFile = `${outputFile}.receipt.json`, aspect = "16:9", preserveAudio = true, timelineFingerprint = null, brandKitHash = null, parentReceipts = [], metadata = {} } = {}) {
  if (!Array.isArray(cards) || !cards.length) throw new Error("Motion graphics exige cards.");
  const source = path.resolve(String(videoFile));
  const target = path.resolve(String(outputFile));
  const assTarget = path.resolve(String(assFile));
  await access(source);
  const inputArtifact = await createArtifactFromFile({ file: source, kind: "video", role: "motion-source" });
  await writeFileAtomic(assTarget, motionAssDocument(cards, { aspect }), { label: "Camada motion ASS", encoding: "utf8" });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const escapedAss = assTarget.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const startedAt = new Date();
  try {
    const args = ["-y", "-i", source, "-vf", `subtitles='${escapedAss}'`, "-map", "0:v:0"];
    if (preserveAudio) args.push("-map", "0:a?");
    args.push("-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", ...(preserveAudio ? ["-c:a", "copy"] : ["-an"]), "-movflags", "+faststart", temporary);
    await runFfmpeg(args);
    if (!(await verifyArtifact(inputArtifact)).valid) throw new Error("Entrada do grafismo mudou durante o uso.");
    await commitTemporaryFile(temporary, target, { label: "Vídeo com motion graphics" });
  } catch (error) {
    await Promise.all([rm(temporary, { force: true }), rm(assTarget, { force: true })]);
    throw error;
  }
  const [assArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: assTarget, kind: "text", role: "motion-layer" }),
    createArtifactFromFile({ file: target, kind: "video", role: "motion-master", source: { provider: "ffmpeg" } }),
  ]);
  const after = await probeMedia(target);
  const receipt = createStageReceipt({ operation: "render-motion-graphics", provider: "ffmpeg", stage: "motion-graphics", parameters: motionParameters({ cards, aspect, preserveAudio, timelineFingerprint, brandKitHash }), inputs: [inputArtifact], artifacts: [assArtifact, outputArtifact], metadata: { ...structuredClone(metadata ?? {}), after, exactText: true, deterministicLayer: true }, parentReceipts, startedAt, completedAt: new Date() });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, assFile: assTarget, receiptFile: path.resolve(receiptFile), receipt, probe: after };
}
