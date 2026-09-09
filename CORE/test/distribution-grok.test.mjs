import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { grokDirectClientFile, minePromptsWithGrok } from '../lib/media-pipeline/grok-prompt-miner.mjs';
import { askGrokViaBrowser } from '../lib/media-pipeline/grok-browser-miner.mjs';
import { build } from 'esbuild';

test('optional Grok uses explicit client paths and local Playwright; real routes stay outside tests', async () => {
  const file = path.join(os.tmpdir(), 'my-client', 'grok-direct-client.mjs');
  assert.equal(grokDirectClientFile({ STUDIO_GROK_CLIENT: file }), file);
  assert.throws(() => grokDirectClientFile({ STUDIO_GROK_CLIENT: 'relative-client.mjs' }), /absoluto/);
  const bundled = await build({ entryPoints: [path.resolve(import.meta.dirname, '../lib/media-pipeline/grok-browser-miner.mjs')], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const imports = Object.values(bundled.metafile.outputs).flatMap(entry => entry.imports.map(item => item.path));
  assert.ok(imports.includes('playwright-core'));
  assert.ok(!imports.includes('playwright'));
  assert.doesNotMatch(bundled.outputFiles[0].text, /ESTUDOS\/X MEDIA|X_MEDIA_ROOT|X_MEDIA_SRC/);
  await assert.rejects(minePromptsWithGrok({ brief: 'Estudo técnico', dublee: false }), /Provider-free test guard/);
  await assert.rejects(askGrokViaBrowser('Estudo técnico'), /Provider-free test guard/);
});
