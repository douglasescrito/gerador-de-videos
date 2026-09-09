import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionExecutionBinding,
  assertProductionExecutionStateTransition,
  buildProductionExecutionBinding,
} from "../lib/media-pipeline/production-execution.mjs";

function baseInput(overrides = {}) {
  return {
    contextBindingHash: "a".repeat(64),
    planFingerprint: "b".repeat(64),
    executionId: "execution:pe-fixture",
    state: "planned",
    retryPolicy: { maxAttempts: 3, policy: "exponential" },
    inputAuthority: { mode: "ad-hoc" },
    ...overrides,
  };
}

test("binding ad-hoc constrói e revalida", () => {
  const binding = buildProductionExecutionBinding(baseInput());
  assert.equal(binding.schema, "mkt-videos/production-execution-binding@1");
  assert.deepEqual(binding.inputAuthority, { mode: "ad-hoc" });
  assertProductionExecutionBinding(binding);
});

test("binding production espelha os campos exatos da autorização, nunca o permit vivo", () => {
  const binding = buildProductionExecutionBinding(baseInput({
    inputAuthority: {
      mode: "production",
      productionId: "production:pe-fixture",
      inputs: [{
        sha256: "c".repeat(64),
        bytes: 204800,
        mimeType: "image/png",
        role: "first-frame",
        operation: "generate-video",
      }],
    },
  }));
  assertProductionExecutionBinding(binding);
  assert.equal(binding.inputAuthority.mode, "production");
  assert.equal(binding.inputAuthority.inputs[0].role, "first-frame");
});

test("inputAuthority ad-hoc não aceita campos extras", () => {
  assert.throws(
    () => buildProductionExecutionBinding(baseInput({
      inputAuthority: { mode: "ad-hoc", productionId: "production:vazamento" },
    })),
    /ad-hoc não aceita campos além de mode/,
  );
});

test("role e operation fora do vocabulário conhecido são rejeitados", () => {
  assert.throws(
    () => buildProductionExecutionBinding(baseInput({
      inputAuthority: {
        mode: "production",
        productionId: "production:pe-fixture",
        inputs: [{
          sha256: "c".repeat(64),
          bytes: 1024,
          mimeType: "image/png",
          role: "background-plate",
          operation: "generate-video",
        }],
      },
    })),
    /role inválido/,
  );
});

test("campo editado sem recalcular o hash diverge do binding canônico", () => {
  const binding = buildProductionExecutionBinding(baseInput());
  const tampered = { ...binding, state: "completed" };
  assert.throws(
    () => assertProductionExecutionBinding(tampered),
    /diverge do binding canônico/,
  );
});

test("transições de estado seguem planned -> executing -> completed|failed, cancelled a qualquer momento não-terminal", () => {
  assert.doesNotThrow(() => assertProductionExecutionStateTransition("planned", "executing"));
  assert.doesNotThrow(() => assertProductionExecutionStateTransition("planned", "cancelled"));
  assert.doesNotThrow(() => assertProductionExecutionStateTransition("executing", "completed"));
  assert.doesNotThrow(() => assertProductionExecutionStateTransition("executing", "failed"));
  assert.doesNotThrow(() => assertProductionExecutionStateTransition("executing", "cancelled"));
});

test("pular direto de planned para completed falha fechado, sem fallback", () => {
  assert.throws(
    () => assertProductionExecutionStateTransition("planned", "completed"),
    /Transição de execução inválida: planned -> completed/,
  );
});

test("estado terminal nunca reabre", () => {
  for (const terminal of ["completed", "failed", "cancelled"]) {
    assert.throws(
      () => assertProductionExecutionStateTransition(terminal, "executing"),
      /Transição de execução inválida/,
    );
  }
});
