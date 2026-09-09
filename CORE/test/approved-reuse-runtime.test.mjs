import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import { materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { sha256File } from "../lib/media-pipeline/artifact.mjs";
import { runFfmpeg, probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { renderMotionGraphics, motionGraphicsRecipe } from "../lib/media-pipeline/motion-graphics.mjs";
import { finishVideo, finishVideoRecipe } from "../lib/media-pipeline/delivery-profile.mjs";
import { prepareApprovedReuse, registerApprovedReuse } from "../lib/media-pipeline/approved-reuse-registration.mjs";
import { recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";
import { buildArchiveIndex, setArchiveReview } from "../lib/media-pipeline/archive-index.mjs";
import { withLocalAssetRuntime } from "../lib/cli/local-asset-runtime.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";
import { createReceipt } from "../lib/media-pipeline/receipt.mjs";
import { listFilmJobs, buildUsageCostReport } from "../lib/media-pipeline/operational-reports.mjs";

test("duas produções reutilizam grafismo aprovado sem render/lease de CPU; retomada revalida direitos", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "approved-reuse-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const proposed = suggestMasterRecipeFromBrief({ rootScopeId: "client:teste", profile: "hibrido@1", brief: {
    briefId: "reuse:test", userBrief: "Mostre um encaixe.", objective: "Ensinar a montagem.", requiredText: ["ENCAIXE"], durationSeconds: 3, format: "16:9", projectId: "project:teste", clientId: "client:teste",
  } });
  const calls = { video: 0, motion: 0, delivery: 0 };
  const rendered = [];
  const finished = [];
  const leases = [];
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite") });
  const resourceBroker = { ...broker, async acquire(request, options) { leases.push(request); return broker.acquire(request, options); } };
  const operations = {
    // Provider simulado já concluiu: não aguardar o polling produtivo de 5 s.
    animateDraft: (options) => animateDraft({ ...options, pollIntervalMs: 1 }),
    imageAdapter: { generate() { assert.fail("não requer imagem"); } },
    videoAdapter: createCookieVideoAdapter({
      async submit(options) { await options.onBeforeSubmit({}); const fileId = `reuse-${++calls.video}`; await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
      async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
      async collect(options) { await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
    }),
    generateTts() { assert.fail("não requer voz"); }, generateMusic() { assert.fail("não requer música"); },
    async renderMotionGraphics(options) { calls.motion++; rendered.push(options); return renderMotionGraphics(options); },
    async finishVideo(options) { calls.delivery++; finished.push(options); return finishVideo(options); },
  };
  async function prepare(recipe, folder, selected = operations) {
    const { executionPlan } = inspectMasterRecipe(JSON.stringify(recipe));
    const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, folder) });
    return { executionPlan, options: { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint, resourceBroker, operations: selected } };
  }
  const first = await prepare(proposed.recipe, "first");
  await runFilm(first.options);
  await resumeFilm(first.options);
  assert.equal(calls.motion, 1);
  assert.equal(leases.filter(lease => lease.requestId.includes(":motion:")).length, 1, "render inicial realmente reserva CPU");
  assert.equal(leases.filter(lease => lease.requestId.includes(":delivery:")).length, 1, "acabamento inicial realmente reserva CPU");
  const motionOptions = rendered[0];
  const sourceReceipt = JSON.parse(await readFile(motionOptions.receiptFile, "utf8"));
  const recipe = recipeFromReceipt(sourceReceipt);
  assert.deepEqual(await motionGraphicsRecipe(motionOptions), recipe);
  const binding = { schema: "mkt-videos/approved-reuse-binding@1", recipeHash: recipe.hash, receiptHash: sourceReceipt.hash.value, consumer: recipe.parameters.consumer, artifactRole: "motion-master" };
  const stored = await governedLocalAssetFixture({ root, file: motionOptions.outputFile, mediaKind: "video", mediaType: "video/mp4", role: "motion-master", approvedReuse: binding });
  const dbFile = path.join(root, "archive.sqlite");
  await buildArchiveIndex({ root: path.join(root, "first"), dbFile });
  setArchiveReview({ dbFile, receiptPath: motionOptions.receiptFile, status: "approved" });
  const deliveryOptions = finished[0];
  assert.equal(calls.delivery, 1);
  const deliveryReceipt = JSON.parse(await readFile(deliveryOptions.receiptFile, "utf8"));
  const deliveryRecipe = recipeFromReceipt(deliveryReceipt);
  assert.deepEqual(await finishVideoRecipe(deliveryOptions), deliveryRecipe);
  assert.notEqual((await finishVideoRecipe({ ...deliveryOptions, profile: "archive-original" })).hash, deliveryRecipe.hash);
  assert.notEqual((await finishVideoRecipe({ ...deliveryOptions, strict: true })).hash, deliveryRecipe.hash);
  const baseContext = { ...stored.context, roots: { ...stored.context.roots, delivery: path.dirname(deliveryOptions.outputFile) },
    reuse: { dbFile, candidates: [{ asset: stored.asset, receiptFile: motionOptions.receiptFile, binding }] } };
  const coreRoot = path.join(root, "workspace", "CORE");
  const proposal = await prepareApprovedReuse({ context: baseContext, sourceReceiptFile: deliveryOptions.receiptFile,
    artifactRole: "delivery-video", rootAlias: "delivery", reason: "Aprovar acabamento na fixture isolada", coreRoot });
  const registered = await registerApprovedReuse({ proposal, expectedProposalHash: proposal.hash, confirmHuman: true, coreRoot });
  const context = registered.context;
  const contextFile = path.join(root, "assets.json");
  await writeFile(contextFile, JSON.stringify(context));
  const runtime = await withLocalAssetRuntime(operations, { "asset-context": contextFile });
  const targetRecipe = { ...proposed.recipe, reuse: { policy: "require-approved" } };
  const missing = await prepare(targetRecipe, "missing-context");
  await assert.rejects(runFilm(missing.options), /antes de gerar mídia/);
  assert.equal(calls.video, 3);
  const second = await prepare(targetRecipe, "second", runtime);
  assert.equal(second.executionPlan.spec.reuse.policy, "require-approved");
  const leaseCount = leases.length;
  await runFilm(second.options);
  await resumeFilm(second.options);
  assert.deepEqual(calls, { video: 6, motion: 1, delivery: 1 });
  assert.equal(leases.slice(leaseCount).filter((lease) => lease.requestId.includes(":motion:")).length, 0, "hit não reserva renderer/CPU");
  assert.equal(leases.slice(leaseCount).filter((lease) => lease.requestId.includes(":delivery:")).length, 0, "hit não reserva acabamento/CPU");
  const result = await statusFilm({ stateFile: second.options.stateFile });
  assert.equal(result.status, "delivered");
  assert.ok(Math.abs((await probeMedia(result.finalFile)).duration - 3) < 0.05);
  const journalFile = path.join(path.dirname(second.options.stateFile), "execution-journal.sqlite");
  const snapshot = materializeExecutionSnapshot({ dbFile: journalFile });
  assert.equal(snapshot.nodes.delivery.reuseSource, "approved-archive");
  assert.equal(await sha256File(result.finalFile), deliveryReceipt.artifacts[0].hash.value);
  assert.equal(await sha256File(deliveryOptions.outputFile), deliveryReceipt.artifacts[0].hash.value);
  const nodeId = Object.keys(snapshot.nodes).find((id) => id.startsWith("motion:"));
  const node = snapshot.nodes[nodeId];
  const reusedReceipt = JSON.parse(await readFile(node.receipt, "utf8"));
  assert.equal(reusedReceipt.operation, "reuse-artifact");
  assert.equal(reusedReceipt.metadata.avoidedOperation, "render-motion-graphics");
  assert.equal(reusedReceipt.metadata.avoidedProviderPost, false);
  assert.equal(node.executionTiming.measurement.phaseMs["local-process"], null);
  assert.equal(node.executionTiming.measurement.phaseMs["capacity-wait"], null);
  const jobs = await listFilmJobs({ root: path.join(root, "second") });
  assert.deepEqual([...jobs.jobs[0].journal.approvedReuseNodes].sort(), [nodeId, "delivery"].sort());
  const usage = await buildUsageCostReport({ root: path.join(root, "second") });
  assert.equal(usage.calls.localOperationsAvoided, 2);
  assert.equal(usage.calls.avoidedByReuse, 0, "reuso local não evita as submissões de vídeo");
  assert.equal(usage.calls.reuseCopies, 2);
  assert.equal(await sha256File(node.output), stored.asset.sha256);
  assert.equal(await sha256File(motionOptions.outputFile), stored.asset.sha256);
  const kernel = createExecutionKernel({ dbFile: journalFile, plan: second.executionPlan, resourceBroker });
  const reuse = { validate: (receipt) => runtime.reuseApprovedArtifact.validate({ rootScopeId: context.rootScopeId, recipe, consumer: binding.consumer, artifactRole: binding.artifactRole, receipt }) };
  const resumed = await kernel.executeLocalNode({ nodeId, reuse, execute() { assert.fail("não refaz render"); } });
  assert.equal(resumed.execution.reused, true);
  const originalReceipt = await readFile(node.receipt, "utf8");
  const tamperedMetadata = { ...reusedReceipt.metadata };
  delete tamperedMetadata.approvedReuse;
  await writeFile(node.receipt, JSON.stringify(createReceipt({ ...reusedReceipt, metadata: tamperedMetadata })));
  await assert.rejects(kernel.executeLocalNode({ nodeId, reuse, execute() { assert.fail("não aceita outro recibo"); } }), /hashes registrados no journal/);
  await writeFile(node.receipt, originalReceipt);
  stored.changeRights({ permissions: { reuse: "revoked" } });
  await assert.rejects(kernel.executeLocalNode({ nodeId, reuse, execute() { assert.fail("revogação não autoriza render"); } }), /revoked/);
  const guardedKernel = createExecutionKernel({ dbFile: journalFile, plan: second.executionPlan, resourceBroker, validateReusedArtifact: reuse.validate });
  await assert.rejects(guardedKernel.executeLocalNode({ nodeId: "assembly", execute() { assert.fail("consumidor não usa origem revogada"); } }), /revoked/);
  assert.equal(await sha256File(node.output), stored.asset.sha256);
});
