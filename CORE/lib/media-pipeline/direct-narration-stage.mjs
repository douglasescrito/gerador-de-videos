import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { assertPathAvailable, createStageReceipt, operationFingerprint, pathExists, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { readMatchingLocalReceipt } from "./local-publication-recovery.mjs";
import { replaceVideoAudio } from "./narrated-video.mjs";

export async function materializeDirectNarration({ plan, narration, source, fit = "error", renderWords = false, recoverExisting = false, operations = {} }) {
  const muxVideo = operations.replaceVideoAudio ?? replaceVideoAudio;
  const writeReceipt = operations.writeStageReceipt ?? writeStageReceipt;
  const writeMetadata = operations.writeJsonAtomic ?? writeJsonAtomic;
  const parents = source.receipt?.id ? [source.receipt.id] : [];
  const parameters = { fit, renderWords, wordCount: narration.words.length };
  const fields = {
    schema: "mkt-videos/narrated-video@1", originalVideo: source.file, narratedVideo: plan.file,
    narrationAudio: narration.audioFile, wordTimestamps: narration.wordsFile, narrationScript: narration.scriptFile ?? null,
    renderWords, words: narration.words.length, timingGuide: narration.timingGuide,
  };
  const inputFiles = [source.file, narration.audioFile, narration.wordsFile];
  async function publishMetadata(record) {
    if (recoverExisting && await pathExists(plan.metadata)) {
      const existing = JSON.parse(await readFile(plan.metadata, "utf8"));
      if (operationFingerprint(existing) !== operationFingerprint(record)) throw new Error("Metadados da narração divergem da etapa retomada.");
    } else await writeMetadata(plan.metadata, record, { label: "Metadados de narração" });
  }
  await mkdir(path.dirname(plan.file), { recursive: true });
  if (recoverExisting) {
    const receipt = await readMatchingLocalReceipt({ file: plan.receipt, operation: "replace-video-audio", inputFiles, outputFile: plan.file, parameters, parentReceipts: parents });
    if (receipt) {
      const { pipeline: _pipeline, ...record } = receipt.metadata;
      if (Object.entries(fields).some(([key, value]) => !Object.hasOwn(record, key) || operationFingerprint(record[key]) !== operationFingerprint(value))) throw new Error("Recibo da narração diverge das entradas e do texto retomados.");
      await publishMetadata(record);
      return { file: plan.file, receipt: plan.receipt, metadata: plan.metadata, ...record.mux };
    }
  } else await Promise.all([plan.file, plan.receipt, plan.metadata].map((file) => assertPathAvailable(file)));
  const startedAt = new Date();
  const mux = await muxVideo({ videoFile: source.file, audioFile: narration.audioFile, outputFile: plan.file, fit, recoverExisting });
  const record = { ...fields, createdAt: new Date().toISOString(), mux };
  // O fluxo antigo publicava os dois JSON em paralelo. Se apenas o sidecar
  // sobreviveu, conserva sua data após comparar todos os demais campos.
  if (recoverExisting && await pathExists(plan.metadata)) {
    const existing = JSON.parse(await readFile(plan.metadata, "utf8"));
    if (!Number.isFinite(Date.parse(existing.createdAt))) throw new Error("Data dos metadados da narração inválida.");
    record.createdAt = existing.createdAt;
    if (operationFingerprint(record) !== operationFingerprint(existing)) throw new Error("Metadados da narração divergem da operação local refeita.");
  }
  const roles = ["source-video", "narration-audio", "word-timestamps"];
  const inputs = await Promise.all(inputFiles.map((file, index) => createArtifactFromFile({ file, kind: ["video", "audio", "data"][index], role: roles[index] })));
  const artifact = await createArtifactFromFile({ file: plan.file, kind: "video", role: "narrated-video", source: { provider: "ffmpeg" } });
  const receipt = createStageReceipt({ operation: "replace-video-audio", provider: "ffmpeg", mode: "studio", stage: "audio-mux", parameters, inputs, artifacts: [artifact], metadata: record, parentReceipts: parents, startedAt, completedAt: new Date() });
  await writeReceipt(plan.receipt, receipt);
  await publishMetadata(record);
  return { file: plan.file, receipt: plan.receipt, metadata: plan.metadata, ...mux };
}
