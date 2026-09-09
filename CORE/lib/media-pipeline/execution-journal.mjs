import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { assertExecutionTiming } from "./execution-timing.mjs";
import { assertRemoteReplacementDecision } from "./resource-broker.mjs";
import {
  assertExecutionAuthorization,
  assertExecutionAuthorizationRuntime,
  createNoProviderInputRightsDecision,
  createSameExecutionRightsDecision,
  executionNodeRequiresMediaInputs,
  projectExecutionAuthorization,
} from "./execution-authorization.mjs";

export const EXECUTION_JOURNAL_SCHEMA = "mkt-videos/execution-journal@1";
export const EXECUTION_SNAPSHOT_SCHEMA = "mkt-videos/execution-snapshot@1";
export const EXECUTION_REPLAY_SCHEMA = "mkt-videos/execution-replay@1";
export const EXECUTION_EFFECT_AUTHORIZATION_SCHEMA =
  "mkt-videos/execution-effect-authorization@1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROTECTED_EXECUTION_EVENT_TYPES = new Set([
  "plan_registered",
  "node_authorized",
  "node_authorization_expired",
  "node_started",
  "provider_handle_persisted",
  "node_completed",
  "node_failed",
  "node_pre_effect_failed",
  "node_provider_unaccepted",
  "human_retry_authorized",
  "human_retry_consumed",
  "node_approved",
  "execution_artifact_revoked",
  "legacy_node_migrated",
]);
const issuedEffectAuthorizations = new WeakSet();
const consumedEffectAuthorizations = new WeakSet();

function requiredText(value, label, maxLength = 512) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} excede ${maxLength} caracteres.`);
  }
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    throw new Error(`${label} contém controles ou direção bidi.`);
  }
  return normalized;
}

function requiredHash(value, label) {
  const normalized = requiredText(value, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} é inválido.`);
  return normalized;
}

function canonicalNow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("now inválido.");
  return date;
}

function sanitizeFailureForJournal(error, maxLength = 500) {
  let text = String(error instanceof Error ? error.message : error ?? "Falha desconhecida.");
  text = text
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, "<omitted-data-url>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "<redacted-api-key>")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted-jwt>")
    .replace(
      /((?:api[_-]?key|authorization|cookie|set-cookie|token|secret|session|password|passwd|credential|sid|hsid|ssid)\s*[:=]\s*)(["'`])([^"'`\r\n]+)\2/gi,
      "$1$2<redacted>$2",
    )
    .replace(
      /((?:api[_-]?key|authorization|cookie|set-cookie|token|secret|session|password|passwd|credential|sid|hsid|ssid)\s*[:=]\s*)([^\s,;}\]]+)/gi,
      "$1<redacted>",
    )
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/gu, " ")
    .trim();
  if (!text) text = "Falha sanitizada sem mensagem.";
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}<truncated>`
    : text;
}

function assertNodeDependenciesCompleted(snapshot, node) {
  const blockers = (node.dependencies ?? []).filter(
    (dependencyId) => snapshot.nodes[dependencyId]?.status !== "completed",
  );
  if (blockers.length > 0) {
    throw new Error(
      `Nó ${node.id} possui dependências não concluídas: ${blockers.join(", ")}.`,
    );
  }
}

function createExecutionEffectAuthorization({
  authorization,
  attemptId,
  startedAt,
} = {}) {
  const body = {
    schema: EXECUTION_EFFECT_AUTHORIZATION_SCHEMA,
    planFingerprint: authorization.planFingerprint,
    nodeId: authorization.nodeId,
    nodeFingerprint: authorization.nodeFingerprint,
    provider: authorization.provider,
    operation: authorization.operation,
    authorizationHash: authorization.authorizationHash,
    attemptId: requiredText(attemptId, "attemptId"),
    startedAt: canonicalNow(startedAt).toISOString(),
  };
  const effectAuthorization = Object.freeze({
    ...body,
    effectHash: operationFingerprint(body),
  });
  issuedEffectAuthorizations.add(effectAuthorization);
  return effectAuthorization;
}

export function consumeExecutionEffectAuthorization(
  effectAuthorization,
  {
    provider,
    operation,
    nodeId = null,
    attemptId = null,
  } = {},
) {
  if (!issuedEffectAuthorizations.has(effectAuthorization)) {
    throw new Error(
      "Execution effect authorization não foi emitida pelo journal desta execução.",
    );
  }
  if (consumedEffectAuthorizations.has(effectAuthorization)) {
    throw new Error("Execution effect authorization já foi consumida.");
  }
  const expectedKeys = [
    "schema",
    "planFingerprint",
    "nodeId",
    "nodeFingerprint",
    "provider",
    "operation",
    "authorizationHash",
    "attemptId",
    "startedAt",
    "effectHash",
  ].sort();
  const actualKeys = Object.keys(effectAuthorization).sort();
  if (operationFingerprint(actualKeys) !== operationFingerprint(expectedKeys)) {
    throw new Error("Execution effect authorization contém campos inválidos.");
  }
  if (effectAuthorization.schema !== EXECUTION_EFFECT_AUTHORIZATION_SCHEMA) {
    throw new Error("Execution effect authorization usa schema inválido.");
  }
  requiredHash(
    effectAuthorization.planFingerprint,
    "effect.planFingerprint",
  );
  requiredHash(effectAuthorization.nodeFingerprint, "effect.nodeFingerprint");
  requiredHash(
    effectAuthorization.authorizationHash,
    "effect.authorizationHash",
  );
  canonicalNow(effectAuthorization.startedAt);
  if (
    operationFingerprint({
      schema: effectAuthorization.schema,
      planFingerprint: effectAuthorization.planFingerprint,
      nodeId: effectAuthorization.nodeId,
      nodeFingerprint: effectAuthorization.nodeFingerprint,
      provider: effectAuthorization.provider,
      operation: effectAuthorization.operation,
      authorizationHash: effectAuthorization.authorizationHash,
      attemptId: effectAuthorization.attemptId,
      startedAt: effectAuthorization.startedAt,
    }) !== requiredHash(effectAuthorization.effectHash, "effect.effectHash")
  ) {
    throw new Error("Execution effect authorization diverge do hash canônico.");
  }
  if (effectAuthorization.provider !== requiredText(provider, "provider")) {
    throw new Error("Execution effect authorization pertence a outro provider.");
  }
  if (
    effectAuthorization.operation !== requiredText(operation, "operation")
  ) {
    throw new Error("Execution effect authorization pertence a outra operação.");
  }
  if (nodeId !== null && effectAuthorization.nodeId !== String(nodeId)) {
    throw new Error("Execution effect authorization pertence a outro nó.");
  }
  if (
    attemptId !== null
    && effectAuthorization.attemptId !== String(attemptId)
  ) {
    throw new Error("Execution effect authorization pertence a outro attempt.");
  }
  consumedEffectAuthorizations.add(effectAuthorization);
  return structuredClone(effectAuthorization);
}

export function assertExecutionEffectAuthorizationConsumed(
  effectAuthorization,
) {
  if (!issuedEffectAuthorizations.has(effectAuthorization)) {
    throw new Error(
      "Execution effect authorization não foi emitida pelo journal desta execução.",
    );
  }
  if (!consumedEffectAuthorizations.has(effectAuthorization)) {
    throw new Error(
      "Adapter não consumiu a Execution effect authorization antes do efeito.",
    );
  }
  return true;
}

function eventSequence(db, eventId) {
  const row = db.prepare("SELECT seq FROM events WHERE event_id=?").get(eventId);
  if (!row || !Number.isSafeInteger(Number(row.seq))) {
    throw new Error("Sequência do evento não pôde ser materializada.");
  }
  return Number(row.seq);
}

function openJournal(dbFile) {
  const db = new DatabaseSync(path.resolve(String(dbFile)));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      attempt_id TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (
      attempt_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      handle TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS execution_artifacts (
      artifact_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','revoked')),
      created_seq INTEGER NOT NULL,
      revoked_seq INTEGER,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS execution_authorizations (
      authorization_hash TEXT PRIMARY KEY,
      nonce TEXT NOT NULL UNIQUE,
      plan_fingerprint TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_fingerprint TEXT NOT NULL,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      capability_snapshot_hash TEXT NOT NULL,
      capability_expires_at TEXT NOT NULL,
      rights_decision_hash TEXT NOT NULL,
      rights_head_sequence INTEGER NOT NULL,
      budget_key TEXT NOT NULL,
      quota_amount INTEGER NOT NULL,
      hard_limit_amount INTEGER NOT NULL,
      authentication_mode TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('issued','consumed','expired')),
      consumed_at TEXT,
      attempt_id TEXT,
      projection TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_node_idx ON events(node_id,seq);
    CREATE INDEX IF NOT EXISTS execution_artifacts_node_idx
      ON execution_artifacts(node_id,status,artifact_id);
    CREATE INDEX IF NOT EXISTS execution_authorizations_node_idx
      ON execution_authorizations(node_id,status,issued_at);
    CREATE INDEX IF NOT EXISTS execution_authorizations_budget_idx
      ON execution_authorizations(budget_key,status);
    CREATE TABLE IF NOT EXISTS human_retry_decisions (
      decision_id TEXT PRIMARY KEY,
      decision_hash TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS human_retry_authorizations (
      decision_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      old_attempt_id TEXT NOT NULL UNIQUE,
      budget_key TEXT NOT NULL,
      release_hash TEXT NOT NULL,
      release_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('issued','consumed')),
      consumed_by_attempt_id TEXT UNIQUE,
      consumed_at TEXT,
      PRIMARY KEY(decision_id,node_id)
    );
  `);
  return db;
}

function insertEvent(db, { type, nodeId = null, attemptId = null, data = {}, at = new Date().toISOString(), eventId = randomUUID() }) {
  db.prepare("INSERT INTO events(event_id,at,type,node_id,attempt_id,data) VALUES (?,?,?,?,?,?)").run(eventId, at, type, nodeId, attemptId, JSON.stringify(data));
  return eventId;
}

export function initializeExecutionJournal({ dbFile, plan } = {}) {
  if (plan?.schema !== "mkt-videos/execution-plan@1") throw new Error("initializeExecutionJournal exige execution-plan@1.");
  const db = openJournal(dbFile);
  try {
    const existing = db.prepare("SELECT value FROM metadata WHERE key='plan'").get()?.value;
    if (existing) {
      const stored = JSON.parse(existing);
      if (stored.fingerprint !== plan.fingerprint) throw new Error("O journal já pertence a outro execution plan.");
      return materializeWithDb(db, path.resolve(String(dbFile)));
    }
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("schema", EXECUTION_JOURNAL_SCHEMA);
    db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("plan", JSON.stringify(plan));
    insertEvent(db, { type: "plan_registered", data: { planFingerprint: plan.fingerprint } });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function applyEvent(snapshot, event) {
  const node = event.node_id ? snapshot.nodes[event.node_id] : null;
  const data = JSON.parse(event.data);
  if (node) {
    if (["node_completed", "node_failed"].includes(event.type) && data.executionTiming) node.executionTiming = {
      attemptId: event.attempt_id, outcome: event.type === "node_completed" ? "completed" : "failed", measurement: data.executionTiming,
    };
    if (event.type === "node_authorized") {
      node.status = "ready";
      node.authorizationHash = data.authorizationHash ?? null;
      node.authorizationExpiresAt = data.expiresAt ?? null;
      node.capabilitySnapshotHash = data.capabilitySnapshotHash ?? null;
      node.rightsDecisionHash = data.rightsDecisionHash ?? null;
    }
    else if (event.type === "node_started") {
      node.status = "running";
      node.attemptId = event.attempt_id;
      node.attempts += 1;
      node.authorizationHash = data.authorizationHash ?? node.authorizationHash;
      node.authorizationConsumedAt = event.at;
      if (data.humanRetryDecisionId) {
        node.providerHandle = null;
        node.error = null;
      }
    }
    else if (event.type === "human_retry_authorized") node.humanRetryAuthorization = { decisionId: data.decisionId, decisionHash: data.decisionHash, oldAttemptId: event.attempt_id, releaseHash: data.releaseHash, status: "issued" };
    else if (event.type === "human_retry_consumed") node.humanRetryAuthorization = { ...node.humanRetryAuthorization, status: "consumed", newAttemptId: data.newAttemptId };
    else if (event.type === "provider_handle_persisted") { node.status = "provider_pending"; node.attemptId = event.attempt_id; node.providerHandle = data.handle; }
    else if (event.type === "node_reconcile_started") { node.status = "reconciling"; node.attemptId = event.attempt_id; }
    else if (event.type === "node_completed") { node.status = "completed"; node.output = data.output ?? null; node.receipt = data.receipt ?? null; if (data.reuseSource) node.reuseSource = data.reuseSource; }
    else if (event.type === "node_failed") { node.status = data.status ?? "attention_required"; node.error = data.error ?? null; }
    else if (event.type === "node_pre_effect_failed") {
      node.status = "planned";
      node.attemptId = null;
      node.providerHandle = null;
      node.output = null;
      node.receipt = null;
      node.error = data.error ?? null;
      node.authorizationHash = null;
      node.authorizationExpiresAt = null;
      node.authorizationConsumedAt = null;
      node.capabilitySnapshotHash = null;
      node.rightsDecisionHash = null;
    }
    else if (event.type === "node_provider_unaccepted") {
      node.status = "planned";
      node.attemptId = null;
      node.providerHandle = null;
      node.output = null;
      node.receipt = null;
      node.error = data.error ?? null;
      node.authorizationHash = null;
      node.authorizationExpiresAt = null;
      node.authorizationConsumedAt = null;
      node.capabilitySnapshotHash = null;
      node.rightsDecisionHash = null;
    }
    else if (event.type === "node_invalidated") { node.status = data.status; node.invalidation = data; }
    else if (event.type === "node_approved") { node.status = "completed"; node.approval = data; }
    else if (event.type === "legacy_node_migrated") Object.assign(node, data);
    node.updatedAt = event.at;
  }
  snapshot.lastEvent = { seq: event.seq, id: event.event_id, type: event.type, at: event.at };
}

function materializeWithDb(db, dbFile) {
  const planValue = db.prepare("SELECT value FROM metadata WHERE key='plan'").get()?.value;
  if (!planValue) throw new Error("Journal sem execution plan.");
  const plan = JSON.parse(planValue);
  const snapshot = {
    schema: EXECUTION_SNAPSHOT_SCHEMA,
    journal: dbFile,
    planFingerprint: plan.fingerprint,
    status: "planned",
    lastEvent: null,
    nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
      id: node.id,
      fingerprint: node.fingerprint,
      costClass: node.costClass,
      status: "planned",
      attempts: 0,
      attemptId: null,
      providerHandle: null,
      output: null,
      receipt: null,
      error: null,
      authorizationHash: null,
      authorizationExpiresAt: null,
      authorizationConsumedAt: null,
      capabilitySnapshotHash: null,
      rightsDecisionHash: null,
      updatedAt: null,
    }])),
  };
  for (const event of db.prepare("SELECT * FROM events ORDER BY seq").all()) applyEvent(snapshot, event);
  const now = Date.now();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.costClass === "local" || node.status !== "ready") continue;
    const authorization = db.prepare(`
      SELECT status,expires_at AS expiresAt
      FROM execution_authorizations
      WHERE node_id=?
      ORDER BY issued_at DESC,authorization_hash DESC
      LIMIT 1
    `).get(node.id);
    if (
      !authorization
      || authorization.status !== "issued"
      || !Number.isFinite(Date.parse(authorization.expiresAt))
      || Date.parse(authorization.expiresAt) <= now
    ) {
      node.status = "reapproval_required";
    }
  }
  const statuses = Object.values(snapshot.nodes).map((node) => node.status);
  if (statuses.some((status) => ["attention_required", "ambiguous", "provider_pending", "stale_paid", "reapproval_required"].includes(status))) snapshot.status = "attention_required";
  else if (statuses.some((status) => status === "running")) snapshot.status = "running";
  else if (statuses.every((status) => status === "completed")) snapshot.status = "completed";
  else snapshot.status = "ready";
  return snapshot;
}

export function materializeExecutionSnapshot({ dbFile, readOnly = false } = {}) {
  const db = readOnly ? new DatabaseSync(path.resolve(String(dbFile)), { readOnly: true }) : openJournal(dbFile);
  try {
    if (readOnly) db.exec("BEGIN");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } finally {
    if (readOnly && db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

/**
 * Projection used by replay/equivalence checks. Runtime paths, event IDs and
 * wall-clock projections are intentionally excluded; the journal remains the
 * only source of truth and this helper is read-only.
 */
export function projectExecutionSnapshotForReplay(snapshot) {
  if (!snapshot || snapshot.schema !== EXECUTION_SNAPSHOT_SCHEMA) {
    throw new Error("Snapshot incompatível com replay do execution journal.");
  }
  return {
    schema: EXECUTION_SNAPSHOT_SCHEMA,
    planFingerprint: snapshot.planFingerprint,
    status: snapshot.status,
    nodes: Object.fromEntries(
      Object.entries(snapshot.nodes ?? {}).map(([nodeId, node]) => [nodeId, {
        id: node.id,
        fingerprint: node.fingerprint,
        costClass: node.costClass,
        status: node.status,
        attempts: node.attempts,
        attemptId: node.attemptId ?? null,
        providerHandle: node.providerHandle ?? null,
        output: node.output ?? null,
        receipt: node.receipt ?? null,
        error: node.error ?? null,
        authorizationHash: node.authorizationHash ?? null,
        capabilitySnapshotHash: node.capabilitySnapshotHash ?? null,
        rightsDecisionHash: node.rightsDecisionHash ?? null,
        ...(node.humanRetryAuthorization ? { humanRetryAuthorization: structuredClone(node.humanRetryAuthorization) } : {}),
      }]),
    ),
  };
}

/**
 * Rebuilds a journal from its append-only events and returns only a stable
 * replay projection. No provider, filesystem asset or receipt is touched.
 */
export function replayExecutionJournal({ dbFile } = {}) {
  const resolved = path.resolve(String(dbFile));
  const db = openJournal(resolved);
  try {
    const events = db.prepare(
      "SELECT seq,type,node_id AS nodeId,attempt_id AS attemptId,data FROM events ORDER BY seq",
    ).all().map((event) => ({
      seq: Number(event.seq),
      type: event.type,
      nodeId: event.nodeId ?? null,
      attemptId: event.attemptId ?? null,
      data: JSON.parse(event.data),
    }));
    const snapshot = materializeWithDb(db, resolved);
    return {
      schema: EXECUTION_REPLAY_SCHEMA,
      planFingerprint: snapshot.planFingerprint,
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
      eventHash: operationFingerprint(events),
      projection: projectExecutionSnapshotForReplay(snapshot),
    };
  } finally {
    db.close();
  }
}

export function appendExecutionEvent({ dbFile, event, fault = null } = {}) {
  if (PROTECTED_EXECUTION_EVENT_TYPES.has(String(event?.type ?? ""))) {
    throw new Error(
      `Evento ${event.type} pertence ao Execution Kernel e não aceita append genérico.`,
    );
  }
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const eventId = insertEvent(db, event);
    if (fault === "after_insert") throw new Error("fault injection after_insert");
    db.exec("COMMIT");
    return { eventId, snapshot: materializeWithDb(db, path.resolve(String(dbFile))) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function normalizeArtifactDescriptor(artifact, { nodeId, index }) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(`artifacts[${index}] é inválido.`);
  }
  const allowed = new Set([
    "artifactId",
    "sha256",
    "bytes",
    "mimeType",
    "receiptId",
    "receiptSha256",
  ]);
  const unexpected = Object.keys(artifact).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`artifacts[${index}] contém campos não permitidos.`);
  }
  const sha256 = requiredHash(artifact.sha256, `artifacts[${index}].sha256`);
  const bytes = Number(artifact.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(`artifacts[${index}].bytes é inválido.`);
  }
  const mimeType = requiredText(
    artifact.mimeType,
    `artifacts[${index}].mimeType`,
  );
  if (!/^(?:image|video|audio)\//.test(mimeType)) {
    throw new Error(`artifacts[${index}].mimeType não é audiovisual.`);
  }
  const receiptId = requiredText(
    artifact.receiptId,
    `artifacts[${index}].receiptId`,
  );
  const receiptSha256 = requiredHash(
    artifact.receiptSha256,
    `artifacts[${index}].receiptSha256`,
  );
  const artifactId = artifact.artifactId == null
    ? `artifact:${operationFingerprint({
      nodeId,
      sha256,
      bytes,
      mimeType,
      receiptId,
      receiptSha256,
    })}`
    : requiredText(artifact.artifactId, `artifacts[${index}].artifactId`);
  return {
    artifactId,
    sha256,
    bytes,
    mimeType,
    receiptId,
    receiptSha256,
  };
}

function planFromDb(db) {
  const planValue = db.prepare(
    "SELECT value FROM metadata WHERE key='plan'",
  ).get()?.value;
  if (!planValue) throw new Error("Journal sem execution plan.");
  return JSON.parse(planValue);
}

function paidCallForJournalNode(plan, nodeId) {
  const node = plan.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`Nó desconhecido: ${nodeId}.`);
  const calls = (plan.governance?.paidCalls ?? []).filter(
    (entry) =>
      Array.isArray(entry.nodeIds) && entry.nodeIds.includes(nodeId),
  );
  if (calls.length !== 1) {
    throw new Error(`Nó ${nodeId} não possui capability paga canônica única.`);
  }
  return { node, call: calls[0] };
}

function approvalsForJournalNode(db, plan, node) {
  const approvalDependencies = (node.dependencies ?? [])
    .filter((dependencyId) =>
      plan.nodes.some(
        (candidate) =>
          candidate.id === dependencyId && ["human-approval", "workflow-authorization"].includes(candidate.kind),
      ));
  return approvalDependencies.flatMap((dependencyId) => {
    const row = db.prepare(`
      SELECT seq,data
      FROM events
      WHERE node_id=? AND type='node_approved'
      ORDER BY seq DESC
      LIMIT 1
    `).get(dependencyId);
    if (!row) return [];
    const data = JSON.parse(row.data);
    return [{
      nodeId: dependencyId,
      approvalHash: requiredHash(
        data.approvalHash,
        `approval ${dependencyId}.approvalHash`,
      ),
      actor: requiredText(data.actor, `approval ${dependencyId}.actor`),
      source: requiredText(data.source, `approval ${dependencyId}.source`),
      actorKind: requiredText(data.actorKind ?? "legacy-unknown", `approval ${dependencyId}.actorKind`),
      approvedAt: canonicalNow(data.approvedAt).toISOString(),
      createdSequence: Number(row.seq),
    }];
  });
}

function buildExecutionRightsDecisionWithDb(db, plan, nodeId) {
  const { node, call } = paidCallForJournalNode(plan, nodeId);
  const approvals = approvalsForJournalNode(db, plan, node);
  if (!executionNodeRequiresMediaInputs(node, call)) {
    return createNoProviderInputRightsDecision({
      plan,
      nodeId,
      approvals,
      headSequence: approvals.reduce((maximum, row) => Math.max(maximum, Number(row.createdSequence ?? 0)), 0),
    });
  }
  const dependencies = new Set(node.dependencies ?? []);
  const rows = db.prepare(`
    SELECT
      artifact_id AS artifactId,
      node_id AS nodeId,
      sha256,
      bytes,
      mime_type AS mimeType,
      receipt_id AS receiptId,
      receipt_sha256 AS receiptSha256,
      status,
      created_seq AS createdSequence,
      revoked_seq AS revokedSequence
    FROM execution_artifacts
    ORDER BY artifact_id
  `).all();
  const relevant = rows.filter((row) => dependencies.has(row.nodeId));
  if (relevant.some((row) => row.status !== "active")) {
    throw new Error(`Rights de artifact dependente de ${nodeId} foram revogados.`);
  }
  const inputs = relevant.map((row) => ({
    artifactId: row.artifactId,
    nodeId: row.nodeId,
    sha256: row.sha256,
    bytes: Number(row.bytes),
    mimeType: row.mimeType,
    receiptId: row.receiptId,
    receiptSha256: row.receiptSha256,
    createdSequence: Number(row.createdSequence),
  }));
  const headSequence = [...relevant, ...approvals].reduce(
    (maximum, row) =>
      Math.max(
        maximum,
        Number(row.createdSequence ?? 0),
        Number(row.revokedSequence ?? 0),
      ),
    0,
  );
  return createSameExecutionRightsDecision({
    plan,
    nodeId,
    inputs,
    approvals,
    headSequence,
  });
}

export function buildExecutionRightsDecision({ dbFile, nodeId } = {}) {
  const db = openJournal(dbFile);
  try {
    const plan = planFromDb(db);
    return buildExecutionRightsDecisionWithDb(db, plan, nodeId);
  } finally {
    db.close();
  }
}

function humanRetryTableExists(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='human_retry_decisions'").get());
}

function maxNodeAttempts(plan) {
  const value = Number(plan.spec?.workflow?.maxAttempts ?? 1);
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new Error("Plano possui maxAttempts inválido para nova tentativa humana.");
  return value;
}

function validateHumanRetryWithDb(db, { plan, decision, confirmHuman }) {
  if (confirmHuman !== true || decision?.acknowledgeUnknownEffect !== true) throw new Error("Nova tentativa exige confirmação humana e ciência literal do efeito anterior desconhecido.");
  const allowed = new Set(["schema", "decisionId", "planFingerprint", "productionId", "actor", "reason", "acknowledgeUnknownEffect", "attempts", "unsubmittedScenes"]);
  if (!decision || Object.keys(decision).some((key) => !allowed.has(key)) || (decision.schema != null && decision.schema !== "mkt-videos/human-retry-decision@1")) throw new Error("Decisão de nova tentativa contém campos inválidos.");
  const storedPlan = planFromDb(db);
  if (plan?.schema !== "mkt-videos/execution-plan@1" || operationFingerprint(plan) !== operationFingerprint(storedPlan)) throw new Error("Plano da nova tentativa diverge do journal congelado.");
  const normalized = {
    schema: "mkt-videos/human-retry-decision@1",
    decisionId: requiredText(decision.decisionId, "decisionId"),
    planFingerprint: requiredHash(decision.planFingerprint, "planFingerprint"),
    productionId: requiredText(decision.productionId, "productionId"),
    actor: requiredText(decision.actor, "actor"),
    reason: requiredText(decision.reason, "reason", 1000),
    acknowledgeUnknownEffect: true,
    attempts: [],
  };
  if (normalized.planFingerprint !== storedPlan.fingerprint) throw new Error("Decisão pertence a outro planFingerprint.");
  const productionId = storedPlan.spec?.productionContextBinding?.productionId ?? storedPlan.spec?.name ?? "production";
  if (normalized.productionId !== productionId) throw new Error("Decisão pertence a outra produção.");
  if (!Array.isArray(decision.attempts) || !decision.attempts.length || decision.attempts.length > storedPlan.nodes.length) throw new Error("Decisão exige a lista exata de tentativas anteriores.");
  normalized.attempts = decision.attempts.map((entry) => {
    if (!entry || Object.keys(entry).some((key) => !["nodeId", "attemptId"].includes(key))) throw new Error("Alvo da nova tentativa contém campos inválidos.");
    return { nodeId: requiredText(entry.nodeId, "nodeId"), attemptId: requiredText(entry.attemptId, "attemptId") };
  }).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (new Set(normalized.attempts.map((entry) => entry.nodeId)).size !== normalized.attempts.length || new Set(normalized.attempts.map((entry) => entry.attemptId)).size !== normalized.attempts.length) throw new Error("Decisão contém alvo duplicado.");
  if (decision.unsubmittedScenes != null) {
    if (!Array.isArray(decision.unsubmittedScenes)) throw new Error("unsubmittedScenes deve ser lista de cenas não submetidas.");
    normalized.unsubmittedScenes = decision.unsubmittedScenes.map((entry) => {
      if (!entry || Object.keys(entry).some((key) => !["sceneId", "attemptId"].includes(key))) throw new Error("unsubmittedScenes exige {sceneId,attemptId} exato.");
      return { sceneId: requiredText(entry.sceneId, "unsubmittedScenes.sceneId"), attemptId: requiredText(entry.attemptId, "unsubmittedScenes.attemptId") };
    });
    if (new Set(normalized.unsubmittedScenes.map((entry) => entry.sceneId)).size !== normalized.unsubmittedScenes.length || new Set(normalized.unsubmittedScenes.map((entry) => entry.attemptId)).size !== normalized.unsubmittedScenes.length) throw new Error("unsubmittedScenes contém cena ou tentativa duplicada.");
  }
  const decisionHash = operationFingerprint(normalized);
  const existing = humanRetryTableExists(db) ? db.prepare("SELECT * FROM human_retry_decisions WHERE decision_id=?").get(normalized.decisionId) : null;
  if (existing && (existing.decision_hash !== decisionHash || operationFingerprint(JSON.parse(existing.decision_json)) !== decisionHash)) throw new Error("decisionId já registrado com conteúdo divergente.");
  const snapshot = materializeWithDb(db, "read-only");
  if (existing) return { decision: normalized, decisionHash, replayed: true, snapshot };
  const limit = maxNodeAttempts(storedPlan);
  for (const target of normalized.attempts) {
    const node = snapshot.nodes[target.nodeId];
    const { node: definition, call } = paidCallForJournalNode(storedPlan, target.nodeId);
    if (!["omni-video", "omni-narration"].includes(definition.kind) || call.provider !== "gemini-omni") throw new Error("Substituição humana está limitada a tentativas Gemini Omni.");
    if (!node || !["ambiguous", "attention_required"].includes(node.status) || node.attemptId !== target.attemptId) throw new Error(`Alvo ${target.nodeId} não é a tentativa ambígua atual.`);
    const attempt = db.prepare("SELECT status FROM attempts WHERE node_id=? AND attempt_id=?").get(target.nodeId, target.attemptId);
    if (!attempt || !["ambiguous", "attention_required"].includes(attempt.status)) throw new Error(`Attempt ${target.attemptId} não está ambíguo no journal.`);
    if (node.attempts >= limit) throw new Error(`maxAttempts ${limit} atingido no nó ${target.nodeId}.`);
    if (humanRetryTableExists(db) && db.prepare("SELECT 1 FROM human_retry_authorizations WHERE old_attempt_id=?").get(target.attemptId)) throw new Error("Tentativa antiga já possui uma decisão de substituição.");
  }
  for (const { sceneId } of normalized.unsubmittedScenes ?? []) {
    const node = snapshot.nodes[`video:${sceneId}`];
    if (!node || node.status !== "planned" || node.attemptId || node.attempts !== 0) throw new Error(`Cena ${sceneId} já possui tentativa ou estado incompatível com não submetida.`);
  }
  return { decision: normalized, decisionHash, replayed: false, snapshot };
}

export function prepareHumanRetryAuthorization({ dbFile, plan, decision, confirmHuman } = {}) {
  const db = new DatabaseSync(path.resolve(requiredText(dbFile, "dbFile")), { readOnly: true });
  try {
    db.exec("BEGIN");
    return validateHumanRetryWithDb(db, { plan, decision, confirmHuman });
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

export function registerHumanRetryAuthorization({ dbFile, plan, decision, confirmHuman, administrativeReleases, now = new Date(), fault = null } = {}) {
  const timestamp = canonicalNow(now).toISOString();
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const prepared = validateHumanRetryWithDb(db, { plan, decision, confirmHuman });
    const normalized = prepared.decision;
    if (!Array.isArray(administrativeReleases) || administrativeReleases.length !== normalized.attempts.length) throw new Error("Registro exige uma liberação administrativa por tentativa exata.");
    const releases = administrativeReleases.map((proof) => assertRemoteReplacementDecision(proof));
    if (new Set(releases.map((proof) => proof.attemptId)).size !== releases.length) throw new Error("Liberação administrativa duplicada.");
    for (const target of normalized.attempts) {
      const release = releases.find((proof) => proof.attemptId === target.attemptId);
      if (!release || release.decisionId !== normalized.decisionId || release.productionId !== normalized.productionId || release.operationId !== `omni:${target.attemptId}` || release.actor !== normalized.actor || release.reason !== normalized.reason) throw new Error(`Liberação administrativa diverge do alvo ${target.nodeId}.`);
      if (prepared.replayed) {
        const prior = db.prepare("SELECT release_hash FROM human_retry_authorizations WHERE decision_id=? AND node_id=? AND old_attempt_id=?").get(normalized.decisionId, target.nodeId, target.attemptId);
        if (!prior || prior.release_hash !== release.hash) throw new Error("Replay da liberação administrativa diverge do registro original.");
      }
    }
    if (!prepared.replayed) {
      db.prepare("INSERT INTO human_retry_decisions(decision_id,decision_hash,decision_json,registered_at) VALUES (?,?,?,?)").run(normalized.decisionId, prepared.decisionHash, JSON.stringify(normalized), timestamp);
      for (const target of normalized.attempts) {
        const release = releases.find((proof) => proof.attemptId === target.attemptId);
        db.prepare("INSERT INTO human_retry_authorizations(decision_id,node_id,old_attempt_id,budget_key,release_hash,release_json,status) VALUES (?,?,?,?,?,?,'issued')").run(normalized.decisionId, target.nodeId, target.attemptId, "omni", release.hash, JSON.stringify(release));
        insertEvent(db, { type: "human_retry_authorized", nodeId: target.nodeId, attemptId: target.attemptId, at: timestamp,
          data: { decisionId: normalized.decisionId, decisionHash: prepared.decisionHash, actor: normalized.actor, reason: normalized.reason, acknowledgeUnknownEffect: true, releaseHash: release.hash, additionalAttempts: 1, maxAttempts: maxNodeAttempts(plan) } });
      }
    }
    if (fault === "after_human_retry_registered") throw new Error("fault injection after_human_retry_registered");
    db.exec("COMMIT");
    return { ...prepared, decisionId: normalized.decisionId, snapshot: materializeWithDb(db, path.resolve(String(dbFile))) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function pendingHumanRetry(db, node) {
  if (!node?.humanRetryAuthorization || node.humanRetryAuthorization.status !== "issued" || node.humanRetryAuthorization.oldAttemptId !== node.attemptId) return null;
  const row = db.prepare("SELECT * FROM human_retry_authorizations WHERE decision_id=? AND node_id=? AND old_attempt_id=? AND status='issued'").get(node.humanRetryAuthorization.decisionId, node.id, node.attemptId);
  if (!row || row.release_hash !== node.humanRetryAuthorization.releaseHash) throw new Error("Autorização humana diverge da projeção do journal.");
  const proof = assertRemoteReplacementDecision(JSON.parse(row.release_json));
  if (proof.hash !== row.release_hash || proof.attemptId !== row.old_attempt_id) throw new Error("Liberação administrativa persistida divergiu.");
  const decision = db.prepare("SELECT * FROM human_retry_decisions WHERE decision_id=?").get(row.decision_id);
  if (!decision || decision.decision_hash !== node.humanRetryAuthorization.decisionHash || operationFingerprint(JSON.parse(decision.decision_json)) !== decision.decision_hash) throw new Error("Decisão humana persistida divergiu.");
  return row;
}

function assertAttemptNotAdministrativelyReplaced(db, nodeId, attemptId) {
  if (db.prepare("SELECT 1 FROM human_retry_authorizations WHERE node_id=? AND old_attempt_id=?").get(nodeId, attemptId)) throw new Error("Tentativa anterior preservada com efeito desconhecido após decisão administrativa de substituição.");
}

export function beginNodeAttempt({
  dbFile,
  nodeId,
  attemptId = randomUUID(),
  authorization = null,
  providerCapabilities,
  now = new Date(),
  fault = null,
} = {}) {
  const current = canonicalNow(now);
  const normalizedNodeId = requiredText(nodeId, "nodeId");
  const normalizedAttemptId = requiredText(attemptId, "attemptId");
  const db = openJournal(dbFile);
  let projectedAuthorization = null;
  let effectAuthorization = null;
  try {
    db.exec("BEGIN IMMEDIATE");
    const snapshot = materializeWithDb(db, path.resolve(String(dbFile)));
    const plan = planFromDb(db);
    const planNode = plan.nodes.find(
      (candidate) => candidate.id === normalizedNodeId,
    );
    const node = snapshot.nodes[normalizedNodeId];
    if (!node || !planNode) throw new Error(`Nó desconhecido: ${normalizedNodeId}.`);
    if (["running", "provider_pending", "ambiguous", "completed"].includes(node.status)) throw new Error(`Nó ${normalizedNodeId} não autoriza nova tentativa no estado ${node.status}.`);
    const humanRetry = pendingHumanRetry(db, node);
    if (humanRetry && node.attempts >= maxNodeAttempts(plan)) throw new Error(`maxAttempts ${maxNodeAttempts(plan)} atingido no nó ${normalizedNodeId}.`);
    let authorizationHash = null;
    let rightsDecisionHash = null;
    let capabilitySnapshotHash = null;
    if (node.costClass !== "local") {
      if (node.status !== "ready") {
        throw new Error(`Nó pago ${normalizedNodeId} exige autorização explícita antes da tentativa.`);
      }
      assertNodeDependenciesCompleted(snapshot, planNode);
      const rightsDecision = buildExecutionRightsDecisionWithDb(
        db,
        plan,
        normalizedNodeId,
      );
      assertExecutionAuthorizationRuntime(authorization, {
        providerCapabilities,
        plan,
        nodeId: normalizedNodeId,
        rightsDecision,
        now: current,
      });
      const projected = projectExecutionAuthorization(authorization);
      projectedAuthorization = projected;
      const stored = db.prepare(`
        SELECT *
        FROM execution_authorizations
        WHERE authorization_hash=? AND node_id=? AND nonce=?
      `).get(
        projected.authorizationHash,
        normalizedNodeId,
        projected.nonce,
      );
      if (!stored || stored.status !== "issued") {
        throw new Error("Nonce de ExecutionAuthorization ausente ou já consumido.");
      }
      if (
        stored.plan_fingerprint !== plan.fingerprint
        || stored.node_fingerprint !== node.fingerprint
        || stored.rights_decision_hash !== rightsDecision.decisionHash
        || Number(stored.rights_head_sequence) !== rightsDecision.headSequence
      ) {
        throw new Error("ExecutionAuthorization persistida diverge do head atual.");
      }
      const consumed = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM execution_authorizations authorization
        LEFT JOIN attempts attempt ON attempt.attempt_id=authorization.attempt_id
        WHERE authorization.budget_key=?
          AND authorization.status='consumed'
          AND COALESCE(attempt.status,'') NOT IN ('pre_effect_failed','provider_unaccepted')
      `).get(projected.hardLimit.budgetKey)?.count ?? 0);
      const additionalHumanAttempts = Number(db.prepare("SELECT COUNT(*) AS count FROM human_retry_authorizations WHERE budget_key=? AND status='consumed'").get(projected.hardLimit.budgetKey)?.count ?? 0) + (humanRetry ? 1 : 0);
      if (consumed + projected.estimatedCostOrQuota.amount > projected.hardLimit.amount + additionalHumanAttempts) {
        throw new Error(`Hard limit ${projected.hardLimit.budgetKey} foi atingido.`);
      }
      const updated = db.prepare(`
        UPDATE execution_authorizations
        SET status='consumed',consumed_at=?,attempt_id=?
        WHERE authorization_hash=? AND status='issued'
      `).run(
        current.toISOString(),
        normalizedAttemptId,
        projected.authorizationHash,
      );
      if (Number(updated.changes) !== 1) {
        throw new Error("Nonce de ExecutionAuthorization foi consumido concorrentemente.");
      }
      if (fault === "after_authorization_consumed") {
        throw new Error("fault injection after_authorization_consumed");
      }
      authorizationHash = projected.authorizationHash;
      rightsDecisionHash = projected.rightsDecisionHash;
      capabilitySnapshotHash = projected.capabilitySnapshotHash;
      if (humanRetry) {
        const retryConsumed = db.prepare("UPDATE human_retry_authorizations SET status='consumed',consumed_by_attempt_id=?,consumed_at=? WHERE decision_id=? AND node_id=? AND old_attempt_id=? AND status='issued'").run(normalizedAttemptId, current.toISOString(), humanRetry.decision_id, normalizedNodeId, humanRetry.old_attempt_id);
        if (Number(retryConsumed.changes) !== 1) throw new Error("Autorização humana já consumida por outra tentativa.");
        insertEvent(db, { type: "human_retry_consumed", nodeId: normalizedNodeId, attemptId: humanRetry.old_attempt_id, at: current.toISOString(), data: { decisionId: humanRetry.decision_id, newAttemptId: normalizedAttemptId, additionalBudgetAllowance: 1, budgetKey: projected.hardLimit.budgetKey } });
        if (fault === "after_human_retry_consumed") throw new Error("fault injection after_human_retry_consumed");
      }
    } else {
      assertNodeDependenciesCompleted(snapshot, planNode);
      if (authorization !== null) {
        throw new Error(`Nó local ${normalizedNodeId} não aceita ExecutionAuthorization paga.`);
      }
    }
    const timestamp = current.toISOString();
    db.prepare("INSERT INTO attempts(attempt_id,node_id,status,created_at,updated_at) VALUES (?,?,?,?,?)").run(normalizedAttemptId, normalizedNodeId, "started", timestamp, timestamp);
    insertEvent(db, {
      type: "node_started",
      nodeId: normalizedNodeId,
      attemptId: normalizedAttemptId,
      at: timestamp,
      data: {
        ...(humanRetry ? { humanRetryDecisionId: humanRetry.decision_id, replacesUnknownAttemptId: humanRetry.old_attempt_id } : {}),
        ...(authorizationHash ? {
          authorizationHash,
          rightsDecisionHash,
          capabilitySnapshotHash,
        } : {}),
      },
    });
    effectAuthorization = projectedAuthorization
      ? createExecutionEffectAuthorization({
        authorization: projectedAuthorization,
        attemptId: normalizedAttemptId,
        startedAt: current,
      })
      : null;
    if (fault === "after_effect_authorization_created") {
      throw new Error("fault injection after_effect_authorization_created");
    }
    const committedSnapshot = materializeWithDb(
      db,
      path.resolve(String(dbFile)),
    );
    db.exec("COMMIT");
    return {
      attemptId: normalizedAttemptId,
      effectAuthorization,
      ...(humanRetry ? { humanRetry: { decisionId: humanRetry.decision_id, oldAttemptId: humanRetry.old_attempt_id } } : {}),
      snapshot: committedSnapshot,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

export function recordExecutionNodeApproval({
  dbFile,
  nodeId,
  targetHash,
  actor,
  actorKind = "human",
  source = "approve-command",
  approvedAt = new Date(),
} = {}) {
  const current = canonicalNow(approvedAt);
  const normalizedNodeId = requiredText(nodeId, "nodeId");
  const normalizedActor = requiredText(actor, "actor");
  const normalizedActorKind = requiredText(actorKind, "actorKind");
  if (!new Set(["human", "automation"]).has(normalizedActorKind)) throw new Error("actorKind deve ser human ou automation.");
  const normalizedSource = requiredText(source, "source");
  const normalizedTargetHash = requiredHash(targetHash, "targetHash");
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const plan = planFromDb(db);
    const node = plan.nodes.find((candidate) => candidate.id === normalizedNodeId);
    if (!node) throw new Error(`Nó desconhecido: ${normalizedNodeId}.`);
    if (!["human-approval", "workflow-authorization"].includes(node.kind) || node.costClass !== "local") {
      throw new Error(`${normalizedNodeId} não é um nó canônico de autorização.`);
    }
    if (node.kind === "human-approval" && normalizedActorKind !== "human") throw new Error(`${normalizedNodeId} exige decisão humana real.`);
    if (node.kind === "workflow-authorization" && normalizedActorKind !== "automation") throw new Error(`${normalizedNodeId} exige autorização de workflow, não aprovação humana.`);
    assertNodeDependenciesCompleted(
      materializeWithDb(db, path.resolve(String(dbFile))),
      node,
    );
    const body = {
      planFingerprint: plan.fingerprint,
      nodeId: normalizedNodeId,
      nodeFingerprint: node.fingerprint,
      targetHash: normalizedTargetHash,
      actor: normalizedActor,
      actorKind: normalizedActorKind,
      source: normalizedSource,
      approvedAt: current.toISOString(),
    };
    const approvalHash = operationFingerprint(body);
    const existing = db.prepare(`
      SELECT data
      FROM events
      WHERE node_id=? AND type='node_approved'
      ORDER BY seq DESC
      LIMIT 1
    `).get(normalizedNodeId);
    if (existing) {
      const prior = JSON.parse(existing.data);
      if (prior.approvalHash !== approvalHash) {
        throw new Error(
          `Nó ${normalizedNodeId} já possui outra aprovação; altere o plano para uma nova decisão.`,
        );
      }
      db.exec("COMMIT");
      return materializeWithDb(db, path.resolve(String(dbFile)));
    }
    insertEvent(db, {
      type: "node_approved",
      nodeId: normalizedNodeId,
      at: current.toISOString(),
      data: {
        approvalHash,
        targetHash: normalizedTargetHash,
        actor: normalizedActor,
        actorKind: normalizedActorKind,
        source: normalizedSource,
        approvedAt: current.toISOString(),
      },
    });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

export function authorizeJournalNode({
  dbFile,
  nodeId,
  authorization,
  providerCapabilities,
  now = new Date(),
} = {}) {
  const current = canonicalNow(now);
  assertExecutionAuthorization(authorization, { expectedNodeId: nodeId });
  const projected = projectExecutionAuthorization(authorization);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const plan = planFromDb(db);
    const snapshot = materializeWithDb(db, path.resolve(String(dbFile)));
    const node = snapshot.nodes[nodeId];
    if (!node) throw new Error(`Nó desconhecido: ${nodeId}.`);
    if (node.costClass === "local") {
      throw new Error(`Nó local ${nodeId} não exige autorização paga.`);
    }
    const humanRetry = pendingHumanRetry(db, node);
    if (!["planned", "stale_paid", "reapproval_required"].includes(node.status) && !(humanRetry && ["ambiguous", "attention_required"].includes(node.status))) {
      throw new Error(`Nó ${nodeId} não pode ser autorizado no estado ${node.status}.`);
    }
    if (humanRetry && node.attempts >= maxNodeAttempts(plan)) throw new Error(`maxAttempts ${maxNodeAttempts(plan)} atingido no nó ${nodeId}.`);
    const expired = db.prepare(`
      SELECT authorization_hash AS authorizationHash
      FROM execution_authorizations
      WHERE node_id=? AND status='issued' AND expires_at<=?
      ORDER BY issued_at,authorization_hash
    `).all(nodeId, current.toISOString());
    for (const entry of expired) {
      db.prepare(`
        UPDATE execution_authorizations
        SET status='expired'
        WHERE authorization_hash=? AND status='issued'
      `).run(entry.authorizationHash);
      insertEvent(db, {
        type: "node_authorization_expired",
        nodeId,
        data: { authorizationHash: entry.authorizationHash },
        at: current.toISOString(),
      });
    }
    const active = db.prepare(`
      SELECT authorization_hash AS authorizationHash
      FROM execution_authorizations
      WHERE node_id=? AND status='issued'
      LIMIT 1
    `).get(nodeId);
    if (active) {
      throw new Error(`Nó ${nodeId} já possui autorização vigente não consumida.`);
    }
    const rightsDecision = buildExecutionRightsDecisionWithDb(
      db,
      plan,
      nodeId,
    );
    assertExecutionAuthorizationRuntime(authorization, {
      providerCapabilities,
      plan,
      nodeId,
      rightsDecision,
      now: current,
    });
    db.prepare(`
      INSERT INTO execution_authorizations(
        authorization_hash,nonce,plan_fingerprint,node_id,node_fingerprint,
        provider,operation,capability_snapshot_hash,capability_expires_at,
        rights_decision_hash,rights_head_sequence,budget_key,quota_amount,
        hard_limit_amount,authentication_mode,issued_at,expires_at,status,
        projection
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'issued',?)
    `).run(
      projected.authorizationHash,
      projected.nonce,
      projected.planFingerprint,
      projected.nodeId,
      projected.nodeFingerprint,
      projected.provider,
      projected.operation,
      projected.capabilitySnapshotHash,
      projected.capabilityExpiresAt,
      projected.rightsDecisionHash,
      projected.rightsHeadSequence,
      projected.hardLimit.budgetKey,
      projected.estimatedCostOrQuota.amount,
      projected.hardLimit.amount,
      projected.authenticationMode,
      projected.issuedAt,
      projected.expiresAt,
      JSON.stringify(projected),
    );
    insertEvent(db, {
      type: "node_authorized",
      nodeId,
      data: {
        authorizationHash: projected.authorizationHash,
        expiresAt: projected.expiresAt,
        capabilitySnapshotHash: projected.capabilitySnapshotHash,
        rightsDecisionHash: projected.rightsDecisionHash,
        rightsHeadSequence: projected.rightsHeadSequence,
        hardLimit: projected.hardLimit,
        actor: projected.explicitConfirmation.actor,
        source: projected.explicitConfirmation.source,
      },
      at: current.toISOString(),
    });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

export function persistJournalProviderHandle({ dbFile, nodeId, attemptId, handle } = {}) {
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    assertAttemptNotAdministrativelyReplaced(db, nodeId, attemptId);
    const attempt = db.prepare("SELECT * FROM attempts WHERE attempt_id=? AND node_id=?").get(attemptId, nodeId);
    if (!attempt) throw new Error(`Attempt ${attemptId} não pertence ao nó ${nodeId}.`);
    const now = new Date().toISOString();
    db.prepare("UPDATE attempts SET status=?,handle=?,updated_at=? WHERE attempt_id=?").run("provider_pending", JSON.stringify(handle), now, attemptId);
    insertEvent(db, { type: "provider_handle_persisted", nodeId, attemptId, data: { handle }, at: now });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

export function claimNodeReconciliation({ dbFile, nodeId, now = new Date() } = {}) {
  const current = canonicalNow(now);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const attempt = db.prepare(`
      SELECT attempt_id AS attemptId,status FROM attempts
      WHERE node_id=? ORDER BY created_at DESC,attempt_id DESC LIMIT 1
    `).get(nodeId);
    if (!attempt || !["provider_pending", "ambiguous", "attention_required"].includes(attempt.status)) {
      throw new Error(`Nó ${nodeId} não possui tentativa reconciliável.`);
    }
    assertAttemptNotAdministrativelyReplaced(db, nodeId, attempt.attemptId);
    const timestamp = current.toISOString();
    const updated = db.prepare(`
      UPDATE attempts SET status='reconciling',updated_at=?
      WHERE attempt_id=? AND node_id=? AND status IN ('provider_pending','ambiguous','attention_required')
    `).run(timestamp, attempt.attemptId, nodeId);
    if (Number(updated.changes) !== 1) throw new Error(`Reconciliação concorrente já assumiu ${nodeId}.`);
    insertEvent(db, { type: "node_reconcile_started", nodeId, attemptId: attempt.attemptId, data: {}, at: timestamp });
    db.exec("COMMIT");
    return { nodeId, attemptId: attempt.attemptId, status: "reconciling" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

export function recordNodeCompletion({
  dbFile,
  nodeId,
  attemptId = null,
  output = null,
  receipt = null,
  artifacts = [],
  now = new Date(),
  reconciled = false,
  executionTiming = null,
  reuseSource = null,
} = {}) {
  const current = canonicalNow(now);
  if (reuseSource != null && reuseSource !== "approved-archive") throw new Error("reuseSource inválida.");
  const timing = executionTiming == null ? null : assertExecutionTiming(executionTiming);
  if (!Array.isArray(artifacts) || artifacts.length > 64) {
    throw new Error("artifacts deve ser uma lista de até 64 itens.");
  }
  const normalizedArtifacts = artifacts.map((artifact, index) =>
    normalizeArtifactDescriptor(artifact, { nodeId, index }));
  if (
    new Set(normalizedArtifacts.map((artifact) => artifact.artifactId)).size
    !== normalizedArtifacts.length
  ) {
    throw new Error("artifacts contém IDs duplicados.");
  }
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const plan = planFromDb(db);
    if (!plan.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Nó desconhecido: ${nodeId}.`);
    }
    const timestamp = current.toISOString();
    if (attemptId) {
      assertAttemptNotAdministrativelyReplaced(db, nodeId, attemptId);
      const allowedStatuses = reconciled
        ? "('started','provider_pending','ambiguous','attention_required','reconciling')"
        : "('started','provider_pending')";
      const updated = db.prepare(
        `UPDATE attempts SET status='completed',updated_at=? WHERE attempt_id=? AND node_id=? AND status IN ${allowedStatuses}`,
      ).run(timestamp, attemptId, nodeId);
      if (Number(updated.changes) !== 1) {
        throw new Error(`Attempt ${attemptId} não está ativo no nó ${nodeId}.`);
      }
    }
    const eventId = insertEvent(db, {
      type: "node_completed",
      nodeId,
      attemptId,
      data: {
        output,
        receipt,
        artifactIds: normalizedArtifacts.map((artifact) => artifact.artifactId),
        reconciled: Boolean(reconciled),
        ...(reuseSource ? { reuseSource } : {}),
        ...(timing ? { executionTiming: timing } : {}),
      },
      at: timestamp,
    });
    const createdSequence = eventSequence(db, eventId);
    const insertArtifact = db.prepare(`
      INSERT INTO execution_artifacts(
        artifact_id,node_id,sha256,bytes,mime_type,receipt_id,receipt_sha256,
        status,created_seq,revoked_seq,created_at,revoked_at
      ) VALUES (?,?,?,?,?,?,?,'active',?,NULL,?,NULL)
    `);
    for (const artifact of normalizedArtifacts) {
      insertArtifact.run(
        artifact.artifactId,
        nodeId,
        artifact.sha256,
        artifact.bytes,
        artifact.mimeType,
        artifact.receiptId,
        artifact.receiptSha256,
        createdSequence,
        timestamp,
      );
    }
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

export function assertJournalNodeArtifacts({ dbFile, nodeId, artifacts } = {}) {
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN");
    const completion = db.prepare("SELECT seq FROM events WHERE node_id=? AND type='node_completed' ORDER BY seq DESC LIMIT 1").get(nodeId);
    const expected = completion ? db.prepare(`
      SELECT sha256, bytes, mime_type AS mimeType, receipt_id AS receiptId,
        receipt_sha256 AS receiptSha256, status
      FROM execution_artifacts WHERE node_id=? AND created_seq=?
    `).all(nodeId, completion.seq) : [];
    const keys = ["sha256", "bytes", "mimeType", "receiptId", "receiptSha256"];
    const remaining = [...expected];
    const matches = Array.isArray(artifacts) && artifacts.length > 0 && artifacts.length === expected.length && artifacts.every((artifact) => {
      const index = remaining.findIndex((row) => row.status === "active" && keys.every((key) => row[key] === artifact[key]));
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    });
    if (!matches) throw new Error("Saída ou recibo concluído diverge dos hashes registrados no journal.");
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

export function revokeExecutionArtifact({
  dbFile,
  artifactId,
  actor,
  reason,
  now = new Date(),
} = {}) {
  const current = canonicalNow(now);
  const normalizedArtifactId = requiredText(artifactId, "artifactId");
  const normalizedActor = requiredText(actor, "actor");
  const normalizedReason = requiredText(reason, "reason", 2_000);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const artifact = db.prepare(`
      SELECT artifact_id AS artifactId,node_id AS nodeId,status
      FROM execution_artifacts
      WHERE artifact_id=?
    `).get(normalizedArtifactId);
    if (!artifact) throw new Error(`Artifact desconhecido: ${normalizedArtifactId}.`);
    if (artifact.status !== "active") {
      throw new Error(`Artifact ${normalizedArtifactId} já está ${artifact.status}.`);
    }
    const timestamp = current.toISOString();
    const eventId = insertEvent(db, {
      type: "execution_artifact_revoked",
      nodeId: artifact.nodeId,
      data: {
        artifactId: normalizedArtifactId,
        actor: normalizedActor,
        reason: normalizedReason,
      },
      at: timestamp,
    });
    const revokedSequence = eventSequence(db, eventId);
    const updated = db.prepare(`
      UPDATE execution_artifacts
      SET status='revoked',revoked_seq=?,revoked_at=?
      WHERE artifact_id=? AND status='active'
    `).run(revokedSequence, timestamp, normalizedArtifactId);
    if (Number(updated.changes) !== 1) {
      throw new Error("Artifact foi revogado concorrentemente.");
    }
    const plan = planFromDb(db);
    const dependentNodeIds = plan.nodes
      .filter((node) => (node.dependencies ?? []).includes(artifact.nodeId))
      .map((node) => node.id);
    for (const dependentNodeId of dependentNodeIds) {
      const issued = db.prepare(`
        SELECT authorization_hash AS authorizationHash
        FROM execution_authorizations
        WHERE node_id=? AND status='issued'
        ORDER BY issued_at,authorization_hash
      `).all(dependentNodeId);
      for (const authorization of issued) {
        db.prepare(`
          UPDATE execution_authorizations
          SET status='expired'
          WHERE authorization_hash=? AND status='issued'
        `).run(authorization.authorizationHash);
        insertEvent(db, {
          type: "node_invalidated",
          nodeId: dependentNodeId,
          data: {
            status: "reapproval_required",
            code: "execution_artifact_rights_revoked",
            artifactId: normalizedArtifactId,
            revokedSequence,
            authorizationHash: authorization.authorizationHash,
          },
          at: timestamp,
        });
      }
    }
    db.exec("COMMIT");
    return {
      artifactId: normalizedArtifactId,
      status: "revoked",
      revokedSequence,
      snapshot: materializeWithDb(db, path.resolve(String(dbFile))),
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

export function recordNodeFailure({ dbFile, nodeId, attemptId = null, error, status = "attention_required", executionTiming = null } = {}) {
  const timing = executionTiming == null ? null : assertExecutionTiming(executionTiming);
  const normalizedNodeId = requiredText(nodeId, "nodeId");
  const normalizedAttemptId = attemptId == null
    ? null
    : requiredText(attemptId, "attemptId");
  const normalizedStatus = requiredText(status, "status");
  if (!["attention_required", "ambiguous"].includes(normalizedStatus)) {
    throw new Error("status de falha deve ser attention_required ou ambiguous.");
  }
  const sanitizedError = sanitizeFailureForJournal(error);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const now = new Date().toISOString();
    if (normalizedAttemptId) {
      const updated = db.prepare(`
        UPDATE attempts
        SET status=?,updated_at=?
        WHERE attempt_id=? AND node_id=? AND status IN ('started','provider_pending')
      `).run(
        normalizedStatus,
        now,
        normalizedAttemptId,
        normalizedNodeId,
      );
      if (Number(updated.changes) !== 1) {
        throw new Error(
          `Attempt ${normalizedAttemptId} não está ativo no nó ${normalizedNodeId}.`,
        );
      }
    }
    insertEvent(db, {
      type: "node_failed",
      nodeId: normalizedNodeId,
      attemptId: normalizedAttemptId,
      data: { error: sanitizedError, status: normalizedStatus, ...(timing ? { executionTiming: timing } : {}) },
      at: now,
    });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (failure) {
    try { db.exec("ROLLBACK"); } catch {}
    throw failure;
  } finally { db.close(); }
}

export function recordNodePreEffectFailure({ dbFile, nodeId, attemptId, error } = {}) {
  const normalizedNodeId = requiredText(nodeId, "nodeId");
  const normalizedAttemptId = requiredText(attemptId, "attemptId");
  const message = String(error?.message ?? error ?? "");
  if (!message.includes("page.goto:")
    || !/net::ERR_(NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_RESET|INTERNET_DISCONNECTED)/.test(message)) {
    throw new Error("Falha pré-efeito não corresponde a uma navegação comprovadamente anterior ao request do provedor.");
  }
  const sanitizedError = sanitizeFailureForJournal(error);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const snapshot = materializeWithDb(db, path.resolve(String(dbFile)));
    const node = snapshot.nodes[normalizedNodeId];
    if (!node || !["ambiguous", "attention_required"].includes(node.status)) {
      throw new Error(`Nó ${normalizedNodeId} não está em falha recuperável.`);
    }
    if (node.attemptId !== normalizedAttemptId || node.providerHandle || node.output || node.receipt) {
      throw new Error(`Nó ${normalizedNodeId} possui evidência de efeito externo; recuperação pré-efeito bloqueada.`);
    }
    const updated = db.prepare(`
      UPDATE attempts
      SET status='pre_effect_failed',updated_at=?
      WHERE attempt_id=? AND node_id=? AND status IN ('ambiguous','attention_required')
    `).run(new Date().toISOString(), normalizedAttemptId, normalizedNodeId);
    if (Number(updated.changes) !== 1) throw new Error(`Attempt ${normalizedAttemptId} não está em falha recuperável.`);
    insertEvent(db, {
      type: "node_pre_effect_failed",
      nodeId: normalizedNodeId,
      attemptId: normalizedAttemptId,
      data: {
        error: sanitizedError,
        classification: "navigation-before-provider-request",
        externalEffect: false,
      },
    });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (failure) {
    try { db.exec("ROLLBACK"); } catch {}
    throw failure;
  } finally {
    db.close();
  }
}

export function recordNodeProviderUnaccepted({ dbFile, nodeId, attemptId, error, evidence } = {}) {
  const normalizedNodeId = requiredText(nodeId, "nodeId");
  const normalizedAttemptId = requiredText(attemptId, "attemptId");
  const classification = evidence?.classification === "correlated-transport-outage"
    ? "correlated-transport-outage"
    : "provider-unaccepted-after-zero-post-reconciliation";
  if (evidence?.zeroPostReconciliation !== true
    || evidence?.providerHandleObserved !== false
    || evidence?.providerBusyObserved !== false
    || !Number.isFinite(Number(evidence?.elapsedMs))
    || Number(evidence.elapsedMs) < 600_000) {
    throw new Error("Evidência insuficiente para classificar tentativa como não aceita pelo provedor.");
  }
  if (classification === "correlated-transport-outage"
    && (evidence?.providerResponseObserved !== false
      || Number(evidence?.correlatedFailureCount) < 2
      || !Number.isFinite(Number(evidence?.correlationWindowMs))
      || Number(evidence.correlationWindowMs) < 0
      || Number(evidence.correlationWindowMs) > 120_000)) {
    throw new Error("Evidência correlacionada insuficiente para classificar a pane de transporte.");
  }
  const sanitizedError = sanitizeFailureForJournal(error);
  const db = openJournal(dbFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const snapshot = materializeWithDb(db, path.resolve(String(dbFile)));
    const node = snapshot.nodes[normalizedNodeId];
    if (!node || !["ambiguous", "attention_required"].includes(node.status)) throw new Error(`Nó ${normalizedNodeId} não está ambíguo.`);
    if (node.attemptId !== normalizedAttemptId || node.providerHandle || node.output || node.receipt) {
      throw new Error(`Nó ${normalizedNodeId} possui evidência de aceitação externa; retry bloqueado.`);
    }
    const timestamp = new Date().toISOString();
    const updated = db.prepare(`
      UPDATE attempts
      SET status='provider_unaccepted',updated_at=?
      WHERE attempt_id=? AND node_id=? AND status IN ('ambiguous','attention_required')
    `).run(timestamp, normalizedAttemptId, normalizedNodeId);
    if (Number(updated.changes) !== 1) throw new Error(`Attempt ${normalizedAttemptId} não está em falha recuperável.`);
    insertEvent(db, {
      type: "node_provider_unaccepted",
      nodeId: normalizedNodeId,
      attemptId: normalizedAttemptId,
      data: {
        error: sanitizedError,
        classification,
        evidence: {
          zeroPostReconciliation: true,
          providerHandleObserved: false,
          providerBusyObserved: false,
          elapsedMs: Number(evidence.elapsedMs),
          ...(classification === "correlated-transport-outage" ? {
            providerResponseObserved: false,
            correlatedFailureCount: Number(evidence.correlatedFailureCount),
            correlationWindowMs: Number(evidence.correlationWindowMs),
          } : {}),
        },
      },
      at: timestamp,
    });
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (failure) {
    try { db.exec("ROLLBACK"); } catch {}
    throw failure;
  } finally {
    db.close();
  }
}

export function applyChangeImpactToJournal({ dbFile, impact } = {}) {
  if (impact?.schema !== "mkt-videos/change-impact@1") throw new Error("Impacto incompatível.");
  for (const change of impact.changes.filter((entry) => !entry.removed)) appendExecutionEvent({ dbFile, event: { type: "node_invalidated", nodeId: change.nodeId, data: change } });
  return materializeExecutionSnapshot({ dbFile });
}

export function migrateLegacyStateToJournal({ dbFile, plan, legacyState } = {}) {
  initializeExecutionJournal({ dbFile, plan });
  const migrationFingerprint = operationFingerprint({ planFingerprint: plan.fingerprint, stages: legacyState?.stages ?? {} });
  const mapping = {
    assembly: "assembly", audioMix: plan.nodes.some((node) => node.id === "audio-mix") ? "audio-mix" : "master", audioMux: "master", captions: "captions", qa: "qa-master", delivery: "delivery",
  };
  const db = openJournal(dbFile);
  try {
    const existing = db.prepare("SELECT value FROM metadata WHERE key='legacy_migration'").get()?.value;
    if (existing === migrationFingerprint) return materializeWithDb(db, path.resolve(String(dbFile)));
    if (existing && existing !== migrationFingerprint) throw new Error("O journal já contém outra migração legada; aplique change-impact em vez de remigrar.");
    db.exec("BEGIN IMMEDIATE");
    const insert = db.prepare("INSERT OR IGNORE INTO events(event_id,at,type,node_id,attempt_id,data) VALUES (?,?,?,?,?,?)");
    const stableMigrationAt = (legacy, index) => {
      const candidate = legacy?.completedAt
        ?? legacy?.startedAt
        ?? legacy?.updatedAt
        ?? legacyState?.updatedAt
        ?? legacyState?.createdAt;
      const parsed = candidate == null ? NaN : Date.parse(String(candidate));
      return Number.isFinite(parsed)
        ? new Date(parsed).toISOString()
        : new Date(index).toISOString();
    };
    for (const [index, node] of plan.nodes.entries()) {
      let legacy = null;
      if (node.id.startsWith("keyframe:")) legacy = legacyState.stages?.draft;
      else if (node.id.startsWith("video:")) legacy = legacyState.stages?.video;
      else {
        const stageName = Object.entries(mapping).find(([, nodeId]) => nodeId === node.id)?.[0];
        legacy = stageName ? legacyState.stages?.[stageName] : null;
      }
      if (!legacy || legacy.status === "planned") continue;
      const status = legacy.status === "completed"
        ? "completed"
        : legacy.status === "skipped"
          ? "skipped"
          : legacy.status === "blocked"
            ? "blocked"
            : ["running", "ambiguous", "attention_required", "failed"].includes(legacy.status)
              ? "attention_required"
              : "attention_required";
      const attempts = Number.isSafeInteger(Number(legacy.attempts)) && Number(legacy.attempts) >= 0
        ? Number(legacy.attempts)
        : 0;
      const data = {
        status,
        attempts,
        attemptId: legacy.attemptId ?? null,
        providerHandle: legacy.providerHandle ?? legacy.handle ?? null,
        output: legacy.outputFile ?? null,
        receipt: legacy.receiptFile ?? null,
        error: legacy.error ?? null,
        startedAt: legacy.startedAt ?? null,
        completedAt: legacy.completedAt ?? null,
        migratedFrom: legacy.status,
      };
      insert.run(`migration:${migrationFingerprint}:${node.id}`, stableMigrationAt(legacy, index), "legacy_node_migrated", node.id, data.attemptId, JSON.stringify(data));
    }
    db.prepare("INSERT INTO metadata(key,value) VALUES ('legacy_migration',?)").run(migrationFingerprint);
    db.exec("COMMIT");
    return materializeWithDb(db, path.resolve(String(dbFile)));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}
