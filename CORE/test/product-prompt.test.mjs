import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductPromptRequest, requestProductPrompt } from '../lib/media-pipeline/product-prompt.mjs';

test('entrada textual não envia referências e rejeita brief vazio', () => {
  assert.throws(() => buildProductPromptRequest({ prompt: '' }));
  assert.throws(() => buildProductPromptRequest({ prompt: 'x'.repeat(20001) }));
  assert.deepEqual(buildProductPromptRequest({ prompt: 'Caneca' }), { productDesc: 'Caneca', atmosphereDesc: '', productImages: [], atmosphereImages: [] });
});
test('somente uma rota textual, sem POST de vídeo ou imagem', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => JSON.stringify({ prompt: 'Direção real' }) }; };
  try {
    const text = await requestProductPrompt({ evaluate: (fn, body) => fn(body) }, buildProductPromptRequest({ prompt: 'Caneca' }));
    assert.equal(text, 'Direção real');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/generate-prompt');
    assert.equal(calls[0].options.method, 'POST');
  } finally { globalThis.fetch = originalFetch; }
});
test('falha ambígua não repete chamada nem expõe erro remoto', async () => {
  let calls = 0;
  await assert.rejects(requestProductPrompt({ evaluate: async () => { calls++; throw new Error('segredo'); } }, {}), /external_effect_unknown/);
  assert.equal(calls, 1);
});
test('rejeita resposta HTTP ou payload inválido', async () => {
  for (const raw of [{ ok: false, status: 500 }, { ok: true, text: '{}' }, { ok: true, text: '<html>' }]) {
    await assert.rejects(requestProductPrompt({ evaluate: async () => raw }, {}));
  }
});
