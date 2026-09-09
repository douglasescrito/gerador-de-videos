import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('runtime without private policy permits generic copy and has no inherited brand assets or restrictions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-neutral-brand-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  for (const name of ['studio-policies', 'commercial']) {
    const outfile = path.join(root, `${name}.mjs`);
    await build({ entryPoints: [path.resolve(import.meta.dirname, `../lib/media-pipeline/${name}.mjs`)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
    assert.doesNotMatch(await readFile(outfile, 'utf8'), /faculdade-focus|pt-foco/);
  }
  const policies = await import(pathToFileURL(path.join(root, 'studio-policies.mjs')).href);
  assert.equal(policies.DEFAULT_COMMERCIAL_BRAND_KIT.id, 'unbranded');
  assert.deepEqual(policies.DEFAULT_COMMERCIAL_BRAND_KIT.palette, []);
  assert.deepEqual(policies.DEFAULT_COMMERCIAL_BRAND_KIT.logos, []);
  assert.deepEqual(policies.findBrandTermViolations('foco'), []);
  const commercial = await import(pathToFileURL(path.join(root, 'commercial.mjs')).href);
  assert.doesNotThrow(() => commercial.assertBrandSafe('foco'));
});
