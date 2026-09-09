import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { runTestProcessGroup } from "./fixtures/test-process-group.mjs";

for (const directRoute of ["generate", "batch"]) test(`${directRoute} e nó Studio em processos distintos avançam com Flow/Vids ocupados`, { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mixed-cli-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = path.join(import.meta.dirname, "fixtures", "direct-video-worker.mjs");
  const entries = [["direct", directRoute], ["canonical", "studio"], ["audio", "audio-local"]];
  const results = await runTestProcessGroup(entries.map(([id, route]) => ({ id, args: [worker, root, id, route] })), {
    windowsHide: true, timeout: 50_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: "test", MKT_VIDEOS_RUNTIME_DB: path.join(root, "runtime.sqlite") },
  });
  const failures = results.filter(result => result.status === "rejected");
  assert.deepEqual(failures.map(result => ({ id: result.id, cancelledAfterPeerFailure: result.cancelledAfterPeerFailure, error: result.reason.stderr || result.reason.message })), []);
  const reports = await Promise.all(entries.map(async ([id]) => JSON.parse(await readFile(path.join(root, `${id}.report.json`), "utf8"))));
  assert.equal(new Set(reports.map((report) => report.pid)).size, 3);
  const [direct, canonical, audio] = reports;
  assert.ok(direct.remoteStart < canonical.remoteEnd && canonical.remoteStart < direct.remoteEnd, "os renders de rotas diferentes devem se sobrepor");
  for (const left of direct.intervals) for (const right of canonical.intervals) assert.ok(left.end <= right.start || right.end <= left.start, "sessão Omni não pode atender dois processos simultaneamente");
  const snapshots = reports.flatMap((report) => report.snapshots);
  assert.ok(snapshots.every((snapshot) => snapshot.remoteInFlight <= 2));
  assert.ok(snapshots.some((snapshot) => snapshot.remoteInFlight === 2 && snapshot.used["provider:flow"] === 1 && snapshot.used["provider:vids"] === 1 && (snapshot.used["browser:omni"] ?? 0) === 0), "Flow/Vids não bloqueiam render remoto nem retêm a sessão Omni");
  const local = audio.intervals.find((interval) => interval.phase === "local");
  for (const provider of ["flow", "vids"]) {
    const interval = audio.intervals.find((entry) => entry.phase === provider);
    assert.ok(interval.start <= local.start && interval.end >= local.end, "compute local avança enquanto o recurso de áudio está ocupado");
  }
  const final = buildRuntimeOperationsSnapshot({ dbFile: path.join(root, "runtime.sqlite") }).broker;
  assert.equal(final.activeLeases, 0);
  assert.equal(final.remoteInFlight, 0);
  assert.equal(final.queued, 0);
});
