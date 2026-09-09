import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { selectRecipeInput } from "../lib/cli/recipe-input.mjs";
import { handleRecipeCommand } from "../lib/cli/recipe-command-handler.mjs";
import { createCliBootstrap } from "../lib/cli/bootstrap.mjs";
import { coreRoot, cliFile } from "./fixtures/cli-boundary-runtime.mjs";

const execute = promisify(execFile);
const flags = { action: "suggest", brief: "Explique como organizar três tarefas.", objective: "Ensinar um processo", audience: "Iniciantes", duration: "12", aspect: "16:9", "project-id": "project:teste", "root-scope-id": "client:teste", style: "flat-2d@1", "required-text": ["Organize", "Execute"], restriction: ["Sem promessas inventadas"], preference: ["Formas simples"], accessibility: ["Contraste legível"] };
async function invoke(options, stdin = Readable.from([])) {
  let result;
  await handleRecipeCommand(options, { stdin, stdout: (output) => { result = JSON.parse(output); } });
  return result;
}

test("texto, JSON, arquivo e stdin conservam brief, fatos e plano canônico", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const typed = await invoke(flags);
  const brief = typed.recipe.context.brief;
  assert.equal(brief.userBrief, flags.brief);
  assert.deepEqual(brief.requiredText, flags["required-text"]);
  assert.deepEqual(brief.preferences, flags.preference);
  assert.equal(brief.clientId, flags["root-scope-id"]);
  assert.equal(typed.inputChannel, "flags");
  assert.equal(typed.providerCalls, 0);
  assert.match(brief.briefId, /^brief-[a-f0-9]{24}$/);
  const file = path.join(root, "brief.json");
  await writeFile(file, JSON.stringify(brief, null, 2));
  for (const channel of [{ json: JSON.stringify(brief) }, { file }, { stdin: true }]) {
    const equivalent = await invoke({ action: "suggest", style: flags.style, "root-scope-id": flags["root-scope-id"], ...channel }, Readable.from([JSON.stringify(brief)]));
    assert.deepEqual(equivalent.recipe, typed.recipe);
    assert.deepEqual(equivalent.evidence, typed.evidence);
  }
  const plan = await invoke({ action: "plan", json: JSON.stringify(typed.recipe), "dry-run": "true" });
  assert.equal(plan.executionPlan.fingerprint, typed.evidence.planFingerprint);
  const changed = await invoke({ ...flags, objective: "Comparar caminhos" });
  assert.notEqual(changed.evidence.suggestionHash, typed.evidence.suggestionHash);
  assert.notEqual(changed.recipe.context.brief.briefId, brief.briefId);
  const explicit = await invoke({ ...flags, "brief-id": "pedido:humano" });
  assert.equal(explicit.recipe.context.brief.briefId, "pedido:humano");
});

test("canais conflitantes e parâmetros ausentes falham antes de ler arquivos ou stdin", async () => {
  const unreadable = { async *[Symbol.asyncIterator]() { assert.fail("stdin não deve ser lido"); } };
  for (const options of [
    { ...flags, file: "arquivo-inexistente" },
    { action: "plan", file: "arquivo-inexistente", stdin: true },
    { action: "validate", json: "{}", stdin: true },
    { action: "suggest", json: "{}", objective: "não sobrescrever JSON" },
  ]) await assert.rejects(invoke({ ...options, "knowledge-context": "contexto-inexistente" }, unreadable), /exatamente um canal/);
  assert.throws(() => selectRecipeInput({ ...flags, duration: undefined }), /--duration/);
  assert.throws(() => selectRecipeInput({ ...flags, aspect: "quadrado" }), /--aspect/);
  assert.throws(() => selectRecipeInput({ ...flags, duration: "NaN" }), /--duration/);
  assert.throws(() => selectRecipeInput({ ...flags, duration: "0.01" }), /--duration/);
  assert.throws(() => selectRecipeInput({ action: "plan", brief: "ignorado" }), /pertencem a recipe suggest/);
  assert.throws(() => selectRecipeInput({ action: "validate", json: "malformado" }), /JSON inválido/);
  assert.throws(() => selectRecipeInput({ action: "schema", json: "{}" }), /não recebe/);
  assert.equal(selectRecipeInput({ action: "validate", file: "receita.json", stdin: false }).channel, "file");
});

test("parser acumula listas declaradas e recusa substituição silenciosa de flags escalares", () => {
  const bootstrap = createCliBootstrap(["recipe"]);
  assert.deepEqual(bootstrap.parse(["--required-text", "A", "--required-text", "B", "--root", "um", "--root", "dois"]), { "required-text": ["A", "B"], root: ["um", "dois"] });
  assert.throws(() => bootstrap.parse(["--file", "um", "--file", "dois"]), /Opção repetida/);
  assert.throws(() => bootstrap.parse(["--brief", "A", "--brief", "B"]), /Opção repetida/);
});

test("entrada inline conserva a recusa canônica de chave duplicada", async () => {
  const golden = await readFile(new URL("../recipes/golden-30s.receita-v2.json", import.meta.url), "utf8");
  const duplicated = golden.replace('"revision": 1', '"revision": 1, "revision": 2');
  assert.notEqual(duplicated, golden);
  await assert.rejects(invoke({ action: "validate", json: duplicated }), /duplicad/i);
});

test("CLI público recebe texto e explica a receita sem sessão, adapter ou SQLite", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-flags-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = pathToFileURL(path.join(coreRoot, "test/fixtures/cli-query-isolation-loader.mjs")).href;
  const recipeFile = path.join(root, "pedido.receita-v2.json");
  const args = Object.entries(flags).flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).flatMap((value) => [`--${key}`, value]));
  const run = (args) => execute(process.execPath, ["--experimental-loader", loader, cliFile, "recipe", ...args], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  const output = await run([...args, "--out", recipeFile]);
  assert.equal(JSON.parse(output.stdout).inputChannel, "flags");
  const saved = JSON.parse(await readFile(recipeFile, "utf8"));
  assert.deepEqual(saved.context.brief.requiredText, ["Organize", "Execute"]);
  const explained = JSON.parse((await run(["explain", "--json", JSON.stringify(saved)])).stdout);
  assert.ok(explained.execution);
  assert.equal(explained.providerCalls, 0);
});

test("bootstrap recusa pedido incompleto antes de importar qualquer módulo do pipeline", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-early-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = path.join(root, "no-pipeline.mjs");
  await writeFile(loader, 'export async function resolve(s,c,n){const r=await n(s,c);if(r.url.includes("/lib/media-pipeline/"))throw Error("PIPELINE_IMPORTED");return r;}');
  await assert.rejects(execute(process.execPath, ["--experimental-loader", pathToFileURL(loader).href, cliFile, "recipe", "suggest", "--brief", "Pedido incompleto"], { cwd: root, encoding: "utf8", windowsHide: true }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--objective/);
    assert.doesNotMatch(error.stderr, /PIPELINE_IMPORTED/);
    assert.equal(JSON.parse(error.stderr.trim().split(/\r?\n/).at(-1)).code, "usage");
    return true;
  });
});
