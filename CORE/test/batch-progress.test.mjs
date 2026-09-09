import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  accumulatedWork,
  buildJobTimingStats,
  estimatePoolEta,
  extractReceiptDeliveryMs,
  formatDuration,
  loadLatestBatchBaseline,
  percentileNearestRank,
  summarizeMilliseconds,
} from "../scripts/batch-progress.mjs";

test("estatísticas e percentis de duração são determinísticos", () => {
  assert.equal(percentileNearestRank([40, 10, 30, 20], 0.75), 30);
  assert.deepEqual(summarizeMilliseconds([]), { count: 0, min: null, max: null, mean: null, median: null, p95: null, total: 0 });
  assert.deepEqual(summarizeMilliseconds([1_000, 2_000, 3_000, 10_000]), {
    count: 4,
    min: 1_000,
    max: 10_000,
    mean: 4_000,
    median: 2_500,
    p95: 10_000,
    total: 16_000,
  });
});

test("ETA usa lanes do pool, baseline e censura de jobs ativos", () => {
  assert.deepEqual(estimatePoolEta({ parallel: 3, queuedCount: 2, activeElapsedMs: [1_000] }), {
    etaMs: null,
    estimatedJobMs: null,
    source: "unavailable",
    sampleCount: 0,
  });
  assert.deepEqual(estimatePoolEta({
    parallel: 3,
    queuedCount: 7,
    activeElapsedMs: [10_000, 10_000, 10_000],
    baselineDurationsMs: [50_000],
  }), {
    etaMs: 190_000,
    estimatedJobMs: 50_000,
    source: "baseline",
    sampleCount: 1,
  });
  assert.equal(estimatePoolEta({
    parallel: 3,
    queuedCount: 2,
    activeElapsedMs: [20_000],
    completedDurationsMs: [50_000],
  }).etaMs, 50_000);
  assert.equal(estimatePoolEta({
    parallel: 1,
    queuedCount: 0,
    activeElapsedMs: [60_000],
    completedDurationsMs: [50_000],
  }).etaMs, 15_000);
  assert.equal(estimatePoolEta({ parallel: 3, queuedCount: 0, activeElapsedMs: [] }).etaMs, 0);
});

test("formatação não inventa ETA e recibos antigos fornecem somente duração total", () => {
  assert.equal(formatDuration(null), "calculando...");
  assert.equal(formatDuration(800), "0,8s");
  assert.equal(formatDuration(98_000), "1m38s");
  assert.deepEqual(extractReceiptDeliveryMs({
    startedAt: "2026-07-14T17:52:18.585Z",
    completedAt: "2026-07-14T17:53:07.814Z",
  }), { milliseconds: 49_229, source: "receipt-envelope" });
});

test("agregados separam wall clock de trabalho acumulado", () => {
  const results = [
    { ok: true, timings: { queueMs: 10, providerMs: 800, downloadMs: 100, localFinalizeMs: 100, videoDeliveryMs: 1_000 } },
    { ok: true, timings: { queueMs: 20, providerMs: 1_500, downloadMs: 200, localFinalizeMs: 300, videoDeliveryMs: 2_000 } },
    { ok: false, timings: { queueMs: 30, videoDeliveryMs: 50 } },
  ];
  const stats = buildJobTimingStats(results);
  assert.equal(stats.videoDeliveryMs.median, 1_500);
  assert.equal(stats.queueMs.count, 2);
  assert.deepEqual(accumulatedWork(results), {
    count: 2,
    providerMs: 2_300,
    nonProviderMs: 700,
    totalMs: 3_000,
    providerPercent: 76.67,
    nonProviderPercent: 23.33,
    note: "Tempos acumulados dos jobs; fases paralelas se sobrepõem e não representam decomposição do wall clock.",
  });
});

test("baseline mais recente lê summary novo e recibo legado", async () => {
  const root = path.join(os.tmpdir(), `mkt-batch-progress-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  try {
    const oldDir = path.join(root, "old-batch");
    const newDir = path.join(root, "new-batch");
    const currentDir = path.join(root, "current-batch");
    await Promise.all([mkdir(oldDir), mkdir(newDir), mkdir(currentDir)]);
    const oldReceipt = path.join(oldDir, "one.mp4.receipt.json");
    await writeFile(oldReceipt, JSON.stringify({ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:42.000Z" }));
    await writeFile(path.join(oldDir, "summary.json"), JSON.stringify({
      completedAt: "2026-01-01T00:01:00.000Z",
      results: [{ ok: true, receipt: oldReceipt }],
    }));
    await writeFile(path.join(newDir, "summary.json"), JSON.stringify({
      completedAt: "2026-01-02T00:01:00.000Z",
      results: [{ ok: true, timings: { videoDeliveryMs: 51_000 } }],
    }));
    await writeFile(path.join(currentDir, "summary.json"), JSON.stringify({
      completedAt: "2026-01-03T00:01:00.000Z",
      results: [{ ok: true, timings: { videoDeliveryMs: 99_000 } }],
    }));

    const currentExcluded = await loadLatestBatchBaseline(root, { excludeDir: currentDir });
    assert.equal(currentExcluded.batch, "new-batch");
    assert.deepEqual(currentExcluded.durationsMs, [51_000]);

    await rm(newDir, { recursive: true, force: true });
    const legacy = await loadLatestBatchBaseline(root, { excludeDir: currentDir });
    assert.equal(legacy.source, "legacy-receipts");
    assert.deepEqual(legacy.durationsMs, [42_000]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
