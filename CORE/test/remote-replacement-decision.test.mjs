import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assertRemoteReplacementDecision, createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "remote-replacement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbFile = path.join(root, "runtime.sqlite");
  const alive = new Set([101, 202]);
  const options = { dbFile, capacities: { "provider:omni": 3 }, isProcessAlive: (pid) => alive.has(pid) };
  const producer = createResourceBroker({ ...options, owner: { pid: 101, nonce: "producer" } });
  const admin = createResourceBroker({ ...options, owner: { pid: 202, nonce: "admin" } });
  function reserve(id, { release = true } = {}) {
    const lease = producer.tryAcquire({ requestId: `request:${id}`, productionId: "production:a", clientId: "client:a", resources: ["provider:omni"] }).lease;
    producer.detachRemoteLease({ leaseId: lease.leaseId, operationId: `omni:${id}`, attemptId: id, requestFingerprint: `fingerprint:${id}` });
    if (release) producer.release(lease.leaseId);
    return { lease, decision: { operationId: `omni:${id}`, attemptId: id, productionId: "production:a", clientId: "client:a", requestFingerprint: `fingerprint:${id}`, decisionId: `decision:${id}`, actor: "human:fixture", reason: "Explicit replacement despite unknown remote effect", confirmHuman: true, acknowledgeUnknownEffect: true } };
  }
  function rows(table) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); }
    finally { db.close(); }
  }
  return { dbFile, producer, admin, reserve, rows, alive };
}

test("human replacement releases only the named reservation and keeps unknown effects and remote rows intact", async (t) => {
  const f = await fixture(t);
  const { decision } = f.reserve("target");
  f.reserve("untouched");
  f.reserve("third");
  const before = f.rows("broker_remote_operations");
  const capacities = f.rows("broker_meta");
  const receipt = f.admin.authorizeRemoteReplacement(decision);
  assert.equal(assertRemoteReplacementDecision(receipt).effectStatus, "unknown");
  assert.equal(receipt.reservationDisposition, "administratively-released");
  assert.deepEqual(f.rows("broker_remote_operations"), before);
  assert.deepEqual(f.rows("broker_meta"), capacities);
  const snapshot = buildRuntimeOperationsSnapshot({ dbFile: f.dbFile }).broker;
  assert.equal(snapshot.used["provider:omni"], 2);
  assert.equal(snapshot.remoteInFlight, 2);
  assert.equal(snapshot.remoteUnknown, 3);
  assert.equal(snapshot.administrativelyReleased, 1);
  assert.equal(snapshot.remoteOperations.find(r => r.operationId === "omni:target").externalEffectUnknown, true);
  assert.equal(snapshot.remoteOperations.find(r => r.operationId === "omni:untouched").occupiesRemoteCapacity, true);
  const replacement = f.admin.tryAcquire({ requestId: "replacement", productionId: "production:a", clientId: "client:a", resources: ["provider:omni"] });
  assert.equal(replacement.status, "acquired");
  assert.equal(f.admin.tryAcquire({ requestId: "extra", productionId: "production:b", clientId: "client:b", resources: ["provider:omni"] }).status, "queued");
  assert.equal(f.admin.readRemoteOperation("omni:target").terminalProof, null);
  assert.equal(f.admin.readRemoteOperation("omni:target").state, "submitting");
});

test("both literal confirmations and all target identities are required", async (t) => {
  const f = await fixture(t);
  const { decision } = f.reserve("target");
  for (const key of ["confirmHuman", "acknowledgeUnknownEffect"]) {
    for (const value of [undefined, false, "true"]) assert.throws(() => f.admin.authorizeRemoteReplacement({ ...decision, [key]: value }), /exige confirmHuman/);
  }
  for (const key of ["operationId", "attemptId", "productionId", "clientId", "requestFingerprint"]) {
    assert.throws(() => f.admin.authorizeRemoteReplacement({ ...decision, [key]: "different" }), /Identidade/);
  }
  assert.equal(f.rows("broker_remote_replacement_decisions").length, 0);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: f.dbFile }).broker.used["provider:omni"], 1);
});

test("same decision replays exactly once, can cover exact operations, and rejects changed content or modification", async (t) => {
  const f = await fixture(t);
  const { decision } = f.reserve("target");
  const other = f.reserve("other");
  const first = f.admin.authorizeRemoteReplacement(decision);
  assert.deepEqual(f.admin.authorizeRemoteReplacement(decision), first);
  assert.equal(f.rows("broker_remote_replacement_decisions").length, 1);
  for (const key of ["decisionId", "actor", "reason"]) assert.throws(() => f.admin.authorizeRemoteReplacement({ ...decision, [key]: "different" }), /divergente/);
  const second = f.admin.authorizeRemoteReplacement({ ...other.decision, decisionId: decision.decisionId });
  assert.equal(second.decisionId, first.decisionId);
  assert.notEqual(second.operationId, first.operationId);
  assert.equal(f.rows("broker_remote_replacement_decisions").length, 2);
  assert.throws(() => assertRemoteReplacementDecision({ ...first, reason: "tampered" }), /Integridade/);
  const db = new DatabaseSync(f.dbFile);
  try {
    assert.throws(() => db.exec("UPDATE broker_remote_replacement_decisions SET decision_hash='tampered'"), /append-only/);
    assert.throws(() => db.exec("DELETE FROM broker_remote_replacement_decisions"), /append-only/);
  } finally { db.close(); }
});

test("known handle and terminal observation cannot be replaced as unknown", async (t) => {
  const f = await fixture(t);
  const { decision } = f.reserve("known");
  f.producer.bindRemoteHandle({ operationId: decision.operationId, attemptId: decision.attemptId, handle: { fileId: "file:known" } });
  assert.throws(() => f.admin.authorizeRemoteReplacement(decision), /sem handle ou prova terminal/);
  const claim = f.producer.claimRemoteOperation({ operationId: decision.operationId });
  f.producer.recordRemoteObservation({ operationId: decision.operationId, claimToken: claim.claimToken, observation: { fileId: "file:known", classification: "ready", zeroPost: true } });
  assert.throws(() => f.admin.authorizeRemoteReplacement(decision), /sem handle ou prova terminal/);
  assert.equal(f.rows("broker_remote_replacement_decisions").length, 0);
});

test("live producer lease or live observer claim blocks administrative release", async (t) => {
  const f = await fixture(t);
  const { decision, lease } = f.reserve("target", { release: false });
  assert.throws(() => f.admin.authorizeRemoteReplacement(decision), /produtor vivo/);
  f.producer.release(lease.leaseId);
  const claim = f.producer.claimRemoteOperation({ operationId: decision.operationId });
  assert.throws(() => f.admin.authorizeRemoteReplacement(decision), /observador vivo/);
  f.producer.releaseRemoteClaim({ operationId: decision.operationId, claimToken: claim.claimToken });
  assert.equal(f.admin.authorizeRemoteReplacement(decision).attemptId, "target");
});

test("corrupt administrative evidence fails closed in both admission and read-only reports", async (t) => {
  const f = await fixture(t);
  const { decision } = f.reserve("target");
  const db = new DatabaseSync(f.dbFile);
  try {
    db.prepare("INSERT INTO broker_remote_replacement_decisions VALUES(?,?,?,?,?,?,?,?,?)").run(decision.decisionId, decision.operationId, decision.attemptId, decision.productionId, decision.clientId, decision.requestFingerprint, "invalid", JSON.stringify(decision), new Date().toISOString());
  } finally { db.close(); }
  assert.throws(() => buildRuntimeOperationsSnapshot({ dbFile: f.dbFile }));
  assert.throws(() => f.admin.tryAcquire({ requestId: "blocked", productionId: "production:a", clientId: "client:a", resources: ["provider:omni"] }));
});
