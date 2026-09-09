import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { createSyntheticToneFixtures } from "./fixtures/synthetic-tones.mjs";

test("entrada PCM é preparada uma vez e cópias concorrentes são independentes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synthetic-tone-test-"));
  const fixtures = createSyntheticToneFixtures();
  t.after(async () => { await fixtures.dispose(); await rm(root, { recursive: true, force: true }); });
  const config = { frequency: 440, duration: 0.2, channels: 1, sampleRate: 48000 };
  const [a, b] = await Promise.all(["a", "b"].map((name) => fixtures.materialize(path.join(root, name + ".wav"), config)));
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(fixtures.stats(), { generated: 1, copies: 2 });
  const original = await readFile(b.file);
  await writeFile(a.file, "cópia alterada");
  const c = await fixtures.materialize(path.join(root, "c.wav"), config);
  assert.deepEqual(await readFile(c.file), original);
  const other = await fixtures.materialize(path.join(root, "other.wav"), { ...config, frequency: 220 });
  assert.notEqual(other.sha256, b.sha256);
  assert.notEqual(other.fixtureKey, b.fixtureKey);
  assert.deepEqual(fixtures.stats(), { generated: 2, copies: 4 });
  const media = await probeMedia(c.file);
  assert.equal(media.audio.codec_name, "pcm_s16le");
  assert.equal(media.audio.channels, 1);
  assert.equal(Number(media.audio.sample_rate), 48000);
  assert.ok(Math.abs(media.duration - 0.2) < 0.001);
  await assert.rejects(fixtures.materialize(c.file, config), { code: "EEXIST" });
  await assert.rejects(fixtures.materialize(path.join(root, "bad.wav"), { ...config, duration: NaN }), /inválida/);
  await fixtures.dispose();
  await assert.rejects(fixtures.materialize(path.join(root, "closed.wav"), config), /encerrada/);
});

test("encerramento aguarda a publicação em voo antes de remover a preparação", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synthetic-tone-close-"));
  const fixtures = createSyntheticToneFixtures();
  t.after(async () => { await fixtures.dispose(); await rm(root, { recursive: true, force: true }); });
  const file = path.join(root, "pending.wav");
  const publication = fixtures.materialize(file, { frequency: 300, duration: 0.1 });
  await fixtures.dispose();
  const result = await publication;
  assert.equal((await readFile(file)).length, result.bytes);
  assert.deepEqual(fixtures.stats(), { generated: 1, copies: 1 });
});
