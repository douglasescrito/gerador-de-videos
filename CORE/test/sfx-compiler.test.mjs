import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileSfxBed } from "../lib/media-pipeline/sfx-compiler.mjs";
import { probeMedia, runCommand } from "../lib/media-pipeline/media-tools.mjs";

test("cama SFX respeita a duração declarada mesmo quando o primeiro efeito termina antes", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sfx-duration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, "sfx-bed.wav");

  await compileSfxBed({
    totalDurationMs: 2_000,
    alignmentFingerprint: "test-timeline",
    cues: [{ atMs: 100, sound: "tick", gain: 0.1 }],
  }, { out: outputFile, mode: "studio" });

  const probe = await probeMedia(outputFile);
  assert.ok(Math.abs(probe.duration - 2) <= 0.02, `duração obtida: ${probe.duration}`);
});

test('SFX preserva áudio e recibo existentes e respeita ganho zero', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sfx-preserve-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const out = path.join(directory, 'silent.wav');
  const sheet = { totalDurationMs: 1000, cues: [{ atMs: 100, sound: 'tick', gain: 0 }] };
  const result = await compileSfxBed(sheet, { out });
  assert.ok(result.args.includes('-n'));
  const samples = path.join(directory, 'samples.pcm');
  await runCommand('ffmpeg', ['-v', 'error', '-i', out, '-f', 's16le', samples]);
  assert.ok((await readFile(samples)).every(byte => byte === 0));
  const before = await Promise.all([out, result.receiptFile].map(file => readFile(file)));
  await assert.rejects(compileSfxBed(sheet, { out }), /não será sobrescrit/);
  assert.deepEqual(await Promise.all([out, result.receiptFile].map(file => readFile(file))), before);
  const blocked = path.join(directory, 'blocked.wav');
  const receipt = path.join(directory, 'existing.json');
  await writeFile(receipt, 'original receipt');
  await assert.rejects(compileSfxBed(sheet, { out: blocked, receipt }), /não será sobrescrit/);
  await assert.rejects(access(blocked), { code: 'ENOENT' });
  assert.equal(await readFile(receipt, 'utf8'), 'original receipt');
});

test('SFX recusa parâmetros inválidos, saída coincidente e modo raw antes de escrever', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sfx-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const out = path.join(directory, 'absent.wav');
  for (const sheet of [
    { totalDurationMs: -1 }, { totalDurationMs: Infinity },
    { totalDurationMs: 1000, cues: {} },
    { totalDurationMs: 1000, cues: [{ sound: '../private', atMs: 0 }] },
    { totalDurationMs: 1000, cues: [{ sound: 'tick', atMs: 1000 }] },
    { totalDurationMs: 1000, cues: [{ sound: 'tick', atMs: 0, gain: -1 }] },
  ]) await assert.rejects(compileSfxBed(sheet, { out }));
  await assert.rejects(compileSfxBed({ totalDurationMs: 1000 }, { out, receipt: out }), /distintos/);
  await assert.rejects(compileSfxBed({ totalDurationMs: 1000 }, { out, mode: 'raw' }), /studio/);
  await assert.rejects(access(out), { code: 'ENOENT' });
});
