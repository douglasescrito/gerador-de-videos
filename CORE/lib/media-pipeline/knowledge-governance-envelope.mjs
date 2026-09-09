import { createHash } from "node:crypto";
import path from "node:path";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_RECORD_ENVELOPE_SCHEMA = "mkt-videos/knowledge-record-envelope@1";
export const KNOWLEDGE_CLASSIFICATIONS = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export const KNOWLEDGE_OWNER_TYPES = Object.freeze([
  "global",
  "domain",
  "organization",
  "client",
  "brand",
  "person",
  "project",
  "production",
  "deliverable",
  "campaign",
  "system",
]);
export const KNOWLEDGE_MODALITIES = Object.freeze([
  "fact",
  "capability",
  "hard-constraint",
  "preference",
  "heuristic",
  "observation",
  "hypothesis",
  "anti-pattern",
]);
export const KNOWLEDGE_RIGHTS = Object.freeze([
  "inventory",
  "localAnalysis",
  "textualIndexing",
  "embedding",
  "training",
  "providerInput",
  "publication",
  "reuse",
]);
export const KNOWLEDGE_RIGHT_STATES = Object.freeze([
  "allowed",
  "denied",
  "unknown",
  "revoked",
  "expired",
]);
export const KNOWLEDGE_RETENTION_POLICIES = Object.freeze([
  "manual-review",
  "until-project-close",
  "until-rights-expire",
  "explicit-date",
  "contractual",
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RAW_HASH_SOURCE_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const LOGICAL_SOURCE_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{1,31}:\S{1,512}$/;
const TOP_LEVEL_KEYS = new Set([
  "classification",
  "owner",
  "provenance",
  "modality",
  "evidenceIds",
  "retention",
  "rights",
  "createdAt",
  "createdBy",
]);
const OWNER_KEYS = new Set(["type", "id"]);
const PROVENANCE_KEYS = new Set([
  "sourceType",
  "sourceRef",
  "method",
  "observedAt",
  "contentHash",
]);
const RETENTION_KEYS = new Set(["policy", "expiresAt", "basis"]);
const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "sesskey",
  "sessiontoken",
  "token",
]);
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/i,
  /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|cookie|credential|password|secret|sesskey)\s*[:=]\s*["']?[^\s,;]{4,}/i,
  /(?:https?|wss):\/\/[^/\s:@]+:[^/\s@]+@/i,
  /[?&](?:access_token|api_key|key|signature|sig|token)=[^&#\s]+/i,
  /\b(?:cookie|set-cookie)\s*:/i,
]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} deve ser um objeto.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} deve conter somente valores JSON.`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contém campo não permitido.`);
  }
}

function requiredText(value, label, maximum = 200) {
  if (typeof value !== "string") {
    throw new Error(`${label} deve ser texto.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} deve ter entre 1 e ${maximum} caracteres.`);
  }
  return normalized;
}

function choice(value, allowed, label) {
  const normalized = requiredText(value, label, 80);
  if (!allowed.includes(normalized)) throw new Error(`${label} é inválido.`);
  return normalized;
}

function identifier(value, label) {
  const normalized = requiredText(value, label);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} contém caracteres inválidos.`);
  }
  return normalized;
}

function isoTimestamp(value, label) {
  if (value == null || value === "") throw new Error(`${label} é obrigatório.`);
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error(`${label} é inválido.`);
  return timestamp.toISOString();
}

function normalizeJson(value, location = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${location} contém número não finito.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJson(entry, `${location}[${index}]`));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${location} deve conter somente valores JSON.`);
    }
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error(`${location} contém chave proibida.`);
      }
      return [key, normalizeJson(value[key], `${location}.${key}`)];
    }));
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value));
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function assertNoSensitiveMaterial(value, location = "$") {
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(`${location} contém material sensível proibido.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveMaterial(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      throw new Error(`${location} contém campo sensível proibido.`);
    }
    assertNoSensitiveMaterial(entry, `${location}.${key}`);
  }
}

function assertLogicalSourceRef(value, label) {
  const sourceRef = requiredText(value, label, 640);
  const lower = sourceRef.toLowerCase();
  const suffix = sourceRef.includes(":") ? sourceRef.slice(sourceRef.indexOf(":") + 1) : sourceRef;
  const webUri = /^(?:https?|wss):\/\//i.test(sourceRef);
  const absolute =
    path.win32.isAbsolute(sourceRef)
    || path.posix.isAbsolute(sourceRef)
    || (!webUri && (path.win32.isAbsolute(suffix) || path.posix.isAbsolute(suffix)))
    || lower.startsWith("file:");
  if (absolute) throw new Error(`${label} não pode conter caminho absoluto.`);
  if (!RAW_HASH_SOURCE_PATTERN.test(sourceRef) && !LOGICAL_SOURCE_PATTERN.test(sourceRef)) {
    throw new Error(`${label} deve ser uma referência lógica ou hash SHA-256.`);
  }
  return sourceRef;
}

function normalizeOwner(owner) {
  const value = plainObject(owner, "owner");
  assertAllowedKeys(value, OWNER_KEYS, "owner");
  return {
    type: choice(value.type, KNOWLEDGE_OWNER_TYPES, "owner.type"),
    id: identifier(value.id, "owner.id"),
  };
}

function normalizeProvenance(provenance) {
  const entries = Array.isArray(provenance) ? provenance : provenance == null ? [] : [provenance];
  if (entries.length === 0) throw new Error("provenance exige ao menos uma origem.");
  const normalized = entries.map((entry, index) => {
    const value = plainObject(entry, `provenance[${index}]`);
    assertAllowedKeys(value, PROVENANCE_KEYS, `provenance[${index}]`);
    const sourceType = requiredText(value.sourceType, `provenance[${index}].sourceType`, 64);
    const method = requiredText(value.method, `provenance[${index}].method`, 64);
    if (!TYPE_PATTERN.test(sourceType)) throw new Error(`provenance[${index}].sourceType é inválido.`);
    if (!TYPE_PATTERN.test(method)) throw new Error(`provenance[${index}].method é inválido.`);
    const contentHash = requiredText(value.contentHash, `provenance[${index}].contentHash`, 64);
    if (!SHA256_PATTERN.test(contentHash)) throw new Error(`provenance[${index}].contentHash é inválido.`);
    return {
      sourceType,
      sourceRef: assertLogicalSourceRef(value.sourceRef, `provenance[${index}].sourceRef`),
      method,
      observedAt: isoTimestamp(value.observedAt, `provenance[${index}].observedAt`),
      contentHash,
    };
  });
  const unique = new Map(normalized.map((entry) => [canonicalJson(entry), entry]));
  return [...unique.values()].sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
}

function normalizeEvidenceIds(evidenceIds = []) {
  if (!Array.isArray(evidenceIds)) throw new Error("evidenceIds deve ser um array.");
  return [...new Set(evidenceIds.map((id, index) => identifier(id, `evidenceIds[${index}]`)))].sort(compareText);
}

function normalizeRetention(retention, createdAt) {
  const input = retention == null
    ? {}
    : typeof retention === "string"
      ? { policy: retention }
      : plainObject(retention, "retention");
  assertAllowedKeys(input, RETENTION_KEYS, "retention");
  const policy = choice(input.policy ?? "manual-review", KNOWLEDGE_RETENTION_POLICIES, "retention.policy");
  const expiresAt = input.expiresAt == null ? null : isoTimestamp(input.expiresAt, "retention.expiresAt");
  const basis = input.basis == null ? null : requiredText(input.basis, "retention.basis", 500);
  if (policy === "explicit-date" && expiresAt == null) {
    throw new Error("retention.expiresAt é obrigatório para explicit-date.");
  }
  if (expiresAt != null && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new Error("retention.expiresAt deve ser posterior a createdAt.");
  }
  return { policy, expiresAt, basis };
}

function normalizeRights(rights = {}) {
  const input = plainObject(rights, "rights");
  assertAllowedKeys(input, new Set(KNOWLEDGE_RIGHTS), "rights");
  return Object.fromEntries(KNOWLEDGE_RIGHTS.map((right) => [
    right,
    choice(input[right] ?? "unknown", KNOWLEDGE_RIGHT_STATES, `rights.${right}`),
  ]));
}

function bodyForHash(envelope) {
  const { hash: _hash, ...body } = envelope;
  return body;
}

export function assertKnowledgeRecordEnvelope(envelope, { expectedActor = null } = {}) {
  assertNoSensitiveMaterial(envelope);
  assertKnowledgeContract(envelope, {
    schemaId: KNOWLEDGE_RECORD_ENVELOPE_SCHEMA,
    label: "KnowledgeRecordEnvelope",
  });
  if (expectedActor != null) {
    const actor = requiredText(expectedActor, "expectedActor");
    if (envelope.createdBy !== actor) throw new Error("createdBy diverge do actor esperado.");
  }
  if (envelope.hash !== sha256(bodyForHash(envelope))) {
    throw new Error("KnowledgeRecordEnvelope possui hash inválido.");
  }
  return envelope;
}

export function createKnowledgeRecordEnvelope(input = {}, { expectedActor = null } = {}) {
  assertNoSensitiveMaterial(input);
  assertNoSensitiveMaterial(expectedActor, "expectedActor");
  const value = plainObject(input, "envelope");
  assertAllowedKeys(value, TOP_LEVEL_KEYS, "envelope");
  const createdAt = isoTimestamp(value.createdAt, "createdAt");
  const createdBy = requiredText(value.createdBy, "createdBy");
  if (expectedActor != null && createdBy !== requiredText(expectedActor, "expectedActor")) {
    throw new Error("createdBy diverge do actor esperado.");
  }
  const body = {
    schema: KNOWLEDGE_RECORD_ENVELOPE_SCHEMA,
    classification: choice(value.classification, KNOWLEDGE_CLASSIFICATIONS, "classification"),
    owner: normalizeOwner(value.owner),
    provenance: normalizeProvenance(value.provenance),
    modality: choice(value.modality, KNOWLEDGE_MODALITIES, "modality"),
    evidenceIds: normalizeEvidenceIds(value.evidenceIds),
    retention: normalizeRetention(value.retention, createdAt),
    rights: normalizeRights(value.rights),
    createdAt,
    createdBy,
  };
  const envelope = { ...body, hash: sha256(body) };
  assertKnowledgeRecordEnvelope(envelope, { expectedActor });
  return deepFreeze(envelope);
}
