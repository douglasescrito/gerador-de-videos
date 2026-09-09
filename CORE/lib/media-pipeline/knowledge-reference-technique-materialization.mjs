import { createHash } from "node:crypto";
import {
  resolveStyleSpec,
} from "./direction-presets.mjs";
import {
  assertEffectiveRightAllowed,
} from "./knowledge-effective-rights.mjs";
import {
  assertKnowledgeRecordEnvelope,
  createKnowledgeRecordEnvelope,
  KNOWLEDGE_RIGHTS,
} from "./knowledge-governance-envelope.mjs";
import {
  assertKnowledgeRecordPayloadContract,
} from "./knowledge-record-contracts.mjs";
import {
  validateReferenceTechniqueCandidate,
} from "./knowledge-reference-technique-candidate.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const REFERENCE_TECHNIQUE_MATERIALIZATION_KIND =
  "reference-technique-candidate-materialization@1";

const ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
const REFERENCE_SCHEMA = "mkt-videos/knowledge-reference@1";
const ENTITY_SCHEMA = "mkt-videos/entity-profile@1";
const EVIDENCE_SCHEMA = "mkt-videos/evidence-link@1";
const DECISION_SCHEMA = "mkt-videos/creative-decision-record@1";
const ASSERTION_SCHEMA = "mkt-videos/knowledge-assertion@1";
const RIGHTS_SCHEMA = "mkt-videos/rights-record@1";
const EFFECTIVE_RIGHTS_SCHEMA = "mkt-videos/effective-rights@1";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FORCED_DENIED_RIGHTS = new Set([
  "embedding",
  "training",
  "providerInput",
]);

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
      throw new Error("Materialização de técnica contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        "Materialização de técnica deve conter somente valores JSON.",
      );
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error(
    "Materialização de técnica deve conter somente valores JSON.",
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function assertExactKeys(value, expected, label) {
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${label} deve ser um objeto JSON.`);
  }
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`${label} possui campos não permitidos ou ausentes.`);
  }
  return value;
}

function requiredIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} é inválido.`);
  }
  return normalized;
}

function requiredText(value, label, maximum = 2000) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").trim()
    : "";
  if (
    normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u
      .test(normalized)
  ) {
    throw new Error(`${label} é inválido.`);
  }
  return normalized;
}

function requiredHash(value, label) {
  const normalized = String(value ?? "").trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} deve ser SHA-256.`);
  }
  return normalized;
}

function normalizedIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} deve ser uma data válida.`);
  }
  return date.toISOString();
}

function itemReference(item) {
  return {
    schema: REFERENCE_SCHEMA,
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function stableId(prefix, seed) {
  return `${prefix}:${sha256Json(seed).slice(0, 32)}`;
}

function assertSameJson(left, right, message) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(message);
  }
}

function assertEffectiveRightsDecision({
  targetItem,
  effectiveRights,
}) {
  assertKnowledgeContract(effectiveRights, {
    schemaId: EFFECTIVE_RIGHTS_SCHEMA,
    label: "Effective rights autoritativo",
  });
  const { decisionHash, ...body } = effectiveRights;
  if (decisionHash !== sha256Json(body)) {
    throw new Error("Effective rights possui decisionHash inválido.");
  }
  const expectedTarget = {
    rootScopeId: targetItem.rootScopeId,
    id: targetItem.id,
    revision: targetItem.revision,
    contentHash: targetItem.contentHash,
    status: targetItem.status,
  };
  assertSameJson(
    effectiveRights.target,
    expectedTarget,
    "Effective rights não pertence ao target exato.",
  );
  if (
    effectiveRights.authority !== "knowledge-store-head-only"
    || effectiveRights.rightsHead == null
    || effectiveRights.rightsHead.status !== "active"
    || effectiveRights.rightsHead.targetMatches !== true
  ) {
    throw new Error(
      "Effective rights não representa o head autoritativo e active.",
    );
  }
  for (const right of ["localAnalysis", "textualIndexing"]) {
    if (targetItem.governance.rights[right] !== "allowed") {
      throw new Error(
        `Reference target não permite ${right} no envelope governado.`,
      );
    }
    assertEffectiveRightAllowed({ effectiveRights, right });
  }
  return effectiveRights;
}

function conservativeRights(effectiveRights) {
  return Object.fromEntries(
    KNOWLEDGE_RIGHTS.map((right) => [
      right,
      FORCED_DENIED_RIGHTS.has(right)
        ? "denied"
        : effectiveRights.permissions[right].state,
    ]),
  );
}

function normalizeStyleSpecBinding(binding) {
  if (binding == null) return null;
  assertExactKeys(
    binding,
    ["styleSpecId", "styleSpecHash"],
    "styleSpecBinding",
  );
  const styleSpecId = requiredText(
    binding.styleSpecId,
    "styleSpecBinding.styleSpecId",
    200,
  );
  const styleSpec = resolveStyleSpec(styleSpecId, {
    allowConcept: true,
    allowDeprecated: true,
  });
  const styleSpecHash = requiredHash(
    binding.styleSpecHash,
    "styleSpecBinding.styleSpecHash",
  );
  if (styleSpecHash !== sha256Json(styleSpec)) {
    throw new Error("styleSpecHash diverge do StyleSpec canônico.");
  }
  return {
    styleSpecId,
    styleSpecHash,
  };
}

function normalizeQueueReview(queueReview, {
  actor,
  candidateHash,
  materializedAt,
}) {
  if (queueReview == null) return null;
  assertExactKeys(
    queueReview,
    [
      "approvedBy",
      "confirmHuman",
      "decidedAt",
      "expectedCandidateHash",
    ],
    "queueReview",
  );
  if (queueReview.confirmHuman !== true) {
    throw new Error(
      "Entrada na fila de revisão exige confirmação humana explícita.",
    );
  }
  if (
    requiredHash(
      queueReview.expectedCandidateHash,
      "queueReview.expectedCandidateHash",
    ) !== candidateHash
  ) {
    throw new Error(
      "queueReview.expectedCandidateHash diverge do candidate exato.",
    );
  }
  const approvedBy = requiredText(
    queueReview.approvedBy,
    "queueReview.approvedBy",
    200,
  );
  if (approvedBy !== actor) {
    throw new Error("queueReview.approvedBy deve ser o actor exato.");
  }
  const decidedAt = normalizedIso(
    queueReview.decidedAt,
    "queueReview.decidedAt",
  );
  if (decidedAt !== materializedAt) {
    throw new Error(
      "queueReview.decidedAt deve coincidir com o snapshot de direitos.",
    );
  }
  return {
    approvedBy,
    decidedAt,
  };
}

function provenanceEntry({
  sourceType,
  sourceRef,
  method,
  observedAt,
  contentHash,
}) {
  return {
    sourceType,
    sourceRef,
    method,
    observedAt,
    contentHash,
  };
}

function prepareMaterialization({
  candidate,
  targetItem,
  effectiveRights,
  protectedTerms,
  rootScopeId,
  scopeId,
  actor,
  materializedAt = null,
  queueReview = null,
  styleSpecBinding = null,
} = {}) {
  validateReferenceTechniqueCandidate(candidate, {
    targetItem,
    effectiveRights,
    protectedTerms,
  });
  assertEffectiveRightsDecision({
    targetItem,
    effectiveRights,
  });
  const normalizedRootScopeId = requiredIdentifier(
    rootScopeId,
    "rootScopeId",
  );
  const normalizedScopeId = requiredIdentifier(scopeId, "scopeId");
  if (
    normalizedRootScopeId !== targetItem.rootScopeId
    || normalizedScopeId !== targetItem.scopeId
  ) {
    throw new Error(
      "Materialização exige rootScopeId e scopeId exatos do target.",
    );
  }
  const normalizedActor = requiredText(actor, "actor", 200);
  const normalizedMaterializedAt = normalizedIso(
    materializedAt ?? effectiveRights.evaluatedAt,
    "materializedAt",
  );
  if (normalizedMaterializedAt !== effectiveRights.evaluatedAt) {
    throw new Error(
      "materializedAt deve coincidir com o snapshot autoritativo de direitos.",
    );
  }
  const normalizedStyleBinding = normalizeStyleSpecBinding(
    styleSpecBinding,
  );
  const normalizedQueueReview = normalizeQueueReview(queueReview, {
    actor: normalizedActor,
    candidateHash: candidate.candidateHash,
    materializedAt: normalizedMaterializedAt,
  });
  return {
    candidate,
    targetItem,
    effectiveRights,
    rootScopeId: normalizedRootScopeId,
    scopeId: normalizedScopeId,
    actor: normalizedActor,
    materializedAt: normalizedMaterializedAt,
    queueReview: normalizedQueueReview,
    styleSpecBinding: normalizedStyleBinding,
    governanceRights: conservativeRights(effectiveRights),
  };
}

function makeEnvelope(prepared, {
  modality,
  evidenceIds = [],
  extraProvenance = [],
}) {
  const {
    candidate,
    targetItem,
    effectiveRights,
    materializedAt,
    actor,
    governanceRights,
  } = prepared;
  return createKnowledgeRecordEnvelope({
    classification: targetItem.governance.classification,
    owner: structuredClone(targetItem.governance.owner),
    provenance: [
      provenanceEntry({
        sourceType: "reference-technique-candidate",
        sourceRef: `candidate:${candidate.candidateHash}`,
        method: "deterministic-materialization",
        observedAt: materializedAt,
        contentHash: candidate.candidateHash,
      }),
      provenanceEntry({
        sourceType: "knowledge-item",
        sourceRef:
          `knowledge-item:${targetItem.id}@${targetItem.revision}`,
        method: "exact-target-binding",
        observedAt: targetItem.createdAt,
        contentHash: targetItem.contentHash,
      }),
      provenanceEntry({
        sourceType: "effective-rights",
        sourceRef: `rights-decision:${effectiveRights.decisionHash}`,
        method: "head-only-rights-check",
        observedAt: effectiveRights.evaluatedAt,
        contentHash: effectiveRights.decisionHash,
      }),
      ...extraProvenance,
    ],
    modality,
    evidenceIds,
    retention: structuredClone(targetItem.governance.retention),
    rights: structuredClone(governanceRights),
    createdAt: materializedAt,
    createdBy: actor,
  }, {
    expectedActor: actor,
  });
}

function makeItem(prepared, {
  id,
  recordType,
  schemaId,
  governance,
  payload,
}) {
  assertKnowledgeRecordPayloadContract({
    recordType,
    schemaId,
    schemaVersion: 1,
    payload,
  });
  assertKnowledgeRecordEnvelope(governance, {
    expectedActor: prepared.actor,
  });
  const body = {
    schema: ITEM_SCHEMA,
    id: requiredIdentifier(id, "item.id"),
    revision: 1,
    rootScopeId: prepared.rootScopeId,
    scopeId: prepared.scopeId,
    recordType,
    schemaId,
    schemaVersion: 1,
    status: "candidate",
    governance: structuredClone(governance),
    supersedesRevision: null,
    payload: structuredClone(payload),
    createdAt: prepared.materializedAt,
    createdBy: prepared.actor,
  };
  const result = {
    ...body,
    contentHash: sha256Json(body),
  };
  assertKnowledgeContract(result, {
    schemaId: ITEM_SCHEMA,
    label: "Knowledge candidate materializado",
  });
  return result;
}

function baseIdentity(prepared) {
  return {
    rootScopeId: prepared.rootScopeId,
    targetId: prepared.targetItem.id,
    targetRevision: prepared.targetItem.revision,
    targetContentHash: prepared.targetItem.contentHash,
    candidateHash: prepared.candidate.candidateHash,
  };
}

function persistenceExpectedHeads(prepared) {
  const {
    targetItem,
    effectiveRights,
  } = prepared;
  return [
    {
      rootScopeId: targetItem.rootScopeId,
      id: targetItem.id,
      revision: targetItem.revision,
      contentHash: targetItem.contentHash,
      status: targetItem.status,
      schemaId: targetItem.schemaId,
    },
    {
      rootScopeId: targetItem.rootScopeId,
      id: effectiveRights.rightsHead.id,
      revision: effectiveRights.rightsHead.revision,
      contentHash: effectiveRights.rightsHead.contentHash,
      status: effectiveRights.rightsHead.status,
      schemaId: RIGHTS_SCHEMA,
    },
  ];
}

function buildPreparedMaterialization(prepared) {
  const {
    candidate,
    targetItem,
    effectiveRights,
    rootScopeId,
    scopeId,
    actor,
    materializedAt,
    queueReview,
    styleSpecBinding,
    governanceRights,
  } = prepared;
  const identity = baseIdentity(prepared);
  const segmentItems = candidate.analysis.segments.map((segment) =>
    makeItem(prepared, {
      id: stableId("reference-segment", {
        ...identity,
        kind: "segment",
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
      }),
      recordType: "entity",
      schemaId: ENTITY_SCHEMA,
      governance: makeEnvelope(prepared, {
        modality: "observation",
      }),
      payload: {
        schema: ENTITY_SCHEMA,
        entityType: "reference-segment",
        name: `Fragmento técnico ${segment.id}`,
        aliases: [],
        attributes: {
          candidateHash: candidate.candidateHash,
          sourceTarget: structuredClone(candidate.sourceTarget),
          rightsDecisionHash: effectiveRights.decisionHash,
          segmentId: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          observationCount: segment.observations.length,
          candidateOnly: true,
          activeRule: false,
        },
        evidenceRefs: [],
      },
    }));
  const techniqueItem = makeItem(prepared, {
    id: stableId("reference-technique", {
      ...identity,
      kind: "technique-card",
    }),
    recordType: "entity",
    schemaId: ENTITY_SCHEMA,
    governance: makeEnvelope(prepared, {
      modality: "hypothesis",
    }),
    payload: {
      schema: ENTITY_SCHEMA,
      entityType: "reference-technique-card",
      name: candidate.techniqueCard.title,
      aliases: [],
      attributes: {
        candidateHash: candidate.candidateHash,
        sourceTarget: structuredClone(candidate.sourceTarget),
        rightsDecisionHash: effectiveRights.decisionHash,
        abstraction: candidate.techniqueCard.abstraction,
        principle: candidate.techniqueCard.principle,
        mechanism: candidate.techniqueCard.mechanism,
        applicability: structuredClone(
          candidate.techniqueCard.applicability,
        ),
        constraints: structuredClone(
          candidate.techniqueCard.constraints,
        ),
        failureModes: structuredClone(
          candidate.techniqueCard.failureModes,
        ),
        segmentIds: segmentItems.map(({ id }) => id),
        lint: structuredClone(candidate.lint),
        transferableOnly: true,
        candidateOnly: true,
        activeRule: false,
      },
      evidenceRefs: [],
    },
  });
  const observationItems = [];
  candidate.analysis.segments.forEach((segment, segmentIndex) => {
    const segmentItem = segmentItems[segmentIndex];
    segment.observations.forEach((observation, observationIndex) => {
      observationItems.push(makeItem(prepared, {
        id: stableId("reference-observation", {
          ...identity,
          kind: "observation",
          segmentId: segment.id,
          observationIndex,
          domain: observation.domain,
        }),
        recordType: "evidence",
        schemaId: EVIDENCE_SCHEMA,
        governance: makeEnvelope(prepared, {
          modality: "observation",
        }),
        payload: {
          schema: EVIDENCE_SCHEMA,
          source: {
            sourceType: "reference-asset",
            sourceRef:
              `knowledge-item:${targetItem.id}@${targetItem.revision}`,
            contentHash: targetItem.contentHash,
            method: "local-analysis",
            observedAt: materializedAt,
            fragment: {
              startMs: segment.startMs,
              endMs: segment.endMs,
            },
          },
          relation: "supports",
          targetRefs: [
            itemReference(segmentItem),
            itemReference(techniqueItem),
          ],
          observation: observation.statement,
          confidence: 0.5,
          evidenceRefs: [],
        },
      }));
    });
  });
  const observationRefs = observationItems.map(itemReference);
  const observationIds = observationItems.map(({ id }) => id);
  const decisionItem = queueReview == null
    ? null
    : makeItem(prepared, {
        id: stableId("reference-technique-review", {
          ...identity,
          kind: "review-queue-decision",
        }),
        recordType: "decision",
        schemaId: DECISION_SCHEMA,
        governance: makeEnvelope(prepared, {
          modality: "hard-constraint",
          evidenceIds: observationIds,
          extraProvenance: [
            provenanceEntry({
              sourceType: "human-decision",
              sourceRef: `human-decision:${candidate.candidateHash}`,
              method: "review-queue-confirmation",
              observedAt: queueReview.decidedAt,
              contentHash: candidate.candidateHash,
            }),
          ],
        }),
        payload: {
          schema: DECISION_SCHEMA,
          question:
            "Esta técnica candidata pode entrar na fila de revisão humana?",
          options: [
            {
              id: "queue-for-review",
              label: "Incluir somente na fila de revisão",
            },
            {
              id: "do-not-queue",
              label: "Não incluir na fila de revisão",
            },
          ],
          selectedOptionId: "queue-for-review",
          rationale:
            "Confirmação humana limitada à fila; não promove nem ativa a técnica.",
          contextRefs: [
            itemReference(techniqueItem),
            ...segmentItems.map(itemReference),
          ],
          evidenceRefs: observationRefs,
          confidence: 1,
          impact: {
            candidateHash: candidate.candidateHash,
            targetId: targetItem.id,
            targetRevision: targetItem.revision,
            targetContentHash: targetItem.contentHash,
            entersReviewQueueOnly: true,
            promoted: false,
            activeRulesCreated: 0,
          },
          humanConfirmed: true,
          approvedBy: queueReview.approvedBy,
          decidedAt: queueReview.decidedAt,
        },
      });
  const styleAssertionItem = styleSpecBinding == null
    ? null
    : makeItem(prepared, {
        id: stableId("reference-technique-style", {
          ...identity,
          kind: "style-spec-candidate-binding",
          styleSpecId: styleSpecBinding.styleSpecId,
          styleSpecHash: styleSpecBinding.styleSpecHash,
        }),
        recordType: "assertion",
        schemaId: ASSERTION_SCHEMA,
        governance: makeEnvelope(prepared, {
          modality: "hypothesis",
          evidenceIds: observationIds,
          extraProvenance: [
            provenanceEntry({
              sourceType: "style-spec",
              sourceRef: `style-spec:${styleSpecBinding.styleSpecId}`,
              method: "hash-bound-candidate-link",
              observedAt: materializedAt,
              contentHash: styleSpecBinding.styleSpecHash,
            }),
          ],
        }),
        payload: {
          schema: ASSERTION_SCHEMA,
          subjectRef: itemReference(techniqueItem),
          predicate: "style-spec.candidate-technique-link",
          value: {
            styleSpecId: styleSpecBinding.styleSpecId,
            styleSpecHash: styleSpecBinding.styleSpecHash,
            bindingStatus: "candidate",
            activatesRule: false,
          },
          polarity: "positive",
          applicability: {
            reviewRequired: true,
            candidateOnly: true,
          },
          confidence: 1,
          evidenceRefs: observationRefs,
        },
      });
  const items = [
    ...segmentItems,
    techniqueItem,
    ...observationItems,
    ...(decisionItem == null ? [] : [decisionItem]),
    ...(styleAssertionItem == null ? [] : [styleAssertionItem]),
  ];
  const body = {
    kind: REFERENCE_TECHNIQUE_MATERIALIZATION_KIND,
    status: "candidate",
    providerFree: true,
    persisted: false,
    activeRulesCreated: 0,
    rootScopeId,
    scopeId,
    actor,
    materializedAt,
    candidateHash: candidate.candidateHash,
    sourceTarget: structuredClone(candidate.sourceTarget),
    rightsDecision: {
      authority: effectiveRights.authority,
      evaluatedAt: effectiveRights.evaluatedAt,
      decisionHash: effectiveRights.decisionHash,
      localAnalysis: structuredClone(
        effectiveRights.permissions.localAnalysis,
      ),
      textualIndexing: structuredClone(
        effectiveRights.permissions.textualIndexing,
      ),
    },
    persistenceExpectedHeads: persistenceExpectedHeads(prepared),
    governanceRights: structuredClone(governanceRights),
    reviewQueueConfirmed: queueReview != null,
    styleSpecBinding: styleSpecBinding == null
      ? null
      : structuredClone(styleSpecBinding),
    segmentItems,
    techniqueItem,
    observationItems,
    decisionItem,
    styleAssertionItem,
    items,
  };
  return {
    ...body,
    materializationHash: sha256Json(body),
  };
}

function assertMaterializedItem(item, prepared) {
  assertKnowledgeContract(item, {
    schemaId: ITEM_SCHEMA,
    label: "Knowledge candidate materializado",
  });
  assertKnowledgeRecordPayloadContract({
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    payload: item.payload,
  });
  assertKnowledgeRecordEnvelope(item.governance, {
    expectedActor: prepared.actor,
  });
  const { contentHash, ...body } = item;
  if (contentHash !== sha256Json(body)) {
    throw new Error(
      "Knowledge candidate materializado possui contentHash inválido.",
    );
  }
  if (
    item.status !== "candidate"
    || item.rootScopeId !== prepared.rootScopeId
    || item.scopeId !== prepared.scopeId
    || item.createdBy !== prepared.actor
    || item.createdAt !== prepared.materializedAt
  ) {
    throw new Error(
      "Knowledge item materializado escapou do status/root/scope/actor.",
    );
  }
  assertSameJson(
    item.governance.rights,
    prepared.governanceRights,
    "Knowledge item materializado ampliou direitos.",
  );
  return item;
}

function assertPreparedMaterialization(result, prepared, expected) {
  assertSameJson(
    result,
    expected,
    "Materialização de técnica diverge da projeção canônica.",
  );
  if (
    result.providerFree !== true
    || result.persisted !== false
    || result.status !== "candidate"
    || result.activeRulesCreated !== 0
  ) {
    throw new Error(
      "Materialização de técnica perdeu garantias provider-free/candidate.",
    );
  }
  const itemIds = new Set();
  for (const item of result.items) {
    assertMaterializedItem(item, prepared);
    if (itemIds.has(item.id)) {
      throw new Error("Materialização contém item ID duplicado.");
    }
    itemIds.add(item.id);
  }
  if (
    result.items.some((item) => item.status !== "candidate")
    || result.items.some((item) =>
      item.payload?.attributes?.activeRule === true)
  ) {
    throw new Error("Materialização não pode criar regra active.");
  }
  const { materializationHash, ...body } = result;
  if (materializationHash !== sha256Json(body)) {
    throw new Error("Materialização possui materializationHash inválido.");
  }
  return result;
}

export function validateReferenceTechniqueMaterialization(
  result,
  options = {},
) {
  const prepared = prepareMaterialization(options);
  const expected = buildPreparedMaterialization(prepared);
  return assertPreparedMaterialization(result, prepared, expected);
}

export function buildReferenceTechniqueMaterialization(options = {}) {
  const prepared = prepareMaterialization(options);
  const result = buildPreparedMaterialization(prepared);
  assertPreparedMaterialization(result, prepared, result);
  return deepFreeze(result);
}
