import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FEEDBACK_EVENT_SCHEMA,
  FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA,
  FEEDBACK_PROMOTION_DECISION_SCHEMA,
  FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA,
  feedbackCanonicalizationRequestHash,
  feedbackCanonicalizationRequestId,
  feedbackPromotionDecisionHash,
  feedbackPromotionDecisionId,
} from "./knowledge-feedback.mjs";
import {
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  knowledgeAssetLinkItemId,
} from "./knowledge-asset-integrity.mjs";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import {
  checkKnowledgeStoreIntegrity,
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "./knowledge-store.mjs";
import {
  knowledgeRetrievalRequestHash,
} from "./knowledge-retrieval.mjs";
import { createStudioBrief } from "./studio-context.mjs";
import { compileFilmSpec } from "./film-compiler.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const FEEDBACK_LEARNING_PILOT_SCHEMA =
  "mkt-videos/feedback-learning-pilot@1";

const NOW = "2026-07-27T12:00:00.000Z";
const ACTOR = "synthetic-pilot-reviewer";
const ROOT = "client:pilot-d";
const PROJECT = "project:pilot-d";
const PRODUCTION = "production:pilot-d";
const DELIVERABLE = "deliverable:pilot-d";

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function grant(permissions = ["read", "write", "release", "integrity"]) {
  return createScopeGrant({
    rootScopeIds: [ROOT],
    permissions,
    actor: ACTOR,
    purpose: "provider-free Pilot D feedback learning",
    issuedAt: "2026-07-27T11:00:00.000Z",
    expiresAt: "2026-07-27T14:00:00.000Z",
  });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function assetLink({ relativePath, contents, mediaType }) {
  const hash = digest(contents);
  return {
    id: knowledgeAssetLinkItemId({ rootScopeId: ROOT, rootKind: "outputs", relativePath }),
    revision: 1,
    rootScopeId: ROOT,
    scopeId: DELIVERABLE,
    recordType: "relation",
    schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    schemaVersion: 1,
    status: "active",
    governance: createKnowledgeRecordEnvelope({
      classification: "confidential",
      owner: { type: "deliverable", id: DELIVERABLE },
      provenance: [{
        sourceType: "asset-receipt",
        sourceRef: `pilot-d:${digest(relativePath).slice(0, 16)}`,
        method: "fixture",
        observedAt: NOW,
        contentHash: hash,
      }],
      modality: "observation",
      evidenceIds: [],
      retention: { policy: "manual-review" },
      rights: { inventory: "allowed" },
      createdAt: NOW,
      createdBy: ACTOR,
    }, { expectedActor: ACTOR }),
    supersedesRevision: null,
    payload: {
      schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
      rootKind: "outputs",
      relativePath,
      expectedSha256: hash,
      expectedBytes: Buffer.byteLength(contents),
      mediaType,
    },
    createdAt: NOW,
    createdBy: ACTOR,
  };
}

function feedback({ artifact, receipt, alternativeArtifact, alternativeReceipt }) {
  const body = {
    schema: FEEDBACK_EVENT_SCHEMA,
    rootScopeId: ROOT,
    scopeId: PRODUCTION,
    author: ACTOR,
    originalText:
      "A versão B mantém mais energia; preserve a leitura do CTA e não altere automaticamente.",
    target: {
      productionScopeId: PRODUCTION,
      artifact: { itemId: artifact.id, revision: 1, contentHash: artifact.contentHash },
      receipt: { itemId: receipt.id, revision: 1, contentHash: receipt.contentHash },
      sceneId: "scene:cta",
      versionId: "version:a",
    },
    markers: {
      timeRange: { startMs: 1200, endMs: 4300 },
      frame: { index: 72 },
      region: { unit: "normalized", x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
      track: { kind: "video", id: "track:main" },
    },
    dimensions: ["rhythm", "legibility", "cta"],
    verdict: "preferred",
    comparison: {
      alternative: {
        artifact: { itemId: alternativeArtifact.id, revision: 1, contentHash: alternativeArtifact.contentHash },
        receipt: { itemId: alternativeReceipt.id, revision: 1, contentHash: alternativeReceipt.contentHash },
        versionId: "version:b",
      },
      preferred: "alternative",
      rationale: "A comparação A/B sustenta melhor o CTA sem perder energia.",
    },
    intendedScope: { mode: "project", scopeId: PROJECT },
    contextHash: digest("pilot-d-context-before"),
    capturedAt: "2026-07-27T11:59:00.000Z",
  };
  return body;
}

function candidate(sourceEntry) {
  const interpretedAt = NOW;
  const body = {
    schema: FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA,
    status: "candidate",
    stage: "interpreted",
    providerFree: true,
    authority: {
      planning: false,
      retrieval: false,
      release: false,
      promotion: false,
      execution: false,
    },
    rootScopeId: ROOT,
    sourceScopeId: PRODUCTION,
    sourceFeedback: {
      eventId: sourceEntry.eventId,
      sequence: sourceEntry.sequence,
      subjectId: sourceEntry.subjectId,
      feedbackHash: sourceEntry.feedbackHash,
      originalTextSha256: sourceEntry.originalTextSha256,
      eventHash: sourceEntry.eventHash,
    },
    suggestedScope: { mode: "project", scopeId: PROJECT },
    interpretation: {
      method: "manual-local",
      author: ACTOR,
      target: { kind: "decision", key: "scene.cta-rhythm" },
      dimensions: ["rhythm", "legibility"],
      preference: {
        operation: "prefer",
        statement: "Prefira ritmo com energia quando o CTA precisar permanecer legível.",
      },
      applicability: ["Cenas com CTA que precisam manter energia e legibilidade."],
      exceptions: ["Não aplicar em brief contemplativo ou sem CTA."],
      rationale: "A versão B venceu a comparação A/B por energia e leitura.",
      strength: "tentative",
      interpretedAt,
    },
    governance: createKnowledgeRecordEnvelope({
      classification: "confidential",
      owner: { type: "project", id: PROJECT },
      provenance: [{
        sourceType: "feedback-event",
        sourceRef: `feedback:${sourceEntry.eventId}`,
        method: "manual-interpretation",
        observedAt: interpretedAt,
        contentHash: sourceEntry.feedbackHash,
      }],
      modality: "hypothesis",
      evidenceIds: [sourceEntry.subjectId],
      retention: { policy: "manual-review" },
      rights: {
        inventory: "allowed",
        localAnalysis: "allowed",
        textualIndexing: "denied",
        embedding: "denied",
        training: "denied",
        providerInput: "denied",
        publication: "denied",
        reuse: "denied",
      },
      createdAt: interpretedAt,
      createdBy: ACTOR,
    }, { expectedActor: ACTOR }),
    review: { status: "pending-human-review", revision: 1 },
  };
  return body;
}

function promotionDecision({ queue, candidateEntry, sourceEntry }) {
  const body = {
    schema: FEEDBACK_PROMOTION_DECISION_SCHEMA,
    decisionId: "pending",
    rootScopeId: ROOT,
    candidateSubjectId: queue.entries[0].subjectId,
    candidateEventId: queue.entries[0].eventId,
    candidateHash: queue.entries[0].candidateHash,
    candidateEventHash: candidateEntry.eventHash,
    queueSnapshot: {
      asOf: queue.asOf,
      scopeId: queue.scopeId,
      limit: queue.limit,
      hash: queue.queueHash,
    },
    action: "promote",
    supersedesDecisionId: null,
    oneShot: null,
    scopeDecision: { mode: "project", scopeId: PROJECT },
    reason: "Decisão sintética restrita ao projeto do piloto.",
    reviewedBy: ACTOR,
    decidedAt: NOW,
    humanConfirmed: true,
    hash: "0".repeat(64),
  };
  return {
    ...body,
    decisionId: feedbackPromotionDecisionId(body),
    hash: feedbackPromotionDecisionHash(body),
  };
}

function canonicalizationRequest({ decision, decisionEntry, candidateEntry }) {
  const body = {
    schema: FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA,
    requestId: "pending",
    rootScopeId: ROOT,
    decisionId: decision.decisionId,
    decisionHash: decision.hash,
    decisionEventId: decisionEntry.eventId,
    decisionEventHash: decisionEntry.eventHash,
    candidateSubjectId: candidateEntry.subjectId,
    candidateHash: candidateEntry.candidateHash,
    reason: "Canonicalização humana do piloto para a release v1.",
    requestedBy: ACTOR,
    requestedAt: NOW,
    humanConfirmed: true,
    hash: "0".repeat(64),
  };
  return {
    ...body,
    requestId: feedbackCanonicalizationRequestId(body),
    hash: feedbackCanonicalizationRequestHash(body),
  };
}

function nextBrief(context) {
  const brief = createStudioBrief({
    briefId: "pilot-d-next-brief",
    userBrief: "Filme comercial curto com CTA legível e energia controlada.",
    objective: "Testar se a preferência promovida aparece no contexto do próximo brief.",
    audience: "público de campanha",
    genre: "commercial",
    channel: "social",
    format: "16:9",
    durationSeconds: 8,
    clientId: ROOT,
    projectId: PROJECT,
    requiredOnScreenText: ["CTA PILOT D"],
    preferences: ["ritmo", "legibilidade", "CTA"],
    knowledgeContextHash: context.hash,
  });
  const spec = {
    schema: "mkt-videos/film-spec@2",
    name: "pilot-d-next-brief",
    source: { request: brief.userBrief, directionPreset: null, effectiveDirection: null },
    brief,
    knowledgeContext: context,
    narration: { mode: "none", text: null, blocks: [] },
    music: { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    timeline: { fps: { numerator: 24, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 },
    scenes: [{
      id: "pilot-d-scene",
      role: "typography",
      objective: brief.objective,
      visualPrompt: brief.userBrief,
      motionPrompt: "Ritmo energético com leitura estável do CTA.",
      onScreenText: "CTA PILOT D",
      references: [],
      referenceAuthorizations: [],
      runtimeInputRoles: [],
      restrictions: ["sem regeneração automática"],
      generationTask: "text_to_video",
      durationHint: 8,
      image: { model: "gemini-3-pro-image", size: "2K" },
    }],
    formats: { master: "16:9", variants: [] },
    brandKit: null,
    captions: { mode: "none" },
    qa: { enabled: false },
    reuse: { policy: "off" },
    execution: { concurrency: { draft: 1, video: 1, localCpu: 1 }, budget: {}, providers: {} },
    finishing: { audio: {}, assembly: {}, delivery: null },
  };
  return { brief, plan: compileFilmSpec(spec) };
}

async function setupStore() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "mkt-videos-pilot-d-"));
  const coreRoot = path.join(temporary, "CORE");
  const outputsRoot = path.join(coreRoot, "outputs", "pilot-d");
  const privateRoot = path.join(temporary, "private");
  const dbFile = path.join(privateRoot, "knowledge.sqlite");
  await mkdir(outputsRoot, { recursive: true });
  await mkdir(privateRoot, { recursive: true });
  initializeKnowledgeStore({ dbFile, coreRoot, clock: () => NOW });
  const repository = createKnowledgeStoreRepository({ dbFile, coreRoot, clock: () => NOW });
  const writeGrant = grant();
  for (const scope of [
    { id: ROOT, rootScopeId: ROOT, parentScopeId: null, kind: "client" },
    { id: PROJECT, rootScopeId: ROOT, parentScopeId: ROOT, kind: "project" },
    { id: PRODUCTION, rootScopeId: ROOT, parentScopeId: PROJECT, kind: "production" },
    { id: DELIVERABLE, rootScopeId: ROOT, parentScopeId: PRODUCTION, kind: "deliverable" },
  ]) repository.createScope({ grant: writeGrant, scope: { ...scope, name: scope.id, createdAt: NOW } });
  return { temporary, coreRoot, outputsRoot, dbFile, repository, writeGrant };
}

export async function runFeedbackLearningPilot({ cleanup = true } = {}) {
  const state = await setupStore();
  try {
    const files = [
      { key: "a", content: "pilot-d-version-a", mediaType: "video/mp4" },
      { key: "b", content: "pilot-d-version-b", mediaType: "video/mp4" },
      { key: "a-receipt", content: "{\"version\":\"a\"}", mediaType: "application/json" },
      { key: "b-receipt", content: "{\"version\":\"b\"}", mediaType: "application/json" },
    ];
    const links = {};
    for (const entry of files) {
      const relativePath = `pilot-d/${entry.key}${entry.mediaType === "video/mp4" ? ".mp4" : ".receipt.json"}`;
      const file = path.join(state.coreRoot, "outputs", relativePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.content, "utf8");
      const item = assetLink({ relativePath, contents: entry.content, mediaType: entry.mediaType });
      const persisted = state.repository.appendKnowledgeAssetLinkItem({ grant: state.writeGrant, item });
      links[entry.key] = { ...persisted, file };
    }
    const feedbackValue = feedback({
      artifact: links.a,
      receipt: links["a-receipt"],
      alternativeArtifact: links.b,
      alternativeReceipt: links["b-receipt"],
    });
    const feedbackEntry = state.repository.captureFeedbackEvent({ grant: state.writeGrant, feedback: feedbackValue });
    const originalTextHash = feedbackEntry.originalTextSha256;
    const interpreted = candidate(feedbackEntry);
    const candidateEntry = state.repository.createFeedbackInterpretationCandidate({ grant: state.writeGrant, candidate: interpreted });
    const queue = state.repository.listFeedbackPromotionQueue({ grant: state.writeGrant, rootScopeId: ROOT, asOf: NOW, limit: 5 });
    const candidateProjection = state.repository.listFeedbackInterpretationCandidates({ grant: state.writeGrant, rootScopeId: ROOT })[0];
    const decision = promotionDecision({ queue, candidateEntry: candidateProjection, sourceEntry: feedbackEntry });
    const decisionEntry = state.repository.recordFeedbackPromotionDecision({ grant: state.writeGrant, decision });
    const request = canonicalizationRequest({ decision: decisionEntry.decision, decisionEntry, candidateEntry: candidateProjection });
    const canonicalized = state.repository.canonicalizeFeedbackPromotion({ grant: state.writeGrant, request });
    const baseline = state.repository.createRelease({ grant: state.writeGrant, rootScopeId: ROOT, releaseId: "release:pilot-d-v0", label: "Pilot D baseline", members: [], createdAt: NOW, createdBy: ACTOR });
    const firstActivation = state.repository.activateRelease({ grant: state.writeGrant, rootScopeId: ROOT, releaseId: baseline.id, expectedReleaseHash: baseline.hash, expectedCurrentActivationId: null, reason: "baseline do piloto D", createdAt: NOW, createdBy: ACTOR });
    const learned = state.repository.createRelease({
      grant: state.writeGrant,
      rootScopeId: ROOT,
      releaseId: "release:pilot-d-v1",
      label: "Pilot D preferência promovida",
      previousReleaseId: baseline.id,
      members: [canonicalized.evidenceItem, canonicalized.ruleItem].map((item) => ({ id: item.id, revision: item.revision })),
      createdAt: NOW,
      createdBy: ACTOR,
    });
    const learnedActivation = state.repository.activateRelease({ grant: state.writeGrant, rootScopeId: ROOT, releaseId: learned.id, expectedReleaseHash: learned.hash, expectedCurrentActivationId: firstActivation.id, reason: "ativação humana da regra do piloto D", createdAt: NOW, createdBy: ACTOR });
    const retrievalRequestBody = {
      schema: "mkt-videos/knowledge-retrieval-request@1",
      rootScopeId: ROOT,
      releaseId: learned.id,
      query: "ritmo energia CTA legibilidade",
      scopeIds: [PROJECT],
      asOf: NOW,
      limit: 10,
      mode: "shadow",
    };
    const retrievalRequest = { ...retrievalRequestBody, hash: knowledgeRetrievalRequestHash(retrievalRequestBody) };
    const shadow = state.repository.retrieveKnowledgeShadow({ grant: grant(["read"]), request: retrievalRequest });
    const next = nextBrief(shadow.context);
    const rollback = state.repository.rollbackRelease({ grant: state.writeGrant, rootScopeId: ROOT, releaseId: baseline.id, expectedReleaseHash: baseline.hash, expectedCurrentActivationId: learnedActivation.id, reason: "rollback verificável do piloto D", createdAt: NOW, createdBy: ACTOR });
    const activeAfterRollback = state.repository.getActiveRelease({ grant: grant(["read"]), rootScopeId: ROOT });
    const integrity = checkKnowledgeStoreIntegrity({ dbFile: state.dbFile, coreRoot: state.coreRoot });
    const body = {
      schema: FEEDBACK_LEARNING_PILOT_SCHEMA,
      providerFree: true,
      providerCalls: 0,
      changed: false,
      originalTextHash,
      originalTextPreserved: feedbackEntry.feedback.originalText === feedbackValue.originalText,
      feedback: { eventId: feedbackEntry.eventId, feedbackHash: feedbackEntry.feedbackHash, compared: "version:a vs version:b" },
      interpretation: { candidateSubjectId: candidateProjection.subjectId, candidateHash: candidateProjection.candidateHash, scope: interpreted.suggestedScope },
      promotion: { decisionId: decisionEntry.decision.decisionId, action: decisionEntry.decision.action, humanConfirmed: true },
      releases: { baseline: { id: baseline.id, hash: baseline.hash }, learned: { id: learned.id, hash: learned.hash }, rollback: { id: rollback.id, mode: rollback.mode } },
      retrieval: { contextHash: shadow.context.hash, appliedItemIds: shadow.context.appliedItems.map((item) => item.id), plannerInfluence: shadow.context.plannerInfluence },
      nextBrief: { briefHash: next.brief.hash, planFingerprint: next.plan.fingerprint, contextHash: next.plan.spec.knowledgeContext?.hash ?? null },
      rollbackVerified: activeAfterRollback?.release?.id === baseline.id,
      integrity: { ok: integrity.ok, eventCount: integrity.eventCount, releaseCount: integrity.releaseCount },
    };
    return { ...body, fingerprint: operationFingerprint(body) };
  } finally {
    if (cleanup) await rm(state.temporary, { recursive: true, force: true });
  }
}

export function assertFeedbackLearningPilotReport(value) {
  if (value?.schema !== FEEDBACK_LEARNING_PILOT_SCHEMA) throw new Error("Relatório do Piloto D inválido.");
  if (value.providerFree !== true || value.providerCalls !== 0 || value.changed !== false) throw new Error("Piloto D deve permanecer provider-free e sem alteração externa.");
  if (value.originalTextPreserved !== true || value.promotion?.action !== "promote" || value.promotion?.humanConfirmed !== true) throw new Error("Piloto D não provou preservação e promoção humana.");
  if (!Array.isArray(value.retrieval?.appliedItemIds) || value.retrieval.appliedItemIds.length < 1 || value.retrieval.plannerInfluence !== "none") throw new Error("Piloto D não provou retrieval restrito.");
  if (value.nextBrief?.contextHash !== value.retrieval?.contextHash || value.rollbackVerified !== true || value.integrity?.ok !== true) throw new Error("Piloto D não provou contexto, rollback e integridade.");
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "fingerprint"));
  if (value.fingerprint !== operationFingerprint(body)) throw new Error("Relatório do Piloto D adulterado.");
  return structuredClone(value);
}
