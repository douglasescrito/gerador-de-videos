import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { issueExecutionAuthorization } from "../lib/media-pipeline/execution-authorization.mjs";
import {
  initializeExecutionJournal, materializeExecutionSnapshot, beginNodeAttempt,
  authorizeJournalNode, buildExecutionRightsDecision, consumeExecutionEffectAuthorization,
  recordNodeCompletion, recordNodeFailure, recordExecutionNodeApproval,
  prepareHumanRetryAuthorization, registerHumanRetryAuthorization,
  persistJournalProviderHandle, claimNodeReconciliation,
} from "../lib/media-pipeline/execution-journal.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";

async function fixture(t, count = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), "human-retry-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbFile = path.join(root, "journal.sqlite");
  const plan = compileFilmSpec({ name: "human-retry", qa: false, budget: { omni: count },
    workflow: { authorizationMode: "production-once", completionMode: "complete", humanReview: false, maxAttempts: 3 },
    scenes: Array.from({ length: count }, (_, i) => ({ id: String.fromCharCode(97 + i), prompt: "Formas em movimento", generationTask: "text_to_video", durationHint: 10 })),
  });
  initializeExecutionJournal({ dbFile, plan });
  const local = (nodeId) => { const attemptId = `local:${nodeId}`; beginNodeAttempt({ dbFile, nodeId, attemptId }); recordNodeCompletion({ dbFile, nodeId, attemptId }); };
  local("alignment"); local("timeline-lock");
  for (const scene of plan.spec.scenes) local(`keyframe:${scene.id}`);
  local("animatic");
  recordExecutionNodeApproval({ dbFile, nodeId: "animatic-approval", targetHash: "a".repeat(64), actor: "workflow", actorKind: "automation" });
  const brokerOptions = { dbFile: path.join(root, "broker.sqlite"), capacities: { "provider:omni": 3 }, isProcessAlive: () => true };
  const producer = createResourceBroker({ ...brokerOptions, owner: { pid: 101, nonce: "producer" } });
  const admin = createResourceBroker({ ...brokerOptions, owner: { pid: 202, nonce: "admin" } });
  function issue(nodeId = "video:a") {
    return issueExecutionAuthorization({ plan, nodeId, rightsDecision: buildExecutionRightsDecision({ dbFile, nodeId }), confirmFingerprint: plan.governance.approval.fingerprint, source: "cli", actor: "human:fixture" });
  }
  function start(attemptId, nodeId = "video:a") {
    const authorization = issue(nodeId);
    authorizeJournalNode({ dbFile, nodeId, authorization });
    const result = beginNodeAttempt({ dbFile, nodeId, attemptId, authorization });
    consumeExecutionEffectAuthorization(result.effectAuthorization, { provider: "gemini-omni", operation: "text-to-video", nodeId, attemptId });
    return result;
  }
  function unknown(attemptId, nodeId = "video:a") {
    start(attemptId, nodeId);
    recordNodeFailure({ dbFile, nodeId, attemptId, error: "504 after submission", status: "ambiguous" });
  }
  function decision(attemptId, decisionId = `decision:${attemptId}`, nodeId = "video:a") {
    return { schema: "mkt-videos/human-retry-decision@1", decisionId, planFingerprint: plan.fingerprint, productionId: plan.spec.name, actor: "human:fixture", reason: "Explicit replacement despite unknown effect", acknowledgeUnknownEffect: true, attempts: [{ nodeId, attemptId }] };
  }
  function release(value) {
    return value.attempts.map(({ attemptId }) => {
      const lease = producer.tryAcquire({ requestId: `request:${attemptId}`, productionId: plan.spec.name, clientId: "client:fixture", resources: ["provider:omni"] }).lease;
      producer.detachRemoteLease({ leaseId: lease.leaseId, operationId: `omni:${attemptId}`, attemptId, requestFingerprint: `fingerprint:${attemptId}` });
      producer.release(lease.leaseId);
      return admin.authorizeRemoteReplacement({ operationId: `omni:${attemptId}`, attemptId, productionId: plan.spec.name, clientId: "client:fixture", requestFingerprint: `fingerprint:${attemptId}`, decisionId: value.decisionId, actor: value.actor, reason: value.reason, confirmHuman: true, acknowledgeUnknownEffect: true });
    });
  }
  function rows(table) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); } finally { db.close(); }
  }
  return { dbFile, plan, issue, start, unknown, decision, release, rows, snapshot: () => materializeExecutionSnapshot({ dbFile }) };
}

test("human retry fails closed before broker release and grants require exact immutable proofs", async (t) => {
  const f = await fixture(t, 2);
  f.unknown("old");
  const decision = { ...f.decision("old"), unsubmittedScenes: [{ sceneId: "b", attemptId: "draft-nonce:b" }] };
  const args = { dbFile: f.dbFile, plan: f.plan, decision, confirmHuman: true };
  const before = f.rows("events");
  assert.throws(() => authorizeJournalNode({ dbFile: f.dbFile, nodeId: "video:a", authorization: f.issue() }), /estado ambiguous/);
  assert.throws(() => beginNodeAttempt({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "blind" }), /não autoriza/);
  assert.deepEqual(prepareHumanRetryAuthorization(args).decision.unsubmittedScenes, decision.unsubmittedScenes);
  assert.deepEqual(f.rows("events"), before);
  for (const confirmHuman of [false, "true", undefined]) assert.throws(() => prepareHumanRetryAuthorization({ ...args, confirmHuman }), /confirmação humana/);
  for (const change of [{ acknowledgeUnknownEffect: false }, { productionId: "other" }, { planFingerprint: "0".repeat(64) }, { attempts: [{ nodeId: "video:a", attemptId: "different" }] }, { attempts: [decision.attempts[0], decision.attempts[0]] }]) assert.throws(() => prepareHumanRetryAuthorization({ ...args, decision: { ...decision, ...change } }));
  assert.throws(() => registerHumanRetryAuthorization(args), /liberação administrativa/);
  const administrativeReleases = f.release(decision);
  assert.throws(() => registerHumanRetryAuthorization({ ...args, administrativeReleases: [{ ...administrativeReleases[0], reason: "tampered" }] }), /Integridade/);
  assert.throws(() => registerHumanRetryAuthorization({ ...args, administrativeReleases, fault: "after_human_retry_registered" }), /fault injection/);
  assert.equal(f.rows("human_retry_decisions").length, 0);
  assert.deepEqual(f.rows("events"), before);
  const registered = registerHumanRetryAuthorization({ ...args, administrativeReleases });
  assert.equal(registered.snapshot.nodes["video:a"].status, "ambiguous");
  assert.equal(registered.snapshot.nodes["video:a"].humanRetryAuthorization.status, "issued");
  const registeredEvents = f.rows("events");
  assert.equal(registerHumanRetryAuthorization({ ...args, administrativeReleases }).replayed, true);
  assert.deepEqual(f.rows("events"), registeredEvents);
  assert.throws(() => prepareHumanRetryAuthorization({ ...args, decision: { ...decision, reason: "changed" } }), /divergente/);
  assert.throws(() => prepareHumanRetryAuthorization({ ...args, decision: { ...decision, decisionId: "another" } }), /já possui/);
});

test("exact grant consumes once atomically, preserves unknown attempt and leaves base scene budget available", async (t) => {
  const f = await fixture(t, 2);
  f.unknown("old");
  const decision = { ...f.decision("old"), unsubmittedScenes: [{ sceneId: "b", attemptId: "draft-nonce:b" }] };
  const args = { dbFile: f.dbFile, plan: f.plan, decision, confirmHuman: true, administrativeReleases: f.release(decision) };
  registerHumanRetryAuthorization(args);
  assert.throws(() => claimNodeReconciliation({ dbFile: f.dbFile, nodeId: "video:a" }), /preservada/);
  const authorization = f.issue();
  authorizeJournalNode({ dbFile: f.dbFile, nodeId: "video:a", authorization });
  assert.throws(() => beginNodeAttempt({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "new", authorization, fault: "after_human_retry_consumed" }), /fault injection/);
  assert.equal(f.snapshot().nodes["video:a"].humanRetryAuthorization.status, "issued");
  assert.equal(f.rows("attempts").some(row => row.attempt_id === "new"), false);
  assert.equal(f.rows("human_retry_authorizations")[0].status, "issued");
  const started = beginNodeAttempt({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "new", authorization });
  assert.deepEqual(started.humanRetry, { decisionId: decision.decisionId, oldAttemptId: "old" });
  consumeExecutionEffectAuthorization(started.effectAuthorization, { provider: "gemini-omni", operation: "text-to-video", nodeId: "video:a", attemptId: "new" });
  assert.throws(() => beginNodeAttempt({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "duplicate", authorization }), /não autoriza/);
  assert.throws(() => persistJournalProviderHandle({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "old", handle: { fileId: "late" } }), /preservada/);
  assert.throws(() => recordNodeCompletion({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "old", reconciled: true }), /preservada/);
  recordNodeCompletion({ dbFile: f.dbFile, nodeId: "video:a", attemptId: "new" });
  f.start("untouched-base", "video:b");
  recordNodeCompletion({ dbFile: f.dbFile, nodeId: "video:b", attemptId: "untouched-base" });
  assert.equal(f.rows("attempts").find(row => row.attempt_id === "old").status, "ambiguous");
  assert.equal(f.rows("human_retry_authorizations")[0].consumed_by_attempt_id, "new");
  const beforeReplay = f.rows("events");
  assert.equal(registerHumanRetryAuthorization(args).replayed, true);
  assert.deepEqual(f.rows("events"), beforeReplay);
  assert.equal(f.snapshot().nodes["video:a"].humanRetryAuthorization.status, "consumed");
});

test("each extra submission needs its own exact human grant and frozen maxAttempts remains three", async (t) => {
  const f = await fixture(t);
  f.unknown("attempt:1");
  for (const number of [1, 2]) {
    const decision = f.decision(`attempt:${number}`);
    registerHumanRetryAuthorization({ dbFile: f.dbFile, plan: f.plan, decision, confirmHuman: true, administrativeReleases: f.release(decision) });
    f.unknown(`attempt:${number + 1}`);
    assert.throws(() => authorizeJournalNode({ dbFile: f.dbFile, nodeId: "video:a", authorization: f.issue() }), /estado ambiguous/);
  }
  assert.equal(f.snapshot().nodes["video:a"].attempts, 3);
  assert.equal(f.rows("attempts").filter(row => row.node_id === "video:a" && row.status === "ambiguous").length, 3);
  assert.equal(f.rows("human_retry_authorizations").filter(row => row.status === "consumed").length, 2);
  assert.throws(() => prepareHumanRetryAuthorization({ dbFile: f.dbFile, plan: f.plan, decision: f.decision("attempt:3"), confirmHuman: true }), /maxAttempts 3/);
});
