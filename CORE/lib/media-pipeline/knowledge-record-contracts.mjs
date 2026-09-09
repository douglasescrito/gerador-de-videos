import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_REFERENCE_SCHEMA =
  "mkt-videos/knowledge-reference@1";
export const KNOWLEDGE_ENTITY_PROFILE_SCHEMA =
  "mkt-videos/entity-profile@1";
export const KNOWLEDGE_RELATION_SCHEMA =
  "mkt-videos/knowledge-relation@1";
export const KNOWLEDGE_ASSERTION_SCHEMA =
  "mkt-videos/knowledge-assertion@1";
export const KNOWLEDGE_EVIDENCE_LINK_SCHEMA =
  "mkt-videos/evidence-link@1";
export const KNOWLEDGE_RIGHTS_RECORD_SCHEMA =
  "mkt-videos/rights-record@1";
export const KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA =
  "mkt-videos/creative-decision-record@1";
export const KNOWLEDGE_PREFERENCE_RULE_SCHEMA =
  "mkt-videos/preference-rule@1";
export const KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA =
  "mkt-videos/knowledge-asset-link-payload@1";
export const KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA =
  "mkt-videos/knowledge-retrieval-request@1";
export const KNOWLEDGE_RETRIEVAL_TRACE_SCHEMA =
  "mkt-videos/retrieval-trace@1";
export const KNOWLEDGE_CONTEXT_SCHEMA =
  "mkt-videos/knowledge-context@1";
export const KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA =
  "mkt-videos/knowledge-retrieval-action-result@1";
export const KNOWLEDGE_RETRIEVAL_EVALUATION_SCHEMA =
  "mkt-videos/retrieval-shadow-evaluation@1";
export const KNOWLEDGE_PROMPT_TEMPLATE_SCHEMA =
  "mkt-videos/prompt-template@1";
export const KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA =
  "mkt-videos/prompt-template-revision@1";
export const KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA =
  "mkt-videos/media-transcript@1";
export const KNOWLEDGE_SMART_COLLECTION_SCHEMA =
  "mkt-videos/smart-collection@1";

const RECORD_TYPES = Object.freeze([
  "entity",
  "relation",
  "assertion",
  "evidence",
  "rights",
  "decision",
]);

function freezeReferenceRule({
  property,
  multiple,
  role,
  allowedKinds,
  expectedRecordType = null,
}) {
  return Object.freeze({
    property,
    multiple,
    role,
    allowedKinds: Object.freeze([...allowedKinds]),
    expectedRecordType,
  });
}

function freezePayloadContract({
  recordType,
  schemaId,
  schemaVersion,
  referenceRules,
  canonical = true,
  kind = "item-payload",
}) {
  return Object.freeze({
    kind,
    persistableItemPayload: true,
    canonical,
    recordType,
    schemaId,
    schemaVersion,
    referenceRules: Object.freeze(
      referenceRules.map(freezeReferenceRule),
    ),
  });
}

const EVIDENCE_REFERENCE_RULE = Object.freeze({
  property: "evidenceRefs",
  multiple: true,
  role: "evidence",
  allowedKinds: ["item"],
  expectedRecordType: "evidence",
});

export const CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS = Object.freeze([
  freezePayloadContract({
    recordType: "entity",
    schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
  freezePayloadContract({
    recordType: "relation",
    schemaId: KNOWLEDGE_RELATION_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "subjectRef",
        multiple: false,
        role: "subject",
        allowedKinds: ["item"],
        expectedRecordType: "entity",
      },
      {
        property: "objectRef",
        multiple: false,
        role: "object",
        allowedKinds: ["item"],
        expectedRecordType: "entity",
      },
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
  freezePayloadContract({
    recordType: "assertion",
    schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "subjectRef",
        multiple: false,
        role: "subject",
        allowedKinds: ["scope", "item"],
      },
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
  freezePayloadContract({
    recordType: "assertion",
    schemaId: KNOWLEDGE_PREFERENCE_RULE_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "subjectRef",
        multiple: false,
        role: "subject",
        allowedKinds: ["scope", "item"],
      },
      {
        property: "evidenceRefs",
        multiple: true,
        role: "evidence",
        allowedKinds: ["item"],
        expectedRecordType: "evidence",
      },
    ],
  }),
  freezePayloadContract({
    recordType: "evidence",
    schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "targetRefs",
        multiple: true,
        role: "target",
        allowedKinds: ["scope", "item"],
      },
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
  freezePayloadContract({
    recordType: "rights",
    schemaId: KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "targetRef",
        multiple: false,
        role: "target",
        allowedKinds: ["scope", "item"],
      },
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
  freezePayloadContract({
    recordType: "decision",
    schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
    schemaVersion: 1,
    referenceRules: [
      {
        property: "contextRefs",
        multiple: true,
        role: "context",
        allowedKinds: ["scope", "item"],
      },
      EVIDENCE_REFERENCE_RULE,
    ],
  }),
]);

export const KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS = Object.freeze([
  freezePayloadContract({
    recordType: "assertion",
    schemaId: KNOWLEDGE_SMART_COLLECTION_SCHEMA,
    schemaVersion: 1,
    referenceRules: [],
    canonical: false,
    kind: "specialized-item-payload",
  }),
  freezePayloadContract({
    recordType: "assertion",
    schemaId: KNOWLEDGE_PROMPT_TEMPLATE_REVISION_SCHEMA,
    schemaVersion: 1,
    referenceRules: [],
    canonical: false,
    kind: "specialized-item-payload",
  }),
  freezePayloadContract({
    recordType: "evidence",
    schemaId: KNOWLEDGE_MEDIA_TRANSCRIPT_SCHEMA,
    schemaVersion: 1,
    referenceRules: [],
    canonical: false,
    kind: "specialized-item-payload",
  }),
  freezePayloadContract({
    recordType: "relation",
    schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    schemaVersion: 1,
    referenceRules: [],
    canonical: false,
    kind: "specialized-item-payload",
  }),
]);

export const KNOWLEDGE_SPECIALIZED_NON_ITEM_CONTRACTS = Object.freeze([
  Object.freeze({
    schemaId: KNOWLEDGE_PROMPT_TEMPLATE_SCHEMA,
    kind: "runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/knowledge-asset-link@1",
    kind: "runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/knowledge-import-candidate@1",
    kind: "import-candidate",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/knowledge-import-batch@1",
    kind: "import-batch",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/domain-pack@1",
    kind: "global-domain-pack",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/domain-pack-catalog@1",
    kind: "global-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/knowledge-domain-pack-action-result@1",
    kind: "global-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/audiovisual-ontology@1",
    kind: "global-ontology",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/reference-inventory@1",
    kind: "reference-inventory-candidate",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/reference-cohort-manifest@1",
    kind: "reference-cohort-candidate",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/cohort-rights-attestation@1",
    kind: "human-rights-attestation",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/effective-rights@1",
    kind: "rights-runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/reference-technique-candidate@1",
    kind: "reference-analysis-candidate",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/feedback-interpretation-candidate@1",
    kind: "feedback-interpretation-candidate-event",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/feedback-promotion-decision@1",
    kind: "feedback-promotion-decision-event",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId:
      "mkt-videos/knowledge-feedback-interpretation-action-result@1",
    kind: "feedback-interpretation-runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/knowledge-feedback-promotion-action-result@1",
    kind: "feedback-promotion-runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: "mkt-videos/feedback-canonicalization-request@1",
    kind: "feedback-canonicalization-request",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId:
      "mkt-videos/knowledge-feedback-canonicalization-action-result@1",
    kind: "feedback-canonicalization-runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: KNOWLEDGE_RETRIEVAL_REQUEST_SCHEMA,
    kind: "retrieval-request",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: KNOWLEDGE_RETRIEVAL_TRACE_SCHEMA,
    kind: "retrieval-trace",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: KNOWLEDGE_CONTEXT_SCHEMA,
    kind: "knowledge-context",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: KNOWLEDGE_RETRIEVAL_ACTION_RESULT_SCHEMA,
    kind: "retrieval-runtime-projection",
    persistableItemPayload: false,
  }),
  Object.freeze({
    schemaId: KNOWLEDGE_RETRIEVAL_EVALUATION_SCHEMA,
    kind: "retrieval-evaluation-projection",
    persistableItemPayload: false,
  }),
]);

const payloadContractBySchemaId = new Map(
  [
    ...CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS,
    ...KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS,
  ].map((contract) => [contract.schemaId, contract]),
);
const nonItemContractBySchemaId = new Map(
  KNOWLEDGE_SPECIALIZED_NON_ITEM_CONTRACTS.map((contract) => [
    contract.schemaId,
    contract,
  ]),
);

function requiredText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function normalizedVersion(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${label} deve ser um inteiro positivo.`);
  }
  return normalized;
}

function payloadContractForIdentity({
  recordType,
  schemaId,
  schemaVersion,
}) {
  const normalizedRecordType = requiredText(recordType, "recordType");
  if (!RECORD_TYPES.includes(normalizedRecordType)) {
    throw new Error(`recordType não canônico: ${normalizedRecordType}.`);
  }
  const normalizedSchemaId = requiredText(schemaId, "schemaId");
  const normalizedSchemaVersion = normalizedVersion(
    schemaVersion,
    "schemaVersion",
  );
  const contract = payloadContractBySchemaId.get(normalizedSchemaId);
  if (!contract) {
    const specialized = nonItemContractBySchemaId.get(normalizedSchemaId);
    if (specialized) {
      throw new Error(
        `${normalizedSchemaId} é ${specialized.kind} e não um payload persistível.`,
      );
    }
    throw new Error(
      `Schema de payload não registrado e bloqueado: ${normalizedSchemaId}.`,
    );
  }
  if (contract.recordType !== normalizedRecordType) {
    throw new Error(
      `${normalizedSchemaId} pertence a recordType ${contract.recordType}, não ${normalizedRecordType}.`,
    );
  }
  if (contract.schemaVersion !== normalizedSchemaVersion) {
    throw new Error(
      `${normalizedSchemaId} exige schemaVersion ${contract.schemaVersion}.`,
    );
  }
  return contract;
}

function referenceIdentity(reference) {
  return reference.kind === "item"
    ? [
        reference.kind,
        reference.rootScopeId,
        reference.id,
        reference.revision,
      ].join("\u0000")
    : [
        reference.kind,
        reference.rootScopeId,
        reference.id,
      ].join("\u0000");
}

function referencesForContract(contract, payload) {
  const references = [];
  for (const rule of contract.referenceRules) {
    const values = rule.multiple
      ? payload[rule.property]
      : [payload[rule.property]];
    const identities = new Set();
    values.forEach((reference, index) => {
      const path = rule.multiple
        ? `$.${rule.property}[${index}]`
        : `$.${rule.property}`;
      if (!rule.allowedKinds.includes(reference.kind)) {
        throw new Error(
          `${path} exige kind ${rule.allowedKinds.join(" ou ")}.`,
        );
      }
      if (
        rule.expectedRecordType != null
        && reference.recordType !== rule.expectedRecordType
      ) {
        throw new Error(
          `${path} exige recordType ${rule.expectedRecordType}.`,
        );
      }
      const identity = referenceIdentity(reference);
      if (identities.has(identity)) {
        throw new Error(
          `${rule.property} contém referência de destino duplicada.`,
        );
      }
      identities.add(identity);
      references.push(Object.freeze({
        path,
        role: rule.role,
        allowedKinds: rule.allowedKinds,
        expectedRecordType: rule.expectedRecordType,
        reference: Object.freeze({ ...reference }),
      }));
    });
  }
  return Object.freeze(references);
}

function assertPayloadSemantics(contract, payload) {
  if (contract.schemaId === KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA) {
    const optionIds = payload.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      throw new Error("options contém IDs duplicados.");
    }
    if (!optionIds.includes(payload.selectedOptionId)) {
      throw new Error("selectedOptionId não pertence a options.");
    }
  }
  if (contract.schemaId === KNOWLEDGE_RIGHTS_RECORD_SCHEMA) {
    if (
      payload.expiresAt != null
      && Date.parse(payload.expiresAt) <= Date.parse(payload.validFrom)
    ) {
      throw new Error("expiresAt deve ser posterior a validFrom.");
    }
  }
  if (contract.schemaId === KNOWLEDGE_EVIDENCE_LINK_SCHEMA) {
    const { fragment } = payload.source;
    if (
      fragment?.startMs != null
      && fragment?.endMs != null
      && fragment.endMs <= fragment.startMs
    ) {
      throw new Error("source.fragment.endMs deve ser posterior a startMs.");
    }
  }
  return referencesForContract(contract, payload);
}

export function classifyKnowledgeSchemaRole(schemaId) {
  const normalizedSchemaId = String(schemaId ?? "").trim();
  const payloadContract = payloadContractBySchemaId.get(normalizedSchemaId);
  if (payloadContract) return payloadContract;
  const nonItemContract = nonItemContractBySchemaId.get(normalizedSchemaId);
  if (nonItemContract) return nonItemContract;
  return Object.freeze({
    schemaId: normalizedSchemaId || null,
    kind: "unknown",
    persistableItemPayload: false,
  });
}

export function isCanonicalKnowledgePayloadIdentity(options = {}) {
  try {
    return payloadContractForIdentity(options).canonical;
  } catch {
    return false;
  }
}

export function isPersistableKnowledgePayloadIdentity(options = {}) {
  try {
    return payloadContractForIdentity(options).persistableItemPayload;
  } catch {
    return false;
  }
}

export function assertKnowledgeRecordPayloadContract({
  recordType,
  schemaId,
  schemaVersion,
  payload,
} = {}) {
  const contract = payloadContractForIdentity({
    recordType,
    schemaId,
    schemaVersion,
  });
  assertKnowledgeContract(payload, {
    schemaId: contract.schemaId,
    label: `Payload ${contract.recordType}`,
  });
  assertPayloadSemantics(contract, payload);
  return payload;
}

export function assertCanonicalKnowledgePayload(options = {}) {
  return assertKnowledgeRecordPayloadContract(options);
}

export function collectCanonicalKnowledgeReferences(options = {}) {
  return collectKnowledgeRecordPayloadReferences(options);
}

export function collectKnowledgeRecordPayloadReferences(options = {}) {
  const payload = assertKnowledgeRecordPayloadContract(options);
  const contract = payloadContractForIdentity(options);
  return assertPayloadSemantics(contract, payload);
}
