import { randomUUID } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { assertDeliveryIntegrity, compareDeliveryProbes, evaluateEncoderPromotion, probeVideoEncoders, resolveVideoEncoder } from "./encoder-capabilities.mjs";
import { createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";
import { commitOrVerifyLocalFile, readMatchingLocalReceipt } from "./local-publication-recovery.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { recipeFromReceipt } from "./recipe.mjs";

export const DELIVERY_PROFILE_SCHEMA = "mkt-videos/delivery-profile@1";
const DELIVERY_CONSUMER = Object.freeze({ id: "finish-video", version: "finish-video@1.1.0" });

export const DELIVERY_PROFILES = Object.freeze({
  "archive-original": Object.freeze({
    id: "archive-original",
    schema: DELIVERY_PROFILE_SCHEMA,
    description: "Cópia auditável sem reencodificação.",
    videoFilter: null,
    videoCodec: "copy",
    audioCodec: "copy",
  }),
  "web-1080p": Object.freeze({
    id: "web-1080p",
    schema: DELIVERY_PROFILE_SCHEMA,
    description: "Entrega web 1920x1080 H.264, sem promessa de recuperar detalhe.",
    videoFilter: "scale=1920:1080:flags=lanczos,unsharp=5:5:0.25:3:3:0.0,format=yuv420p",
    videoCodec: "libx264",
    audioCodec: "copy",
    crf: 18,
    preset: "medium",
  }),
  "social-1080x1920": Object.freeze({
    id: "social-1080x1920",
    schema: DELIVERY_PROFILE_SCHEMA,
    description: "Entrega vertical 1080x1920 com preservação da proporção e padding.",
    videoFilter: "scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,unsharp=5:5:0.25:3:3:0.0,format=yuv420p",
    videoCodec: "libx264",
    audioCodec: "copy",
    crf: 18,
    preset: "medium",
  }),
});

export function resolveDeliveryProfile(value, { lut = null } = {}) {
  const id = String(value ?? "").trim();
  const profile = DELIVERY_PROFILES[id];
  if (!profile) throw new Error(`Perfil de entrega desconhecido: ${id}. Use ${Object.keys(DELIVERY_PROFILES).join(", ")}.`);
  if (lut && profile.videoCodec === "copy") throw new Error("LUT exige perfil com reencodificação: use web-1080p ou social-1080x1920.");
  return profile;
}

function escapedLutPath(file) {
  return path.resolve(file).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function buildDeliveryFilter(profileValue, { lut = null } = {}) {
  const profile = typeof profileValue === "string" ? resolveDeliveryProfile(profileValue) : profileValue;
  const filters = [];
  if (profile.videoFilter) filters.push(profile.videoFilter);
  if (lut) filters.push(`lut3d=file='${escapedLutPath(lut)}'`);
  return filters.length ? filters.join(",") : null;
}

function deliveryParameters({ profile, lut, encoder, strict, inputs }) {
  return {
    consumer: DELIVERY_CONSUMER, profile: profile.id, lut: lut ? path.resolve(lut) : null,
    filter: buildDeliveryFilter(profile, { lut }), accel: encoder.accel, encoder: encoder.encoder, encoderReason: encoder.reason,
    encoding: { video: [...encoder.args], audio: profile.audioCodec, movflags: "+faststart" },
    inputBindings: inputs.map(({ role, kind, hash, bytes, mimeType }) => ({ role, kind, sha256: hash.value, bytes, mimeType })),
    strictIntegrity: strict == null ? encoder.accel === "nvenc" : Boolean(strict),
  };
}

async function deliveryEncoder(profile, accel, capabilities) {
  const available = String(accel) === "cpu" || profile.videoCodec === "copy" ? capabilities : capabilities ?? await probeVideoEncoders();
  return resolveVideoEncoder({ profile, accel, capabilities: available });
}

export async function finishVideoRecipe({ inputFile, profile: profileValue, lut = null, accel = "cpu", capabilities = null, strict = null, metadata = {} }) {
  const profile = resolveDeliveryProfile(profileValue, { lut });
  const inputs = await Promise.all([
    createArtifactFromFile({ file: path.resolve(String(inputFile)), kind: "video", role: "source-video" }),
    ...(lut ? [createArtifactFromFile({ file: path.resolve(lut), kind: "data", role: "delivery-lut" })] : []),
  ]);
  const encoder = await deliveryEncoder(profile, accel, capabilities);
  return recipeFromReceipt(createStageReceipt({ operation: "finish-video", provider: "ffmpeg", mode: "studio", stage: "delivery",
    parameters: deliveryParameters({ profile, lut, encoder, strict, inputs }), inputs, metadata }));
}

export async function finishVideo({
  inputFile,
  outputFile,
  profile: profileValue,
  lut = null,
  accel = "cpu",
  capabilities = null,
  strict = null,
  receiptFile = `${outputFile}.receipt.json`,
  parentReceipts = [],
  metadata = {},
  recoverExisting = false,
  withEncoderResources = (_encoder, execute) => execute(),
} = {}) {
  const profile = resolveDeliveryProfile(profileValue, { lut });
  const source = path.resolve(String(inputFile));
  const target = path.resolve(String(outputFile));
  await access(source);
  if (lut) await access(path.resolve(lut));
  if (recoverExisting) {
    const receipt = await readMatchingLocalReceipt({ file: receiptFile, operation: "finish-video", inputFiles: [source, ...(lut ? [path.resolve(lut)] : [])], outputFile: target, parameters: { profile: profile.id, lut: lut ? path.resolve(lut) : null, filter: buildDeliveryFilter(profile, { lut }) }, parentReceipts });
    if (receipt) {
      if (profile.videoCodec !== "copy" && accel !== "auto" && receipt.parameters.accel !== accel) throw new Error("Encoder do recibo local diverge da retomada.");
      if (strict === true || (strict == null && receipt.parameters.accel === "nvenc")) assertDeliveryIntegrity(await probeMedia(source), await probeMedia(target), { expectResize: Boolean(profile.videoFilter) });
      return { file: target, receiptFile: path.resolve(receiptFile), receipt, before: receipt.metadata.before, after: receipt.metadata.after, encoder: { accel: receipt.parameters.accel, encoder: receipt.parameters.encoder, reason: receipt.parameters.encoderReason }, integrity: receipt.metadata.integrity, elapsedMs: receipt.metadata.elapsedMs };
    }
  }
  const inputs = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "source-video" }),
    ...(lut ? [createArtifactFromFile({ file: path.resolve(lut), kind: "data", role: "delivery-lut" })] : []),
  ]);
  const assertInputs = async () => {
    for (const input of inputs) {
      const verified = await verifyArtifact(input);
      if (!verified.valid) throw new Error(`Entrada do acabamento alterada: ${verified.errors.join(" ")}`);
    }
  };
  const before = await probeMedia(source);
  const encoder = await deliveryEncoder(profile, accel, capabilities);
  return withEncoderResources(encoder, async () => {
    await assertInputs();
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
    const startedAt = new Date();
    const elapsedStart = Date.now();
    try {
      const args = ["-y", "-i", source];
      const filter = buildDeliveryFilter(profile, { lut });
      if (filter) args.push("-vf", filter);
      args.push("-map", "0:v:0", "-map", "0:a?", ...encoder.args);
      args.push("-c:a", profile.audioCodec, "-movflags", "+faststart", temporary);
      await runFfmpeg(args);
      await assertInputs();
      await commitOrVerifyLocalFile(temporary, target, { label: "Vídeo finalizado", recoverExisting });
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    const elapsedMs = Date.now() - elapsedStart;
    const after = await probeMedia(target);
    if (!after.video) throw new Error("O perfil de entrega não produziu uma faixa de vídeo válida.");
    // O caminho por CPU é a referência histórica e continua reportando sem
    // bloquear; qualquer encoder acelerado precisa provar que entregou a mesma
    // peça antes de o arquivo valer como master.
    const enforce = strict == null ? encoder.accel === "nvenc" : Boolean(strict);
    const comparisonOptions = { expectResize: Boolean(profile.videoFilter) };
    const integrity = enforce
      ? assertDeliveryIntegrity(before, after, comparisonOptions)
      : compareDeliveryProbes(before, after, comparisonOptions);
    const outputArtifact = await createArtifactFromFile({ file: target, kind: "video", role: "delivery-video", source: { operation: "delivery-profile", profile: profile.id } });
    const receipt = createStageReceipt({
      operation: "finish-video",
      provider: "ffmpeg",
      mode: "studio",
      stage: "delivery",
      parameters: deliveryParameters({ profile, lut, encoder, strict, inputs }),
      inputs,
      artifacts: [outputArtifact],
      metadata: { ...structuredClone(metadata ?? {}), before, after, integrity, elapsedMs, claim: "delivery-compatibility-not-super-resolution" },
      parentReceipts,
      startedAt,
      completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, before, after, encoder, integrity, elapsedMs };
  });
}

/**
 * Roda o mesmo perfil pelos dois caminhos e devolve o veredito de promoção.
 * Não promove nada: produz a evidência de que o NVENC entrega a mesma peça (ou
 * de que não entrega). Trocar o caminho de produção continua sendo decisão
 * humana, tomada em cima deste documento.
 */
export async function benchmarkDeliveryEncoders({
  inputFile,
  outDir,
  profile: profileValue,
  lut = null,
  parentReceipts = [],
} = {}) {
  const profile = resolveDeliveryProfile(profileValue);
  if (profile.videoCodec === "copy") {
    throw new Error(`O perfil ${profile.id} usa stream-copy: não há encoder para comparar (e copiar já é o caminho mais rápido).`);
  }
  const capabilities = await probeVideoEncoders();
  if (!capabilities.nvenc.h264) {
    return {
      schema: "mkt-videos/delivery-encoder-benchmark@1",
      profile: profile.id,
      capabilities,
      verdict: "unavailable",
      reason: "O ffmpeg local não expõe h264_nvenc.",
    };
  }
  const root = path.resolve(String(outDir));
  await mkdir(root, { recursive: true });
  const reference = await finishVideo({
    inputFile,
    outputFile: path.join(root, `bench-cpu-${profile.id}.mp4`),
    profile: profile.id,
    lut,
    accel: "cpu",
    capabilities,
    parentReceipts,
    metadata: { benchmarkRole: "reference" },
  });
  const candidate = await finishVideo({
    inputFile,
    outputFile: path.join(root, `bench-nvenc-${profile.id}.mp4`),
    profile: profile.id,
    lut,
    accel: "nvenc",
    capabilities,
    parentReceipts,
    metadata: { benchmarkRole: "candidate" },
  });
  const promotion = evaluateEncoderPromotion({
    reference: { probe: reference.after, elapsedMs: reference.elapsedMs, encoder: reference.encoder.encoder },
    candidate: { probe: candidate.after, elapsedMs: candidate.elapsedMs, encoder: candidate.encoder.encoder },
  });
  return {
    schema: "mkt-videos/delivery-encoder-benchmark@1",
    profile: profile.id,
    capabilities: { nvenc: capabilities.nvenc },
    reference: { file: reference.file, elapsedMs: reference.elapsedMs, receiptFile: reference.receiptFile },
    candidate: { file: candidate.file, elapsedMs: candidate.elapsedMs, receiptFile: candidate.receiptFile },
    ...promotion,
  };
}
