import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { buildNarrationTimingGuide, readWordTimeline, withNarrationTimingGuide } from "../lib/media-pipeline/narrated-video.mjs";

let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "narrated-video-test-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

test("lê palavras do JSON Whisper e monta guia por frases", async () => {
  const file = path.join(root, "words.json");
  await writeFile(file, JSON.stringify({ segments: [{ words: [
    { word: " Olá", start: 0, end: 0.4 },
    { word: " mundo!", start: 0.4, end: 0.9 },
    { word: " Vamos", start: 1, end: 1.4 },
    { word: " criar.", start: 1.4, end: 1.9 },
  ] }] }));
  const words = await readWordTimeline(file);
  assert.equal(words.length, 4);
  assert.equal(words[0].word, "Olá");
  const guide = buildNarrationTimingGuide(words);
  assert.match(guide, /\[0\.00s–0\.90s\] Olá mundo!/);
  assert.match(guide, /\[1\.00s–1\.90s\] Vamos criar\./);
});

test("preserva o prompt e adiciona referência temporal somente no modo narrado", () => {
  const output = withNarrationTimingGuide("Direção literal do usuário.", "[0.00s–1.00s] Olá");
  assert.match(output, /^Direção literal do usuário\./);
  assert.match(output, /Narration timing reference/);
  assert.match(output, /\[0\.00s–1\.00s\] Olá/);
});

test("rejeita alinhamento sem fim de palavra", async () => {
  const file = path.join(root, "invalid.json");
  await writeFile(file, JSON.stringify([{ word: "falha", start: 0 }]));
  await assert.rejects(readWordTimeline(file), /Fim da palavra/);
});
