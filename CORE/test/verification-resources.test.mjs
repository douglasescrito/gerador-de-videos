import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { planTestResources, recommendVerificationCapacities, resourcePolicyFromEvidence, runWithTestResources } from "../scripts/verification-resources.mjs";

const execute = promisify(execFile);

test("capacidade maior exige a classe medida e memória livre; host menor conserva limites", () => {
  const measured = { logicalCpus: 32, totalMemoryBytes: 32 * 1024 ** 3, freeMemoryBytes: 18 * 1024 ** 3 };
  assert.deepEqual(recommendVerificationCapacities(measured), { concurrency: 8, heavy: 6, local: 2, reason: "measured-large-host-with-free-memory" });
  for (const patch of [{ logicalCpus: 16 }, { totalMemoryBytes: 16 * 1024 ** 3 }, { freeMemoryBytes: 15 * 1024 ** 3 },
    { logicalCpus: NaN }, { totalMemoryBytes: null }, { freeMemoryBytes: undefined }]) {
    assert.deepEqual(recommendVerificationCapacities({ ...measured, ...patch }), {
      concurrency: 4, heavy: 4, local: 2, reason: "conservative-host-or-memory",
    });
  }
});

test("classificação vincula evidência aos bytes testados; relatório antigo não classifica fonte nova", () => {
  const hash = createHash("sha256").update("tested").digest("hex");
  const changed = createHash("sha256").update("changed").digest("hex");
  const hashes = { "test/a.test.mjs": hash, "test/b.test.mjs": hash, "test/c.test.mjs": hash };
  const report = { status: "passed", sourceStable: true, selection: { scope: "full" },
    source: { testSourceHashes: hashes }, sourceAfter: { testSourceHashes: { ...hashes } },
    tests: { requestedFiles: 3, observedFiles: 3, summaries: Object.keys(hashes).map(file => ({ file, duration_ms: 10 })) },
    subprocessProfile: { groups: [{ owner: "b.test.mjs", command: "ffmpeg" }, { owner: "c.test.mjs", command: "node" }] } };
  const classify = (evidence = report, sourceHashes = hashes) => resourcePolicyFromEvidence({ report: evidence, sourceHashes });
  assert.deepEqual(Object.values(classify()).map(row => row.resource), ["local", "media", "process"]);
  const stale = classify(report, { ...hashes, "test/b.test.mjs": changed, "test/new.test.mjs": hash });
  assert.equal(stale["test/b.test.mjs"].resource, "exclusive");
  assert.equal(stale["test/b.test.mjs"].durationMs, 0);
  assert.equal(stale["test/new.test.mjs"].resource, "exclusive");
  const changedAfter = structuredClone(report);
  changedAfter.sourceAfter.testSourceHashes["test/a.test.mjs"] = changed;
  assert.equal(classify(changedAfter)["test/a.test.mjs"].resource, "exclusive");
  const missingSummary = structuredClone(report);
  missingSummary.tests.summaries.pop();
  assert.equal(classify(missingSummary)["test/c.test.mjs"].resource, "exclusive");
  for (const patch of [{ status: "partial-passed" }, { sourceStable: false }, { source: {} }, { sourceAfter: {} }, { subprocessProfile: null }]) {
    assert.throws(() => classify({ ...report, ...patch }), /hashes dos testes/);
  }
});

test("admissão respeita grupos pesados/locais e exclusivo, sem bloquear trabalho que cabe", async () => {
  const jobs = [
    { file: "heavy-a", resource: "media", expectedDurationMs: 30 },
    { file: "heavy-b", resource: "process", expectedDurationMs: 20 },
    { file: "exclusive", resource: "exclusive", expectedDurationMs: 15 },
    { file: "local-a", resource: "local", expectedDurationMs: 10 },
    { file: "local-b", resource: "local", expectedDurationMs: 5 },
    { file: "heavy-c", resource: "media", expectedDurationMs: 1 },
  ];
  let active = 0, heavy = 0, local = 0, maximum = 0;
  const started = [];
  const releases = new Map();
  let firstGroupReady;
  const ready = new Promise((resolve) => { firstGroupReady = resolve; });
  const run = runWithTestResources(jobs, {}, async (job) => {
    started.push(job.file);
    if (job.resource === "exclusive") assert.equal(active, 0);
    active++; maximum = Math.max(maximum, active);
    if (["media", "process"].includes(job.resource)) heavy++;
    if (job.resource === "local") local++;
    assert.ok(heavy <= 2 && local <= 2 && active <= 4);
    if (["heavy-a", "heavy-b", "local-a", "local-b"].includes(job.file)) {
      await new Promise((resolve) => { releases.set(job.file, resolve); if (releases.size === 4) firstGroupReady(); });
    }
    active--;
    if (["media", "process"].includes(job.resource)) heavy--;
    if (job.resource === "local") local--;
    return job.file;
  });
  await ready;
  assert.deepEqual(started, ["heavy-a", "heavy-b", "local-a", "local-b"]);
  releases.forEach((release) => release());
  const result = await run;
  assert.equal(maximum, 4);
  assert.deepEqual(result.results, jobs.map((job) => job.file));
  assert.ok(started.indexOf("exclusive") >= 4);
  assert.ok(result.admissions.every((row) => row.waitMs >= 0 && row.runMs >= 0));
});

test("falha não repete o job e aguarda os já admitidos antes de propagar", async () => {
  const calls = [];
  let finished = false;
  await assert.rejects(runWithTestResources([
    { file: "a", resource: "local", expectedDurationMs: 3 },
    { file: "b", resource: "local", expectedDurationMs: 2 },
    { file: "c", resource: "local", expectedDurationMs: 1 },
  ], { concurrency: 2 }, async ({ file }) => {
    calls.push(file);
    if (file === "a") throw new Error("stop");
    await new Promise((resolve) => setImmediate(resolve));
    finished = true;
  }), /stop/);
  assert.equal(finished, true);
  assert.deepEqual(calls, ["a", "b"]);
});

test("limite pesado configurável ocupa quatro vagas sem ultrapassar o teto global", async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const calls = [];
  let active = 0, maximum = 0, heavy = 0, maximumHeavy = 0;
  const jobs = Array.from({ length: 6 }, (_, i) => ({ file: String(i), resource: i < 5 ? "process" : "local", expectedDurationMs: 6 - i }));
  const execution = runWithTestResources(jobs, { concurrency: 4, heavy: 4, local: 2 }, async (job) => {
    calls.push(job.file);
    active++; maximum = Math.max(maximum, active);
    if (job.resource === "process") { heavy++; maximumHeavy = Math.max(maximumHeavy, heavy); }
    if (Number(job.file) < 4) await barrier;
    active--;
    if (job.resource === "process") heavy--;
    return job.file;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["0", "1", "2", "3"]);
  release();
  const result = await execution;
  assert.equal(maximum, 4);
  assert.equal(maximumHeavy, 4);
  assert.deepEqual(result.results, jobs.map((job) => job.file));
  assert.deepEqual(result.notStarted, []);
});

test("arquivo sem declaração ou com fonte alterada exige execução exclusiva", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "test-resource-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "test"));
  await writeFile(path.join(root, "test/a.test.mjs"), "original");
  const args = { root, files: ["test/a.test.mjs"] };
  assert.equal((await planTestResources(args))[0].resource, "exclusive");
  await writeFile(path.join(root, "test/verification-resource-policy.json"), JSON.stringify({ schema: "gerador-de-videos/verification-resources@1", files: {
    "test/a.test.mjs": { resource: "local", sourceHash: createHash("sha256").update("original").digest("hex"), durationMs: 50 },
  } }));
  assert.equal((await planTestResources(args))[0].resource, "local");
  await writeFile(path.join(root, "test/a.test.mjs"), "mudou");
  assert.equal((await planTestResources(args))[0].resource, "exclusive");
});

test("resultado falho encerra admissão, conserva a causa e aguarda o peer sem esconder pendentes", async () => {
  const jobs = ["first", "peer", "pending-a", "pending-b"].map((file, index) => ({ file, resource: "local", expectedDurationMs: 4 - index }));
  const calls = [];
  let releasePeer;
  let peerFinished = false;
  const peerBarrier = new Promise((resolve) => { releasePeer = resolve; });
  const pending = runWithTestResources(jobs, { concurrency: 2, stopOnResult: (row) => row.status === "failed" }, async ({ file }) => {
    calls.push(file);
    if (file === "first") return { file, status: "failed", diagnostic: "original failure" };
    await peerBarrier;
    peerFinished = true;
    return { file, status: "passed" };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["first", "peer"]);
  assert.equal(peerFinished, false);
  releasePeer();
  const result = await pending;
  assert.equal(peerFinished, true);
  assert.equal(result.stoppedBy, "first");
  assert.deepEqual(result.results, [{ file: "first", status: "failed", diagnostic: "original failure" }, { file: "peer", status: "passed" }]);
  assert.deepEqual(result.notStarted, ["pending-a", "pending-b"].map((file) => ({ file, reason: "stopped-after-failure" })));
  assert.deepEqual(result.admissions.map((row) => row.file), calls);
  const complete = await runWithTestResources(jobs, { concurrency: 1 }, async ({ file }) => ({ file, status: "failed" }));
  assert.equal(complete.results.length, 4, "coleta completa continua disponível sem predicado de parada");
  assert.deepEqual(complete.notStarted, []);
  assert.equal(complete.stoppedBy, null);
});

test("guarda intercepta ferramentas não declaradas, inclusive erro capturado pelo teste", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "test-resource-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "probe.test.mjs");
  const guard = new URL("./verification-resource-guard.mjs", import.meta.url).href;
  await writeFile(file, `import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync, execFile } from "node:child_process";
    test("caught violation", () => {
      assert.throws(() => spawnSync(process.execPath, ["-e", "process.exit(99)"]), /VERIFICATION_RESOURCE_UNDECLARED/);
      assert.throws(() => execFile(process.execPath, ["-e", "process.exit(99)"]), /VERIFICATION_RESOURCE_UNDECLARED/);
    });`);
  for (const resource of ["local", "media"]) {
    const audit = path.join(root, resource + ".jsonl");
    const environment = { ...process.env, MKT_VERIFICATION_RESOURCE_CLASS: resource, MKT_VERIFICATION_RESOURCE_AUDIT: audit };
    delete environment.NODE_TEST_CONTEXT;
    await execute(process.execPath, ["--import", guard, "--test", file], { cwd: root, env: environment, windowsHide: true });
    const rows = (await readFile(audit, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.command === "node" && row.resource === resource));
  }
});
