import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_POLICY_HASH,
  KNOWLEDGE_POLICY_ID,
  SCOPE_GRANT_SCHEMA,
  createScopeGrant,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  assertKnowledgeContract,
  listKnowledgeSchemas,
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

test("registry compila todos os schemas Knowledge em uma fonte única", () => {
  const schemas = listKnowledgeSchemas();
  assert.ok(schemas.length >= 11);
  assert.equal(new Set(schemas.map((entry) => entry.id)).size, schemas.length);
  for (const { id } of schemas) {
    const result = validateKnowledgeContract({ schema: id }, { schemaId: id });
    assert.equal(result.schemaId, id);
    assert.equal(result.errors.some(error => error.keyword === "unknownSchema"), false, id);
  }
});

test("ScopeGrant real satisfaz schema e carrega identidade da política", () => {
  const grant = createScopeGrant({
    rootScopeIds: ["client:a"],
    permissions: ["read"],
    actor: "schema-test",
    purpose: "validar contrato provider-free",
    issuedAt: "2026-07-23T18:00:00.000Z",
    expiresAt: "2026-07-23T19:00:00.000Z",
  });
  const validation = validateKnowledgeContract(grant);
  assert.equal(validation.valid, true);
  assert.equal(grant.schema, SCOPE_GRANT_SCHEMA);
  assert.equal(grant.policyId, KNOWLEDGE_POLICY_ID);
  assert.equal(grant.policyHash, KNOWLEDGE_POLICY_HASH);
});

test("registry falha fechado para schema desconhecido, campo extra e segredo", () => {
  const unknown = validateKnowledgeContract({
    schema: "mkt-videos/unknown@1",
  });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors[0].keyword, "unknownSchema");

  const invalid = {
    ...createScopeGrant({
      rootScopeIds: ["client:a"],
      permissions: ["read"],
      actor: "schema-test",
      purpose: "invalid extra field",
      issuedAt: "2026-07-23T18:00:00.000Z",
      expiresAt: "2026-07-23T19:00:00.000Z",
    }),
    forbiddenSecret: "never-echo-this-value",
  };
  const result = validateKnowledgeContract(invalid);
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.keyword === "additionalProperties"),
    true,
  );
  assert.throws(
    () => assertKnowledgeContract(invalid),
    (error) =>
      /additional properties/.test(error.message)
      && !error.message.includes("never-echo-this-value"),
  );
});

test("registro de asset usa o direito canônico reuse e rejeita derivativeUse legado", () => {
  const registration = {
    schema: "mkt-videos/knowledge-asset-link-registration@1",
    rootScopeId: "client:a",
    scopeId: "client:a",
    revision: 1,
    supersedesRevision: null,
    status: "candidate",
    rootKind: "outputs",
    relativePath: "campanha/master.mp4",
    expectedSha256: "a".repeat(64),
    expectedBytes: 1,
    mediaType: "video/mp4",
    governance: {
      classification: "confidential",
      provenance: [{
        sourceType: "human-declaration",
        sourceRef: "declaration:asset-a",
        method: "human-declaration",
        observedAt: "2026-07-24T12:00:00.000Z",
        contentHash: "b".repeat(64),
      }],
      modality: "fact",
      evidenceIds: [],
      retention: { policy: "manual-review" },
      rights: { inventory: "allowed", reuse: "allowed" },
    },
  };
  assert.equal(validateKnowledgeContract(registration).valid, true);

  const legacy = structuredClone(registration);
  delete legacy.governance.rights.reuse;
  legacy.governance.rights.derivativeUse = "allowed";
  const result = validateKnowledgeContract(legacy);
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.keyword === "additionalProperties"),
    true,
  );
});
