import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setPresenterReference } from '../app/editor/presenter-reference.js';
import { listPresenterReferences } from '../app/editor/presenter-catalog.mjs';
import { studioLocalConfigFile, studioLocalPath } from '../lib/studio-local-config.mjs';

test('person selection is explicit, preserves non-person assets and rejects escaping paths', () => {
  const scene = { references: [{ source: 'outputs', relPath: 'product.png' }, { source: 'pessoas', relPath: 'previous.png' }] };
  setPresenterReference(scene, 'nova pessoa.png');
  assert.equal(scene.references[0].source, 'outputs');
  assert.equal(scene.references[1].relPath, 'nova pessoa.png');
  assert.equal(scene.references.length, 2);
  for (const file of ['../private.png', 'C:\\private.png', 'folder/a.png', 'file.txt']) assert.throws(() => setPresenterReference(scene, file));
  setPresenterReference(scene, ''); assert.equal(scene.generationTask, 'reference_to_video');
  scene.references = []; setPresenterReference(scene, ''); assert.equal(scene.generationTask, 'text_to_video');
});

test('omitted authored templates do not prevent startup; corrupt installed templates fail visibly', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-optional-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const loader = path.join(root, 'optional-motion-templates.mjs');
  await copyFile(new URL('../lib/media-pipeline/optional-motion-templates.mjs', import.meta.url), loader);
  const empty = await import(pathToFileURL(loader).href + '?empty');
  assert.deepEqual(empty.optionalMotionBindingFiles(), [loader]);
  assert.throws(() => empty.requireOptionalMotionTemplate('adp-explainer'), /não acompanha/);
  assert.throws(() => empty.requireOptionalMotionTemplate('../private'), /desconhecido/);
  await writeFile(path.join(root, 'adp-explainer.mjs'), 'export const fixture = 1;');
  const installed = await import(pathToFileURL(loader).href + '?installed');
  assert.equal(installed.requireOptionalMotionTemplate('adp-explainer').fixture, 1);
  assert.equal(installed.optionalMotionBindingFiles().length, 2);
  await writeFile(path.join(root, 'nano-banana-motion.mjs'), "import './missing-dependency.mjs';");
  await assert.rejects(import(pathToFileURL(loader).href + '?broken'), /missing-dependency/);
});
test('empty installation has no default person and local configuration does not inherit author paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-portability-'));
  t.after(async () => { assert.ok(root.startsWith(os.tmpdir() + path.sep)); await rm(root, { recursive: true, force: true }); });
  const core = path.join(root, 'CORE'); await mkdir(core);
  assert.deepEqual(await listPresenterReferences(core), []);
  await mkdir(path.join(root, 'PESSOAS')); await writeFile(path.join(root, 'PESSOAS', 'my-person.png'), 'fixture');
  await writeFile(path.join(root, 'PESSOAS', 'notes.txt'), 'not-an-image');
  assert.deepEqual(await listPresenterReferences(core), [{ file: 'my-person.png', label: 'my-person' }]);
  const env = { LOCALAPPDATA: path.join(root, 'Local') };
  assert.equal(studioLocalPath('gcpCli', env), null);
  assert.equal(studioLocalPath('commercialLogo', env), null);
  const config = studioLocalConfigFile(env); await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, JSON.stringify({ referenceRoot: path.join(root, 'References') }));
  assert.equal(studioLocalPath('referenceRoot', env), path.join(root, 'References'));
  assert.throws(() => studioLocalPath('gcpCli', { ...env, STUDIO_GCP_CLI: 'relative.ps1' }));
});
