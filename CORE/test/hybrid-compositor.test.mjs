import assert from "node:assert/strict";
import test from "node:test";
import {
  HYBRID_COMPOSITION_PLAN_SCHEMA,
  HYBRID_COMPOSITION_SCHEMA,
  assertHybridCompositionManifest,
  buildHybridCompositionPlan,
  createHybridCompositionManifest,
} from "../lib/media-pipeline/hybrid-compositor.mjs";

const baseFile = "C:\\fixtures\\approved-omni.mp4";
const alphaFile = "C:\\fixtures\\html-alpha.webm";

function manifest(overrides = {}) {
  return createHybridCompositionManifest({
    mode: "studio",
    fps: { numerator: 24, denominator: 1 },
    durationFrames: 192,
    timelineFingerprint: "timeline:approved",
    tracks: [
      { id: "base", kind: "video-base", file: baseFile, startFrame: 0, endFrameExclusive: null, zIndex: 0 },
      { id: "overlay", kind: "video-alpha", file: alphaFile, startFrame: 0, endFrameExclusive: 192, zIndex: 10, alpha: true, position: { x: 0, y: 0 } },
    ],
    audio: { mode: "preserve-base" },
    metadata: { pilot: "phase-8-shadow" },
    ...overrides,
  });
}

test("manifesto híbrido é tipado, Studio-only e hash-bound", () => {
  const value = manifest();
  assert.equal(value.schema, HYBRID_COMPOSITION_SCHEMA);
  assert.equal(value.mode, "studio");
  assert.match(value.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(assertHybridCompositionManifest(value), true);
});

test("manifesto híbrido rejeita raw e overlay sem alpha", () => {
  assert.throws(() => manifest({ mode: "raw" }), /exige --mode studio/);
  assert.throws(() => manifest({ tracks: [
    { id: "base", kind: "video-base", file: baseFile, startFrame: 0, endFrameExclusive: null, zIndex: 0 },
    { id: "overlay", kind: "video-alpha", file: alphaFile, startFrame: 0, endFrameExclusive: 192, zIndex: 10, alpha: false, position: { x: 0, y: 0 } },
  ] }), /alpha=true/);
});

test("plano híbrido exige artefatos e produz cache content-addressed determinístico", () => {
  const value = manifest();
  const artifacts = value.tracks.map((track, index) => ({
    file: track.file,
    id: `sha256:${String(index + 1).repeat(64)}`,
    hash: { algorithm: "sha256", value: String(index + 1).repeat(64) },
  }));
  const first = buildHybridCompositionPlan({ manifest: value, inputArtifacts: artifacts, toolchain: { ffmpeg: "sha256:ffmpeg" } });
  const second = buildHybridCompositionPlan({ manifest: value, inputArtifacts: artifacts, toolchain: { ffmpeg: "sha256:ffmpeg" } });
  assert.equal(first.schema, HYBRID_COMPOSITION_PLAN_SCHEMA);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.cache.key, second.cache.key);
  assert.equal(first.execution.paid, false);
  assert.throws(() => buildHybridCompositionPlan({ manifest: value, inputArtifacts: artifacts.slice(0, 1) }), /artefato hash-atestado/);
});

test("revalidação falha quando o fingerprint do manifesto é alterado", () => {
  const value = manifest();
  assert.throws(() => assertHybridCompositionManifest({ ...value, timelineFingerprint: "timeline:other" }), /Fingerprint.*divergente/);
});

