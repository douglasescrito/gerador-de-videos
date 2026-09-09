import assert from "node:assert/strict";
import test from "node:test";
import { assertCreativeConsoleSnapshot, buildCreativeConsoleSnapshot } from "../lib/media-pipeline/creative-console.mjs";
import { buildRetrievalShadowEvaluation, knowledgeContextHash, retrievalTraceHash } from "../lib/media-pipeline/knowledge-retrieval.mjs";
import { buildKnowledgeDecisionResolutionRequest, resolveKnowledgeDecision } from "../lib/media-pipeline/knowledge-decision-resolver.mjs";
import { buildPreferenceRankerShadow } from "../lib/media-pipeline/preference-ranker-shadow.mjs";

function shadowEvaluation() {
  const requestHash = "1".repeat(64);
  const traceBody = {
    schema: "mkt-videos/retrieval-trace@1",
    traceId: "rt_11111111111111111111111111111111",
    rootScopeId: "client-a",
    requestHash,
    asOf: "2026-07-27T12:00:00.000Z",
    mode: "shadow",
    rankerVersion: "lexical-ranker@1",
    indexFingerprint: "2".repeat(64),
    filters: { scopeIds: ["client-a"], textualIndexing: "allowed", releaseId: null },
    candidateCount: 1,
    eligibleCount: 1,
    returnedCount: 1,
    hits: [],
    exclusions: [],
    conflicts: [],
    rationale: "fixture",
  };
  const trace = { ...traceBody, hash: retrievalTraceHash(traceBody) };
  const contextBody = {
    schema: "mkt-videos/knowledge-context@1",
    contextId: "kc_22222222222222222222222222222222",
    rootScopeId: "client-a",
    releaseId: null,
    releaseHash: null,
    requestHash,
    scope: { rootScopeId: "client-a", scopeIds: ["client-a"] },
    appliedItems: [{ id: "rule-a", revision: 1, contentHash: "3".repeat(64), reason: "fixture" }],
    excludedItems: [],
    conflicts: [],
    overrides: [],
    retrievalTraceId: trace.traceId,
    rankerVersion: "lexical-ranker@1",
    rationale: "fixture",
    authority: "none",
    plannerInfluence: "none",
  };
  const context = { ...contextBody, hash: knowledgeContextHash(contextBody) };
  return buildRetrievalShadowEvaluation({
    rootScopeId: "client-a",
    cases: [{ id: "gold-1", expectedItemIds: ["rule-a"], trace, context }],
  });
}

const plan = {
  schema: "mkt-videos/execution-plan@1",
  fingerprint: "plan:fingerprint",
  timeline: { fingerprint: "timeline:fingerprint" },
  nodes: [
    { id: "timeline-lock", kind: "timeline-lock", executionClass: "local" },
    { id: "video:scene-1", kind: "video", executionClass: "paid", provider: "gemini-omni" },
  ],
  budget: { paidCalls: 1, estimatedSeconds: 30, estimateHash: "estimate:hash" },
  governance: { knowledgeContextHash: "context:hash" },
};

test("Creative Console produz snapshot determinístico e somente leitura", () => {
  const value = buildCreativeConsoleSnapshot({
    plan,
    knowledgeContext: {
      schema: "mkt-videos/knowledge-context@1",
      hash: "context:hash",
      releaseId: "release:1",
      appliedItems: [{ itemId: "rule:tempo@1" }],
      authority: "none",
      plannerInfluence: "none",
    },
    retrievalTrace: {
      schema: "mkt-videos/retrieval-trace@1",
      traceId: "trace:1",
      hash: "trace:hash",
      exclusions: [{ itemId: "rule:blocked@1" }],
      conflicts: [{ id: "conflict:1" }],
      overrides: [{ id: "override:1" }],
    },
    capabilities: {
      schema: "mkt-videos/provider-registry@1",
      checkedAt: "2026-07-27T12:00:00.000Z",
      providers: [{ id: "gemini-omni", status: "supported", operations: ["text-to-video"], authContract: "cookie-only-browser-session", deliveryDependencyAllowed: true, health: { status: "ready" } }],
    },
    promotionQueue: { schema: "mkt-videos/feedback-promotion-queue@1", items: [{ candidateId: "candidate:1" }] },
    feedbackSummary: { captured: 3, promoted: 1, pending: 2 },
  });
  assert.equal(value.mode, "read-only");
  assert.equal(value.actions.changed, false);
  assert.equal(value.actions.providerCalls, 0);
  assert.equal(value.knowledge.appliedItemCount, 1);
  assert.equal(value.knowledge.conflictCount, 1);
  assert.equal(value.plan.paidNodeCount, 1);
  assert.equal(value.feedback.present, true);
  assert.deepEqual(value.feedback.pendingIds, ["candidate:1"]);
  assert.deepEqual(value.feedback.summary, { captured: 3, promoted: 1, pending: 2 });
  assert.equal(assertCreativeConsoleSnapshot(value), true);
});

test("snapshot não carrega prompt, path ou payload privado", () => {
  const value = buildCreativeConsoleSnapshot({
    plan: { ...plan, spec: { prompt: "segredo privado", source: "C:\\private\\file.json" } },
    knowledgeContext: { appliedItems: [{ itemId: "rule:safe@1", statement: "não deve entrar" }] },
    capabilities: { providers: [{ id: "local", status: "supported", operations: [], health: { status: "ready" } }] },
  });
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /segredo privado|private|file\.json|statement|prompt/i);
});

test("snapshot adulterado ou mutável falha fechado", () => {
  const value = buildCreativeConsoleSnapshot();
  assert.throws(() => assertCreativeConsoleSnapshot({ ...value, actions: { ...value.actions, changed: true } }), /mutação/);
  assert.throws(() => assertCreativeConsoleSnapshot({ ...value, fingerprint: "0".repeat(64) }), /Fingerprint/);
});

test("snapshot projeta avaliação shadow sem expor casos privados", () => {
  const evaluation = shadowEvaluation();
  const value = buildCreativeConsoleSnapshot({ retrievalEvaluation: evaluation });
  assert.equal(value.evaluation.present, true);
  assert.equal(value.evaluation.acceptanceRate, 1);
  assert.equal(value.evaluation.zeroLeakage, true);
  assert.equal(value.evaluation.hash, evaluation.hash);
  assert.equal(Object.hasOwn(value.evaluation, "cases"), false);
  assert.equal(assertCreativeConsoleSnapshot(value), true);
});

test("avaliação shadow inválida falha antes de entrar no snapshot", () => {
  assert.throws(() => buildCreativeConsoleSnapshot({ retrievalEvaluation: { schema: "mkt-videos/retrieval-shadow-evaluation@1" } }), /CreativeConsole\.retrievalEvaluation/);
});

test("snapshot projeta somente o relatório active-release e bloqueia lifecycle mutável", () => {
  const value = buildCreativeConsoleSnapshot({
    releaseGovernance: {
      schema: "mkt-videos/knowledge-release-lifecycle-result@1",
      action: "active-release",
      status: "active",
      providerFree: true,
      readOnly: true,
      changed: false,
      humanConfirmed: false,
      rootScopeId: "client-a",
      release: { id: "release:one", hash: "a".repeat(64), memberCount: 3 },
      activation: null,
      eligible: true,
      issues: [],
    },
  });
  assert.equal(value.releaseGovernance.present, true);
  assert.equal(value.releaseGovernance.eligible, true);
  assert.deepEqual(value.releaseGovernance.release, { id: "release:one", hash: "a".repeat(64), memberCount: 3 });
  assert.equal(assertCreativeConsoleSnapshot(value), true);
  assert.throws(() => buildCreativeConsoleSnapshot({
    releaseGovernance: {
      schema: "mkt-videos/knowledge-release-lifecycle-result@1",
      action: "activate-release",
      status: "activated",
      providerFree: true,
      readOnly: false,
      changed: true,
      humanConfirmed: true,
      rootScopeId: "client-a",
      release: { id: "release:one", hash: "a".repeat(64), memberCount: 3 },
      activation: null,
      eligible: true,
      issues: [],
    },
  }), /active-release/);
});

test("snapshot projeta a decisão shadow sem expor valores de preferência", () => {
  const option = (id, authority, scopeDepth) => ({
    id,
    admissibility: { status: "allowed", reasons: ["rights-current"] },
    preference: { authority, scopeDepth, supersedes: false, revision: 1, evidenceStrength: 1, conflictSet: null, valueHash: null },
    viability: { status: "available", reasons: ["local-capability"] },
  });
  const request = buildKnowledgeDecisionResolutionRequest({
    rootScopeId: "client-a",
    decisionId: "decision:direction",
    asOf: "2026-07-27T12:00:00.000Z",
    options: [option("model", "model-suggestion", 0), option("client", "client-preference", 1)],
  });
  const resolution = resolveKnowledgeDecision(request);
  const shadow = buildPreferenceRankerShadow({ request, resolution });
  const value = buildCreativeConsoleSnapshot({ preferenceRankerShadow: shadow });
  assert.equal(value.preferenceRanker.present, true);
  assert.equal(value.preferenceRanker.status, "selected");
  assert.equal(value.preferenceRanker.selectedOptionId, "client");
  assert.deepEqual(value.preferenceRanker.rankedOptionIds, ["client", "model"]);
  assert.equal(JSON.stringify(value).includes("valueHash"), false);
  assert.equal(assertCreativeConsoleSnapshot(value), true);
});
