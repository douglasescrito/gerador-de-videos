import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../templates/audio-first-multi-capitulos/prepare-sync.mjs', import.meta.url));
const recipe = {
  schema: 'gerador-de-videos/receita@1', id: 'teste-capitulos', label: 'Teste',
  kind: 'filme', aspect: '16:9', collection: 'teste-capitulos',
  scenes: [
    { id: 'primeiro', duration: 10, prompt: 'Formas abstratas em movimento.' },
    { id: 'segundo', duration: 10, prompt: 'Formas abstratas convergem.' },
  ],
};
const words = [{ word: 'Primeiro', start: 0.5, end: 1 }, { word: 'Depois', start: 12, end: 12.5 }];
const invoke = (cwd, args) => spawnSync(process.execPath, [entry, ...args], {
  cwd, encoding: 'utf8', windowsHide: true, timeout: 30000,
  env: { ...process.env, NODE_ENV: 'test' },
});
const args = ['--recipe', 'receita.json', '--words', 'words.json', '--out-dir', 'sync', '--videos-dir', 'videos'];

async function fixture(t, measuredWords = words) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audio-first-template-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('audio-first-template-'));
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, 'receita.json'), JSON.stringify(recipe));
  await writeFile(path.join(dir, 'words.json'), JSON.stringify(measuredWords));
  return dir;
}

test('chapter template uses canonical preparation from another cwd and preserves existing outputs', async t => {
  const dir = await fixture(t);
  const result = invoke(dir, args);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scenes, 2);
  const jobs = JSON.parse(await readFile(report.jobs, 'utf8'));
  assert.deepEqual(jobs.map(j => j.task), ['text_to_video', 'text_to_video']);
  const bindings = JSON.parse(await readFile(report.bindings, 'utf8'));
  assert.deepEqual(bindings.scenes.map(s => s.words[0].start), [0.5, 2]);
  const prompt = await readFile(path.join(dir, 'sync', jobs[1].promptFile), 'utf8');
  assert.match(prompt, /\[2\.000s - 2\.500s\] Depois/);
  assert.match(prompt, /Do not generate music/);
  const receipt = JSON.parse(await readFile(report.receipt, 'utf8'));
  assert.equal(receipt.metadata.providerCalls, 0);
  assert.equal(receipt.metadata.sourcePreserved, true);
  assert.deepEqual(await readdir(path.join(dir, 'videos')), []);
  const before = await readFile(report.jobs);
  const repeat = invoke(dir, args);
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /sobrescrit/);
  assert.deepEqual(await readFile(report.jobs), before);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'receita.json'), 'utf8')), recipe);
});

test('chapter template rejects out-of-range word timings before materializing a batch', async t => {
  const dir = await fixture(t, [{ word: 'Fora', start: 21, end: 22 }]);
  const result = invoke(dir, args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /excede a janela visual/);
  assert.deepEqual((await readdir(dir)).sort(), ['receita.json', 'words.json']);
});

test('chapter template forwards canonical help without invoking generation', async t => {
  const dir = await fixture(t);
  const result = invoke(dir, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sync-batch/);
  assert.match(result.stdout, /--recipe/);
  assert.deepEqual((await readdir(dir)).sort(), ['receita.json', 'words.json']);
});
