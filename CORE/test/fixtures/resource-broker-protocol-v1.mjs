import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

export const RESOURCE_BROKER_SCHEMA = "mkt-videos/resource-broker@1";
export const RESOURCE_LEASE_SCHEMA = "mkt-videos/resource-lease@1";

export const RESOURCE_PRIORITIES = Object.freeze({
  reconcile: 1,
  interactive: 2,
  scheduled: 3,
  derivative: 4,
  cache_warmup: 5,
});

export const DEFAULT_RESOURCE_CAPACITIES = Object.freeze({
  "provider:omni": 3,
  "provider:flow": 1,
  "provider:vids": 1,
  "cpu:ffmpeg": Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4))),
  "io:probe-hash": Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4))),
  "gpu:shared": 1,
  "gpu:whisper": 1,
  "gpu:nvenc": 1,
  "auth-refresh:google": 1,
});

// A lease cobre chamadas de UI cookie-only que podem levar até 15 minutos.
// O TTL precisa sobreviver a uma chamada inteira mesmo antes do primeiro
// heartbeat; 3x o maior timeout padrão mantém a recuperação conservadora.
export const DEFAULT_RESOURCE_STALE_AFTER_MS = 2_700_000;
// Solicitações ainda sem lease precisam provar que o chamador continua
// tentando adquiri-las. O heartbeat do processo, sozinho, não prova isso.
export const DEFAULT_REQUEST_CLAIM_TTL_MS = 30_000;
// Espera por capacidade não é timeout de provedor. Enquanto o job está na
// fila nenhum POST gerativo aconteceu, então esperar é barato e desistir é
// caro: uma geração vizinha de minutos não pode transformar a próxima
// chamada em falha. O timeout do provedor continua sendo outro número,
// resolvido por resolveProviderWaitMs no CLI.
export const DEFAULT_CAPACITY_WAIT_MS = 900_000;
// O poll começa curto para não atrasar a primeira concessão e cresce até um
// teto, porque cada tentativa abre uma transação BEGIN IMMEDIATE — que é
// trava global de escrita. Espera longa com poll fixo de 100 ms serializa
// justamente o paralelismo que o broker existe para permitir.
export const DEFAULT_POLL_MS = 100;
export const DEFAULT_MAX_POLL_MS = 2_000;
// Tempo que um pedido pesado espera antes de passar a reservar as vagas que
// precisa. Curto demais derruba a vazão dos lotes; longo demais deixa um
// draft de peso 3 esperando para sempre atrás de itens de peso 1.
export const DEFAULT_AGING_AFTER_MS = 60_000;
// Retenção: o histórico do broker não tem valor operacional depois que a
// solicitação terminou, e varredura completa a cada poll custa caro.
export const DEFAULT_RETENTION = Object.freeze({
  releasedMs: 86_400_000,
  orphanedMs: 86_400_000,
  processMs: 86_400_000,
  fairnessMs: 2_592_000_000,
  intervalMs: 60_000,
});

const PROCESS_STARTED_AT = new Date().toISOString();
const PROCESS_NONCE = randomUUID();

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function instant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} inválido.`);
  return date;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} deve ser inteiro positivo.`);
  return number;
}

function normalizeCapacities(value) {
  const result = {};
  for (const [resource, capacity] of Object.entries(value ?? {})) {
    result[requiredText(resource, "resource")] = positiveInteger(capacity, `capacity.${resource}`);
  }
  if (!Object.keys(result).length) throw new Error("Broker exige ao menos um recurso.");
  return Object.freeze(result);
}

function normalizeResources(resources, capacities) {
  if (!Array.isArray(resources) || resources.length === 0) throw new Error("resources deve ser lista não vazia.");
  const combined = new Map();
  for (const entry of resources) {
    const id = requiredText(typeof entry === "string" ? entry : entry?.id, "resource.id");
    if (capacities[id] == null) throw new Error(`Recurso não declarado no broker: ${id}.`);
    const weight = positiveInteger(typeof entry === "string" ? 1 : entry?.weight ?? 1, `resource.${id}.weight`);
    combined.set(id, (combined.get(id) ?? 0) + weight);
  }
  const normalized = [...combined].map(([id, weight]) => ({ id, weight })).sort((left, right) => left.id.localeCompare(right.id));
  for (const resource of normalized) {
    if (resource.weight > capacities[resource.id]) throw new Error(`Peso ${resource.weight} excede capacidade de ${resource.id}.`);
  }
  return normalized;
}

// Último objeto criado pelo DDL. Se ele existe, o schema está completo e
// nenhuma abertura precisa pedir trava de escrita para reconferir.
const SCHEMA_SENTINEL = "broker_processes_heartbeat";

const SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS broker_processes(
      owner_nonce TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      process_started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broker_requests(
      request_id TEXT PRIMARY KEY,
      owner_nonce TEXT NOT NULL,
      production_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      priority INTEGER NOT NULL,
      resources_json TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      claimed_at TEXT,
      lease_id TEXT
    );
    CREATE TABLE IF NOT EXISTS broker_leases(
      lease_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      owner_nonce TEXT NOT NULL,
      production_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      resources_json TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broker_fairness(
      client_id TEXT PRIMARY KEY,
      last_granted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broker_meta(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS broker_requests_state_priority ON broker_requests(state,priority,created_at);
    CREATE INDEX IF NOT EXISTS broker_requests_owner ON broker_requests(owner_nonce);
    CREATE INDEX IF NOT EXISTS broker_leases_owner ON broker_leases(owner_nonce);
    CREATE INDEX IF NOT EXISTS ${SCHEMA_SENTINEL} ON broker_processes(heartbeat_at);
`;

function openDatabase(dbFile) {
  const absolute = path.resolve(requiredText(dbFile, "dbFile"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  // busy_timeout tem de valer ANTES de qualquer coisa que dispute trava.
  // Com ele no fim do bloco, dois processos abrindo o runtime ao mesmo
  // tempo caíam em "database is locked" ao negociar o WAL — falha que só
  // aparece com processos de verdade, não com donos simulados.
  db.exec("PRAGMA busy_timeout=10000");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  const schemaReady = db.prepare("SELECT count(*) n FROM sqlite_master WHERE name=?").get(SCHEMA_SENTINEL).n > 0;
  if (!schemaReady) {
    db.exec(SCHEMA_DDL);
    const requestColumns = new Set(db.prepare("PRAGMA table_info(broker_requests)").all().map((column) => column.name));
    if (!requestColumns.has("claimed_at")) db.exec("ALTER TABLE broker_requests ADD COLUMN claimed_at TEXT");
  }
  return { db, absolute };
}

// O teto tem de ser um só entre processos. Cada instância aplicava o
// próprio mapa em `fits`, então dois builds com constantes diferentes
// faziam o limite global valer pelo mais permissivo. O banco passa a
// guardar o mapa acordado, e vale sempre o MENOR dos dois — divergência
// nunca abre vaga a mais. Para subir um limite de propósito, use
// createResourceBroker({ resetCapacities: true }).
function reconcileCapacities(db, localCapacities, { reset = false } = {}) {
  const storedRaw = db.prepare("SELECT value FROM broker_meta WHERE key='capacities'").get()?.value;
  let stored = null;
  try { stored = storedRaw == null ? null : JSON.parse(String(storedRaw)); } catch { stored = null; }
  if (reset || stored == null) {
    db.prepare("INSERT INTO broker_meta(key,value) VALUES('capacities',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(localCapacities));
    return { effective: localCapacities, divergences: [] };
  }
  const effective = {};
  const divergences = [];
  for (const [resource, capacity] of Object.entries(localCapacities)) {
    const previous = Number(stored[resource]);
    if (!Number.isSafeInteger(previous) || previous < 1) {
      effective[resource] = capacity;
      continue;
    }
    effective[resource] = Math.min(previous, capacity);
    if (previous !== capacity) divergences.push({ resource, stored: previous, declared: capacity, effective: effective[resource] });
  }
  if (divergences.length) {
    db.prepare("INSERT INTO broker_meta(key,value) VALUES('capacities',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ ...stored, ...effective }));
  }
  return { effective: Object.freeze(effective), divergences };
}

function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function cleanupOrphans(db, { now, staleAfterMs, isProcessAlive }) {
  const threshold = now.getTime() - staleAfterMs;
  const processes = new Map(db.prepare("SELECT * FROM broker_processes").all().map((row) => [row.owner_nonce, row]));
  let recovered = 0;
  for (const lease of db.prepare("SELECT * FROM broker_leases").all()) {
    const owner = processes.get(lease.owner_nonce);
    const heartbeat = Date.parse(String(lease.heartbeat_at));
    const processHeartbeat = Date.parse(String(owner?.heartbeat_at ?? ""));
    const stale = !Number.isFinite(heartbeat) || heartbeat < threshold;
    const processStale = !Number.isFinite(processHeartbeat) || processHeartbeat < threshold;
    // O instante de início acompanha o PID desde a primeira versão do
    // schema: um prober que saiba compará-lo distingue o dono real de um
    // PID reciclado, sem o qual um processo morto continua parecendo vivo.
    const alive = owner ? isProcessAlive(Number(owner.pid), String(owner.process_started_at)) : false;
    if (!alive || (stale && processStale)) {
      db.prepare("DELETE FROM broker_leases WHERE lease_id=?").run(lease.lease_id);
      db.prepare("UPDATE broker_requests SET state='orphaned',lease_id=NULL WHERE request_id=?").run(lease.request_id);
      recovered += 1;
    }
  }
  return recovered;
}

// Poda o que já terminou. Sem isto o banco acumula uma linha por invocação
// de CLI para sempre, e cada poll paga a varredura desse histórico dentro
// da transação exclusiva — o custo cresce justamente com o paralelismo.
function applyRetention(db, { now, retention, force = false }) {
  const last = Date.parse(String(db.prepare("SELECT value FROM broker_meta WHERE key='last_retention_at'").get()?.value ?? ""));
  if (!force && Number.isFinite(last) && now.getTime() - last < retention.intervalMs) return null;
  const horizon = (ms) => new Date(now.getTime() - ms).toISOString();
  const removed = {
    released: Number(db.prepare("DELETE FROM broker_requests WHERE state='released' AND created_at<?").run(horizon(retention.releasedMs)).changes),
    orphaned: Number(db.prepare("DELETE FROM broker_requests WHERE state='orphaned' AND created_at<?").run(horizon(retention.orphanedMs)).changes),
    processes: Number(db.prepare(`DELETE FROM broker_processes WHERE heartbeat_at<?
      AND owner_nonce NOT IN (SELECT owner_nonce FROM broker_leases)
      AND owner_nonce NOT IN (SELECT owner_nonce FROM broker_requests)`).run(horizon(retention.processMs)).changes),
    fairness: Number(db.prepare("DELETE FROM broker_fairness WHERE last_granted_at<?").run(horizon(retention.fairnessMs)).changes),
  };
  db.prepare("INSERT INTO broker_meta(key,value) VALUES('last_retention_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now.toISOString());
  return removed;
}

function requestOwnerIsFresh(db, request, { now, staleAfterMs, claimTtlMs, isProcessAlive, currentOwnerNonce }) {
  const owner = db.prepare("SELECT * FROM broker_processes WHERE owner_nonce=?").get(request.owner_nonce);
  if (!owner || (request.owner_nonce !== currentOwnerNonce && !isProcessAlive(Number(owner.pid), String(owner.process_started_at)))) return false;
  const heartbeat = Date.parse(String(owner.heartbeat_at));
  const claimedAt = Date.parse(String(request.claimed_at ?? ""));
  return Number.isFinite(heartbeat)
    && heartbeat >= now.getTime() - staleAfterMs
    && Number.isFinite(claimedAt)
    && claimedAt >= now.getTime() - claimTtlMs;
}

function usedResources(db) {
  const used = {};
  for (const row of db.prepare("SELECT resources_json FROM broker_leases").all()) {
    for (const resource of JSON.parse(row.resources_json)) used[resource.id] = (used[resource.id] ?? 0) + resource.weight;
  }
  return used;
}

function fits(resources, used, capacities) {
  return resources.every((resource) => (used[resource.id] ?? 0) + resource.weight <= capacities[resource.id]);
}

function leaseProjection(row) {
  return Object.freeze({
    schema: RESOURCE_LEASE_SCHEMA,
    leaseId: row.lease_id,
    requestId: row.request_id,
    productionId: row.production_id,
    clientId: row.client_id,
    resources: JSON.parse(row.resources_json),
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
  });
}

export function createResourceBroker({
  dbFile,
  capacities = DEFAULT_RESOURCE_CAPACITIES,
  owner = {},
  staleAfterMs = DEFAULT_RESOURCE_STALE_AFTER_MS,
  requestClaimTtlMs = DEFAULT_REQUEST_CLAIM_TTL_MS,
  agingAfterMs = DEFAULT_AGING_AFTER_MS,
  resetCapacities = false,
  retention = DEFAULT_RETENTION,
  clock = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  const normalizedCapacities = normalizeCapacities(capacities);
  const ownerIdentity = Object.freeze({
    pid: positiveInteger(owner.pid ?? process.pid, "owner.pid"),
    nonce: requiredText(owner.nonce ?? PROCESS_NONCE, "owner.nonce"),
    startedAt: instant(owner.startedAt ?? PROCESS_STARTED_AT, "owner.startedAt").toISOString(),
  });
  const staleMs = positiveInteger(staleAfterMs, "staleAfterMs");
  const claimTtlMs = positiveInteger(requestClaimTtlMs, "requestClaimTtlMs");
  const agingMs = positiveInteger(agingAfterMs, "agingAfterMs");
  const retentionPolicy = Object.freeze({
    releasedMs: positiveInteger(retention?.releasedMs ?? DEFAULT_RETENTION.releasedMs, "retention.releasedMs"),
    orphanedMs: positiveInteger(retention?.orphanedMs ?? DEFAULT_RETENTION.orphanedMs, "retention.orphanedMs"),
    processMs: positiveInteger(retention?.processMs ?? DEFAULT_RETENTION.processMs, "retention.processMs"),
    fairnessMs: positiveInteger(retention?.fairnessMs ?? DEFAULT_RETENTION.fairnessMs, "retention.fairnessMs"),
    intervalMs: positiveInteger(retention?.intervalMs ?? DEFAULT_RETENTION.intervalMs, "retention.intervalMs"),
  });
  if (typeof clock !== "function" || typeof isProcessAlive !== "function") throw new Error("clock e isProcessAlive devem ser funções.");
  const opened = openDatabase(dbFile);
  const databaseFile = opened.absolute;
  let reconciled;
  try {
    reconciled = transaction(opened.db, () => reconcileCapacities(opened.db, normalizedCapacities, { reset: resetCapacities }));
  } finally { opened.db.close(); }
  const effectiveCapacities = reconciled.effective;
  const capacityDivergences = Object.freeze(reconciled.divergences);

  function registerHeartbeat(db, now) {
    db.prepare(`INSERT INTO broker_processes(owner_nonce,pid,process_started_at,heartbeat_at)
      VALUES(?,?,?,?) ON CONFLICT(owner_nonce) DO UPDATE SET pid=excluded.pid,heartbeat_at=excluded.heartbeat_at`)
      .run(ownerIdentity.nonce, ownerIdentity.pid, ownerIdentity.startedAt, now.toISOString());
  }

  function tryAcquire({
    requestId = randomUUID(),
    productionId,
    clientId,
    priority = "scheduled",
    resources,
    dueAt = null,
    admission = null,
  } = {}) {
    if (admission && admission.status !== "ready") return { schema: RESOURCE_BROKER_SCHEMA, status: "blocked", blockers: [...(admission.blockers ?? ["admission_blocked"])], lease: null };
    const normalizedRequestId = requiredText(requestId, "requestId");
    const normalizedProductionId = requiredText(productionId, "productionId");
    const normalizedClientId = requiredText(clientId, "clientId");
    const normalizedPriority = typeof priority === "string" ? RESOURCE_PRIORITIES[priority] : Number(priority);
    if (!Number.isSafeInteger(normalizedPriority) || normalizedPriority < 1 || normalizedPriority > 100) throw new Error("priority inválida.");
    const normalizedResources = normalizeResources(resources, effectiveCapacities);
    const now = instant(clock(), "clock");
    const normalizedDueAt = instant(dueAt ?? now, "dueAt").toISOString();
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        registerHeartbeat(db, now);
        const recoveredOrphans = cleanupOrphans(db, { now, staleAfterMs: staleMs, isProcessAlive });
        applyRetention(db, { now, retention: retentionPolicy });
        const existing = db.prepare("SELECT * FROM broker_requests WHERE request_id=?").get(normalizedRequestId);
        const identity = JSON.stringify(normalizedResources);
        if (existing && (existing.owner_nonce !== ownerIdentity.nonce || existing.production_id !== normalizedProductionId || existing.client_id !== normalizedClientId || existing.resources_json !== identity)) {
          throw new Error(`requestId ${normalizedRequestId} já pertence a outra solicitação.`);
        }
        if (!existing) {
          db.prepare(`INSERT INTO broker_requests(request_id,owner_nonce,production_id,client_id,priority,resources_json,state,created_at,due_at,claimed_at)
            VALUES(?,?,?,?,?,?, 'queued', ?, ?, ?)`)
            .run(normalizedRequestId, ownerIdentity.nonce, normalizedProductionId, normalizedClientId, normalizedPriority, identity, now.toISOString(), normalizedDueAt, now.toISOString());
        } else if (existing.state === "orphaned") {
          db.prepare("UPDATE broker_requests SET state='queued',lease_id=NULL,due_at=?,claimed_at=? WHERE request_id=? AND owner_nonce=? AND state='orphaned'")
            .run(normalizedDueAt, now.toISOString(), normalizedRequestId, ownerIdentity.nonce);
        } else if (existing.state === "queued") {
          db.prepare("UPDATE broker_requests SET claimed_at=? WHERE request_id=? AND owner_nonce=? AND state='queued'")
            .run(now.toISOString(), normalizedRequestId, ownerIdentity.nonce);
        }
        const acquired = db.prepare("SELECT lease.* FROM broker_leases lease JOIN broker_requests request ON request.lease_id=lease.lease_id WHERE request.request_id=?").get(normalizedRequestId);
        if (acquired) return { schema: RESOURCE_BROKER_SCHEMA, status: "acquired", recoveredOrphans, lease: leaseProjection(acquired) };

        const fairness = new Map(db.prepare("SELECT * FROM broker_fairness").all().map((row) => [row.client_id, Date.parse(row.last_granted_at)]));
        const candidates = db.prepare("SELECT * FROM broker_requests WHERE state='queued' AND due_at<=?").all(now.toISOString())
          .sort((left, right) => left.priority - right.priority
            || (fairness.get(left.client_id) ?? Number.NEGATIVE_INFINITY) - (fairness.get(right.client_id) ?? Number.NEGATIVE_INFINITY)
            || String(left.created_at).localeCompare(String(right.created_at))
            || String(left.request_id).localeCompare(String(right.request_id)));
        const used = usedResources(db);
        for (const candidate of candidates) {
          if (!requestOwnerIsFresh(db, candidate, { now, staleAfterMs: staleMs, claimTtlMs, isProcessAlive, currentOwnerNonce: ownerIdentity.nonce })) {
            db.prepare("UPDATE broker_requests SET state='orphaned',lease_id=NULL WHERE request_id=? AND state='queued'").run(candidate.request_id);
            continue;
          }
          const requested = JSON.parse(candidate.resources_json);
          if (!fits(requested, used, effectiveCapacities)) {
            // Um pedido pesado não pode ser ultrapassado para sempre por
            // pedidos leves da mesma prioridade. Enquanto ele é novo, os
            // seguintes passam na frente e a vazão não cai; passado o tempo
            // de envelhecimento, as vagas que ele precisa ficam reservadas
            // e só quem não disputa esses recursos continua avançando.
            const queuedForMs = now.getTime() - Date.parse(String(candidate.created_at));
            if (Number.isFinite(queuedForMs) && queuedForMs >= agingMs) {
              for (const resource of requested) used[resource.id] = (used[resource.id] ?? 0) + resource.weight;
            }
            continue;
          }
          const leaseId = randomUUID();
          db.prepare(`INSERT INTO broker_leases(lease_id,request_id,owner_nonce,production_id,client_id,resources_json,acquired_at,heartbeat_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(leaseId, candidate.request_id, candidate.owner_nonce, candidate.production_id, candidate.client_id, candidate.resources_json, now.toISOString(), now.toISOString());
          db.prepare("UPDATE broker_requests SET state='acquired',lease_id=? WHERE request_id=? AND state='queued'").run(leaseId, candidate.request_id);
          db.prepare(`INSERT INTO broker_fairness(client_id,last_granted_at) VALUES(?,?)
            ON CONFLICT(client_id) DO UPDATE SET last_granted_at=excluded.last_granted_at`).run(candidate.client_id, now.toISOString());
          for (const resource of requested) used[resource.id] = (used[resource.id] ?? 0) + resource.weight;
        }
        const lease = db.prepare("SELECT * FROM broker_leases WHERE request_id=?").get(normalizedRequestId);
        return {
          schema: RESOURCE_BROKER_SCHEMA,
          status: lease ? "acquired" : Date.parse(normalizedDueAt) > now.getTime() ? "not-due" : "queued",
          recoveredOrphans,
          dueAt: normalizedDueAt,
          lease: lease ? leaseProjection(lease) : null,
        };
      });
    } finally { db.close(); }
  }

  // Encerra uma solicitação abandonada numa transação só. Entre o
  // tryAcquire que devolveu `queued` e esta chamada, o poll de OUTRO
  // processo pode ter concedido o lease — o laço de concessão atende
  // qualquer candidato da fila. Apagar só o que está `queued` deixaria esse
  // lease sem dono até o processo morrer. Aqui, ou ele é devolvido ao
  // chamador, ou é liberado; nunca fica preso.
  function settleRequest(requestId, { keepGrantedLease = false } = {}) {
    const normalizedRequestId = requiredText(requestId, "requestId");
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        const lease = db.prepare("SELECT * FROM broker_leases WHERE request_id=? AND owner_nonce=?").get(normalizedRequestId, ownerIdentity.nonce);
        if (lease) {
          if (keepGrantedLease) return { outcome: "granted", lease: leaseProjection(lease) };
          db.prepare("DELETE FROM broker_leases WHERE lease_id=?").run(lease.lease_id);
          db.prepare("UPDATE broker_requests SET state='released' WHERE request_id=?").run(normalizedRequestId);
          return { outcome: "released", lease: null };
        }
        const removed = Number(db.prepare("DELETE FROM broker_requests WHERE request_id=? AND owner_nonce=? AND state IN ('queued','orphaned')")
          .run(normalizedRequestId, ownerIdentity.nonce).changes);
        return { outcome: removed === 1 ? "cancelled" : "absent", lease: null };
      });
    } finally { db.close(); }
  }

  function cancelQueuedRequest(requestId) {
    return settleRequest(requestId).outcome === "cancelled";
  }

  function settleQuietly(requestId, options) {
    try { return settleRequest(requestId, options); }
    catch { return { outcome: "absent", lease: null }; }
  }

  async function acquire(request, {
    pollMs = DEFAULT_POLL_MS,
    maxPollMs = DEFAULT_MAX_POLL_MS,
    timeoutMs = DEFAULT_CAPACITY_WAIT_MS,
    signal = null,
    onQueued = null,
  } = {}) {
    const requestId = request?.requestId ?? randomUUID();
    const startedAt = Date.now();
    const deadline = startedAt + positiveInteger(timeoutMs, "timeoutMs");
    const basePollMs = positiveInteger(pollMs, "pollMs");
    const ceilingPollMs = Math.max(basePollMs, positiveInteger(maxPollMs, "maxPollMs"));
    let currentPollMs = basePollMs;
    let announced = false;
    for (;;) {
      if (signal?.aborted) {
        settleQuietly(requestId);
        throw new Error("Aquisição de recurso cancelada antes do efeito.");
      }
      let result;
      try {
        result = tryAcquire({ ...request, requestId });
      } catch (error) {
        // Nenhuma exceção anterior à concessão pode deixar uma fila viva —
        // nem um lease concedido na corrida com outro processo.
        settleQuietly(requestId);
        throw error;
      }
      if (result.status === "acquired" || result.status === "blocked") {
        return announced ? { ...result, waitedMs: Date.now() - startedAt } : result;
      }
      if (!announced && typeof onQueued === "function") {
        announced = true;
        // Fila não é falha: quem chamou precisa poder dizer isso ao operador
        // sem transformar espera por capacidade em erro de geração.
        try { onQueued({ requestId, status: result.status, dueAt: result.dueAt ?? null, deadlineAt: new Date(deadline).toISOString() }); } catch {}
      }
      if (Date.now() >= deadline) {
        const settled = settleRequest(requestId, { keepGrantedLease: true });
        if (settled.outcome === "granted") {
          return { schema: RESOURCE_BROKER_SCHEMA, status: "acquired", lease: settled.lease, grantedAfterDeadline: true, waitedMs: Date.now() - startedAt };
        }
        return { ...result, status: "timeout", lease: null, waitedMs: Date.now() - startedAt };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(currentPollMs, Math.max(1, deadline - Date.now()))));
      currentPollMs = Math.min(ceilingPollMs, currentPollMs * 2);
    }
  }

  function heartbeat(leaseId = null) {
    const now = instant(clock(), "clock");
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        registerHeartbeat(db, now);
        if (leaseId != null) {
          const updated = db.prepare("UPDATE broker_leases SET heartbeat_at=? WHERE lease_id=? AND owner_nonce=?").run(now.toISOString(), requiredText(leaseId, "leaseId"), ownerIdentity.nonce);
          if (Number(updated.changes) !== 1) throw new Error("Lease não pertence ao processo atual.");
        } else {
          db.prepare("UPDATE broker_leases SET heartbeat_at=? WHERE owner_nonce=?").run(now.toISOString(), ownerIdentity.nonce);
        }
        return true;
      });
    } finally { db.close(); }
  }

  function release(leaseId) {
    const normalizedLeaseId = requiredText(leaseId, "leaseId");
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        const lease = db.prepare("SELECT * FROM broker_leases WHERE lease_id=? AND owner_nonce=?").get(normalizedLeaseId, ownerIdentity.nonce);
        if (!lease) return false;
        db.prepare("DELETE FROM broker_leases WHERE lease_id=?").run(normalizedLeaseId);
        db.prepare("UPDATE broker_requests SET state='released' WHERE request_id=?").run(lease.request_id);
        return true;
      });
    } finally { db.close(); }
  }

  // Manutenção declarada: renova heartbeat, recupera órfãos e poda o
  // histórico. Escreve, e diz que escreve. A leitura operacional passiva é
  // buildRuntimeOperationsSnapshot, que abre o banco em readOnly.
  function maintain() {
    const now = instant(clock(), "clock");
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        registerHeartbeat(db, now);
        const recoveredOrphans = cleanupOrphans(db, { now, staleAfterMs: staleMs, isProcessAlive });
        const pruned = applyRetention(db, { now, retention: retentionPolicy, force: true });
        return { schema: RESOURCE_BROKER_SCHEMA, generatedAt: now.toISOString(), readOnly: false, recoveredOrphans, pruned };
      });
    } finally { db.close(); }
  }

  return Object.freeze({
    schema: RESOURCE_BROKER_SCHEMA,
    dbFile: databaseFile,
    owner: ownerIdentity,
    capacities: effectiveCapacities,
    capacityDivergences,
    tryAcquire,
    acquire,
    settleRequest,
    cancelQueuedRequest,
    heartbeat,
    release,
    maintain,
  });
}
