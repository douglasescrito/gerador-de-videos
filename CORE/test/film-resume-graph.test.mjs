import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, resumeFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { migrateLegacyStateToJournal, materializeExecutionSnapshot, beginNodeAttempt, recordNodeCompletion, recordExecutionNodeApproval, buildExecutionRightsDecision, authorizeJournalNode } from "../lib/media-pipeline/execution-journal.mjs";
import { issueExecutionAuthorization } from "../lib/media-pipeline/execution-authorization.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt, writeFileAtomic, writeJsonAtomic, replaceJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";

test("resume canônico sobrepõe montagem/mix e preserva o ramo concluído após falha local", { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-resume-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    name: "resume-graph", scenes: [{ id: "a", prompt: "formas" }],
    narration: { provider: "google-vids", documentUrl: "https://docs.google.com/videos/d/test/edit", text: "Uma frase.", voice: "Nyla" },
    qa: false,
  };
  const executionPlan = compileFilmSpec(input);
  const { state, plan } = await planFilm({ spec: input, outputsRoot: root, executionPlan });
  const files = plan.files;
  const resourceBroker = createResourceBroker({ dbFile: path.join(root, "runtime.sqlite"), capacities: { "cpu:ffmpeg": 2, "io:probe-hash": 1 } });
  async function materialize(file, operation, parentReceipts = []) {
    await writeFileAtomic(file, Buffer.from(`fixture:${operation}`));
    const artifact = await createArtifactFromFile({ file, kind: path.extname(file) === ".wav" ? "audio" : "video" });
    const receiptFile = `${file}.receipt.json`;
    const receipt = createStageReceipt({ operation, provider: "test", stage: operation, artifacts: [artifact], parentReceipts });
    await writeStageReceipt(receiptFile, receipt);
    return { file, receiptFile, receipt };
  }
  const scene = await materialize(path.join(plan.spec.root, "videos-soltos", "a.mp4"), "scene");
  const voice = await materialize(files.voiceFile, "voice");
  await writeJsonAtomic(files.draftFile, {
    schema: "mkt-videos/draft-workflow@1", id: "draft:test", name: input.name, root: plan.spec.root,
    mode: "studio", status: "delivered", stateFile: files.draftFile, history: [],
    scenes: [{ id: "a", status: "delivered", videoFile: scene.file, videoReceipt: scene.receiptFile }],
  });
  for (const name of ["draft", "video", "tts"]) state.stages[name].status = "completed";
  state.stages.tts.receiptFile = voice.receiptFile;
  state.stages.tts.receiptId = voice.receipt.id;
  await replaceJsonAtomic(state.stateFile, state);
  const journal = state.executionJournalFile;
  migrateLegacyStateToJournal({ dbFile: journal, plan: executionPlan, legacyState: { stages: { draft: state.stages.draft, video: state.stages.video } } });
  // A fixture representa uma produção que já concluiu os provedores; as
  // operações sob teste são os nós locais reais, com journal e broker reais.
  for (const node of executionPlan.nodes.filter((node) => !["assembly", "audio-mix", "master"].includes(node.id))) {
    if (materializeExecutionSnapshot({ dbFile: journal }).nodes[node.id].status === "completed") continue;
    if (node.kind === "human-approval") {
      recordExecutionNodeApproval({ dbFile: journal, nodeId: node.id, actor: "human:test", targetHash: "a".repeat(64) });
      continue;
    }
    let authorization;
    if (node.costClass !== "local") {
      authorization = issueExecutionAuthorization({ plan: executionPlan, nodeId: node.id, rightsDecision: buildExecutionRightsDecision({ dbFile: journal, nodeId: node.id }), confirmFingerprint: executionPlan.governance.approval.fingerprint, source: "cli", actor: "human:test" });
      authorizeJournalNode({ dbFile: journal, nodeId: node.id, authorization });
    }
    const attemptId = `fixture:${node.id}`;
    beginNodeAttempt({ dbFile: journal, nodeId: node.id, attemptId, ...(authorization ? { authorization } : {}) });
    recordNodeCompletion({ dbFile: journal, nodeId: node.id, attemptId });
  }
  const together = Promise.withResolvers();
  const calls = { assembly: 0, mix: 0, mux: 0 };
  const intervals = {};
  async function meet(name) {
    intervals[name] = { startedAt: performance.now() };
    if (intervals.assembly && intervals.mix) together.resolve();
    await together.promise;
  }
  const operations = {
    async assembleFilm({ outputFile, parentReceipts }) {
      calls.assembly += 1;
      if (calls.assembly === 1) { await meet("assembly"); intervals.assembly.completedAt = performance.now(); throw new Error("falha local de montagem"); }
      return materialize(outputFile, "assembly", parentReceipts);
    },
    async mixAudio({ voiceFile, outputFile, parentReceipts }) {
      calls.mix += 1;
      assert.equal(await readFile(voiceFile, "utf8"), "fixture:voice");
      await meet("mix");
      const result = await materialize(outputFile, "mix", parentReceipts);
      intervals.mix.completedAt = performance.now();
      return result;
    },
    async muxMasterAudio({ videoFile, audioFile, outputFile, parentReceipts }) {
      calls.mux += 1;
      assert.equal(await readFile(videoFile, "utf8"), "fixture:assembly");
      assert.equal(await readFile(audioFile, "utf8"), "fixture:mix");
      return materialize(outputFile, "mux", parentReceipts);
    },
  };
  await assert.rejects(resumeFilm({ stateFile: state.stateFile, operations, resourceBroker }), /falha local de montagem/);
  assert.ok(intervals.assembly.startedAt < intervals.mix.completedAt);
  assert.ok(intervals.mix.startedAt < intervals.assembly.completedAt);
  assert.deepEqual(calls, { assembly: 1, mix: 1, mux: 0 });
  assert.equal(materializeExecutionSnapshot({ dbFile: journal }).nodes["audio-mix"].status, "completed");
  const mixed = await readFile(files.audioMasterFile);
  const kernel = createExecutionKernel({ plan: executionPlan, dbFile: journal, resourceBroker });
  const replayed = await kernel.executeLocalNode({ nodeId: "audio-mix", execute: () => assert.fail("mix já concluído") });
  assert.equal(replayed.file, files.audioMasterFile);
  assert.equal(replayed.execution.reused, true);
  assert.ok(replayed.receiptFile);
  const resumed = await resumeFilm({ stateFile: state.stateFile, operations, resourceBroker });
  assert.equal(resumed.state.status, "delivered");
  assert.deepEqual(calls, { assembly: 2, mix: 1, mux: 1 });
  assert.deepEqual(await readFile(files.audioMasterFile), mixed);
  const completed = materializeExecutionSnapshot({ dbFile: journal });
  for (const id of ["assembly", "audio-mix", "master"]) assert.equal(completed.nodes[id].status, "completed");
  await writeFile(files.audioMasterFile, "bytes divergentes");
  await assert.rejects(kernel.executeLocalNode({ nodeId: "audio-mix", execute: () => assert.fail("não refaz mix adulterado") }), /divergente/);
});
