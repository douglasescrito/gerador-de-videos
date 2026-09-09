import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Trusted bundled modules only. This is an ABI test, not the future sandbox host.
async function run(id, input) {
  const base = new URL(`../plugins/${id}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('mesa-plugin.json', base), 'utf8'));
  const bytes = await readFile(new URL('plugin.wasm', base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.wasmSha256);
  assert.doesNotMatch(bytes.toString('latin1'), /[A-Z]:[\\/]Users[\\/]|confirmPaid|confirm-paid/i);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports: api } = await WebAssembly.instantiate(module, {});
  assert.equal(api.mesa_plugin_api_version(), 1);
  assert.equal(api.alloc(0), -1);
  assert.equal(api.alloc(262145), -1);
  const encoded = Buffer.from(typeof input === 'string' ? input : JSON.stringify(input));
  const pointer = api.alloc(encoded.length);
  assert.ok(pointer >= 0);
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  const packed = BigInt.asUintN(64, api.run(pointer, encoded.length));
  const offset = Number(packed >> 32n);
  const length = Number(packed & 0xffffffffn);
  assert.ok(length > 0 && length <= 262144);
  return JSON.parse(Buffer.from(api.memory.buffer, offset, length).toString('utf8'));
}

test('Wasm preflight preserves external input approval without obsolete spending gate', async () => {
  const input = { userPrompt: 'Cena abstrata', collection: 'estudo' };
  const ready = await run('production-preflight', input);
  assert.equal(ready.readyToSubmit, true);
  assert.equal(ready.providerCalls, 0);
  assert.equal(ready.retryAuthority, 'none');
  assert.equal((await run('production-preflight', { ...input, hasReferences: true })).readyToSubmit, false);
  assert.equal((await run('production-preflight', { ...input, hasReferences: true, confirmProviderInput: true })).readyToSubmit, true);
  for (const collection of ['', '..', 'a/b', 'a\\b']) {
    assert.equal((await run('production-preflight', { ...input, collection })).readyToSubmit, false);
  }
});

test('Wasm planner proposes one request and cannot authorize execution', async () => {
  for (const hasReferences of [false, true]) {
    const result = await run('omni-request-planner', { userPrompt: '  Cena abstrata  ', aspectRatio: '9:16', hasReferences });
    assert.equal(result.userPrompt, 'Cena abstrata');
    assert.equal(result.proposal.task, hasReferences ? 'reference_to_video' : 'text_to_video');
    assert.equal(result.proposal.confirmProviderInputRequired, hasReferences);
    assert.equal(result.proposal.providerCallsProposed, 1);
    assert.equal(result.hostPolicy.providerExecutionAllowed, false);
    assert.equal(result.hostPolicy.requiresHumanReview, true);
    assert.equal(result.proposal.aspectRatio, '9:16');
  }
});

test('Wasm normalizer proposes whitespace normalization and rejects malformed JSON', async () => {
  const result = await run('studio-brief-normalizer', { userPrompt: '  Câmera   com música  ' });
  assert.equal(result.userPrompt, 'Câmera com música');
  assert.equal(result.analysis.words, 3);
  assert.equal(result.analysis.mentionsCameraDirection, true);
  assert.equal(result.analysis.mentionsAudio, true);
  for (const id of ['production-preflight', 'omni-request-planner', 'studio-brief-normalizer']) {
    assert.equal((await run(id, '{')).error, 'JSON inválido');
  }
});
