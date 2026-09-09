import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HARVESTED_RECIPE_SCHEMA,
  buildHarvestedRecipe,
  harvestOutputsRoot,
  writeHarvestedRecipe,
} from "../lib/media-pipeline/recipe-harvest.mjs";

function recibo({ cena, prompt, preset = "flat-2d@1", tarefa = "text_to_video", inicio, fim, arquivo }) {
  return {
    schema: "mkt-videos/receipt@1",
    id: `receipt:sha256:${cena}`,
    operation: "generate-video",
    provider: "gemini-omni-product-studio-playwright",
    model: "gemini-omni-flash-preview",
    status: "completed",
    prompt,
    parameters: { task: tarefa, aspectRatio: "16:9" },
    artifacts: [{ mimeType: "video/mp4", path: arquivo, bytes: 1024, hash: { algorithm: "sha256", value: "a".repeat(64) } }],
    metadata: { batchId: cena, promptComposition: { userPrompt: `pedido de ${cena}`, effectivePrompt: prompt, directionPreset: preset } },
    startedAt: inicio,
    completedAt: fim,
  };
}

async function colecaoDeTeste(raiz, nome, recibos) {
  const root = path.join(raiz, nome);
  const recibosDir = path.join(root, "recibos");
  await mkdir(recibosDir, { recursive: true });
  for (const entrada of recibos) {
    await writeFile(path.join(recibosDir, `${entrada.metadata.batchId}.mp4.receipt.json`), JSON.stringify(entrada), "utf8");
  }
  return root;
}

test("a colheita guarda o que de fato rodou, por parte", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-"));
  try {
    const root = await colecaoDeTeste(raiz, "peca-boa", [
      recibo({ cena: "01-abertura", prompt: "flat 2D wide shot", inicio: "2026-09-05T10:00:00.000Z", fim: "2026-09-05T10:01:00.000Z", arquivo: "01-abertura.mp4" }),
      recibo({ cena: "02-fecho", prompt: "logo reveal", preset: "logo-fiel@1", tarefa: "reference_to_video", inicio: "2026-09-05T10:02:00.000Z", fim: "2026-09-05T10:03:30.000Z", arquivo: "02-fecho.mp4" }),
    ]);
    const receita = await buildHarvestedRecipe({ root });
    assert.equal(receita.schema, HARVESTED_RECIPE_SCHEMA);
    assert.equal(receita.colecao, "peca-boa");
    assert.equal(receita.resumo.partes, 2);
    assert.deepEqual(receita.resumo.presets, ["flat-2d@1", "logo-fiel@1"]);
    assert.deepEqual(receita.resumo.tarefas, ["reference_to_video", "text_to_video"]);

    // O tempo de parede vem de startedAt/completedAt, que todo recibo tem —
    // por isso a pergunta "quanto custou" passa a ter resposta no acervo
    // inteiro, e não só nos 6% que carregam timing detalhado.
    assert.equal(receita.resumo.duracaoTotalMs, 150_000);
    assert.equal(receita.resumo.duracaoMediaMs, 75_000);
    assert.equal(receita.resumo.partesComDuracao, 2);

    // O que permite variar e repetir: o prompt efetivo e o pedido original.
    const abertura = receita.partes.find((parte) => parte.cena === "01-abertura");
    assert.equal(abertura.prompt, "flat 2D wide shot");
    assert.equal(abertura.promptDoUsuario, "pedido de 01-abertura");
    assert.equal(abertura.preset, "flat-2d@1");
    assert.match(abertura.sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("colher é idempotente: roda a cada fechamento sem virar erro", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-idem-"));
  try {
    const root = await colecaoDeTeste(raiz, "repetida", [
      recibo({ cena: "01", prompt: "p", inicio: "2026-09-05T10:00:00.000Z", fim: "2026-09-05T10:00:30.000Z", arquivo: "01.mp4" }),
    ]);
    const primeira = await writeHarvestedRecipe({ root, name: "repetida" });
    assert.equal(path.basename(primeira.file), "repetida.colheita.json");
    const segunda = await writeHarvestedRecipe({ root, name: "repetida" });
    assert.equal(segunda.file, primeira.file);
    const gravada = JSON.parse(await readFile(segunda.file, "utf8"));
    assert.equal(gravada.resumo.partes, 1);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("coleção sem recibo não vira arquivo vazio", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-vazia-"));
  try {
    await mkdir(path.join(raiz, "sem-nada"), { recursive: true });
    assert.equal(await writeHarvestedRecipe({ root: path.join(raiz, "sem-nada") }), null);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("recibo ilegível é registrado sem derrubar a colheita", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-quebrada-"));
  try {
    const root = await colecaoDeTeste(raiz, "meio-quebrada", [
      recibo({ cena: "01", prompt: "p", inicio: "2026-09-05T10:00:00.000Z", fim: "2026-09-05T10:00:30.000Z", arquivo: "01.mp4" }),
    ]);
    await writeFile(path.join(root, "recibos", "corrompido.receipt.json"), "{ isto não é json", "utf8");
    const receita = await buildHarvestedRecipe({ root });
    assert.equal(receita.resumo.partes, 1);
    assert.equal(receita.recibosIlegiveis.length, 1);
    assert.match(receita.recibosIlegiveis[0].arquivo, /corrompido/);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("o backfill percorre a raiz inteira e conta o que colheu", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-raiz-"));
  try {
    await colecaoDeTeste(raiz, "uma", [recibo({ cena: "01", prompt: "p", inicio: "2026-09-05T10:00:00.000Z", fim: "2026-09-05T10:00:10.000Z", arquivo: "01.mp4" })]);
    await colecaoDeTeste(raiz, "outra", [recibo({ cena: "01", prompt: "q", inicio: "2026-09-05T11:00:00.000Z", fim: "2026-09-05T11:00:20.000Z", arquivo: "01.mp4" })]);
    await mkdir(path.join(raiz, "sem-recibo"), { recursive: true });
    const resultado = await harvestOutputsRoot({ root: raiz });
    assert.equal(resultado.colhidas, 2);
    assert.equal(resultado.vazias, 1);
    assert.deepEqual(resultado.falhas, []);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("a colheita não é a receita autoral e não a sobrescreve", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "colheita-autoral-"));
  try {
    const root = await colecaoDeTeste(raiz, "com-direcao", [
      recibo({ cena: "01", prompt: "p", inicio: "2026-09-05T10:00:00.000Z", fim: "2026-09-05T10:00:30.000Z", arquivo: "01.mp4" }),
    ]);
    // A série grava a direção autoral com este nome. A colheita usa outro.
    const autoral = path.join(root, "metadados", "com-direcao.receita.json");
    await mkdir(path.dirname(autoral), { recursive: true });
    await writeFile(autoral, JSON.stringify({ escrita: "à mão" }), "utf8");
    const colhida = await writeHarvestedRecipe({ root, name: "com-direcao" });
    assert.notEqual(colhida.file, autoral);
    assert.deepEqual(JSON.parse(await readFile(autoral, "utf8")), { escrita: "à mão" });
  } finally { await rm(raiz, { recursive: true, force: true }); }
});
