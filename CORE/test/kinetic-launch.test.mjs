import assert from "node:assert/strict";
import test from "node:test";
import { validateKineticWords, kineticLaunchDocument } from "../lib/media-pipeline/kinetic-launch.mjs";
import { createHtmlMotionScene, renderHtmlMotionPilot } from "../lib/media-pipeline/html-motion-pilot.mjs";

const words = [{ word: "Ideia", start: .17, end: .63 }, { word: "em", start: .64, end: .78 }, { word: "movimento.", start: .8, end: 1.23 }];
test("motion preserva tempos medidos sem interpolar palavras", () => {
  assert.deepEqual(validateKineticWords(words, 2), words);
  const scene = createHtmlMotionScene({ durationSeconds: 62, wordMotion: words });
  assert.deepEqual(scene.wordMotion, words);
  assert.throws(() => validateKineticWords([{ word: "x", start: -1, end: 1 }], 2), /inválida/);
  assert.throws(() => validateKineticWords([...words, { word: "fora", start: .1, end: 1 }], 2), /inválida/);
  assert.throws(() => validateKineticWords(words, 1), /inválida/);
  assert.throws(() => createHtmlMotionScene({ durationSeconds: 62 }), /inválido/);
});
test("texto é dado, não HTML executável, e design exige HyperFrames", async () => {
  const scene = createHtmlMotionScene({ durationSeconds: 2, wordMotion: [{ word: "</script><script>evil()", start: 0, end: 1 }] });
  const doc = kineticLaunchDocument(scene);
  assert.ok(!doc.includes("</script><script>evil()"));
  assert.ok(doc.includes("\\u003c/script>"));
  await assert.rejects(renderHtmlMotionPilot({ engine: "remotion", scene }), /exige HyperFrames/);
});
