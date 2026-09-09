import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe, preflightMasterRecipeBytes } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm, validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { applyFilmPostOperation } from "../lib/media-pipeline/film-post-production.mjs";
import { finishVideo } from "../lib/media-pipeline/delivery-profile.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { probeMedia, runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";
import { withLocalAssetRuntime } from "../lib/cli/local-asset-runtime.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";

test("receita executa pós-produção ordenada, retoma após revogação e entrega master com áudio intacto", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-post-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "scene.mp4"), logo = path.join(root, "logo.png");
  await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  await runFfmpeg(["-f", "lavfi", "-i", "color=red:size=16x16", "-frames:v", "1", logo]);
  const originals = await Promise.all([sha256File(source), sha256File(logo)]);
  const governed = await governedLocalAssetFixture({ root, file: logo, mediaKind: "image", mediaType: "image/png", role: "logo" });
  const golden = JSON.parse(await readFile(new URL("../recipes/golden-30s.receita-v2.5b.json", import.meta.url), "utf8"));
  const operations = [
    { id: "color", operation: "color-normalize@1", assetId: null, durationFrames: null },
    { id: "logo", operation: "logo-overlay@1", assetId: governed.asset.id, durationFrames: null },
    { id: "hold", operation: "ending-hold@1", assetId: null, durationFrames: 24 },
  ];
  const proposed = suggestMasterRecipeFromBrief({ rootScopeId: governed.context.rootScopeId, style: "flat-2d@1", modules: {
    assets: [governed.asset], mix: { ...golden.mix, sceneAudioGainDb: 0 }, postProduction: { module: "ffmpeg-post@1", operations },
  }, brief: { briefId: "post:test", userBrief: "Geometria com logo e fechamento estável.", objective: "Mostrar a identidade.", durationSeconds: 3, format: "16:9", clientId: "client:teste", projectId: "project:teste" } });
  const compiled = inspectMasterRecipe(JSON.stringify(proposed.recipe));
  const { executionPlan } = compiled;
  const postNodes = executionPlan.nodes.filter(node => node.kind === "post-production");
  assert.deepEqual(postNodes.map(node => node.id), ["post:color", "post:logo", "post:hold"]);
  assert.deepEqual(postNodes[1].dependencies, ["post:color"]);
  assert.deepEqual(postNodes[2].dependencies, ["post:logo"]);
  assert.deepEqual(executionPlan.nodes.find(node => node.id === "qa-master").dependencies, ["post:hold"]);
  for (const node of [...postNodes, executionPlan.nodes.find(node => node.id === "delivery")]) assert.deepEqual(node.resources, [{ id: "cpu:ffmpeg", weight: 1 }]);
  const facade = adaptExecutionPlanToLegacy(executionPlan);
  const changed = structuredClone(facade);
  changed.postProduction.operations.reverse();
  assert.throws(() => validateFilmSpec(changed, { executionPlan }), /lista idêntica/);
  const planned = await planFilm({ spec: facade, executionPlan, outputsRoot: path.join(root, "productions") });
  const calls = { video: 0, color: 0, logo: 0, hold: 0, delivery: 0 };
  let interruptLogo = true;
  const leases = [];
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite") });
  const resourceBroker = { ...broker, async acquire(request, options) { leases.push(request); return broker.acquire(request, options); } };
  const base = {
    animateDraft: options => animateDraft({ ...options, pollIntervalMs: 1 }),
    imageAdapter: { generate() { assert.fail("sem referência de pessoa"); } },
    videoAdapter: createCookieVideoAdapter({
      async submit(options) { await options.onBeforeSubmit({}); const fileId = `post-${++calls.video}`; await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
      async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
      async collect(options) { await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
    }),
    async applyFilmPostOperation(options) {
      calls[options.operation.id]++;
      if (options.operation.id === "logo" && interruptLogo) { interruptLogo = false; throw new Error("fixture interrompida antes do logo"); }
      return applyFilmPostOperation(options);
    },
    async finishVideo(options) { calls.delivery++; assert.match(options.inputFile, /post-003\.mp4$/); return finishVideo(options); },
  };
  const contextFile = path.join(root, "assets.json");
  await writeFile(contextFile, JSON.stringify(governed.context));
  const runtime = await withLocalAssetRuntime(base, { "asset-context": contextFile });
  assert.equal((await preflightMasterRecipeBytes(compiled.resolved)).status, "blocked");
  const ready = await preflightMasterRecipeBytes(compiled.resolved, { authorizeLocalAssets: runtime.authorizeLocalAssets });
  assert.equal(ready.status, "ready", JSON.stringify(ready.blockers));
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint, resourceBroker, operations: runtime };
  await assert.rejects(runFilm({ ...options, operations: base }), /--asset-context/);
  assert.equal(calls.video, 0);
  await runFilm(options);
  await assert.rejects(resumeFilm(options), /interrompida antes do logo/);
  assert.equal(calls.color, 1);
  governed.changeRights({ permissions: { reuse: "revoked" } });
  await assert.rejects(resumeFilm(options), /revoked/);
  governed.changeRights({ permissions: { reuse: "allowed" } });
  await resumeFilm(options);
  await resumeFilm(options);
  assert.deepEqual(calls, { video: 3, color: 1, logo: 2, hold: 1, delivery: 1 });
  assert.equal(leases.filter(lease => lease.requestId.includes(":post:color:")).length, 1);
  assert.equal(leases.filter(lease => lease.requestId.includes(":delivery:")).length, 1);
  const status = await statusFilm({ stateFile: options.stateFile });
  assert.equal(status.status, "delivered");
  const finalProbe = await probeMedia(status.finalFile);
  assert.ok(finalProbe.video && finalProbe.audio && Math.abs(finalProbe.duration - 3) < 0.05);
  const state = JSON.parse(await readFile(options.stateFile, "utf8"));
  assert.deepEqual(state.postProduction.map(entry => entry.id), ["color", "logo", "hold"]);
  const snapshot = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(options.stateFile), "execution-journal.sqlite") });
  for (const node of postNodes) assert.equal(snapshot.nodes[node.id].status, "completed");
  const audioHash = async file => (await runCommand("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "hash", "-hash", "sha256", "-"])).stdout.trim();
  assert.equal(await audioHash(status.finalFile), await audioHash(state.stages.audioMux.outputFile));
  assert.deepEqual(await Promise.all([sha256File(source), sha256File(logo)]), originals);
});
