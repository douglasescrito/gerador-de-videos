import assert from "node:assert/strict";
import test from "node:test";
import { assertTimelinePreview, buildTimelinePreview } from "../lib/media-pipeline/timeline-preview.mjs";

test("timeline preview é provider-free, determinístico e não renderiza", async () => {
  // Use a canonical v2 fixture so the preview validates the same contract as the planner.
  const valid = {
    schema: "mkt-videos/timeline@2",
    timeBase: { numerator: 1, denominator: 24 },
    fps: { numerator: 24, denominator: 1 },
    frameRange: { startFrame: 0, endFrameExclusive: 48 },
    locked: true,
    transition: { type: "cut", durationFrames: 0 },
    assets: [],
    tracks: [{ id: "video", kind: "video", clips: [{ id: "video:scene-a:0", sceneId: "scene-a", order: 0, startFrame: 0, durationFrames: 24, endFrameExclusive: 24 }, { id: "video:scene-b:1", sceneId: "scene-b", order: 1, startFrame: 24, durationFrames: 24, endFrameExclusive: 48 }] }],
    markers: [{ id: "beat-1", frame: 24, label: "corte" }],
    metadata: {},
    sourceProvenance: null,
  };
  const { operationFingerprint } = await import("../lib/media-pipeline/pipeline-operation.mjs");
  const sourceValid = { ...valid, fingerprint: operationFingerprint(valid) };
  const preview = buildTimelinePreview({ timeline: sourceValid });
  assert.equal(preview.providerFree, true);
  assert.equal(preview.effect, "none");
  assert.equal(preview.durationSeconds, 2);
  assert.equal(preview.tracks[0].clips.length, 2);
  assert.equal(assertTimelinePreview(preview), true);
});

test("preview preserva range aberto sem inventar segundos finais e rejeita paths", async () => {
  const { operationFingerprint } = await import("../lib/media-pipeline/pipeline-operation.mjs");
  const body = {
    schema: "mkt-videos/timeline@2",
    timeBase: { numerator: 1, denominator: 24 }, fps: { numerator: 24, denominator: 1 },
    frameRange: { startFrame: 0, endFrameExclusive: null }, locked: false, transition: { type: "cut", durationFrames: 0 }, assets: [],
    tracks: [{ id: "video", kind: "video", clips: [{ id: "open", startFrame: 0, durationFrames: null, endFrameExclusive: null, source: null }] }], markers: [], metadata: {}, sourceProvenance: null,
  };
  const preview = buildTimelinePreview({ timeline: { ...body, fingerprint: operationFingerprint(body) } });
  assert.equal(preview.durationSeconds, null);
  assert.equal(preview.tracks[0].clips[0].endSeconds, null);
  assert.throws(() => buildTimelinePreview({ timeline: { ...body, tracks: [{ ...body.tracks[0], id: "C:\\secret" }], fingerprint: operationFingerprint({ ...body, tracks: [{ ...body.tracks[0], id: "C:\\secret" }] }) } }), /path/);
});
