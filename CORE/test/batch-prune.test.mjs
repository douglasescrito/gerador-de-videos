import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBatchJob,
  listBatchJobs,
  pruneBatchJobs,
  saveBatchJob,
} from "../lib/media-pipeline/omni-batch-runner.mjs";

const DIA = 86_400_000;

/** Um lote gravado com data e estado escolhidos, para a poda ter o que decidir. */
function gravarLote(stateDir, { collection, diasAtras, estadoDosItens }) {
  const job = createBatchJob({
    collection,
    items: estadoDosItens.map((_, indice) => ({ name: `item-${indice + 1}`, prompt: `Prompt ${indice + 1}` })),
    defaults: { aspectRatio: "16:9", mode: "raw" },
  });
  job.createdAt = new Date(Date.now() - diasAtras * DIA).toISOString();
  estadoDosItens.forEach((estado, indice) => { job.items[indice].state = estado; });
  saveBatchJob(stateDir, job);
  return job.id;
}

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "batch-prune-"));
}

test("poda leva o lote encerrado e antigo, e só ele", () => {
  const dir = pastaTemporaria();
  try {
    const encerrado = gravarLote(dir, { collection: "antigo-pronto", diasAtras: 60, estadoDosItens: ["completed", "completed"] });
    const recente = gravarLote(dir, { collection: "novo-pronto", diasAtras: 2, estadoDosItens: ["completed"] });
    const parado = gravarLote(dir, { collection: "antigo-parado", diasAtras: 60, estadoDosItens: ["completed", "pending"] });

    const relatorio = pruneBatchJobs(dir, { olderThanDays: 30, dryRun: false });
    assert.equal(relatorio.podados.length, 1);
    assert.equal(relatorio.podados[0].id, encerrado);

    const restantes = listBatchJobs(dir).map((j) => j.id).sort();
    assert.deepEqual(restantes, [recente, parado].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lote pendente nunca é podado, por mais velho que seja", () => {
  const dir = pastaTemporaria();
  try {
    gravarLote(dir, { collection: "esquecido", diasAtras: 900, estadoDosItens: ["pending", "pending"] });
    const relatorio = pruneBatchJobs(dir, { olderThanDays: 0, dryRun: false });
    assert.equal(relatorio.podados.length, 0);
    assert.equal(relatorio.mantidos.length, 1);
    assert.match(relatorio.mantidos[0].motivo, /pode ser retomado/);
    assert.equal(listBatchJobs(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run é o padrão e não apaga nada", () => {
  const dir = pastaTemporaria();
  try {
    gravarLote(dir, { collection: "antigo-pronto", diasAtras: 60, estadoDosItens: ["completed"] });
    const relatorio = pruneBatchJobs(dir, { olderThanDays: 30 });
    assert.equal(relatorio.dryRun, true);
    assert.equal(relatorio.podados.length, 1, "diz o que faria");
    assert.equal(listBatchJobs(dir).length, 1, "mas o arquivo continua lá");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a poda não chama provedor e recusa corte inválido", () => {
  const dir = pastaTemporaria();
  try {
    assert.equal(pruneBatchJobs(dir, {}).providerCalls, 0);
    assert.throws(() => pruneBatchJobs(dir, { olderThanDays: -1 }), /olderThanDays/);
    assert.throws(() => pruneBatchJobs(dir, { olderThanDays: "ontem" }), /olderThanDays/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pasta inexistente devolve relatório vazio em vez de estourar", () => {
  const relatorio = pruneBatchJobs(path.join(os.tmpdir(), "batch-prune-que-nao-existe"), { dryRun: false });
  assert.equal(relatorio.total, 0);
  assert.equal(relatorio.podados.length, 0);
});
