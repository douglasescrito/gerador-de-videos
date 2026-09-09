import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRecipeAssetFixture } from "./fixtures/recipe-asset-fixture.mjs";
import { buildFilmAssemblyFilter } from "../lib/media-pipeline/film-assembly.mjs";
import {
  compileResolvedMasterRecipe,
  diffMasterRecipes,
  getMasterRecipeParameterCatalog,
  getMasterRecipeRegistries,
  inspectMasterRecipe,
  parseMasterRecipe,
  preflightMasterRecipeBytes,
  preflightResolvedMasterRecipe,
  resolveMasterRecipe,
} from "../lib/media-pipeline/master-recipe-v2.mjs";

const fixtureFile = path.resolve("recipes/golden-30s.receita-v2.5c.json");

test("vertical 2.5C compila edges, HTML, GC, QA, entrega e variantes", async (t) => {
  const { recipe, workspaceRoot } = await createRecipeAssetFixture(t, fixtureFile);
  for (const asset of recipe.assets) asset.rights = {providerInput:"allowed",reuse:"allowed"}; // synthetic in-memory case only
  const result = inspectMasterRecipe(JSON.stringify(recipe));
  const report = await preflightMasterRecipeBytes(result.resolved, { workspaceRoot });
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers.map(blocker => blocker.code).sort(), ["local-html-authorization-required", "local-post-authorization-required"], "logo e HTML legados sem registro governado não concedem prontidão de execução");
  assert.equal(result.executionPlan.timeline.durationFrames, 708);
  assert.equal(result.executionPlan.timeline.transition.type, "per-edge");
  assert.deepEqual(result.executionPlan.timeline.transition.edges.map((edge) => [edge.transitionId, edge.durationFrames]), [["dissolve@1", 12], ["cut@1", 0]]);
  const kinds = result.executionPlan.nodes.map((node) => node.kind);
  for (const kind of ["html-motion", "motion-graphics", "post-production", "qa", "delivery", "variant"]) assert.ok(kinds.includes(kind), kind);
  assert.deepEqual(result.executionPlan.nodes.filter(node => node.kind === "post-production").map(node => node.id), ["post:cor-master", "post:logo-master", "post:ending-master"]);
  assert.equal(result.executionPlan.nodes.filter((node) => node.kind === "variant").length, 1);
  assert.equal(result.executionPlan.spec.finishing.delivery.overwrite, false);
});

test("montagem por edge preserva cut e dissolve sem fallback", () => {
  const built = buildFilmAssemblyFilter({
    durations: [10, 10, 10],
    transitions: [{ transition: "dissolve", duration: 0.5 }, { transition: "cut", duration: 0 }],
    fps: 24,
  });
  assert.match(built.graph, /xfade=transition=dissolve:duration=0\.5/);
  assert.match(built.graph, /concat=n=2:v=1:a=0/);
  assert.equal(built.duration, 29.5);
  assert.throws(() => buildFilmAssemblyFilter({ durations: [10, 10], transitions: [{ transition: "inexistente", duration: 1 }] }), /Transição inválida/);
  assert.throws(() => buildFilmAssemblyFilter({ durations: [10, 10], transitions: [{ transition: "cut", duration: 1 }] }), /duração zero/);
});

test("transição inexistente e QA sem capability bloqueiam sem substituição", async () => {
  const recipe = JSON.parse(await readFile(fixtureFile, "utf8"));
  recipe.transitions.edges[0].transition = "magia@1";
  assert.throws(() => parseMasterRecipe(JSON.stringify(recipe)), /allowed values|enum/);
  recipe.transitions.edges[0].transition = "dissolve@1";
  const invalidHold = structuredClone(recipe);
  invalidHold.postProduction.operations.find(operation => operation.operation === "ending-hold@1").durationFrames = recipe.program.durationFrames + 1;
  assert.throws(() => parseMasterRecipe(JSON.stringify(invalidHold)), /timeline/);
  recipe.qa.semantic = true;
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const report = preflightResolvedMasterRecipe(resolved);
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((blocker) => blocker.code === "capability-semantic-qa-unproved"));
  assert.throws(() => compileResolvedMasterRecipe(resolved), /capability-semantic-qa-unproved/);
  assert.equal(resolved.recipe.qa.semantic, true);
});

test("parameter-catalog cobre todo pointer congelado com trace, consumidor e assertion", () => {
  const catalog = getMasterRecipeParameterCatalog();
  assert.equal(catalog.schema, "gerador-de-videos/parameter-catalog@1");
  assert.ok(catalog.parameters.length > 100);
  assert.ok(catalog.parameters.every((entry) => entry.pointer && entry.consumer && entry.trace === "resolutionTrace@1" && entry.assertion && entry.receipt));
  for (const pointer of ["/transitions/edges/*/transition", "/graphics/scenes/*/renderer", "/postProduction/operations/*/operation", "/qa/policy", "/delivery/target", "/variants/items/*/format"]) {
    assert.ok(catalog.parameters.some((entry) => entry.pointer === pointer), pointer);
  }
  const registries = getMasterRecipeRegistries();
  assert.equal(registries.transitions["dissolve@1"].ffmpeg, "dissolve");
  assert.equal(registries.graphicsRenderers["html-canvas@1"].consumer, "html-motion-pilot");
});

test("diff e export do CLI são provider-free", async () => {
  const source = await readFile(fixtureFile);
  const changed = JSON.parse(source.toString("utf8"));
  changed.graphics.scenes[1].text = "OUTRO TEXTO";
  const before = resolveMasterRecipe(parseMasterRecipe(source));
  const after = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(changed)));
  const diff = diffMasterRecipes(before, after);
  assert.equal(diff.providerCalls, 0);
  assert.deepEqual(diff.changes.map((change) => change.pointer), ["/graphics/scenes/1/text"]);
  const run = (args) => spawnSync(process.execPath, ["scripts/omni-cli.mjs", "recipe", ...args], { cwd: path.resolve("."), encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  for (const format of ["schema", "catalog", "registries", "bundle"]) {
    const result = run(["export", "--format", format]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  }
});

