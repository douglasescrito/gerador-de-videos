import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

export const RESOURCE_BROKER_SCHEMA = "mkt-videos/resource-broker@1";
export const RESOURCE_LEASE_SCHEMA = "mkt-videos/resource-lease@1";
export const REMOTE_OPERATION_SCHEMA = "mkt-videos/remote-operation@1";
export const REMOTE_REPLACEMENT_DECISION_SCHEMA = "mkt-videos/remote-replacement-decision@1";
export const RESOURCE_BROKER_PROTOCOL = 2;

export const RESOURCE_PRIORITIES = Object.freeze({
  reconcile: 1,
  interactive: 2,
  scheduled: 3,
  derivative: 4,
  cache_warmup: 5,
});

export const DEFAULT_RESOURCE_CAPACITIES = Object.freeze({
  "provider:omni": 3,
  "browser:omni": 3,
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
    CREATE TABLE IF NOT EXISTS broker_resource_leases_v2(
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
    CREATE INDEX IF NOT EXISTS broker_leases_owner ON broker_resource_leases_v2(owner_nonce);
    CREATE INDEX IF NOT EXISTS ${SCHEMA_SENTINEL} ON broker_processes(heartbeat_at);
`;

function enableWal(db) {
  const deadline = performance.now() + 10_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    db.exec(`PRAGMA busy_timeout=${remaining}`);
    try { db.exec("PRAGMA journal_mode=WAL"); break; }
    catch (error) {
      // A concurrent cold-open journal transition may return SQLITE_BUSY
      // immediately without calling SQLite's busy handler. Retry only this
      // connection setup, within the same total wait budget and before the
      // broker transaction. No lease operation or provider submission is
      // replayed. Other errors remain terminal.
      if (typeof error.errcode !== "number" || (error.errcode & 255) !== 5 || performance.now() >= deadline) throw error;
      Atomics.wait(pause, 0, 0, Math.min(25, Math.max(0, deadline - performance.now())));
    }
  }
  db.exec("PRAGMA busy_timeout=10000");
}

function openDatabase(dbFile, { isProcessAlive = defaultIsProcessAlive } = {}) {
  const absolute = path.resolve(requiredText(dbFile, "dbFile"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  // busy_timeout tem de valer ANTES de qualquer coisa que dispute trava.
  // Com ele no fim do bloco, dois processos abrindo o runtime ao mesmo
  // tempo caíam em "database is locked" ao negociar o WAL — falha que só
  // aparece com processos de verdade, não com donos simulados.
  try { enableWal(db); }
  catch (error) { db.close(); throw error; }
  db.exec("PRAGMA synchronous=FULL");
  const legacyTable = db.prepare("SELECT type FROM sqlite_master WHERE name='broker_leases'").get();
  if (legacyTable?.type === "table") {
    // Barreira estrutural: um binário antigo iniciado depois desta migração
    // só encontra uma VIEW e não consegue escrever/adquirir capacidade.
    try {
      transaction(db, () => {
        // Outro processo pode ter migrado enquanto aguardávamos a trava.
        if (db.prepare("SELECT type FROM sqlite_master WHERE name='broker_leases'").get()?.type !== "table") return;
        const processes = db.prepare("SELECT * FROM broker_processes").all();
        if (processes.some((owner) => isProcessAlive(Number(owner.pid), String(owner.process_started_at)))) {
          throw new Error("Runtime antigo ainda possui produtor vivo; aguarde sua conclusão antes de atualizar o protocolo de leases.");
        }
        db.exec("ALTER TABLE broker_leases RENAME TO broker_resource_leases_v2");
        db.exec("CREATE VIEW broker_leases AS SELECT * FROM broker_resource_leases_v2");
      });
    } catch (error) {
      db.close();
      throw error;
    }
  }
  const schemaReady = db.prepare("SELECT count(*) n FROM sqlite_master WHERE name=?").get(SCHEMA_SENTINEL).n > 0;
  if (!schemaReady) {
    db.exec(SCHEMA_DDL);
    const requestColumns = new Set(db.prepare("PRAGMA table_info(broker_requests)").all().map((column) => column.name));
    if (!requestColumns.has("claimed_at")) db.exec("ALTER TABLE broker_requests ADD COLUMN claimed_at TEXT");
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='broker_remote_operations'").get()) {
    db.exec(`CREATE TABLE IF NOT EXISTS broker_remote_operations(
      operation_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      production_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      weight INTEGER NOT NULL,
      request_fingerprint TEXT,
      state TEXT NOT NULL,
      handle_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_observation_at TEXT,
      terminal_proof_json TEXT,
      claim_token TEXT,
      claim_owner TEXT,
      claim_until TEXT
    );
    CREATE INDEX IF NOT EXISTS broker_remote_state_due ON broker_remote_operations(state,next_observation_at);`);
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='broker_leases'").get()) {
    db.exec("CREATE VIEW IF NOT EXISTS broker_leases AS SELECT * FROM broker_resource_leases_v2");
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='broker_remote_replacement_no_delete'").get()) {
    db.exec(`CREATE TABLE IF NOT EXISTS broker_remote_replacement_decisions(
      decision_id TEXT NOT NULL,
      operation_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      production_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      decision_hash TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS broker_remote_replacement_no_update
      BEFORE UPDATE ON broker_remote_replacement_decisions BEGIN SELECT RAISE(ABORT,'Remote replacement decisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS broker_remote_replacement_no_delete
      BEFORE DELETE ON broker_remote_replacement_decisions BEGIN SELECT RAISE(ABORT,'Remote replacement decisions are append-only'); END;`);
  }
  const processColumns = new Set(db.prepare("PRAGMA table_info(broker_processes)").all().map((column) => column.name));
  if (!processColumns.has("runtime_protocol")) {
    try { db.exec("ALTER TABLE broker_processes ADD COLUMN runtime_protocol INTEGER NOT NULL DEFAULT 1"); }
    catch (error) {
      if (!db.prepare("PRAGMA table_info(broker_processes)").all().some((column) => column.name === "runtime_protocol")) throw error;
    }
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

let windowsBootTime;

function readWindowsBootTime() {
  if (windowsBootTime !== undefined) return windowsBootTime;
  windowsBootTime = null;
  if (process.platform !== "win32") return windowsBootTime;
  try {
    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const output = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], {
      // Cold PowerShell/CIM startup can approach or exceed five seconds.
      // Keep this bounded; an absent/invalid result still preserves the PID lock.
      encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 16_384, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const measured = Date.parse(output);
    if (Number.isFinite(measured) && measured > 0 && measured <= Date.now()) windowsBootTime = measured;
  } catch { /* Sem prova de boot, preservar a sondagem conservadora por PID. */ }
  return windowsBootTime;
}

function defaultIsProcessAlive(pid, processStartedAt) {
  const startedAt = Date.parse(String(processStartedAt ?? ""));
  if (process.platform === "win32" && Number.isFinite(startedAt)) {
    const bootTime = readWindowsBootTime();
    // Um PID pode ter sido reciclado depois do reboot; o dono registrado
    // antes do boot medido pelo SO não pode ser o processo atual desse PID.
    if (bootTime !== null && startedAt < bootTime) return false;
  }
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
  for (const lease of db.prepare("SELECT * FROM broker_resource_leases_v2").all()) {
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
      db.prepare("DELETE FROM broker_resource_leases_v2 WHERE lease_id=?").run(lease.lease_id);
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
      AND owner_nonce NOT IN (SELECT owner_nonce FROM broker_resource_leases_v2)
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
  for (const row of db.prepare("SELECT resources_json FROM broker_resource_leases_v2").all()) {
    for (const resource of JSON.parse(row.resources_json)) used[resource.id] = (used[resource.id] ?? 0) + resource.weight;
  }
  for (const row of db.prepare("SELECT * FROM broker_remote_operations WHERE terminal_proof_json IS NULL").all()) {
    if (readRemoteReplacementDecision(db, row)) continue;
    used[row.resource_id] = (used[row.resource_id] ?? 0) + Number(row.weight);
  }
  return used;
}

function replacementInput(value) {
  if (value?.confirmHuman !== true || value?.acknowledgeUnknownEffect !== true) {
    throw new Error("Substituição remota exige confirmHuman e acknowledgeUnknownEffect explícitos.");
  }
  const result = { schema: REMOTE_REPLACEMENT_DECISION_SCHEMA };
  for (const key of ["decisionId", "operationId", "attemptId", "productionId", "clientId", "requestFingerprint", "actor", "reason"]) {
    if (typeof value[key] !== "string") throw new Error(`${key} deve ser texto.`);
    result[key] = requiredText(value[key], key);
  }
  return { ...result, confirmHuman: true, acknowledgeUnknownEffect: true };
}

function replacementHash(body) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function assertRemoteReplacementDecision(value, remote = null) {
  const body = {
    ...replacementInput(value),
    decidedAt: instant(value.decidedAt, "decidedAt").toISOString(),
    effectStatus: "unknown",
    reservationDisposition: "administratively-released",
  };
  if (value.schema !== body.schema || value.effectStatus !== body.effectStatus
    || value.reservationDisposition !== body.reservationDisposition || value.hash !== replacementHash(body)
    || Object.keys(value).length !== Object.keys(body).length + 1) {
    throw new Error("Integridade da decisão administrativa remota divergente.");
  }
  if (remote) {
    for (const [key, column] of [["operationId", "operation_id"], ["attemptId", "attempt_id"], ["productionId", "production_id"], ["clientId", "client_id"], ["requestFingerprint", "request_fingerprint"]]) {
      if (value[key] !== (remote[column] ?? remote[key])) throw new Error(`Decisão administrativa diverge de ${key}.`);
    }
  }
  return Object.freeze({ ...body, hash: value.hash });
}

// Compartilhado com o relatório read-only: uma linha adulterada nunca libera
// capacidade nem aparece como autorização válida só por estar na tabela.
export function readRemoteReplacementDecision(db, remote) {
  if (!remote || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='broker_remote_replacement_decisions' AND type='table'").get()) return null;
  const row = db.prepare("SELECT * FROM broker_remote_replacement_decisions WHERE operation_id=?").get(remote.operation_id ?? remote.operationId);
  if (!row) return null;
  const decision = assertRemoteReplacementDecision(JSON.parse(row.decision_json), remote);
  if (row.decision_id !== decision.decisionId || row.attempt_id !== decision.attemptId
    || row.production_id !== decision.productionId || row.client_id !== decision.clientId
    || row.request_fingerprint !== decision.requestFingerprint || row.decision_hash !== decision.hash
    || row.created_at !== decision.decidedAt) throw new Error("Índice da decisão administrativa remota divergente.");
  return decision;
}

function remoteProjection(row) {
  if (!row) return null;
  return Object.freeze({
    schema: REMOTE_OPERATION_SCHEMA,
    operationId: row.operation_id,
    attemptId: row.attempt_id,
    productionId: row.production_id,
    clientId: row.client_id,
    resourceId: row.resource_id,
    weight: Number(row.weight),
    requestFingerprint: row.request_fingerprint,
    state: row.state,
    handle: row.handle_json ? JSON.parse(row.handle_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextObservationAt: row.next_observation_at,
    terminalProof: row.terminal_proof_json ? JSON.parse(row.terminal_proof_json) : null,
    claimToken: row.claim_token,
  });
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
  const opened = openDatabase(dbFile, { isProcessAlive });
  const databaseFile = opened.absolute;
  let reconciled;
  try {
    reconciled = transaction(opened.db, () => reconcileCapacities(opened.db, normalizedCapacities, { reset: resetCapacities }));
  } finally { opened.db.close(); }
  const effectiveCapacities = reconciled.effective;
  const capacityDivergences = Object.freeze(reconciled.divergences);

  function registerHeartbeat(db, now) {
    db.prepare(`INSERT INTO broker_processes(owner_nonce,pid,process_started_at,heartbeat_at,runtime_protocol)
      VALUES(?,?,?,?,?) ON CONFLICT(owner_nonce) DO UPDATE SET pid=excluded.pid,heartbeat_at=excluded.heartbeat_at,runtime_protocol=excluded.runtime_protocol`)
      .run(ownerIdentity.nonce, ownerIdentity.pid, ownerIdentity.startedAt, now.toISOString(), RESOURCE_BROKER_PROTOCOL);
  }

  function remoteTransaction(callback) {
    const { db } = openDatabase(databaseFile, { isProcessAlive });
    try { return transaction(db, () => { registerHeartbeat(db, instant(clock(), "clock")); return callback(db); }); }
    finally { db.close(); }
  }

  // Transferência, não liberação: a vaga deixa a posse efêmera do processo e
  // passa à tentativa remota antes do POST. Morte/TTL nunca apagam este fato.
  function detachRemoteLease({ leaseId, operationId, attemptId, resourceId = "provider:omni", requestFingerprint = null } = {}) {
    const id = requiredText(operationId, "operationId");
    const attempt = requiredText(attemptId, "attemptId");
    return remoteTransaction((db) => {
      const existing = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(id);
      if (existing) {
        if (existing.attempt_id !== attempt) throw new Error("Operação remota pertence a outra tentativa.");
        if (existing.state !== "not_submitted" || existing.handle_json || !JSON.parse(existing.terminal_proof_json ?? "null")?.localPreEffectProof) {
          throw new Error("Tentativa remota já existe; reconcilie em vez de submeter novamente.");
        }
      }
      const legacy = db.prepare("SELECT * FROM broker_processes WHERE runtime_protocol<? AND owner_nonce<>?").all(RESOURCE_BROKER_PROTOCOL, ownerIdentity.nonce)
        .find((entry) => isProcessAlive(Number(entry.pid), String(entry.process_started_at)));
      if (legacy) throw new Error("Reserva remota exige que os produtores antigos concluam naturalmente; runtime incompatível ainda ativo.");
      const lease = db.prepare("SELECT * FROM broker_resource_leases_v2 WHERE lease_id=? AND owner_nonce=?").get(requiredText(leaseId, "leaseId"), ownerIdentity.nonce);
      if (!lease) throw new Error("Lease de submissão não pertence ao processo atual.");
      const resources = JSON.parse(lease.resources_json);
      const resource = resources.find((entry) => entry.id === resourceId);
      if (!resource) throw new Error("Lease não reserva a capacidade remota solicitada.");
      if (existing && (existing.production_id !== lease.production_id || existing.client_id !== lease.client_id || existing.request_fingerprint !== requestFingerprint)) {
        throw new Error("Retomada pré-POST diverge do pedido original.");
      }
      const timestamp = instant(clock(), "clock").toISOString();
      if (existing) {
        db.prepare("UPDATE broker_remote_operations SET state='submitting',resource_id=?,weight=?,terminal_proof_json=NULL,updated_at=? WHERE operation_id=?")
          .run(resourceId, resource.weight, timestamp, id);
      } else {
        db.prepare(`INSERT INTO broker_remote_operations(operation_id,attempt_id,production_id,client_id,resource_id,weight,request_fingerprint,state,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,'submitting',?,?)`).run(id, attempt, lease.production_id, lease.client_id, resourceId, resource.weight, requestFingerprint, timestamp, timestamp);
      }
      db.prepare("UPDATE broker_resource_leases_v2 SET resources_json=? WHERE lease_id=?").run(JSON.stringify(resources.filter((entry) => entry.id !== resourceId)), lease.lease_id);
      return remoteProjection(db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(id));
    });
  }

  function bindRemoteHandle({ operationId, attemptId, handle } = {}) {
    const fileId = requiredText(handle?.fileId, "handle.fileId");
    return remoteTransaction((db) => {
      const row = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=? AND attempt_id=?").get(operationId, attemptId);
      if (!row || row.terminal_proof_json) throw new Error("Tentativa remota não aceita handle neste estado.");
      const current = row.handle_json ? JSON.parse(row.handle_json) : null;
      if (current && current.fileId !== fileId) throw new Error("Handle remoto diverge da tentativa persistida.");
      const normalized = { fileId, interactionId: handle.interactionId ?? null, expirationTime: handle.expirationTime ?? null };
      const timestamp = instant(clock(), "clock").toISOString();
      db.prepare("UPDATE broker_remote_operations SET state='provider_pending',handle_json=?,updated_at=?,next_observation_at=? WHERE operation_id=?")
        .run(JSON.stringify(normalized), timestamp, timestamp, operationId);
      return remoteProjection(db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(operationId));
    });
  }

  function readRemoteOperation(operationId) {
    const db = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      // A consulta do handle participa da mesma disputa entre processos que a
      // escrita. Sem timeout, uma trava breve vira falha antes da submissão.
      db.exec("PRAGMA busy_timeout=10000");
      return remoteProjection(db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(requiredText(operationId, "operationId")));
    }
    finally { db.close(); }
  }

  function authorizeRemoteReplacement(options = {}) {
    const input = replacementInput(options);
    return remoteTransaction((db) => {
      const row = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(input.operationId);
      if (!row || row.attempt_id !== input.attemptId || row.production_id !== input.productionId
        || row.client_id !== input.clientId || row.request_fingerprint !== input.requestFingerprint) {
        throw new Error("Identidade da tentativa remota diverge da substituição solicitada.");
      }
      const existing = readRemoteReplacementDecision(db, row);
      if (existing) {
        if (JSON.stringify(replacementInput(existing)) !== JSON.stringify(input)) throw new Error("Decisão administrativa remota já existe com conteúdo divergente.");
        return existing;
      }
      if (!["submitting", "unknown", "ambiguous"].includes(row.state) || row.handle_json || row.terminal_proof_json) {
        throw new Error("Substituição administrativa exige efeito desconhecido, sem handle ou prova terminal.");
      }
      const current = instant(clock(), "clock");
      const ownerAlive = (owner) => owner && isProcessAlive(Number(owner.pid), String(owner.process_started_at));
      const claimOwner = row.claim_owner && db.prepare("SELECT * FROM broker_processes WHERE owner_nonce=?").get(row.claim_owner);
      if (row.claim_token && Date.parse(row.claim_until) > current.getTime() && ownerAlive(claimOwner)) {
        throw new Error("Substituição remota bloqueada por claim de observador vivo.");
      }
      const activeOwners = db.prepare(`SELECT p.* FROM broker_resource_leases_v2 l
        JOIN broker_processes p ON p.owner_nonce=l.owner_nonce WHERE l.production_id=? AND l.client_id=?`).all(input.productionId, input.clientId);
      if (activeOwners.some(ownerAlive)) throw new Error("Substituição remota bloqueada por produtor vivo com lease da produção.");
      const body = { ...input, decidedAt: current.toISOString(), effectStatus: "unknown", reservationDisposition: "administratively-released" };
      const decision = assertRemoteReplacementDecision({ ...body, hash: replacementHash(body) }, row);
      db.prepare(`INSERT INTO broker_remote_replacement_decisions(decision_id,operation_id,attempt_id,production_id,client_id,request_fingerprint,decision_hash,decision_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(decision.decisionId, decision.operationId, decision.attemptId, decision.productionId, decision.clientId, decision.requestFingerprint, decision.hash, JSON.stringify(decision), decision.decidedAt);
      return decision;
    });
  }

  function claimRemoteOperation({ operationId, claimMs = 120_000 } = {}) {
    return remoteTransaction((db) => {
      const row = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(operationId);
      if (!row) throw new Error("Operação remota desconhecida.");
      const current = instant(clock(), "clock");
      if (row.claim_token) {
        const ownerRow = db.prepare("SELECT * FROM broker_processes WHERE owner_nonce=?").get(row.claim_owner);
        const alive = ownerRow && isProcessAlive(Number(ownerRow.pid), String(ownerRow.process_started_at));
        if (alive && Date.parse(row.claim_until) > current.getTime()) return null;
      }
      const token = randomUUID();
      db.prepare("UPDATE broker_remote_operations SET claim_token=?,claim_owner=?,claim_until=? WHERE operation_id=?")
        .run(token, ownerIdentity.nonce, new Date(current.getTime() + positiveInteger(claimMs, "claimMs")).toISOString(), operationId);
      return { ...remoteProjection(row), claimToken: token };
    });
  }

  function recordRemoteObservation({ operationId, claimToken, observation, nextObservationAt = null } = {}) {
    return remoteTransaction((db) => {
      const row = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=? AND claim_token=? AND claim_owner=?").get(operationId, claimToken, ownerIdentity.nonce);
      if (!row || Date.parse(row.claim_until) <= instant(clock(), "clock").getTime()) throw new Error("Claim remoto expirado ou assumido por outro observador.");
      const handle = row.handle_json ? JSON.parse(row.handle_json) : null;
      if (!handle || observation?.fileId !== handle.fileId || observation?.zeroPost !== true) throw new Error("Observação não pertence ao handle remoto ou não comprova zero POST.");
      const terminal = ["ready", "provider_failed"].includes(observation.classification);
      const timestamp = instant(clock(), "clock").toISOString();
      const proof = terminal ? JSON.stringify({ fileId: handle.fileId, classification: observation.classification, state: observation.state ?? null, httpStatus: observation.httpStatus ?? null, checkedAt: observation.checkedAt ?? timestamp, zeroPost: true }) : row.terminal_proof_json;
      const state = terminal ? observation.classification : row.terminal_proof_json ? row.state : "provider_pending";
      db.prepare("UPDATE broker_remote_operations SET state=?,updated_at=?,next_observation_at=?,terminal_proof_json=? WHERE operation_id=?")
        .run(state, timestamp, nextObservationAt == null ? null : instant(nextObservationAt, "nextObservationAt").toISOString(), proof, operationId);
      return remoteProjection(db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(operationId));
    });
  }

  function releaseRemoteClaim({ operationId, claimToken } = {}) {
    return remoteTransaction((db) => Number(db.prepare("UPDATE broker_remote_operations SET claim_token=NULL,claim_owner=NULL,claim_until=NULL WHERE operation_id=? AND claim_token=? AND claim_owner=?")
      .run(operationId, claimToken, ownerIdentity.nonce).changes) === 1);
  }

  function proveRemoteNotSubmitted({ operationId, attemptId } = {}) {
    return remoteTransaction((db) => {
      const row = db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=? AND attempt_id=?").get(operationId, attemptId);
      if (!row || row.handle_json || row.state !== "submitting") throw new Error("Ausência local de POST não pode substituir um efeito aceito.");
      const timestamp = instant(clock(), "clock").toISOString();
      db.prepare("UPDATE broker_remote_operations SET state='not_submitted',terminal_proof_json=?,updated_at=? WHERE operation_id=?")
        .run(JSON.stringify({ classification: "not_submitted", checkedAt: timestamp, localPreEffectProof: true }), timestamp, operationId);
      return remoteProjection(db.prepare("SELECT * FROM broker_remote_operations WHERE operation_id=?").get(operationId));
    });
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
    const { db } = openDatabase(databaseFile, { isProcessAlive });
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
        const acquired = db.prepare("SELECT lease.* FROM broker_resource_leases_v2 lease JOIN broker_requests request ON request.lease_id=lease.lease_id WHERE request.request_id=?").get(normalizedRequestId);
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
          db.prepare(`INSERT INTO broker_resource_leases_v2(lease_id,request_id,owner_nonce,production_id,client_id,resources_json,acquired_at,heartbeat_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(leaseId, candidate.request_id, candidate.owner_nonce, candidate.production_id, candidate.client_id, candidate.resources_json, now.toISOString(), now.toISOString());
          db.prepare("UPDATE broker_requests SET state='acquired',lease_id=? WHERE request_id=? AND state='queued'").run(leaseId, candidate.request_id);
          db.prepare(`INSERT INTO broker_fairness(client_id,last_granted_at) VALUES(?,?)
            ON CONFLICT(client_id) DO UPDATE SET last_granted_at=excluded.last_granted_at`).run(candidate.client_id, now.toISOString());
          for (const resource of requested) used[resource.id] = (used[resource.id] ?? 0) + resource.weight;
        }
        const lease = db.prepare("SELECT * FROM broker_resource_leases_v2 WHERE request_id=?").get(normalizedRequestId);
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
    const { db } = openDatabase(databaseFile, { isProcessAlive });
    try {
      return transaction(db, () => {
        const lease = db.prepare("SELECT * FROM broker_resource_leases_v2 WHERE request_id=? AND owner_nonce=?").get(normalizedRequestId, ownerIdentity.nonce);
        if (lease) {
          if (keepGrantedLease) return { outcome: "granted", lease: leaseProjection(lease) };
          db.prepare("DELETE FROM broker_resource_leases_v2 WHERE lease_id=?").run(lease.lease_id);
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
    const assertNotCancelled = () => {
      if (signal?.aborted) {
        settleQuietly(requestId);
        const error = new Error("Aquisição de recurso cancelada antes do efeito.");
        error.name = "AbortError";
        error.postStarted = false;
        throw error;
      }
    };
    for (;;) {
      assertNotCancelled();
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
        assertNotCancelled();
        return announced ? { ...result, waitedMs: Date.now() - startedAt } : result;
      }
      if (!announced && typeof onQueued === "function") {
        announced = true;
        // Fila não é falha: quem chamou precisa poder dizer isso ao operador
        // sem transformar espera por capacidade em erro de geração.
        try { onQueued({ requestId, status: result.status, dueAt: result.dueAt ?? null, deadlineAt: new Date(deadline).toISOString() }); } catch {}
      }
      assertNotCancelled();
      if (Date.now() >= deadline) {
        const settled = settleRequest(requestId, { keepGrantedLease: true });
        if (settled.outcome === "granted") {
          return { schema: RESOURCE_BROKER_SCHEMA, status: "acquired", lease: settled.lease, grantedAfterDeadline: true, waitedMs: Date.now() - startedAt };
        }
        return { ...result, status: "timeout", lease: null, waitedMs: Date.now() - startedAt };
      }
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, Math.min(currentPollMs, Math.max(1, deadline - Date.now())));
        signal?.addEventListener("abort", finish, { once: true });
        if (signal?.aborted) finish();
      });
      currentPollMs = Math.min(ceilingPollMs, currentPollMs * 2);
    }
  }

  function heartbeat(leaseId = null) {
    const now = instant(clock(), "clock");
    const { db } = openDatabase(databaseFile, { isProcessAlive });
    try {
      return transaction(db, () => {
        registerHeartbeat(db, now);
        if (leaseId != null) {
          const updated = db.prepare("UPDATE broker_resource_leases_v2 SET heartbeat_at=? WHERE lease_id=? AND owner_nonce=?").run(now.toISOString(), requiredText(leaseId, "leaseId"), ownerIdentity.nonce);
          if (Number(updated.changes) !== 1) throw new Error("Lease não pertence ao processo atual.");
        } else {
          db.prepare("UPDATE broker_resource_leases_v2 SET heartbeat_at=? WHERE owner_nonce=?").run(now.toISOString(), ownerIdentity.nonce);
        }
        return true;
      });
    } finally { db.close(); }
  }

  function release(leaseId) {
    const normalizedLeaseId = requiredText(leaseId, "leaseId");
    const { db } = openDatabase(databaseFile, { isProcessAlive });
    try {
      return transaction(db, () => {
        const lease = db.prepare("SELECT * FROM broker_resource_leases_v2 WHERE lease_id=? AND owner_nonce=?").get(normalizedLeaseId, ownerIdentity.nonce);
        if (!lease) return false;
        db.prepare("DELETE FROM broker_resource_leases_v2 WHERE lease_id=?").run(normalizedLeaseId);
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
    const { db } = openDatabase(databaseFile, { isProcessAlive });
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
    detachRemoteLease,
    bindRemoteHandle,
    readRemoteOperation,
    authorizeRemoteReplacement,
    claimRemoteOperation,
    recordRemoteObservation,
    releaseRemoteClaim,
    proveRemoteNotSubmitted,
  });
}
