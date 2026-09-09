import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsDashboard } from "../lib/media-pipeline/operations-dashboard.mjs";

test("painel mede outcomes reais e não captura prompt", () => {
  const dashboard = buildOperationsDashboard({
    health: { uiReady: true, transportReachable: true, sessionReady: null, generationCapability: "supported", archiveReady: true },
    batchJobs: [
      { state: "attention_required", counts: { ambiguous: 1, completed: 2 } },
      { state: "completed", counts: { completed: 3 } },
    ],
    attempts: {
      a: { state: "archived", fileId: "f", archivedRelPath: "x.mp4", prompt: "segredo operacional" },
      b: { state: "attention_required" },
    },
    promptIndex: {
      stats: { indexed: 1, withReceipt: 1 },
      entries: {
        "x.mp4": {
          durationMs: 100,
          task: "text_to_video",
          model: "omni",
          prompt: "não publicar",
          templateBinding: { templateId: "t", templateRevision: 1 },
          promptComposition: { directionPreset: "flat@1" },
        },
        "y.mp4": { durationMs: 300, task: "text_to_video", model: "omni", prompt: "também não" },
      },
    },
    catalog: { videos: [
      { id: "x.mp4", relPath: "x.mp4", duration: 10, sizeMb: 2 },
      { id: "y.mp4", relPath: "y.mp4", duration: null, sizeMb: 3 },
    ] },
    reviews: [{ relPath: "x.mp4" }],
    transcripts: [{ payload: { assetId: "y.mp4" } }],
    templates: [{ activeRevision: 1, revisions: [{}, {}] }],
    runtime: { schema: "mkt-videos/runtime-operations@1", readOnly: true, broker: { activeLeases: 1 } },
    generatedAt: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(dashboard.queue.attentionRequired, 1);
  assert.equal(dashboard.queue.itemOutcomes.completed, 5);
  assert.deepEqual(dashboard.latencyMs, { samples: 2, p50: 100, p90: 300 });
  assert.equal(dashboard.coverage.transcript.percent, 50);
  assert.equal(dashboard.contentCapture, false);
  assert.equal(dashboard.runtime.broker.activeLeases, 1);
  assert.doesNotMatch(JSON.stringify(dashboard), /segredo operacional|não publicar|também não/);
});
