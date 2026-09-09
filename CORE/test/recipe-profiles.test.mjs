import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listRecipeProfiles } from "../lib/media-pipeline/recipe-profiles.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { explainRecipeExecution } from "../lib/media-pipeline/recipe-plan-explanation.mjs";
import { cliFile, runNode } from "./fixtures/cli-boundary-runtime.mjs";

const brief = { briefId: "profile:test", userBrief: "Encaixe as peças.", objective: "Mostrar o processo fornecido.", requiredText: ["Encaixe", "Confira"], durationSeconds: 6, format: "16:9", projectId: "project:teste", clientId: "client:teste" };
const stories = {
  "produto@1": { problem: "Peças separadas.", demonstration: ["Encaixe a peça A em B."], benefit: "Peças conectadas." },
  "educacional@1": { outcome: "Peças conectadas.", steps: ["Alinhe as peças.", "Faça o encaixe."] },
  "documental@1": { context: "Montagem de duas peças.", observations: ["A peça A tem um encaixe."], conclusion: "As duas peças se conectam." },
};
const suggest = (profile, extra = {}) => suggestMasterRecipeFromBrief({ brief, rootScopeId: "client:teste", profile, story: stories[profile] ?? {}, ...extra });

test("perfis publicados expandem escolhas compatíveis e compilam sem serem resolvidos pelo runtime", () => {
  const catalog = listRecipeProfiles();
  assert.equal(catalog.length, 7);
  for (const profile of catalog) {
    const candidate = suggest(profile.id);
    assert.deepEqual(suggest(profile.id), candidate, profile.id);
    const { executionPlan, filmSpec } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
    assert.equal(executionPlan.fingerprint, candidate.evidence.planFingerprint);
    assert.equal(executionPlan.spec.styleComposition.composition.styleId, profile.style);
    assert.equal(candidate.recipe.context.brief.userBrief, brief.userBrief);
    assert.equal(candidate.evidence.profile.profile.hash, profile.hash);
    assert.equal(candidate.evidence.structure, profile.structure);
    assert.equal(candidate.evidence.profile.profile.authority, "none");
    assert.equal(candidate.evidence.profile.profile.evidence, "instruction-only");
    assert.equal(filmSpec.narration.mode, "none");
    assert.equal(filmSpec.music.mode, "none");
    assert.deepEqual(explainRecipeExecution(executionPlan).styleComposition, candidate.recipe.context.styleComposition);
    assert.equal(candidate.recipe.mix != null, Object.hasOwn(profile.modules, "mix"));
    if (profile.modules.mix) assert.equal(executionPlan.spec.finishing.audio.sceneAudioGainDb, -10);
  }
  catalog[0].components.material = "unknown@1";
  catalog[0].modules.mix.sceneAudioGainDb = 20;
  assert.equal(listRecipeProfiles()[0].components.material, "solid-vector@1");
  assert.equal(listRecipeProfiles()[0].modules.mix.sceneAudioGainDb, -10);
});

test("perfil recusa fatos ausentes e conflitos e registra substituições explícitas", () => {
  for (const profile of Object.keys(stories)) assert.throws(() => suggest(profile, { story: {} }), /story|exige/);
  assert.throws(() => suggest("missing@1"), /recipe profiles/);
  assert.throws(() => suggest("editorial@1", { style: "flat-2d@1" }), /diverge/);
  assert.throws(() => suggest("editorial@1", { components: { material: "solid-vector@1" } }), /não é compatível/);
  assert.throws(() => suggest("editorial@1", { modules: [] }), /deve ser objeto/);
  const changed = suggest("motion-2d@1", { structure: "revelacao", components: { rhythm: "measured@1" }, modules: { mix: null } });
  assert.equal(changed.evidence.structure, "revelacao");
  assert.equal(changed.recipe.mix, null);
  assert.equal(changed.evidence.profile.overrides.components.rhythm, "measured@1");
  assert.equal(changed.evidence.profile.overrides.modules.mix, null);
  assert.notEqual(changed.evidence.suggestionHash, suggest("motion-2d@1").evidence.suggestionHash);
});

test("híbrido vincula texto ao renderer local e ao caminho de montagem, sem prometer HTML ou sincronia", () => {
  const result = suggest("hibrido@1");
  const { executionPlan, filmSpec } = inspectMasterRecipe(JSON.stringify(result.recipe));
  assert.equal(result.recipe.vertical, "2.5C");
  assert.deepEqual(result.recipe.graphics.scenes.map((scene) => scene.text), brief.requiredText);
  assert.equal(filmSpec.scenes[0].textRendering, "local-gc");
  assert.equal(filmSpec.scenes[2].textRendering, "none");
  assert.ok(executionPlan.nodes.some((node) => node.id === "motion:abertura"));
  assert.ok(!executionPlan.nodes.some((node) => node.kind === "html-motion"));
  assert.ok(executionPlan.nodes.find((node) => node.id === "clip-duration:abertura").dependencies.includes("motion:abertura"));
  assert.ok(executionPlan.nodes.find((node) => node.id === "qa-scene:abertura").dependencies.includes("clip-duration:abertura"));
  assert.ok(executionPlan.nodes.find((node) => node.id === "assembly").dependencies.includes("qa-scene:abertura"));
  assert.match(result.recipe.videoGeneration.shots[0].prompt, /Não desenhar letras/);
  assert.doesNotMatch(result.recipe.videoGeneration.shots[0].prompt, /Texto gráfico em tela, preservado exatamente/);
  assert.throws(() => suggest("hibrido@1", { brief: { ...brief, requiredText: [] } }), /exige message, requiredText ou cta/);
  assert.throws(() => suggest("hibrido@1", { components: { typography: "editorial-labels@1" } }), /exige typography/);
  assert.throws(() => suggest("hibrido@1", { modules: { graphics: null } }), /materializa graphics/);
  assert.throws(() => suggest("editorial@1", { modules: { graphics: { module: "scene-graphics@1", scenes: [{ shotId: "abertura", renderer: "local-gc@1", text: "Troca silenciosa", documentAssetId: null }] } } }), /diverge do texto obrigatório/);
});

test("CLI lista perfis, aceita pedido por flags sem --style e explica a mesma receita materializada", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-profile-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invoke = async (args) => {
    const result = await runNode([cliFile, "recipe", ...args], { cwd: root, name: "profiles", isolate: true });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const catalog = await invoke(["profiles"]);
  assert.deepEqual(catalog.profiles, listRecipeProfiles());
  const file = path.join(root, "recipe.json");
  const result = await invoke(["suggest", "--brief", brief.userBrief, "--objective", brief.objective, "--duration", "6", "--aspect", "16:9", "--project-id", brief.projectId, "--root-scope-id", brief.clientId, "--required-text", "Encaixe", "--profile", "hibrido@1", "--out", file]);
  assert.equal(result.profile.profile.id, "hibrido@1");
  const recipe = JSON.parse(await readFile(file, "utf8"));
  assert.equal(recipe.context.brief.userBrief, brief.userBrief);
  const explained = await invoke(["explain", "--file", file]);
  assert.equal(explained.execution.planFingerprint, result.hashes.planFingerprint);
  assert.equal(explained.execution.nodes.find((node) => node.id === "motion:abertura").kind, "motion-graphics");
  const invalid = await runNode([cliFile, "recipe", "profiles", "--profile", "editorial@1"], { cwd: root, name: "invalid-profile", isolate: true });
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /pertence a recipe suggest/);
});
