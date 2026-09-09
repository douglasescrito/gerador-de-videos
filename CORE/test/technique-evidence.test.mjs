import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { agulhaDoBloco, medirEvidenciaDeTecnicas } from "../lib/media-pipeline/technique-evidence.mjs";
import { listProductionTechniques } from "../lib/media-pipeline/prompt-techniques.mjs";
import { recordProductionTechniques } from "../lib/media-pipeline/production-technique-usage.mjs";

test("uso estruturado não duplica o mesmo bloco textual; receita registra procedimento", () => {
  const technique = listProductionTechniques().find((t) => t.id === "clean-final-frame@1");
  const usage = recordProductionTechniques({ uses: [{ id: "style-method-separation@1", values: { styleRef: "suspensao@1", invariants: ["native-text"] } }] });
  const raiz = pastaComRecibos({
    "clip.receipt.json": { prompt: technique.block, metadata: { promptComposition: { techniques: [{ id: technique.id }, { id: technique.id }] } } },
    "episode.receita.json": { techniqueUsage: usage },
  });
  try {
    const report = medirEvidenciaDeTecnicas({ raiz });
    const line = report.tecnicas.find((t) => t.id === technique.id);
    assert.equal(line.total, 1);
    assert.equal(line.textual, 0);
    assert.equal(report.tecnicas.find((t) => t.id === "style-method-separation@1").estruturado, 1);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

function pastaComRecibos(recibos) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "technique-evidence-"));
  for (const [nome, corpo] of Object.entries(recibos)) {
    const destino = path.join(raiz, nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, JSON.stringify(corpo, null, 2));
  }
  return raiz;
}

test("a agulha é o maior trecho literal, ignorando os buracos de template", () => {
  assert.equal(agulhaDoBloco("curto {{x}} outro"), null, "nada com 40 caracteres não vira agulha");
  const bloco = "{{a}} Esta é a frase longa e literal que sobrevive à substituição de template. {{b}} curta";
  assert.equal(agulhaDoBloco(bloco), "Esta é a frase longa e literal que sobrevive à substituição de template.");
});

test("separa técnica selecionada de bloco copiado no prompt", () => {
  const tecnica = listProductionTechniques().find((t) => agulhaDoBloco(t.block));
  const agulha = agulhaDoBloco(tecnica.block);
  const raiz = pastaComRecibos({
    "a/selecionada.mp4.receipt.json": {
      effectivePrompt: "qualquer coisa",
      metadata: { promptComposition: { directionPreset: "flat-2d@1", techniques: [{ id: tecnica.id }] } },
    },
    "b/copiada.mp4.receipt.json": { effectivePrompt: `Prompt cru com o bloco colado: ${agulha} e mais texto.` },
    "c/nenhuma.mp4.receipt.json": { effectivePrompt: "Prompt sem técnica nenhuma." },
  });
  try {
    const r = medirEvidenciaDeTecnicas({ raiz });
    const linha = r.tecnicas.find((t) => t.id === tecnica.id);
    assert.equal(linha.estruturado, 1);
    assert.equal(linha.textual, 1);
    assert.equal(linha.total, 2);
    assert.equal(r.resumo.usosEstruturados, 1);
    assert.equal(r.resumo.usosTextuais, 1);
    assert.equal(r.recibosLidos, 3);
    assert.equal(r.providerCalls, 0);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("id fora do catálogo é reportado, não somado calado", () => {
  const raiz = pastaComRecibos({
    "x.mp4.receipt.json": {
      effectivePrompt: "p",
      metadata: { promptComposition: { techniques: [{ id: "tecnica-que-nao-existe@7" }] } },
    },
  });
  try {
    const r = medirEvidenciaDeTecnicas({ raiz });
    assert.deepEqual(r.resumo.idsForaDoCatalogo, [{ id: "tecnica-que-nao-existe@7", recibos: 1 }]);
    assert.equal(r.resumo.usosEstruturados, 0);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("recibo ilegível não derruba a medição", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "technique-evidence-"));
  try {
    fs.writeFileSync(path.join(raiz, "torto.mp4.receipt.json"), "{ não é json");
    fs.writeFileSync(path.join(raiz, "bom.mp4.receipt.json"), JSON.stringify({ effectivePrompt: "ok" }));
    const r = medirEvidenciaDeTecnicas({ raiz });
    assert.equal(r.recibosLidos, 1);
    assert.equal(r.recibosComPrompt, 1);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("pasta vazia devolve todas as técnicas com zero, sem inventar uso", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "technique-evidence-"));
  try {
    const r = medirEvidenciaDeTecnicas({ raiz });
    assert.equal(r.recibosLidos, 0);
    assert.equal(r.tecnicas.length, listProductionTechniques().length);
    assert.equal(r.resumo.semNenhumUso.length, r.tecnicas.length);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
