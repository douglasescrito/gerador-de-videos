import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildContextTextRequest } from '../lib/media-pipeline/context-text.mjs';

test('pedidos contextuais têm finalidade explícita e preservam o texto de origem', () => {
  const source = 'Texto sintético para revisão.';
  for (const purpose of ['shorten', 'opening', 'vertical', 'rewrite']) {
    assert.ok(buildContextTextRequest({ prompt: source, purpose }).endsWith(source));
  }
  assert.throws(() => buildContextTextRequest({ prompt: source, purpose: 'generate-video' }), /desconhecida/);
  assert.throws(() => buildContextTextRequest({ prompt: ' ', purpose: 'shorten' }), /Informe/);
});

test('capacidade contextual bloqueada falha antes de abrir sessão; registry e browser são dublês', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-text-contract-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  const intercepted = new Set();
  const outfile = path.join(root, 'context-text.mjs');
  await build({
    entryPoints: [path.resolve(import.meta.dirname, '../lib/media-pipeline/context-text.mjs')],
    outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'isolated-context-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /(?:provider-registry|ai-studio-headless)\.mjs$/ }, args => {
        const name = path.basename(args.path);
        intercepted.add(name);
        return { path: name, namespace: 'test-only' };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'test-only' }, args => ({
        contents: args.path === 'provider-registry.mjs'
          ? "export async function loadEffectiveProviderCapabilities(){return {'gemini-context-text':{status:'blocked'}}}"
          : "export async function openStudioPage(){throw Error('UNEXPECTED_SESSION_OPEN')} export async function cleanupHeadlessResources(){throw Error('UNEXPECTED_SESSION_CLEANUP')}",
        loader: 'js',
      }));
    } }],
  });
  assert.deepEqual([...intercepted].sort(), ['ai-studio-headless.mjs', 'provider-registry.mjs']);
  const { generateContextText } = await import(pathToFileURL(outfile).href);
  await assert.rejects(generateContextText({ prompt: 'Texto sintético.', purpose: 'shorten' }), /indisponível/);
});
