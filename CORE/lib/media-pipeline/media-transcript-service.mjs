import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File } from "./artifact.mjs";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import { KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA } from "./knowledge-record-contracts.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import {
  ALIGN_DEFAULTS,
  extractNarrationAudio,
  transcribeWordTimestamps,
} from "./narration-align.mjs";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function required(value, label, max = 300) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  if (normalized.length > max) throw new Error(`${label} excede ${max} caracteres.`);
  return normalized;
}

function assertTranscriptRights(resolved) {
  if (!resolved?.targetItem) throw new Error("Asset governado não foi resolvido.");
  for (const right of ["localAnalysis", "textualIndexing"]) {
    if (resolved.targetItem.governance?.rights?.[right] !== "allowed") {
      throw new Error(`Envelope do asset não permite ${right}.`);
    }
    if (
      resolved.effectiveRights?.authority !== "knowledge-store-head-only"
      || resolved.effectiveRights?.permissions?.[right]?.state !== "allowed"
    ) {
      throw new Error(`Direito vigente ${right} não está allowed.`);
    }
  }
  return resolved.targetItem;
}

export async function transcribeLocalMediaFile({
  videoFile,
  model = ALIGN_DEFAULTS.whisperModel,
  language = ALIGN_DEFAULTS.language,
  whisperCommand = "whisper",
}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "mkt-media-transcript-"));
  try {
    const audioFile = path.join(temporary, "audio.wav");
    await extractNarrationAudio({ videoFile, outputFile: audioFile });
    const measured = await transcribeWordTimestamps({
      audioFile,
      workDir: temporary,
      model,
      language,
      command: whisperCommand,
    });
    const segments = measured.words.map((word) => ({
      start: Number(word.start),
      end: Number(word.end),
      text: String(word.word ?? word.text ?? "").trim(),
    })).filter((segment) =>
      segment.text
      && Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.end >= segment.start);
    return {
      text: measured.transcript,
      segments,
      language,
      engine: { id: "whisper-local", model },
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function listMediaTranscripts({ repository, grant, rootScopeId }) {
  return repository.listKnowledgeItems({ grant, rootScopeId, history: false })
    .filter((item) =>
      item.schemaId === KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA
      && item.status !== "revoked"
      && item.governance?.rights?.textualIndexing === "allowed")
    .map((item) => ({
      itemId: item.id,
      revision: item.revision,
      status: item.status,
      payload: item.payload,
      contentHash: item.contentHash,
    }));
}

export async function transcribeAndPersistMedia({
  repository,
  grant,
  rootScopeId,
  assetId,
  receiptId = null,
  videoFile,
  actor,
  transcriber = transcribeLocalMediaFile,
  model = ALIGN_DEFAULTS.whisperModel,
  language = ALIGN_DEFAULTS.language,
  whisperCommand = "whisper",
  clock = () => new Date(),
}) {
  const normalizedAssetId = required(assetId, "assetId", 200);
  const resolved = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId,
    referenceAssetId: normalizedAssetId,
  });
  const target = assertTranscriptRights(resolved);
  const artifactHash = await sha256File(videoFile);
  const transcript = await transcriber({
    videoFile,
    model,
    language,
    whisperCommand,
  });
  const generatedAt = clock().toISOString();
  const segments = (transcript.segments ?? []).map((segment, index) => {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error(`Segmento ${index + 1} possui tempo inválido.`);
    }
    return { start, end, text: String(segment.text ?? "") };
  });
  const payload = assertKnowledgeContract({
    schema: KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA,
    assetId: normalizedAssetId,
    receiptId: receiptId == null ? null : required(receiptId, "receiptId"),
    artifactHash,
    language: transcript.language ?? language,
    text: String(transcript.text ?? "").trim(),
    segments,
    engine: transcript.engine ?? { id: "whisper-local", model },
    authority: "none",
    generatedAt,
  }, {
    schemaId: KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA,
    label: "Media transcript",
  });
  const existing = listMediaTranscripts({ repository, grant, rootScopeId })
    .find((item) =>
      item.payload.assetId === normalizedAssetId
      && item.payload.artifactHash === artifactHash
      && item.payload.engine.model === payload.engine.model);
  if (existing) return { ...existing, reused: true };

  const logicalHash = digest(payload);
  const item = repository.appendKnowledgeItem({
    grant,
    item: {
      id: `media-transcript:${logicalHash.slice(0, 32)}`,
      revision: 1,
      rootScopeId,
      scopeId: target.scopeId,
      recordType: "evidence",
      schemaId: KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA,
      schemaVersion: 1,
      status: "candidate",
      governance: createKnowledgeRecordEnvelope({
        classification: target.governance.classification,
        owner: structuredClone(target.governance.owner),
        provenance: [{
          sourceType: "local-transcription",
          sourceRef: `transcript:${artifactHash}`,
          method: "whisper-local",
          observedAt: generatedAt,
          contentHash: logicalHash,
        }],
        modality: "observation",
        evidenceIds: [],
        retention: structuredClone(target.governance.retention),
        rights: {
          inventory: "allowed",
          localAnalysis: "allowed",
          textualIndexing: "allowed",
          embedding: "denied",
          training: "denied",
          providerInput: "denied",
          publication: "unknown",
          reuse: "denied",
        },
        createdAt: generatedAt,
        createdBy: actor,
      }, { expectedActor: actor }),
      supersedesRevision: null,
      payload,
      createdAt: generatedAt,
      createdBy: actor,
    },
  });
  return {
    itemId: item.id,
    revision: item.revision,
    status: item.status,
    payload: item.payload,
    contentHash: item.contentHash,
    reused: false,
  };
}
