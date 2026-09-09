import { operationFingerprint } from "./pipeline-operation.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA =
  "mkt-videos/knowledge-decision-resolution-request@1";
export const KNOWLEDGE_DECISION_RESOLUTION_SCHEMA =
  "mkt-videos/knowledge-decision-resolution@1";
export const KNOWLEDGE_DECISION_SHADOW_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-decision-shadow-action-result@1";

const AUTHORITIES = Object.freeze({
  "explicit-request": 7,
  "project-decision": 6,
  "client-preference": 5,
  "personal-preference": 4,
  "genre-foundation": 3,
  heuristic: 2,
  "model-suggestion": 1,
});

function safeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(normalized)) {
    throw new Error(`${label} inválido.`);
  }
  return normalized;
}

function safeText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 2000 || /[\u0000\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    throw new Error(`${label} inválido.`);
  }
  return normalized;
}

function safeHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value ?? ""))) throw new Error(`${label} deve ser SHA-256.`);
  return value;
}

function safeTimestamp(value, label) {
  const normalized = String(value ?? "");
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} deve ser timestamp ISO-8601 UTC canônico.`);
  }
  return normalized;
}

function assertOption(option, index) {
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    throw new Error(`options[${index}] inválida.`);
  }
  const id = safeId(option.id, `options[${index}].id`);
  const admissibility = option.admissibility;
  if (!admissibility || !["allowed", "blocked"].includes(admissibility.status)) {
    throw new Error(`options[${index}].admissibility.status inválido.`);
  }
  const viability = option.viability;
  if (!viability || !["available", "unavailable"].includes(viability.status)) {
    throw new Error(`options[${index}].viability.status inválido.`);
  }
  const preference = option.preference;
  if (!preference || !Object.hasOwn(AUTHORITIES, preference.authority)) {
    throw new Error(`options[${index}].preference.authority inválido.`);
  }
  for (const [label, value] of [["admissibility.reasons", admissibility.reasons], ["viability.reasons", viability.reasons]]) {
    if (!Array.isArray(value) || value.length > 16) throw new Error(`options[${index}].${label} inválido.`);
    value.forEach((reason, reasonIndex) => safeText(reason, `options[${index}].${label}[${reasonIndex}]`));
  }
  const scopeDepth = Number(preference.scopeDepth);
  const revision = Number(preference.revision);
  const evidenceStrength = Number(preference.evidenceStrength);
  if (!Number.isInteger(scopeDepth) || scopeDepth < 0 || scopeDepth > 1000) throw new Error(`options[${index}].preference.scopeDepth inválido.`);
  if (!Number.isInteger(revision) || revision < 1) throw new Error(`options[${index}].preference.revision inválida.`);
  if (!Number.isInteger(evidenceStrength) || evidenceStrength < 0) throw new Error(`options[${index}].preference.evidenceStrength inválido.`);
  if (preference.conflictSet != null) safeId(preference.conflictSet, `options[${index}].preference.conflictSet`);
  if (preference.valueHash != null) safeHash(preference.valueHash, `options[${index}].preference.valueHash`);
  return {
    id,
    admissibility: {
      status: admissibility.status,
      reasons: [...admissibility.reasons].map(String),
    },
    preference: {
      authority: preference.authority,
      scopeDepth,
      supersedes: preference.supersedes === true,
      revision,
      evidenceStrength,
      conflictSet: preference.conflictSet == null ? null : String(preference.conflictSet),
      valueHash: preference.valueHash == null ? null : String(preference.valueHash),
    },
    viability: {
      status: viability.status,
      reasons: [...viability.reasons].map(String),
    },
  };
}

export function buildKnowledgeDecisionResolutionRequest({
  rootScopeId,
  decisionId,
  asOf,
  options,
} = {}) {
  if (!Array.isArray(options) || options.length < 1 || options.length > 256) {
    throw new Error("options deve conter entre 1 e 256 opções.");
  }
  const body = {
    schema: KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA,
    rootScopeId: safeId(rootScopeId, "rootScopeId"),
    decisionId: safeId(decisionId, "decisionId"),
    asOf: safeTimestamp(asOf, "asOf"),
    options: options.map(assertOption),
  };
  return {
    ...body,
    requestFingerprint: operationFingerprint(body),
  };
}

export function assertKnowledgeDecisionResolutionRequest(value, {
  label = "KnowledgeDecisionResolutionRequest",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA,
    label,
  });
  safeId(value.rootScopeId, `${label}.rootScopeId`);
  safeId(value.decisionId, `${label}.decisionId`);
  safeTimestamp(value.asOf, `${label}.asOf`);
  if (!Array.isArray(value.options) || value.options.length < 1 || value.options.length > 256) {
    throw new Error(`${label}.options deve conter entre 1 e 256 opções.`);
  }
  const ids = value.options.map(assertOption);
  if (new Set(ids.map((option) => option.id)).size !== ids.length) throw new Error(`${label}.options não pode repetir IDs.`);
  const expectedFingerprint = operationFingerprint({
    schema: KNOWLEDGE_DECISION_RESOLUTION_REQUEST_SCHEMA,
    rootScopeId: value.rootScopeId,
    decisionId: value.decisionId,
    asOf: value.asOf,
    options: ids,
  });
  if (value.requestFingerprint !== expectedFingerprint) throw new Error(`${label}.requestFingerprint divergente.`);
  return { ...value, options: ids };
}

function preferenceRank(option) {
  return [
    AUTHORITIES[option.preference.authority],
    option.preference.scopeDepth,
    option.preference.supersedes ? 1 : 0,
    option.preference.revision,
    option.preference.evidenceStrength,
  ];
}

function compareOptions(left, right) {
  const leftRank = preferenceRank(left);
  const rightRank = preferenceRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  return left.id.localeCompare(right.id);
}

function unresolvedConflict(options) {
  const grouped = new Map();
  for (const option of options) {
    const key = option.preference.conflictSet;
    if (!key || option.preference.valueHash == null) continue;
    const list = grouped.get(key) ?? [];
    list.push(option);
    grouped.set(key, list);
  }
  for (const [conflictSet, entries] of grouped) {
    const top = [...entries].sort(compareOptions);
    const first = top[0];
    const conflicting = top.filter((entry) =>
      entry.preference.valueHash !== first.preference.valueHash
      && AUTHORITIES[entry.preference.authority] === AUTHORITIES[first.preference.authority]
      && entry.preference.scopeDepth === first.preference.scopeDepth
      && entry.preference.supersedes === first.preference.supersedes,
    );
    if (conflicting.length > 0) return { conflictSet, optionIds: [first, ...conflicting].map((entry) => entry.id).sort() };
  }
  return null;
}

export function resolveKnowledgeDecision(value) {
  const request = assertKnowledgeDecisionResolutionRequest(value);
  const admissible = request.options.filter((option) => option.admissibility.status === "allowed");
  const blocked = request.options.filter((option) => option.admissibility.status === "blocked");
  const ranked = [...admissible].sort(compareOptions);
  const conflict = unresolvedConflict(ranked);
  let status = "no-admissible-option";
  let selectedOptionId = null;
  let reason = blocked.length > 0 && admissible.length === 0
    ? "todas as opções falharam no eixo de admissibilidade"
    : "nenhuma opção admissível foi encontrada";
  let requiresReplan = false;
  if (conflict) {
    status = "unresolved-conflict";
    reason = `conflito não resolvido no conjunto ${conflict.conflictSet}`;
  } else if (ranked.length > 0) {
    const preferred = ranked[0];
    if (preferred.viability.status !== "available") {
      status = "blocked-viability";
      reason = "a opção preferida é admissível, mas inviável no snapshot atual";
      requiresReplan = true;
    } else {
      status = "selected";
      selectedOptionId = preferred.id;
      reason = "opção admissível e viável com maior precedência determinística";
    }
  }
  const body = {
    schema: KNOWLEDGE_DECISION_RESOLUTION_SCHEMA,
    rootScopeId: request.rootScopeId,
    decisionId: request.decisionId,
    asOf: request.asOf,
    requestFingerprint: request.requestFingerprint,
    status,
    selectedOptionId,
    admissibleOptionIds: admissible.map((option) => option.id).sort(),
    blockedOptionIds: blocked.map((option) => option.id).sort(),
    rankedOptionIds: ranked.map((option) => option.id),
    viableAlternativeIds: ranked.filter((option) => option.viability.status === "available").map((option) => option.id),
    reason,
    requiresHumanDecision: status !== "selected",
    requiresReplan,
    changed: false,
    providerCalls: 0,
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertKnowledgeDecisionResolution(value, {
  label = "KnowledgeDecisionResolution",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_DECISION_RESOLUTION_SCHEMA,
    label,
  });
  if (value.changed !== false || value.providerCalls !== 0) throw new Error(`${label} não pode declarar mutação ou chamada de provider.`);
  if (value.requiresHumanDecision !== (value.status !== "selected")) throw new Error(`${label}.requiresHumanDecision divergente.`);
  if (value.requiresReplan !== (value.status === "blocked-viability")) throw new Error(`${label}.requiresReplan divergente.`);
  const { fingerprint, ...body } = value;
  if (fingerprint !== operationFingerprint(body)) throw new Error(`${label}.fingerprint divergente.`);
  return value;
}
