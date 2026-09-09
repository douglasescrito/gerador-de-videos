import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRecipeAssetFixture } from "./fixtures/recipe-asset-fixture.mjs";
import {
  compileMasterRecipeProductions,
  inspectMasterRecipe,
  parseMasterRecipe,
  preflightMasterRecipeBytes,
  resolveMasterRecipe,
} from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { inventoryRecipeDocuments, upcastLegacyRecipeBytes } from "../lib/media-pipeline/legacy-recipe-migration.mjs";

const fixtureFile = path.resolve("recipes/golden-180s.receita-v2.5d.json");

test("golden de 180 s separa duração do master do limite por clipe", async (t) => {
  const { recipe, workspaceRoot } = await createRecipeAssetFixture(t, fixtureFile);
  syntheticRights(recipe);
  const result = inspectMasterRecipe(JSON.stringify(recipe));
  const report = await preflightMasterRecipeBytes(result.resolved, { workspaceRoot });
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers.map(blocker => [blocker.code, blocker.assetId]), [["local-html-authorization-required", "html-grafico"]], "HTML legado exige contexto governado sem alterar os limites de duração");
  assert.equal(result.resolved.recipe.kind, "filme");
  assert.equal(result.resolved.derived.durationSeconds, 180);
  assert.equal(result.executionPlan.timeline.durationFrames, 4320);
  assert.equal(result.filmSpec.music.durationSeconds, 120);
  assert.deepEqual(result.filmSpec.workflow, {
    authorizationMode: "production-once",
    humanReview: false,
    completionMode: "complete",
    automaticCorrections: true,
    maxAttempts: 3,
  });
  assert.equal(result.executionPlan.timeline.tracks[0].spans.length, 18);
  assert.ok(result.executionPlan.timeline.tracks[0].spans.every((span) => span.durationFrames <= result.resolved.recipe.executionPolicy.maxClipFrames));
  assert.equal(result.executionPlan.nodes.filter((node) => node.id.startsWith("clip-duration:")).length, 18);
  const legacy = adaptExecutionPlanToLegacy(result.executionPlan);
  assert.equal(legacy.qa.expectedDuration, 180);
  assert.equal(legacy.qa.expectedFrames, 4320);
  assert.equal(legacy.assembly.sceneFrameTargets.length, 18);
  assert.equal(legacy.assembly.expectedMasterFrames, 4320);
});

test("receita mestre preserva pedido explícito de revisão humana", async () => {
  const recipe = syntheticRights(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.workflow = { humanReview: true };
  const result = inspectMasterRecipe(Buffer.from(JSON.stringify(recipe)));
  assert.deepEqual(result.filmSpec.workflow, {
    authorizationMode: "per-invocation",
    humanReview: true,
    completionMode: "pause-for-review",
    automaticCorrections: true,
    maxAttempts: 3,
  });
  assert.ok(result.executionPlan.nodes.some((node) => node.kind === "human-approval"));
});

test("clip que ultrapassa capability falha antes do plano", async () => {
  const recipe = syntheticRights(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.program.shots[0].durationFrames = 241;
  recipe.program.shots[1].durationFrames = 239;
  assert.throws(() => parseMasterRecipe(JSON.stringify(recipe)), /ultrapassa maxClipFrames 240/);
});

test("lote cria lock, plano e journal idempotentes por linha no mesmo root", async () => {
  const recipe = syntheticRights(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.kind = "lote";
  recipe.identity.id = "golden-lote";
  recipe.executionPolicy.failurePolicy = "continue";
  recipe.executionPolicy.partialSuccess = "allow";
  recipe.executionPolicy.maxChildren = 2;
  recipe.batch = {
    module: "explicit-batch@1",
    rows: [
      { id: "linha-a", name: "Filme A", promptOverrides: [{ shotId: "scene-01", prompt: "Abertura A" }] },
      { id: "linha-b", name: "Filme B", promptOverrides: [{ shotId: "scene-01", prompt: "Abertura B" }] },
    ],
  };
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const first = compileMasterRecipeProductions(resolved);
  const second = compileMasterRecipeProductions(resolved);
  assert.deepEqual(first, second);
  assert.equal(first.productions.length, 2);
  assert.ok(first.productions.every((production) => production.rootScopeId === recipe.scope.rootScopeId));
  assert.equal(new Set(first.productions.map((production) => production.lockHash)).size, 2);
  assert.equal(new Set(first.productions.map((production) => production.journalId)).size, 2);
  assert.notEqual(first.productions[0].planFingerprint, first.productions[1].planFingerprint);
  assert.equal(first.providerCalls, 0);
});

test("reader puro upcasta receita@1 visual e bloqueia narração ambígua", () => {
  const visual = Buffer.from(JSON.stringify({
    schema: "gerador-de-videos/receita@1", id: "legado-visual", label: "Legado visual", kind: "filme", aspect: "16:9", collection: "legado",
    scenes: [{ id: "a", prompt: "Formas abstratas em movimento.", duration: 10 }, { id: "b", prompt: "Luz e cor em movimento.", duration: 10 }],
    assembly: { fps: 24 },
  }));
  const before = Buffer.from(visual);
  const report = upcastLegacyRecipeBytes(visual);
  assert.equal(report.status, "upcast-equivalente");
  assert.equal(report.recipe.program.durationFrames, 480);
  assert.equal(report.providerCalls, 0);
  assert.deepEqual(visual, before);
  const narration = JSON.parse(visual.toString("utf8"));
  narration.narration = { provider: "omni", text: "Texto legado" };
  const blocked = upcastLegacyRecipeBytes(JSON.stringify(narration));
  assert.equal(blocked.status, "legado-bloqueado");
  assert.match(blocked.reason, /conversão silenciosa.*proibida/i);
  const bundle = upcastLegacyRecipeBytes(JSON.stringify({ schema: "mkt-videos/recipe-variety@1", recipes: [] }));
  assert.equal(bundle.status, "legado-bloqueado");
});

test("inventário deriva schema, papel e hash do filesystem sem contagem fixa", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "legacy.json"), JSON.stringify({ schema: "gerador-de-videos/receita@1", scenes: [] }));
  await writeFile(path.join(root, "bundle.json"), JSON.stringify({ schema: "mkt-videos/recipe-variety@1", recipes: [] }));
  await writeFile(path.join(root, "broken.json"), "{");
  const inventory = await inventoryRecipeDocuments({ roots: [root] });
  assert.equal(inventory.count, 3);
  assert.deepEqual(inventory.entries.map((entry) => entry.role).sort(), ["autoria-legada", "bundle-propostas", "json-invalido"]);
  assert.ok(inventory.entries.every((entry) => /^[a-f0-9]{64}$/u.test(entry.contentHash)));
  assert.equal(inventory.providerCalls, 0);
});

// Test-only in-memory rights; public examples and files remain unchanged.
function syntheticRights(recipe) {
 for(const asset of recipe.assets) asset.rights={providerInput:'allowed',reuse:'allowed'};
 return recipe;
}
