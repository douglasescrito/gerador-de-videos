// Comando `rodada`: um voo por schedule. Fecha o vão em que dois disparos —
// ou duas conversas — materializavam duas coleções para a mesma rodada. O
// schedule-controller já existia, com teste próprio e nenhum chamador em
// produção; aqui ele ganha porta de entrada e prova de ponta a ponta.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const cli = path.resolve("scripts/omni-cli.mjs");
let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "rodada-cli-test-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function rodada(args, dbFile) {
  const resultado = spawnSync(process.execPath, [cli, "rodada", ...args, "--runtime-db", dbFile], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
  return { ...resultado, json: resultado.stdout ? JSON.parse(resultado.stdout) : null };
}

test("a mesma rodada só voa uma vez; a segunda chamada acompanha a primeira", async () => {
  const dbFile = path.join(root, "um-voo.sqlite");
  const primeira = rodada(["--action", "reivindicar", "--schedule", "gerador-em-cena", "--producao", "colecao-a"], dbFile);
  assert.equal(primeira.status, 0, primeira.stderr);
  assert.equal(primeira.json.status, "claimed");
  assert.equal(primeira.json.admission.status, "ready");
  assert.equal(primeira.json.cycle.productionId, "colecao-a");
  assert.match(primeira.json.cycle.recipeHash, /^[a-f0-9]{64}$/);

  // Outra conversa pede a mesma rodada com outra coleção: tem de ser
  // recusada E receber a identificação do voo em andamento.
  const segunda = rodada(["--action", "reivindicar", "--schedule", "gerador-em-cena", "--producao", "colecao-b"], dbFile);
  assert.equal(segunda.json.status, "blocked");
  assert.deepEqual(segunda.json.blockers, ["production_already_in_flight"]);
  assert.equal(segunda.json.cycle.productionId, "colecao-a");
  assert.equal(segunda.json.cycle.cycleKey, primeira.json.cycle.cycleKey);
  assert.match(segunda.stderr, /Acompanhe a execução existente/);
});

test("o ciclo percorre reivindicar → iniciar → concluir com o token do dono", async () => {
  const dbFile = path.join(root, "ciclo.sqlite");
  const claim = rodada(["--action", "reivindicar", "--schedule", "s-ciclo", "--producao", "p1"], dbFile);
  const { cycleKey } = claim.json.cycle;
  const dono = claim.json.dono;
  assert.match(dono, /^[0-9a-f-]{36}$/);

  const iniciada = rodada(["--action", "iniciar", "--ciclo", cycleKey, "--dono", dono], dbFile);
  assert.equal(iniciada.json.status, "running");
  const concluida = rodada(["--action", "concluir", "--ciclo", cycleKey, "--dono", dono], dbFile);
  assert.equal(concluida.json.status, "completed");
});

test("sem o token do dono ninguém mexe no ciclo de outro processo", async () => {
  const dbFile = path.join(root, "dono.sqlite");
  const claim = rodada(["--action", "reivindicar", "--schedule", "s-dono", "--producao", "p1"], dbFile);
  const intruso = rodada(["--action", "iniciar", "--ciclo", claim.json.cycle.cycleKey, "--dono", "00000000-0000-4000-8000-000000000000"], dbFile);
  assert.notEqual(intruso.status, 0);
  assert.match(intruso.stderr, /pertence a outro lease de scheduler/);
});

test("status é somente leitura e não inventa ciclo", async () => {
  const dbFile = path.join(root, "status.sqlite");
  rodada(["--action", "reivindicar", "--schedule", "s-status", "--producao", "p1"], dbFile);
  const status = rodada(["--action", "status"], dbFile);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.readOnly, true);
  assert.equal(status.json.schedules.total, 1);
  assert.equal(status.json.schedules.states.claimed, 1);
});

test("--action desconhecida falha nomeando as válidas", async () => {
  const dbFile = path.join(root, "invalida.sqlite");
  const resultado = rodada(["--action", "voar"], dbFile);
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /--action inválida: voar/);
});
