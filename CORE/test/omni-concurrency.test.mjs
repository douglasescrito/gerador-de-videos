import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBatchJob, runBatchJob } from "../lib/media-pipeline/omni-batch-runner.mjs";
import {
  CONCURRENCY_PROFILES,
  createConcurrencyController,
  resolveConcurrencyProfile,
} from "../lib/media-pipeline/omni-concurrency.mjs";

const okPersist = async () => ({ relPath: "a/b.mp4", receiptId: "receipt:1" });

function temporaryDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "batch-concurrency-"));
  test.after?.(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("perfis nomeados substituem o número mágico; stress é só benchmark", () => {
  assert.equal(resolveConcurrencyProfile("conservative").max, 2);
  assert.equal(resolveConcurrencyProfile("balanced").start, 3);
  assert.equal(resolveConcurrencyProfile("fast").max, 4);
  assert.equal(resolveConcurrencyProfile("stress", { benchmark: true }).max, 8);
  assert.throws(() => resolveConcurrencyProfile("stress"), /benchmark/);
  assert.throws(() => resolveConcurrencyProfile("turbo"), /desconhecido/);
  assert.equal(Object.keys(CONCURRENCY_PROFILES).length, 4);
});

test("o controlador nunca deixa passar mais que a largura vigente", async () => {
  const controller = createConcurrencyController({ profile: "fast" });
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    const permit = await controller.acquire();
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    controller.release(permit, { outcome: "completed" });
  }));
  assert.ok(peak <= 4, `largura estourou: ${peak}`);
  const report = controller.report();
  assert.equal(report.items, 12);
  assert.equal(report.outcomes.completed, 12);
  assert.ok(report.latencyMs.mean >= 0);
});

test("recusa do provedor derruba a largura; sucesso com fila levanta", () => {
  const clock = { value: 0 };
  const controller = createConcurrencyController({ profile: "fast", clock: () => clock.value, minSamples: 3 });
  for (let index = 0; index < 4; index += 1) {
    controller.release({ startedAt: 0 }, { outcome: "provider_rejected" });
  }
  assert.ok(controller.limit < 4, "a largura deveria ter caído com o provedor recusando");
  const report = controller.report();
  assert.ok(report.providerRejectionRate > 0);
  assert.equal(report.adjustments.some((entry) => entry.direction === "down" && entry.reason === "provider_pushback"), true);
  assert.equal(report.policy.autoRetry, false);
});

test("a largura nunca ultrapassa o teto do perfil nem cai abaixo do piso", () => {
  const controller = createConcurrencyController({ profile: "conservative", minSamples: 1 });
  for (let index = 0; index < 10; index += 1) controller.release({ startedAt: 0 }, { outcome: "provider_rejected" });
  assert.equal(controller.limit, CONCURRENCY_PROFILES.conservative.min);
  for (let index = 0; index < 10; index += 1) controller.release({ startedAt: 0 }, { outcome: "completed" });
  assert.ok(controller.limit <= CONCURRENCY_PROFILES.conservative.max);
});

test("lote com controlador respeita a largura e mede utilização", async () => {
  const dir = temporaryDir();
  const job = createBatchJob({
    collection: "c",
    items: Array.from({ length: 6 }, (_, index) => ({ prompt: `p${index}` })),
    parallel: 8,
  });
  const controller = createConcurrencyController({ profile: "conservative" });
  let active = 0;
  let peak = 0;
  const summary = await runBatchJob({
    job,
    stateDir: dir,
    concurrency: controller,
    generate: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { buffer: Buffer.from("x"), fileId: "file:1" };
    },
    persist: okPersist,
  });
  assert.equal(summary.state, "completed");
  assert.ok(peak <= 2, `o controlador não conteve o lote: ${peak}`);
  assert.equal(summary.concurrency.profile, "conservative");
  assert.equal(summary.concurrency.items, 6);
  assert.ok(summary.concurrency.utilization > 0);
  assert.equal(job.events.some((event) => event.type === "batch_concurrency_measured"), true);
});

test("concorrência maior não habilita retry: item recusado continua parado", async () => {
  const dir = temporaryDir();
  const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }, { prompt: "b" }], parallel: 2 });
  const controller = createConcurrencyController({ profile: "fast" });
  let calls = 0;
  const summary = await runBatchJob({
    job,
    stateDir: dir,
    concurrency: controller,
    generate: async (item) => {
      calls += 1;
      if (item.id.endsWith("001")) {
        const error = new Error("provedor recusou");
        error.batchFailureKind = "provider_rejected";
        throw error;
      }
      return { buffer: Buffer.from("x"), fileId: "file:2" };
    },
    persist: okPersist,
  });
  // Duas chamadas para dois itens: nenhuma tentativa extra foi criada.
  assert.equal(calls, 2);
  assert.equal(summary.counts.provider_rejected, 1);
  assert.equal(job.items[0].recovery, "authorize_new_attempt");
  assert.equal(job.items[0].attemptNumber, 1);
});

test("sem controlador o comportamento do lote é exatamente o de antes", async () => {
  const dir = temporaryDir();
  const job = createBatchJob({ collection: "c", items: [{ prompt: "a" }, { prompt: "b" }], parallel: 2 });
  const summary = await runBatchJob({
    job,
    stateDir: dir,
    generate: async () => ({ buffer: Buffer.from("x"), fileId: "file:3" }),
    persist: okPersist,
  });
  assert.equal(summary.state, "completed");
  assert.equal(summary.concurrency, undefined);
  assert.equal(job.events.at(-1).type, "batch_settled");
});
