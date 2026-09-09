import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionContextBinding,
  buildProductionContextBinding,
} from "../lib/media-pipeline/production-context.mjs";

test("binding mínimo (só rootScopeId) constrói e revalida", () => {
  const binding = buildProductionContextBinding({ rootScopeId: "client:pc-fixture" });
  assert.equal(binding.schema, "mkt-videos/production-context-binding@1");
  assert.equal(binding.projectId, null);
  assert.equal(binding.capabilitySnapshot, null);
  assertProductionContextBinding(binding);
});

test("binding completo com todas as referências revalida", () => {
  const binding = buildProductionContextBinding({
    rootScopeId: "client:pc-fixture",
    projectId: "project:pc-fixture",
    campaignId: "campaign:pc-fixture",
    productionId: "production:pc-fixture",
    deliverableId: "deliverable:pc-fixture",
    productionRequestRef: { requestId: `preq_${"0".repeat(32)}`, requestHash: "a".repeat(64) },
    briefHash: "b".repeat(64),
    recipeTemplateRef: { templateId: "template:pc-fixture", templateRevision: 3, templateHash: "c".repeat(64) },
    directorRef: {
      directorId: "director:pc-fixture",
      releaseId: "release:pc-fixture",
      releaseHash: "d".repeat(64),
      fingerprint: "e".repeat(64),
    },
    directorValidationRef: "validation:pc-fixture",
    decisionArtifactsHash: "f".repeat(64),
    motionBankRef: "motion-bank:pc-fixture",
    rightsEvidenceRefs: ["evidence:1", "evidence:2"],
    knowledgeContextBindingHash: "0".repeat(64),
    capabilitySnapshot: { capabilities: ["image", "video"], capturedAt: "2026-08-12T12:00:00.000Z" },
    executionPolicy: { maxAttempts: 3, retryPolicy: "exponential" },
  });
  assertProductionContextBinding(binding);
  assert.equal(binding.rightsEvidenceRefs.length, 2);
});

test("campo editado sem recalcular o hash diverge do binding canônico", () => {
  const binding = buildProductionContextBinding({ rootScopeId: "client:pc-fixture" });
  const tampered = { ...binding, rootScopeId: "client:outro-root" };
  assert.throws(
    () => assertProductionContextBinding(tampered),
    /diverge do binding canônico/,
  );
});

test("productionRequestRef exige requestId e requestHash válidos", () => {
  assert.throws(
    () => buildProductionContextBinding({
      rootScopeId: "client:pc-fixture",
      productionRequestRef: { requestId: "id-invalido", requestHash: "a".repeat(64) },
    }),
    /productionRequestRef\.requestId inválido/,
  );
});

test("capabilitySnapshot não aceita campos fora do contrato", () => {
  assert.throws(
    () => buildProductionContextBinding({
      rootScopeId: "client:pc-fixture",
      capabilitySnapshot: { capabilities: [], capturedAt: "2026-08-12T12:00:00.000Z", authority: "full" },
    }),
    /capabilitySnapshot possui campos não reconhecidos/,
  );
});
