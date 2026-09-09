import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { probeTiming } from "./audio-first.mjs";
import { createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";
import { commitOrVerifyLocalFile, readMatchingLocalReceipt } from "./local-publication-recovery.mjs";
import { RECIPE_POST_OPERATIONS } from "./recipe-registries.mjs";

export function validatePostProduction(value, expectedFrames) {
  if (value == null) return [];
  if (value.module !== "ffmpeg-post@1" || !Array.isArray(value.operations) || value.operations.length > 100 || Object.keys(value).some(key => !["module", "operations"].includes(key))) throw new Error("Pós-produção exige ffmpeg-post@1 e lista de operações.");
  const ids = new Set();
  for (const op of value.operations) {
    if (!op || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(op.id ?? "") || ids.has(op.id) || !Object.hasOwn(RECIPE_POST_OPERATIONS, op.operation) || Object.keys(op).some(key => !["id", "operation", "assetId", "durationFrames"].includes(key))) throw new Error("Operação de pós-produção desconhecida, duplicada ou inválida.");
    ids.add(op.id);
    if (op.operation === "ending-hold@1") {
      if (!Number.isSafeInteger(op.durationFrames) || op.durationFrames < 1 || !Number.isSafeInteger(expectedFrames) || op.durationFrames > expectedFrames || op.assetId != null) throw new Error("ending-hold exige duração positiva dentro da timeline e não aceita asset.");
    } else if (op.durationFrames != null) throw new Error("durationFrames pertence apenas a ending-hold.");
    if (op.operation === "logo-overlay@1" ? !String(op.assetId ?? "").trim() : op.assetId != null) throw new Error("assetId pertence somente a logo-overlay e é obrigatório nesse caso.");
  }
  return structuredClone(value.operations);
}

export async function applyFilmPostOperation({ inputFile, outputFile, receiptFile = `${outputFile}.receipt.json`, operation,
  expectedFrames, fps, logoFile = null, authorize = async () => null, parentReceipts = [], metadata = {}, recoverExisting = false }) {
  [operation] = validatePostProduction({ module: "ffmpeg-post@1", operations: [operation] }, expectedFrames);
  if (!Number.isSafeInteger(expectedFrames) || expectedFrames < 1 || !Number.isFinite(fps) || fps <= 0) throw new Error("Pós-produção exige frames e fps congelados.");
  if (operation.operation === "logo-overlay@1" && !logoFile) throw new Error("Logo exige arquivo governado autorizado.");
  if (operation.operation !== "logo-overlay@1" && logoFile) throw new Error("Arquivo de logo pertence somente a logo-overlay.");
  const source = path.resolve(inputFile), target = path.resolve(outputFile);
  const inputs = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "post-source" }),
    ...(logoFile ? [createArtifactFromFile({ file: path.resolve(logoFile), kind: "image", role: "post-logo" })] : []),
  ]);
  const before = await probeMedia(source);
  const sourceTiming = await probeTiming({ mediaFile: source, expectedFrames });
  const [fpsNumerator, fpsDenominator = "1"] = String(before.video?.r_frame_rate ?? "0").split("/");
  const measuredFps = Number(fpsNumerator) / Number(fpsDenominator);
  if (!before.video || !Number.isFinite(measuredFps) || Math.abs(measuredFps - fps) > 0.000001 || Math.abs(before.duration - expectedFrames / fps) > 0.05 || sourceTiming.status !== "pass" || Number(sourceTiming.streams.find(stream => stream.codec_type === "video")?.decodedFrames) !== expectedFrames) throw new Error("Entrada de pós-produção diverge dos frames, fps ou duração congelados.");
  const assertInputs = async () => {
    const evidence = await authorize();
    if (logoFile && !evidence?.itemHash) throw new Error("Logo exige evidência vigente de autorização.");
    for (const input of inputs) if (!(await verifyArtifact(input)).valid) throw new Error("Entrada de pós-produção mudou durante o uso.");
    return evidence;
  };
  let filter, layout = null, assumption = null;
  if (operation.operation === "ending-hold@1") {
    // O trecho final já pertence à timeline; segura seu primeiro frame sem acrescentar duração.
    filter = `[0:v]trim=end_frame=${expectedFrames - operation.durationFrames + 1},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${operation.durationFrames - 1},format=yuv420p[out]`;
  } else if (operation.operation === "logo-overlay@1") {
    const width = Number(before.video.width), height = Number(before.video.height);
    layout = { maxWidth: Math.max(2, Math.floor(width * 0.2)), maxHeight: Math.max(2, Math.floor(height * 0.15)), right: Math.round(width * 0.05), bottom: Math.round(height * 0.05) };
    filter = `[1:v]scale=${layout.maxWidth}:${layout.maxHeight}:force_original_aspect_ratio=decrease,format=rgba[logo];[0:v][logo]overlay=x=W-w-${layout.right}:y=H-h-${layout.bottom}:shortest=1:format=auto,format=yuv420p[out]`;
  } else {
    const allowed = [null, undefined, "unknown", "unspecified", "bt709"];
    if (!allowed.includes(before.video.color_transfer) || !allowed.includes(before.video.color_primaries)) throw new Error("color-normalize@1 aceita SDR BT.709; outra transferência/primárias exige conversão explícita.");
    assumption = { unspecifiedPrimaries: !before.video.color_primaries || ["unknown", "unspecified"].includes(before.video.color_primaries), interpretation: "sdr-bt709" };
    filter = "[0:v]scale=in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[out]";
  }
  const parameters = { consumer: { id: "film-post-production", version: "film-post-production@1.0.0" }, operation, expectedFrames, fps, filter, layout, assumption, audio: "stream-copy" };
  await assertInputs();
  if (recoverExisting) {
    const receipt = await readMatchingLocalReceipt({ file: receiptFile, operation: "film-post-production", inputFiles: inputs.map(input => input.file), outputFile: target, parameters, parentReceipts });
    if (receipt) {
      await assertInputs();
      return { file: target, receiptFile: path.resolve(receiptFile), receipt, timing: receipt.metadata.timing, probe: receipt.metadata.after };
    }
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp.mp4`);
  const startedAt = new Date();
  let timing, probe, authorization;
  try {
    await runFfmpeg(["-y", "-protocol_whitelist", "file,pipe", "-i", source, ...(logoFile ? ["-protocol_whitelist", "file,pipe", "-loop", "1", "-i", path.resolve(logoFile)] : []),
      "-filter_complex", filter, "-map", "[out]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "copy", "-movflags", "+faststart", temporary]);
    probe = await probeMedia(temporary);
    timing = await probeTiming({ mediaFile: temporary, expectedFrames });
    if (!probe.video || Number(timing.streams.find(stream => stream.codec_type === "video")?.decodedFrames) !== expectedFrames || timing.status !== "pass" || Boolean(probe.audio) !== Boolean(before.audio) || Math.abs(probe.duration - before.duration) > 0.05) throw new Error("Pós-produção alterou frames, duração ou presença do áudio.");
    authorization = await assertInputs();
    await commitOrVerifyLocalFile(temporary, target, { label: "Pós-produção", recoverExisting });
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  const artifact = await createArtifactFromFile({ file: target, kind: "video", role: "post-master" });
  const receipt = createStageReceipt({ operation: "film-post-production", provider: "ffmpeg", mode: "studio", stage: "post-production",
    parameters,
    inputs, artifacts: [artifact], metadata: { ...metadata, ...(authorization ? { authorization } : {}), before, after: probe, timing: { ...timing, mediaFile: target } },
    parentReceipts, startedAt, completedAt: new Date() });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, timing: { ...timing, mediaFile: target }, probe };
}
