import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fitMusicToDuration, musicFitRecipe } from "../lib/media-pipeline/audio-first.mjs";
import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { createArtifactFromFile, sha256File } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { consumeExecutionEffectAuthorization, materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { inspectMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { runFfmpeg, probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";
import { buildArchiveIndex, setArchiveReview } from "../lib/media-pipeline/archive-index.mjs";
import { withLocalAssetRuntime } from "../lib/cli/local-asset-runtime.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";
import { buildUsageCostReport } from "../lib/media-pipeline/operational-reports.mjs";
import { assembleFilm } from "../lib/media-pipeline/film-assembly.mjs";
import { audioMixRecipe, mixAudio } from "../lib/media-pipeline/audio-mix.mjs";
import { prepareApprovedReuse, registerApprovedReuse } from "../lib/media-pipeline/approved-reuse-registration.mjs";
import { referenceRightsItemId } from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import { createScopeGrant } from "../lib/media-pipeline/knowledge-store.mjs";

test("duas produções reutilizam trilha e mixagem aprovadas sem seus leases, preservam áudio e recusam revogação", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "approved-music-reuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceVideo = path.join(root, "source.mp4");
  const sourceAudio = path.join(root, "source.wav");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x36:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourceVideo]);
  await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-c:a", "pcm_s24le", sourceAudio]);
  const golden = JSON.parse(await readFile(new URL("../recipes/golden-30s.receita-v2.5b.json", import.meta.url), "utf8"));
  const proposed = suggestMasterRecipeFromBrief({ rootScopeId: "client:teste", style: "flat-2d@1",
    modules: { music: golden.music, mix: golden.mix }, brief: { briefId: "reuse:music", userBrief: "Geometria com trilha.", objective: "Mostrar geometria.",
      durationSeconds: 6, format: "16:9", clientId: "client:teste", projectId: "project:teste" } });
  const calls = { video: 0, music: 0, fit: 0, mix: 0 };
  const rendered = [];
  const mixed = [];
  let interruptAssembly = false;
  const leases = [];
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite") });
  const resourceBroker = { ...broker, async acquire(request, options) { leases.push(request); return broker.acquire(request, options); } };
  const operations = {
    animateDraft: options => animateDraft({ ...options, pollIntervalMs: 1 }),
    imageAdapter: { generate() { assert.fail("sem imagem"); } },
    videoAdapter: createCookieVideoAdapter({
      async submit(options) { await options.onBeforeSubmit({}); const fileId = `music-${++calls.video}`; await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
      async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
      async collect(options) { await copyFile(sourceVideo, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
    }),
    generateTts() { assert.fail("sem voz"); },
    async generateMusic(options) {
      consumeExecutionEffectAuthorization(options.executionEffectAuthorization, { provider: "flow-music", operation: "music-generate", attemptId: options.attemptId });
      calls.music++;
      await copyFile(sourceAudio, options.outputFile);
      const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "audio", role: "music" });
      const receipt = createStageReceipt({ operation: "music", provider: "test", stage: "music", artifacts: [artifact] });
      await writeStageReceipt(options.receiptFile, receipt);
      return { file: options.outputFile, receiptFile: options.receiptFile, receipt };
    },
    async fitMusicToDuration(options) { calls.fit++; rendered.push(options); return fitMusicToDuration(options); },
    async mixAudio(options) { calls.mix++; mixed.push(options); return mixAudio(options); },
    async assembleFilm(options) {
      if (interruptAssembly) { interruptAssembly = false; throw new Error("fixture assembly interrupted"); }
      return assembleFilm(options);
    },
  };
  async function prepare(recipe, folder, selected = operations) {
    const { executionPlan } = inspectMasterRecipe(JSON.stringify(recipe));
    const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, folder) });
    return { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint, resourceBroker, operations: selected };
  }
  const first = await prepare(proposed.recipe, "first");
  await runFilm(first);
  await resumeFilm(first);
  assert.equal(calls.fit, 1);
  assert.equal(leases.filter(lease => lease.requestId.includes(":music-fit:")).length, 1, "ajuste inicial realmente reserva CPU");
  assert.equal(leases.filter(lease => lease.requestId.includes(":audio-mix:")).length, 1, "mixagem inicial realmente reserva CPU");
  assert.equal(calls.mix, 1);
  const mixOptions = mixed[0];
  const mixReceipt = JSON.parse(await readFile(mixOptions.receiptFile, "utf8"));
  const mixRecipe = recipeFromReceipt(mixReceipt);
  assert.deepEqual(await audioMixRecipe(mixOptions), mixRecipe);
  assert.notEqual((await audioMixRecipe({ ...mixOptions, musicGain: 0.2 })).hash, mixRecipe.hash);
  assert.notEqual((await audioMixRecipe({ ...mixOptions, durationSeconds: 5 })).hash, mixRecipe.hash);
  const fitOptions = rendered[0];
  const sourceReceipt = JSON.parse(await readFile(fitOptions.receiptFile, "utf8"));
  const recipe = recipeFromReceipt(sourceReceipt);
  assert.deepEqual(await musicFitRecipe(fitOptions), recipe);
  assert.notEqual((await musicFitRecipe({ ...fitOptions, targetDuration: 4 })).hash, recipe.hash);
  assert.notEqual((await musicFitRecipe({ ...fitOptions, crossfadeSeconds: 0.1 })).hash, recipe.hash);
  const binding = { schema: "mkt-videos/approved-reuse-binding@1", recipeHash: recipe.hash, receiptHash: sourceReceipt.hash.value,
    consumer: recipe.parameters.consumer, artifactRole: "music-bed" };
  const stored = await governedLocalAssetFixture({ root, file: fitOptions.outputFile, mediaKind: "audio", mediaType: "audio/wav", role: "music-bed", approvedReuse: binding });
  const dbFile = path.join(root, "archive.sqlite");
  await buildArchiveIndex({ root: path.join(root, "first"), dbFile });
  setArchiveReview({ dbFile, receiptPath: fitOptions.receiptFile, status: "approved" });
  const baseContext = { ...stored.context, roots: { ...stored.context.roots, mix: path.dirname(mixOptions.outputFile) }, reuse: { dbFile, candidates: [{ asset: stored.asset, receiptFile: fitOptions.receiptFile, binding }] } };
  const coreRoot = path.join(root, "workspace", "CORE");
  const proposal = await prepareApprovedReuse({ context: baseContext, sourceReceiptFile: mixOptions.receiptFile, artifactRole: "audio-master", rootAlias: "mix", reason: "Aprovar mixagem na fixture isolada", coreRoot });
  const registered = await registerApprovedReuse({ proposal, expectedProposalHash: proposal.hash, confirmHuman: true, coreRoot });
  const context = registered.context;
  const mixTarget = stored.repository.getKnowledgeItem({ grant: stored.grant, rootScopeId: context.rootScopeId, id: registered.itemId });
  let mixRights = stored.repository.getKnowledgeItem({ grant: stored.grant, rootScopeId: context.rootScopeId, id: referenceRightsItemId(mixTarget) });
  const mixGrant = createScopeGrant({ rootScopeIds: [context.rootScopeId], permissions: ["read", "write"], actor: mixRights.createdBy, purpose: "Revogar mixagem da fixture", issuedAt: stored.grant.issuedAt });
  const changeMixRights = reuse => {
    mixRights = stored.repository.appendKnowledgeItem({ grant: mixGrant, item: { ...mixRights, contentHash: undefined, revision: mixRights.revision + 1, supersedesRevision: mixRights.revision,
      payload: { ...mixRights.payload, permissions: { ...mixRights.payload.permissions, reuse } } } });
  };
  const contextFile = path.join(root, "assets.json");
  await writeFile(contextFile, JSON.stringify(context));
  const runtime = await withLocalAssetRuntime(operations, { "asset-context": contextFile });
  const targetRecipe = { ...proposed.recipe, reuse: { policy: "require-approved" } };
  await assert.rejects(runFilm(await prepare(targetRecipe, "missing")), /antes de gerar mídia/);
  assert.deepEqual(calls, { video: 3, music: 1, fit: 1, mix: 1 });
  const second = await prepare(targetRecipe, "second", runtime);
  const leaseCount = leases.length;
  interruptAssembly = true;
  await runFilm(second);
  await assert.rejects(resumeFilm(second), /fixture assembly interrupted/);
  stored.changeRights({ permissions: { reuse: "revoked" } });
  await assert.rejects(resumeFilm(second), /revoked/);
  assert.equal(calls.fit, 1, "revogação não autoriza renderização alternativa");
  stored.changeRights({ permissions: { reuse: "allowed" } });
  changeMixRights("revoked");
  await assert.rejects(resumeFilm(second), /revoked/);
  assert.equal(calls.mix, 1, "mixagem reutilizada revogada não pode ser consumida nem renderizada novamente");
  changeMixRights("allowed");
  await resumeFilm(second);
  assert.deepEqual(calls, { video: 6, music: 2, fit: 1, mix: 1 }, "não declara geração remota evitada");
  assert.equal(leases.slice(leaseCount).filter(lease => lease.requestId.includes(":music-fit:")).length, 0);
  assert.equal(leases.slice(leaseCount).filter(lease => lease.requestId.includes(":audio-mix:")).length, 0);
  const status = await statusFilm({ stateFile: second.stateFile });
  assert.equal(status.status, "delivered");
  const probe = await probeMedia(status.finalFile);
  assert.ok(probe.video && probe.audio);
  assert.ok(Math.abs(probe.duration - 6) < 0.05);
  const snapshot = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(second.stateFile), "execution-journal.sqlite") });
  const node = snapshot.nodes["music-fit"];
  assert.equal(node.reuseSource, "approved-archive");
  const mixNode = snapshot.nodes["audio-mix"];
  assert.equal(mixNode.reuseSource, "approved-archive");
  assert.equal(await sha256File(mixNode.output), await sha256File(mixOptions.outputFile));
  assert.equal(node.executionTiming.measurement.phaseMs["capacity-wait"], null);
  // FFprobe ainda verifica a fonte para derivar o filtro; somente o ajuste foi evitado.
  assert.ok(node.executionTiming.measurement.phaseMs["local-process"] > 0);
  assert.equal(await sha256File(node.output), stored.asset.sha256);
  assert.equal(await sha256File(fitOptions.outputFile), stored.asset.sha256);
  const receipt = JSON.parse(await readFile(node.receipt, "utf8"));
  assert.equal(receipt.metadata.avoidedOperation, "music-fit");
  assert.equal(receipt.metadata.avoidedProviderPost, false);
  const usage = await buildUsageCostReport({ root: path.join(root, "second") });
  assert.equal(usage.calls.localOperationsAvoided, 2);
  assert.equal(usage.calls.avoidedByReuse, 0);
  await resumeFilm(second);
  assert.deepEqual(calls, { video: 6, music: 2, fit: 1, mix: 1 });
});
