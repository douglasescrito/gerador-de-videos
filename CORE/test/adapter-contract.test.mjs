import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTER_CONTRACT_SCHEMA,
  assertAdapterContract,
  buildAdapterInvocation,
  createAdapterContract,
  executeAdapterInvocation,
  normalizeAdapterResult,
  reconcileAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { createHybridCompositorAdapter } from "../lib/media-pipeline/hybrid-compositor.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

function registry({ status = "supported", providerId = "local-renderer", auth = [] } = {}) {
  return { providers: [{ id: providerId, operations: ["render"], auth, status, deliveryDependencyAllowed: true, health: { status: "ready", checkedAt: "2026-07-27T00:00:00.000Z" } }] };
}

function localAdapter({ paid = false, providerId = "local-renderer", onExecute = null } = {}) {
  const adapter = {
    schema: ADAPTER_CONTRACT_SCHEMA,
    id: "local-renderer-adapter",
    providerId,
    kind: "video",
    operations: ["render"],
    authMode: "none",
    authContract: "local-no-auth",
    paidOperations: paid ? ["render"] : [],
    reconcileOperations: ["render"],
    resultKinds: ["video"],
    estimate: async () => ({ calls: 0, paid: false }),
    execute: async (input) => {
      onExecute?.(input);
      return { status: "ready", artifacts: [{ id: "sha256:local-output" }], receiptId: "receipt:sha256:local-receipt" };
    },
    reconcile: async () => ({ status: "ready", artifacts: [{ id: "sha256:reconciled-output" }], receiptId: "receipt:sha256:reconciled-receipt" }),
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}

test("contrato e conformance de adapter local são provider-free", async () => {
  const adapter = localAdapter();
  assert.equal(assertAdapterContract(adapter), true);
  const report = await runAdapterConformanceSuite({ adapter, capabilityRegistry: registry(), operation: "render", request: { scene: "card" }, now: new Date("2026-07-27T12:00:00.000Z") });
  assert.equal(report.providerFree, true);
  assert.equal(report.passed, true);
  assert.equal(report.checks.every((entry) => entry.passed), true);
});

test("compositor FFmpeg existente é projetado como adapter local não pago", async () => {
  const adapter = createHybridCompositorAdapter();
  const capabilityRegistry = await probeProviderRegistry({ probes: {} });
  assert.equal(adapter.providerId, "ffmpeg-local");
  const report = await runAdapterConformanceSuite({ adapter, capabilityRegistry, operation: "hybrid-compose" });
  assert.equal(report.passed, true);
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry, operation: "hybrid-compose", request: { manifestFingerprint: "manifest:test" } });
  assert.equal(invocation.paid, false);
  assert.equal(invocation.preflight.status, "ready");
});

test("capability pending bloqueia antes de executar o adapter", async () => {
  let executions = 0;
  const adapter = localAdapter({ onExecute: () => { executions += 1; } });
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry: registry({ status: "pending" }), operation: "render" });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(executeAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(executions, 0);
});

test("operação paga exige autorização JIT e só então chama execute", async () => {
  let executions = 0;
  const adapter = localAdapter({ paid: true, providerId: "paid-renderer", onExecute: () => { executions += 1; } });
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry: registry({ providerId: "paid-renderer", auth: [] }), operation: "render" });
  assert.equal(invocation.paid, true);
  assert.equal(invocation.preflight.status, "ready");
  await assert.rejects(executeAdapterInvocation({ adapter, invocation, authorization: { id: "auth" } }), /callback de autorização JIT/);
  assert.equal(executions, 0);
  const result = await executeAdapterInvocation({ adapter, invocation, authorization: { id: "auth" }, authorize: async () => {} });
  assert.equal(result.status, "ready");
  assert.equal(executions, 1);
});

test("reconcile usa somente reconcile e normaliza receipt sem caminho de geração", async () => {
  let executions = 0;
  const adapter = localAdapter({ onExecute: () => { executions += 1; } });
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry: registry(), operation: "render" });
  const result = await reconcileAdapterInvocation({ adapter, invocation, request: { handle: "remote:1" } });
  assert.equal(result.reconcile, true);
  assert.equal(result.status, "ready");
  assert.equal(executions, 0);
});

test("normalização exige receipt para ready e não permite status arbitrário", () => {
  assert.throws(() => normalizeAdapterResult({ status: "ready", artifacts: [] }, { adapterId: "local", operation: "render" }), /receiptId/);
  assert.throws(() => normalizeAdapterResult({ status: "retry" }, { adapterId: "local", operation: "render" }), /Status de adapter inválido/);
});
