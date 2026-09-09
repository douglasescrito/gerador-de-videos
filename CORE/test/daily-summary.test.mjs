// "O que rodou, o que falhou, o que ficou pendente" não tinha resposta: havia
// `jobs`, `status` e a colheita, cada um com um pedaço, e nenhum lugar
// juntando. Estes testes seguram a junção — e o fato de ela ser só leitura.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDailySummary, renderDailySummary } from "../lib/media-pipeline/daily-summary.mjs";

const AGORA = new Date("2026-09-05T18:00:00.000Z");

async function colecao(raiz, nome, { partes = 2, presets = ["flat-2d@1"], duracaoTotalMs = 120_000, colhida = true, tocadaEm = AGORA } = {}) {
  const root = path.join(raiz, nome);
  await mkdir(path.join(root, "metadados"), { recursive: true });
  if (colhida) {
    await writeFile(path.join(root, "metadados", `${nome}.colheita.json`), JSON.stringify({
      schema: "gerador-de-videos/receita-colhida@1",
      colecao: nome,
      resumo: { partes, presets, modelos: ["gemini-omni-flash-preview"], duracaoTotalMs },
      partes: [],
    }), "utf8");
  }
  await utimes(root, tocadaEm, tocadaEm);
  return root;
}

test("o resumo conta o que rodou na janela e ignora o que é mais velho", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "resumo-"));
  try {
    await colecao(raiz, "de-hoje", { partes: 3, duracaoTotalMs: 3_600_000 });
    await colecao(raiz, "de-ontem", { partes: 9, tocadaEm: new Date(AGORA.getTime() - 48 * 3_600_000) });
    const resumo = await buildDailySummary({ outputsRoot: raiz, desdeMs: 24 * 3_600_000, now: AGORA });
    assert.equal(resumo.readOnly, true);
    assert.equal(resumo.rodou.colecoes, 1);
    assert.equal(resumo.rodou.partes, 3);
    assert.equal(resumo.rodou.horasDeProducao, 1);
    assert.equal(resumo.rodou.producoes[0].colecao, "de-hoje");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("coleção sem colheita aparece nomeada, com o comando que resolve", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "resumo-sem-colheita-"));
  try {
    await colecao(raiz, "colhida", {});
    await colecao(raiz, "crua", { colhida: false });
    const resumo = await buildDailySummary({ outputsRoot: raiz, now: AGORA });
    assert.deepEqual(resumo.rodou.semColheita, ["crua"]);
    assert.match(renderDailySummary(resumo), /Sem colheita: 1 coleção\(ões\)\. Registre com: npm run video -- colher/);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("o que exige decisão humana vem dos journals, com o nó exato", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "resumo-atencao-"));
  try {
    const resumo = await buildDailySummary({
      outputsRoot: raiz,
      now: AGORA,
      relatorioDeJobs: {
        jobs: [
          { collection: "trailer/filme", stage: "video", journal: { status: "attention_required", attentionNodes: ["video:cena-3"], file: "j.sqlite" } },
          { collection: "tudo-certo", stage: "completed", journal: { status: "completed", attentionNodes: [] } },
        ],
      },
    });
    assert.equal(resumo.precisaDeVoce.length, 1);
    assert.equal(resumo.precisaDeVoce[0].colecao, "trailer/filme");
    assert.deepEqual(resumo.precisaDeVoce[0].nosEmAtencao, ["video:cena-3"]);
    // Dizer o que precisa de decisão não é tomá-la.
    assert.match(renderDailySummary(resumo), /Precisa de você: 1/);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("janela vazia diz que nada rodou em vez de mostrar tabela em branco", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "resumo-vazio-"));
  try {
    const texto = renderDailySummary(await buildDailySummary({ outputsRoot: raiz, now: AGORA }));
    assert.match(texto, /Nada rodou nesta janela\./);
    assert.match(texto, /Nada esperando decisão sua\./);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("raiz inexistente não derruba o resumo", async () => {
  const resumo = await buildDailySummary({ outputsRoot: path.join(os.tmpdir(), `nao-existe-${Date.now()}`), now: AGORA });
  assert.equal(resumo.rodou.colecoes, 0);
});
