import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { cliFile, runNode } from "./fixtures/cli-boundary-runtime.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-result-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invoke = (args, isolate = false) => runNode([cliFile, ...args], { cwd: root, name: "output", isolate });
  return { root, invoke };
}

test("formato inválido é erro de uso antes de contexto pesado ou arquivos de produção", async (t) => {
  const { invoke } = await fixture(t);
  for (const command of ["run", "resume", "status", "jobs", "recipe"]) {
    const result = await invoke([command, "--output-format", "xml"], true);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--output-format deve ser json ou text/);
    assert.equal(JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1)).code, "usage");
    assert.doesNotMatch(result.stderr, /CLI_QUERY_HEAVY_IMPORT_FORBIDDEN/);
  }
  const unsupported = await invoke(["recipe", "export", "--output-format", "text"], true);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /pertence a recipe suggest/);
});

test("status, handoff e jobs preservam JSON e oferecem resumo sem alterar estado", async (t) => {
  const { root, invoke } = await fixture(t);
  const planned = await planFilm({ spec: { name: "teste-saida", scenes: [{ id: "abertura", prompt: "Esfera azul" }], qa: false }, outputsRoot: path.join(root, "outputs") });
  const stateFile = planned.state.stateFile;
  const before = await readFile(stateFile);
  const args = ["status", "--state", stateFile];
  const legacy = await invoke(args);
  const machine = await invoke([...args, "--output-format", "json"]);
  assert.equal(legacy.code, 0, legacy.stderr);
  assert.equal(machine.stdout, legacy.stdout, "JSON padrão continua idêntico ao formato explícito");
  const status = JSON.parse(machine.stdout);
  assert.equal(status.schema, "mkt-videos/film-status@1");
  const human = await invoke([...args, "--output-format", "text"]);
  assert.equal(human.code, 0, human.stderr);
  assert.ok(human.stdout.includes(`Estado: ${status.status}`));
  assert.match(human.stdout, /Etapas concluídas: 0\//);
  assert.ok(human.stdout.split(/\r?\n/).length < 20);
  const handoff = await invoke([...args, "--handoff", "true", "--output-format", "text"]);
  assert.equal(handoff.code, 0, handoff.stderr);
  assert.match(handoff.stdout, /Próxima operação: inspect/);
  const jobs = await invoke(["jobs", "--root", path.join(root, "outputs"), "--runtime-db", path.join(root, "missing-runtime.sqlite"), "--output-format", "text"]);
  assert.equal(jobs.code, 0, jobs.stderr);
  assert.match(jobs.stdout, /Produções: 1/);
  assert.match(jobs.stdout, /Próxima ação:/);
  assert.deepEqual(await readFile(stateFile), before);
});

test("receita em texto mantém arquivos JSON e o plano público relê a mesma proposta", async (t) => {
  const { root, invoke } = await fixture(t);
  const file = path.join(root, "recipe.json");
  const suggested = await invoke(["recipe", "suggest", "--brief", "Mostre o encaixe.", "--objective", "Ensinar a montagem.", "--duration", "6", "--aspect", "16:9", "--project-id", "project:teste", "--root-scope-id", "client:teste", "--profile", "motion-2d@1", "--out", file, "--output-format", "text"], true);
  assert.equal(suggested.code, 0, suggested.stderr);
  assert.match(suggested.stdout, /Estado: candidate/);
  assert.match(suggested.stdout, /Autoridade de execução: not-checked/);
  assert.ok(suggested.stdout.includes(file));
  const recipeBytes = await readFile(file);
  assert.equal(JSON.parse(recipeBytes).schema, "gerador-de-videos/receita@2");
  const evidence = JSON.parse(await readFile(`${file}.suggestion.json`, "utf8"));
  for (const action of ["validate", "explain", "preflight", "plan"]) {
    const args = ["recipe", action, "--file", file, ...(action === "plan" ? ["--dry-run", "true"] : [])];
    const human = await invoke([...args, "--output-format", "text"], true);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /Detalhes completos: --output-format json/);
    assert.ok(human.stdout.split(/\r?\n/).length < 25);
    if (["plan", "explain"].includes(action)) assert.ok(human.stdout.includes(evidence.evidence.planFingerprint));
  }
  const planned = await invoke(["recipe", "plan", "--file", file, "--dry-run", "true", "--output-format", "json"], true);
  assert.equal(planned.code, 0, planned.stderr);
  assert.equal(JSON.parse(planned.stdout).executionPlan.fingerprint, evidence.evidence.planFingerprint);
  const preflightFile = path.join(root, "preflight.json");
  const saved = await invoke(["recipe", "preflight", "--file", file, "--out", preflightFile, "--output-format", "text"], true);
  assert.equal(saved.code, 0, saved.stderr);
  const preflight = JSON.parse(await readFile(preflightFile, "utf8"));
  assert.ok(saved.stdout.includes(`Estado: ${preflight.status}`));
  assert.ok(saved.stdout.includes(`Bloqueios: ${preflight.blockers.length}`));
  assert.deepEqual(await readFile(file), recipeBytes);
});
