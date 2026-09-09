import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { createBatchJob, runBatchJob, prepareBatchItemAction, requestBatchCancellation, saveBatchJob } from "../lib/media-pipeline/omni-batch-runner.mjs";
import { createCliBatchPhases } from "../lib/media-pipeline/batch-dispatch.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "remote-batch-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, dbFile: path.join(root, "runtime.sqlite") };
}

test("reserva remota sobrevive ao dono, libera só por prova e cerca observador com fencing", async (t) => {
  const { dbFile } = await fixture(t);
  let current = new Date();
  const alive = new Set([11, 22]);
  const options = { dbFile, capacities: { "provider:omni": 1, "cpu:ffmpeg": 1 }, clock: () => current, isProcessAlive: (pid) => alive.has(pid) };
  const first = createResourceBroker({ ...options, owner: { pid: 11, nonce: "first" } });
  const second = createResourceBroker({ ...options, owner: { pid: 22, nonce: "second" } });
  const lease = first.tryAcquire({ requestId: "submit", productionId: "a", clientId: "client-a", resources: ["provider:omni"] }).lease;
  first.detachRemoteLease({ leaseId: lease.leaseId, operationId: "remote:a", attemptId: "attempt:a" });
  first.bindRemoteHandle({ operationId: "remote:a", attemptId: "attempt:a", handle: { fileId: "file-a" } });
  first.release(lease.leaseId);
  alive.delete(11);
  second.maintain();
  assert.equal(second.tryAcquire({ requestId: "queued", productionId: "b", clientId: "client-b", resources: ["provider:omni"] }).status, "queued");
  assert.equal(second.tryAcquire({ requestId: "local", productionId: "b", clientId: "client-b", resources: ["cpu:ffmpeg"] }).status, "acquired");
  const claimed = second.claimRemoteOperation({ operationId: "remote:a", claimMs: 100 });
  assert.equal(second.claimRemoteOperation({ operationId: "remote:a", claimMs: 100 }), null);
  current = new Date(current.getTime() + 101);
  const newer = second.claimRemoteOperation({ operationId: "remote:a", claimMs: 100 });
  assert.notEqual(newer.claimToken, claimed.claimToken);
  assert.throws(() => second.recordRemoteObservation({ operationId: "remote:a", claimToken: claimed.claimToken, observation: { fileId: "file-a", classification: "ready", zeroPost: true } }), /Claim remoto/);
  second.recordRemoteObservation({ operationId: "remote:a", claimToken: newer.claimToken, observation: { fileId: "file-a", classification: "remote_not_found", httpStatus: 404, zeroPost: true } });
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile }).broker.remoteInFlight, 1);
  second.recordRemoteObservation({ operationId: "remote:a", claimToken: newer.claimToken, observation: { fileId: "file-a", classification: "ready", state: "ACTIVE", httpStatus: 200, zeroPost: true } });
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile }).broker.remoteInFlight, 0);
  assert.equal(second.tryAcquire({ requestId: "queued", productionId: "b", clientId: "client-b", resources: ["provider:omni"] }).status, "acquired");
});

test("binário antigo iniciado após migração não adquire pela view nem perde reserva", async (t) => {
  const { dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 } });
  const lease = broker.tryAcquire({ productionId: "a", clientId: "a", resources: ["provider:omni"] }).lease;
  broker.detachRemoteLease({ leaseId: lease.leaseId, operationId: "op", attemptId: "attempt" });
  broker.release(lease.leaseId);
  const legacyUrl = new URL("./fixtures/resource-broker-protocol-v1.mjs", import.meta.url).href;
  const script = `import {createResourceBroker} from ${JSON.stringify(legacyUrl)};
    try { const b=createResourceBroker({dbFile:${JSON.stringify(dbFile)},capacities:{'provider:omni':1}});
      await b.acquire({productionId:'old',clientId:'old',resources:['provider:omni']},{timeoutMs:10});
      console.log('EFFECT_WOULD_START'); }
    catch(error) { console.error(error.message); process.exitCode=2; }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /view|cannot modify/i);
  assert.doesNotMatch(result.stdout, /EFFECT_WOULD_START/);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile }).broker.remoteInFlight, 1);
});

test("migração espera a saída natural de produtor antigo vivo", async (t) => {
  const { dbFile } = await fixture(t);
  const legacyUrl = new URL("./fixtures/resource-broker-protocol-v1.mjs", import.meta.url).href;
  const script = `import {createResourceBroker} from ${JSON.stringify(legacyUrl)};
    import {once} from 'node:events';
    const b=createResourceBroker({dbFile:${JSON.stringify(dbFile)}});
    b.tryAcquire({productionId:'old',clientId:'old',resources:['provider:omni']});
    console.log('READY'); process.stdin.resume(); await once(process.stdin,'end');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "test" } });
  t.after(() => { if (child.exitCode == null) child.stdin.end(); });
  await once(child.stdout, "data");
  assert.throws(() => createResourceBroker({ dbFile }), /produtor vivo/);
  child.stdin.end();
  await once(child, "close");
  assert.doesNotThrow(() => createResourceBroker({ dbFile }));
});

test("uma lane submete dois renders, devolve capacidade local e coleta sem novo POST", async (t) => {
  const { root, dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 2, "browser:omni": 1 } });
  let submissions = 0;
  let collections = 0;
  let observedTwoPending = false;
  let rounds = 0;
  const adapter = {
    async submit(options) {
      await options.onBeforeSubmit({ attemptId: options.attemptId });
      const handle = { fileId: `file-${++submissions}` };
      await options.onProviderHandle(handle);
      return { status: "pending", ...handle };
    },
    async observe() { throw new Error("observação agrupada esperada"); },
    async observeMany({ requests }) {
      rounds += 1;
      const report = buildRuntimeOperationsSnapshot({ dbFile });
      if (requests.length === 2) {
        observedTwoPending = true;
        assert.equal(report.broker.remoteInFlight, 2);
        assert.equal(report.broker.used["provider:omni"], 2);
      }
      return requests.map(({ fileId }) => ({ fileId, classification: rounds === 1 ? "provider_pending" : "ready", state: rounds === 1 ? "PROCESSING" : "ACTIVE", httpStatus: 200, zeroPost: true }));
    },
    async collect(options) { collections += 1; await writeFile(options.outputFile, "test-video"); return { file: options.outputFile }; },
  };
  const job = createBatchJob({ collection: "example", parallel: 1, items: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }] });
  const phases = await createCliBatchPhases({ videoAdapter: adapter, broker, pollIntervalMs: 1, timeoutMs: 30_000 });
  await runBatchJob({ job, stateDir: path.join(root, "batches"), phases, persist: async ({ name }) => ({ relPath: `${name}.mp4`, receiptId: `receipt:${name}` }) });
  assert.equal(observedTwoPending, true);
  assert.equal(submissions, 3);
  assert.equal(collections, 3);
  assert.equal(job.items.every((item) => item.state === "completed"), true);
  const snapshot = buildRuntimeOperationsSnapshot({ dbFile });
  assert.equal(snapshot.broker.activeLeases, 0);
  assert.equal(snapshot.broker.remoteInFlight, 0);
});

test("runner com adapter cookie retoma falha de persistência pela mesma geração", async (t) => {
  const { root, dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile });
  let submissions = 0;
  let collections = 0;
  const adapter = createCookieVideoAdapter({
    async submit(options) {
      assert.equal(options.outputFile, undefined);
      await options.onBeforeSubmit({ attemptId: options.attemptId });
      submissions += 1;
      const handle = { fileId: "durable-file", attemptId: options.attemptId };
      await options.onProviderHandle(handle);
      return handle;
    },
    async observeMany({ requests }) {
      return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true }));
    },
    async collect({ outputFile, fileId }) {
      collections += 1;
      await writeFile(outputFile, Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
      return { fileId, zeroPost: true };
    },
  });
  const phases = await createCliBatchPhases({ videoAdapter: adapter, broker, pollIntervalMs: 1 });
  const job = createBatchJob({ collection: "recovery", items: [{ prompt: "formas" }] });
  const stateDir = path.join(root, "batches");
  await runBatchJob({ job, stateDir, phases, persist: async () => { throw new Error("disco indisponível"); } });
  assert.equal(job.items[0].state, "local_persist_failed");
  assert.equal(job.items[0].recovery, "retry_persist_only");
  const attempt = job.items[0].attemptId;
  await runBatchJob({ job, stateDir, phases, persist: async () => ({ relPath: "video.mp4", receiptId: "receipt" }) });
  assert.equal(job.items[0].state, "completed");
  assert.equal(job.items[0].attemptId, attempt);
  assert.equal(submissions, 1);
  assert.equal(collections, 2);
});

for (const phase of ["queue", "before-post", "accepted"]) test(`cancelamento do lote em ${phase} preserva somente efeitos aceitos`, async (t) => {
  const { root, dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1, "browser:omni": 1 } });
  const job = createBatchJob({ collection: "cancel", parallel: 1, items: [{ prompt: "first" }, { prompt: "second" }] });
  let posts = 0; let collections = 0;
  const holder = phase === "queue" ? broker.tryAcquire({ requestId: "other", productionId: "other", clientId: "other", resources: ["provider:omni"] }).lease : null;
  const adapter = createCookieVideoAdapter({
    async submit(options) {
      if (phase === "before-post") requestBatchCancellation(job);
      await options.onBeforeSubmit({});
      posts++;
      await options.onProviderHandle({ fileId: "accepted", attemptId: options.attemptId });
      if (phase === "accepted") requestBatchCancellation(job);
      return { fileId: "accepted" };
    },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { collections++; await writeFile(options.outputFile, "accepted-video"); return { fileId: options.fileId, zeroPost: true }; },
  });
  const phases = await createCliBatchPhases({ videoAdapter: adapter, broker, pollIntervalMs: 1 });
  const stateDir = path.join(root, "batches");
  await runBatchJob({ job, stateDir, phases, persist: async () => ({ relPath: "accepted.mp4", receiptId: "test:receipt" }),
    onProgress: (_job, event) => { if (phase === "queue" && event.type === "attempt_started") requestBatchCancellation(job); } });
  assert.deepEqual(job.items.map((item) => item.state), phase === "accepted" ? ["completed", "cancelled"] : ["cancelled", "cancelled"]);
  assert.equal(posts, phase === "accepted" ? 1 : 0);
  assert.equal(collections, posts);
  const snapshot = buildRuntimeOperationsSnapshot({ dbFile }).broker;
  assert.equal(snapshot.queued, 0);
  assert.equal(snapshot.remoteInFlight, 0);
  assert.equal(snapshot.activeLeases, holder ? 1 : 0);
  if (holder) broker.release(holder.leaseId);
  await runBatchJob({ job, stateDir, phases, persist: async () => assert.fail("cancelamento não abre outra entrega") });
  assert.equal(posts, phase === "accepted" ? 1 : 0);
});

test("ausência comprovada de POST permite retomar a mesma tentativa e reserva", async (t) => {
  const { root, dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile });
  let calls = 0;
  const adapter = {
    async submit(options) {
      await options.onBeforeSubmit({ attemptId: options.attemptId });
      if (++calls === 1) throw Object.assign(new Error("falha local anterior ao POST"), { postStarted: false });
      const handle = { fileId: "first-post" };
      await options.onProviderHandle(handle);
      return handle;
    },
    async observe({ fileId }) { return { fileId, classification: "ready", zeroPost: true }; },
    async collect({ outputFile }) { await writeFile(outputFile, "video"); return { file: outputFile }; },
  };
  const phases = await createCliBatchPhases({ videoAdapter: adapter, broker, pollIntervalMs: 1 });
  const job = createBatchJob({ collection: "pre-post", items: [{ prompt: "formas" }] });
  const options = { job, stateDir: path.join(root, "batches"), phases, persist: async () => ({ relPath: "video.mp4" }) };
  await runBatchJob(options);
  const attempt = job.items[0].attemptId;
  assert.equal(job.items[0].state, "pre_submit_failed");
  assert.equal(broker.readRemoteOperation(`omni:${attempt}`).state, "not_submitted");
  prepareBatchItemAction(job, job.items[0].id, "resume-pre-submit");
  await runBatchJob(options);
  assert.equal(job.items[0].state, "completed");
  assert.equal(job.items[0].attemptId, attempt);
  assert.equal(job.items[0].attemptNumber, 1);
  assert.equal(calls, 2);
});

test("estado lido antes de outra conclusão é recusado sem sobrescrever nem reenviar", async (t) => {
  const { root } = await fixture(t);
  const job = createBatchJob({ collection: "stale", items: [{ prompt: "formas" }] });
  const newer = structuredClone(job);
  newer.events.push({ sequence: 2, type: "item_completed" });
  newer.items[0].state = "completed";
  const stateDir = path.join(root, "batches");
  saveBatchJob(stateDir, newer);
  await assert.rejects(runBatchJob({ job, stateDir, phases: {}, persist: async () => assert.fail("não persiste") }), /atualizado por outra execução/);
});

test("processos reais respeitam teto remoto mesmo depois da saída do submissor", async (t) => {
  const { root, dbFile } = await fixture(t);
  const moduleUrl = new URL("../lib/media-pipeline/resource-broker.mjs", import.meta.url).href;
  const scriptFile = path.join(root, "competing-process.mjs");
  await writeFile(scriptFile, `import { createResourceBroker } from ${JSON.stringify(moduleUrl)};
    const broker = createResourceBroker({ dbFile: process.argv[2], capacities: { 'provider:omni': 1, 'cpu:ffmpeg': 1 } });
    const id = process.argv[3];
    const acquired = broker.tryAcquire({ productionId: id, clientId: id, resources: ['provider:omni'] });
    if (acquired.status === 'acquired') {
      broker.detachRemoteLease({ leaseId: acquired.lease.leaseId, operationId: id, attemptId: id });
      broker.bindRemoteHandle({ operationId: id, attemptId: id, handle: { fileId: id } });
      broker.release(acquired.lease.leaseId);
    }
    console.log(JSON.stringify({ id, status: acquired.status }));`);
  const run = (id) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptFile, dbFile, id], { windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run("first"), run("second")]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ["acquired", "queued"]);
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1, "cpu:ffmpeg": 1 } });
  broker.maintain();
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile }).broker.remoteInFlight, 1);
  assert.equal(broker.tryAcquire({ productionId: "third", clientId: "third", resources: ["provider:omni"] }).status, "queued");
  assert.equal(broker.tryAcquire({ productionId: "local", clientId: "local", resources: ["cpu:ffmpeg"] }).status, "acquired");
});

test("sessão local ocupada adia coleta sem transformar espera em ambiguidade", async (t) => {
  const { root, dbFile } = await fixture(t);
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1, "browser:omni": 1 } });
  let posts = 0;
  let contested = false;
  let contestedLease = null;
  const adapter = {
    async submit(options) {
      await options.onBeforeSubmit({});
      posts += 1;
      const handle = { fileId: "capacity-file" };
      await options.onProviderHandle(handle);
      return handle;
    },
    async observe({ fileId }) { return { fileId, classification: "ready", zeroPost: true }; },
    async collect({ outputFile }) { await writeFile(outputFile, "video"); return { file: outputFile }; },
  };
  const phases = await createCliBatchPhases({ videoAdapter: adapter, broker, pollIntervalMs: 1, timeoutMs: 30_000 });
  const job = createBatchJob({ collection: "contention", items: [{ prompt: "formas" }] });
  await runBatchJob({ job, stateDir: path.join(root, "batches"), phases, persist: async () => ({ relPath: "video.mp4" }), onProgress: (_job, event) => {
    if (event?.type === "remote_phase_deferred" && contestedLease) {
      broker.release(contestedLease.leaseId);
      contestedLease = null;
    }
    if (event?.type !== "remote_observation_started" || contested) return;
    contested = true;
    contestedLease = broker.tryAcquire({ productionId: "other", clientId: "other", resources: ["browser:omni"] }).lease;
    assert.ok(contestedLease);
  } });
  assert.equal(contested, true);
  assert.equal(job.items[0].state, "completed");
  assert.equal(posts, 1);
  assert.equal(job.events.some((event) => event.type === "attempt_failed"), false);
});
