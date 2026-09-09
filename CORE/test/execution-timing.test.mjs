import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExecutionTiming, measureExecutionPhase, currentExecutionTiming, assertExecutionTiming, summarizeExecutionTimings } from "../lib/media-pipeline/execution-timing.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { withResourceLease } from "../lib/media-pipeline/resource-lease.mjs";
import { runCommand } from "../lib/media-pipeline/media-tools.mjs";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import { materializeExecutionSnapshot, replayExecutionJournal } from "../lib/media-pipeline/execution-journal.mjs";
import { createStageReceipt, writeStageReceipt, writeFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { listFilmJobs, buildUsageCostReport } from "../lib/media-pipeline/operational-reports.mjs";
import { recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const node = (id, measurement) => ({ id, executionTiming: { attemptId: `attempt:${id}`, outcome: "completed", measurement } });

test("intervalos aninhados usam união; espera e fases ausentes não viram geração remota", async () => {
  let time = 0;
  const timing = createExecutionTiming({ clock: () => time, now: () => new Date(1000 + time) });
  await timing.run(() => measureExecutionPhase("publication", async () => {
    time = 2;
    await measureExecutionPhase("publication", async () => { time = 5; });
    time = 10;
  }));
  const result = assertExecutionTiming(timing.snapshot());
  assert.equal(result.phaseMs.publication, 10);
  assert.equal(result.phaseMs.submission, null);
  assert.equal(result.remoteProcessingMs, null);
  assert.equal(result.intervals.length, 2);
  const wrong = structuredClone(result);
  wrong.phaseMs.publication = 13;
  assert.throws(() => assertExecutionTiming(wrong), /diverge/);
  wrong.phaseMs.publication = 10;
  wrong.intervals[0].prompt = "synthetic-private-text";
  assert.throws(() => assertExecutionTiming(wrong), /Intervalo/);
  const report = summarizeExecutionTimings([node("a", result), node("b", result), { id: "legado" }]);
  assert.equal(report.overlap.pairs[0].overlapMs, 10);
  assert.deepEqual(report.unknownNodes, ["legado"]);
  const wait = structuredClone(result);
  wait.intervals = wait.intervals.map((interval) => ({ ...interval, phase: "pending-wait" }));
  wait.phaseMs.publication = null; wait.phaseMs["pending-wait"] = 10;
  assert.deepEqual(summarizeExecutionTimings([node("a", wait), node("b", wait)]).overlap.pairs, []);
});

test("contextos concorrentes não misturam fases e falhas propagam a mesma instância sem texto privado", async () => {
  const first = createExecutionTiming(), second = createExecutionTiming();
  const entered = deferred(), release = deferred();
  const a = first.run(() => measureExecutionPhase("download", async () => { entered.resolve(); await release.promise; return "a"; }));
  await entered.promise;
  const b = await second.run(() => measureExecutionPhase("submission", async () => "b"));
  release.resolve();
  assert.equal(await a, "a"); assert.equal(b, "b");
  assert.equal(first.snapshot().phaseMs.submission, null);
  assert.equal(second.snapshot().phaseMs.download, null);
  assert.equal(currentExecutionTiming(), null);
  const failure = new Error("cookie=synthetic-secret; prompt privado; C:\\private\\asset.mp4");
  await assert.rejects(first.run(() => measureExecutionPhase("polling", async () => { throw failure; })), (error) => error === failure);
  assert.equal(first.snapshot().intervals.at(-1).outcome, "error");
  assert.doesNotMatch(JSON.stringify(first.snapshot()), /synthetic-secret|privado|private/);
});

test("limite de instrumentação não limita operações e omissões ficam explícitas", async () => {
  const timing = createExecutionTiming(); let calls = 0;
  await timing.run(async () => { for (let index = 0; index < 10002; index++) await measureExecutionPhase("verification", async () => { calls++; }); });
  const measured = assertExecutionTiming(timing.snapshot());
  assert.equal(calls, 10002);
  assert.equal(measured.intervals.length, 10000);
  assert.equal(measured.omittedIntervals, 2);
});

test("capacidade espera uma liberação real antes do subprocesso e não persiste IDs ou argumentos", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "timing-capacity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite"), capacities: { "cpu:ffmpeg": 1 } });
  const held = broker.tryAcquire({ productionId: "held", clientId: "private-client", resources: ["cpu:ffmpeg"] });
  const entered = deferred(); let executed = false;
  const timing = createExecutionTiming();
  const pending = timing.run(() => withResourceLease({ broker, resources: ["cpu:ffmpeg"], productionId: "new", clientId: "private-client", capacityWaitMs: 60_000, pollMs: 5, maxPollMs: 5, onQueued: () => entered.resolve() }, async () => {
    executed = true;
    return runCommand(process.execPath, ["-e", "process.stdout.write('synthetic-private-output')"]);
  }));
  await entered.promise; assert.equal(executed, false);
  broker.release(held.lease.leaseId);
  assert.equal((await pending).stdout, "synthetic-private-output");
  const measurement = assertExecutionTiming(timing.snapshot());
  assert.ok(measurement.phaseMs["capacity-wait"] > 0);
  assert.ok(measurement.phaseMs["local-process"] > 0);
  assert.equal(measurement.phaseMs.admission, null);
  assert.doesNotMatch(JSON.stringify(measurement), /private-client|synthetic-private-output|process.stdout/);
});

test("kernel persiste medições, recibo declara cobertura parcial e consultas não refazem trabalho", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "timing-kernel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbFile = path.join(root, "production", "metadados", "execution-journal.sqlite");
  await mkdir(path.dirname(dbFile), { recursive: true });
  const plan = compileFilmSpec({ name: "timing", scenes: [{ id: "a", prompt: "Cena", duration: 1 }], qa: false });
  const kernel = createExecutionKernel({ dbFile, plan });
  let calls = 0;
  const operation = async () => {
    calls++;
    await runCommand(process.execPath, ["-e", "process.stdout.write('ok')"]);
    const file = path.join(root, "production", "result.json"), receiptFile = `${file}.receipt.json`;
    await writeFileAtomic(file, "{}");
    const receipt = createStageReceipt({ operation: "local-test", provider: "test", stage: "alignment" });
    await writeStageReceipt(receiptFile, receipt);
    return { file, receiptFile, receipt };
  };
  const result = await kernel.executeLocalNode({ nodeId: "alignment", execute: operation });
  const saved = materializeExecutionSnapshot({ dbFile, readOnly: true });
  const measurement = saved.nodes.alignment.executionTiming.measurement;
  assert.ok(measurement.phaseMs["local-process"] > 0);
  assert.ok(measurement.phaseMs.publication != null);
  assert.equal(measurement.openIntervals, 0);
  const receipt = JSON.parse(await readFile(result.receiptFile, "utf8"));
  assert.equal(receipt.metadata.executionTiming.coverage, "until-receipt-construction");
  assert.ok(receipt.metadata.executionTiming.measurement.openIntervals > 0);
  const withoutTiming = structuredClone(receipt);
  delete withoutTiming.metadata.executionTiming;
  assert.equal(recipeFromReceipt(receipt).hash, recipeFromReceipt(withoutTiming).hash);
  const replay = replayExecutionJournal({ dbFile });
  const jobs = await listFilmJobs({ root });
  assert.deepEqual(jobs.jobs[0].journal.executionTiming.records[0].phaseMs, measurement.phaseMs);
  const usage = await buildUsageCostReport({ root });
  assert.equal(usage.records[0].executionTiming.coverage, "until-receipt-construction");
  assert.deepEqual(replayExecutionJournal({ dbFile }), replay);
  const reused = await kernel.executeLocalNode({ nodeId: "alignment", execute: operation });
  assert.equal(reused.execution.reused, true); assert.equal(calls, 1);
  assert.deepEqual(materializeExecutionSnapshot({ dbFile, readOnly: true }).nodes.alignment.executionTiming.measurement, measurement);
  const failure = new Error("synthetic-private-error");
  await assert.rejects(kernel.executeLocalNode({ nodeId: "timeline-lock", execute: async () => { throw failure; } }), (error) => error === failure);
  const failed = materializeExecutionSnapshot({ dbFile, readOnly: true }).nodes["timeline-lock"].executionTiming;
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.measurement.intervals.at(-1).outcome, "error");
  assert.doesNotMatch(JSON.stringify(failed), /synthetic-private-error/);
});
