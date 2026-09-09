import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DEFAULT_CAPACITY_WAIT_MS,
  createResourceBroker,
} from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";
import { evaluateRuntimeAdmission } from "../lib/media-pipeline/runtime-admission.mjs";

// Leitura passiva: é a mesma que o `jobs --runtime-db` usa. O broker não
// tem mais um snapshot próprio que escrevia enquanto se dizia readOnly.
const observe = (dbFile) => buildRuntimeOperationsSnapshot({ dbFile }).broker;
const usedOf = (dbFile, resource) => observe(dbFile).used[resource] ?? 0;

test("erro de WAL diferente de busy permanece terminal e fecha a conexão incompleta", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-wal-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const failure = Object.assign(new Error("WAL_FIXTURE_FAILURE"), { errcode: 19 });
  const originalExec = DatabaseSync.prototype.exec;
  const originalClose = DatabaseSync.prototype.close;
  let attempts = 0;
  let opened;
  let closed = false;
  DatabaseSync.prototype.exec = function(sql) {
    if (sql === "PRAGMA journal_mode=WAL") { attempts++; opened = this; throw failure; }
    return originalExec.call(this, sql);
  };
  DatabaseSync.prototype.close = function() { if (this === opened) closed = true; return originalClose.call(this); };
  try {
    assert.throws(() => createResourceBroker({ dbFile: path.join(root, "runtime.sqlite") }), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(closed, true);
  } finally {
    DatabaseSync.prototype.exec = originalExec;
    DatabaseSync.prototype.close = originalClose;
  }
});

// Estado lógico completo, por conexão readOnly. Serve para provar que uma
// leitura não muda nada — e que a manutenção declarada muda.
function logicalState(dbFile) {
  const db = new DatabaseSync(path.resolve(dbFile), { readOnly: true });
  try {
    return JSON.stringify(["broker_processes", "broker_requests", "broker_leases", "broker_fairness", "broker_meta"]
      .map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  } finally { db.close(); }
}

test("broker aplica capacidade global e fairness por cliente entre processos", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-broker-"));
  try {
    let now = new Date("2026-08-13T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const common = { dbFile, capacities: { "provider:omni": 1 }, clock: () => now, isProcessAlive: () => true };
    const alpha = createResourceBroker({ ...common, owner: { pid: 101, nonce: "alpha-process", startedAt: now } });
    const beta = createResourceBroker({ ...common, owner: { pid: 202, nonce: "beta-process", startedAt: now } });
    const first = alpha.tryAcquire({ requestId: "alpha-1", productionId: "p1", clientId: "alpha", priority: "scheduled", resources: ["provider:omni"] });
    assert.equal(first.status, "acquired");
    now = new Date(now.getTime() + 1_000);
    assert.equal(alpha.tryAcquire({ requestId: "alpha-2", productionId: "p2", clientId: "alpha", priority: "scheduled", resources: ["provider:omni"] }).status, "queued");
    assert.equal(beta.tryAcquire({ requestId: "beta-1", productionId: "p3", clientId: "beta", priority: "scheduled", resources: ["provider:omni"] }).status, "queued");
    assert.equal(alpha.release(first.lease.leaseId), true);
    // A tentativa de alpha executa a fila inteira, mas beta recebe primeiro
    // porque alpha acabou de consumir o recurso no mesmo nível de prioridade.
    assert.equal(alpha.tryAcquire({ requestId: "alpha-2", productionId: "p2", clientId: "alpha", priority: "scheduled", resources: ["provider:omni"] }).status, "queued");
    const betaLease = beta.tryAcquire({ requestId: "beta-1", productionId: "p3", clientId: "beta", priority: "scheduled", resources: ["provider:omni"] });
    assert.equal(betaLease.status, "acquired");
    assert.equal(usedOf(dbFile, "provider:omni"), 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recuperação de lease órfão libera somente capacidade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-orphan-"));
  try {
    let now = new Date("2026-08-13T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const dead = createResourceBroker({ dbFile, capacities: { "gpu:shared": 1 }, owner: { pid: 303, nonce: "dead", startedAt: now }, staleAfterMs: 1_000, clock: () => now, isProcessAlive: (pid) => pid !== 303 });
    const lease = dead.tryAcquire({ requestId: "dead-request", productionId: "dead-production", clientId: "client-a", resources: ["gpu:shared"] });
    assert.equal(lease.status, "acquired");
    now = new Date(now.getTime() + 2_000);
    const live = createResourceBroker({ dbFile, capacities: { "gpu:shared": 1 }, owner: { pid: 404, nonce: "live", startedAt: now }, staleAfterMs: 1_000, clock: () => now, isProcessAlive: (pid) => pid !== 303 });
    const recovered = live.tryAcquire({ requestId: "live-request", productionId: "live-production", clientId: "client-b", resources: ["gpu:shared"] });
    assert.equal(recovered.status, "acquired");
    assert.equal(recovered.recoveredOrphans, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("admission control falha fechado antes do broker", () => {
  const blocked = evaluateRuntimeAdmission({
    capability: { id: "omni", status: "supported", proof: { valid: false } },
    rights: { id: "rights:1", status: "allowed", revoked: false },
    freeBytes: 10,
    requiredBytes: 100,
    pendingAmbiguous: true,
  });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blockers, ["ambiguous_attempt_requires_reconciliation", "capability_not_proved", "insufficient_disk_space"]);
});

test("timeout remove a request abandonada e não vaza capacidade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-timeout-"));
  try {
    const dbFile = path.join(root, "runtime.sqlite");
    const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 } });
    const occupied = broker.tryAcquire({ requestId: "occupied", productionId: "p1", clientId: "alpha", resources: ["provider:omni"] });
    assert.equal(occupied.status, "acquired");
    const timedOut = await broker.acquire({ requestId: "abandoned", productionId: "p2", clientId: "beta", resources: ["provider:omni"] }, { timeoutMs: 5, pollMs: 1 });
    assert.equal(timedOut.status, "timeout");
    assert.equal(observe(dbFile).queue.some((entry) => entry.requestId === "abandoned"), false);
    assert.equal(broker.release(occupied.lease.leaseId), true);
    const next = broker.tryAcquire({ requestId: "next", productionId: "p3", clientId: "gamma", resources: ["provider:omni"] });
    assert.equal(next.status, "acquired");
    assert.equal(usedOf(dbFile, "provider:omni"), 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("request órfã volta à fila somente quando o mesmo dono reaparece", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-requeue-"));
  try {
    let now = new Date("2026-08-13T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const original = createResourceBroker({ dbFile, capacities: { "gpu:shared": 1 }, owner: { pid: 501, nonce: "owner-a", startedAt: now }, staleAfterMs: 1_000, clock: () => now, isProcessAlive: () => true });
    const first = original.tryAcquire({ requestId: "same-request", productionId: "p1", clientId: "alpha", resources: ["gpu:shared"] });
    assert.equal(first.status, "acquired");
    now = new Date(now.getTime() + 2_000);
    const recovery = createResourceBroker({ dbFile, capacities: { "gpu:shared": 1 }, owner: { pid: 502, nonce: "owner-b", startedAt: now }, staleAfterMs: 1_000, clock: () => now, isProcessAlive: (pid) => pid !== 501 });
    const second = recovery.tryAcquire({ requestId: "recovery", productionId: "p2", clientId: "beta", resources: ["gpu:shared"] });
    assert.equal(second.status, "acquired");
    assert.equal(recovery.release(second.lease.leaseId), true);
    const resumed = createResourceBroker({ dbFile, capacities: { "gpu:shared": 1 }, owner: { pid: 501, nonce: "owner-a", startedAt: now }, staleAfterMs: 1_000, clock: () => now, isProcessAlive: () => true });
    assert.equal(resumed.tryAcquire({ requestId: "same-request", productionId: "p1", clientId: "alpha", resources: ["gpu:shared"] }).status, "acquired");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exceção durante acquire cancela a request ainda não concedida", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-exception-"));
  try {
    const dbFile = path.join(root, "runtime.sqlite");
    const holder = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 }, owner: { pid: 601, nonce: "holder", startedAt: new Date() }, isProcessAlive: () => true });
    const lease = holder.tryAcquire({ requestId: "occupied", productionId: "p1", clientId: "alpha", resources: ["provider:omni"] });
    const waiting = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 }, owner: { pid: 602, nonce: "waiting", startedAt: new Date() }, isProcessAlive: () => true });
    assert.equal(waiting.tryAcquire({ requestId: "older", productionId: "p2", clientId: "beta", resources: ["provider:omni"] }).status, "queued");
    const failing = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 }, owner: { pid: 603, nonce: "failing", startedAt: new Date() }, isProcessAlive: () => { throw new Error("probe failure"); } });
    await assert.rejects(
      failing.acquire({ requestId: "must-not-leak", productionId: "p3", clientId: "gamma", resources: ["provider:omni"] }, { timeoutMs: 20, pollMs: 1 }),
      /probe failure/,
    );
    assert.equal(observe(dbFile).queue.some((entry) => entry.requestId === "must-not-leak"), false);
    holder.release(lease.lease.leaseId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("claim de fila expira mesmo quando o processo continua emitindo heartbeat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-claim-"));
  try {
    let now = new Date("2026-08-13T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const common = { dbFile, capacities: { "gpu:shared": 1 }, requestClaimTtlMs: 1_000, clock: () => now, isProcessAlive: () => true };
    const holder = createResourceBroker({ ...common, owner: { pid: 701, nonce: "holder", startedAt: now } });
    const waiter = createResourceBroker({ ...common, owner: { pid: 702, nonce: "waiter", startedAt: now } });
    const contender = createResourceBroker({ ...common, owner: { pid: 703, nonce: "contender", startedAt: now } });
    const occupied = holder.tryAcquire({ requestId: "occupied", productionId: "p1", clientId: "alpha", resources: ["gpu:shared"] });
    assert.equal(waiter.tryAcquire({ requestId: "abandoned", productionId: "p2", clientId: "beta", resources: ["gpu:shared"] }).status, "queued");
    now = new Date(now.getTime() + 2_000);
    waiter.maintain();
    holder.release(occupied.lease.leaseId);
    assert.equal(contender.tryAcquire({ requestId: "live", productionId: "p3", clientId: "gamma", resources: ["gpu:shared"] }).status, "acquired");
    assert.equal(observe(dbFile).queue.find((entry) => entry.requestId === "abandoned")?.status, "orphaned");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lease concedido por outro processo na corrida do cancelamento não fica preso", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-settle-"));
  try {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const common = { dbFile, capacities: { "provider:omni": 2 }, clock: () => now, isProcessAlive: () => true };
    const holder = createResourceBroker({ ...common, owner: { pid: 801, nonce: "holder", startedAt: now } });
    const waiter = createResourceBroker({ ...common, owner: { pid: 802, nonce: "waiter", startedAt: now } });
    const outsider = createResourceBroker({ ...common, owner: { pid: 803, nonce: "outsider", startedAt: now } });

    const busy = holder.tryAcquire({ requestId: "busy-1", productionId: "p1", clientId: "alpha", resources: [{ id: "provider:omni", weight: 2 }] });
    assert.equal(busy.status, "acquired");
    assert.equal(waiter.tryAcquire({ requestId: "waiting", productionId: "p2", clientId: "beta", resources: ["provider:omni"] }).status, "queued");

    // O laço de concessão atende qualquer candidato da fila: quem concede a
    // vaga do waiter é o poll do outsider, sem o waiter estar olhando.
    holder.release(busy.lease.leaseId);
    outsider.tryAcquire({ requestId: "outsider-1", productionId: "p3", clientId: "gama", resources: ["provider:omni"] });
    assert.equal(observe(dbFile).leases.some((lease) => lease.requestId === "waiting"), true);

    // Encerrar preservando: o chamador recebe a vaga em vez de perdê-la.
    const kept = waiter.settleRequest("waiting", { keepGrantedLease: true });
    assert.equal(kept.outcome, "granted");
    assert.equal(kept.lease.requestId, "waiting");

    // Encerrar de verdade: a vaga volta na hora, sem esperar TTL de órfão.
    const released = waiter.settleRequest("waiting");
    assert.equal(released.outcome, "released");
    assert.equal(usedOf(dbFile, "provider:omni"), 1);
    assert.equal(observe(dbFile).leases.some((lease) => lease.requestId === "waiting"), false);
    assert.equal(waiter.settleRequest("waiting").outcome, "absent");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("espera por capacidade é longa, observável e não vira erro de geração", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-wait-"));
  try {
    // 30 s era o padrão antigo: uma geração vizinha de minutos fazia a
    // próxima chamada estourar antes da primeira vaga.
    assert.equal(DEFAULT_CAPACITY_WAIT_MS, 900_000);
    const dbFile = path.join(root, "runtime.sqlite");
    const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 } });
    const busy = broker.tryAcquire({ requestId: "busy", productionId: "p1", clientId: "alpha", resources: ["provider:omni"] });
    const announcements = [];
    const waited = await broker.acquire(
      { requestId: "queued-then-granted", productionId: "p2", clientId: "beta", resources: ["provider:omni"] },
      {
        timeoutMs: 5_000,
        pollMs: 5,
        maxPollMs: 20,
        onQueued: (event) => {
          announcements.push(event);
          broker.release(busy.lease.leaseId);
        },
      },
    );
    assert.equal(waited.status, "acquired");
    assert.equal(announcements.length, 1);
    assert.equal(announcements[0].status, "queued");
    assert.equal(typeof announcements[0].deadlineAt, "string");
    assert.equal(typeof waited.waitedMs, "number");
    broker.release(waited.lease.leaseId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pedido pesado envelhecido reserva a vaga em vez de ser ultrapassado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-aging-"));
  try {
    let now = new Date("2026-09-05T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const common = { dbFile, capacities: { "provider:omni": 3 }, agingAfterMs: 60_000, clock: () => now, isProcessAlive: () => true };
    const heavy = createResourceBroker({ ...common, owner: { pid: 901, nonce: "heavy", startedAt: now } });
    const light = createResourceBroker({ ...common, owner: { pid: 902, nonce: "light", startedAt: now } });

    const busy = light.tryAcquire({ requestId: "busy", productionId: "lote", clientId: "lote", resources: ["provider:omni"] });
    assert.equal(busy.status, "acquired");
    assert.equal(heavy.tryAcquire({ requestId: "draft", productionId: "draft", clientId: "draft", resources: [{ id: "provider:omni", weight: 3 }] }).status, "queued");

    // Recém-chegado: a vazão do lote não pode cair por causa dele.
    assert.equal(light.tryAcquire({ requestId: "item-novo", productionId: "lote", clientId: "lote", resources: ["provider:omni"] }).status, "acquired");

    // Envelhecido: as vagas passam a ser reservadas para o pedido pesado.
    now = new Date(now.getTime() + 61_000);
    heavy.tryAcquire({ requestId: "draft", productionId: "draft", clientId: "draft", resources: [{ id: "provider:omni", weight: 3 }] });
    assert.equal(light.tryAcquire({ requestId: "item-tardio", productionId: "lote", clientId: "lote", resources: ["provider:omni"] }).status, "queued");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manutenção poda o histórico e a leitura operacional não escreve", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-retention-"));
  try {
    let now = new Date("2026-09-05T12:00:00.000Z");
    const dbFile = path.join(root, "runtime.sqlite");
    const broker = createResourceBroker({
      dbFile,
      capacities: { "provider:omni": 1 },
      owner: { pid: 1001, nonce: "worker", startedAt: now },
      clock: () => now,
      isProcessAlive: () => true,
    });
    for (const id of ["a", "b", "c"]) {
      const lease = broker.tryAcquire({ requestId: id, productionId: "p", clientId: "c", resources: ["provider:omni"] });
      broker.release(lease.lease.leaseId);
    }
    const countRequests = () => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try { return db.prepare("SELECT count(*) n FROM broker_requests").get().n; } finally { db.close(); }
    };
    assert.equal(countRequests(), 3);

    // Leitura passiva não muda estado lógico nenhum.
    const before = logicalState(dbFile);
    const report = buildRuntimeOperationsSnapshot({ dbFile });
    assert.equal(report.readOnly, true);
    assert.equal(report.broker.queued, 0);
    assert.equal(report.broker.orphaned, 0);
    assert.equal(logicalState(dbFile), before);

    // Manutenção declarada muda — e é ela quem poda o que já terminou.
    now = new Date(now.getTime() + 172_800_000);
    const maintained = broker.maintain();
    assert.equal(maintained.readOnly, false);
    assert.equal(maintained.pruned.released, 3);
    assert.equal(countRequests(), 0);
    assert.notEqual(logicalState(dbFile), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("índices do broker existem para não varrer o histórico a cada poll", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-index-"));
  try {
    const dbFile = path.join(root, "runtime.sqlite");
    createResourceBroker({ dbFile, capacities: { "provider:omni": 1 } });
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
      for (const expected of ["broker_requests_state_priority", "broker_requests_owner", "broker_leases_owner", "broker_processes_heartbeat"]) {
        assert.equal(indexes.has(expected), true, `índice ausente: ${expected}`);
      }
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM broker_requests WHERE state='queued' AND due_at<=?").all().map((row) => row.detail).join(" ");
      assert.match(plan, /USING INDEX broker_requests_state_priority/);
    } finally { db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("capacidade divergente entre builds vale pelo menor, não pelo mais permissivo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-capacity-"));
  try {
    const dbFile = path.join(root, "runtime.sqlite");
    const estrito = createResourceBroker({ dbFile, capacities: { "provider:omni": 1 }, owner: { pid: 1101, nonce: "estrito", startedAt: new Date() }, isProcessAlive: () => true });
    assert.deepEqual(estrito.capacityDivergences, []);
    assert.equal(estrito.capacities["provider:omni"], 1);

    // Build mais permissivo chega depois: não pode abrir vaga a mais.
    const permissivo = createResourceBroker({ dbFile, capacities: { "provider:omni": 3 }, owner: { pid: 1102, nonce: "permissivo", startedAt: new Date() }, isProcessAlive: () => true });
    assert.equal(permissivo.capacities["provider:omni"], 1);
    assert.deepEqual(permissivo.capacityDivergences, [{ resource: "provider:omni", stored: 1, declared: 3, effective: 1 }]);

    const primeiro = permissivo.tryAcquire({ requestId: "um", productionId: "p1", clientId: "a", resources: ["provider:omni"] });
    assert.equal(primeiro.status, "acquired");
    assert.equal(permissivo.tryAcquire({ requestId: "dois", productionId: "p2", clientId: "b", resources: ["provider:omni"] }).status, "queued");

    // Subir o teto de propósito continua possível, mas é explícito.
    permissivo.release(primeiro.lease.leaseId);
    const reset = createResourceBroker({ dbFile, capacities: { "provider:omni": 3 }, resetCapacities: true, owner: { pid: 1103, nonce: "reset", startedAt: new Date() }, isProcessAlive: () => true });
    assert.equal(reset.capacities["provider:omni"], 3);
    assert.deepEqual(reset.capacityDivergences, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recurso novo de um build mais recente é aceito sem apagar o mapa acordado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-newkey-"));
  try {
    const dbFile = path.join(root, "runtime.sqlite");
    createResourceBroker({ dbFile, capacities: { "provider:omni": 2 } });
    const novo = createResourceBroker({ dbFile, capacities: { "provider:omni": 2, "provider:flow": 1 } });
    assert.equal(novo.capacities["provider:omni"], 2);
    assert.equal(novo.capacities["provider:flow"], 1);
    assert.deepEqual(novo.capacityDivergences, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
