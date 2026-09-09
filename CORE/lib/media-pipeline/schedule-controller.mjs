import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const SCHEDULE_CYCLE_SCHEMA = "mkt-videos/schedule-cycle@1";
export const SCHEDULE_SNAPSHOT_SCHEMA = "mkt-videos/schedule-snapshot@1";

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function hash(value) {
  const normalized = requiredText(value, "hash").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("Hash deve ser SHA-256 hexadecimal.");
  return normalized;
}

function instant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} inválido.`);
  return date;
}

function cycleKey(scheduleId, plannedFireAt) {
  return createHash("sha256").update(`${scheduleId}\0${plannedFireAt}`).digest("hex");
}

function openDatabase(dbFile) {
  const absolute = path.resolve(requiredText(dbFile, "dbFile"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  // busy_timeout antes de tudo: este banco é o mesmo runtime compartilhado
  // do broker, e dois processos abrindo ao mesmo tempo caem em "database is
  // locked" se o timeout ainda não estiver valendo na negociação do WAL.
  db.exec("PRAGMA busy_timeout=10000");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_cycles(
      cycle_key TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      planned_fire_at TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      owner_nonce TEXT NOT NULL,
      status TEXT NOT NULL,
      production_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      director_id TEXT NOT NULL,
      recipe_hash TEXT NOT NULL,
      plan_fingerprint TEXT NOT NULL,
      journal_file TEXT,
      receipt_id TEXT,
      collapsed_missed INTEGER NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS schedule_cycles_schedule_fire ON schedule_cycles(schedule_id,planned_fire_at);
  `);
  return { db, absolute };
}

function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = callback(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

function projection(row, reused = false) {
  return Object.freeze({
    schema: SCHEDULE_CYCLE_SCHEMA,
    cycleKey: row.cycle_key,
    scheduleId: row.schedule_id,
    plannedFireAt: row.planned_fire_at,
    claimedAt: row.claimed_at,
    heartbeatAt: row.heartbeat_at,
    status: row.status,
    productionId: row.production_id,
    clientId: row.client_id,
    directorId: row.director_id,
    recipeHash: row.recipe_hash,
    planFingerprint: row.plan_fingerprint,
    journalFile: row.journal_file,
    receiptId: row.receipt_id,
    collapsedMissed: Number(row.collapsed_missed),
    error: row.error,
    reused,
    dispatch: { applicationService: "recipe dispatch", createsProviderEffect: false },
  });
}

export function createScheduleController({ dbFile, ownerNonce = randomUUID(), clock = () => new Date() } = {}) {
  const opened = openDatabase(dbFile);
  const databaseFile = opened.absolute;
  opened.db.close();
  const owner = requiredText(ownerNonce, "ownerNonce");
  if (typeof clock !== "function") throw new Error("clock deve ser função.");

  function claimDue({ scheduleId, dueFireTimes, productionId, clientId, directorId, recipeHash, planFingerprint, admission, pendingAmbiguous = false } = {}) {
    const id = requiredText(scheduleId, "scheduleId");
    if (!Array.isArray(dueFireTimes) || !dueFireTimes.length) throw new Error("dueFireTimes deve conter os disparos planejados vencidos.");
    const now = instant(clock(), "clock");
    const due = [...new Set(dueFireTimes.map((value) => instant(value, "dueFireTimes[]").toISOString()))]
      .filter((value) => Date.parse(value) <= now.getTime())
      .sort();
    if (!due.length) return { schema: SCHEDULE_CYCLE_SCHEMA, status: "not-due", cycle: null };
    if (pendingAmbiguous) return { schema: SCHEDULE_CYCLE_SCHEMA, status: "blocked", blockers: ["reconcile_ambiguous_attempt_first"], cycle: null };
    if (!admission || admission.status !== "ready") return { schema: SCHEDULE_CYCLE_SCHEMA, status: "blocked", blockers: [...(admission?.blockers ?? ["admission_missing"])], cycle: null };
    const planned = due.at(-1);
    const key = cycleKey(id, planned);
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        const existing = db.prepare("SELECT * FROM schedule_cycles WHERE cycle_key=?").get(key);
        if (existing) return { schema: SCHEDULE_CYCLE_SCHEMA, status: existing.status, cycle: projection(existing, true) };
        const latest = db.prepare("SELECT * FROM schedule_cycles WHERE schedule_id=? ORDER BY planned_fire_at DESC LIMIT 1").get(id);
        if (latest && Date.parse(latest.planned_fire_at) > Date.parse(planned)) {
          return { schema: SCHEDULE_CYCLE_SCHEMA, status: "collapsed-stale", cycle: projection(latest, true) };
        }
        const inFlight = db.prepare("SELECT * FROM schedule_cycles WHERE schedule_id=? AND status IN ('claimed','running','attention_required') ORDER BY claimed_at DESC LIMIT 1").get(id);
        if (inFlight) return { schema: SCHEDULE_CYCLE_SCHEMA, status: "blocked", blockers: ["production_already_in_flight"], cycle: projection(inFlight, true) };
        db.prepare(`INSERT INTO schedule_cycles(cycle_key,schedule_id,planned_fire_at,claimed_at,heartbeat_at,owner_nonce,status,production_id,client_id,director_id,recipe_hash,plan_fingerprint,collapsed_missed)
          VALUES(?,?,?,?,?,?,'claimed',?,?,?,?,?,?)`).run(
          key, id, planned, now.toISOString(), now.toISOString(), owner,
          requiredText(productionId, "productionId"), requiredText(clientId, "clientId"), requiredText(directorId, "directorId"),
          hash(recipeHash), hash(planFingerprint), Math.max(0, due.length - 1),
        );
        return { schema: SCHEDULE_CYCLE_SCHEMA, status: "claimed", cycle: projection(db.prepare("SELECT * FROM schedule_cycles WHERE cycle_key=?").get(key)) };
      });
    } finally { db.close(); }
  }

  function transition(cycleKeyValue, fromStatuses, status, fields = {}) {
    const key = hash(cycleKeyValue);
    const now = instant(clock(), "clock");
    const { db } = openDatabase(databaseFile);
    try {
      return transaction(db, () => {
        const row = db.prepare("SELECT * FROM schedule_cycles WHERE cycle_key=?").get(key);
        if (!row) throw new Error("Ciclo agendado desconhecido.");
        if (row.owner_nonce !== owner) throw new Error("Ciclo pertence a outro lease de scheduler.");
        if (!fromStatuses.includes(row.status)) throw new Error(`Transição ${row.status} → ${status} não permitida.`);
        db.prepare(`UPDATE schedule_cycles SET status=?,heartbeat_at=?,journal_file=COALESCE(?,journal_file),receipt_id=COALESCE(?,receipt_id),error=? WHERE cycle_key=?`)
          .run(status, now.toISOString(), fields.journalFile ?? null, fields.receiptId ?? null, fields.error == null ? null : String(fields.error).slice(0, 500), key);
        return projection(db.prepare("SELECT * FROM schedule_cycles WHERE cycle_key=?").get(key));
      });
    } finally { db.close(); }
  }

  const start = (key, fields = {}) => transition(key, ["claimed"], "running", fields);
  const heartbeat = (key) => transition(key, ["claimed", "running"], "running");
  const complete = (key, fields = {}) => transition(key, ["running"], "completed", fields);
  const requireAttention = (key, fields = {}) => transition(key, ["claimed", "running"], "attention_required", fields);

  function snapshot() {
    const { db } = openDatabase(databaseFile);
    try {
      const rows = db.prepare("SELECT * FROM schedule_cycles ORDER BY planned_fire_at DESC").all();
      return { schema: SCHEDULE_SNAPSHOT_SCHEMA, generatedAt: instant(clock(), "clock").toISOString(), readOnly: true, counts: Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length])), cycles: rows.map((row) => projection(row)) };
    } finally { db.close(); }
  }

  return Object.freeze({ schema: SCHEDULE_CYCLE_SCHEMA, dbFile: databaseFile, claimDue, start, heartbeat, complete, requireAttention, snapshot });
}
