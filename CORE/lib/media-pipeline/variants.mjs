import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";

export const VARIANT_SCHEMA = "mkt-videos/variant@1";
export const VARIANT_FORMATS = Object.freeze({
  "16:9": Object.freeze({ width: 1920, height: 1080 }),
  "9:16": Object.freeze({ width: 1080, height: 1920 }),
  "1:1": Object.freeze({ width: 1080, height: 1080 }),
});

export function buildReframeFilter(format, { strategy = "fit-pad", background = "black" } = {}) {
  const target = VARIANT_FORMATS[format];
  if (!target) throw new Error(`Formato de variante inválido: ${format}.`);
  if (strategy === "fit-pad") return `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1,format=yuv420p`;
  if (strategy === "center-crop") return `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${target.width}:${target.height},setsar=1,format=yuv420p`;
  throw new Error(`Estratégia de reframe inválida: ${strategy}.`);
}

export async function createVideoVariant({ inputFile, outputFile, format, strategy = "fit-pad", cropApproved = false, timelineFingerprint, receiptFile = `${outputFile}.receipt.json`, parentReceipts = [] } = {}) {
  if (!String(timelineFingerprint ?? "").trim()) throw new Error("Variante exige timelineFingerprint bloqueado.");
  if (format === "1:1" && !cropApproved) throw new Error("Reframe Studio 1:1 exige aprovação explícita.");
  if (strategy === "center-crop" && !cropApproved) throw new Error("center-crop exige aprovação explícita.");
  const source = path.resolve(String(inputFile));
  const target = path.resolve(String(outputFile));
  await access(source);
  const before = await probeMedia(source);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const filter = buildReframeFilter(format, { strategy });
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", "-i", source, "-vf", filter, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", temporary]);
    await commitTemporaryFile(temporary, target, { label: "Variante de vídeo" });
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  const after = await probeMedia(target);
  const durationDelta = Math.abs(Number(after.duration) - Number(before.duration));
  if (!Number.isFinite(durationDelta) || durationDelta > 0.05) throw new Error(`Variante divergiu da timeline em ${durationDelta}s.`);
  const [inputArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "variant-source" }),
    createArtifactFromFile({ file: target, kind: "video", role: `variant-${format}`, source: { provider: "ffmpeg" } }),
  ]);
  const receipt = createStageReceipt({ operation: "create-video-variant", provider: "ffmpeg", stage: "variant", parameters: { schema: VARIANT_SCHEMA, format, strategy, cropApproved, timelineFingerprint, filter }, inputs: [inputArtifact], artifacts: [outputArtifact], metadata: { before, after, durationDelta, contentPolicy: strategy === "fit-pad" ? "full-frame-preserved" : "human-approved-crop" }, parentReceipts, startedAt, completedAt: new Date() });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, before, after };
}
