import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";

function legacyFixture(dbFile, startedAt) {
  createResourceBroker({ dbFile, capacities: { "provider:omni": 1 }, isProcessAlive: () => false });
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("DROP VIEW broker_leases; ALTER TABLE broker_resource_leases_v2 RENAME TO broker_leases;");
    db.prepare("INSERT INTO broker_processes(owner_nonce,pid,process_started_at,heartbeat_at,runtime_protocol) VALUES(?,?,?,?,1)")
      .run("legacy-owner", process.pid, startedAt, new Date().toISOString());
  } finally { db.close(); }
}

test("Windows distingue PID reciclado antes do boot e mantém produtor atual bloqueado", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-windows-boot-"));
  try {
    const oldFile = path.join(root, "before-boot.sqlite");
    legacyFixture(oldFile, "1980-01-01T00:00:00.000Z");
    const broker = createResourceBroker({ dbFile: oldFile, capacities: { "provider:omni": 1 } });
    const read = new DatabaseSync(oldFile, { readOnly: true });
    try {
      assert.equal(read.prepare("SELECT type FROM sqlite_master WHERE name='broker_leases'").get().type, "view");
      assert.equal(read.prepare("SELECT count(*) AS n FROM broker_processes WHERE owner_nonce='legacy-owner'").get().n, 1, "migração conserva histórico");
    } finally { read.close(); }
    const acquired = broker.tryAcquire({ productionId: "fixture", clientId: "fixture", resources: ["provider:omni"] });
    assert.equal(acquired.status, "acquired");
    assert.equal(broker.detachRemoteLease({ leaseId: acquired.lease.leaseId, operationId: "fixture-operation", attemptId: "fixture-attempt" }).state, "submitting");

    const liveFile = path.join(root, "after-boot.sqlite");
    legacyFixture(liveFile, new Date().toISOString());
    assert.throws(() => createResourceBroker({ dbFile: liveFile }), /Runtime antigo ainda possui produtor vivo/);
    const unknownFile = path.join(root, "unknown-start.sqlite");
    legacyFixture(unknownFile, "invalid-start");
    assert.throws(() => createResourceBroker({ dbFile: unknownFile }), /Runtime antigo ainda possui produtor vivo/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
