import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { planFilm, runFilm, resumeFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { approveDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";

test("film human replacement validates before release, preserves completed scene, submits once and replays after delivery", { timeout: 45_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-human-retry-"));
  const previousLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  t.after(async () => { if (previousLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previousLocal; await rm(root, { recursive: true, force: true }); });
  const plan = compileFilmSpec({ name: "film-human-retry", workflow: { maxAttempts: 3 }, scenes: ["kept", "replace"].map(id => ({ id, prompt: `Geometria ${id}`, motionPrompt: `Geometria ${id} em movimento`, generationTask: "text_to_video", duration: 2 })), qa: false, budget: { image: 0, tts: 0, music: 0, omni: 2, semanticQa: 0 } });
  const source = path.join(root, "source.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(plan), executionPlan: plan, outputsRoot: path.join(root, "productions") });
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite"), capacities: { "provider:omni": 2, "browser:omni": 1, "cpu:ffmpeg": 1, "io:probe-hash": 1 } });
  const posts = [];
  let failReplacement = true;
  const videoAdapter = createCookieVideoAdapter({
    async generate() { assert.fail("no legacy generation"); },
    async submit(options) {
      await options.onBeforeSubmit({});
      const sceneId = options.prompt.includes("Geometria replace") ? "replace" : "kept";
      posts.push({ sceneId, attemptId: options.attemptId });
      if (sceneId === "replace" && failReplacement) { failReplacement = false; throw Object.assign(new Error("fixture HTTP 504 unknown effect"), { postStarted: true }); }
      const fileId = `file:${options.attemptId}`;
      await options.onProviderHandle({ fileId, attemptId: options.attemptId });
      return { fileId };
    },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect(options) { await copyFile(source, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
  });
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: plan.governance.approval.fingerprint, operations: { videoAdapter }, resourceBroker: broker };
  await runFilm(options);
  await approveDraft({ draftFile: planned.state.draftFile });
  await assert.rejects(resumeFilm(options), /fixture HTTP 504/);
  const journalFile = path.join(path.dirname(planned.state.stateFile), "execution-journal.sqlite");
  const before = materializeExecutionSnapshot({ dbFile: journalFile });
  const oldAttemptId = before.nodes["video:replace"].attemptId;
  const kept = before.nodes["video:kept"];
  assert.equal(kept.status, "completed");
  const keptBytes = await readFile(kept.output);
  const oldRemote = broker.readRemoteOperation(`omni:${oldAttemptId}`);
  const decision = { schema: "mkt-videos/human-retry-decision@1", decisionId: "human:replace-once", planFingerprint: plan.fingerprint, productionId: plan.spec.name, actor: "human:fixture", reason: "Generate another after the unknown response", acknowledgeUnknownEffect: true, attempts: [{ nodeId: "video:replace", attemptId: oldAttemptId }] };
  const originalDraft = await readFile(planned.state.draftFile, "utf8");
  const mismatched = JSON.parse(originalDraft);
  mismatched.scenes.find(s => s.id === "replace").attemptId = "different-draft-attempt";
  await writeFile(planned.state.draftFile, JSON.stringify(mismatched));
  await assert.rejects(resumeFilm({ ...options, humanRetryDecision: decision, confirmHumanRetry: true }), /tentativa|diverg|corresponde/);
  const db = new DatabaseSync(broker.dbFile, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) n FROM broker_remote_replacement_decisions").get().n, 0, "invalid draft must fail before administrative release"); }
  finally { db.close(); }
  await writeFile(planned.state.draftFile, originalDraft);
  const complete = await resumeFilm({ ...options, humanRetryDecision: decision, confirmHumanRetry: true });
  assert.equal(complete.state.status, "delivered");
  const after = materializeExecutionSnapshot({ dbFile: journalFile });
  assert.equal(after.nodes["video:kept"].attempts, 1);
  assert.equal(after.nodes["video:replace"].attempts, 2);
  assert.notEqual(after.nodes["video:replace"].attemptId, oldAttemptId);
  assert.deepEqual(await readFile(kept.output), keptBytes);
  assert.deepEqual(broker.readRemoteOperation(`omni:${oldAttemptId}`), oldRemote);
  const draftAfter = JSON.parse(await readFile(planned.state.draftFile, "utf8"));
  assert.equal(draftAfter.scenes.find(s => s.id === "replace").replacementHistory[0].outcome, "unknown");
  assert.equal(posts.filter(p => p.sceneId === "replace").length, 2);
  const replay = await resumeFilm({ ...options, humanRetryDecision: decision, confirmHumanRetry: true });
  assert.equal(replay.state.status, "delivered");
  assert.equal(posts.length, 3);
  const runtime = buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile }).broker;
  assert.equal(runtime.remoteUnknown, 1);
  assert.equal(runtime.administrativelyReleased, 1);
  assert.equal(runtime.remoteInFlight, 0);
});
