import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareLocalSfx } from '../scripts/prepare-local-sfx.mjs';

test('empty installation rebuilds 19 playable technical effects and a second setup preserves every file', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-sfx-install-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  assert.equal((await prepareLocalSfx(root)).providerCalls, 0);
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.wav'));
  assert.equal(files.length, 19);
  const before = new Map();
  for (const file of files) {
    const absolute = path.join(root, file);
    const result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', absolute], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, file);
    const probe = JSON.parse(result.stdout);
    assert.equal(probe.streams[0].codec_type, 'audio');
    assert.equal(probe.streams[0].sample_rate, '48000');
    assert.ok(Number(probe.format.duration) > 0);
    before.set(file, { hash: createHash('sha256').update(await readFile(absolute)).digest('hex'), modified: (await stat(absolute)).mtimeMs });
  }
  await prepareLocalSfx(root);
  for (const file of files) {
    const absolute = path.join(root, file), expected = before.get(file);
    assert.equal(createHash('sha256').update(await readFile(absolute)).digest('hex'), expected.hash);
    assert.equal((await stat(absolute)).mtimeMs, expected.modified);
  }
});
