import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMultiRootCatalog } from '../lib/media-pipeline/media-archive.mjs';
import { classificarEntrega, mapearEntregas } from '../lib/media-pipeline/archive-delivery.mjs';

test('nome, pasta e duração não confirmam entrega; cenas e temporários são reconhecidos', () => {
  for (const relPath of ['col/master-antigo.mp4', 'col/videos-unidos/programa.mp4', 'col/curto.mp4']) {
    const v = classificarEntrega({ relPath, isMaster: true, duration: 10 });
    assert.equal(v.status, 'candidate'); assert.equal(v.includeInFinals, true);
  }
  for (const relPath of ['col/cena-01-master-completo.mp4', 'col/videos-unidos/_pecas/master.mp4', 'col/.master-tmp.mp4', 'test-render/master.mp4']) {
    assert.equal(classificarEntrega({ relPath, isMaster: true }).includeInFinals, false);
  }
  const conflict = classificarEntrega({ relPath: 'col/cena-01.mp4' }, { finals: [{ basis: 'Papel do artefato: final-master' }] });
  assert.equal(conflict.status, 'candidate');
});

test('mapeamento liga arquivos exatos a recibos e manifestos, preservando legados e versões finais', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-delivery-'));
  const file = (rel) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'MP4-fixture'); return p; };
  const json = (rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)); };
  const artifact = (file, role, bytes = 11) => ({ file, kind: 'video', role, bytes });
  try {
    const master = file('col/final-antigo.mp4');
    const vertical = file('col/vertical.mp4');
    const visual = file('col/videos-unidos/visual.mp4');
    const scene = file('col/origem.mp4');
    const outra = file('outra/final-antigo.mp4');
    const alterado = file('col/master-alterado.mp4');
    file('legado/master-sem-recibo.mp4');
    const avulso = file('legado/avulso.mp4');
    const antigo = file('outra/final-legado.mp4');
    json('col/final-antigo.mp4.receipt.json', { schema: 'mkt-videos/receipt@1', status: 'completed', artifacts: [artifact(master, 'final-master')], inputs: [artifact(visual, 'source-video')] });
    json('col/vertical.mp4.receipt.json', { schema: 'mkt-videos/receipt@1', status: 'completed', artifacts: [artifact(vertical, 'delivery-video')], inputs: [artifact(master, 'source-video')] });
    json('col/videos-unidos/visual.mp4.receipt.json', { schema: 'mkt-videos/receipt@1', status: 'completed', artifacts: [artifact(visual, 'joined-omni-program')], inputs: [artifact(scene, 'scene-video')] });
    json('col/master-alterado.mp4.receipt.json', { schema: 'mkt-videos/receipt@1', status: 'completed', artifacts: [artifact(alterado, 'final-master', 999)] });
    json('outra/final-antigo.mp4.receipt.json', { schema: 'mkt-videos/receipt@1', status: 'failed', artifacts: [artifact(outra, 'final-master')] });
    json('outra/manifest.json', { schema: 'mkt-videos/collection-manifest@1', finalFile: antigo, parts: [] });
    json('legado/manifest.json', { schema: 'mkt-videos/collection-manifest@1', finalFile: path.join(root, 'ausente.mp4'), parts: [avulso] });
    const fontes = [{ id: 'entregas', root }];
    const catalog = buildMultiRootCatalog(fontes);
    mapearEntregas(catalog, fontes);
    const get = (rel) => catalog.videos.find(v => v.relPath === rel).delivery;
    assert.equal(get('col/final-antigo.mp4').status, 'final');
    assert.equal(get('col/vertical.mp4').status, 'final');
    assert.equal(get('col/videos-unidos/visual.mp4').status, 'component');
    assert.equal(get('col/origem.mp4').status, 'component');
    assert.equal(get('col/master-alterado.mp4').status, 'candidate');
    assert.equal(get('outra/final-antigo.mp4').status, 'candidate');
    assert.equal(get('outra/final-legado.mp4').status, 'final');
    assert.equal(get('legado/master-sem-recibo.mp4').includeInFinals, true);
    assert.equal(get('legado/avulso.mp4').includeInFinals, true);
    assert.equal(fs.readFileSync(master, 'utf8'), 'MP4-fixture');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
