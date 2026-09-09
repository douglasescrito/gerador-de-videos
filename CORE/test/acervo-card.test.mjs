import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildCatalog } from '../lib/media-pipeline/media-archive.mjs';

const contexto = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../app/editor/acervo-card.js', import.meta.url), 'utf8'), contexto);

test('rótulo do card remove UUID e hash, preservando o título e o arquivo original', () => {
  const video = { title: 'Visual final 11111111 2222 4333 8444 555555555555', colecaoCurta: 'campanha-20260906', relPath: 'original.mp4' };
  assert.equal(contexto.tituloDoCard(video), 'Visual final');
  assert.equal(video.title, 'Visual final 11111111 2222 4333 8444 555555555555');
  assert.equal(video.relPath, 'original.mp4');
  assert.equal(contexto.limparRotuloMidia('Um estudo ep06 exemplo'), 'Um estudo ep06 exemplo');
  assert.equal(contexto.limparRotuloMidia('Animação ' + 'a9'.repeat(32)), 'Animação');
  assert.equal(contexto.tituloDoCard({ title: 'Master', colecaoCurta: 'Uma-ideia-20260906' }), 'Uma ideia · Master');
});

test('data de criação vem do nascimento do arquivo, independentemente da modificação', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-card-date-'));
  try {
    const file = path.join(root, 'video.mp4');
    fs.writeFileSync(file, 'fixture de catálogo; não é reproduzida');
    const antiga = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(file, antiga, antiga);
    const stat = fs.statSync(file);
    const [video] = buildCatalog(root).videos;
    assert.equal(video.createdAtMs, stat.birthtimeMs > 0 ? stat.birthtimeMs : null);
    assert.equal(video.mtimeMs, stat.mtimeMs);
    if (stat.birthtimeMs > 0) assert.notEqual(video.createdAtMs, video.mtimeMs);
    assert.equal(contexto.criacaoDoCard({ mtimeMs: video.mtimeMs }), 'Criação não informada');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
