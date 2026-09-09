import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composeDirection, listStyleSpecs } from "../lib/media-pipeline/direction-presets.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { compileMasterRecipeProductions, inspectMasterRecipe, parseMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { createStudioBrief } from "../lib/media-pipeline/studio-context.mjs";
import { bindStyleComposition } from "../lib/media-pipeline/style-controls.mjs";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import { explainRecipeExecution } from "../lib/media-pipeline/recipe-plan-explanation.mjs";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";
import { cliFile, runNode } from "./fixtures/cli-boundary-runtime.mjs";

const components = { material: "solid-vector@1", typography: "kinetic-words@1", composition: "swiss-grid@1", camera: "orthographic@1", movement: "shape-morph@1", rhythm: "stepwise@1", audio: "graphic-sfx@1" };
const brief = { briefId: "composition:test", userBrief: "Explique o encaixe das peças.", objective: "Ensinar o processo.", requiredText: ["Encaixe", "Confira"], durationSeconds: 12, format: "16:9", projectId: "project:teste", clientId: "client:teste" };
const suggest = (extra = {}) => suggestMasterRecipeFromBrief({ brief, rootScopeId: "client:teste", style: "flat-2d@1", components, ...extra });

test("componentes preservam literal, ordenam dimensões e mantêm evidência separada do lifecycle", () => {
  const literal = "Preserve estas palavras e a geometria.";
  const first = composeDirection({ userPrompt: literal, style: "flat-2d@1", components });
  const permuted = composeDirection({ userPrompt: literal, style: "flat-2d@1", components: Object.fromEntries(Object.entries(components).reverse()) });
  assert.deepEqual(first, permuted);
  assert.equal(first.userPrompt, literal);
  assert.ok(first.effectivePrompt.includes(literal));
  assert.equal(first.styleComposition.evidence, "instruction-only");
  assert.deepEqual(first.styleComposition.selected.map((entry) => entry.dimension), Object.keys(components));
  const style = listStyleSpecs().find((entry) => entry.id === "flat-2d@1");
  assert.equal(style.status, "pilot");
  assert.equal(style.compositionControls.evidence, "instruction-only");
  style.compositionControls.dimensions.material[0].instruction = "mutação externa";
  assert.deepEqual(composeDirection({ userPrompt: literal, style: "flat-2d@1", components }), first);
  assert.equal(composeDirection({ userPrompt: literal }).effectivePrompt, literal);
  assert.throws(() => composeDirection({ userPrompt: literal, components }), /modo studio/);
});

test("conflitos com estilo, técnica e texto obrigatório falham antes da proposta", () => {
  assert.throws(() => suggest({ components: { material: "watercolor-grain@1" } }), /não é compatível/);
  assert.throws(() => suggest({ style: "logo-fiel@1" }), /não é compatível|referências obrigatórias/);
  assert.throws(() => suggest({ components: { unknown: "x@1" } }), /Dimensão/);
  assert.throws(() => suggest({ components: {} }), /ao menos uma/);
  assert.throws(() => suggest({ components: { typography: "none@1" } }), /texto gráfico obrigatório/);
  assert.throws(() => suggest({ components: { material: "paper-cut@1" }, techniques: ["render-check-flat@1"] }), /incompatível com a técnica/);
  const watercolor = suggest({ style: "aquarela-2d@1", components: { material: "watercolor-grain@1", movement: "sequential-reveal@1", rhythm: "measured@1" } });
  assert.ok(watercolor.recipe.videoGeneration.shots.every((shot) => shot.prompt.includes("watercolor pigment")));
});

test("a mesma composição fica congelada na receita, no explain e na fachada de execução", () => {
  const candidate = suggest();
  const { executionPlan, filmSpec } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  const binding = candidate.recipe.context.styleComposition;
  assert.equal(binding.authority, "none");
  assert.equal(binding.briefHash, candidate.evidence.briefHash);
  assert.deepEqual(executionPlan.spec.styleComposition, binding);
  assert.equal(executionPlan.governance.style.id, "flat-2d@1");
  assert.equal(executionPlan.governance.style.status, "pilot");
  assert.equal(executionPlan.governance.promptComposition[0].visual.effectivePrompt, filmSpec.scenes[0].visualPrompt);
  assert.equal(executionPlan.governance.promptComposition[0].compositionBindingHash, binding.hash);
  assert.deepEqual(explainRecipeExecution(executionPlan).styleComposition, binding);
  const facade = adaptExecutionPlanToLegacy(executionPlan);
  assert.deepEqual(validateFilmSpec(facade, { executionPlan }).styleComposition, binding);
  assert.equal(executionPlan.spec.narration.mode, "none");
  assert.equal(executionPlan.spec.music.mode, "none");
  assert.ok(executionPlan.nodes.filter((node) => node.kind === "video").every((node) => node.parameters.scene.visualPrompt.includes("modular Swiss grid")));
  assert.equal(compileFilmSpec(filmSpec).fingerprint, executionPlan.fingerprint);
});

test("troca ou omissão de instrução, movimento e escopo não atravessa o vínculo congelado", () => {
  const candidate = suggest();
  const changed = structuredClone(candidate.recipe);
  changed.videoGeneration.shots[0].prompt += " Alteração posterior.";
  assert.throws(() => parseMasterRecipe(JSON.stringify(changed)), /styleComposition diverge/);
  const declared = structuredClone(candidate.recipe);
  declared.context.styleComposition.authority = "execute";
  assert.throws(() => parseMasterRecipe(JSON.stringify(declared)), /autoridade/);
  const scope = structuredClone(candidate.recipe);
  scope.context.styleComposition.rootScopeId = "client:outro";
  assert.throws(() => parseMasterRecipe(JSON.stringify(scope)), /styleComposition diverge/);
  const unknown = structuredClone(candidate.recipe);
  unknown.context.styleComposition.hidden = true;
  assert.throws(() => parseMasterRecipe(JSON.stringify(unknown)), /campos ausentes ou desconhecidos/);
  const relabeled = structuredClone(candidate.recipe);
  const other = relabeled.context.styleComposition;
  other.composition.styleId = "aquarela-2d@1";
  const { hash: _compositionHash, ...compositionBody } = other.composition;
  other.composition.hash = operationFingerprint(compositionBody);
  const { hash: _bindingHash, ...bindingBody } = other;
  other.hash = operationFingerprint(bindingBody);
  assert.throws(() => parseMasterRecipe(JSON.stringify(relabeled)), /incompatível com o estilo/);
  const missing = structuredClone(candidate.recipe);
  missing.videoGeneration.shots[0].prompt = "A instrução foi removida.";
  const binding = missing.context.styleComposition;
  binding.prompts[0].hash = operationFingerprint(missing.videoGeneration.shots[0].prompt);
  const { hash: _hash, ...body } = binding;
  binding.hash = operationFingerprint(body);
  assert.throws(() => parseMasterRecipe(JSON.stringify(missing)), /omite instrução/);
  const { executionPlan, filmSpec } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  filmSpec.scenes[0].motionPrompt += " Modificação.";
  assert.throws(() => compileFilmSpec(filmSpec), /movimento idênticos/);
  const facade = adaptExecutionPlanToLegacy(executionPlan);
  facade.scenes[0].motionPrompt += " Modificação.";
  assert.throws(() => validateFilmSpec(facade, { executionPlan }), /movimento idênticos/);
  delete facade.styleComposition;
  assert.throws(() => validateFilmSpec(facade, { executionPlan }), /vínculo idêntico/);
});

test("CLI lista componentes e sugere/explana a receita sem carregar runtime ou adapter", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "style-controls-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compositionFile = path.join(root, "composition.json");
  const output = path.join(root, "composed.receita-v2.json");
  await writeFile(compositionFile, JSON.stringify(components));
  const invoke = async (args) => {
    const result = await runNode([cliFile, ...args], { cwd: root, name: "composition", isolate: true });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const catalog = await invoke(["styles", "--format", "json"]);
  assert.ok(catalog.styles.find((style) => style.id === "flat-2d@1").compositionControls.dimensions.material.some((entry) => entry.id === components.material));
  await invoke(["recipe", "suggest", "--json", JSON.stringify(brief), "--root-scope-id", "client:teste", "--style", "flat-2d@1", "--composition-file", compositionFile, "--out", output]);
  const saved = JSON.parse(await readFile(output, "utf8"));
  const explained = await invoke(["recipe", "explain", "--file", output]);
  assert.equal(explained.execution.styleComposition.hash, saved.context.styleComposition.hash);
  assert.equal(explained.providerCalls, 0);
});


// So a copia em memoria deste teste recebe direitos. Os exemplos publicos
// continuam com rights unknown no disco; o helper nunca grava nem chama
// provedor. Sem isso o preflight bloqueia, que e o comportamento correto.
function autorizarCopiaSintetica(recipe) {
  for (const entry of recipe.assets ?? []) {
    entry.rights = { providerInput: "allowed", reuse: "allowed" };
    entry.authorization = { mode: "direct-confirmation", bindingHash: "b".repeat(64) };
  }
  return recipe;
}

test("composição atravessa as quatro verticais e congela overrides explícitos por linha do lote", async () => {
  for (const suffix of ["v2", "v2.5b", "v2.5c", "v2.5d"]) {
    const recipe = JSON.parse(await readFile(new URL(`../recipes/golden-${suffix === "v2.5d" ? 180 : 30}s.receita-${suffix}.json`, import.meta.url), "utf8"));
    autorizarCopiaSintetica(recipe);
    const frozenBrief = createStudioBrief({ ...brief, projectId: recipe.scope.projectScopeId, clientId: recipe.scope.rootScopeId });
    let composition;
    for (const shot of recipe.videoGeneration.shots) {
      const result = composeDirection({ userPrompt: shot.prompt, style: "flat-2d@1", components: { composition: "single-focus@1" } });
      shot.prompt = result.effectivePrompt;
      composition = result.styleComposition;
    }
    recipe.context = { brief: frozenBrief, styleComposition: bindStyleComposition({ composition, briefHash: frozenBrief.hash, scope: recipe.scope, shots: recipe.videoGeneration.shots }) };
    const ordinary = inspectMasterRecipe(JSON.stringify(recipe));
    assert.equal(ordinary.executionPlan.spec.styleComposition.hash, recipe.context.styleComposition.hash);
    if (suffix !== "v2.5d") continue;
    recipe.kind = "lote";
    recipe.executionPolicy.maxChildren = 2;
    const shot = recipe.videoGeneration.shots[0];
    recipe.batch = { module: "explicit-batch@1", rows: [
      { id: "a", name: "Peça A", promptOverrides: [{ shotId: shot.shotId, prompt: shot.prompt + " Variação A." }] },
      { id: "b", name: "Peça B", promptOverrides: [{ shotId: shot.shotId, prompt: shot.prompt + " Variação B." }] },
    ] };
    const resolved = inspectMasterRecipe(JSON.stringify(recipe)).resolved;
    const first = compileMasterRecipeProductions(resolved);
    assert.deepEqual(first, compileMasterRecipeProductions(resolved));
    assert.equal(new Set(first.productions.map((item) => item.executionPlan.spec.styleComposition.hash)).size, 2);
    assert.ok(first.productions.every((item) => item.executionPlan.spec.styleComposition.composition.hash === composition.hash));
    recipe.batch.rows[0].promptOverrides[0].prompt = "Override que omite os componentes.";
    assert.throws(() => compileMasterRecipeProductions(inspectMasterRecipe(JSON.stringify(recipe)).resolved), /omite instrução/);
  }
});
