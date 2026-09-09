import { createHash } from "node:crypto";
import { assertKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const FEEDBACK_EVENT_SCHEMA = "mkt-videos/feedback-event@1";
export const KNOWLEDGE_FEEDBACK_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-feedback-action-result@1";
export const FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA =
  "mkt-videos/feedback-interpretation-candidate@1";
export const KNOWLEDGE_FEEDBACK_INTERPRETATION_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-feedback-interpretation-action-result@1";
export const FEEDBACK_PROMOTION_DECISION_SCHEMA =
  "mkt-videos/feedback-promotion-decision@1";
export const KNOWLEDGE_FEEDBACK_PROMOTION_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-feedback-promotion-action-result@1";
export const FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA =
  "mkt-videos/feedback-canonicalization-request@1";
export const KNOWLEDGE_FEEDBACK_CANONICALIZATION_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-feedback-canonicalization-action-result@1";
export const FEEDBACK_CAPTURED_EVENT_TYPE = "feedback.captured";
export const FEEDBACK_SUBJECT_TYPE = "feedback-event";
export const FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE =
  "feedback.interpretation-candidate.created";
export const FEEDBACK_INTERPRETATION_SUBJECT_TYPE =
  "feedback-interpretation-candidate";
export const FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE =
  "feedback.interpretation-promotion.decision-recorded";
export const FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE =
  "feedback-interpretation-promotion-decision";
export const FEEDBACK_CANONICALIZED_EVENT_TYPE =
  "feedback.interpretation.canonicalized";
export const FEEDBACK_CANONICALIZED_SUBJECT_TYPE =
  "feedback-preference-rule";

const MAX_ORIGINAL_TEXT_BYTES = 64 * 1024;
const MAX_INTERPRETATION_TEXT_BYTES = 16 * 1024;
const MAX_INTERPRETATION_SHORT_TEXT_BYTES = 4 * 1024;
const MAX_PROMOTION_REASON_BYTES = 16 * 1024;
export const TERMINAL_PROMOTION_ACTIONS = new Set(["promote", "reject"]);
export const NON_TERMINAL_PROMOTION_ACTIONS = new Set([
  "defer",
  "request-evidence",
  "apply-once",
]);

function assertVerifiedLink(link, verification, label) {
  if (!verification || typeof verification !== "object" || verification.status !== "resolved") {
    throw new Error(`${label} exige vínculo verificado com status resolved.`);
  }
  if (!link || typeof link !== "object") throw new Error(`${label} é obrigatório.`);
  if (
    link.itemId !== verification.itemId
    || link.revision !== verification.revision
    || link.contentHash !== verification.contentHash
  ) {
    throw new Error(`${label} diverge do vínculo governado verificado.`);
  }
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Feedback contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Feedback deve conter somente valores JSON.");
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error("Feedback deve conter somente valores JSON.");
}

export function canonicalFeedbackJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function feedbackEventHash(value) {
  return createHash("sha256")
    .update(canonicalFeedbackJson(value), "utf8")
    .digest("hex");
}

export function feedbackOriginalTextHash(value) {
  return createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

export function feedbackSubjectId(value) {
  return `kfe_${feedbackEventHash(value).slice(0, 32)}`;
}

function assertCanonicalTimestamp(value, label) {
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== value
  ) {
    throw new Error(`${label} deve ser timestamp ISO-8601 UTC canônico.`);
  }
}

function assertNormalizedInterpretationText(value, label, maximumBytes) {
  if (value !== value.trim()) {
    throw new Error(`${label} deve estar normalizado sem espaços externos.`);
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > maximumBytes) {
    throw new Error(
      `${label} deve ocupar entre 1 e ${maximumBytes} bytes UTF-8.`,
    );
  }
  if (/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} contém controle NUL ou direção bidi proibida.`);
  }
}

function assertLinkPairDistinct(target, label) {
  if (target.artifact.itemId === target.receipt.itemId) {
    throw new Error(`${label} exige artifact e receipt distintos.`);
  }
}

export function assertFeedbackEvent(value, {
  label = "FeedbackEvent",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: FEEDBACK_EVENT_SCHEMA,
    label,
  });
  if (value.author !== value.author.trim()) {
    throw new Error(`${label}.author deve estar normalizado sem espaços externos.`);
  }
  const originalBytes = Buffer.byteLength(value.originalText, "utf8");
  if (originalBytes < 1 || originalBytes > MAX_ORIGINAL_TEXT_BYTES) {
    throw new Error(
      `${label}.originalText deve ocupar entre 1 e ${MAX_ORIGINAL_TEXT_BYTES} bytes UTF-8.`,
    );
  }
  assertCanonicalTimestamp(value.capturedAt, "feedback.capturedAt");
  if (
    value.markers.timeRange != null
    && value.markers.timeRange.endMs <= value.markers.timeRange.startMs
  ) {
    throw new Error(`${label}.markers.timeRange exige endMs > startMs.`);
  }
  if (
    value.markers.region != null
    && (
      value.markers.region.x + value.markers.region.width > 1
      || value.markers.region.y + value.markers.region.height > 1
    )
  ) {
    throw new Error(
      `${label}.markers.region deve ficar integralmente no quadro normalizado.`,
    );
  }
  assertLinkPairDistinct(value.target, `${label}.target`);
  if (value.verdict === "preferred" && value.comparison == null) {
    throw new Error(`${label} com verdict preferred exige comparison A/B.`);
  }
  if (value.comparison != null) {
    assertLinkPairDistinct(
      value.comparison.alternative,
      `${label}.comparison.alternative`,
    );
    if (
      value.comparison.alternative.artifact.itemId
        === value.target.artifact.itemId
      && value.comparison.alternative.artifact.revision
        === value.target.artifact.revision
      && value.comparison.alternative.artifact.contentHash
        === value.target.artifact.contentHash
    ) {
      throw new Error(`${label}.comparison exige artefatos A/B distintos.`);
    }
    if (
      value.comparison.alternative.receipt.itemId
        === value.target.receipt.itemId
      && value.comparison.alternative.receipt.revision
        === value.target.receipt.revision
      && value.comparison.alternative.receipt.contentHash
        === value.target.receipt.contentHash
    ) {
      throw new Error(`${label}.comparison exige receipts A/B distintos.`);
    }
    if (
      value.comparison.preferred === "tie"
      && value.verdict === "preferred"
    ) {
      throw new Error(
        `${label} não pode declarar verdict preferred com empate A/B.`,
      );
    }
  }
  return value;
}

export function buildFeedbackEventFromVerifiedTarget({
  feedback,
  targetVerification,
} = {}) {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) {
    throw new Error("feedback deve ser um objeto feedback-event@1.");
  }
  if (!targetVerification || typeof targetVerification !== "object") {
    throw new Error("targetVerification é obrigatório para o editor de feedback.");
  }
  const event = structuredClone(feedback);
  assertVerifiedLink(event.target?.artifact, targetVerification.artifact, "target.artifact");
  assertVerifiedLink(event.target?.receipt, targetVerification.receipt, "target.receipt");
  if (event.comparison != null) {
    assertVerifiedLink(
      event.comparison.alternative?.artifact,
      targetVerification.alternative?.artifact,
      "comparison.alternative.artifact",
    );
    assertVerifiedLink(
      event.comparison.alternative?.receipt,
      targetVerification.alternative?.receipt,
      "comparison.alternative.receipt",
    );
  }
  return assertFeedbackEvent(event, { label: "FeedbackEvent do editor" });
}

export function projectFeedbackLedgerEntry(event) {
  const feedback = assertFeedbackEvent(event?.payload, {
    label: "Payload de feedback",
  });
  const feedbackHash = feedbackEventHash(feedback);
  const subjectId = feedbackSubjectId(feedback);
  if (
    event.type !== FEEDBACK_CAPTURED_EVENT_TYPE
    || event.subjectType !== FEEDBACK_SUBJECT_TYPE
    || event.subjectId !== subjectId
    || event.subjectRevision != null
    || event.scopeId !== feedback.scopeId
    || event.rootScopeId !== feedback.rootScopeId
    || event.payloadHash !== feedbackHash
  ) {
    throw new Error("Evento do ledger diverge do feedback imutável.");
  }
  return {
    sequence: event.sequence,
    eventId: event.id,
    eventActor: event.actor,
    scopeGrantId: event.grantId,
    subjectId,
    feedbackHash,
    originalTextSha256: feedbackOriginalTextHash(feedback.originalText),
    eventHash: event.eventHash,
    feedback,
  };
}

export function feedbackEntriesAggregateHash(rootScopeId, entries) {
  return createHash("sha256")
    .update(canonicalFeedbackJson({
      rootScopeId,
      entries,
    }), "utf8")
    .digest("hex");
}

export function assertFeedbackInterpretationCandidate(value, {
  label = "FeedbackInterpretationCandidate",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA,
    label,
  });
  assertNormalizedInterpretationText(
    value.interpretation.author,
    `${label}.interpretation.author`,
    200,
  );
  assertNormalizedInterpretationText(
    value.interpretation.preference.statement,
    `${label}.interpretation.preference.statement`,
    MAX_INTERPRETATION_TEXT_BYTES,
  );
  assertNormalizedInterpretationText(
    value.interpretation.rationale,
    `${label}.interpretation.rationale`,
    MAX_INTERPRETATION_TEXT_BYTES,
  );
  for (const [field, entries] of [
    ["applicability", value.interpretation.applicability],
    ["exceptions", value.interpretation.exceptions],
  ]) {
    entries.forEach((entry, index) => {
      assertNormalizedInterpretationText(
        entry,
        `${label}.interpretation.${field}[${index}]`,
        MAX_INTERPRETATION_SHORT_TEXT_BYTES,
      );
    });
  }
  assertCanonicalTimestamp(
    value.interpretation.interpretedAt,
    `${label}.interpretation.interpretedAt`,
  );
  const governance = assertKnowledgeRecordEnvelope(value.governance, {
    expectedActor: value.interpretation.author,
  });
  const expectedProvenance = [{
    sourceType: "feedback-event",
    sourceRef: `feedback:${value.sourceFeedback.eventId}`,
    method: "manual-interpretation",
    observedAt: value.interpretation.interpretedAt,
    contentHash: value.sourceFeedback.feedbackHash,
  }];
  const expectedRights = {
    inventory: "allowed",
    localAnalysis: "allowed",
    textualIndexing: "denied",
    embedding: "denied",
    training: "denied",
    providerInput: "denied",
    publication: "denied",
    reuse: "denied",
  };
  if (
    governance.classification === "public"
    || governance.modality !== "hypothesis"
    || governance.owner.id !== value.suggestedScope.scopeId
    || canonicalFeedbackJson(governance.provenance)
      !== canonicalFeedbackJson(expectedProvenance)
    || canonicalFeedbackJson(governance.evidenceIds)
      !== canonicalFeedbackJson([value.sourceFeedback.subjectId])
    || governance.retention.policy !== "manual-review"
    || governance.retention.expiresAt != null
    || governance.createdAt !== value.interpretation.interpretedAt
    || canonicalFeedbackJson(governance.rights)
      !== canonicalFeedbackJson(expectedRights)
  ) {
    throw new Error(
      `${label}.governance não corresponde ao candidato privado, `
      + "manual, não recuperável e pendente de revisão.",
    );
  }
  return value;
}

export function feedbackInterpretationCandidateHash(value) {
  return feedbackEventHash(assertFeedbackInterpretationCandidate(value));
}

export function feedbackInterpretationSubjectId(value) {
  const candidate = assertFeedbackInterpretationCandidate(value);
  return `kfic_${candidate.sourceFeedback.feedbackHash.slice(0, 32)}`;
}

export function feedbackInterpretationTextHash(value) {
  const candidate = assertFeedbackInterpretationCandidate(value);
  return feedbackOriginalTextHash(
    candidate.interpretation.preference.statement,
  );
}

export function projectFeedbackInterpretationLedgerEntry(event) {
  const candidate = assertFeedbackInterpretationCandidate(event?.payload, {
    label: "Payload do candidato de interpretação",
  });
  const candidateHash = feedbackInterpretationCandidateHash(candidate);
  const subjectId = feedbackInterpretationSubjectId(candidate);
  if (
    event.type !== FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
    || event.subjectType !== FEEDBACK_INTERPRETATION_SUBJECT_TYPE
    || event.subjectId !== subjectId
    || event.subjectRevision != null
    || event.scopeId !== candidate.sourceScopeId
    || event.rootScopeId !== candidate.rootScopeId
    || event.payloadHash !== candidateHash
  ) {
    throw new Error(
      "Evento do ledger diverge do candidato de interpretação imutável.",
    );
  }
  return {
    sequence: event.sequence,
    eventId: event.id,
    eventActor: event.actor,
    scopeGrantId: event.grantId,
    subjectId,
    candidateHash,
    interpretationTextSha256: feedbackInterpretationTextHash(candidate),
    eventHash: event.eventHash,
    sourceFeedback: candidate.sourceFeedback,
    candidate,
  };
}

export function feedbackInterpretationEntriesAggregateHash(
  rootScopeId,
  entries,
) {
  return createHash("sha256")
    .update(canonicalFeedbackJson({
      rootScopeId,
      entries,
    }), "utf8")
    .digest("hex");
}

function requiredHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value ?? ""))) {
    throw new Error(`${label} deve ser SHA-256.`);
  }
  return value;
}

function requiredIdentifier(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(String(value ?? ""))) {
    throw new Error(`${label} possui identificador inválido.`);
  }
  return value;
}

export function feedbackPromotionDecisionHash(value) {
  const { hash: _hash, decisionId: _decisionId, ...body } = value ?? {};
  return feedbackEventHash(body);
}

export function feedbackPromotionDecisionId(value) {
  return `fpd_${feedbackPromotionDecisionHash(value).slice(0, 32)}`;
}

export function assertFeedbackPromotionDecision(value, {
  label = "FeedbackPromotionDecision",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: FEEDBACK_PROMOTION_DECISION_SCHEMA,
    label,
  });
  requiredIdentifier(value.rootScopeId, `${label}.rootScopeId`);
  requiredIdentifier(
    value.candidateSubjectId,
    `${label}.candidateSubjectId`,
  );
  requiredIdentifier(value.candidateEventId, `${label}.candidateEventId`);
  requiredHash(value.candidateHash, `${label}.candidateHash`);
  requiredHash(value.candidateEventHash, `${label}.candidateEventHash`);
  requiredHash(value.queueSnapshot.hash, `${label}.queueSnapshot.hash`);
  if (
    value.queueSnapshot.scopeId != null
    && !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value.queueSnapshot.scopeId)
  ) {
    throw new Error(`${label}.queueSnapshot.scopeId inválido.`);
  }
  const queueLimit = Number(value.queueSnapshot.limit);
  if (!Number.isInteger(queueLimit) || queueLimit < 1 || queueLimit > 100) {
    throw new Error(`${label}.queueSnapshot.limit inválido.`);
  }
  assertCanonicalTimestamp(
    value.queueSnapshot.asOf,
    `${label}.queueSnapshot.asOf`,
  );
  assertCanonicalTimestamp(value.decidedAt, `${label}.decidedAt`);
  if (Date.parse(value.decidedAt) < Date.parse(value.queueSnapshot.asOf)) {
    throw new Error(`${label}.decidedAt não pode preceder queueSnapshot.asOf.`);
  }
  assertNormalizedInterpretationText(
    value.reason,
    `${label}.reason`,
    MAX_PROMOTION_REASON_BYTES,
  );
  assertNormalizedInterpretationText(
    value.reviewedBy,
    `${label}.reviewedBy`,
    200,
  );
  if (
    value.supersedesDecisionId != null
    && !/^fpd_[a-f0-9]{32}$/.test(value.supersedesDecisionId)
  ) {
    throw new Error(`${label}.supersedesDecisionId inválido.`);
  }
  if (value.action === "apply-once") {
    if (value.oneShot == null || typeof value.oneShot !== "object") {
      throw new Error(`${label}.oneShot é obrigatório para apply-once.`);
    }
    requiredHash(
      value.oneShot.planFingerprint,
      `${label}.oneShot.planFingerprint`,
    );
    requiredIdentifier(
      value.oneShot.productionId,
      `${label}.oneShot.productionId`,
    );
    assertCanonicalTimestamp(
      value.oneShot.expiresAt,
      `${label}.oneShot.expiresAt`,
    );
    if (Date.parse(value.oneShot.expiresAt) <= Date.parse(value.decidedAt)) {
      throw new Error(
        `${label}.oneShot.expiresAt deve ser posterior a decidedAt.`,
      );
    }
  } else if (value.oneShot != null) {
    throw new Error(`${label}.oneShot só é permitido para apply-once.`);
  }
  const expectedId = feedbackPromotionDecisionId(value);
  const expectedHash = feedbackPromotionDecisionHash(value);
  if (value.decisionId !== expectedId || value.hash !== expectedHash) {
    throw new Error(`${label} diverge do hash ou ID canônico.`);
  }
  return value;
}

export function projectFeedbackPromotionDecisionLedgerEntry(event) {
  const decision = assertFeedbackPromotionDecision(event?.payload, {
    label: "Payload de decisão da fila de feedback",
  });
  if (
    event.type !== FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
    || event.subjectType !== FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE
    || event.subjectId !== decision.decisionId
    || event.subjectRevision != null
    || event.scopeId !== decision.scopeDecision.scopeId
    || event.rootScopeId !== decision.rootScopeId
    || event.payloadHash !== feedbackEventHash(decision)
  ) {
    throw new Error(
      "Evento do ledger diverge da decisão da fila de feedback imutável.",
    );
  }
  return {
    sequence: event.sequence,
    eventId: event.id,
    eventActor: event.actor,
    scopeGrantId: event.grantId,
    subjectId: decision.decisionId,
    decisionHash: decision.hash,
    eventHash: event.eventHash,
    candidateSubjectId: decision.candidateSubjectId,
    decision,
  };
}

export function feedbackPromotionDecisionEntriesAggregateHash(
  rootScopeId,
  entries,
) {
  return feedbackEventHash({ rootScopeId, entries });
}

export function feedbackCanonicalizationRequestHash(value) {
  const { hash: _hash, requestId: _requestId, ...body } = value ?? {};
  return feedbackEventHash(body);
}

export function feedbackCanonicalizationRequestId(value) {
  return `fcr_${feedbackCanonicalizationRequestHash(value).slice(0, 32)}`;
}

export function assertFeedbackCanonicalizationRequest(value, {
  label = "FeedbackCanonicalizationRequest",
} = {}) {
  assertKnowledgeContract(value, {
    schemaId: FEEDBACK_CANONICALIZATION_REQUEST_SCHEMA,
    label,
  });
  requiredIdentifier(value.rootScopeId, `${label}.rootScopeId`);
  requiredHash(value.decisionHash, `${label}.decisionHash`);
  requiredHash(value.decisionEventHash, `${label}.decisionEventHash`);
  requiredHash(value.candidateHash, `${label}.candidateHash`);
  assertNormalizedInterpretationText(value.reason, `${label}.reason`, MAX_PROMOTION_REASON_BYTES);
  assertNormalizedInterpretationText(value.requestedBy, `${label}.requestedBy`, 200);
  assertCanonicalTimestamp(value.requestedAt, `${label}.requestedAt`);
  const expectedId = feedbackCanonicalizationRequestId(value);
  const expectedHash = feedbackCanonicalizationRequestHash(value);
  if (value.requestId !== expectedId || value.hash !== expectedHash) {
    throw new Error(`${label} diverge do hash ou ID canônico.`);
  }
  return value;
}

function comparePriorityKey(left, right) {
  for (let index = 0; index < left.length - 1; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return compareText(left.at(-1), right.at(-1));
}

function promotionModeReuseValue(mode) {
  return {
    piece: 0,
    personal: 1,
    project: 2,
    client: 3,
    "global-proposal": 4,
  }[mode] ?? 0;
}

function promotionRiskValue(candidate) {
  let value = 0;
  const reasons = [];
  if (candidate.suggestedScope.mode === "global-proposal") {
    value += 3;
    reasons.push("global-proposal exige abstração e aprovação adicionais");
  }
  if (candidate.interpretation.target.kind === "decision") {
    value += 2;
    reasons.push("alvo é uma decisão audiovisual, não uma feature isolada");
  }
  if (candidate.governance.rights.providerInput === "denied") {
    value += 1;
    reasons.push("providerInput permanece denied até nova decisão de direitos");
  }
  return {
    value,
    reason: reasons.length > 0
      ? reasons.join("; ")
      : "nenhum fator objetivo adicional identificado",
  };
}

export function buildFeedbackPromotionQueue({
  rootScopeId,
  candidates = [],
  decisions = [],
  asOf,
  scopeId = null,
  limit = 5,
} = {}) {
  const normalizedRoot = requiredIdentifier(rootScopeId, "rootScopeId");
  assertCanonicalTimestamp(asOf, "queue.asOf");
  const normalizedLimit = Number(limit);
  if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
    throw new Error("queue.limit deve ser inteiro entre 1 e 100.");
  }
  const candidateEntries = candidates.map((entry) => {
    const candidate = assertFeedbackInterpretationCandidate(entry.candidate, {
      label: "Candidato da fila",
    });
    return {
      ...entry,
      candidate,
      candidateHash: feedbackInterpretationCandidateHash(candidate),
    };
  });
  const decisionsByCandidate = new Map();
  for (const entry of decisions) {
    const projected = entry.decision ? entry : projectFeedbackPromotionDecisionLedgerEntry({
      ...entry,
      type: FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE,
      subjectType: FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
      subjectId: entry.decisionId,
      scopeId: entry.decision.scopeDecision.scopeId,
      rootScopeId: normalizedRoot,
      payload: entry,
      payloadHash: feedbackPromotionDecisionHash(entry),
    });
    if (Date.parse(projected.decision.decidedAt) > Date.parse(asOf)) {
      continue;
    }
    const list = decisionsByCandidate.get(projected.candidateSubjectId) ?? [];
    list.push(projected);
    decisionsByCandidate.set(projected.candidateSubjectId, list);
  }
  const statementCounts = new Map();
  for (const entry of candidateEntries) {
    const key = feedbackInterpretationTextHash(entry.candidate);
    statementCounts.set(key, (statementCounts.get(key) ?? 0) + 1);
  }
  const pending = [];
  for (const entry of candidateEntries) {
    if (entry.candidate.rootScopeId !== normalizedRoot) {
      throw new Error("Fila contém candidato de outro root scope.");
    }
    const history = [...(decisionsByCandidate.get(entry.subjectId) ?? [])]
      .sort((left, right) => left.sequence - right.sequence);
    const latest = history.at(-1) ?? null;
    if (latest && TERMINAL_PROMOTION_ACTIONS.has(latest.decision.action)) {
      continue;
    }
    const candidate = entry.candidate;
    const scopeMatch = scopeId != null && candidate.suggestedScope.scopeId === scopeId
      ? 1
      : 0;
    const ageSeconds = Math.max(
      0,
      Math.floor((Date.parse(asOf) - Date.parse(candidate.interpretation.interpretedAt)) / 1000),
    );
    const evidenceCount = candidate.governance.evidenceIds.length;
    const statementHash = feedbackInterpretationTextHash(candidate);
    const duplicateCount = statementCounts.get(statementHash) ?? 1;
    const factors = {
      scopeMatch: {
        value: scopeMatch,
        reason: scopeId == null
          ? "nenhum scope foi priorizado nesta consulta"
          : scopeMatch === 1
            ? "scope sugerido coincide com o filtro da fila"
            : "scope sugerido não coincide com o filtro da fila",
      },
      reusePotential: {
        value: promotionModeReuseValue(candidate.suggestedScope.mode),
        reason: `escopo ${candidate.suggestedScope.mode} indica potencial de reutilização operacional`,
      },
      risk: promotionRiskValue(candidate),
      evidence: {
        value: evidenceCount,
        reason: `${evidenceCount} evidência(s) governada(s) ligada(s) ao candidato`,
      },
      novelty: {
        value: duplicateCount === 1 ? 1 : 0,
        reason: duplicateCount === 1
          ? "nenhum candidato com a mesma preferência nesta fila"
          : `${duplicateCount} candidatos compartilham a mesma preferência; revisar duplicidade`,
      },
      age: {
        value: ageSeconds,
        reason: `${ageSeconds} segundo(s) desde a interpretação registrada`,
      },
    };
    const priorityKey = [
      factors.scopeMatch.value,
      factors.risk.value,
      factors.reusePotential.value,
      factors.novelty.value,
      factors.evidence.value,
      factors.age.value,
      entry.subjectId,
    ];
    pending.push({
      sequence: entry.sequence,
      eventId: entry.eventId,
      eventActor: entry.eventActor,
      scopeGrantId: entry.scopeGrantId,
      subjectId: entry.subjectId,
      candidateHash: entry.candidateHash,
      sourceFeedback: entry.sourceFeedback,
      suggestedScope: candidate.suggestedScope,
      target: candidate.interpretation.target,
      dimensions: candidate.interpretation.dimensions,
      statement: candidate.interpretation.preference.statement,
      reviewStatus: "pending-human-review",
      decisionCount: history.length,
      latestDecision: latest?.decision ?? null,
      factors,
      priorityKey,
    });
  }
  pending.sort((left, right) => comparePriorityKey(left.priorityKey, right.priorityKey));
  return pending.slice(0, normalizedLimit);
}

export function feedbackPromotionQueueHash(rootScopeId, {
  asOf,
  scopeId = null,
  limit = 5,
}, entries) {
  return feedbackEventHash({ rootScopeId, asOf, scopeId, limit, entries });
}
