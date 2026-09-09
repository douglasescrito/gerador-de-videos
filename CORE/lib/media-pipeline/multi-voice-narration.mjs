import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { ADAPTER_CONTRACT_SCHEMA, createAdapterContract } from "./adapter-contract.mjs";

export const MULTI_VOICE_PLAN_SCHEMA = "mkt-videos/multi-voice-plan@1";
export const MULTI_VOICE_REPLAY_SCHEMA = "mkt-videos/multi-voice-replay@1";

function text(value, label) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} é obrigatório.`); return result; }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }

export function buildMultiVoiceNarrationPlan({ productionId, blocks, speakers, outputDir } = {}) {
  if (!Array.isArray(blocks) || blocks.length < 2 || !Array.isArray(speakers) || speakers.length < 2) throw new Error("Multi-voz exige ao menos dois blocos e dois speakers.");
  const voiceBySpeaker = new Map(speakers.map((entry) => [text(entry.id ?? entry.speaker, "speaker.id"), text(entry.voice, "speaker.voice")]));
  const segments = blocks.map((block, index) => {
    const speakerId = text(block.speakerId ?? block.speaker, `blocks[${index}].speakerId`);
    if (!voiceBySpeaker.has(speakerId)) throw new Error(`Bloco ${block.id ?? index + 1} usa speaker não declarado.`);
    const outputFile = path.join(path.resolve(outputDir), `voice-${String(index + 1).padStart(3, "0")}.wav`);
    return { id: text(block.id ?? `segment-${index + 1}`, `blocks[${index}].id`), speakerId, voice: voiceBySpeaker.get(speakerId), text: text(block.text, `blocks[${index}].text`), order: index, outputFile, receiptFile: `${outputFile}.receipt.json` };
  });
  const body = { schema: MULTI_VOICE_PLAN_SCHEMA, productionId: text(productionId, "productionId"), outputDir: path.resolve(outputDir), segments, masterFile: path.join(path.resolve(outputDir), "voice-master.wav"), alignmentFile: path.join(path.resolve(outputDir), "voice-master.words.json"), capabilityIntent: "narration.generate.segmented-multi-voice", providerCalls: segments.length };
  return Object.freeze({ ...body, planFingerprint: operationFingerprint(body) });
}

export async function replayMultiVoiceNarration({ plan, segmentArtifacts, concatSegments, alignMaster } = {}) {
  if (plan?.schema !== MULTI_VOICE_PLAN_SCHEMA || operationFingerprint((({ planFingerprint, ...body }) => body)(plan)) !== plan.planFingerprint) throw new Error("Plano multi-voz inválido.");
  if (!Array.isArray(segmentArtifacts) || segmentArtifacts.length !== plan.segments.length) throw new Error("Replay exige um artefato por segmento.");
  const artifacts = [];
  for (const [index, artifact] of segmentArtifacts.entries()) {
    const segment = plan.segments[index];
    if (artifact.segmentId !== segment.id || path.resolve(artifact.file) !== path.resolve(segment.outputFile) || path.resolve(artifact.receiptFile) !== path.resolve(segment.receiptFile)) throw new Error(`Artefato do segmento ${segment.id} diverge do plano.`);
    const actualHash = await sha256(artifact.file);
    if (actualHash !== artifact.sha256) throw new Error(`Hash do segmento ${segment.id} diverge.`);
    const receipt = JSON.parse(await readFile(artifact.receiptFile, "utf8"));
    const receiptVoice = receipt.voice ?? receipt.parameters?.voice;
    if (receipt.status !== "completed" || receiptVoice !== segment.voice) throw new Error(`Recibo do segmento ${segment.id} inválido.`);
    artifacts.push({ ...artifact, sha256: actualHash, receiptHash: await sha256(artifact.receiptFile) });
  }
  if (new Set(artifacts.map((entry) => path.resolve(entry.file))).size !== artifacts.length || new Set(artifacts.map((entry) => path.resolve(entry.receiptFile))).size !== artifacts.length) throw new Error("Multi-voz exige WAVs e recibos distintos por segmento.");
  await concatSegments({ inputs: artifacts.map((entry) => entry.file), outputFile: plan.masterFile });
  const alignment = await alignMaster({ audioFile: plan.masterFile, blocks: plan.segments.map(({ id, text: value, speakerId }) => ({ id, text: value, speakerId })), outputFile: plan.alignmentFile });
  const body = { schema: MULTI_VOICE_REPLAY_SCHEMA, planFingerprint: plan.planFingerprint, segmentArtifacts: artifacts, master: { file: plan.masterFile, sha256: await sha256(plan.masterFile) }, alignment, status: "passed", providerCalls: 0, fallbackUsed: false };
  return Object.freeze({ ...body, replayHash: operationFingerprint(body) });
}

export async function executeMultiVoiceNarration({ plan, generateSegment, reconcileSegment, concatSegments, alignMaster } = {}) {
  const artifacts = [];
  for (const segment of plan.segments) {
    const result = await generateSegment(segment);
    if (result?.status === "ambiguous" || result?.status === "pending") {
      const reconciled = await reconcileSegment({ segment, result });
      if (reconciled?.status !== "completed") throw new Error(`Segmento ${segment.id} exige reconciliação; nova submissão é proibida.`);
      artifacts.push(reconciled);
    } else if (result?.status === "completed") artifacts.push(result);
    else throw new Error(`Segmento ${segment.id} falhou antes de concluir; fallback silencioso é proibido.`);
  }
  return replayMultiVoiceNarration({ plan, segmentArtifacts: artifacts, concatSegments, alignMaster });
}

export function createMultiVoiceNarrationAdapter({ generateSegment, reconcileSegment, concatSegments, alignMaster } = {}) {
  const adapter = {
    schema: ADAPTER_CONTRACT_SCHEMA,
    id: "google-vids-multi-voice-adapter",
    providerId: "google-vids-multi-voice",
    kind: "audio",
    operations: ["segmented-text-to-speech"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["segmented-text-to-speech"],
    reconcileOperations: ["segmented-text-to-speech"],
    resultKinds: ["audio"],
    estimate: async ({ request } = {}) => ({ calls: request?.plan?.segments?.length ?? 0, paid: true }),
    execute: async ({ request }) => {
      const replay = await executeMultiVoiceNarration({ plan: request.plan, generateSegment, reconcileSegment, concatSegments, alignMaster });
      return { status: "ready", artifacts: [{ id: `sha256:${replay.master.sha256}` }], receiptId: `receipt:${replay.replayHash}`, metadata: { replayHash: replay.replayHash, segmentCount: replay.segmentArtifacts.length } };
    },
    reconcile: async ({ request }) => {
      const replay = await replayMultiVoiceNarration({ plan: request.plan, segmentArtifacts: request.segmentArtifacts, concatSegments, alignMaster });
      return { status: "ready", artifacts: [{ id: `sha256:${replay.master.sha256}` }], receiptId: `receipt:${replay.replayHash}`, metadata: { replayHash: replay.replayHash, reconcileOnly: true } };
    },
  };
  return Object.freeze({ ...adapter, ...createAdapterContract(adapter) });
}
