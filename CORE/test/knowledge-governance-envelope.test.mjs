import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_RECORD_ENVELOPE_SCHEMA,
  KNOWLEDGE_RIGHTS,
  assertKnowledgeRecordEnvelope,
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  listKnowledgeSchemas,
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function base(overrides = {}) {
  return {
    classification: "confidential",
    owner: { type: "client", id: "client:alpha" },
    provenance: [{
      sourceType: "human-feedback",
      sourceRef: "feedback:fb-001",
      method: "explicit-statement",
      observedAt: "2026-07-23T18:00:00.000Z",
      contentHash: HASH_A,
    }],
    modality: "preference",
    evidenceIds: ["evidence:b", "evidence:a"],
    createdAt: "2026-07-23T18:05:00.000Z",
    createdBy: "ana",
    ...overrides,
  };
}

test("builder materializa envelope completo, validado e fail-closed por padrão", () => {
  const envelope = createKnowledgeRecordEnvelope(base(), { expectedActor: "ana" });

  assert.equal(envelope.schema, KNOWLEDGE_RECORD_ENVELOPE_SCHEMA);
  assert.equal(validateKnowledgeContract(envelope).valid, true);
  assert.equal(envelope.hash.length, 64);
  assert.deepEqual(envelope.evidenceIds, ["evidence:a", "evidence:b"]);
  assert.deepEqual(envelope.retention, {
    policy: "manual-review",
    expiresAt: null,
    basis: null,
  });
  assert.deepEqual(
    Object.fromEntries(KNOWLEDGE_RIGHTS.map((right) => [right, envelope.rights[right]])),
    Object.fromEntries(KNOWLEDGE_RIGHTS.map((right) => [right, "unknown"])),
  );
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.provenance), true);
  assert.equal(Object.isFrozen(envelope.rights), true);
});

test("canonicalização torna ordem de evidência, proveniência e rights irrelevante", () => {
  const provenanceA = {
    sourceType: "workspace-artifact",
    sourceRef: "receipt:receipt-002",
    method: "receipt-import",
    observedAt: "2026-07-23T17:00:00.000Z",
    contentHash: HASH_B,
  };
  const provenanceB = base().provenance[0];
  const rightsA = {
    publication: "denied",
    inventory: "allowed",
    providerInput: "unknown",
  };
  const rightsB = {
    providerInput: "unknown",
    inventory: "allowed",
    publication: "denied",
  };

  const first = createKnowledgeRecordEnvelope(base({
    provenance: [provenanceA, provenanceB],
    evidenceIds: ["evidence:b", "evidence:a", "evidence:b"],
    rights: rightsA,
  }));
  const repeated = createKnowledgeRecordEnvelope(base({
    provenance: [provenanceB, provenanceA],
    evidenceIds: ["evidence:a", "evidence:b"],
    rights: rightsB,
  }));

  assert.deepEqual(first, repeated);
  assert.equal(first.hash, repeated.hash);
});

test("cada direito mantém estado independente sem concessão implícita", () => {
  const envelope = createKnowledgeRecordEnvelope(base({
    rights: {
      inventory: "allowed",
      localAnalysis: "denied",
      textualIndexing: "unknown",
      embedding: "revoked",
      training: "expired",
      providerInput: "denied",
      publication: "allowed",
      reuse: "unknown",
    },
  }));

  assert.deepEqual(envelope.rights, {
    inventory: "allowed",
    localAnalysis: "denied",
    textualIndexing: "unknown",
    embedding: "revoked",
    training: "expired",
    providerInput: "denied",
    publication: "allowed",
    reuse: "unknown",
  });
});

test("proveniência é obrigatória e sourceRef rejeita paths absolutos", () => {
  assert.throws(
    () => createKnowledgeRecordEnvelope(base({ provenance: [] })),
    /provenance exige ao menos uma origem/,
  );

  const forbidden = [
    String.raw`C:\private\reference.mp4`,
    "/private/reference.mp4",
    String.raw`\\server\share\reference.mp4`,
    "file:///private/reference.mp4",
    String.raw`asset:C:\private\reference.mp4`,
  ];
  for (const sourceRef of forbidden) {
    assert.throws(
      () => createKnowledgeRecordEnvelope(base({
        provenance: [{ ...base().provenance[0], sourceRef }],
      })),
      /sourceRef não pode conter caminho absoluto/,
    );
  }
});

test("segredos, credenciais e actor divergente falham sem ecoar material", () => {
  const secret = "sk-proj-super-secret-value";
  assert.throws(
    () => createKnowledgeRecordEnvelope({ ...base(), apiKey: secret }),
    (error) => /sensível proibido/.test(error.message) && !error.message.includes(secret),
  );
  assert.throws(
    () => createKnowledgeRecordEnvelope(base({
      provenance: [{
        ...base().provenance[0],
        sourceRef: "url:https://user:password@example.test/reference",
      }],
    })),
    (error) => /sensível proibido/.test(error.message) && !error.message.includes("password"),
  );
  assert.throws(
    () => createKnowledgeRecordEnvelope(base(), { expectedActor: "other-actor" }),
    /createdBy diverge do actor esperado/,
  );
});

test("registry autodescobre schema e verificador detecta adulteração", () => {
  assert.equal(
    listKnowledgeSchemas().some(({ id }) => id === KNOWLEDGE_RECORD_ENVELOPE_SCHEMA),
    true,
  );
  const envelope = createKnowledgeRecordEnvelope(base());
  const tampered = structuredClone(envelope);
  tampered.rights.training = "allowed";
  assert.throws(
    () => assertKnowledgeRecordEnvelope(tampered),
    /hash inválido/,
  );
  const withExtra = { ...envelope, tokenHint: "not-a-secret-value" };
  assert.equal(validateKnowledgeContract(withExtra).valid, false);
});
