import test from 'node:test';
import assert from 'node:assert/strict';
import { GRUPOS, etiquetarVideo, classificarCatalogo } from '../app/editor/acervo-groups.mjs';

test('taxonomia contém as dez propostas, ids únicos e estruturas explicadas', () => {
  assert.equal(GRUPOS.length, 20);
  assert.equal(new Set(GRUPOS.map(g => g.id)).size, 20);
  assert.equal(GRUPOS.filter(g => g.kind === 'proposta').length, 10);
  for (const g of GRUPOS) { assert.equal(g.steps.length, 3); assert.ok(g.common.trim()); }
});
test('etiquetas múltiplas reconhecem metadados e não inventam estrutura sem indícios', () => {
  const tags = etiquetarVideo({title: 'Comercial tipográfico', collectionId: 'entregas/apresentador'});
  for (const tag of ['motion','apresentador','comercial','tipografia']) assert.ok(tags.includes(tag));
  assert.deepEqual(etiquetarVideo({title: '7340555a', collectionId: 'entregas/20260908'}), ['identificar']);
  assert.deepEqual(etiquetarVideo({}), ['identificar']);
});
test('cobertura inclui todo vídeo e contagens não confundem grupos sobrepostos', () => {
  const catalogo = { videos: [{title:'Diálogos improváveis'}, {title:'Microdocumentário'}, {}] };
  classificarCatalogo(catalogo);
  assert.equal(catalogo.tagging.tagged, 3);
  assert.equal(catalogo.tagging.needsReview, 1);
  assert.ok(catalogo.videos[0].tags.includes('dialogos-improvaveis'));
  for (const g of catalogo.groups) assert.equal(g.count, catalogo.videos.filter(v => v.tags.includes(g.id)).length);
  const before = JSON.stringify(catalogo);
  classificarCatalogo(catalogo);
  assert.equal(JSON.stringify(catalogo), before);
});
