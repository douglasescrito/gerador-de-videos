import { operationFingerprint } from "./pipeline-operation.mjs";
import {
  assertKnowledgeDecisionResolution,
  assertKnowledgeDecisionResolutionRequest,
} from "./knowledge-decision-resolver.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const PREFERENCE_RANKER_SHADOW_SCHEMA =
  "mkt-videos/preference-ranker-shadow@1";
export const PREFERENCE_RANKER_VERSION = "precedence-ranker@1";

export function buildPreferenceRankerShadow({ request, resolution } = {}) {
  const normalizedRequest = assertKnowledgeDecisionResolutionRequest(request, {
    label: "PreferenceRankerShadow.request",
  });
  const normalizedResolution = assertKnowledgeDecisionResolution(resolution, {
    label: "PreferenceRankerShadow.resolution",
  });
  if (
    normalizedResolution.requestFingerprint
      !== normalizedRequest.requestFingerprint
  ) {
    throw new Error(
      "PreferenceRankerShadow exige request e resolution do mesmo fingerprint.",
    );
  }
  const body = {
    schema: PREFERENCE_RANKER_SHADOW_SCHEMA,
    rankerVersion: PREFERENCE_RANKER_VERSION,
    rootScopeId: normalizedRequest.rootScopeId,
    decisionId: normalizedRequest.decisionId,
    asOf: normalizedRequest.asOf,
    requestFingerprint: normalizedRequest.requestFingerprint,
    resolutionFingerprint: normalizedResolution.fingerprint,
    status: normalizedResolution.status,
    rankedOptionIds: [...normalizedResolution.rankedOptionIds],
    selectedOptionId: normalizedResolution.selectedOptionId,
    viableAlternativeIds: [...normalizedResolution.viableAlternativeIds],
    admissibleOptionIds: [...normalizedResolution.admissibleOptionIds],
    blockedOptionIds: [...normalizedResolution.blockedOptionIds],
    requiresHumanDecision: normalizedResolution.requiresHumanDecision,
    requiresReplan: normalizedResolution.requiresReplan,
    authority: "none",
    plannerInfluence: "none",
    changed: false,
    providerCalls: 0,
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertPreferenceRankerShadow(value, {
  label = "PreferenceRankerShadow",
} = {}) {
  const report = assertKnowledgeContract(value, {
    schemaId: PREFERENCE_RANKER_SHADOW_SCHEMA,
    label,
  });
  if (report.rankerVersion !== PREFERENCE_RANKER_VERSION) {
    throw new Error(`${label}.rankerVersion incompatível.`);
  }
  if (report.authority !== "none" || report.plannerInfluence !== "none") {
    throw new Error(`${label} não pode declarar autoridade ou influência no planner.`);
  }
  if (report.changed !== false || report.providerCalls !== 0) {
    throw new Error(`${label} não pode declarar mutação ou chamada de provider.`);
  }
  const { fingerprint, ...body } = report;
  if (fingerprint !== operationFingerprint(body)) {
    throw new Error(`${label}.fingerprint divergente.`);
  }
  return report;
}

