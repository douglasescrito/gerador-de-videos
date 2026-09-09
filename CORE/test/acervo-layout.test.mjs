import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('grade calcula apenas a janela visível e mantém a geometria nas bordas', () => {
  const context = vm.createContext({ palco: { clientWidth: 1080 }, FILTRADOS: new Array(11342), LARGURA_ALVO: 220, ESPACO: 10 });
  vm.runInContext(fs.readFileSync(new URL('../app/editor/acervo-layout.js', import.meta.url), 'utf8'), context);
  const layout = context.layoutDoAcervo();
  for (const [start, end] of [[-250, 1000], [150000, 151000], [layout.altura - 300, layout.altura + 500], [layout.altura + 1000, layout.altura + 2000]]) {
    const positions = context.posicoesVisiveis(layout, start, end);
    assert.ok(positions.length < 40);
    for (const position of positions) {
      assert.ok(position.indice >= 0 && position.indice < 11342);
      assert.equal(position.x, position.indice % layout.quantidade * (layout.larguraCarta + 10));
      assert.equal(position.y, Math.floor(position.indice / layout.quantidade) * layout.passo);
    }
  }
  context.FILTRADOS = [];
  assert.equal(context.layoutDoAcervo().altura, 0);
  assert.equal(context.posicoesVisiveis(context.layoutDoAcervo(), -250, 1000).length, 0);
});
