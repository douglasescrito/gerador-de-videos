import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStorageReport, buildUsageCostReport, listFilmJobs, buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { DatabaseSync } from "node:sqlite";

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}

test("runtime ocupado não é apresentado como vazio nem encerra o diagnóstico", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-read-busy-"));
  const file = path.join(root, "runtime.sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE placeholder(id); BEGIN EXCLUSIVE");
    const report = buildRuntimeOperationsSnapshot({ dbFile: file });
    assert.equal(report.status, "busy");
    assert.equal(report.readOnly, true);
    assert.equal(report.broker, null);
    db.exec("ROLLBACK");
    assert.equal(buildRuntimeOperationsSnapshot({ dbFile: file }).status, "ready");
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test("jobs lista 1000 estados em menos de 2 segundos e prioriza reconciliação", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jobs-report-"));
  try {
    const states = Array.from({ length: 1000 }, (_, index) => {
      const directory = path.join(root, `collection-${index}`, "metadados");
      const stateFile = path.join(directory, "film-state.json");
      return json(stateFile, {
        schema: "mkt-videos/film-state@1", id: `film:${index}`, status: index === 0 ? "attention_required" : "delivered",
        stateFile, draftFile: null, finalFile: index ? path.join(root, `collection-${index}`, "final.mp4") : null,
        updatedAt: "2026-07-22T12:00:00.000Z", stages: { video: { status: index === 0 ? "ambiguous" : "completed" } },
      });
    });
    await Promise.all(states);
    const started = performance.now();
    const report = await listFilmJobs({ root });
    const elapsed = performance.now() - started;
    assert.equal(report.total, 1000);
    assert.equal(report.counts.attention_required, 1);
    assert.equal(report.jobs.find((job) => job.status === "attention_required").retentionProtected, true);
    const performanceGate = process.env.MKT_VIDEOS_PERFORMANCE_GATE === "1";
    assert.ok(elapsed < (performanceGate ? 2000 : 10_000), `listagem levou ${elapsed.toFixed(1)} ms${performanceGate ? " no gate isolado" : " sob stress concorrente"}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("usage deduplica receipt e mantém legado sem custo como unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "usage-report-"));
  try {
    const receipt = { schema: "mkt-videos/receipt@1", id: "receipt:one", operation: "generate-video", provider: "test", model: "omni", completedAt: "2026-07-22T12:00:00.000Z" };
    await json(path.join(root, "a", "one.receipt.json"), receipt);
    await json(path.join(root, "copy", "one.receipt.json"), receipt);
    await json(path.join(root, "b", "legacy.receipt.json"), { schema: "legacy", operation: "tts" });
    const report = await buildUsageCostReport({ root });
    assert.equal(report.scanned, 3);
    assert.equal(report.deduplicatedReceipts, 2);
    assert.equal(report.duplicates, 1);
    assert.equal(report.money.status, "unknown");
    assert.equal(report.money.unknown, 2);
    assert.equal(report.money.reported, 0);
    assert.equal(report.quota.monetaryEquivalent, null);
    assert.equal(JSON.stringify(report).includes("prompt"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cópia legada sem operação comprovada não conta como provider evitado", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reuse-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await json(path.join(root, "copy.receipt.json"), { operation: "reuse-artifact", metadata: { avoidedProviderPost: true, avoidedOperation: "invented" } });
  const report = await buildUsageCostReport({ root });
  assert.equal(report.calls.avoidedByReuse, 0);
  assert.equal(report.calls.localOperationsAvoided, 0);
  assert.equal(report.calls.reuseCopies, 1);
  assert.equal(report.records[0].reuse.operationAvoided, null);
});

test("storage report é read-only e nunca sugere item de job ativo ou referenciado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storage-report-"));
  try {
    const activeRoot = path.join(root, "active");
    const activeTemp = path.join(activeRoot, "metadados", "work.tmp");
    await json(path.join(activeRoot, "metadados", "film-state.json"), { schema: "mkt-videos/film-state@1", status: "attention_required" });
    await writeFile(activeTemp, "active", "utf8");
    const referenced = path.join(root, "done", "proxy.mp4");
    await mkdir(path.dirname(referenced), { recursive: true });
    await writeFile(referenced, "derived", "utf8");
    await json(path.join(root, "done", "proxy.receipt.json"), { artifacts: [{ file: referenced }] });
    const inactiveTemp = path.join(root, "done", "old.part");
    await writeFile(inactiveTemp, "temp", "utf8");
    const report = await buildStorageReport({ root, graceHours: 0 });
    assert.equal(report.readOnly, true);
    assert.equal(report.plan.action, "none");
    assert.equal(report.plan.candidates.some((entry) => entry.file === activeTemp), false);
    assert.equal(report.plan.candidates.some((entry) => entry.file === referenced), false);
    assert.equal(report.plan.candidates.some((entry) => entry.file === inactiveTemp), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
