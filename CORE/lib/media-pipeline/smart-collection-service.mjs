import { createHash } from "node:crypto";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import { KNOWLEDGE_SMART_COLLECTION_SCHEMA } from "./knowledge-record-contracts.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function identifier(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(normalized)) {
    throw new Error(`${label} inválido.`);
  }
  return normalized;
}

function filters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("filters deve ser um objeto.");
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 30) {
    throw new Error("filters deve conter entre 1 e 30 condições.");
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`Filtro inválido: ${key}.`);
    if (!["string", "number", "boolean"].includes(typeof entry) && entry !== null) {
      throw new Error(`Valor inválido para filtro ${key}.`);
    }
    return [key, entry];
  }));
}

export function listSmartCollections({ repository, grant, rootScopeId }) {
  return repository.listKnowledgeItems({ grant, rootScopeId, history: false })
    .filter((item) =>
      item.schemaId === KNOWLEDGE_SMART_COLLECTION_SCHEMA
      && item.status === "active")
    .map((item) => ({
      itemId: item.id,
      revision: item.revision,
      contentHash: item.contentHash,
      ...item.payload,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveSmartCollection({
  repository,
  grant,
  rootScopeId,
  input,
  actor,
  confirmHuman,
  clock = () => new Date(),
}) {
  if (confirmHuman !== true) throw new Error("Coleção inteligente exige confirmHuman=true.");
  const collectionId = identifier(input?.collectionId, "collectionId");
  const itemId = `smart-collection:${collectionId}`;
  const previous = repository.getKnowledgeItem({
    grant,
    rootScopeId,
    id: itemId,
  });
  const createdAt = clock().toISOString();
  const payload = assertKnowledgeContract({
    schema: KNOWLEDGE_SMART_COLLECTION_SCHEMA,
    collectionId,
    name: String(input?.name ?? "").trim(),
    filters: filters(input?.filters),
    createdAt,
    createdBy: actor,
  }, {
    schemaId: KNOWLEDGE_SMART_COLLECTION_SCHEMA,
    label: "Smart collection",
  });
  const governance = createKnowledgeRecordEnvelope({
    classification: input?.classification ?? previous?.governance?.classification ?? "confidential",
    owner: previous?.governance?.owner ?? { type: "client", id: rootScopeId },
    provenance: [{
      sourceType: "smart-collection",
      sourceRef: `collection:${collectionId}/r${(previous?.revision ?? 0) + 1}`,
      method: "human-saved-query",
      observedAt: createdAt,
      contentHash: hash(payload),
    }],
    modality: "preference",
    evidenceIds: [],
    retention: { policy: "manual-review" },
    rights: {
      inventory: "allowed",
      localAnalysis: "allowed",
      textualIndexing: "allowed",
      embedding: "denied",
      training: "denied",
      providerInput: "denied",
      publication: "unknown",
      reuse: "allowed",
    },
    createdAt,
    createdBy: actor,
  }, { expectedActor: actor });
  const item = repository.appendKnowledgeItem({
    grant,
    item: {
      id: itemId,
      revision: (previous?.revision ?? 0) + 1,
      rootScopeId,
      scopeId: rootScopeId,
      recordType: "assertion",
      schemaId: KNOWLEDGE_SMART_COLLECTION_SCHEMA,
      schemaVersion: 1,
      status: "active",
      governance,
      supersedesRevision: previous?.revision ?? null,
      payload,
      createdAt,
      createdBy: actor,
    },
  });
  return {
    itemId: item.id,
    revision: item.revision,
    contentHash: item.contentHash,
    ...item.payload,
  };
}
