import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS,
  KNOWLEDGE_ASSERTION_SCHEMA,
  KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
  KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
  KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
  KNOWLEDGE_REFERENCE_SCHEMA,
  KNOWLEDGE_RELATION_SCHEMA,
  KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
  KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS,
  assertCanonicalKnowledgePayload,
  assertKnowledgeRecordPayloadContract,
  classifyKnowledgeSchemaRole,
  collectCanonicalKnowledgeReferences,
  isCanonicalKnowledgePayloadIdentity,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import {
  listKnowledgeSchemas,
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const FIXED_AT = "2026-07-24T12:00:00.000Z";

function scopeRef(id = "client:a") {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "scope",
    rootScopeId: "client:a",
    id,
  };
}

function itemRef({
  id,
  recordType,
  revision = 1,
  contentHash = HASH_A,
  rootScopeId = "client:a",
}) {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "item",
    rootScopeId,
    id,
    revision,
    recordType,
    contentHash,
  };
}

function permissions(value = "unknown") {
  return {
    inventory: value,
    localAnalysis: value,
    textualIndexing: value,
    embedding: value,
    training: value,
    providerInput: value,
    publication: value,
    reuse: value,
  };
}

function canonicalCases() {
  const evidenceReference = itemRef({
    id: "evidence:one",
    recordType: "evidence",
    contentHash: HASH_C,
  });
  return [
    {
      recordType: "entity",
      schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
        entityType: "brand",
        name: "Marca Alpha",
        aliases: ["Alpha"],
        attributes: { market: "education" },
        evidenceRefs: [],
      },
    },
    {
      recordType: "relation",
      schemaId: KNOWLEDGE_RELATION_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_RELATION_SCHEMA,
        subjectRef: itemRef({
          id: "entity:brand",
          recordType: "entity",
        }),
        predicate: "brand.belongs-to",
        objectRef: itemRef({
          id: "entity:client",
          recordType: "entity",
          contentHash: HASH_B,
        }),
        qualifiers: { since: 2026 },
        evidenceRefs: [evidenceReference],
      },
    },
    {
      recordType: "assertion",
      schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_ASSERTION_SCHEMA,
        subjectRef: scopeRef(),
        predicate: "cta.minimum-hold-frames",
        value: 24,
        polarity: "positive",
        applicability: { aspect: "9:16" },
        confidence: 0.9,
        evidenceRefs: [evidenceReference],
      },
    },
    {
      recordType: "evidence",
      schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
        source: {
          sourceType: "human-review",
          sourceRef: "review:comparison-001",
          contentHash: HASH_A,
          method: "manual",
          observedAt: FIXED_AT,
          fragment: {
            startMs: 1000,
            endMs: 2200,
          },
        },
        relation: "supports",
        targetRefs: [
          itemRef({
            id: "assertion:cta-hold",
            recordType: "assertion",
            contentHash: HASH_B,
          }),
        ],
        observation: "O hold maior foi aprovado.",
        confidence: 1,
        evidenceRefs: [],
      },
    },
    {
      recordType: "rights",
      schemaId: KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
        targetRef: scopeRef("brand:alpha"),
        permissions: permissions("denied"),
        basis: "Sem autorização documentada para envio a provider.",
        validFrom: FIXED_AT,
        expiresAt: null,
        evidenceRefs: [evidenceReference],
      },
    },
    {
      recordType: "decision",
      schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
        question: "Qual direção será usada?",
        options: [
          { id: "option:a", label: "Direção A" },
          { id: "option:b", label: "Direção B" },
        ],
        selectedOptionId: "option:b",
        rationale: "A opção B respeita melhor o brief aprovado.",
        contextRefs: [scopeRef("project:campaign")],
        evidenceRefs: [evidenceReference],
        confidence: 0.85,
        impact: { planning: "high" },
        humanConfirmed: true,
        approvedBy: "human:ana",
        decidedAt: FIXED_AT,
      },
    },
  ];
}

test("registry carrega a referência, payloads canônicos e especializados", () => {
  const registered = new Set(listKnowledgeSchemas().map(({ id }) => id));
  const expected = [
    KNOWLEDGE_REFERENCE_SCHEMA,
    ...CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS.map(({ schemaId }) => schemaId),
  ];
  assert.equal(CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS.length, 7);
  assert.equal(
    new Set(
      CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS.map(({ recordType }) => recordType),
    ).size,
    6,
  );
  expected.forEach((schemaId) => assert.equal(registered.has(schemaId), true));
  assert.equal(validateKnowledgeContract(scopeRef()).valid, true);
  assert.deepEqual(
    KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS.map(
      ({ schemaId }) => schemaId,
    ),
    [
      "mkt-videos/smart-collection@1",
      "mkt-videos/prompt-template-revision@1",
      "mkt-videos/media-transcript@1",
      "mkt-videos/knowledge-asset-link-payload@1",
    ],
  );
});

test("cada recordType aceita somente seu schema e o validador não muta o payload", () => {
  for (const entry of canonicalCases()) {
    const before = structuredClone(entry.payload);
    assert.equal(isCanonicalKnowledgePayloadIdentity(entry), true);
    assert.equal(
      assertKnowledgeRecordPayloadContract(entry),
      entry.payload,
    );
    assert.equal(assertCanonicalKnowledgePayload(entry), entry.payload);
    assert.deepEqual(entry.payload, before);
  }

  const assertion = canonicalCases().find(
    ({ recordType }) => recordType === "assertion",
  );
  assert.equal(
    isCanonicalKnowledgePayloadIdentity({
      ...assertion,
      recordType: "relation",
    }),
    false,
  );
  assert.throws(
    () => assertCanonicalKnowledgePayload({
      ...assertion,
      recordType: "relation",
    }),
    /pertence a recordType assertion/,
  );
  assert.throws(
    () => assertCanonicalKnowledgePayload({
      ...assertion,
      schemaVersion: 2,
    }),
    /exige schemaVersion 1/,
  );
  assert.throws(
    () => assertCanonicalKnowledgePayload({
      ...assertion,
      schemaId: "mkt-videos/unregistered-payload@1",
    }),
    /não registrado e bloqueado/,
  );
  assert.throws(
    () => assertCanonicalKnowledgePayload({
      ...assertion,
      payload: {
        ...assertion.payload,
        unexpected: true,
      },
    }),
    /additional properties/,
  );
});

test("coleta referências declaradas em ordem determinística e aplica papéis tipados", () => {
  const relation = canonicalCases().find(
    ({ recordType }) => recordType === "relation",
  );
  const references = collectCanonicalKnowledgeReferences(relation);
  assert.deepEqual(
    references.map(({ path, role, expectedRecordType }) => ({
      path,
      role,
      expectedRecordType,
    })),
    [
      {
        path: "$.subjectRef",
        role: "subject",
        expectedRecordType: "entity",
      },
      {
        path: "$.objectRef",
        role: "object",
        expectedRecordType: "entity",
      },
      {
        path: "$.evidenceRefs[0]",
        role: "evidence",
        expectedRecordType: "evidence",
      },
    ],
  );
  assert.equal(Object.isFrozen(references), true);
  assert.equal(Object.isFrozen(references[0]), true);
  assert.equal(Object.isFrozen(references[0].reference), true);

  const scopeAsRelationSubject = structuredClone(relation);
  scopeAsRelationSubject.payload.subjectRef = scopeRef();
  assert.equal(
    validateKnowledgeContract(
      scopeAsRelationSubject.payload,
      { schemaId: KNOWLEDGE_RELATION_SCHEMA },
    ).valid,
    true,
  );
  assert.throws(
    () => collectCanonicalKnowledgeReferences(scopeAsRelationSubject),
    /subjectRef exige kind item/,
  );

  const assertionAsRelationSubject = structuredClone(relation);
  assertionAsRelationSubject.payload.subjectRef = itemRef({
    id: "assertion:not-entity",
    recordType: "assertion",
  });
  assert.throws(
    () => collectCanonicalKnowledgeReferences(assertionAsRelationSubject),
    /subjectRef exige recordType entity/,
  );
});

test("evidenceRefs são refs de evidence e destinos duplicados falham fechado", () => {
  const entity = canonicalCases().find(
    ({ recordType }) => recordType === "entity",
  );
  const wrongEvidenceKind = structuredClone(entity);
  wrongEvidenceKind.payload.evidenceRefs = [scopeRef()];
  assert.throws(
    () => assertCanonicalKnowledgePayload(wrongEvidenceKind),
    /evidenceRefs\[0\] exige kind item/,
  );

  const duplicateIdentity = structuredClone(entity);
  duplicateIdentity.payload.evidenceRefs = [
    itemRef({
      id: "evidence:same",
      recordType: "evidence",
      contentHash: HASH_A,
    }),
    itemRef({
      id: "evidence:same",
      recordType: "evidence",
      contentHash: HASH_B,
    }),
  ];
  assert.equal(
    validateKnowledgeContract(
      duplicateIdentity.payload,
      { schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA },
    ).valid,
    true,
  );
  assert.throws(
    () => assertCanonicalKnowledgePayload(duplicateIdentity),
    /destino duplicada/,
  );
});

test("semântica local bloqueia decisão, validade e time range inconsistentes", () => {
  const decision = canonicalCases().find(
    ({ recordType }) => recordType === "decision",
  );
  const missingSelection = structuredClone(decision);
  missingSelection.payload.selectedOptionId = "option:missing";
  assert.throws(
    () => assertCanonicalKnowledgePayload(missingSelection),
    /selectedOptionId não pertence/,
  );

  const duplicateOption = structuredClone(decision);
  duplicateOption.payload.options[1] = {
    id: "option:a",
    label: "Mesmo ID, outro rótulo",
  };
  assert.throws(
    () => assertCanonicalKnowledgePayload(duplicateOption),
    /options contém IDs duplicados/,
  );

  const rights = canonicalCases().find(
    ({ recordType }) => recordType === "rights",
  );
  const expiredBeforeStart = structuredClone(rights);
  expiredBeforeStart.payload.expiresAt = "2026-07-24T11:59:59.000Z";
  assert.throws(
    () => assertCanonicalKnowledgePayload(expiredBeforeStart),
    /expiresAt deve ser posterior/,
  );

  const evidence = canonicalCases().find(
    ({ recordType }) => recordType === "evidence",
  );
  const invertedRange = structuredClone(evidence);
  invertedRange.payload.source.fragment.endMs = 1000;
  assert.throws(
    () => assertCanonicalKnowledgePayload(invertedRange),
    /endMs deve ser posterior/,
  );
});

test("projeções e candidatos especializados não viram payload por acidente", () => {
  const assetPayload = {
    schema: "mkt-videos/knowledge-asset-link-payload@1",
    rootKind: "outputs",
    relativePath: "collection/video.mp4",
    expectedSha256: HASH_A,
    expectedBytes: 123,
    mediaType: "video/mp4",
  };
  const assetRole = classifyKnowledgeSchemaRole(assetPayload.schema);
  assert.equal(assetRole.kind, "specialized-item-payload");
  assert.equal(assetRole.persistableItemPayload, true);
  assert.equal(assetRole.canonical, false);
  assert.equal(
    assertKnowledgeRecordPayloadContract({
      recordType: "relation",
      schemaId: assetPayload.schema,
      schemaVersion: 1,
      payload: assetPayload,
    }),
    assetPayload,
  );

  for (const [schemaId, expectedKind] of [
    ["mkt-videos/knowledge-asset-link@1", "runtime-projection"],
    ["mkt-videos/knowledge-import-candidate@1", "import-candidate"],
    ["mkt-videos/knowledge-import-batch@1", "import-batch"],
    ["mkt-videos/domain-pack@1", "global-domain-pack"],
    ["mkt-videos/domain-pack-catalog@1", "global-projection"],
    [
      "mkt-videos/knowledge-domain-pack-action-result@1",
      "global-projection",
    ],
  ]) {
    const role = classifyKnowledgeSchemaRole(schemaId);
    assert.equal(role.kind, expectedKind);
    assert.equal(role.persistableItemPayload, false);
    assert.throws(
      () => assertKnowledgeRecordPayloadContract({
        recordType: "relation",
        schemaId,
        schemaVersion: 1,
        payload: { schema: schemaId },
      }),
      /não um payload persistível/,
    );
  }
  assert.equal(
    classifyKnowledgeSchemaRole("mkt-videos/unknown@1").kind,
    "unknown",
  );
});
