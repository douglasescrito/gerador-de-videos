import assert from "node:assert/strict";
import test from "node:test";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  assertMotionIr,
  assertTimelineV2,
  buildTimelineShadow,
  motionIrFromTimelineV2,
  motionIrToTimelineV2,
  timelineV1ToV2,
  timelineV2ToV1,
} from "../lib/media-pipeline/timeline-ir.mjs";

function compiledTimeline() {
  return compileFilmSpec({
    name: "timeline-shadow",
    scenes: [
      { id: "a", prompt: "Cena A", duration: 2 },
      { id: "b", prompt: "Cena B", duration: 3 },
    ],
    assembly: { fps: 24, transition: "cut", transitionDuration: 0 },
    qa: false,
  }).timeline;
}

test("timeline@1 entra em shadow timeline@2 e retorna por round-trip exato", () => {
  const source = compiledTimeline();
  const shadow = buildTimelineShadow(source, { sourceProvenance: { kind: "compiler-test", id: "timeline-shadow" } });
  assert.equal(shadow.providerFree, true);
  assert.equal(shadow.effect, "none");
  assert.equal(shadow.roundTripEquivalent, true);
  assert.equal(shadow.timelineV2.schema, "mkt-videos/timeline@2");
  assert.equal(shadow.timelineV2.tracks[0].clips[0].endFrameExclusive, 48);
  assert.equal(shadow.motionIr.schema, "mkt-videos/motion-ir@1");
  assert.equal(assertMotionIr(shadow.motionIr).fingerprint, shadow.motionIr.fingerprint);
});

test("timeline v2 preserva ranges abertos e rejeita range inconsistente", () => {
  const source = compiledTimeline();
  const open = structuredClone(source);
  open.tracks[0].spans[0].durationFrames = null;
  open.tracks[0].spans[0].startFrame = null;
  open.tracks[0].spans[0].endFrame = null;
  delete open.fingerprint;
  open.fingerprint = undefined;
  const sourceOpen = { ...open };
  delete sourceOpen.fingerprint;
  sourceOpen.fingerprint = operationFingerprint(sourceOpen);
  const v2 = timelineV1ToV2(sourceOpen);
  assert.equal(v2.tracks[0].clips[0].durationFrames, null);
  assert.equal(timelineV2ToV1(v2).tracks[0].spans[0].endFrame, null);
  const bad = structuredClone(v2);
  bad.tracks[0].clips[0].endFrameExclusive = 999;
  delete bad.fingerprint;
  assert.throws(() => assertTimelineV2({ ...bad, fingerprint: "0".repeat(64) }), /fingerprint|range/i);
});

test("Motion IR é determinístico e não aceita seed com path ou segredo", () => {
  const v2 = timelineV1ToV2(compiledTimeline());
  const first = motionIrFromTimelineV2(v2, { seed: "fixture-seed" });
  const second = motionIrFromTimelineV2(v2, { seed: "fixture-seed" });
  assert.deepEqual(first, second);
  const back = motionIrToTimelineV2(first);
  assert.equal(back.schema, "mkt-videos/timeline@2");
  assert.throws(() => motionIrFromTimelineV2(v2, { seed: "C:\\secret\\seed" }), /path|inválido/i);
});
