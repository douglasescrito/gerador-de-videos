import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleFilm, buildFilmAssemblyFilter } from "../lib/media-pipeline/film-assembly.mjs";
import { probeTiming } from "../lib/media-pipeline/audio-first.mjs";
import { probeMedia, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";

test("montagem cut concatena cenas normalizadas", () => {
  const result = buildFilmAssemblyFilter({ durations: [10, 10, 5], transition: "cut" });
  assert.match(result.graph, /concat=n=3/);
  assert.equal(result.duration, 25);
});

test("montagem xfade calcula offsets e duração final", () => {
  const result = buildFilmAssemblyFilter({ durations: [10, 8, 6], transition: "fade", transitionDuration: 0.5 });
  assert.match(result.graph, /offset=9.500/);
  assert.match(result.graph, /offset=17.000/);
  assert.equal(result.duration, 23);
});

test("montagem cut pode preservar e concatenar o áudio original do Omni", () => {
  const result = buildFilmAssemblyFilter({ durations: [10, 10], transition: "cut", preserveAudio: true });
  assert.equal(result.audioOutputLabel, "aout");
  assert.match(result.graph, /concat=n=2:v=0:a=1\[aout\]/);
  assert.throws(() => buildFilmAssemblyFilter({ durations: [10, 10], transition: "fade", preserveAudio: true }), /exige transição cut/);
});

for (const preserveAudio of [false, true]) test(`montagem canônica preserva originais e atesta frames; preserveAudio=${preserveAudio}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-frames-"));
  try {
    const short = path.join(root, "short.mp4");
    const long = path.join(root, "long.mp4");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1.5", ...(preserveAudio ? ["-f", "lavfi", "-i", "sine=duration=1.5", "-c:a", "aac"] : ["-an"]), "-c:v", "libx264", "-pix_fmt", "yuv420p", short]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=2.5", ...(preserveAudio ? ["-f", "lavfi", "-i", "sine=duration=2.5", "-c:a", "aac"] : ["-an"]), "-c:v", "libx264", "-pix_fmt", "yuv420p", long]);
    const output = path.join(root, "master.mp4");
    const result = await assembleFilm({
      sceneFiles: [short, long], outputFile: output, transition: "cut", fps: 24, preserveAudio,
      sceneFrameTargets: [{ sceneId: "a", plannedFrames: 48 }, { sceneId: "b", plannedFrames: 48 }],
      expectedMasterFrames: 96, planFingerprint: "a".repeat(64), attestationDir: path.join(root, "attestations"),
    });
    assert.deepEqual(result.durationAttestations.map((entry) => entry.normalization), ["pad-last-frame", "trim"]);
    assert.ok(result.durationAttestations.every((entry) => entry.normalizedFrames === 48 && entry.sourcePreserved));
    assert.deepEqual(result.durationAttestations.map((entry) => entry.sha256Before), await Promise.all([short, long].map(sha256File)));
    assert.ok(result.durationAttestations.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256After)));
    assert.equal(Boolean((await probeMedia(output)).audio), preserveAudio);
    assert.equal((await probeTiming({ mediaFile: output, expectedFrames: 96 })).status, "pass");
    assert.equal((await probeTiming({ mediaFile: short })).streams.find((stream) => stream.codec_type === "video").decodedFrames, 36);
    assert.equal((await probeTiming({ mediaFile: long })).streams.find((stream) => stream.codec_type === "video").decodedFrames, 60);
  } finally { await rm(root, { recursive: true, force: true }); }
});
