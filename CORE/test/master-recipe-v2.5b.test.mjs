import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRecipeAssetFixture } from "./fixtures/recipe-asset-fixture.mjs";
import { validateDraftSpec } from "../lib/media-pipeline/draft-workflow.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { activateCapabilityCandidate, createCapabilityCandidate, mergeActivatedCapabilities, proveCapabilityCandidate } from "../lib/media-pipeline/capability-lifecycle.mjs";
import { PROVIDER_CAPABILITIES } from "../lib/media-pipeline/provider-registry.mjs";
import {
  compileResolvedMasterRecipe,
  inspectMasterRecipe,
  parseMasterRecipe,
  preflightMasterRecipeBytes,
  preflightResolvedMasterRecipe,
  resolveMasterRecipe,
} from "../lib/media-pipeline/master-recipe-v2.mjs";

const fixtureFile = path.resolve("recipes/golden-30s.receita-v2.5b.json");
const hash = (body) => createHash("sha256").update(body).digest("hex");

test("vertical 2.5B planeja voz, Flow, Whisper e referencias sem fingir medição", async (t) => {
  const { recipe, workspaceRoot } = await createRecipeAssetFixture(t, fixtureFile);
  authorizeSyntheticRecipe(recipe);
  const result = inspectMasterRecipe(JSON.stringify(recipe), { channel: "file" });
  const report = await preflightMasterRecipeBytes(result.resolved, { workspaceRoot });
  assert.equal(result.providerCalls, 0);
  assert.equal(report.status, "ready");
  assert.equal(report.providerCalls, 0);
  assert.equal(result.resolved.vertical, "2.5B");
  assert.equal(result.executionPlan.timeline.durationFrames, 720);
  assert.equal(result.executionPlan.timeline.tracks.find((track) => track.id === "voice").durationFrames, null);
  assert.equal(result.executionPlan.timeline.tracks.find((track) => track.id === "music").durationFrames, null);
  assert.equal(result.resolved.recipe.narration.timing.status, "planned-not-measured");
  assert.equal(result.resolved.recipe.alignment.timing.status, "planned-not-measured");
  assert.deepEqual(result.filmSpec.scenes[0].references, []);
  assert.equal(result.filmSpec.scenes[0].generationTask, "text_to_video");
  assert.equal(result.filmSpec.scenes[1].references[0].source.locator, "PESSOAS/apresentador.png");
  assert.equal(result.filmSpec.scenes[1].references[0].role, "person-reference");
});

test("corpus executavel preserva FIRST_FRAME, role e source em todas as tasks comprovadas", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-25b-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bodies = {
    "first.png": Buffer.from("first-frame"),
    "reference.png": Buffer.from("reference-image"),
    "source.mp4": Buffer.from("reference-video"),
  };
  for (const [name, body] of Object.entries(bodies)) await writeFile(path.join(root, name), body);
  const recipe = authorizeSyntheticRecipe(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.cast.people = [];
  recipe.assets = [
    asset("first", "image", "first-frame", "first.png", "image/png", bodies["first.png"]),
    asset("reference", "image", "reference-image", "reference.png", "image/png", bodies["reference.png"]),
    asset("source-video", "video", "reference-video", "source.mp4", "video/mp4", bodies["source.mp4"]),
  ];
  recipe.program.durationFrames = 720;
  recipe.program.shots = ["text", "first-frame", "reference", "edit"].map((id) => ({ id, durationFrames: 180 }));
  recipe.videoGeneration.shots = [
    { shotId: "text", task: "text-to-video", prompt: "motion sem pessoa", inputAssetIds: [], castIds: [] },
    { shotId: "first-frame", task: "image-to-video", prompt: "animar desde o primeiro frame", inputAssetIds: ["first"], castIds: [] },
    { shotId: "reference", task: "reference-to-video", prompt: "usar referencia", inputAssetIds: ["reference"], castIds: [] },
    { shotId: "edit", task: "edit-video", prompt: "editar o video", inputAssetIds: ["source-video"], castIds: [] },
  ];
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const report = await preflightMasterRecipeBytes(resolved, { workspaceRoot: root });
  assert.equal(report.status, "ready", JSON.stringify(report.blockers));
  const compiled = compileResolvedMasterRecipe(resolved);
  assert.deepEqual(compiled.filmSpec.scenes.map((scene) => scene.generationTask), ["text_to_video", "image_to_video", "reference_to_video", "edit"]);
  assert.equal(compiled.filmSpec.scenes[1].references[0].role, "first-frame");
  assert.deepEqual(compiled.filmSpec.scenes[1].references[0].source, { kind: "workspace", locator: "first.png" });
  assert.equal(compiled.filmSpec.scenes[3].references[0].role, "reference-video");
  const legacy = adaptExecutionPlanToLegacy(compiled.executionPlan);
  const executorSpec = validateDraftSpec(legacy, { specFile: path.join(root, "execution-plan.json") });
  assert.deepEqual(executorSpec.scenes.map((scene) => scene.generationTask), ["text_to_video", "image_to_video", "reference_to_video", "edit"]);
});

test("end-frame e multi-voz são representaveis, bloqueados e nunca recebem fallback", async () => {
  const recipe = authorizeSyntheticRecipe(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.videoGeneration.shots[0].task = "end-frame";
  recipe.narration.speakerMode = "multi-voice";
  recipe.narration.speakers = [{ id: "narrador", voice: "Nyla" }, { id: "especialista", voice: "Charon" }];
  recipe.narration.blocks.push({ id: "especialista-1", text: "Uma segunda voz.", speakerId: "especialista" });
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const preflight = preflightResolvedMasterRecipe(resolved);
  assert.equal(preflight.status, "blocked");
  assert.deepEqual(preflight.blockers.map((item) => item.code).sort(), ["capability-end-frame-unproved", "capability-multi-voice-unproved"]);
  assert.throws(() => compileResolvedMasterRecipe(resolved), /capability-end-frame-unproved, capability-multi-voice-unproved/);
  assert.equal(resolved.recipe.videoGeneration.shots[0].task, "end-frame");
  assert.equal(resolved.recipe.narration.speakerMode, "multi-voice");
});

test("preflight falha fechado para rights, bytes e capability sem prova", async (t) => {
  const { recipe, workspaceRoot } = await createRecipeAssetFixture(t, fixtureFile);
  authorizeSyntheticRecipe(recipe);
  recipe.assets[0].rights.providerInput = "unknown";
  recipe.assets[0].bytes++;
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const capabilities = structuredClone(Object.fromEntries([]));
  const report = await preflightMasterRecipeBytes(resolved, { capabilities, workspaceRoot });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((item) => item.code === "provider-input-rights-not-allowed"));
  assert.ok(report.blockers.some((item) => item.code === "capability-not-ready"));
  assert.ok(report.blockers.some((item) => item.code === "asset-bytes-diverged"));
});

test("multi-voz só compila após prova, replay e promoção humana", async () => {
  const recipe = authorizeSyntheticRecipe(JSON.parse(await readFile(fixtureFile, "utf8")));
  recipe.narration.speakerMode = "multi-voice";
  recipe.narration.speakers = [{ id: "narrador", voice: "Nyla" }, { id: "especialista", voice: "Charon" }];
  recipe.narration.blocks.push({ id: "especialista-1", text: "Uma segunda voz.", speakerId: "especialista" });
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe)));
  const candidate = createCapabilityCandidate({ id: "google-vids-multi-voice", adapterProvider: "google-vids", intents: ["narration.generate.segmented-multi-voice"], operations: ["segmented-text-to-speech"], authContract: "cookie-only-browser-session", reconcile: true, limitation: "prova", actor: "human", now: new Date("2026-08-13T12:00:00Z") });
  const proof = proveCapabilityCandidate({ candidate, expectedCandidateHash: candidate.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0, replayHash: "b".repeat(64) }, liveEvidence: [{ id: "live:multi-voice", sha256: "a".repeat(64) }], actor: "auditor", now: new Date("2026-08-13T12:10:00Z") });
  const activation = activateCapabilityCandidate({ candidate, proof, expectedProofHash: proof.proofHash, confirmHuman: true, actor: "human", now: new Date("2026-08-13T12:20:00Z") });
  const capabilities = mergeActivatedCapabilities(PROVIDER_CAPABILITIES, [activation], { now: new Date("2026-08-13T12:30:00Z") });
  assert.equal(preflightResolvedMasterRecipe(resolved, { capabilities }).status, "ready");
  const compiled = compileResolvedMasterRecipe(resolved, { capabilities });
  assert.equal(compiled.filmSpec.narration.provider, "google-vids");
  assert.equal(compiled.filmSpec.narration.speakers.length, 2);
  assert.ok(compiled.filmSpec.source.capabilityIntents.some((entry) => entry.capabilityId === "google-vids-multi-voice"));
  assert.deepEqual(
    compiled.executionPlan.nodes.filter((node) => node.kind === "tts").map((node) => node.id),
    compiled.filmSpec.narration.blocks.map((block) => `voice:${block.id}`),
  );
  assert.equal(compiled.executionPlan.nodes.find((node) => node.id === "voice-master").costClass, "local");
});

function asset(id, mediaKind, role, locator, mimeType, body) {
  return {
    id,
    mediaKind,
    role,
    source: { kind: "workspace", locator },
    bytes: body.length,
    sha256: hash(body),
    mimeType,
    rights: { providerInput: "allowed", reuse: "allowed" },
    authorization: { mode: "direct-confirmation", bindingHash: "b".repeat(64) },
  };
}

// Only in-memory synthetic test cases receive allowed rights. Public examples
// remain unknown; this helper never writes them or calls a provider.
function authorizeSyntheticRecipe(recipe) {
  for (const entry of recipe.assets) {
    entry.rights = {providerInput:'allowed',reuse:'allowed'};
    entry.authorization = {mode:'direct-confirmation',bindingHash:'b'.repeat(64)};
  }
  return recipe;
}

test('public example retains unknown rights and remains blocked', async t => {
  const {recipe,workspaceRoot}=await createRecipeAssetFixture(t,fixtureFile);
  assert.ok(recipe.assets.every(entry=>entry.rights.providerInput==='unknown'));
  const report=await preflightMasterRecipeBytes(resolveMasterRecipe(parseMasterRecipe(JSON.stringify(recipe))),{workspaceRoot});
  assert.equal(report.status,'blocked');
  assert.ok(report.blockers.some(entry=>entry.code==='provider-input-rights-not-allowed'));
});
