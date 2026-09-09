import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildReferenceTemporalStudy,
  MOTION_GRAMMAR_FAMILIES,
  renderReferenceMotionGrammarMarkdown,
} from "../lib/media-pipeline/reference-motion-grammar.mjs";
import {
  scanReferenceLibrary,
} from "../lib/media-pipeline/reference-governance.mjs";

test("estudo temporal cobre cada referência em cinco janelas sem criar runtime input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-motion-grammar-"));
  try {
    const video = path.join(root, "ref.mp4");
    const frames = path.join(root, "frames");
    await mkdir(frames);
    await writeFile(video, "video");
    for (let index = 0; index < 5; index += 1) await writeFile(path.join(frames, `ref-${index}.jpg`), `frame-${index}`);
    const referenceIndex = await scanReferenceLibrary({
      root,
      now: new Date("2026-07-23T00:00:00.000Z"),
      probe: async () => ({
        format: {
          format_name: "mp4",
          duration: "10",
          size: "5",
          bit_rate: "1000",
        },
        streams: [],
      }),
    });
    const study = await buildReferenceTemporalStudy({
      referenceIndex,
      motionMetadata: [{ name: "ref.mp4", path: video, width: 1920, height: 1080, fps: "30/1", duration: 10 }],
      framesRoot: frames,
      generatedAt: new Date("2026-07-23T12:00:00.000Z"),
    });
    assert.equal(study.videoCount, 1);
    assert.equal(study.sampledFrameCount, 5);
    assert.equal(study.taxonomy.familyCount, 7);
    assert.equal(study.videos[0].providerInput, false);
    assert.ok(study.videos[0].samples.every((sample) => /^[a-f0-9]{64}$/.test(sample.frameSha256)));
    assert.equal(MOTION_GRAMMAR_FAMILIES.length, 7);
    const markdown = renderReferenceMotionGrammarMarkdown(study);
    assert.match(markdown, /não autorizam qualquer referência como input/);
    assert.doesNotMatch(markdown, /ref\.mp4/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
