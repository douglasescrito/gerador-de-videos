import { createHash } from "node:crypto";

export const VIDEO_PREFERENCE_EVENT_SCHEMA = "mkt-videos/video-preference-event@1";
export const VIDEO_REVIEW_EVENT_SCHEMA = "mkt-videos/video-review-event@1";
export const VIDEO_PREFERENCE_EVENT_TYPE = "video.preference-set";
export const VIDEO_REVIEW_EVENT_TYPE = "video.review-set";
export const VIDEO_PREFERENCE_SUBJECT_TYPE = "video-preference";
export const VIDEO_REVIEW_SUBJECT_TYPE = "video-review";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REVIEW_STATUSES = new Set(["approved", "rejected", "needs-review"]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Mesmo algoritmo de canonicalize() usado em production-request.mjs,
// pipeline-operation.mjs e receipt.mjs — replicado aqui (não importado) pelo
// mesmo motivo dos outros módulos: cada um é uma unidade de conteúdo humano
// pequena e independente, sem razão para acoplar a um módulo central.
function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Decisão de vídeo contém número não finito.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Decisão de vídeo deve conter somente valores JSON.");
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]),
    );
  }
  throw new Error("Decisão de vídeo deve conter somente valores JSON.");
}

function canonicalVideoDecisionJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function videoDecisionEventHash(value) {
  return createHash("sha256").update(canonicalVideoDecisionJson(value), "utf8").digest("hex");
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function assertNullableId(value, label) {
  return value == null ? null : assertId(value, label);
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} deve ser SHA-256 hexadecimal.`);
  return value;
}

function requiredText(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`${label} deve ser texto normalizado entre 1 e ${max} caracteres.`);
  }
  return value;
}

function optionalText(value, label, max = 2000) {
  return value == null ? null : requiredText(String(value), label, max);
}

function assertRelPath(value, label) {
  const normalized = String(value ?? "");
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("\\") || /^[A-Za-z]:/u.test(normalized) || normalized.includes("\0")) {
    throw new Error(`${label} deve ser um caminho relativo não vazio.`);
  }
  return normalized;
}

/**
 * Constrói um video-preference-event@1 (like/unlike). targetHash é o sha256
 * do artefato (vindo de production-manifest@1.artifacts[].sha256) — a
 * identidade real, que sobrevive a reindexação/rename; relPath é só
 * informativo, nunca autoridade. Curtir de novo depois de descurtir grava um
 * evento NOVO, nunca sobrescreve — histórico completo sempre preservado.
 */
export function createVideoPreferenceEvent({
  rootScopeId,
  scopeId,
  actor,
  at,
  targetHash,
  relPath,
  liked,
} = {}) {
  if (typeof liked !== "boolean") throw new Error("liked deve ser booleano.");
  return {
    schema: VIDEO_PREFERENCE_EVENT_SCHEMA,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    scopeId: assertId(scopeId, "scopeId"),
    actor: requiredText(actor, "actor", 200),
    at: requiredText(at, "at", 64),
    targetHash: assertHash(targetHash, "targetHash"),
    relPath: assertRelPath(relPath, "relPath"),
    liked,
  };
}

export function assertVideoPreferenceEvent(value, { label = "video-preference-event@1" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  if (value.schema !== VIDEO_PREFERENCE_EVENT_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const rebuilt = createVideoPreferenceEvent(value);
  if (videoDecisionEventHash(rebuilt) !== videoDecisionEventHash(value)) {
    throw new Error(`${label} diverge do conteúdo canônico.`);
  }
  return value;
}

/**
 * Constrói um video-review-event@1. Mesma identidade por targetHash;
 * status/reason substituem o modelo de upsert atual (Rust reviews /
 * Express reviews) por um evento novo a cada decisão — histórico nunca
 * é sobrescrito, mesmo quando o status muda de novo.
 */
export function createVideoReviewEvent({
  rootScopeId,
  scopeId,
  actor,
  at,
  targetHash,
  relPath,
  status,
  reason,
  receiptId = null,
} = {}) {
  if (!REVIEW_STATUSES.has(status)) throw new Error("status inválido.");
  return {
    schema: VIDEO_REVIEW_EVENT_SCHEMA,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    scopeId: assertId(scopeId, "scopeId"),
    actor: requiredText(actor, "actor", 200),
    at: requiredText(at, "at", 64),
    targetHash: assertHash(targetHash, "targetHash"),
    relPath: assertRelPath(relPath, "relPath"),
    status,
    reason: requiredText(reason, "reason", 2000),
    receiptId: optionalText(receiptId, "receiptId", 400),
  };
}

export function assertVideoReviewEvent(value, { label = "video-review-event@1" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  if (value.schema !== VIDEO_REVIEW_EVENT_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const rebuilt = createVideoReviewEvent(value);
  if (videoDecisionEventHash(rebuilt) !== videoDecisionEventHash(value)) {
    throw new Error(`${label} diverge do conteúdo canônico.`);
  }
  return value;
}

/** Projeta o estado atual (último evento) sem apagar o histórico anterior. */
export function projectVideoPreferenceState({ targetHash, events = [] } = {}) {
  const validated = events.map((event) => assertVideoPreferenceEvent(event));
  const last = validated.at(-1) ?? null;
  return {
    schema: "mkt-videos/video-preference-state@1",
    targetHash: assertHash(targetHash, "targetHash"),
    liked: last?.liked ?? false,
    updatedAt: last?.at ?? null,
    history: validated,
  };
}

export function projectVideoReviewState({ targetHash, events = [] } = {}) {
  const validated = events.map((event) => assertVideoReviewEvent(event));
  const last = validated.at(-1) ?? null;
  return {
    schema: "mkt-videos/video-review-state@1",
    targetHash: assertHash(targetHash, "targetHash"),
    status: last?.status ?? null,
    reason: last?.reason ?? null,
    updatedAt: last?.at ?? null,
    history: validated,
  };
}

/** Hash de replay: mesmo stream de eventos produz sempre o mesmo hash. */
export function videoDecisionReplayHash(rootScopeId, entries) {
  return createHash("sha256")
    .update(canonicalVideoDecisionJson({ rootScopeId, entries }), "utf8")
    .digest("hex");
}
