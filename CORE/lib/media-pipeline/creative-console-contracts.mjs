import { operationFingerprint } from "./pipeline-operation.mjs";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function fail(label, message) {
  throw new Error(`${label} inválido: ${message}.`);
}

function id(value, label) {
  if (!ID.test(String(value ?? ""))) fail(label, "identificador");
}

function hash(value, label) {
  if (!HASH.test(String(value ?? ""))) fail(label, "hash");
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(label, "inteiro não negativo");
}

export function assertCreativeConsoleRetrievalEvaluation(value, {
  label = "CreativeConsole.retrievalEvaluation",
} = {}) {
  if (!value || value.schema !== "mkt-videos/retrieval-shadow-evaluation@1") fail(label, "schema");
  id(value.evaluationId, `${label}.evaluationId`);
  if (value.rankerVersion !== "lexical-ranker@1") fail(label, "rankerVersion");
  for (const key of ["caseCount", "acceptedCaseCount", "mismatchedCaseCount", "leakageCount", "overrideCount", "unresolvedConflictCount", "plannerInfluenceViolations"]) nonNegativeInteger(value[key], `${label}.${key}`);
  for (const key of ["acceptanceRate", "overrideRate"]) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) fail(label, key);
  }
  for (const key of ["zeroLeakage"]) if (typeof value[key] !== "boolean") fail(label, key);
  hash(value.hash, `${label}.hash`);
  const { hash: _hash, ...body } = value;
  if (operationFingerprint(body) !== value.hash) fail(label, "fingerprint");
  return value;
}

export function assertCreativeConsoleReleaseGovernance(value, {
  label = "CreativeConsole.releaseGovernance",
} = {}) {
  if (!value || value.schema !== "mkt-videos/knowledge-release-lifecycle-result@1") fail(label, "schema");
  if (value.action !== "active-release") fail(label, "somente active-release é aceito");
  if (value.providerFree !== true || value.readOnly !== true || value.changed !== false) fail(label, "efeito não read-only");
  if (!new Set(["no-active-release", "active"]).has(value.status)) fail(label, "status");
  if (typeof value.eligible !== "boolean" || !Array.isArray(value.issues)) fail(label, "projeção");
  if (value.release != null) {
    id(value.release.id, `${label}.release.id`);
    hash(value.release.hash, `${label}.release.hash`);
    nonNegativeInteger(value.release.memberCount, `${label}.release.memberCount`);
  }
  return value;
}

export function assertCreativeConsolePreferenceRanker(value, {
  label = "CreativeConsole.preferenceRankerShadow",
} = {}) {
  if (!value || value.schema !== "mkt-videos/preference-ranker-shadow@1") fail(label, "schema");
  if (value.rankerVersion !== "precedence-ranker@1") fail(label, "rankerVersion");
  if (value.authority !== "none" || value.plannerInfluence !== "none" || value.changed !== false || value.providerCalls !== 0) fail(label, "autoridade ou efeito");
  if (!new Set(["selected", "no-admissible-option", "blocked-viability", "unresolved-conflict"]).has(value.status)) fail(label, "status");
  for (const key of ["rankedOptionIds", "viableAlternativeIds", "admissibleOptionIds", "blockedOptionIds"]) {
    if (!Array.isArray(value[key])) fail(label, key);
    value[key].forEach((entry) => id(entry, `${label}.${key}`));
  }
  if (value.selectedOptionId != null) id(value.selectedOptionId, `${label}.selectedOptionId`);
  if (typeof value.requiresHumanDecision !== "boolean" || typeof value.requiresReplan !== "boolean") fail(label, "flags");
  hash(value.fingerprint, `${label}.fingerprint`);
  const { fingerprint, ...body } = value;
  if (operationFingerprint(body) !== value.fingerprint) fail(label, "fingerprint");
  return value;
}

