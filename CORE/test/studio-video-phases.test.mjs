import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import { claimNodeReconciliation, materializeExecutionSnapshot, recordExecutionNodeApproval } from "../lib/media-pipeline/execution-journal.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { runProductionPool } from "../lib/media-pipeline/production-pool.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { planFilm, runFilm, resumeFilm, reconcileFilmVideo, statusFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { approveDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { probeMedia, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { createReceipt } from "../lib/media-pipeline/receipt.mjs";

async function setup(t, { count = 3, admissionProvider = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-phases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scenes = Array.from({ length: count }, (_, i) => ({ id: `scene-${i}`, prompt: `Geometria ${i}`, motionPrompt: "Mover", generationTask: "text_to_video", duration: 2 }));
  const plan = compileFilmSpec({ name: "studio-phases", scenes, qa: false, budget: { image: 0, tts: 0, music: 0, omni: count, semanticQa: 0 } });
  const dbFile = path.join(root, "journal.sqlite");
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite"), capacities: { "provider:omni": 2, "browser:omni": 1, "cpu:ffmpeg": 1, "io:probe-hash": 1 } });
  const kernel = createExecutionKernel({ dbFile, plan, resourceBroker: broker, admissionProvider, confirmFingerprint: plan.governance.approval.fingerprint });
  for (const nodeId of ["alignment", "timeline-lock", ...scenes.map(({ id }) => `keyframe:${id}`), "animatic"]) {
    await kernel.executeLocalNode({ nodeId, execute: async () => ({ completed: true }) });
  }
  recordExecutionNodeApproval({ dbFile, nodeId: "animatic-approval", targetHash: "a".repeat(64), actor: "human:test", approvedAt: new Date() });
  const request = (id, adapter, extra = {}) => ({ nodeId: `video:${id}`, phasedVideo: { adapter, options: { prompt: `Geometria ${id}`, task: "text_to_video", outputFile: path.join(root, `${id}.mp4`), metadata: { mode: "studio", executionKernel: "required" }, timeoutMs: 20_000, pollIntervalMs: 20, ...extra } } });
  return { root, scenes, plan, dbFile, broker, kernel, request };
}

test("Studio libera worker e sessão com duas tentativas em voo no mesmo journal", async (t) => {
  const { kernel, request, scenes, broker, dbFile } = await setup(t);
  let posts = 0;
  const events = [];
  const snapshots = [];
  const adapter = createCookieVideoAdapter({
    async submit(options) {
      await options.onBeforeSubmit({});
      posts += 1;
      const fileId = `file-${posts}`;
      events.push(`submit:${fileId}`);
      await options.onProviderHandle({ fileId, attemptId: options.attemptId });
      return { fileId };
    },
    async observeMany({ requests }) {
      return requests.map(({ fileId }) => ({ fileId, classification: posts >= 2 ? "ready" : "pending", zeroPost: true }));
    },
    async collect(options) {
      events.push(`collect:${options.fileId}`);
      await writeFile(options.outputFile, Buffer.from("simulated-mp4"));
      return { fileId: options.fileId, zeroPost: true };
    },
  });
  const result = await runProductionPool({ parallel: 1, onEvent(event) {
    if (event.event === "job_waiting") snapshots.push(buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker);
  }, jobs: scenes.map(({ id }) => ({ id, run: ({ waitWithoutWorker }) => kernel.executePaidNode(request(id, adapter, { waitWithoutWorker })) })) });
  assert.equal(result.fulfilled, 3, JSON.stringify(result.results));
  assert.equal(posts, 3);
  assert.ok(events.indexOf("submit:file-2") < events.indexOf("collect:file-1"));
  assert.ok(snapshots.some((s) => s.remoteInFlight === 2 && s.activeLeases === 0));
  const journal = materializeExecutionSnapshot({ dbFile });
  for (const { id } of scenes) {
    assert.equal(journal.nodes[`video:${id}`].status, "completed");
    assert.equal(journal.nodes[`video:${id}`].attempts, 1);
  }
  const final = buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker;
  assert.equal(final.remoteInFlight, 0);
  assert.equal(final.activeLeases, 0);
});

test("queda na coleta Studio conserva handle e bloqueia nova submissão", async (t) => {
  const { kernel, request, dbFile, broker } = await setup(t, { count: 1 });
  let posts = 0;
  let failed = false;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); posts += 1; await options.onProviderHandle({ fileId: "accepted", attemptId: options.attemptId }); return { fileId: "accepted" }; },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { if (!failed) { failed = true; throw new Error("download interrompido"); } await writeFile(options.outputFile, Buffer.from("recovered-mp4")); return { fileId: options.fileId, zeroPost: true }; },
  });
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /download interrompido/);
  const node = materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"];
  assert.equal(node.status, "ambiguous");
  assert.equal(node.providerHandle.fileId, "accepted");
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /não pode ser autorizado|não autoriza nova tentativa/);
  const recovery = request("scene-0", adapter);
  recovery.phasedVideo.reconcile = true;
  const divergent = request("scene-0", adapter, { prompt: "outro pedido" });
  divergent.phasedVideo.reconcile = true;
  await assert.rejects(kernel.executePaidNode(divergent), /não pertence ao pedido/);
  await kernel.executePaidNode(recovery);
  const cached = await kernel.executePaidNode(recovery);
  assert.equal(cached.execution.reused, true);
  const forged = createReceipt({ ...cached.receipt, metadata: { ...cached.receipt.metadata, changedAfterCompletion: true } });
  await writeFile(cached.receiptFile, JSON.stringify(forged));
  await assert.rejects(kernel.executePaidNode(recovery), /hashes registrados no journal/);
  assert.equal(posts, 1);
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].attempts, 1);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker.remoteInFlight, 0);
});

function interruptHandlePublication(dbFile) {
  const db = new DatabaseSync(dbFile);
  try { db.exec("CREATE TRIGGER fixture_handle_failure BEFORE INSERT ON events WHEN NEW.type='provider_handle_persisted' BEGIN SELECT RAISE(ABORT, 'fixture_handle_write_failed'); END;"); }
  finally { db.close(); }
  return () => {
    const connection = new DatabaseSync(dbFile);
    try { connection.exec("DROP TRIGGER fixture_handle_failure;"); }
    finally { connection.close(); }
  };
}

test("handle aceito pelo broker recompõe journal ausente somente para o pedido original", async (t) => {
  const { kernel, request, dbFile, broker } = await setup(t, { count: 1 });
  const restore = interruptHandlePublication(dbFile);
  let posts = 0;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); posts++; await options.onProviderHandle({ fileId: "broker-only", attemptId: options.attemptId }); return { fileId: "broker-only" }; },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { await writeFile(options.outputFile, Buffer.from("recovered-from-broker")); return { fileId: options.fileId, zeroPost: true }; },
  });
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /fixture_handle_write_failed/);
  restore();
  const before = materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"];
  assert.equal(before.providerHandle, null);
  assert.equal(broker.readRemoteOperation(`omni:${before.attemptId}`).handle.fileId, "broker-only");
  const divergent = request("scene-0", adapter, { prompt: "different" });
  divergent.phasedVideo.reconcile = true;
  await assert.rejects(kernel.executePaidNode(divergent), /não pertence ao pedido/);
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].providerHandle, null);
  let recoveredHandle;
  const recovery = request("scene-0", adapter, { onProviderHandle: (handle) => { recoveredHandle = handle; } });
  recovery.phasedVideo.reconcile = true;
  await kernel.executePaidNode(recovery);
  const after = materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"];
  assert.equal(after.status, "completed");
  assert.equal(after.attemptId, before.attemptId);
  assert.equal(after.attempts, 1);
  assert.equal(after.providerHandle.fileId, "broker-only");
  assert.equal(recoveredHandle.attemptId, before.attemptId);
  assert.equal(posts, 1);
});

test("reserva sem handle não autoriza recuperação nem segunda submissão", async (t) => {
  const { kernel, request, dbFile, broker } = await setup(t, { count: 1 });
  let posts = 0;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); posts++; throw new Error("resposta perdida após POST"); },
    async observeMany() { assert.fail("sem handle não consulta"); },
    async collect() { assert.fail("sem handle não coleta"); },
  });
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /resposta perdida/);
  const recovery = request("scene-0", adapter); recovery.phasedVideo.reconcile = true;
  await assert.rejects(kernel.executePaidNode(recovery), /Broker sem handle comprovado/);
  assert.equal(posts, 1);
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].attempts, 1);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker.remoteInFlight, 1);
});

test("claim abandonado no journal retoma sob posse do nó sem reabrir submissão", async (t) => {
  const { kernel, request, dbFile } = await setup(t, { count: 1 });
  let posts = 0; let failCollection = true;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); posts++; await options.onProviderHandle({ fileId: "claim-gap", attemptId: options.attemptId }); return { fileId: "claim-gap" }; },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { if (failCollection) { failCollection = false; throw new Error("interrupção"); } await writeFile(options.outputFile, Buffer.from("claim-recovery")); return { fileId: options.fileId, zeroPost: true }; },
  });
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /interrupção/);
  claimNodeReconciliation({ dbFile, nodeId: "video:scene-0" });
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].status, "reconciling");
  const recovery = request("scene-0", adapter); recovery.phasedVideo.reconcile = true;
  await kernel.executePaidNode(recovery);
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].status, "completed");
  assert.equal(posts, 1);
});

test("blocos Omni sobrepõem renders e retomam somente a coleta pendente na ordem do roteiro", { timeout: 40_000 }, async (t) => {
  const { root, broker } = await setup(t, { count: 1 });
  const plan = compileFilmSpec({ name: "narration-parallel", scenes: [{ id: "visual", prompt: "Formas", generationTask: "text_to_video", duration: 4 }],
    narration: { provider: "omni", voice: "voz brasileira", text: "Primeiro bloco. Segundo bloco.", blocks: [{ id: "first", text: "Primeiro bloco.", seconds: 2 }, { id: "second", text: "Segundo bloco.", seconds: 2 }] },
    qa: false, budget: { image: 0, tts: 0, music: 0, omni: 3, semanticQa: 0 } });
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(plan), executionPlan: plan, outputsRoot: path.join(root, "productions") });
  const journalFile = planned.state.executionJournalFile;
  const posts = [];
  const collected = [];
  let failSecond = true;
  let alignedBlocks = null;
  const videoAdapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); const fileId = options.prompt.includes("Primeiro bloco.") ? "first" : "second"; posts.push(fileId); await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
    async observeMany({ requests }) {
      assert.equal(posts.length, 2, "os dois blocos devem ser enviados antes de aguardar o primeiro");
      return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true }));
    },
    async collect(options) {
      if (options.fileId === "second" && failSecond) { failSecond = false; throw new Error("falha na coleta do segundo bloco"); }
      collected.push(options.fileId);
      await writeFile(options.outputFile, Buffer.from(`narration-${options.fileId}`));
      return { fileId: options.fileId, zeroPost: true };
    },
  });
  const options = { stateFile: planned.state.stateFile, resourceBroker: broker, confirmFingerprint: plan.governance.approval.fingerprint, operations: {
    videoAdapter,
    async alignNarrationBlocks({ blocks }) { alignedBlocks = blocks; throw new Error("alinhamento interceptado após blocos"); },
  } };
  await assert.rejects(runFilm(options), /falha na coleta do segundo bloco/);
  assert.equal(alignedBlocks, null);
  const first = materializeExecutionSnapshot({ dbFile: journalFile }).nodes["video:narration:first"];
  assert.equal(first.status, "completed");
  const originalBytes = await readFile(first.output);
  const originalStat = await stat(first.output);
  await assert.rejects(resumeFilm(options), /alinhamento interceptado após blocos/);
  assert.deepEqual(posts.sort(), ["first", "second"]);
  assert.deepEqual(collected.sort(), ["first", "second"]);
  assert.deepEqual(alignedBlocks.map((block) => block.id), ["first", "second"]);
  assert.deepEqual(await readFile(first.output), originalBytes);
  assert.equal((await stat(first.output)).mtimeMs, originalStat.mtimeMs);
  for (const id of ["first", "second"]) {
    const node = materializeExecutionSnapshot({ dbFile: journalFile }).nodes[`video:narration:${id}`];
    assert.equal(node.status, "completed");
    assert.equal(node.attempts, 1);
  }
});

test("admissão revogada durante o render bloqueia coleta e conserva a reserva remota", async (t) => {
  let allowed = true;
  const { kernel, request, dbFile, broker } = await setup(t, { count: 1, admissionProvider: async () => ({ status: allowed ? "ready" : "blocked", blockers: allowed ? [] : ["rights_revoked"] }) });
  let collected = false;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); await options.onProviderHandle({ fileId: "accepted", attemptId: options.attemptId }); allowed = false; return { fileId: "accepted" }; },
    async observeMany() { assert.fail("admissão deve anteceder observação e coleta"); },
    async collect() { collected = true; },
  });
  await assert.rejects(kernel.executePaidNode(request("scene-0", adapter)), /rights_revoked/);
  assert.equal(collected, false);
  assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].providerHandle.fileId, "accepted");
  const runtime = buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker;
  assert.equal(runtime.remoteInFlight, 1);
  assert.equal(runtime.activeLeases, 0);
});

test("retomada concorrente não toma o nó de um executor ainda vivo", async (t) => {
  const { kernel, request, dbFile } = await setup(t, { count: 1 });
  let release; let signalWaiting;
  const waiting = new Promise((resolve) => { signalWaiting = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  let posts = 0;
  const adapter = createCookieVideoAdapter({
    async submit(options) { await options.onBeforeSubmit({}); posts += 1; await options.onProviderHandle({ fileId: "active", attemptId: options.attemptId }); return { fileId: "active" }; },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { await writeFile(options.outputFile, Buffer.from("active-mp4")); return { fileId: options.fileId, zeroPost: true }; },
  });
  const flight = kernel.executePaidNode(request("scene-0", adapter, { waitWithoutWorker: async (work) => { signalWaiting(); await barrier; return work(); } }));
  try {
    await Promise.race([waiting, flight.then(() => assert.fail("a tentativa precisa alcançar a espera"))]);
    const competing = request("scene-0", adapter); competing.phasedVideo.reconcile = true;
    await assert.rejects(kernel.executePaidNode(competing), /Produção em uso/);
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["video:scene-0"].status, "provider_pending");
    assert.equal(posts, 1);
  } finally { release(); await flight; }
});

for (const [recovery, failure] of [["resume", "collect"], ["reconcile", "collect"], ["resume", "journal"]]) test(`run e ${recovery} Studio recuperam o mesmo handle após falha em ${failure} e entregam arquivo físico`, async (t) => {
  const { root, plan, broker } = await setup(t, { count: 1 });
  const source = path.join(root, "source.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(plan), executionPlan: plan, outputsRoot: path.join(root, "productions") });
  let posts = 0;
  let failCollection = failure === "collect";
  const videoAdapter = createCookieVideoAdapter({
    async generate() { assert.fail("rota por fases não usa generate legado"); },
    async submit(options) { await options.onBeforeSubmit({}); posts += 1; await options.onProviderHandle({ fileId: "accepted", attemptId: options.attemptId }); return { fileId: "accepted" }; },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { if (failCollection) { failCollection = false; throw new Error("coleta interrompida"); } await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
  });
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: plan.governance.approval.fingerprint, operations: { videoAdapter }, resourceBroker: broker };
  await runFilm(options);
  await approveDraft({ draftFile: planned.state.draftFile });
  const journalFile = path.join(path.dirname(planned.state.stateFile), "execution-journal.sqlite");
  const restore = failure === "journal" ? interruptHandlePublication(journalFile) : () => {};
  await assert.rejects(resumeFilm(options), failure === "journal" ? /fixture_handle_write_failed/ : /coleta interrompida/);
  restore();
  if (recovery === "reconcile") await reconcileFilmVideo({ ...options, sceneId: "scene-0" });
  const completed = await resumeFilm(options);
  assert.equal((await statusFilm({ stateFile: planned.state.stateFile })).status, "delivered");
  const media = await probeMedia(completed.files.assembledFile);
  assert.ok(media.video);
  assert.equal(posts, 1);
  assert.equal(materializeExecutionSnapshot({ dbFile: journalFile }).nodes["video:scene-0"].attempts, 1);
  const final = buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker;
  assert.equal(final.activeLeases, 0);
  assert.equal(final.remoteInFlight, 0);
});
