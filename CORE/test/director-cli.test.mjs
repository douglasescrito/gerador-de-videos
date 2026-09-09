import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const coreRoot = path.resolve(import.meta.dirname, "..");
function cli(args) {
  return spawnSync(process.execPath, [path.join(coreRoot, "scripts", "omni-cli.mjs"), ...args], { cwd: coreRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
}

test("CLI director registra, congela contexto e valida sem provider", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "director-cli-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = path.join(root, "knowledge.sqlite");
  const prefs = path.join(root, "archive.sqlite");
  const missingCatalog = path.join(root, "missing-catalog.sqlite");
  const outputs = path.join(root, "outputs");
  await mkdir(outputs, { recursive: true });
  const profile = {
    schema: "mkt-videos/client-director-profile@1", clientId: "cliente", clientName: "Cliente", projectId: "campanha", projectName: "Campanha", directorName: "Diretor", status: "active", cadenceMinutes: 30, outputCollection: "cliente",
    brand: { positioning: "marca moderna", palette: ["azul", "branco"], logoPolicy: "assinatura final", forbiddenTerms: [], requiredClosing: "Cliente" },
    creative: { primaryStyle: "flat-2d@1", allowedStyles: ["flat-2d@1"], advertisingArchetypes: ["manifesto", "demonstracao"], narrationModes: ["entrecortada", "continua"], transitionTechniques: ["shape-continuity-transition@1"], motionTechniqueIds: ["semantic-hero-type@1"], motionCombinationIds: ["clean-product-story@1"], motionBankSha256: "a".repeat(64), visualPrinciples: ["limpo"], avoid: ["3D"], sceneCount: 2, sceneDurationSeconds: 10 },
    audio: { narrationProvider: "google-vids", preferredVoice: "Nyla", whisperModel: "small", textAuthority: "approved-script-only", timestampAuthority: "whisper-measured-only", allowIntercutNarration: true, musicProvider: "flow-music", fadeOutSeconds: 0 },
    feedback: { videoLikes: "append-only", recipeLikes: "append-only", automaticPromotion: false, influence: "suggestion-only" }, governance: { humanApprovalRequired: true, rawModeInfluence: "none", providerCallsDuringPlanning: 0 },
  };
  const profileFile = path.join(root, "profile.json");
  await writeFile(profileFile, JSON.stringify(profile));
  const registered = cli(["director", "--action", "register", "--input", profileFile, "--db", db, "--confirm-human", "true"]);
  assert.equal(registered.status, 0, registered.stderr);
  const contextRun = cli(["director", "--action", "context", "--client", "cliente", "--project", "campanha", "--db", db, "--preferences-db", prefs, "--desktop-catalog", missingCatalog, "--outputs-root", outputs]);
  assert.equal(contextRun.status, 0, contextRun.stderr);
  const directorContext = JSON.parse(contextRun.stdout);
  const catalogRun = cli(["director", "--action", "catalog", "--root-scope-id", "client:cliente", "--db", db, "--preferences-db", prefs, "--desktop-catalog", missingCatalog, "--outputs-root", outputs]);
  assert.equal(catalogRun.status, 0, catalogRun.stderr);
  const directorCatalog = JSON.parse(catalogRun.stdout);
  assert.deepEqual(directorCatalog.directors.map((entry) => entry.profile.projectId), ["campanha"]);
  const brief = { schema: "mkt-videos/director-brief@1", clientId: "cliente", projectId: "campanha", profileFingerprint: directorContext.profileFingerprint, marketingObjective: "marca", audience: "adultos", promise: "clareza", hook: "pergunta", callToAction: "conheça", advertisingArchetype: "manifesto", narrationMode: "entrecortada", motionTechniqueIds: ["semantic-hero-type@1"], transitionTechniques: ["shape-continuity-transition@1"], novelty: { thesis: "t", arc: "a", keyVisual: "k", aestheticTerritory: "e", motionMechanism: "m", composition: "c", soundResolution: "s" } };
  const recipe = { schema: "gerador-de-videos/receita@1", id: "cli-director", label: "CLI Director", kind: "filme", aspect: "16:9", style: "flat-2d@1", collection: "cliente", targetDurationSeconds: 20, scenes: [
    { id: "s1", duration: 10, prompt: "flat 2D", generationTask: "text_to_video", narrationBlockId: "b1", onScreenText: "CLAREZA" },
    { id: "s2", duration: 10, prompt: "logo", generationTask: "reference_to_video", narrationBlockId: "b2", references: [{ source: "assets", relPath: "logo.png", role: "reference-image" }] },
  ], audio: { narration: { provider: "google-vids", documentUrl: "https://docs.google.com/videos/d/test/edit", voice: "Nyla", sync: "whisper-word-timestamps", text: "Uma ideia. Cliente.", blocks: [{ id: "b1", text: "Uma ideia." }, { id: "b2", text: "Cliente." }] }, music: true, musicPreset: "institucional", musicDurationSeconds: 20, musicFadeOutSeconds: 0 }, workflow: { narrationTextAuthority: "approved-script-only", narrationTimestampAuthority: "whisper-measured-only", authorizationMode: "production-once", completionMode: "complete", automaticRetry: true, retryPolicy: "bounded-reconciled@1", maxAttempts: 2, automaticCorrections: true, humanReview: false } };
  const briefFile = path.join(root, "brief.json"); const recipeFile = path.join(root, "recipe.json");
  await writeFile(briefFile, JSON.stringify(brief)); await writeFile(recipeFile, JSON.stringify(recipe));
  const validation = cli(["director", "--action", "validate", "--client", "cliente", "--project", "campanha", "--db", db, "--preferences-db", prefs, "--desktop-catalog", missingCatalog, "--outputs-root", outputs, "--brief", briefFile, "--recipe", recipeFile]);
  assert.equal(validation.status, 0, validation.stderr);
  const result = JSON.parse(validation.stdout);
  assert.equal(result.valid, true);
  assert.equal(result.boundaries.providerCalls, 0);
  assert.equal(result.boundaries.generationTriggered, false);
});
