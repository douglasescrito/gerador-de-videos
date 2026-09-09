import { operationFingerprint } from "./pipeline-operation.mjs";

export const STUDIO_DECISION_ARTIFACTS_SCHEMA =
  "mkt-videos/studio-decision-artifacts@1";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function id(value, label) {
  const normalized = String(value ?? "").trim();
  if (!ID.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function hash(value, label) {
  if (!HASH.test(String(value ?? ""))) throw new Error(`${label} deve ser SHA-256.`);
  return value;
}

function timestamp(value, label) {
  const normalized = String(value ?? "");
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} deve ser timestamp ISO-8601 UTC canônico.`);
  }
  return normalized;
}

function decisionRef(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`decisions[${index}] inválida.`);
  return {
    itemId: id(value.itemId, `decisions[${index}].itemId`),
    revision: Number.isInteger(value.revision) && value.revision > 0
      ? value.revision
      : (() => { throw new Error(`decisions[${index}].revision inválida.`); })(),
    contentHash: hash(value.contentHash, `decisions[${index}].contentHash`),
    selectedOptionId: id(value.selectedOptionId, `decisions[${index}].selectedOptionId`),
    approvedBy: id(value.approvedBy, `decisions[${index}].approvedBy`),
    decidedAt: timestamp(value.decidedAt, `decisions[${index}].decidedAt`),
  };
}

export function studioDecisionArtifactsHash(value) {
  const { fingerprint: _fingerprint, ...body } = value ?? {};
  return operationFingerprint(body);
}

export function createStudioDecisionArtifacts({
  rootScopeId,
  contextHash,
  resolverRequestFingerprint,
  resolutionFingerprint,
  decisions,
} = {}) {
  if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > 128) {
    throw new Error("decisions deve conter entre 1 e 128 referências.");
  }
  const normalized = decisions.map(decisionRef);
  if (new Set(normalized.map((entry) => entry.itemId)).size !== normalized.length) {
    throw new Error("decision artifacts não pode repetir itemId.");
  }
  const body = {
    schema: STUDIO_DECISION_ARTIFACTS_SCHEMA,
    rootScopeId: id(rootScopeId, "rootScopeId"),
    contextHash: hash(contextHash, "contextHash"),
    resolverRequestFingerprint: hash(resolverRequestFingerprint, "resolverRequestFingerprint"),
    resolutionFingerprint: hash(resolutionFingerprint, "resolutionFingerprint"),
    decisions: normalized,
    humanConfirmed: true,
  };
  return { ...body, fingerprint: studioDecisionArtifactsHash(body) };
}

export function assertStudioDecisionArtifacts(value, { label = "decisionArtifacts" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} inválido.`);
  if (value.schema !== STUDIO_DECISION_ARTIFACTS_SCHEMA) throw new Error(`${label}.schema inválido.`);
  if (value.humanConfirmed !== true) throw new Error(`${label} exige confirmação humana.`);
  const rebuilt = createStudioDecisionArtifacts(value);
  if (value.fingerprint !== rebuilt.fingerprint) throw new Error(`${label}.fingerprint divergente.`);
  return structuredClone(value);
}
