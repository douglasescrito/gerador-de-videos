import { operationFingerprint } from "./pipeline-operation.mjs";
import { buildTimelinePreview } from "./timeline-preview.mjs";
import {
  assertCreativeConsolePreferenceRanker,
  assertCreativeConsoleReleaseGovernance,
  assertCreativeConsoleRetrievalEvaluation,
} from "./creative-console-contracts.mjs";

export const CREATIVE_CONSOLE_SCHEMA = "mkt-videos/creative-console-snapshot@1";

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function safeId(value, label) {
  const normalized = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/.test(normalized) || /[\\/]/.test(normalized)) throw new Error(`${label} contém path ou identificador inválido.`);
  return normalized;
}

function countBy(values) {
  return Object.fromEntries([...new Set(values)].sort().map((key) => [key, values.filter((value) => value === key).length]));
}

function summarizeKnowledge({ context = null, trace = null } = {}) {
  const items = Array.isArray(context?.appliedItems) ? context.appliedItems : [];
  const exclusions = Array.isArray(trace?.exclusions) ? trace.exclusions : [];
  const conflicts = Array.isArray(trace?.conflicts) ? trace.conflicts : (Array.isArray(context?.conflicts) ? context.conflicts : []);
  const overrides = Array.isArray(trace?.overrides) ? trace.overrides : (Array.isArray(context?.overrides) ? context.overrides : []);
  return {
    present: Boolean(context || trace),
    contextSchema: context?.schema ?? null,
    contextHash: context?.hash ?? null,
    retrievalTraceId: trace?.traceId ?? context?.retrievalTraceId ?? null,
    retrievalTraceHash: trace?.hash ?? null,
    releaseId: context?.releaseId ?? trace?.releaseId ?? null,
    appliedItemCount: items.length,
    appliedItemIds: items.map((item, index) => safeId(item?.itemId ?? item?.id ?? `item-${index + 1}`, `knowledge.appliedItemIds[${index}]`)).sort(),
    excludedItemCount: exclusions.length,
    conflictCount: conflicts.length,
    overrideCount: overrides.length,
    authority: context?.authority ?? "none",
    plannerInfluence: context?.plannerInfluence ?? "none",
  };
}

function summarizePlan(plan) {
  if (!plan) return { present: false };
  if (plan.schema !== "mkt-videos/execution-plan@1") throw new Error("Creative Console exige execution-plan@1.");
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const nodeKinds = nodes.map((node) => String(node.kind ?? "unknown"));
  const paidNodes = nodes.filter((node) => node.executionClass === "paid" || node.provider != null && node.executionClass !== "local");
  const localNodes = nodes.filter((node) => node.executionClass === "local");
  const blockedNodes = nodes.filter((node) => node.status === "blocked" || node.governance?.status === "blocked");
  const timelinePreview = ["mkt-videos/timeline@1", "mkt-videos/timeline@2", "mkt-videos/motion-ir@1"].includes(plan.timeline?.schema)
    ? buildTimelinePreview({ timeline: plan.timeline })
    : null;
  return {
    present: true,
    schema: plan.schema,
    fingerprint: text(plan.fingerprint, "plan.fingerprint"),
    timelineFingerprint: plan.timeline?.fingerprint ?? null,
    timelinePreview,
    nodeCount: nodes.length,
    nodeKinds: countBy(nodeKinds),
    paidNodeCount: paidNodes.length,
    localNodeCount: localNodes.length,
    blockedNodeCount: blockedNodes.length,
    nodeIds: nodes.map((node, index) => safeId(node?.id ?? `node-${index + 1}`, `plan.nodeIds[${index}]`)).sort(),
    budget: {
      paidCalls: Number.isFinite(Number(plan.budget?.paidCalls)) ? Number(plan.budget.paidCalls) : null,
      estimatedSeconds: Number.isFinite(Number(plan.budget?.estimatedSeconds)) ? Number(plan.budget.estimatedSeconds) : null,
      estimateHash: plan.budget?.estimateHash ?? null,
    },
    knowledgeContextHash: plan.governance?.knowledgeContextHash ?? plan.knowledgeContextHash ?? null,
  };
}

function summarizeCapabilities(capabilityMap) {
  const entries = Array.isArray(capabilityMap?.providers)
    ? capabilityMap.providers
    : Array.isArray(capabilityMap?.capabilities) ? capabilityMap.capabilities : [];
  return {
    sourceSchema: capabilityMap?.schema ?? null,
    checkedAt: capabilityMap?.checkedAt ?? null,
    entries: entries.map((entry, index) => ({
      id: safeId(entry?.id ?? `capability-${index + 1}`, `capabilities[${index}].id`),
      status: entry?.status ?? null,
      operations: Array.isArray(entry?.operations) ? [...new Set(entry.operations.map(String))].sort() : [],
      authContract: entry?.authContract ?? null,
      deliveryDependencyAllowed: entry?.deliveryDependencyAllowed === true,
      health: entry?.health?.status ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function summarizeFeedback({ promotionQueue = null, feedbackSummary = null } = {}) {
  const entries = Array.isArray(promotionQueue?.items) ? promotionQueue.items : Array.isArray(promotionQueue) ? promotionQueue : [];
  return {
    present: Boolean(promotionQueue || feedbackSummary),
    queueSchema: promotionQueue?.schema ?? null,
    pendingCount: entries.length,
    pendingIds: entries.map((entry, index) => safeId(entry?.candidateId ?? entry?.id ?? `candidate-${index + 1}`, `feedback.pendingIds[${index}]`)).sort(),
    summary: feedbackSummary && typeof feedbackSummary === "object" ? {
      captured: Number.isFinite(Number(feedbackSummary.captured)) ? Number(feedbackSummary.captured) : null,
      promoted: Number.isFinite(Number(feedbackSummary.promoted)) ? Number(feedbackSummary.promoted) : null,
      pending: Number.isFinite(Number(feedbackSummary.pending)) ? Number(feedbackSummary.pending) : null,
    } : null,
  };
}

function summarizeEvaluation(evaluation) {
  if (evaluation == null) {
    return { present: false };
  }
  const value = assertCreativeConsoleRetrievalEvaluation(evaluation, {
    label: "CreativeConsole.retrievalEvaluation",
  });
  return {
    present: true,
    schema: value.schema,
    evaluationId: value.evaluationId,
    rankerVersion: value.rankerVersion,
    caseCount: value.caseCount,
    acceptedCaseCount: value.acceptedCaseCount,
    mismatchedCaseCount: value.mismatchedCaseCount,
    zeroLeakage: value.zeroLeakage,
    leakageCount: value.leakageCount,
    overrideCount: value.overrideCount,
    unresolvedConflictCount: value.unresolvedConflictCount,
    plannerInfluenceViolations: value.plannerInfluenceViolations,
    acceptanceRate: value.acceptanceRate,
    overrideRate: value.overrideRate,
    hash: value.hash,
  };
}

function summarizeReleaseGovernance(value) {
  if (value == null) return { present: false };
  const lifecycle = assertCreativeConsoleReleaseGovernance(value);
  return {
    present: true,
    action: lifecycle.action,
    status: lifecycle.status,
    eligible: lifecycle.eligible,
    release: lifecycle.release == null ? null : {
      id: lifecycle.release.id,
      hash: lifecycle.release.hash,
      memberCount: lifecycle.release.memberCount,
    },
    issueTypes: lifecycle.issues.map((issue) => String(issue.type)).sort(),
  };
}

function summarizePreferenceRanker(value) {
  if (value == null) return { present: false };
  const report = assertCreativeConsolePreferenceRanker(value, {
    label: "CreativeConsole.preferenceRankerShadow",
  });
  return {
    present: true,
    rankerVersion: report.rankerVersion,
    status: report.status,
    rankedOptionIds: [...report.rankedOptionIds].sort(),
    selectedOptionId: report.selectedOptionId,
    viableAlternativeIds: [...report.viableAlternativeIds].sort(),
    admissibleOptionIds: [...report.admissibleOptionIds].sort(),
    blockedOptionIds: [...report.blockedOptionIds].sort(),
    requiresHumanDecision: report.requiresHumanDecision,
    requiresReplan: report.requiresReplan,
    fingerprint: report.fingerprint,
  };
}

export function buildCreativeConsoleSnapshot({ plan = null, knowledgeContext = null, retrievalTrace = null, capabilities = null, promotionQueue = null, feedbackSummary = null, retrievalEvaluation = null, releaseGovernance = null, preferenceRankerShadow = null } = {}) {
  const body = {
    schema: CREATIVE_CONSOLE_SCHEMA,
    mode: "read-only",
    knowledge: summarizeKnowledge({ context: knowledgeContext, trace: retrievalTrace }),
    plan: summarizePlan(plan),
    capabilities: summarizeCapabilities(capabilities),
    feedback: summarizeFeedback({ promotionQueue, feedbackSummary }),
    evaluation: summarizeEvaluation(retrievalEvaluation),
    releaseGovernance: summarizeReleaseGovernance(releaseGovernance),
    preferenceRanker: summarizePreferenceRanker(preferenceRankerShadow),
    actions: {
      changed: false,
      providerCalls: 0,
      canExecute: false,
      canPromoteKnowledge: false,
      canApproveDraft: false,
      requiresHumanDecision: true,
    },
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertCreativeConsoleSnapshot(value) {
  if (!value || value.schema !== CREATIVE_CONSOLE_SCHEMA) throw new Error("Creative Console snapshot inválido.");
  if (value.mode !== "read-only") throw new Error("Creative Console snapshot deve ser read-only.");
  if (value.actions?.changed !== false || value.actions?.providerCalls !== 0) throw new Error("Creative Console snapshot não pode declarar mutação ou chamada de provider.");
  const { fingerprint, ...body } = value;
  if (fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint do Creative Console snapshot divergente.");
  return true;
}
