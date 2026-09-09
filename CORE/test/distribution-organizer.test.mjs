import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('organizer works without private production naming rules and does not execute on import', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'neutral-organizer-'));
  t.after(async () => { assert.equal(path.dirname(temporary), os.tmpdir()); await rm(temporary, { recursive: true, force: true }); });
  const output = path.join(temporary, 'organizer.mjs');
  await build({ entryPoints: [path.resolve(import.meta.dirname, '../scripts/organize-outputs.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
  assert.doesNotMatch(await readFile(output, 'utf8'), /douglas|isabela|focus-intro|passeio-casa/i);
  const organizer = await import(pathToFileURL(output).href);
  assert.equal(organizer.collectionForName('meu-filme-cena-02.mp4'), 'meu-filme');
  assert.equal(organizer.collectionForName('meu-filme-cena-02.mp4.receipt.json'), 'meu-filme');
  assert.equal(organizer.collectionForName('omni-text_to_video-123.mp4'), 'omni-text-to-video');
});
