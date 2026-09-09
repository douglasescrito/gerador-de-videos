import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { createStudioBrief } from "../lib/media-pipeline/studio-context.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { handleRecipeCommand } from "../lib/cli/recipe-command-handler.mjs";
import { inspectMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";

const brief = (overrides = {}) => createStudioBrief({ briefId: "brief:teste", clientId: "client:teste", projectId: "project:teste", userBrief: "Apresentar o processo em três passos.", objective: "Explicar o processo", message: "Comece pelo essencial.", requiredText: ["Organize.", "Revise."], cta: "Experimente hoje.", durationSeconds: 30, format: "16:9", ...overrides });
const options = (overrides = {}) => ({ brief: brief(), rootScopeId: "client:teste", style: "flat-2d@1", ...overrides });

test("sugestão congela direção real, texto literal e 720 frames no compilador existente", () => {
  const input = options();
  const snapshot = structuredClone(input);
  const result = suggestMasterRecipeFromBrief(input);
  assert.deepEqual(suggestMasterRecipeFromBrief(input), result);
  assert.deepEqual(input, snapshot);
  const compiled = inspectMasterRecipe(JSON.stringify(result.recipe));
  assert.equal(compiled.executionPlan.timeline.durationFrames, 720);
  assert.equal(compiled.filmSpec.narration.mode, "none");
  assert.equal(compiled.filmSpec.music.mode, "none");
  for (const [index, composition] of result.evidence.compositions.entries()) {
    assert.equal(composition.directionPreset, "flat-2d@1");
    assert.equal(compiled.filmSpec.scenes[index].visualPrompt, composition.effectivePrompt);
  }
  const prompts = result.recipe.videoGeneration.shots.map(({ prompt }) => prompt).join("\n");
  for (const text of [input.brief.message, ...input.brief.requiredText, input.brief.cta]) assert.ok(prompts.includes(text));
  assert.equal(result.authority, "none");
  assert.equal(result.providerCalls, 0);
});

test("estruturas alteram cena e distribuição sem perder a soma exata de frames", () => {
  const linear = suggestMasterRecipeFromBrief(options());
  const list = suggestMasterRecipeFromBrief(options({ structure: "lista", brief: brief({ durationSeconds: 721 / 24 }) }));
  const reveal = suggestMasterRecipeFromBrief(options({ structure: "revelacao" }));
  assert.deepEqual(list.recipe.program.shots.map(({ id }) => id), ["item-1", "item-2", "item-3", "chamada"]);
  assert.equal(list.recipe.program.shots.reduce((sum, shot) => sum + shot.durationFrames, 0), 721);
  assert.notEqual(reveal.evidence.planFingerprint, linear.evidence.planFingerprint);
  assert.match(reveal.evidence.compositions[0].userPrompt, /preservado exatamente: \[\]/);
  assert.match(reveal.evidence.compositions[1].userPrompt, /Comece pelo essencial/);
});

test("sugestão recusa escopo divergente, hash adulterado, referência e técnica inválida", () => {
  assert.throws(() => suggestMasterRecipeFromBrief(options({ rootScopeId: "client:outro" })), /diverge/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ brief: { ...brief(), objective: "adulterado" } })), /hash/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ brief: brief({ references: ["asset:oficial"] }) })), /referências/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ techniques: [{ id: "inexistente@1" }] })), /técnica|Técnica/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ style: null })), /--style/);
});

test("brief editável converge no mesmo hash e recusa campos desconhecidos", () => {
  const { schema, hash, ...plain } = brief();
  assert.deepEqual(suggestMasterRecipeFromBrief(options({ brief: plain })), suggestMasterRecipeFromBrief(options()));
  assert.throws(() => suggestMasterRecipeFromBrief(options({ brief: { ...plain, durationSecond: 30 } })), /campo desconhecido/);
});

test("CLI suggest escreve receita pura e evidência; plan relê a receita sem adaptar formato", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-brief-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "brief.json");
  const out = path.join(root, "proposta.receita-v2.json");
  await writeFile(file, JSON.stringify(brief()));
  const cli = spawnSync(process.execPath, ["scripts/omni-cli.mjs", "recipe", "suggest", "--file", file, "--style", "flat-2d@1", "--structure", "lista", "--root-scope-id", "client:teste"], { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).evidence.structure, "lista");
  const messages = [];
  await handleRecipeCommand({ action: "suggest", file, out, style: "flat-2d@1", "root-scope-id": "client:teste" }, { stdout: (text) => messages.push(JSON.parse(text)) });
  const recipe = JSON.parse(await readFile(out, "utf8"));
  const evidence = JSON.parse(await readFile(`${out}.suggestion.json`, "utf8"));
  assert.equal(recipe.schema, "gerador-de-videos/receita@2");
  assert.deepEqual(evidence.recipe, recipe);
  await handleRecipeCommand({ action: "plan", file: out, "dry-run": true }, { stdout: (text) => messages.push(JSON.parse(text)) });
  assert.equal(messages.at(-1).executionPlan.fingerprint, evidence.evidence.planFingerprint);
  await assert.rejects(handleRecipeCommand({ action: "suggest", file, out, style: "flat-2d@1", "root-scope-id": "client:teste" }), /existe|sobrescrev/);
  const fromStdin = [];
  await handleRecipeCommand({ action: "suggest", stdin: true, style: "flat-2d@1", "root-scope-id": "client:teste" }, { stdin: Readable.from([JSON.stringify(brief())]), stdout: (text) => fromStdin.push(JSON.parse(text)) });
  assert.deepEqual(fromStdin[0].recipe, recipe);
});
