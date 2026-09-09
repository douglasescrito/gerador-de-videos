import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assertExecutionAuthorization,
  assertExecutionAuthorizationRuntime,
  createNoProviderInputRightsDecision,
  issueExecutionAuthorization,
  projectExecutionAuthorization,
  validateExecutionAuthorizationProjection,
} from "../lib/media-pipeline/execution-authorization.mjs";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function plan() {
  return compileFilmSpec({
    name: "execution-authorization",
    scenes: [
      {
        id: "scene-a",
        prompt: "Um quadro abstrato.",
        motionPrompt: "Movimento suave.",
        duration: 2,
        generationTask: "image_to_video",
      },
    ],
    qa: false,
    budget: {
      image: 1,
      tts: 0,
      music: 0,
      omni: 1,
      semanticQa: 0,
    },
  });
}

function issueKeyframe(overrides = {}) {
  const executionPlan = overrides.plan ?? plan();
  const rightsDecision =
    overrides.rightsDecision
    ?? createNoProviderInputRightsDecision({
      plan: executionPlan,
      nodeId: "keyframe:scene-a",
      headSequence: 7,
    });
  return {
    plan: executionPlan,
    rightsDecision,
    authorization: issueExecutionAuthorization({
      plan: executionPlan,
      nodeId: "keyframe:scene-a",
      rightsDecision,
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      source: "cli",
      actor: "human:test",
      now: NOW,
      nonce: "nonce-test-001",
      ...overrides.issue,
    }),
  };
}

test("emite autorização imutável presa ao plano, nó, capability, rights e hard limit", () => {
  const { plan: executionPlan, rightsDecision, authorization } =
    issueKeyframe();
  assert.equal(
    authorization.schema,
    "mkt-videos/execution-authorization@1",
  );
  assert.equal(authorization.planFingerprint, executionPlan.fingerprint);
  assert.equal(authorization.nodeId, "keyframe:scene-a");
  assert.equal(authorization.provider, "gemini-image");
  assert.equal(authorization.operation, "image-generate");
  assert.equal(authorization.rightsDecisionHash, rightsDecision.decisionHash);
  assert.equal(authorization.rightsHeadSequence, 7);
  assert.deepEqual(authorization.estimatedCostOrQuota, {
    unit: "session-quota-call",
    amount: 1,
    provider: "gemini-image",
    operation: "image-generate",
  });
  assert.deepEqual(authorization.hardLimit, {
    unit: "session-quota-call",
    budgetKey: "image",
    amount: 1,
  });
  assert.equal(authorization.authenticationMode, "cookie-only-browser-session");
  assert.equal(authorization.explicitConfirmation.confirmed, true);
  assert.equal(Object.isFrozen(authorization), true);
  assert.equal(Object.isFrozen(authorization.hardLimit), true);
  assert.doesNotThrow(() =>
    assertExecutionAuthorizationRuntime(authorization, {
      plan: executionPlan,
      nodeId: "keyframe:scene-a",
      rightsDecision,
      now: new Date("2026-07-25T12:01:00.000Z"),
    }));
});

test("projeções emitidas satisfazem os JSON Schemas fechados", async () => {
  const { rightsDecision, authorization } = issueKeyframe();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemasDirectory = path.resolve("schemas");
  const [authorizationSchema, rightsSchema] = await Promise.all([
    readFile(
      path.join(schemasDirectory, "execution-authorization.schema.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(schemasDirectory, "execution-rights-decision.schema.json"),
      "utf8",
    ).then(JSON.parse),
  ]);
  const validateAuthorization = ajv.compile(authorizationSchema);
  const validateRights = ajv.compile(rightsSchema);
  assert.equal(
    validateAuthorization(projectExecutionAuthorization(authorization)),
    true,
    JSON.stringify(validateAuthorization.errors),
  );
  assert.equal(
    validateRights(rightsDecision),
    true,
    JSON.stringify(validateRights.errors),
  );
});

test("clone serial mantém projeção auditável, mas não adquire autoridade de execução", () => {
  const { authorization } = issueKeyframe();
  const projection = projectExecutionAuthorization(authorization);
  assert.equal(validateExecutionAuthorizationProjection(projection), true);
  assert.throws(
    () => assertExecutionAuthorization(projection),
    /não foi emitida pelo Execution Kernel/,
  );
});

test("adulteração de nó, capability, rights, orçamento ou confirmação quebra o hash", () => {
  const { authorization } = issueKeyframe();
  for (const mutate of [
    (value) => { value.nodeId = "keyframe:other"; },
    (value) => { value.capabilitySnapshotHash = "0".repeat(64); },
    (value) => { value.rightsDecisionHash = "1".repeat(64); },
    (value) => { value.hardLimit.amount = 2; },
    (value) => { value.explicitConfirmation.confirmed = false; },
  ]) {
    const copy = structuredClone(authorization);
    mutate(copy);
    assert.throws(
      () => validateExecutionAuthorizationProjection(copy),
      /diverge|confirmação|hash|outro nó/i,
    );
  }
});

test("autorização expirada falha antes de qualquer execução", () => {
  const { plan: executionPlan, rightsDecision, authorization } =
    issueKeyframe({
      issue: { ttlMs: 1_000 },
    });
  assert.throws(
    () =>
      assertExecutionAuthorizationRuntime(authorization, {
        plan: executionPlan,
        nodeId: "keyframe:scene-a",
        rightsDecision,
        now: new Date("2026-07-25T12:00:01.000Z"),
      }),
    /expirada/,
  );
});

test("mudança de head de rights invalida a autorização vigente", () => {
  const { plan: executionPlan, rightsDecision, authorization } =
    issueKeyframe();
  const { decisionHash: _oldHash, ...changedBody } =
    structuredClone(rightsDecision);
  changedBody.headSequence += 1;
  const changedRights = {
    ...changedBody,
    decisionHash: operationFingerprint(changedBody),
  };
  assert.throws(
    () =>
      assertExecutionAuthorizationRuntime(authorization, {
        plan: executionPlan,
        nodeId: "keyframe:scene-a",
        rightsDecision: changedRights,
        now: new Date("2026-07-25T12:01:00.000Z"),
      }),
    /Head de rights mudou/,
  );
});

test("nó de vídeo não aceita decisão vazia: exige artifact governado da mesma execução", () => {
  const executionPlan = plan();
  assert.throws(
    () =>
      createNoProviderInputRightsDecision({
        plan: executionPlan,
        nodeId: "video:scene-a",
      }),
    /exige artifact audiovisual/,
  );
});

test("capability do plano adulterada não pode emitir autorização", () => {
  const executionPlan = plan();
  executionPlan.governance.capabilities[0].evidence = "tampered";
  const rightsDecision = createNoProviderInputRightsDecision({
    plan: executionPlan,
    nodeId: "keyframe:scene-a",
  });
  assert.throws(
    () =>
      issueExecutionAuthorization({
        plan: executionPlan,
        nodeId: "keyframe:scene-a",
        rightsDecision,
        confirmFingerprint: executionPlan.governance.approval.fingerprint,
        now: NOW,
      }),
    /Capability atual diverge/,
  );
});

// Não há mais confirmação de gasto, mas o fingerprint continua obrigatório: ele
// prende a autorização a um plano específico, e é isso que impede uma
// autorização emitida para um plano valer para outro.
test("fingerprint continua obrigatório na emissão", () => {
  const executionPlan = plan();
  const rightsDecision = createNoProviderInputRightsDecision({
    plan: executionPlan,
    nodeId: "keyframe:scene-a",
  });
  assert.throws(
    () =>
      issueExecutionAuthorization({
        plan: executionPlan,
        nodeId: "keyframe:scene-a",
        rightsDecision,
        confirmFingerprint: "0".repeat(64),
        now: NOW,
      }),
    /fingerprint/,
  );
});

test("autorização paga nova rejeita actor legado ou automação em gate humano", () => {
  const executionPlan = compileFilmSpec({
    name: "human-gate",
    scenes: [{ id: "scene-a", prompt: "Quadro abstrato.", motionPrompt: "Movimento.", duration: 2, generationTask: "text_to_video" }],
    workflow: { authorizationMode: "per-invocation", humanReview: true, completionMode: "pause-for-review" },
    qa: false,
    budget: { image: 0, tts: 0, music: 0, omni: 1, semanticQa: 0 },
  });
  const rights = (actorKind) => createNoProviderInputRightsDecision({
    plan: executionPlan,
    nodeId: "video:scene-a",
    approvals: [{ nodeId: "animatic-approval", approvalHash: "a".repeat(64), actor: "migration", actorKind, source: "legacy", approvedAt: NOW.toISOString(), createdSequence: 1 }],
    headSequence: 1,
  });
  for (const actorKind of ["legacy-unknown", "automation"]) {
    assert.throws(() => issueExecutionAuthorization({
      plan: executionPlan,
      nodeId: "video:scene-a",
      rightsDecision: rights(actorKind),
      confirmFingerprint: executionPlan.governance.approval.fingerprint,
      now: NOW,
    }), /somente leitura|actorKind human/);
  }
});
