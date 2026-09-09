import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { runTestProcessGroup } from "./fixtures/test-process-group.mjs";

test("generate em dois processos sobrepõe espera remota e libera a sessão mantendo o teto global", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "generate-multiprocess-"));
  try {
    const worker = path.join(import.meta.dirname, "fixtures", "direct-video-worker.mjs");
    const processes = await runTestProcessGroup(["clip-a", "clip-b"].map(id => ({ id, args: [worker, root, id] })), { timeout: 50_000, env: { ...process.env, NODE_ENV: "test", MKT_VIDEOS_RUNTIME_DB: path.join(root, "runtime.sqlite") } });
    const failures = processes.filter(result => result.status === "rejected");
    if (failures.length) {
        const events = await Promise.all(["clip-a", "clip-b"].map(async (id) => readFile(path.join(root, `${id}.events.jsonl`), "utf8").catch(() => "sem eventos")));
        assert.fail(JSON.stringify({ errors: failures.map(result => ({ id: result.id, cancelledAfterPeerFailure: result.cancelledAfterPeerFailure, error: result.reason?.stderr || result.reason?.message })), events: events.map(value => value.trim().split(/\r?\n/).slice(-8)), runtime: buildRuntimeOperationsSnapshot({ dbFile: path.join(root, "runtime.sqlite") }).broker }));
    }
    const reports = await Promise.all(["clip-a", "clip-b"].map(async (id) => JSON.parse(await readFile(path.join(root, `${id}.report.json`), "utf8"))));
    assert.notEqual(reports[0].pid, reports[1].pid);
    assert.ok(reports[0].remoteStart < reports[1].remoteEnd && reports[1].remoteStart < reports[0].remoteEnd, "renders remotos precisam se sobrepor");
    for (const left of reports[0].intervals) for (const right of reports[1].intervals) {
      assert.ok(left.end <= right.start || right.end <= left.start, `sessão simultânea: ${JSON.stringify({ left, right })}`);
    }
    const snapshots = reports.flatMap((report) => report.snapshots);
    assert.ok(snapshots.some((entry) => entry.remoteInFlight === 2 && entry.activeLeases === 0), "dois renders em voo sem reter sessão local");
    assert.ok(snapshots.every((entry) => entry.remoteInFlight <= 2), "teto remoto preservado");
    const final = buildRuntimeOperationsSnapshot({ dbFile: path.join(root, "runtime.sqlite") }).broker;
    assert.equal(final.remoteInFlight, 0);
    assert.equal(final.activeLeases, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("falha inicial do segundo worker cancela o peer, preserva a causa e aguarda o encerramento", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "failed-test-workers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ready = path.join(root, "waiting.pid");
  const waiting = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const failure = `const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(ready)})) { clearInterval(timer); process.stderr.write('SECOND_WORKER_STARTUP_FAILURE'); process.exit(7); } }, 10);`;
  const results = await runTestProcessGroup([{ id: "waiting", args: ["-e", waiting] }, { id: "failed", args: ["-e", failure] }], { timeout: 10_000 });
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].cancelledAfterPeerFailure, true);
  assert.equal(results[1].reason.code, 7);
  assert.equal(results[1].reason.stderr, "SECOND_WORKER_STARTUP_FAILURE");
  assert.equal(results[1].cancelledAfterPeerFailure, false);
  const pid = Number(await readFile(ready, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "não limpar fixture enquanto o peer continua vivo");
});
