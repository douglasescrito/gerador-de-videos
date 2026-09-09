import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createStudioBrief } from "../lib/media-pipeline/studio-context.mjs";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe, parseMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { handleRecipeCommand } from "../lib/cli/recipe-command-handler.mjs";

const execute = promisify(execFile);
function context(rootScopeId = "client:teste", rationale = "PRIVATE_CONTEXT_SENTINEL") {
  const body = { schema: "mkt-videos/knowledge-context@1", rootScopeId, releaseId: "release-a", releaseHash: "a".repeat(64), requestHash: "b".repeat(64),
    scope: { rootScopeId, scopeIds: [rootScopeId] }, appliedItems: [], excludedItems: [], conflicts: [], overrides: [],
    retrievalTraceId: `rt_${"c".repeat(32)}`, rankerVersion: "lexical-ranker@1", rationale, authority: "none", plannerInfluence: "none", contextId: `kc_${"d".repeat(32)}` };
  return { ...body, hash: operationFingerprint(body) };
}
function input() {
  const knowledgeContext = context();
  return { rootScopeId: "client:teste", style: "flat-2d@1", knowledgeContext,
    brief: createStudioBrief({ briefId: "brief:context", clientId: "client:teste", projectId: "project:teste", userBrief: "Explique o processo.", objective: "Explicar", audience: "Iniciantes", message: "Comece pelo essencial.", durationSeconds: 30, format: "16:9", knowledgeContextHash: knowledgeContext.hash }) };
}

test("receita guarda somente binding; plano congela o contexto exato sem influenciar prompts", () => {
  const source = input();
  const snapshot = structuredClone(source);
  const suggestion = suggestMasterRecipeFromBrief(source);
  assert.deepEqual(source, snapshot);
  assert.ok(!JSON.stringify(suggestion).includes("PRIVATE_CONTEXT_SENTINEL"));
  assert.equal(suggestion.recipe.context.knowledgeContextBinding.contextHash, source.knowledgeContext.hash);
  assert.equal(suggestion.recipe.context.knowledgeContext, undefined);
  const compiled = inspectMasterRecipe(JSON.stringify(suggestion.recipe), { knowledgeContext: source.knowledgeContext });
  assert.deepEqual(compiled.filmSpec.knowledgeContext, source.knowledgeContext);
  assert.deepEqual(compiled.executionPlan.spec.knowledgeContext, source.knowledgeContext);
  assert.equal(compiled.executionPlan.fingerprint, suggestion.evidence.planFingerprint);
  assert.equal(compiled.executionPlan.knowledgeContextBinding.plannerInfluence, "none");
});

test("contexto ausente, trocado, de outro root ou embutido no binding falha fechado", () => {
  const source = input();
  const suggestion = suggestMasterRecipeFromBrief(source);
  const bytes = JSON.stringify(suggestion.recipe);
  assert.throws(() => suggestMasterRecipeFromBrief({ ...source, knowledgeContext: null }), /materializado/);
  assert.throws(() => suggestMasterRecipeFromBrief({ ...source, knowledgeContext: context("client:outro") }), /root|hash/);
  assert.throws(() => inspectMasterRecipe(bytes), /materializado/);
  assert.throws(() => inspectMasterRecipe(bytes, { knowledgeContext: context("client:teste", "changed") }), /não corresponde/);
  const hidden = structuredClone(suggestion.recipe);
  hidden.context.knowledgeContextBinding.payload = source.knowledgeContext;
  assert.throws(() => parseMasterRecipe(JSON.stringify(hidden)), /Binding|binding|hash/);
});

test("CLI sugere receita privada, informa contexto faltante e compila com o arquivo separado", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = input();
  const briefFile = path.join(root, "brief.json");
  const contextFile = path.join(root, "context.json");
  const recipeFile = path.join(root, "recipe.json");
  await Promise.all([writeFile(briefFile, JSON.stringify(source.brief)), writeFile(contextFile, JSON.stringify({ context: source.knowledgeContext }))]);
  const invoke = (...args) => execute(process.execPath, ["scripts/omni-cli.mjs", ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_ENV: "test", MKT_VIDEOS_RUNTIME_DB: path.join(root, "runtime.sqlite") } });
  await invoke("recipe", "suggest", "--file", briefFile, "--root-scope-id", "client:teste", "--style", "flat-2d@1", "--knowledge-context", contextFile, "--out", recipeFile);
  for (const file of [recipeFile, `${recipeFile}.suggestion.json`]) assert.ok(!(await readFile(file, "utf8")).includes("PRIVATE_CONTEXT_SENTINEL"));
  let explanation;
  await handleRecipeCommand({ action: "explain", file: recipeFile }, { stdout: (value) => { explanation = JSON.parse(value); } });
  assert.equal(explanation.execution, null);
  assert.ok(explanation.blockers.some((row) => row.code === "knowledge-context-required"));
  const { stdout } = await invoke("compile", "--spec", recipeFile, "--knowledge-context", contextFile, "--eta-root", path.join(root, "receipts"));
  assert.deepEqual(JSON.parse(stdout).spec.knowledgeContext, source.knowledgeContext);
});
