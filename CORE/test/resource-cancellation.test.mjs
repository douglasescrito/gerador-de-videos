import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { withResourceLease } from "../lib/media-pipeline/resource-lease.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const broker = createResourceBroker({ dbFile: path.join(root, "runtime.sqlite"), capacities: { "provider:omni": 1, "browser:omni": 1 } });
  return { broker, snapshot: () => buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker,
    options: { broker, productionId: "cancel-test", resources: ["provider:omni", "browser:omni"] } };
}

test("cancelamento anterior à admissão não consulta nem ocupa recursos", async (t) => {
  const { options, snapshot } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withResourceLease({ ...options, signal: controller.signal,
    admission: () => assert.fail("não deve consultar admissão") }, () => assert.fail("não deve executar")), (error) => error.name === "AbortError" && error.postStarted === false);
  assert.equal(snapshot().activeLeases, 0);
  assert.equal(snapshot().queued, 0);
});

test("cancelamento acorda backoff longo e remove apenas o pedido da fila", { timeout: 10_000 }, async (t) => {
  const { broker, options, snapshot } = await fixture(t);
  const holder = broker.tryAcquire({ requestId: "holder", productionId: "holder", clientId: "local", resources: options.resources });
  const controller = new AbortController();
  await assert.rejects(withResourceLease({ ...options, requestId: "cancelled", signal: controller.signal,
    capacityWaitMs: 60_000, pollMs: 30_000, maxPollMs: 30_000, onQueued: () => setImmediate(() => controller.abort()) },
  () => assert.fail("cancelado não deve executar")), /cancelada antes do efeito/);
  assert.equal(snapshot().queued, 0);
  assert.equal(snapshot().activeLeases, 1, "lease do outro produtor deve permanecer");
  broker.release(holder.lease.leaseId);
  assert.equal(snapshot().activeLeases, 0);
});

test("cancelamento entre concessão e execução devolve o lease sem efeito", async (t) => {
  const { broker, options, snapshot } = await fixture(t);
  const controller = new AbortController();
  const boundaryBroker = { ...broker, async acquire(...args) {
    const result = await broker.acquire(...args);
    controller.abort();
    return result;
  } };
  await assert.rejects(withResourceLease({ ...options, broker: boundaryBroker, signal: controller.signal },
    () => assert.fail("nenhum efeito depois do cancelamento")), (error) => error.postStarted === false);
  assert.equal(snapshot().activeLeases, 0);
  assert.equal(snapshot().queued, 0);
});

test("cancelamento durante revalidação da admissão não atravessa o efeito", async (t) => {
  const { options, snapshot } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(withResourceLease({ ...options, signal: controller.signal, revalidateAfterMs: 0,
    admission: async ({ phase }) => { if (phase === "after-queue") controller.abort(); return { status: "ready" }; } },
  () => assert.fail("cancelamento deve ser relido depois do await")), /cancelada antes do efeito/);
  assert.equal(snapshot().activeLeases, 0);
});

test("cancelamento durante o efeito propaga o sinal e preserva reserva remota aceita", async (t) => {
  const { broker, options, snapshot } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(withResourceLease({ ...options, signal: controller.signal }, async ({ leaseId, signal }) => {
    broker.detachRemoteLease({ leaseId, operationId: "accepted", attemptId: "original" });
    broker.bindRemoteHandle({ operationId: "accepted", attemptId: "original", handle: { fileId: "remote-file" } });
    const aborted = once(signal, "abort");
    controller.abort(new Error("pedido de interrupção"));
    await aborted;
    throw new Error("coleta interrompida; tentativa precisa de reconciliação");
  }), /tentativa precisa de reconciliação/);
  assert.equal(snapshot().activeLeases, 0);
  assert.equal(snapshot().remoteInFlight, 1);
  assert.equal(broker.readRemoteOperation("accepted").handle.fileId, "remote-file");
});
