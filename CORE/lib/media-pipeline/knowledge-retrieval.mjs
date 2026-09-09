import { createHash } from "node:crypto";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA =
  "mkt-videos/knowledge-retrieval-request@1";
export const KNOWLEDGE_RETRIEVAL_TRACE_SCHEMA =
  "mkt-videos/retrieval-trace@1";
export const KNOWLEDGE_CONTEXT_SCHEMA =
  "mkt-videos/knowledge-context@1";
export const KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-retrieval-action-result@1";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const MAX_QUERY_BYTES = 16 * 1024;
const MAX_SCOPE_IDS = 32;
const MAX_LIMIT = 50;
const RANKER_VERSION = "lexical-ranker@1";

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Retrieval contém número não finito.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Retrieval aceita somente valores JSON.");
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]),
    );
  }
  throw new Error("Retrieval aceita somente valores JSON.");
}

export function canonicalKnowledgeRetrievalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256")
    .update(canonicalKnowledgeRetrievalJson(value), "utf8")
    .digest("hex");
}

function requiredId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} é inválido.`);
  return normalized;
}

function assertCanonicalTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} é obrigatório.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} deve ser timestamp ISO-8601 UTC canônico.`);
  }
}

function assertSafeQuery(value, label = "query") {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error(`${label} deve ser texto normalizado.`);
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > MAX_QUERY_BYTES) {
    throw new Error(`${label} deve ocupar entre 1 e ${MAX_QUERY_BYTES} bytes UTF-8.`);
  }
  if (/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} contém controle NUL ou direção bidi proibida.`);
  }
}

export function knowledgeRetrievalRequestHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return sha256(body);
}

export function assertKnowledgeRetrievalRequest(value, {
  label = "KnowledgeRetrievalRequest",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA,
    label,
  });
  requiredId(value.rootScopeId, `${label}.rootScopeId`);
  assertSafeQuery(value.query, `${label}.query`);
  if (value.scopeIds.some((scopeId) => !ID_PATTERN.test(scopeId))) {
    throw new Error(`${label}.scopeIds contém identificador inválido.`);
  }
  assertCanonicalTimestamp(value.asOf, `${label}.asOf`);
  if (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > MAX_LIMIT) {
    throw new Error(`${label}.limit deve estar entre 1 e ${MAX_LIMIT}.`);
  }
  const expectedHash = knowledgeRetrievalRequestHash(value);
  if (value.hash !== expectedHash) {
    throw new Error(`${label}.hash diverge do pedido canônico.`);
  }
  return value;
}

export function retrievalTraceHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return sha256(body);
}

export function knowledgeContextHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return sha256(body);
}

export function retrievalActionResultHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return sha256(body);
}

function scopeDepths(scopes) {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  const cache = new Map();
  const depth = (scopeId, stack = new Set()) => {
    if (cache.has(scopeId)) return cache.get(scopeId);
    const scope = byId.get(scopeId);
    if (!scope) return null;
    if (stack.has(scopeId)) throw new Error("Ciclo detectado na árvore de scopes.");
    const nextStack = new Set(stack).add(scopeId);
    const result = scope.parentScopeId == null
      ? 0
      : (depth(scope.parentScopeId, nextStack) ?? 0) + 1;
    cache.set(scopeId, result);
    return result;
  };
  for (const scope of scopes) depth(scope.id);
  return { byId, cache };
}

function isWithinScope(scopeId, ancestorScopeId, scopesById) {
  let cursor = scopeId;
  const visited = new Set();
  while (cursor != null) {
    if (visited.has(cursor)) throw new Error("Ciclo detectado na árvore de scopes.");
    visited.add(cursor);
    if (cursor === ancestorScopeId) return true;
    cursor = scopesById.get(cursor)?.parentScopeId ?? null;
  }
  return false;
}

function queryTerms(query) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("pt-BR");
  const matches = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(matches)].sort(compareText).slice(0, 64);
}

function releaseMemberMap(release) {
  return new Map((release?.members ?? []).map((member) => [
    member.id,
    member,
  ]));
}

function evidenceStrength(item) {
  return Array.isArray(item.governance?.evidenceIds)
    ? item.governance.evidenceIds.length
    : 0;
}

function authorityValue(item) {
  return {
    "hard-constraint": 4,
    fact: 3,
    preference: 2,
    heuristic: 1,
    observation: 1,
  }[item.governance?.modality] ?? 0;
}

function specificityValue(item, depthById) {
  return Number(depthById.get(item.scopeId) ?? 0);
}

function dateRecency(item, asOf) {
  const created = Date.parse(item.createdAt);
  const evaluated = Date.parse(asOf);
  if (!Number.isFinite(created) || !Number.isFinite(evaluated) || created > evaluated) return 0;
  const days = Math.max(0, (evaluated - created) / 86_400_000);
  return Number((1 / (1 + days)).toFixed(6));
}

function itemDecisionDescriptor(item) {
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (typeof payload.predicate !== "string" || payload.subjectRef == null) return null;
  const applicability = payload.applicability;
  const applicabilityScope = applicability && typeof applicability === "object"
    ? applicability.scopeId ?? item.scopeId
    : item.scopeId;
  const subject = payload.subjectRef;
  const subjectKey = `${subject.kind ?? "unknown"}:${subject.id ?? "unknown"}`;
  return {
    key: `${subjectKey}|${payload.predicate}|${applicability?.mode ?? "scope"}:${applicabilityScope}`,
    polarity: payload.polarity ?? "positive",
    value: payload.value,
    applicabilityScope,
  };
}

function compareDecisionItems(left, right, scopesById, depthById) {
  const leftDecision = itemDecisionDescriptor(left.item);
  const rightDecision = itemDecisionDescriptor(right.item);
  if (!leftDecision || !rightDecision || leftDecision.key !== rightDecision.key) return null;
  const sameValue = leftDecision.polarity === rightDecision.polarity
    && canonicalKnowledgeRetrievalJson(leftDecision.value)
      === canonicalKnowledgeRetrievalJson(rightDecision.value);
  if (sameValue) {
    return {
      status: "compatible",
      comparator: "typed-json@1",
      itemIds: [left.item.id, right.item.id].sort(compareText),
      decisionKey: leftDecision.key,
      winnerItemId: null,
      reason: "mesma polaridade e mesmo valor canônico",
    };
  }
  const leftDepth = Number(depthById.get(left.item.scopeId) ?? 0);
  const rightDepth = Number(depthById.get(right.item.scopeId) ?? 0);
  if (
    leftDepth !== rightDepth
    && isWithinScope(left.item.scopeId, right.item.scopeId, scopesById)
  ) {
    return {
      status: "resolved-override",
      comparator: "scope-specificity@1",
      itemIds: [left.item.id, right.item.id].sort(compareText),
      decisionKey: leftDecision.key,
      winnerItemId: left.item.id,
      reason: "scope mais específico prevalece sobre regra ancestral",
    };
  }
  if (
    leftDepth !== rightDepth
    && isWithinScope(right.item.scopeId, left.item.scopeId, scopesById)
  ) {
    return {
      status: "resolved-override",
      comparator: "scope-specificity@1",
      itemIds: [left.item.id, right.item.id].sort(compareText),
      decisionKey: leftDecision.key,
      winnerItemId: right.item.id,
      reason: "scope mais específico prevalece sobre regra ancestral",
    };
  }
  return {
    status: "unresolved-conflict",
    comparator: "typed-json@1",
    itemIds: [left.item.id, right.item.id].sort(compareText),
    decisionKey: leftDecision.key,
    winnerItemId: null,
    reason: "valores incompatíveis sem precedência tipada",
  };
}

function exclusion(item, reason) {
  return {
    itemId: item?.id ?? null,
    revision: item?.revision ?? null,
    reason,
  };
}

function buildTraceAndContext({
  request,
  release,
  eligibleItems,
  candidates,
  hits,
  exclusions,
  conflicts,
  overrides,
  indexFingerprint,
  scopeIds,
  rationale,
}) {
  const requestHash = knowledgeRetrievalRequestHash(request);
  const traceIdentity = {
    schema: KNOWLEDGE_RETRIEVAL_TRACE_SCHEMA,
    rootScopeId: request.rootScopeId,
    requestHash,
    asOf: request.asOf,
    mode: request.mode,
    rankerVersion: RANKER_VERSION,
    indexFingerprint,
    filters: {
      scopeIds,
      textualIndexing: "allowed",
      releaseId: release?.id ?? null,
    },
    candidateCount: candidates.length,
    eligibleCount: eligibleItems.length,
    returnedCount: hits.length,
    hits,
    exclusions: exclusions.sort((left, right) =>
      compareText(String(left.itemId), String(right.itemId))
      || Number(left.revision ?? 0) - Number(right.revision ?? 0)
      || compareText(left.reason, right.reason)),
    conflicts,
    rationale,
  };
  const traceId = `rt_${sha256(traceIdentity).slice(0, 32)}`;
  const trace = {
    ...traceIdentity,
    traceId,
    hash: retrievalTraceHash({ ...traceIdentity, traceId }),
  };
  const excludedByKey = new Map(
    trace.exclusions.map((entry) => [`${entry.itemId}@${entry.revision}`, entry]),
  );
  const appliedItems = hits
    .filter((hit) => !excludedByKey.has(`${hit.itemId}@${hit.revision}`))
    .map((hit) => ({
      id: hit.itemId,
      revision: hit.revision,
      contentHash: hit.contentHash,
      reason: hit.reason,
    }));
  const contextIdentity = {
    schema: KNOWLEDGE_CONTEXT_SCHEMA,
    rootScopeId: request.rootScopeId,
    releaseId: release?.id ?? null,
    releaseHash: release?.hash ?? null,
    requestHash,
    scope: { rootScopeId: request.rootScopeId, scopeIds },
    appliedItems,
    excludedItems: trace.exclusions,
    conflicts,
    overrides,
    retrievalTraceId: trace.traceId,
    rankerVersion: RANKER_VERSION,
    rationale,
    authority: "none",
    plannerInfluence: "none",
  };
  const contextId = `kc_${sha256(contextIdentity).slice(0, 32)}`;
  const context = {
    ...contextIdentity,
    contextId,
    hash: knowledgeContextHash({ ...contextIdentity, contextId }),
  };
  return { trace, context };
}

export function buildKnowledgeRetrievalShadow({
  request: requestValue,
  scopes = [],
  items = [],
  activeRelease = null,
  ftsSearch = null,
} = {}) {
  const request = assertKnowledgeRetrievalRequest(requestValue);
  const { byId: scopesById, cache: depthById } = scopeDepths(scopes);
  const requestedScopeIds = [...request.scopeIds].sort(compareText);
  for (const scopeId of requestedScopeIds) {
    if (!scopesById.has(scopeId)) throw new Error(`scopeId inexistente no root: ${scopeId}.`);
  }
  if (activeRelease != null) {
    if (activeRelease.rootScopeId !== request.rootScopeId) {
      throw new Error("Release ativa diverge do root do retrieval.");
    }
    if (request.releaseId != null && request.releaseId !== activeRelease.id) {
      throw new Error("releaseId solicitado não é a release ativa.");
    }
  } else if (request.releaseId != null) {
    throw new Error("releaseId solicitado não possui ativação corrente.");
  }
  const memberById = releaseMemberMap(activeRelease);
  const candidates = [...items].sort((left, right) =>
    compareText(left.id, right.id) || Number(left.revision) - Number(right.revision));
  const exclusions = [];
  const eligible = [];
  if (activeRelease == null) {
    exclusions.push(exclusion(null, "no-active-release"));
  }
  for (const item of candidates) {
    if (item.rootScopeId !== request.rootScopeId) {
      exclusions.push(exclusion(item, "root-filter"));
      continue;
    }
    const member = memberById.get(item.id);
    if (!member || Number(member.revision) !== Number(item.revision)) {
      exclusions.push(exclusion(item, "not-in-active-release"));
      continue;
    }
    if (item.status !== "active") {
      exclusions.push(exclusion(item, `status:${item.status}`));
      continue;
    }
    const itemScope = scopesById.get(item.scopeId);
    if (!itemScope || itemScope.status !== "active") {
      exclusions.push(exclusion(item, "scope-inactive-or-missing"));
      continue;
    }
    if (requestedScopeIds.length > 0 && !requestedScopeIds.some((scopeId) =>
      isWithinScope(item.scopeId, scopeId, scopesById))) {
      exclusions.push(exclusion(item, "scope-filter"));
      continue;
    }
    if (item.governance?.rights?.textualIndexing !== "allowed") {
      exclusions.push(exclusion(item, "rights.textualIndexing-not-allowed"));
      continue;
    }
    if (
      item.governance?.retention?.expiresAt != null
      && Date.parse(item.governance.retention.expiresAt) <= Date.parse(request.asOf)
    ) {
      exclusions.push(exclusion(item, "retention-expired"));
      continue;
    }
    eligible.push(item);
  }
  const terms = queryTerms(request.query);
  const indexFingerprint = sha256({
    rankerVersion: RANKER_VERSION,
    documents: eligible.map((item) => ({
      id: item.id,
      revision: item.revision,
      contentHash: item.contentHash,
    })),
  });
  let rows = [];
  if (terms.length > 0 && eligible.length > 0 && typeof ftsSearch === "function") {
    rows = ftsSearch({ items: eligible, terms, limit: request.limit });
  }
  const itemByKey = new Map(eligible.map((item) => [`${item.id}@${item.revision}`, item]));
  const hits = rows.map((row, index) => {
    const item = itemByKey.get(`${row.item_id}@${row.revision}`);
    const lexicalScore = Number((-Number(row.bm25)).toFixed(6));
    return {
      itemId: item.id,
      revision: item.revision,
      scopeId: item.scopeId,
      recordType: item.recordType,
      schemaId: item.schemaId,
      contentHash: item.contentHash,
      lexicalRank: index + 1,
      lexicalScore: Number.isFinite(lexicalScore) ? lexicalScore : 0,
      components: {
        authority: authorityValue(item),
        specificity: specificityValue(item, depthById),
        evidenceStrength: evidenceStrength(item),
        recency: dateRecency(item, request.asOf),
      },
      reason: `${typeof ftsSearch === "function" ? "FTS5/BM25" : "lexical-shadow"}; termos=${terms.join(",")}; textualIndexing=allowed`,
    };
  });
  const overrides = [];
  for (let leftIndex = 0; leftIndex < hits.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < hits.length; rightIndex += 1) {
      const comparison = compareDecisionItems(
        { item: itemByKey.get(`${hits[leftIndex].itemId}@${hits[leftIndex].revision}`) },
        { item: itemByKey.get(`${hits[rightIndex].itemId}@${hits[rightIndex].revision}`) },
        scopesById,
        depthById,
      );
      if (!comparison) continue;
      if (comparison.status === "resolved-override") {
        const loser = comparison.itemIds.find((id) => id !== comparison.winnerItemId);
        const loserHit = hits.find((hit) => hit.itemId === loser);
        if (loserHit) {
          exclusions.push({
            itemId: loserHit.itemId,
            revision: loserHit.revision,
            reason: "conflict-override",
          });
        }
        overrides.push(comparison);
      } else if (comparison.status === "unresolved-conflict") {
        for (const id of comparison.itemIds) {
          const conflictHit = hits.find((hit) => hit.itemId === id);
          if (conflictHit) {
            exclusions.push({
              itemId: conflictHit.itemId,
              revision: conflictHit.revision,
              reason: "unresolved-conflict",
            });
          }
        }
      }
    }
  }
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < hits.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < hits.length; rightIndex += 1) {
      const comparison = compareDecisionItems(
        { item: itemByKey.get(`${hits[leftIndex].itemId}@${hits[leftIndex].revision}`) },
        { item: itemByKey.get(`${hits[rightIndex].itemId}@${hits[rightIndex].revision}`) },
        scopesById,
        depthById,
      );
      if (comparison && comparison.status !== "compatible") conflicts.push(comparison);
    }
  }
  conflicts.sort((left, right) =>
    compareText(left.decisionKey, right.decisionKey)
    || compareText(left.itemIds.join(","), right.itemIds.join(",")));
  const uniqueExclusions = [...new Map(
    exclusions.map((entry) => [
      `${entry.itemId}@${entry.revision}@${entry.reason}`,
      entry,
    ]),
  ).values()];
  const rationale = terms.length === 0
    ? "Nenhum termo lexical indexável foi encontrado no brief; nenhum item foi aplicado."
    : `${typeof ftsSearch === "function" ? "Shadow lexical provider-free: FTS5/BM25" : "Shadow lexical provider-free sem índice"} após filtros de release, scope, status, retenção e textualIndexing; sem influência no planner.`;
  const { trace, context } = buildTraceAndContext({
    request,
    release: activeRelease,
    eligibleItems: eligible,
    candidates,
    hits,
    exclusions: uniqueExclusions,
    conflicts,
    overrides,
    indexFingerprint,
    scopeIds: requestedScopeIds,
    rationale,
  });
  return { trace, context };
}

export function assertKnowledgeRetrievalTrace(value, {
  label = "RetrievalTrace",
} = {}) {
  const trace = assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_RETRIEVAL_TRACE_SCHEMA,
    label,
  });
  if (!HASH_PATTERN.test(trace.hash) || retrievalTraceHash(trace) !== trace.hash) {
    throw new Error(`${label}.hash diverge do trace canônico.`);
  }
  return trace;
}

export function assertKnowledgeContext(value, {
  label = "KnowledgeContext",
} = {}) {
  const context = assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_CONTEXT_SCHEMA,
    label,
  });
  if (!HASH_PATTERN.test(context.hash) || knowledgeContextHash(context) !== context.hash) {
    throw new Error(`${label}.hash diverge do contexto canônico.`);
  }
  return context;
}

export function assertKnowledgeRetrievalActionResult(value, {
  label = "KnowledgeRetrievalActionResult",
} = {}) {
  const result = assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA,
    label,
  });
  if (!HASH_PATTERN.test(result.hash) || retrievalActionResultHash(result) !== result.hash) {
    throw new Error(`${label}.hash diverge do resultado canônico.`);
  }
  assertKnowledgeRetrievalTrace(result.trace, { label: `${label}.trace` });
  assertKnowledgeContext(result.context, { label: `${label}.context` });
  return result;
}

export const KNOWLEDGE_RETRIEVAL_EVALUATION_SCHEMA =
  "mkt-videos/retrieval-shadow-evaluation@1";

export function retrievalEvaluationHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return sha256(body);
}

export function buildRetrievalShadowEvaluation({
  rootScopeId,
  cases = [],
} = {}) {
  const normalizedRoot = requiredId(rootScopeId, "rootScopeId");
  if (!Array.isArray(cases)) throw new Error("cases deve ser um array.");
  const projectedCases = cases.map((entry, index) => {
    const id = requiredId(entry?.id, `cases[${index}].id`);
    const trace = assertKnowledgeRetrievalTrace(entry?.trace, `cases[${index}].trace`);
    const context = assertKnowledgeContext(entry?.context, `cases[${index}].context`);
    const expectedItemIds = [...new Set((entry?.expectedItemIds ?? []).map((value) =>
      requiredId(value, `cases[${index}].expectedItemIds`)))].sort(compareText);
    const appliedItemIds = context.appliedItems.map((item) => item.id).sort(compareText);
    const leakage = trace.rootScopeId !== normalizedRoot
      || context.rootScopeId !== normalizedRoot
      || trace.requestHash !== context.requestHash
      || context.scope.rootScopeId !== normalizedRoot;
    const plannerInfluence = context.plannerInfluence;
    const accepted = !leakage
      && plannerInfluence === "none"
      && canonicalKnowledgeRetrievalJson(expectedItemIds)
        === canonicalKnowledgeRetrievalJson(appliedItemIds);
    return {
      id,
      requestHash: trace.requestHash,
      traceId: trace.traceId,
      contextId: context.contextId,
      expectedItemIds,
      appliedItemIds,
      accepted,
      leakage,
      overrideCount: context.overrides.length,
      unresolvedConflictCount: trace.conflicts
        .filter((conflict) => conflict.status === "unresolved-conflict").length,
      plannerInfluence,
    };
  }).sort((left, right) => compareText(left.id, right.id));
  const caseCount = projectedCases.length;
  const acceptedCaseCount = projectedCases.filter((entry) => entry.accepted).length;
  const leakageCount = projectedCases.filter((entry) => entry.leakage).length;
  const overrideCount = projectedCases.reduce((sum, entry) => sum + entry.overrideCount, 0);
  const unresolvedConflictCount = projectedCases.reduce(
    (sum, entry) => sum + entry.unresolvedConflictCount,
    0,
  );
  const plannerInfluenceViolations = projectedCases.filter((entry) =>
    entry.plannerInfluence !== "none").length;
  const identity = {
    schema: KNOWLEDGE_RETRIEVAL_EVALUATION_SCHEMA,
    rootScopeId: normalizedRoot,
    rankerVersion: RANKER_VERSION,
    caseCount,
    acceptedCaseCount,
    mismatchedCaseCount: caseCount - acceptedCaseCount,
    zeroLeakage: leakageCount === 0,
    leakageCount,
    overrideCount,
    unresolvedConflictCount,
    plannerInfluenceViolations,
    acceptanceRate: caseCount === 0 ? 0 : Number((acceptedCaseCount / caseCount).toFixed(6)),
    overrideRate: caseCount === 0 ? 0 : Number((overrideCount / caseCount).toFixed(6)),
    cases: projectedCases,
  };
  const evaluationId = `rse_${sha256(identity).slice(0, 32)}`;
  const body = { ...identity, evaluationId };
  return {
    ...body,
    hash: retrievalEvaluationHash(body),
  };
}

export function assertKnowledgeRetrievalEvaluation(value, {
  label = "RetrievalShadowEvaluation",
} = {}) {
  const evaluation = assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_RETRIEVAL_EVALUATION_SCHEMA,
    label,
  });
  if (retrievalEvaluationHash(evaluation) !== evaluation.hash) {
    throw new Error(`${label}.hash diverge da avaliação canônica.`);
  }
  return evaluation;
}
