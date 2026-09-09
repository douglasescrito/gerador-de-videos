import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import path from "node:path";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import {
  KNOWLEDGE_POLICY_HASH,
  KNOWLEDGE_POLICY_ID,
  knownKnowledgePolicy,
} from "./knowledge-policy-registry.mjs";
import {
  assertKnowledgeRecordEnvelope,
  createKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import {
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  assertKnowledgeAssetLinkPayload,
  knowledgeAssetLinkItemId,
  projectKnowledgeAssetLink,
} from "./knowledge-asset-integrity.mjs";
import {
  FEEDBACK_CAPTURED_EVENT_TYPE,
  FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE,
  FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
  FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE,
  FEEDBACK_PROMOTION_DECISION_SCHEMA,
  FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
  TERMINAL_PROMOTION_ACTIONS,
  FEEDBACK_SUBJECT_TYPE,
  assertFeedbackEvent,
  assertFeedbackInterpretationCandidate,
  feedbackEntriesAggregateHash,
  feedbackEventHash,
  feedbackInterpretationCandidateHash,
  feedbackInterpretationEntriesAggregateHash,
  feedbackInterpretationSubjectId,
  assertFeedbackCanonicalizationRequest,
  assertFeedbackPromotionDecision,
  buildFeedbackPromotionQueue,
  feedbackPromotionDecisionHash,
  feedbackPromotionDecisionEntriesAggregateHash,
  feedbackPromotionQueueHash,
  feedbackSubjectId,
  projectFeedbackLedgerEntry,
  projectFeedbackInterpretationLedgerEntry,
  projectFeedbackPromotionDecisionLedgerEntry,
} from "./knowledge-feedback.mjs";
import {
  assertKnowledgeRecordPayloadContract,
  classifyKnowledgeSchemaRole,
  collectKnowledgeRecordPayloadReferences,
  KNOWLEDGE_PREFERENCE_RULE_SCHEMA,
} from "./knowledge-record-contracts.mjs";
import {
  referenceRightsItemId,
  resolveEffectiveRights,
} from "./knowledge-effective-rights.mjs";
import {
  assertKnowledgeRetrievalRequest,
  buildKnowledgeRetrievalShadow,
} from "./knowledge-retrieval.mjs";
import { issueKnowledgeReplayAuthorization } from "./knowledge-schema-replay.mjs";
import {
  PRODUCTION_REQUEST_CREATED_EVENT_TYPE,
  PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE,
  PRODUCTION_REQUEST_SUBJECT_TYPE,
  PRODUCTION_REQUEST_TRANSITIONS,
  assertProductionRequest,
  assertProductionRequestLifecycleEvent,
  createProductionRequestLifecycleEvent,
  productionRequestHash,
  productionRequestLifecycleEventHash,
  projectProductionRequestState,
} from "./production-request.mjs";
import {
  VIDEO_PREFERENCE_EVENT_TYPE,
  VIDEO_PREFERENCE_SUBJECT_TYPE,
  VIDEO_REVIEW_EVENT_TYPE,
  VIDEO_REVIEW_SUBJECT_TYPE,
  assertVideoPreferenceEvent,
  assertVideoReviewEvent,
  createVideoPreferenceEvent,
  createVideoReviewEvent,
  projectVideoPreferenceState,
  projectVideoReviewState,
  videoDecisionEventHash,
  videoDecisionReplayHash,
} from "./video-decisions.mjs";

export const KNOWLEDGE_STORE_SCHEMA = "mkt-videos/knowledge-store@1";
export const SCOPE_GRANT_SCHEMA = "mkt-videos/scope-grant@1";
export const KNOWLEDGE_SCOPE_SCHEMA = "mkt-videos/knowledge-scope@1";
export const KNOWLEDGE_ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
export const KNOWLEDGE_RELEASE_SCHEMA = "mkt-videos/knowledge-release@1";
export const KNOWLEDGE_RELEASE_ACTIVATION_SCHEMA =
  "mkt-videos/knowledge-release-activation@1";
export const KNOWLEDGE_REVIEW_DECISION_SCHEMA =
  "mkt-videos/knowledge-review-decision@1";
export const KNOWLEDGE_EXPORT_V1_SCHEMA = "mkt-videos/knowledge-export@1";
export const KNOWLEDGE_EXPORT_SCHEMA = "mkt-videos/knowledge-export@2";
export const KNOWLEDGE_INTEGRITY_SCHEMA = "mkt-videos/knowledge-integrity@1";
export const KNOWLEDGE_STATUS_SCHEMA = "mkt-videos/knowledge-status@1";
export const KNOWLEDGE_STORE_INTEGRITY_SCHEMA = "mkt-videos/knowledge-store-integrity@1";
export { KNOWLEDGE_POLICY_HASH, KNOWLEDGE_POLICY_ID };
const SUPPORTED_KNOWLEDGE_EXPORT_SCHEMAS = new Set([
  KNOWLEDGE_EXPORT_V1_SCHEMA,
  KNOWLEDGE_EXPORT_SCHEMA,
]);

const DEFAULT_CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    id: "001-knowledge-store",
    file: fileURLToPath(
      new URL("../../knowledge/migrations/001-knowledge-store.sql", import.meta.url),
    ),
  }),
  Object.freeze({
    version: 2,
    id: "002-knowledge-release-activation",
    file: fileURLToPath(
      new URL(
        "../../knowledge/migrations/002-knowledge-release-activation.sql",
        import.meta.url,
      ),
    ),
  }),
  Object.freeze({
    version: 3,
    id: "003-knowledge-review-decisions",
    file: fileURLToPath(
      new URL(
        "../../knowledge/migrations/003-knowledge-review-decisions.sql",
        import.meta.url,
      ),
    ),
  }),
  Object.freeze({
    version: 4,
    id: "004-knowledge-event-scope-grant",
    file: fileURLToPath(
      new URL(
        "../../knowledge/migrations/004-knowledge-event-scope-grant.sql",
        import.meta.url,
      ),
    ),
  }),
]);
const GRANT_PERMISSIONS = new Set([
  "read",
  "write",
  "release",
  "export",
  "integrity",
  "backup",
  "restore",
]);
const SCOPE_KINDS = new Set([
  "global",
  "domain",
  "client",
  "brand",
  "person",
  "project",
  "production",
  "deliverable",
  "campaign",
]);
const RECORD_TYPES = new Set([
  "entity",
  "relation",
  "assertion",
  "evidence",
  "rights",
  "decision",
]);
const RECORD_STATUSES = new Set([
  "active",
  "candidate",
  "superseded",
  "revoked",
  "quarantined",
]);
const CLASSIFICATION_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const SCHEMA_ID_PATTERN = /^mkt-videos\/[A-Za-z0-9._/-]+@([1-9][0-9]*)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ITEM_JSON_BYTES = 1024 * 1024;
const MAX_AGGREGATE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_EXPECTED_HEADS = 100;
const KNOWLEDGE_APPLICATION_ID = 0x4d4b5653;
const LATEST_MIGRATION_VERSION = MIGRATIONS.at(-1).version;
const issuedScopeGrants = new WeakSet();
const issuedAssetLinkWrites = new WeakSet();
const APPEND_ONLY_TRIGGERS = Object.freeze([
  "knowledge_events_no_delete",
  "knowledge_events_no_update",
  "knowledge_items_no_delete",
  "knowledge_items_no_update",
  "knowledge_migrations_no_delete",
  "knowledge_migrations_no_update",
  "knowledge_release_members_no_delete",
  "knowledge_release_members_no_update",
  "knowledge_release_activations_no_delete",
  "knowledge_release_activations_no_update",
  "knowledge_review_decisions_no_delete",
  "knowledge_review_decisions_no_update",
  "knowledge_releases_no_delete",
  "knowledge_releases_no_update",
  "knowledge_scopes_no_delete",
  "knowledge_scopes_no_update",
]);

function isPathWithin(parent, candidate) {
  const relative = path.relative(
    path.resolve(parent).toLocaleLowerCase("en-US"),
    path.resolve(candidate).toLocaleLowerCase("en-US"),
  );
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realPathThroughExistingAncestor(target) {
  const missing = [];
  let cursor = path.resolve(target);
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  const realAncestor = existsSync(cursor) ? realpathSync.native(cursor) : cursor;
  return path.resolve(realAncestor, ...missing);
}

function findWorkspaceRoot(coreRoot) {
  let cursor = realPathThroughExistingAncestor(coreRoot);
  while (true) {
    if (existsSync(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return realPathThroughExistingAncestor(coreRoot);
    cursor = parent;
  }
}

function assertPathHasNoSymbolicLinks(target) {
  let cursor = path.resolve(target);
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(
          "knowledge.sqlite e seus ancestrais não podem ser links simbólicos.",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

export function resolveKnowledgeStorePath({
  dbFile = null,
  localAppData = process.env.LOCALAPPDATA,
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const requested = dbFile == null
    ? localAppData == null || String(localAppData).trim() === ""
      ? null
      : path.join(String(localAppData), "GeradorDeVideos", "Knowledge", "knowledge.sqlite")
    : String(dbFile);
  if (!requested) {
    throw new Error(
      "LOCALAPPDATA não está definido; informe dbFile fora do repositório.",
    );
  }
  const absolute = path.resolve(requested);
  if (path.extname(absolute).toLowerCase() !== ".sqlite") {
    throw new Error("O Knowledge Store exige um arquivo com extensão .sqlite.");
  }
  assertPathHasNoSymbolicLinks(absolute);
  const resolvedTarget = realPathThroughExistingAncestor(absolute);
  const resolvedCore = realPathThroughExistingAncestor(coreRoot);
  const resolvedWorkspace = findWorkspaceRoot(resolvedCore);
  if (isPathWithin(resolvedWorkspace, resolvedTarget)) {
    throw new Error(
      "knowledge.sqlite não pode ficar dentro do workspace; use %LOCALAPPDATA%\\GeradorDeVideos\\Knowledge.",
    );
  }
  if (existsSync(resolvedTarget)) {
    const targetStat = statSync(resolvedTarget);
    if (!targetStat.isFile()) {
      throw new Error("O caminho do Knowledge Store deve apontar para um arquivo.");
    }
    if (targetStat.nlink > 1) {
      throw new Error("knowledge.sqlite não pode ser um hardlink.");
    }
  }
  return resolvedTarget;
}

function requiredText(value, label, maximum = 200) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum) {
    throw new Error(`${label} deve ter entre 1 e ${maximum} caracteres.`);
  }
  return text;
}

function identifier(value, label) {
  const text = requiredText(value, label);
  if (!IDENTIFIER_PATTERN.test(text)) {
    throw new Error(`${label} contém caracteres inválidos.`);
  }
  return text;
}

function identifierList(value, label, { maximum = 100 } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} deve ser um array.`);
  }
  if (value.length > maximum) {
    throw new Error(`${label} aceita no máximo ${maximum} itens.`);
  }
  const normalized = value.map((entry, index) =>
    identifier(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} não aceita IDs duplicados.`);
  }
  return normalized.sort(compareText);
}

function isoTimestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} é inválido.`);
  return date.toISOString();
}

function normalizeJson(value, location = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${location} contém número não finito.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJson(entry, `${location}[${index}]`));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${location} deve conter somente valores JSON.`);
    }
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error(`${location}.${key} é uma chave proibida.`);
      }
      normalized[key] = normalizeJson(value[key], `${location}.${key}`);
    }
    return normalized;
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalJson(
  value,
  { pretty = false, maxBytes = MAX_ITEM_JSON_BYTES } = {},
) {
  const normalized = normalizeJson(value);
  const serialized = JSON.stringify(normalized, null, pretty ? 2 : 0);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(
      `Payload JSON excede o limite de ${maxBytes} bytes.`,
    );
  }
  return pretty ? `${serialized}\n` : serialized;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function contentHash(value, options = {}) {
  return sha256Text(canonicalJson(value, options));
}

function frozenArray(values) {
  return Object.freeze([...values]);
}

function scopeGrantIdentityBody(grant) {
  return {
    schema: grant.schema,
    policyId: grant.policyId,
    policyHash: grant.policyHash,
    rootScopeIds: grant.rootScopeIds,
    permissions: grant.permissions,
    actor: grant.actor,
    purpose: grant.purpose,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  };
}

function assertPersistedScopeGrant(grantValue, rawGrantJson) {
  const grant = assertKnowledgeContract(grantValue, {
    schemaId: SCOPE_GRANT_SCHEMA,
    label: "ScopeGrant persistido no evento",
  });
  if (canonicalJson(grant) !== rawGrantJson) {
    throw new Error("grant_json não está em JSON canônico.");
  }
  const normalizedRoots = grant.rootScopeIds
    .map((root, index) => identifier(root, `grant.rootScopeIds[${index}]`))
    .sort(compareText);
  const normalizedPermissions = grant.permissions
    .map((permission, index) => {
      const normalized = requiredText(
        permission,
        `grant.permissions[${index}]`,
        40,
      );
      if (!GRANT_PERMISSIONS.has(normalized)) {
        throw new Error(
          `Permissão de ScopeGrant persistido inválida: ${normalized}.`,
        );
      }
      return normalized;
    })
    .sort(compareText);
  if (
    canonicalJson(normalizedRoots) !== canonicalJson(grant.rootScopeIds)
    || canonicalJson(normalizedPermissions)
      !== canonicalJson(grant.permissions)
  ) {
    throw new Error(
      "ScopeGrant persistido exige roots e permissões únicos e ordenados.",
    );
  }
  const actor = requiredText(grant.actor, "grant.actor");
  const purpose = requiredText(grant.purpose, "grant.purpose", 500);
  const issuedAt = isoTimestamp(grant.issuedAt, "grant.issuedAt");
  const expiresAt = isoTimestamp(grant.expiresAt, "grant.expiresAt");
  if (
    actor !== grant.actor
    || purpose !== grant.purpose
    || issuedAt !== grant.issuedAt
    || expiresAt !== grant.expiresAt
    || Date.parse(issuedAt) >= Date.parse(expiresAt)
    || !knownKnowledgePolicy(grant.policyId, grant.policyHash)
  ) {
    throw new Error("ScopeGrant persistido possui projeção inválida.");
  }
  const body = scopeGrantIdentityBody(grant);
  const expectedId = `sg_${contentHash(body).slice(0, 32)}`;
  const expectedHash = contentHash({ ...body, id: expectedId });
  if (grant.id !== expectedId || grant.hash !== expectedHash) {
    throw new Error("ScopeGrant persistido possui id/hash divergente.");
  }
  return grant;
}

function eventGrantEvidenceError(type, message) {
  const error = new Error(message);
  error.knowledgeIssueType = type;
  error.knowledgeIssueTypes = [type];
  return error;
}

function eventGrantColumnIssueTypes(event) {
  const issueTypes = new Set();
  if (
    !/^sg_[a-f0-9]{32}$/.test(event.grantId)
    || !SHA256_PATTERN.test(event.grantHash)
  ) {
    issueTypes.add("event-grant-identity");
  }
  if (!knownKnowledgePolicy(event.policyId, event.policyHash)) {
    issueTypes.add("event-policy");
  }
  if (
    typeof event.actor !== "string"
    || event.actor.trim() !== event.actor
    || event.actor.length < 1
    || event.actor.length > 200
  ) {
    issueTypes.add("event-actor");
  }
  if (!["write", "release"].includes(event.grantPermission)) {
    issueTypes.add("event-grant-permission");
  }
  try {
    const at = isoTimestamp(event.at, "event.at");
    const issuedAt = isoTimestamp(
      event.grantIssuedAt,
      "event.grantIssuedAt",
    );
    const expiresAt = isoTimestamp(
      event.grantExpiresAt,
      "event.grantExpiresAt",
    );
    if (
      at !== event.at
      || issuedAt !== event.grantIssuedAt
      || expiresAt !== event.grantExpiresAt
      || Date.parse(issuedAt) >= Date.parse(expiresAt)
      || Date.parse(at) < Date.parse(issuedAt)
      || Date.parse(at) >= Date.parse(expiresAt)
    ) {
      issueTypes.add("event-grant-window");
    }
  } catch {
    issueTypes.add("event-grant-window");
  }
  return [...issueTypes];
}

function assertEventGrantEvidence(event, rawGrantJson) {
  const columnIssueTypes = eventGrantColumnIssueTypes(event);
  if (columnIssueTypes.length > 0) {
    const error = eventGrantEvidenceError(
      columnIssueTypes[0],
      "colunas de evidência do ScopeGrant são inválidas",
    );
    error.knowledgeIssueTypes = columnIssueTypes;
    throw error;
  }
  if (rawGrantJson == null) {
    return Object.freeze({ kind: "legacy-columns", grant: null });
  }
  let persistedGrant;
  try {
    persistedGrant = assertPersistedScopeGrant(
      JSON.parse(rawGrantJson),
      rawGrantJson,
    );
  } catch (error) {
    throw eventGrantEvidenceError(
      "event-grant-attestation",
      String(error?.message ?? "grant_json inválido"),
    );
  }
  if (
    persistedGrant.id !== event.grantId
    || persistedGrant.hash !== event.grantHash
  ) {
    throw eventGrantEvidenceError(
      "event-grant-identity",
      "id/hash do evento divergem do ScopeGrant persistido",
    );
  }
  if (
    persistedGrant.policyId !== event.policyId
    || persistedGrant.policyHash !== event.policyHash
  ) {
    throw eventGrantEvidenceError(
      "event-policy",
      "política do evento diverge do ScopeGrant persistido",
    );
  }
  if (persistedGrant.actor !== event.actor) {
    throw eventGrantEvidenceError(
      "event-actor",
      "actor do evento diverge do ScopeGrant persistido",
    );
  }
  if (
    persistedGrant.issuedAt !== event.grantIssuedAt
    || persistedGrant.expiresAt !== event.grantExpiresAt
  ) {
    throw eventGrantEvidenceError(
      "event-grant-window",
      "janela do evento diverge do ScopeGrant persistido",
    );
  }
  if (!persistedGrant.rootScopeIds.includes(event.rootScopeId)) {
    throw eventGrantEvidenceError(
      "event-grant-root",
      "ScopeGrant persistido não autoriza o root do evento",
    );
  }
  if (
    persistedGrant.rootScopeIds.length !== 1
    || persistedGrant.rootScopeIds[0] !== event.rootScopeId
  ) {
    throw eventGrantEvidenceError(
      "event-grant-root",
      "ScopeGrant persistido deve ser dedicado ao root do evento",
    );
  }
  if (!persistedGrant.permissions.includes(event.grantPermission)) {
    throw eventGrantEvidenceError(
      "event-grant-permission",
      "ScopeGrant persistido não autoriza a permissão do evento",
    );
  }
  return Object.freeze({
    kind: "canonical-scope-grant",
    grant: persistedGrant,
  });
}

/**
 * @param {{
 *   rootScopeIds: string[],
 *   permissions: string[],
 *   actor: string,
 *   purpose: string,
 *   issuedAt?: Date|string,
 *   expiresAt?: Date|string|null
 * }} input
 */
export function createScopeGrant({
  rootScopeIds,
  permissions,
  actor,
  purpose,
  issuedAt = new Date(),
  expiresAt = null,
}) {
  if (!Array.isArray(rootScopeIds) || rootScopeIds.length === 0) {
    throw new Error("ScopeGrant exige ao menos um rootScopeId.");
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new Error("ScopeGrant exige ao menos uma permissão.");
  }
  const normalizedRoots = [...new Set(
    rootScopeIds.map((root, index) => identifier(root, `rootScopeIds[${index}]`)),
  )].sort();
  const normalizedPermissions = [...new Set(permissions.map((permission) => {
    const normalized = requiredText(permission, "permission", 40);
    if (!GRANT_PERMISSIONS.has(normalized)) {
      throw new Error(`Permissão de ScopeGrant inválida: ${normalized}.`);
    }
    return normalized;
  }))].sort();
  const normalizedIssuedAt = isoTimestamp(issuedAt, "issuedAt");
  const normalizedExpiresAt = isoTimestamp(
    expiresAt ?? new Date(Date.parse(normalizedIssuedAt) + 60 * 60 * 1000),
    "expiresAt",
  );
  if (Date.parse(normalizedExpiresAt) <= Date.parse(normalizedIssuedAt)) {
    throw new Error("expiresAt deve ser posterior a issuedAt.");
  }
  const body = {
    schema: SCOPE_GRANT_SCHEMA,
    policyId: KNOWLEDGE_POLICY_ID,
    policyHash: KNOWLEDGE_POLICY_HASH,
    rootScopeIds: normalizedRoots,
    permissions: normalizedPermissions,
    actor: requiredText(actor, "actor"),
    purpose: requiredText(purpose, "purpose", 500),
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
  };
  const id = `sg_${contentHash(body).slice(0, 32)}`;
  const grant = Object.freeze({
    ...body,
    id,
    rootScopeIds: frozenArray(body.rootScopeIds),
    permissions: frozenArray(body.permissions),
    hash: contentHash({ ...body, id }),
  });
  assertKnowledgeContract(grant, {
    schemaId: SCOPE_GRANT_SCHEMA,
    label: "ScopeGrant",
  });
  issuedScopeGrants.add(grant);
  return grant;
}

function assertScopeGrant(grant, {
  rootScopeId,
  permission,
  now,
} = {}) {
  if (!grant || !issuedScopeGrants.has(grant)) {
    throw new Error("ScopeGrant inválido ou não emitido por este runtime.");
  }
  const expectedHash = contentHash({
    schema: grant.schema,
    policyId: grant.policyId,
    policyHash: grant.policyHash,
    rootScopeIds: grant.rootScopeIds,
    permissions: grant.permissions,
    actor: grant.actor,
    purpose: grant.purpose,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    id: grant.id,
  });
  if (
    grant.schema !== SCOPE_GRANT_SCHEMA
    || grant.policyId !== KNOWLEDGE_POLICY_ID
    || grant.policyHash !== KNOWLEDGE_POLICY_HASH
    || grant.hash !== expectedHash
  ) {
    throw new Error("ScopeGrant adulterado.");
  }
  if (Date.parse(grant.issuedAt) > now.getTime()) {
    throw new Error("ScopeGrant ainda não é válido.");
  }
  if (Date.parse(grant.expiresAt) <= now.getTime()) {
    throw new Error("ScopeGrant expirado.");
  }
  if (!grant.permissions.includes(permission)) {
    throw new Error(`ScopeGrant não autoriza ${permission}.`);
  }
  if (!grant.rootScopeIds.includes(rootScopeId)) {
    throw new Error(`ScopeGrant não autoriza o root scope ${rootScopeId}.`);
  }
  return grant;
}

function configureWriteDatabase(db, { ensureWal = false } = {}) {
  db.exec(`
    PRAGMA busy_timeout=30000;
    PRAGMA foreign_keys=ON;
    PRAGMA synchronous=FULL;
    PRAGMA trusted_schema=OFF;
  `);
  // journal_mode is a persistent database setting. Re-negotiating WAL on
  // every writer open makes concurrent processes race before busy_timeout
  // can help (notably during the append-only feedback worker test). Establish
  // it once while initializing the store; existing writers only reuse it.
  if (ensureWal) db.exec("PRAGMA journal_mode=WAL");
  db.enableDefensive(true);
}

function openDatabaseForInitialization(dbFile) {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  return new DatabaseSync(dbFile);
}

function openExistingWriteDatabase(dbFile) {
  if (!existsSync(dbFile)) {
    throw new Error(
      "Knowledge Store não inicializado; execute knowledge --action init.",
    );
  }
  const db = new DatabaseSync(dbFile);
  try {
    db.enableDefensive(true);
    assertLatestMigrationState(db);
    configureWriteDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function openReadOnlyDatabase(dbFile) {
  if (!existsSync(dbFile)) {
    throw new Error(`Knowledge Store não inicializado: ${dbFile}.`);
  }
  const activeSidecars = [`${dbFile}-wal`, `${dbFile}-shm`]
    .filter((candidate) => existsSync(candidate));
  if (activeSidecars.length > 0) {
    throw new Error(
      "Knowledge Store possui WAL/SHM ativo; leitura immutable bloqueada "
      + "até a operação concorrente encerrar.",
    );
  }
  const immutableUrl = pathToFileURL(dbFile);
  immutableUrl.searchParams.set("immutable", "1");
  immutableUrl.searchParams.set("mode", "ro");
  const db = new DatabaseSync(immutableUrl, { readOnly: true });
  db.enableDefensive(true);
  db.exec(`
    PRAGMA query_only=ON;
    PRAGMA foreign_keys=ON;
    PRAGMA trusted_schema=OFF;
  `);
  return db;
}

function authorizedActor(value, grant, label) {
  const actor = requiredText(value ?? grant.actor, label);
  if (actor !== grant.actor) {
    throw new Error(`${label} deve corresponder ao actor do ScopeGrant.`);
  }
  return actor;
}

function assertTimestampWithinGrant(value, grant, label) {
  const timestamp = isoTimestamp(value, label);
  const milliseconds = Date.parse(timestamp);
  if (
    milliseconds < Date.parse(grant.issuedAt)
    || milliseconds >= Date.parse(grant.expiresAt)
  ) {
    throw new Error(
      `${label} deve ficar dentro da janela issuedAt..expiresAt do ScopeGrant.`,
    );
  }
  return timestamp;
}

function migrationSql(migration) {
  return readFileSync(migration.file, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

function bootstrapMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_migrations (
      version INTEGER PRIMARY KEY,
      migration_id TEXT NOT NULL UNIQUE,
      migration_hash TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function pragmaInteger(db, pragma) {
  return Number(Object.values(db.prepare(`PRAGMA ${pragma}`).get())[0] ?? 0);
}

function migrationRows(db) {
  if (!sqliteTableExists(db, "knowledge_migrations")) return [];
  return db.prepare(`
    SELECT version,migration_id,migration_hash,applied_at
    FROM knowledge_migrations
    ORDER BY version
  `).all();
}

function inspectMigrationState(db) {
  const rows = migrationRows(db);
  const issues = [];
  const applicationId = pragmaInteger(db, "application_id");
  const userVersion = pragmaInteger(db, "user_version");
  if (applicationId !== KNOWLEDGE_APPLICATION_ID) {
    issues.push({ type: "application-id" });
  }
  if (!sqliteTableExists(db, "knowledge_migrations")) {
    issues.push({ type: "migration-table" });
  }
  const expectedByVersion = new Map(
    MIGRATIONS.map((migration) => [migration.version, migration]),
  );
  for (const row of rows) {
    const expected = expectedByVersion.get(row.version);
    if (!expected) {
      issues.push({ type: "migration-unknown", version: row.version });
      continue;
    }
    const expectedHash = sha256Text(migrationSql(expected));
    if (
      row.migration_id !== expected.id
      || row.migration_hash !== expectedHash
    ) {
      issues.push({ type: "migration-divergent", version: row.version });
    }
  }
  for (const migration of MIGRATIONS) {
    if (!rows.some((row) => row.version === migration.version)) {
      issues.push({ type: "migration-missing", version: migration.version });
    }
  }
  const versions = rows.map((row) => Number(row.version));
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] !== index + 1) {
      issues.push({ type: "migration-gap" });
      break;
    }
  }
  if (rows.length !== MIGRATIONS.length) {
    issues.push({ type: "migration-count" });
  }
  if (userVersion !== LATEST_MIGRATION_VERSION) {
    issues.push({
      type: "user-version",
      expected: LATEST_MIGRATION_VERSION,
      actual: userVersion,
    });
  }
  return {
    applicationId,
    userVersion,
    rows,
    issues,
    ok: issues.length === 0,
  };
}

function assertLatestMigrationState(db) {
  const state = inspectMigrationState(db);
  if (!state.ok) {
    throw new Error(
      "Knowledge Store não inicializado ou com histórico de migrations divergente.",
    );
  }
  return state;
}

function databaseIsEmpty(db) {
  const rows = db.prepare(`
    SELECT 1
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    LIMIT 1
  `).all();
  return rows.length === 0
    && pragmaInteger(db, "application_id") === 0
    && pragmaInteger(db, "user_version") === 0;
}

function assertRecognizedMigrationPrefix(db) {
  if (databaseIsEmpty(db)) return { empty: true, rows: [] };
  if (pragmaInteger(db, "application_id") !== KNOWLEDGE_APPLICATION_ID) {
    throw new Error(
      "Arquivo SQLite existente não pertence ao Knowledge Store.",
    );
  }
  if (!sqliteTableExists(db, "knowledge_migrations")) {
    throw new Error("Knowledge Store existente não possui marker de migrations.");
  }
  const rows = migrationRows(db);
  if (rows.length > MIGRATIONS.length) {
    throw new Error("Knowledge Store possui migration desconhecida.");
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const expected = MIGRATIONS[index];
    if (
      !expected
      || row.version !== index + 1
      || row.version !== expected.version
      || row.migration_id !== expected.id
      || row.migration_hash !== sha256Text(migrationSql(expected))
    ) {
      throw new Error("Knowledge Store possui gap ou migration divergente.");
    }
  }
  if (pragmaInteger(db, "user_version") !== rows.length) {
    throw new Error("PRAGMA user_version diverge do histórico de migrations.");
  }
  return { empty: false, rows };
}

function applyMigrationsExplicitly(db, at) {
  const prefix = assertRecognizedMigrationPrefix(db);
  if (prefix.rows.length === MIGRATIONS.length) {
    assertLatestMigrationState(db);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (prefix.empty) {
      db.exec(`PRAGMA application_id=${KNOWLEDGE_APPLICATION_ID}`);
      bootstrapMigrations(db);
    }
    for (const migration of MIGRATIONS.slice(prefix.rows.length)) {
      const sql = migrationSql(migration);
      const migrationHash = sha256Text(sql);
      db.exec(sql);
      db.prepare(`
        INSERT INTO knowledge_migrations(
          version,migration_id,migration_hash,applied_at
        ) VALUES (?,?,?,?)
      `).run(migration.version, migration.id, migrationHash, at);
      db.exec(`PRAGMA user_version=${migration.version}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  assertLatestMigrationState(db);
}

function withTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function withReadSnapshot(db, work) {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function scopeFromRow(row) {
  if (!row) return null;
  return assertKnowledgeContract({
    ...JSON.parse(row.body_json),
    contentHash: row.content_hash,
  }, {
    schemaId: KNOWLEDGE_SCOPE_SCHEMA,
    label: "Knowledge scope persistido",
  });
}

function itemFromRow(row) {
  if (!row) return null;
  const body = JSON.parse(row.body_json);
  const governance = assertKnowledgeRecordEnvelope(body.governance, {
    expectedActor: row.created_by,
  });
  const projectedGovernance = assertKnowledgeRecordEnvelope(
    JSON.parse(row.governance_json),
    { expectedActor: row.created_by },
  );
  if (
    sha256Text(canonicalJson(body)) !== row.content_hash
    || canonicalJson(governance) !== canonicalJson(projectedGovernance)
    || governance.hash !== row.governance_hash
    || governance.classification !== row.classification
    || governance.owner.type !== row.owner_type
    || governance.owner.id !== row.owner_id
    || governance.modality !== row.modality
    || governance.createdAt !== row.created_at
    || governance.createdBy !== row.created_by
  ) {
    throw new Error("Knowledge item persistido possui governança adulterada.");
  }
  const item = assertKnowledgeContract({
    ...body,
    contentHash: row.content_hash,
  }, {
    schemaId: KNOWLEDGE_ITEM_SCHEMA,
    label: "Knowledge item persistido",
  });
  assertRegisteredKnowledgePayloadIfKnown(item);
  return item;
}

function releaseFromRow(row) {
  if (!row) return null;
  return assertKnowledgeContract({
    ...JSON.parse(row.manifest_json),
    hash: row.release_hash,
  }, {
    schemaId: KNOWLEDGE_RELEASE_SCHEMA,
    label: "Knowledge release persistida",
  });
}

function releaseActivationFromRow(row) {
  if (!row) return null;
  return assertKnowledgeContract({
    ...JSON.parse(row.body_json),
    hash: row.activation_hash,
  }, {
    schemaId: KNOWLEDGE_RELEASE_ACTIVATION_SCHEMA,
    label: "Knowledge release activation persistida",
  });
}

function reviewDecisionFromRow(row) {
  if (!row) return null;
  return assertKnowledgeContract({
    ...JSON.parse(row.body_json),
    hash: row.decision_hash,
  }, {
    schemaId: KNOWLEDGE_REVIEW_DECISION_SCHEMA,
    label: "Knowledge review decision persistida",
  });
}

function reviewDecisionIdentity(value) {
  return {
    schema: KNOWLEDGE_REVIEW_DECISION_SCHEMA,
    rootScopeId: value.rootScopeId,
    scopeId: value.scopeId,
    sequence: value.sequence,
    itemId: value.itemId,
    action: value.action,
    sourceRevision: value.sourceRevision,
    sourceContentHash: value.sourceContentHash,
    sourceStatus: value.sourceStatus,
    resultRevision: value.resultRevision,
    resultStatus: value.resultStatus,
    reason: value.reason,
    evidenceIds: value.evidenceIds,
    reviewedAt: value.reviewedAt,
    reviewedBy: value.reviewedBy,
    policyId: value.policyId,
    policyHash: value.policyHash,
  };
}

function reviewDecisionId(value) {
  return `krd_${contentHash(reviewDecisionIdentity(value)).slice(0, 32)}`;
}

function assertItemLocallyEligible(item, at, label) {
  if (item.status !== "active") {
    throw new Error(`${label} não está active.`);
  }
  if (item.governance.rights.localAnalysis !== "allowed") {
    throw new Error(`${label} não autoriza localAnalysis.`);
  }
  const expiresAt = item.governance.retention.expiresAt;
  if (expiresAt != null && Date.parse(expiresAt) <= Date.parse(at)) {
    throw new Error(`${label} possui retenção expirada.`);
  }
}

function releaseEligibilitySnapshot(db, release, at) {
  const resolved = release.members.map((member, ordinal) => {
    const releaseRow = db.prepare(`
      SELECT *
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=? AND revision=?
    `).get(release.rootScopeId, member.id, member.revision);
    const currentRow = db.prepare(`
      SELECT *
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=?
      ORDER BY revision DESC
      LIMIT 1
    `).get(release.rootScopeId, member.id);
    if (!releaseRow || !currentRow) {
      throw new Error(
        `Membro ${ordinal} não resolve revisão da release e head atual.`,
      );
    }
    const releaseItem = itemFromRow(releaseRow);
    const currentItem = itemFromRow(currentRow);
    assertPersistableKnowledgePayload(releaseItem, `Membro ${ordinal}`);
    assertPersistableKnowledgePayload(currentItem, `Head atual ${ordinal}`);
    assertItemLocallyEligible(releaseItem, at, `Membro ${ordinal}`);
    assertItemLocallyEligible(currentItem, at, `Head atual ${ordinal}`);
    return { ordinal, releaseItem, currentItem };
  });
  assertReleaseReferenceClosure(
    resolved.map(({ releaseItem }) => releaseItem),
    "Release elegível",
  );
  const members = resolved.map(({ ordinal, releaseItem, currentItem }) => {
    return {
      ordinal,
      memberContentHash: releaseItem.contentHash,
      currentContentHash: currentItem.contentHash,
      currentGovernanceHash: currentItem.governance.hash,
      currentRevision: currentItem.revision,
    };
  });
  return {
    memberCount: members.length,
    hash: contentHash({
      releaseHash: release.hash,
      checkedAt: at,
      members,
    }, {
      maxBytes: MAX_AGGREGATE_JSON_BYTES,
    }),
  };
}

function releaseIsAncestor(db, rootScopeId, ancestorReleaseId, releaseId) {
  let cursor = releaseId;
  const visited = new Set();
  while (cursor != null) {
    if (visited.has(cursor)) {
      throw new Error("Ciclo detectado na linhagem de releases.");
    }
    visited.add(cursor);
    if (cursor === ancestorReleaseId) return true;
    cursor = db.prepare(`
      SELECT previous_release_id
      FROM knowledge_releases
      WHERE root_scope_id=? AND release_id=?
    `).get(rootScopeId, cursor)?.previous_release_id ?? null;
  }
  return false;
}

function eventFromRow(row) {
  return {
    sequence: row.sequence,
    id: row.event_id,
    rootScopeId: row.root_scope_id,
    scopeId: row.scope_id,
    type: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectRevision: row.subject_revision,
    at: row.at,
    grantId: row.grant_id,
    grantHash: row.grant_hash,
    policyId: row.policy_id,
    policyHash: row.policy_hash,
    actor: row.actor,
    grantPermission: row.grant_permission,
    grantIssuedAt: row.grant_issued_at,
    grantExpiresAt: row.grant_expires_at,
    payload: JSON.parse(row.payload_json),
    payloadHash: row.payload_hash,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
  };
}

function eventHashBody(event, grantJson = null) {
  const body = {
    id: event.id,
    rootScopeId: event.rootScopeId,
    scopeId: event.scopeId,
    type: event.type,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    subjectRevision: event.subjectRevision,
    at: event.at,
    grantId: event.grantId,
    grantHash: event.grantHash,
    policyId: event.policyId,
    policyHash: event.policyHash,
    actor: event.actor,
    grantPermission: event.grantPermission,
    grantIssuedAt: event.grantIssuedAt,
    grantExpiresAt: event.grantExpiresAt,
    payloadHash: event.payloadHash,
    previousEventHash: event.previousEventHash,
  };
  if (grantJson != null) {
    body.grantBodyHash = sha256Text(grantJson);
  }
  return body;
}

function appendEvent(db, {
  rootScopeId,
  scopeId,
  type,
  subjectType,
  subjectId,
  subjectRevision = null,
  grant,
  grantPermission,
  payload,
  at,
}) {
  const normalizedAt = assertTimestampWithinGrant(at, grant, "event.at");
  const normalizedPermission = requiredText(
    grantPermission,
    "event grant permission",
    40,
  );
  assertScopeGrant(grant, {
    rootScopeId,
    permission: normalizedPermission,
    now: new Date(normalizedAt),
  });
  if (
    grant.rootScopeIds.length !== 1
    || grant.rootScopeIds[0] !== rootScopeId
  ) {
    throw new Error(
      "Eventos persistidos exigem ScopeGrant dedicado a um único root.",
    );
  }
  const normalizedPayload = normalizeJson(payload);
  const payloadJson = canonicalJson(normalizedPayload);
  const payloadHash = sha256Text(payloadJson);
  const grantJson = canonicalJson(grant);
  assertPersistedScopeGrant(JSON.parse(grantJson), grantJson);
  const previousEventHash = db.prepare(`
    SELECT event_hash
    FROM knowledge_events
    WHERE root_scope_id=?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(rootScopeId)?.event_hash ?? null;
  const event = {
    id: `ke_${randomUUID()}`,
    rootScopeId,
    scopeId,
    type: requiredText(type, "event type", 120),
    subjectType: requiredText(subjectType, "subject type", 80),
    subjectId: identifier(subjectId, "subject id"),
    subjectRevision: subjectRevision == null ? null : Number(subjectRevision),
    at: normalizedAt,
    grantId: identifier(grant.id, "grant id"),
    grantHash: grant.hash,
    policyId: requiredText(grant.policyId, "policy id", 120),
    policyHash: grant.policyHash,
    actor: requiredText(grant.actor, "grant actor"),
    grantPermission: normalizedPermission,
    grantIssuedAt: grant.issuedAt,
    grantExpiresAt: grant.expiresAt,
    payloadHash,
    previousEventHash,
  };
  if (
    !SHA256_PATTERN.test(event.grantHash)
    || !SHA256_PATTERN.test(event.policyHash)
  ) {
    throw new Error("ScopeGrant possui hash inválido.");
  }
  if (
    event.subjectRevision != null
    && (!Number.isInteger(event.subjectRevision) || event.subjectRevision < 1)
  ) {
    throw new Error("subjectRevision deve ser um inteiro positivo.");
  }
  const eventHash = contentHash(eventHashBody(event, grantJson));
  db.prepare(`
    INSERT INTO knowledge_events(
      event_id,root_scope_id,scope_id,event_type,subject_type,subject_id,
      subject_revision,at,grant_id,grant_hash,policy_id,policy_hash,actor,
      grant_permission,grant_issued_at,grant_expires_at,payload_json,payload_hash,
      previous_event_hash,event_hash,grant_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    event.id,
    rootScopeId,
    scopeId,
    event.type,
    event.subjectType,
    event.subjectId,
    event.subjectRevision,
    event.at,
    event.grantId,
    event.grantHash,
    event.policyId,
    event.policyHash,
    event.actor,
    event.grantPermission,
    event.grantIssuedAt,
    event.grantExpiresAt,
    payloadJson,
    payloadHash,
    previousEventHash,
    eventHash,
    grantJson,
  );
  return { ...event, payload: normalizedPayload, eventHash };
}

function readVerifiedRootEventLedger(db, rootScopeId) {
  const normalizedRoot = identifier(rootScopeId, "rootScopeId");
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_events
    WHERE root_scope_id=?
    ORDER BY sequence
  `).all(normalizedRoot);
  const events = [];
  let previousEventHash = null;
  for (const row of rows) {
    const event = eventFromRow(row);
    const fail = (reason) => {
      throw new Error(
        `Ledger de knowledge_events inválido em ${event.id}: ${reason}.`,
      );
    };
    if (
      sha256Text(canonicalJson(event.payload)) !== event.payloadHash
    ) {
      fail("payload hash divergente");
    }
    if (event.previousEventHash !== previousEventHash) {
      fail("elo previousEventHash divergente");
    }
    if (
      contentHash(eventHashBody(event, row.grant_json)) !== event.eventHash
    ) {
      fail("event hash divergente");
    }
    try {
      assertEventGrantEvidence(event, row.grant_json);
    } catch (error) {
      fail(String(error?.message ?? "evidência do ScopeGrant inválida"));
    }
    events.push(event);
    previousEventHash = event.eventHash;
  }
  return events;
}

function assertRootScopeExists(db, rootScopeId) {
  const root = db.prepare(`
    SELECT scope_id,parent_scope_id
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(rootScopeId, rootScopeId);
  if (!root || root.parent_scope_id != null) {
    throw new Error(`Root scope inexistente: ${rootScopeId}.`);
  }
}

function scopeIsWithin(db, rootScopeId, scopeId, ancestorScopeId) {
  let cursor = scopeId;
  const visited = new Set();
  while (cursor != null) {
    if (visited.has(cursor)) {
      throw new Error("Ciclo detectado na hierarquia de scopes.");
    }
    visited.add(cursor);
    if (cursor === ancestorScopeId) return true;
    const row = db.prepare(`
      SELECT parent_scope_id
      FROM knowledge_scopes
      WHERE root_scope_id=? AND scope_id=?
    `).get(rootScopeId, cursor);
    if (!row) return false;
    cursor = row.parent_scope_id;
  }
  return false;
}

function feedbackScopeKind(mode) {
  return {
    piece: "production",
    project: "project",
    client: "client",
    personal: "person",
  }[mode] ?? null;
}

function assertFeedbackLinkReference(
  db,
  feedback,
  descriptor,
  {
    label,
    expectedMediaType = null,
    requireCurrent = true,
    evaluatedAt = feedback.capturedAt,
  } = {},
) {
  const row = db.prepare(`
    SELECT *
    FROM knowledge_items
    WHERE root_scope_id=? AND item_id=? AND revision=?
  `).get(
    feedback.rootScopeId,
    descriptor.itemId,
    descriptor.revision,
  );
  const item = itemFromRow(row);
  if (
    item == null
    || item.recordType !== "relation"
    || item.schemaId !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
    || item.schemaVersion !== 1
  ) {
    throw new Error(`${label} não referencia um asset link governado.`);
  }
  const payload = assertKnowledgeAssetLinkPayload(item.payload);
  if (item.contentHash !== descriptor.contentHash) {
    throw new Error(`${label}.contentHash diverge do asset link.`);
  }
  if (
    !scopeIsWithin(
      db,
      feedback.rootScopeId,
      item.scopeId,
      feedback.target.productionScopeId,
    )
  ) {
    throw new Error(`${label} não pertence à produção alvo.`);
  }
  if (expectedMediaType != null && payload.mediaType !== expectedMediaType) {
    throw new Error(`${label} deve apontar para ${expectedMediaType}.`);
  }
  if (requireCurrent) {
    const head = db.prepare(`
      SELECT revision,content_hash
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=?
      ORDER BY revision DESC
      LIMIT 1
    `).get(feedback.rootScopeId, descriptor.itemId);
    if (
      head?.revision !== descriptor.revision
      || head?.content_hash !== descriptor.contentHash
    ) {
      throw new Error(`${label} não referencia o head atual do asset link.`);
    }
    const projected = projectKnowledgeAssetLink(item, {
      at: evaluatedAt,
    });
    if (
      projected.rightsStatus !== "allowed"
      || projected.quarantineStatus !== "clear"
    ) {
      throw new Error(`${label} está revogado, expirado ou em quarentena.`);
    }
  }
  return item;
}

function assertFeedbackTargetIsolation(
  db,
  feedbackValue,
  {
    requireCurrent = true,
    evaluatedAt = feedbackValue?.capturedAt,
  } = {},
) {
  const feedback = assertFeedbackEvent(feedbackValue);
  assertRootScopeExists(db, feedback.rootScopeId);
  if (
    feedback.scopeId !== feedback.target.productionScopeId
  ) {
    throw new Error(
      "feedback.scopeId deve ser a productionScopeId exata do target.",
    );
  }
  const production = db.prepare(`
    SELECT kind,status
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(feedback.rootScopeId, feedback.target.productionScopeId);
  if (
    !production
    || production.kind !== "production"
    || (requireCurrent && production.status !== "active")
  ) {
    throw new Error(
      "Target de feedback exige production scope válido e ativo na captura.",
    );
  }
  const intended = db.prepare(`
    SELECT kind,status
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(feedback.rootScopeId, feedback.intendedScope.scopeId);
  const expectedKind = feedbackScopeKind(feedback.intendedScope.mode);
  if (!intended || (requireCurrent && intended.status !== "active")) {
    throw new Error(
      "Escopo pretendido deve existir no mesmo root e estar ativo na captura.",
    );
  }
  if (
    feedback.intendedScope.mode === "global-proposal"
    && feedback.intendedScope.scopeId !== feedback.rootScopeId
  ) {
    throw new Error(
      "Proposta global deve permanecer ancorada no root atual até revisão futura.",
    );
  }
  if (
    feedback.intendedScope.mode !== "global-proposal"
    && intended.kind !== expectedKind
  ) {
    throw new Error(
      "Escopo pretendido não corresponde ao modo declarado no mesmo root.",
    );
  }
  if (
    !["personal", "global-proposal"].includes(feedback.intendedScope.mode)
    &&
    !scopeIsWithin(
      db,
      feedback.rootScopeId,
      feedback.target.productionScopeId,
      feedback.intendedScope.scopeId,
    )
  ) {
    throw new Error(
      "Escopo pretendido deve ser a peça ou um ancestral da produção no mesmo root.",
    );
  }
  assertFeedbackLinkReference(
    db,
    feedback,
    feedback.target.artifact,
    {
      label: "feedback.target.artifact",
      requireCurrent,
      evaluatedAt,
    },
  );
  assertFeedbackLinkReference(
    db,
    feedback,
    feedback.target.receipt,
    {
      label: "feedback.target.receipt",
      expectedMediaType: "application/json",
      requireCurrent,
      evaluatedAt,
    },
  );
  if (feedback.comparison != null) {
    assertFeedbackLinkReference(
      db,
      feedback,
      feedback.comparison.alternative.artifact,
      {
        label: "feedback.comparison.alternative.artifact",
        requireCurrent,
        evaluatedAt,
      },
    );
    assertFeedbackLinkReference(
      db,
      feedback,
      feedback.comparison.alternative.receipt,
      {
        label: "feedback.comparison.alternative.receipt",
        expectedMediaType: "application/json",
        requireCurrent,
        evaluatedAt,
      },
    );
  }
  return feedback;
}

function feedbackSourceBinding(entry) {
  return {
    eventId: entry.eventId,
    sequence: entry.sequence,
    subjectId: entry.subjectId,
    feedbackHash: entry.feedbackHash,
    originalTextSha256: entry.originalTextSha256,
    eventHash: entry.eventHash,
  };
}

function assertFeedbackInterpretationIsolation(
  db,
  candidateValue,
  {
    verifiedEvents,
    requireSuggestedScopeActive = true,
    candidateEventSequence = null,
  } = {},
) {
  const candidate = assertFeedbackInterpretationCandidate(candidateValue);
  const events = verifiedEvents ?? readVerifiedRootEventLedger(
    db,
    candidate.rootScopeId,
  );
  const sourceEvent = events.find(
    (event) => event.id === candidate.sourceFeedback.eventId,
  );
  if (
    sourceEvent == null
    || sourceEvent.type !== FEEDBACK_CAPTURED_EVENT_TYPE
    || sourceEvent.subjectType !== FEEDBACK_SUBJECT_TYPE
  ) {
    throw new Error(
      "Candidato exige source feedback.captured existente no mesmo root.",
    );
  }
  const sourceEntry = projectFeedbackLedgerEntry(sourceEvent);
  assertFeedbackTargetIsolation(db, sourceEntry.feedback, {
    requireCurrent: false,
  });
  if (
    canonicalJson(candidate.sourceFeedback)
      !== canonicalJson(feedbackSourceBinding(sourceEntry))
  ) {
    throw new Error(
      "Candidato diverge da identidade e dos hashes do feedback-fonte.",
    );
  }
  if (
    candidate.rootScopeId !== sourceEntry.feedback.rootScopeId
    || candidate.sourceScopeId !== sourceEntry.feedback.scopeId
  ) {
    throw new Error(
      "Candidato e feedback-fonte devem permanecer no mesmo root e production scope.",
    );
  }
  if (
    canonicalJson(candidate.suggestedScope)
      !== canonicalJson(sourceEntry.feedback.intendedScope)
  ) {
    throw new Error(
      "Nesta fase, suggestedScope deve herdar exatamente intendedScope do feedback.",
    );
  }
  const feedbackDimensions = new Set(sourceEntry.feedback.dimensions);
  if (
    candidate.interpretation.dimensions.some(
      (dimension) => !feedbackDimensions.has(dimension),
    )
  ) {
    throw new Error(
      "Dimensões interpretadas devem ser subconjunto das dimensões do feedback.",
    );
  }
  if (
    Date.parse(candidate.interpretation.interpretedAt)
      < Date.parse(sourceEntry.feedback.capturedAt)
  ) {
    throw new Error(
      "interpretedAt não pode anteceder capturedAt do feedback-fonte.",
    );
  }
  if (
    candidateEventSequence != null
    && sourceEntry.sequence >= candidateEventSequence
  ) {
    throw new Error(
      "Feedback-fonte deve anteceder o candidato na sequência do ledger.",
    );
  }
  const suggestedScope = db.prepare(`
    SELECT kind,status
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(candidate.rootScopeId, candidate.suggestedScope.scopeId);
  if (
    !suggestedScope
    || (requireSuggestedScopeActive && suggestedScope.status !== "active")
  ) {
    throw new Error(
      "suggestedScope deve existir no mesmo root e estar ativo na criação.",
    );
  }
  if (candidate.governance.owner.type !== suggestedScope.kind) {
    throw new Error(
      "Owner do candidato deve corresponder ao kind do suggestedScope governado.",
    );
  }
  return {
    candidate,
    sourceEntry,
    sourceEvent,
  };
}

function assertFeedbackPromotionDecisionIsolation(
  db,
  decisionValue,
  {
    verifiedEvents,
    candidateEntries,
    decisionEntries,
    currentDecisionSequence = null,
  } = {},
) {
  const decision = assertFeedbackPromotionDecision(decisionValue);
  const events = verifiedEvents ?? readVerifiedRootEventLedger(
    db,
    decision.rootScopeId,
  );
  const candidateEvent = events.find((event) =>
    event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
    && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE
    && event.subjectId === decision.candidateSubjectId,
  );
  if (!candidateEvent || candidateEvent.id !== decision.candidateEventId) {
    throw new Error(
      "Decisão exige candidato de interpretação existente e eventId exato.",
    );
  }
  const projectedCandidate = projectFeedbackInterpretationLedgerEntry(
    candidateEvent,
  );
  const candidateIsolation = assertFeedbackInterpretationIsolation(
    db,
    projectedCandidate.candidate,
    {
    verifiedEvents: events,
    requireSuggestedScopeActive: false,
    candidateEventSequence: candidateEvent.sequence,
    },
  );
  if (
    projectedCandidate.candidateHash !== decision.candidateHash
    || candidateEvent.eventHash !== decision.candidateEventHash
  ) {
    throw new Error(
      "Decisão diverge do hash do candidato ou do evento-fonte.",
    );
  }
  if (
    canonicalJson(decision.scopeDecision)
      !== canonicalJson(projectedCandidate.candidate.suggestedScope)
  ) {
    throw new Error(
      "Nesta fase, scopeDecision deve preservar o suggestedScope exato.",
    );
  }
  if (
    decision.action === "apply-once"
    && decision.oneShot.productionId
      !== candidateIsolation.sourceEntry.feedback.target.productionScopeId
  ) {
    throw new Error(
      "apply-once deve apontar para a productionScopeId exata do feedback.",
    );
  }
  const allPriorDecisions = (decisionEntries ?? events
    .filter((event) =>
      event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
      && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
    )
    .map(projectFeedbackPromotionDecisionLedgerEntry))
    .filter((entry) =>
      currentDecisionSequence == null
      || entry.sequence < currentDecisionSequence,
    );
  const priorDecisions = allPriorDecisions.filter((entry) =>
    entry.candidateSubjectId === decision.candidateSubjectId,
  );
  const snapshotAt = Date.parse(decision.queueSnapshot.asOf);
  const decisionsAfterSnapshot = priorDecisions.filter((entry) =>
    Date.parse(entry.decision.decidedAt) > snapshotAt,
  );
  const futureTerminal = decisionsAfterSnapshot
    .filter((entry) => TERMINAL_PROMOTION_ACTIONS.has(entry.decision.action))
    .sort((left, right) => left.sequence - right.sequence);
  const latestFutureTerminal = futureTerminal.at(-1) ?? null;
  if (
    latestFutureTerminal != null
    && decision.action !== "apply-once"
    && decision.supersedesDecisionId !== latestFutureTerminal.decision.decisionId
  ) {
    throw new Error(
      "Nova decisão após terminal exige supersedesDecisionId explícito.",
    );
  }
  if (decision.supersedesDecisionId != null) {
    const superseded = priorDecisions.find((entry) =>
      entry.decision.decisionId === decision.supersedesDecisionId,
    );
    if (!superseded || !TERMINAL_PROMOTION_ACTIONS.has(superseded.decision.action)) {
      throw new Error(
        "supersedesDecisionId deve apontar para decisão terminal existente.",
      );
    }
    if (Date.parse(superseded.decision.decidedAt) <= snapshotAt) {
      throw new Error(
        "Supersessão deve usar snapshot anterior à decisão terminal substituída.",
      );
    }
    if (latestFutureTerminal?.decision.decisionId !== decision.supersedesDecisionId) {
      throw new Error(
        "Supersessão deve apontar para a decisão terminal mais recente.",
      );
    }
  }
  const candidates = candidateEntries ?? events
    .filter((event) =>
      event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
      && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
    )
    .map(projectFeedbackInterpretationLedgerEntry);
  const queueEntries = buildFeedbackPromotionQueue({
    rootScopeId: decision.rootScopeId,
    candidates,
    decisions: allPriorDecisions,
    asOf: decision.queueSnapshot.asOf,
    scopeId: decision.queueSnapshot.scopeId,
    limit: decision.queueSnapshot.limit,
  });
  const expectedQueueHash = feedbackPromotionQueueHash(
    decision.rootScopeId,
    decision.queueSnapshot,
    queueEntries,
  );
  if (expectedQueueHash !== decision.queueSnapshot.hash) {
    throw new Error(
      "Decisão diverge do snapshot hash-bound da fila de promoção.",
    );
  }
  if (
    decision.action !== "apply-once"
    && !queueEntries.some((entry) => entry.subjectId === decision.candidateSubjectId)
  ) {
    throw new Error(
      "Candidato não está pendente no snapshot da fila informado.",
    );
  }
  return {
    decision,
    candidate: projectedCandidate,
    priorDecisions,
    queueEntries,
  };
}

function validateSchemaIdentity(schemaId, schemaVersion) {
  const normalizedSchemaId = requiredText(schemaId, "schemaId", 240);
  const match = SCHEMA_ID_PATTERN.exec(normalizedSchemaId);
  const normalizedVersion = Number(schemaVersion);
  if (!match || !Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    throw new Error("schemaId/schemaVersion inválidos.");
  }
  if (Number(match[1]) !== normalizedVersion) {
    throw new Error("schemaVersion diverge da versão declarada em schemaId.");
  }
  return { schemaId: normalizedSchemaId, schemaVersion: normalizedVersion };
}

function knowledgePayloadOptions(item) {
  return {
    recordType: item?.recordType,
    schemaId: item?.schemaId,
    schemaVersion: item?.schemaVersion,
    payload: item?.payload,
  };
}

function knowledgeBindingError(type, message) {
  const error = new Error(message);
  error.knowledgeIssueType = type;
  return error;
}

function assertPersistableKnowledgePayload(item, label = "Knowledge item") {
  const role = classifyKnowledgeSchemaRole(item?.schemaId);
  if (!role.persistableItemPayload) {
    throw knowledgeBindingError(
      "item-payload-contract",
      `${label} usa schema histórico, desconhecido ou não persistível.`,
    );
  }
  try {
    return collectKnowledgeRecordPayloadReferences(
      knowledgePayloadOptions(item),
    );
  } catch (error) {
    throw knowledgeBindingError(
      "item-payload-contract",
      `${label} possui payload inválido: ${error.message}`,
    );
  }
}

function assertRegisteredKnowledgePayloadIfKnown(
  item,
  label = "Knowledge item persistido",
) {
  const role = classifyKnowledgeSchemaRole(item?.schemaId);
  if (!role.persistableItemPayload) return null;
  try {
    assertKnowledgeRecordPayloadContract(knowledgePayloadOptions(item));
    return role;
  } catch (error) {
    throw knowledgeBindingError(
      "item-payload-contract",
      `${label} possui payload registrado inválido: ${error.message}`,
    );
  }
}

function assertKnowledgeOwnerInRoot(db, item, label = "Knowledge item") {
  const owner = item?.governance?.owner;
  const ownerScope = db.prepare(`
    SELECT kind
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(item.rootScopeId, owner?.id);
  if (!ownerScope) {
    throw knowledgeBindingError(
      "item-owner-scope",
      `${label} possui owner que não pertence ao mesmo root.`,
    );
  }
  if (ownerScope.kind !== owner.type) {
    throw knowledgeBindingError(
      "item-owner-scope",
      `${label} possui owner.type divergente do scope governado.`,
    );
  }
}

function assertKnowledgeReferenceInRoot(
  db,
  item,
  descriptor,
  label = "Knowledge item",
) {
  const reference = descriptor.reference;
  if (reference.rootScopeId !== item.rootScopeId) {
    throw knowledgeBindingError(
      "item-reference-root",
      `${label} contém referência fora do root em ${descriptor.path}.`,
    );
  }
  if (reference.kind === "scope") {
    const scope = db.prepare(`
      SELECT 1
      FROM knowledge_scopes
      WHERE root_scope_id=? AND scope_id=?
    `).get(item.rootScopeId, reference.id);
    if (!scope) {
      throw knowledgeBindingError(
        "item-reference-target",
        `${label} contém scope-ref inexistente em ${descriptor.path}.`,
      );
    }
    return;
  }
  const target = db.prepare(`
    SELECT record_type,content_hash
    FROM knowledge_items
    WHERE root_scope_id=? AND item_id=? AND revision=?
  `).get(
    item.rootScopeId,
    reference.id,
    reference.revision,
  );
  if (!target) {
    throw knowledgeBindingError(
      "item-reference-target",
      `${label} contém item-ref inexistente em ${descriptor.path}.`,
    );
  }
  if (
    target.record_type !== reference.recordType
    || target.content_hash !== reference.contentHash
  ) {
    throw knowledgeBindingError(
      "item-reference-target",
      `${label} contém item-ref com type/hash divergente em ${descriptor.path}.`,
    );
  }
}

function assertKnowledgeEvidenceRefsMatch(item, references, label) {
  if (!Array.isArray(item?.payload?.evidenceRefs)) return;
  const payloadEvidenceIds = references
    .filter((descriptor) => descriptor.role === "evidence")
    .map((descriptor) => descriptor.reference.id)
    .sort(compareText);
  const governedEvidenceIds = [...item.governance.evidenceIds]
    .sort(compareText);
  if (
    canonicalJson(payloadEvidenceIds)
    !== canonicalJson(governedEvidenceIds)
  ) {
    throw knowledgeBindingError(
      "item-evidence-refs",
      `${label} diverge entre governance.evidenceIds e payload.evidenceRefs.`,
    );
  }
}

function assertPersistableKnowledgeItemBindings(
  db,
  item,
  label = "Knowledge item",
) {
  const references = assertPersistableKnowledgePayload(item, label);
  assertKnowledgeOwnerInRoot(db, item, label);
  for (const descriptor of references) {
    assertKnowledgeReferenceInRoot(db, item, descriptor, label);
  }
  assertKnowledgeEvidenceRefsMatch(item, references, label);
  return references;
}

function prepareCanonicalKnowledgeBatchItem(grant, item, index) {
  const label = `items[${index}]`;
  const canonicalItem = assertKnowledgeContract(item, {
    schemaId: KNOWLEDGE_ITEM_SCHEMA,
    label: `${label} Knowledge item canônico`,
  });
  const id = identifier(canonicalItem.id, `${label}.id`);
  const rootScopeId = identifier(
    canonicalItem.rootScopeId,
    `${label}.rootScopeId`,
  );
  const scopeId = identifier(canonicalItem.scopeId, `${label}.scopeId`);
  const revision = Number(canonicalItem.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`${label}.revision deve ser um inteiro positivo.`);
  }
  const recordType = requiredText(
    canonicalItem.recordType,
    `${label}.recordType`,
    40,
  );
  if (!RECORD_TYPES.has(recordType)) {
    throw new Error(`recordType inválido: ${recordType}.`);
  }
  const status = requiredText(canonicalItem.status, `${label}.status`, 40);
  if (!RECORD_STATUSES.has(status)) {
    throw new Error(`Status de knowledge item inválido: ${status}.`);
  }
  if (status === "quarantined") {
    throw new Error(
      "Revisão quarantined exige reviewKnowledgeItem com decisão humana.",
    );
  }
  const { schemaId, schemaVersion } = validateSchemaIdentity(
    canonicalItem.schemaId,
    canonicalItem.schemaVersion,
  );
  if (schemaId === KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA) {
    throw new Error(
      "Asset link exige appendKnowledgeAssetLinkItem; append atômico genérico bloqueado.",
    );
  }
  const payload = normalizeJson(canonicalItem.payload);
  const supersedesRevision = canonicalItem.supersedesRevision == null
    ? null
    : Number(canonicalItem.supersedesRevision);
  const governance = assertKnowledgeRecordEnvelope(
    canonicalItem.governance,
    { expectedActor: grant.actor },
  );
  const createdAt = assertTimestampWithinGrant(
    canonicalItem.createdAt,
    grant,
    `${label}.createdAt`,
  );
  const createdBy = authorizedActor(
    canonicalItem.createdBy,
    grant,
    `${label}.createdBy`,
  );
  if (
    createdAt !== governance.createdAt
    || createdBy !== governance.createdBy
  ) {
    throw new Error(
      `${label}.createdAt e ${label}.createdBy devem corresponder ao governance.`,
    );
  }
  const body = {
    schema: KNOWLEDGE_ITEM_SCHEMA,
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType,
    schemaId,
    schemaVersion,
    status,
    governance: normalizeJson(governance),
    supersedesRevision,
    payload,
    createdAt,
    createdBy,
  };
  const bodyJson = canonicalJson(body);
  const hash = sha256Text(bodyJson);
  if (canonicalItem.contentHash !== hash) {
    throw new Error(`${label}.contentHash diverge do conteúdo canônico.`);
  }
  const result = assertKnowledgeContract({
    ...body,
    contentHash: hash,
  }, {
    schemaId: KNOWLEDGE_ITEM_SCHEMA,
    label: `${label} Knowledge item`,
  });
  return {
    body,
    bodyJson,
    governance,
    governanceJson: canonicalJson(governance),
    hash,
    result,
  };
}

function batchItemKey(item) {
  return `${item.rootScopeId}\u0000${item.id}\u0000${item.revision}`;
}

function appendPreparedKnowledgeBatchItemsInTransaction(
  db,
  grant,
  rootScopeId,
  scopeId,
  preparedItems,
  normalizedExpectedHeads = [],
) {
  assertRootScopeExists(db, rootScopeId);
  const scope = db.prepare(`
    SELECT 1
    FROM knowledge_scopes
    WHERE root_scope_id=? AND scope_id=?
  `).get(rootScopeId, scopeId);
  if (!scope) {
    throw new Error(`Scope não pertence ao root autorizado: ${scopeId}.`);
  }
  assertExpectedKnowledgeHeads(db, normalizedExpectedHeads);
  const batchItems = new Map(preparedItems.map((prepared) => [
    batchItemKey(prepared.body),
    prepared.result,
  ]));
  const simulatedHeads = new Map();
  for (let index = 0; index < preparedItems.length; index += 1) {
    const prepared = preparedItems[index];
    const latest = simulatedHeads.has(prepared.body.id)
      ? simulatedHeads.get(prepared.body.id)
      : db.prepare(`
          SELECT revision,record_type,status,schema_id
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=?
          ORDER BY revision DESC
          LIMIT 1
        `).get(rootScopeId, prepared.body.id);
    assertKnowledgeItemRevisionState(prepared, latest);
    simulatedHeads.set(prepared.body.id, {
      revision: prepared.body.revision,
      record_type: prepared.body.recordType,
      status: prepared.body.status,
      schema_id: prepared.body.schemaId,
    });
    assertPersistableKnowledgeBatchItemBindings(
      db,
      prepared.body,
      batchItems,
      `items[${index}]`,
    );
  }
  const results = preparedItems.map((prepared) =>
    insertPreparedKnowledgeBatchItem(db, grant, prepared));
  for (let index = 0; index < preparedItems.length; index += 1) {
    assertPersistableKnowledgeItemBindings(
      db,
      preparedItems[index].body,
      `items[${index}] persistido`,
    );
  }
  return results;
}

function normalizeExpectedKnowledgeHeads(
  expectedHeads,
  rootScopeId,
  preparedItems,
) {
  if (expectedHeads === undefined) return [];
  if (!Array.isArray(expectedHeads)) {
    throw new Error("expectedHeads deve ser um array.");
  }
  if (expectedHeads.length > MAX_EXPECTED_HEADS) {
    throw new Error(
      `expectedHeads aceita no máximo ${MAX_EXPECTED_HEADS} itens.`,
    );
  }
  const allowedKeys = new Set([
    "rootScopeId",
    "id",
    "revision",
    "contentHash",
    "status",
    "schemaId",
  ]);
  const batchKeys = new Set(
    preparedItems.map(({ body }) => batchItemKey(body)),
  );
  const seenIds = new Set();
  return expectedHeads.map((entry, index) => {
    const label = `expectedHeads[${index}]`;
    if (
      entry == null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      throw new Error(`${label} deve ser um objeto simples.`);
    }
    const unknownKeys = Object.keys(entry)
      .filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      throw new Error(
        `${label} contém campos desconhecidos: ${unknownKeys.join(", ")}.`,
      );
    }
    const expectedRootScopeId = entry.rootScopeId == null
      ? rootScopeId
      : identifier(entry.rootScopeId, `${label}.rootScopeId`);
    if (expectedRootScopeId !== rootScopeId) {
      throw new Error(`${label}.rootScopeId diverge do lote atômico.`);
    }
    const id = identifier(entry.id, `${label}.id`);
    if (seenIds.has(id)) {
      throw new Error(`expectedHeads não aceita head duplicado: ${id}.`);
    }
    seenIds.add(id);
    const revision = Number(entry.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error(`${label}.revision deve ser um inteiro positivo.`);
    }
    const contentHash = requiredText(
      entry.contentHash,
      `${label}.contentHash`,
      64,
    );
    if (!SHA256_PATTERN.test(contentHash)) {
      throw new Error(`${label}.contentHash deve ser SHA-256.`);
    }
    const status = requiredText(entry.status, `${label}.status`, 40);
    if (!RECORD_STATUSES.has(status)) {
      throw new Error(`${label}.status é inválido.`);
    }
    const schemaId = requiredText(entry.schemaId, `${label}.schemaId`, 240);
    if (!SCHEMA_ID_PATTERN.test(schemaId)) {
      throw new Error(`${label}.schemaId é inválido.`);
    }
    const normalized = {
      rootScopeId: expectedRootScopeId,
      id,
      revision,
      contentHash,
      status,
      schemaId,
    };
    if (batchKeys.has(batchItemKey(normalized))) {
      throw new Error(
        `${label} deve apontar para estado prévio persistido, não para item do próprio lote.`,
      );
    }
    return normalized;
  });
}

function assertExpectedKnowledgeHeads(db, expectedHeads) {
  for (let index = 0; index < expectedHeads.length; index += 1) {
    const expected = expectedHeads[index];
    const row = db.prepare(`
      SELECT *
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=?
      ORDER BY revision DESC
      LIMIT 1
    `).get(expected.rootScopeId, expected.id);
    if (!row) {
      throw new Error(
        `expectedHeads[${index}] não resolve um head canônico persistido.`,
      );
    }
    const current = itemFromRow(row);
    if (
      current.rootScopeId !== expected.rootScopeId
      || current.id !== expected.id
      || current.revision !== expected.revision
      || current.contentHash !== expected.contentHash
      || current.status !== expected.status
      || current.schemaId !== expected.schemaId
    ) {
      throw new Error(
        `expectedHeads[${index}] diverge do head canônico persistido.`,
      );
    }
  }
}

function assertKnowledgeBatchReferenceInRoot(
  db,
  item,
  descriptor,
  batchItems,
  label,
) {
  const reference = descriptor.reference;
  if (reference.rootScopeId !== item.rootScopeId) {
    throw knowledgeBindingError(
      "item-reference-root",
      `${label} contém referência fora do root em ${descriptor.path}.`,
    );
  }
  if (reference.kind === "scope") {
    const scope = db.prepare(`
      SELECT 1
      FROM knowledge_scopes
      WHERE root_scope_id=? AND scope_id=?
    `).get(item.rootScopeId, reference.id);
    if (!scope) {
      throw knowledgeBindingError(
        "item-reference-target",
        `${label} contém scope-ref inexistente em ${descriptor.path}.`,
      );
    }
    return;
  }
  const inBatch = batchItems.get(
    `${item.rootScopeId}\u0000${reference.id}\u0000${reference.revision}`,
  );
  if (inBatch) {
    if (
      inBatch.recordType !== reference.recordType
      || inBatch.contentHash !== reference.contentHash
    ) {
      throw knowledgeBindingError(
        "item-reference-target",
        `${label} contém item-ref com type/hash divergente em ${descriptor.path}.`,
      );
    }
    return;
  }
  assertKnowledgeReferenceInRoot(db, item, descriptor, label);
}

function assertPersistableKnowledgeBatchItemBindings(
  db,
  item,
  batchItems,
  label,
) {
  const references = assertPersistableKnowledgePayload(item, label);
  assertKnowledgeOwnerInRoot(db, item, label);
  for (const descriptor of references) {
    assertKnowledgeBatchReferenceInRoot(
      db,
      item,
      descriptor,
      batchItems,
      label,
    );
  }
  assertKnowledgeEvidenceRefsMatch(item, references, label);
}

function assertKnowledgeItemRevisionState(prepared, latest) {
  const { body } = prepared;
  if (!latest && (body.revision !== 1 || body.supersedesRevision != null)) {
    throw new Error("Primeira revisão deve ser 1 e não pode superseder outra.");
  }
  if (!latest) return;
  if (
    body.revision !== latest.revision + 1
    || body.supersedesRevision !== latest.revision
  ) {
    throw new Error(
      `Nova revisão deve ser ${latest.revision + 1} e superseder ${latest.revision}.`,
    );
  }
  if (latest.record_type !== body.recordType) {
    throw new Error("recordType é imutável entre revisões.");
  }
  if (latest.schema_id === KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA) {
    throw new Error(
      "Revisão de asset link exige appendKnowledgeAssetLinkItem.",
    );
  }
  if (latest.status === "candidate" && body.status === "active") {
    throw new Error(
      "Promoção candidate → active exige reviewKnowledgeItem.",
    );
  }
}

function insertPreparedKnowledgeBatchItem(db, grant, prepared) {
  const {
    body,
    bodyJson,
    governance,
    governanceJson,
    hash,
    result,
  } = prepared;
  db.prepare(`
    INSERT INTO knowledge_items(
      root_scope_id,item_id,revision,scope_id,record_type,schema_id,
      schema_version,status,classification,owner_type,owner_id,modality,
      governance_json,governance_hash,supersedes_revision,body_json,
      content_hash,created_at,created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    body.rootScopeId,
    body.id,
    body.revision,
    body.scopeId,
    body.recordType,
    body.schemaId,
    body.schemaVersion,
    body.status,
    governance.classification,
    governance.owner.type,
    governance.owner.id,
    governance.modality,
    governanceJson,
    governance.hash,
    body.supersedesRevision,
    bodyJson,
    hash,
    body.createdAt,
    body.createdBy,
  );
  appendEvent(db, {
    rootScopeId: body.rootScopeId,
    scopeId: body.scopeId,
    type: "knowledge-item.appended",
    subjectType: body.recordType,
    subjectId: body.id,
    subjectRevision: body.revision,
    grant,
    grantPermission: "write",
    payload: {
      contentHash: hash,
      schemaId: body.schemaId,
      schemaVersion: body.schemaVersion,
      status: body.status,
      supersedesRevision: body.supersedesRevision,
      governanceHash: governance.hash,
    },
    at: body.createdAt,
  });
  return result;
}

function assertReleaseReferenceClosure(items, label = "Knowledge release") {
  const selected = new Map(items.map((item) => [
    `${item.id}\u0000${item.revision}`,
    item,
  ]));
  for (const item of items) {
    const references = assertPersistableKnowledgePayload(
      item,
      `${label} member`,
    );
    for (const descriptor of references) {
      const reference = descriptor.reference;
      if (reference.kind !== "item") continue;
      const target = selected.get(
        `${reference.id}\u0000${reference.revision}`,
      );
      if (!target) {
        throw knowledgeBindingError(
          "release-reference-closure",
          `${label} não inclui a revisão referenciada por ${item.id} em ${descriptor.path}.`,
        );
      }
      if (
        target.recordType !== reference.recordType
        || target.contentHash !== reference.contentHash
      ) {
        throw knowledgeBindingError(
          "release-reference-closure",
          `${label} diverge do type/hash referenciado por ${item.id}.`,
        );
      }
    }
  }
}

function latestItemRows(db, rootScopeId) {
  return db.prepare(`
    SELECT item.*
    FROM knowledge_items AS item
    JOIN (
      SELECT item_id,MAX(revision) AS revision
      FROM knowledge_items
      WHERE root_scope_id=?
      GROUP BY item_id
    ) AS latest
      ON latest.item_id=item.item_id
      AND latest.revision=item.revision
    WHERE item.root_scope_id=?
    ORDER BY item.item_id,item.revision
  `).all(rootScopeId, rootScopeId);
}

function releaseMemberFromItem(item) {
  return {
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    contentHash: item.contentHash,
  };
}

function scopeRowsForRelease(db, rootScopeId, items) {
  const requiredScopeIds = new Set([
    rootScopeId,
    ...items.map((item) => item.scopeId),
  ]);
  for (const item of items) {
    const role = classifyKnowledgeSchemaRole(item.schemaId);
    if (!role.persistableItemPayload) continue;
    requiredScopeIds.add(item.governance.owner.id);
    for (const descriptor of assertPersistableKnowledgePayload(
      item,
      "Release export member",
    )) {
      if (descriptor.reference.kind === "scope") {
        requiredScopeIds.add(descriptor.reference.id);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const scopeId of [...requiredScopeIds]) {
      const row = db.prepare(`
        SELECT parent_scope_id
        FROM knowledge_scopes
        WHERE root_scope_id=? AND scope_id=?
      `).get(rootScopeId, scopeId);
      if (!row) throw new Error(`Scope inexistente durante export: ${scopeId}.`);
      if (row.parent_scope_id && !requiredScopeIds.has(row.parent_scope_id)) {
        requiredScopeIds.add(row.parent_scope_id);
        changed = true;
      }
    }
  }
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_scopes
    WHERE root_scope_id=?
    ORDER BY scope_id
  `).all(rootScopeId);
  return rows
    .filter((row) => requiredScopeIds.has(row.scope_id))
    .map(scopeFromRow);
}

function normalizeSchemaSql(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "");
}

function schemaDefinitions(db) {
  return db.prepare(`
    SELECT type,name,tbl_name,sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY type,name
  `).all().map((row) => ({
    type: row.type,
    name: row.name,
    table: row.tbl_name,
    sql: normalizeSchemaSql(row.sql),
  }));
}

let expectedSchemaDefinitionsCache = null;

function expectedSchemaDefinitions() {
  if (expectedSchemaDefinitionsCache) return expectedSchemaDefinitionsCache;
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("BEGIN IMMEDIATE");
    bootstrapMigrations(db);
    for (const migration of MIGRATIONS) db.exec(migrationSql(migration));
    db.exec("COMMIT");
    expectedSchemaDefinitionsCache = schemaDefinitions(db);
    return expectedSchemaDefinitionsCache;
  } finally {
    db.close();
  }
}

function inspectSchemaDefinitions(db) {
  const expected = expectedSchemaDefinitions();
  const actual = schemaDefinitions(db);
  const expectedByKey = new Map(
    expected.map((definition) => [
      `${definition.type}:${definition.name}`,
      definition,
    ]),
  );
  const actualByKey = new Map(
    actual.map((definition) => [
      `${definition.type}:${definition.name}`,
      definition,
    ]),
  );
  const issues = [];
  for (const [key, definition] of expectedByKey) {
    const actualDefinition = actualByKey.get(key);
    if (!actualDefinition) {
      issues.push(definition.type === "trigger"
        && APPEND_ONLY_TRIGGERS.includes(definition.name)
        ? {
            type: "append-only-boundary",
            trigger: definition.name,
            reason: "missing",
          }
        : {
            type: "schema-object-missing",
            objectType: definition.type,
            objectName: definition.name,
          });
    } else if (
      actualDefinition.table !== definition.table
      || actualDefinition.sql !== definition.sql
    ) {
      issues.push(definition.type === "trigger"
        && APPEND_ONLY_TRIGGERS.includes(definition.name)
        ? {
            type: "append-only-boundary",
            trigger: definition.name,
            reason: "definition",
          }
        : {
            type: "schema-definition",
            objectType: definition.type,
            objectName: definition.name,
          });
    }
  }
  for (const [key, definition] of actualByKey) {
    if (!expectedByKey.has(key)) {
      issues.push({
        type: "schema-object-unknown",
        objectType: definition.type,
        objectName: definition.name,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

function rootEventExpectation({
  type,
  subjectType,
  subjectId,
  subjectRevision = null,
  scopeId,
  at,
  actor,
  grantPermission,
  payload,
}) {
  return {
    type,
    subjectType,
    subjectId,
    subjectRevision,
    scopeId,
    at,
    actor,
    grantPermission,
    payload: normalizeJson(payload),
  };
}

function eventSubjectKey(event) {
  return canonicalJson([
    event.type,
    event.subjectType,
    event.subjectId,
    event.subjectRevision,
  ]);
}

function inspectRootData(db, rootScopeId) {
  const issues = [];
  const expectedEvents = [];
  let privateEventClassificationFloor = null;
  const scopeRows = db.prepare(`
    SELECT *
    FROM knowledge_scopes
    WHERE root_scope_id=?
    ORDER BY scope_id
  `).all(rootScopeId);
  const root = scopeRows.find(
    (row) => row.scope_id === rootScopeId && row.parent_scope_id == null,
  );
  if (!root) issues.push({ type: "root-scope", rootScopeId });
  for (const row of scopeRows) {
    try {
      const body = JSON.parse(row.body_json);
      const expectedHash = sha256Text(canonicalJson(body));
      if (expectedHash !== row.content_hash) {
        issues.push({ type: "scope-hash", scopeId: row.scope_id });
      }
      if (
        body.id !== row.scope_id
        || body.rootScopeId !== row.root_scope_id
        || body.parentScopeId !== row.parent_scope_id
        || body.kind !== row.kind
        || body.name !== row.name
        || body.status !== row.status
        || body.createdAt !== row.created_at
        || body.createdBy !== row.created_by
      ) {
        issues.push({ type: "scope-projection", scopeId: row.scope_id });
      }
      expectedEvents.push(rootEventExpectation({
        type: "scope.created",
        subjectType: "scope",
        subjectId: row.scope_id,
        scopeId: row.scope_id,
        at: row.created_at,
        actor: row.created_by,
        grantPermission: "write",
        payload: {
          contentHash: row.content_hash,
          kind: row.kind,
          parentScopeId: row.parent_scope_id,
        },
      }));
    } catch {
      issues.push({ type: "scope-payload", scopeId: row.scope_id });
    }
  }

  const reviewDecisionRows = db.prepare(`
    SELECT *
    FROM knowledge_review_decisions
    WHERE root_scope_id=?
    ORDER BY decision_sequence
  `).all(rootScopeId);
  const reviewedResultKeys = new Set(reviewDecisionRows.map((row) =>
    `${row.item_id}@${row.result_revision}`));
  const lastRevision = new Map();
  const lastItemRow = new Map();
  const itemRows = db.prepare(`
    SELECT *
    FROM knowledge_items
    WHERE root_scope_id=?
    ORDER BY item_id,revision
  `).all(rootScopeId);
  for (const row of itemRows) {
    const previous = lastRevision.get(row.item_id) ?? 0;
    const previousRow = lastItemRow.get(row.item_id) ?? null;
    if (
      row.revision !== previous + 1
      || (row.revision === 1 && row.supersedes_revision != null)
      || (
        row.revision > 1
        && row.supersedes_revision !== row.revision - 1
      )
    ) {
      issues.push({
        type: "revision-gap",
        itemId: row.item_id,
        revision: row.revision,
      });
    }
    lastRevision.set(row.item_id, row.revision);
    lastItemRow.set(row.item_id, row);
    const reviewKey = `${row.item_id}@${row.revision}`;
    const requiresReview = row.status === "quarantined"
      || (
        previousRow?.status === "candidate"
        && row.status === "active"
      );
    if (requiresReview && !reviewedResultKeys.has(reviewKey)) {
      issues.push({
        type: "review-decision-missing",
        itemId: row.item_id,
        revision: row.revision,
      });
    }
    try {
      const body = JSON.parse(row.body_json);
      try {
        assertKnowledgeContract({
          ...body,
          contentHash: row.content_hash,
        }, {
          schemaId: KNOWLEDGE_ITEM_SCHEMA,
          label: "Knowledge item persistido",
        });
      } catch {
        issues.push({
          type: "item-schema",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      if (sha256Text(canonicalJson(body)) !== row.content_hash) {
        issues.push({
          type: "item-hash",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      let bodyGovernance = null;
      let projectedGovernance = null;
      try {
        bodyGovernance = assertKnowledgeRecordEnvelope(body.governance, {
          expectedActor: row.created_by,
        });
      } catch (error) {
        issues.push({
          type: String(error?.message ?? "").includes("hash inválido")
            ? "item-governance-hash"
            : "item-governance-schema",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      try {
        projectedGovernance = assertKnowledgeRecordEnvelope(
          JSON.parse(row.governance_json),
          { expectedActor: row.created_by },
        );
      } catch (error) {
        issues.push({
          type: String(error?.message ?? "").includes("hash inválido")
            ? "item-governance-hash"
            : "item-governance-schema",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      if (
        row.governance_hash !== bodyGovernance?.hash
        || row.governance_hash !== projectedGovernance?.hash
      ) {
        issues.push({
          type: "item-governance-hash",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      if (
        bodyGovernance == null
        || projectedGovernance == null
        || canonicalJson(bodyGovernance) !== canonicalJson(projectedGovernance)
        || row.classification !== bodyGovernance?.classification
        || row.owner_type !== bodyGovernance?.owner?.type
        || row.owner_id !== bodyGovernance?.owner?.id
        || row.modality !== bodyGovernance?.modality
        || row.created_at !== bodyGovernance?.createdAt
        || row.created_by !== bodyGovernance?.createdBy
      ) {
        issues.push({
          type: "item-governance-projection",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      if (
        body.id !== row.item_id
        || body.revision !== row.revision
        || body.rootScopeId !== row.root_scope_id
        || body.scopeId !== row.scope_id
        || body.recordType !== row.record_type
        || body.schemaId !== row.schema_id
        || body.schemaVersion !== row.schema_version
        || body.status !== row.status
        || body.supersedesRevision !== row.supersedes_revision
        || body.createdAt !== row.created_at
        || body.createdBy !== row.created_by
      ) {
        issues.push({
          type: "item-projection",
          itemId: row.item_id,
          revision: row.revision,
        });
      }
      if (
        classifyKnowledgeSchemaRole(row.schema_id).persistableItemPayload
      ) {
        try {
          assertPersistableKnowledgeItemBindings(db, {
            ...body,
            governance: bodyGovernance ?? body.governance,
            contentHash: row.content_hash,
          }, "Knowledge item persistido");
        } catch (error) {
          issues.push({
            type: error?.knowledgeIssueType ?? "item-payload-contract",
            itemId: row.item_id,
            revision: row.revision,
          });
        }
      }
      if (row.schema_id === KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA) {
        try {
          const payload = assertKnowledgeAssetLinkPayload(body.payload);
          const ownerScope = scopeRows.find((scopeRow) =>
            scopeRow.scope_id === row.scope_id);
          const expectedId = knowledgeAssetLinkItemId({
            rootScopeId,
            rootKind: payload.rootKind,
            relativePath: payload.relativePath,
          });
          if (
            row.record_type !== "relation"
            || row.schema_version !== 1
            || row.item_id !== expectedId
            || !ownerScope
            || row.owner_id !== row.scope_id
            || row.owner_type !== ownerScope.kind
          ) {
            issues.push({
              type: "asset-link-projection",
              itemId: row.item_id,
              revision: row.revision,
            });
          }
          if (previousRow != null) {
            const previousBody = JSON.parse(previousRow.body_json);
            const previousPayload = assertKnowledgeAssetLinkPayload(
              previousBody.payload,
            );
            if (
              previousRow.schema_id !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
              || previousPayload.rootKind !== payload.rootKind
              || previousPayload.relativePath !== payload.relativePath
            ) {
              issues.push({
                type: "asset-link-location",
                itemId: row.item_id,
                revision: row.revision,
              });
            }
          }
        } catch {
          issues.push({
            type: "asset-link-payload",
            itemId: row.item_id,
            revision: row.revision,
          });
        }
      }
      expectedEvents.push(rootEventExpectation({
        type: "knowledge-item.appended",
        subjectType: row.record_type,
        subjectId: row.item_id,
        subjectRevision: row.revision,
        scopeId: row.scope_id,
        at: row.created_at,
        actor: row.created_by,
        grantPermission: reviewedResultKeys.has(reviewKey)
          ? "release"
          : "write",
        payload: {
          contentHash: row.content_hash,
          schemaId: row.schema_id,
          schemaVersion: row.schema_version,
          status: row.status,
          supersedesRevision: row.supersedes_revision,
          governanceHash: row.governance_hash,
        },
      }));
    } catch {
      issues.push({
        type: "item-payload",
        itemId: row.item_id,
        revision: row.revision,
      });
    }
  }

  let previousDecisionSequence = 0;
  for (const row of reviewDecisionRows) {
    try {
      const decision = reviewDecisionFromRow(row);
      const body = JSON.parse(row.body_json);
      const evidenceIds = JSON.parse(row.evidence_json);
      if (row.decision_sequence !== previousDecisionSequence + 1) {
        issues.push({
          type: "review-decision-sequence",
          decisionId: row.decision_id,
        });
      }
      previousDecisionSequence = row.decision_sequence;
      if (sha256Text(canonicalJson(body)) !== row.decision_hash) {
        issues.push({
          type: "review-decision-hash",
          decisionId: row.decision_id,
        });
      }
      if (
        decision.id !== reviewDecisionId(decision)
        || decision.id !== row.decision_id
        || decision.rootScopeId !== row.root_scope_id
        || decision.scopeId !== row.scope_id
        || decision.sequence !== row.decision_sequence
        || decision.itemId !== row.item_id
        || decision.sourceRevision !== row.source_revision
        || decision.resultRevision !== row.result_revision
        || decision.action !== row.action
        || decision.sourceStatus !== row.source_status
        || decision.resultStatus !== row.result_status
        || decision.sourceContentHash !== row.source_content_hash
        || decision.resultContentHash !== row.result_content_hash
        || decision.reason !== row.reason
        || canonicalJson(decision.evidenceIds) !== canonicalJson(evidenceIds)
        || decision.policyId !== row.policy_id
        || decision.policyHash !== row.policy_hash
        || decision.reviewedAt !== row.reviewed_at
        || decision.reviewedBy !== row.reviewed_by
      ) {
        issues.push({
          type: "review-decision-projection",
          decisionId: row.decision_id,
        });
      }
      if (!knownKnowledgePolicy(
        decision.policyId,
        decision.policyHash,
      )) {
        issues.push({
          type: "review-decision-policy",
          decisionId: row.decision_id,
        });
      }
      const sourceRow = db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=?
      `).get(rootScopeId, row.item_id, row.source_revision);
      const resultRow = db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=?
      `).get(rootScopeId, row.item_id, row.result_revision);
      const source = itemFromRow(sourceRow);
      const result = itemFromRow(resultRow);
      if (
        !source
        || !result
        || source.scopeId !== decision.scopeId
        || result.scopeId !== source.scopeId
        || result.recordType !== source.recordType
        || result.schemaId !== source.schemaId
        || result.schemaVersion !== source.schemaVersion
        || canonicalJson(result.payload) !== canonicalJson(source.payload)
        || source.status !== decision.sourceStatus
        || result.status !== decision.resultStatus
        || source.contentHash !== decision.sourceContentHash
        || result.contentHash !== decision.resultContentHash
        || result.supersedesRevision !== source.revision
        || result.createdAt !== decision.reviewedAt
        || result.createdBy !== decision.reviewedBy
        || result.governance.classification
          !== source.governance.classification
        || canonicalJson(result.governance.owner)
          !== canonicalJson(source.governance.owner)
        || result.governance.modality !== source.governance.modality
        || canonicalJson(result.governance.retention)
          !== canonicalJson(source.governance.retention)
        || canonicalJson(result.governance.rights)
          !== canonicalJson(source.governance.rights)
      ) {
        issues.push({
          type: "review-transition",
          decisionId: row.decision_id,
        });
      } else {
        const expectedEvidenceIds = source.governance.evidenceIds;
        const expectedReviewProvenance = {
          sourceType: "human-review",
          sourceRef: `review:${decision.id}`,
          method: "human-review",
          observedAt: decision.reviewedAt,
          contentHash: source.contentHash,
        };
        const expectedProvenance = [
          ...new Map(
            [...source.governance.provenance, expectedReviewProvenance]
              .map((entry) => [canonicalJson(entry), entry]),
          ).values(),
        ].sort((left, right) =>
          compareText(canonicalJson(left), canonicalJson(right)));
        if (
          canonicalJson(result.governance.evidenceIds)
            !== canonicalJson(expectedEvidenceIds)
          || canonicalJson(result.governance.provenance)
            !== canonicalJson(expectedProvenance)
        ) {
          issues.push({
            type: "review-governance",
            decisionId: row.decision_id,
          });
        }
      }
      expectedEvents.push(rootEventExpectation({
        type: row.action === "promote"
          ? "knowledge-item.promoted"
          : "knowledge-item.quarantined",
        subjectType: "knowledge-review-decision",
        subjectId: row.decision_id,
        scopeId: row.scope_id,
        at: row.reviewed_at,
        actor: row.reviewed_by,
        grantPermission: "release",
        payload: {
          action: row.action,
          decisionHash: row.decision_hash,
          itemId: row.item_id,
          sourceRevision: row.source_revision,
          sourceContentHash: row.source_content_hash,
          resultRevision: row.result_revision,
          resultContentHash: row.result_content_hash,
        },
      }));
    } catch {
      issues.push({
        type: "review-decision-payload",
        decisionId: row.decision_id,
      });
    }
  }

  const releaseRows = db.prepare(`
    SELECT *
    FROM knowledge_releases
    WHERE root_scope_id=?
    ORDER BY created_at,release_id
  `).all(rootScopeId);
  for (const row of releaseRows) {
    try {
      const release = releaseFromRow(row);
      const body = JSON.parse(row.manifest_json);
      if (sha256Text(canonicalJson(body)) !== row.release_hash) {
        issues.push({ type: "release-hash", releaseId: row.release_id });
      }
      if (
        body.id !== row.release_id
        || body.rootScopeId !== row.root_scope_id
        || body.previousReleaseId !== row.previous_release_id
        || body.label !== row.label
        || body.createdAt !== row.created_at
        || body.createdBy !== row.created_by
      ) {
        issues.push({
          type: "release-projection",
          releaseId: row.release_id,
        });
      }
      const memberRows = db.prepare(`
        SELECT *
        FROM knowledge_release_members
        WHERE root_scope_id=? AND release_id=?
        ORDER BY ordinal
      `).all(rootScopeId, row.release_id);
      const projectedMembers = memberRows.map((member) => ({
        id: member.item_id,
        revision: member.revision,
        recordType: member.record_type,
        schemaId: member.schema_id,
        schemaVersion: member.schema_version,
        contentHash: member.content_hash,
      }));
      if (canonicalJson(projectedMembers) !== canonicalJson(release.members)) {
        issues.push({
          type: "release-members",
          releaseId: row.release_id,
        });
      }
      for (const member of memberRows) {
        const item = db.prepare(`
          SELECT record_type,schema_id,schema_version,content_hash
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=? AND revision=?
        `).get(rootScopeId, member.item_id, member.revision);
        if (
          !item
          || item.record_type !== member.record_type
          || item.schema_id !== member.schema_id
          || item.schema_version !== member.schema_version
          || item.content_hash !== member.content_hash
        ) {
          issues.push({
            type: "release-member-projection",
            releaseId: row.release_id,
            itemId: member.item_id,
            revision: member.revision,
          });
        }
      }
      const releaseItemRows = memberRows.map((member) => db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=?
      `).get(rootScopeId, member.item_id, member.revision));
      if (
        releaseItemRows.every(Boolean)
        && releaseItemRows.every((item) =>
          classifyKnowledgeSchemaRole(item.schema_id).persistableItemPayload)
      ) {
        try {
          assertReleaseReferenceClosure(
            releaseItemRows.map(itemFromRow),
            "Knowledge release persistida",
          );
        } catch {
          issues.push({
            type: "release-reference-closure",
            releaseId: row.release_id,
          });
        }
      }
      expectedEvents.push(rootEventExpectation({
        type: "knowledge-release.created",
        subjectType: "knowledge-release",
        subjectId: row.release_id,
        scopeId: rootScopeId,
        at: row.created_at,
        actor: row.created_by,
        grantPermission: "release",
        payload: {
          releaseHash: row.release_hash,
          previousReleaseId: row.previous_release_id,
          memberCount: memberRows.length,
        },
      }));
    } catch {
      issues.push({
        type: "release-payload",
        releaseId: row.release_id,
      });
    }
  }

  const activationRows = db.prepare(`
    SELECT *
    FROM knowledge_release_activations
    WHERE root_scope_id=?
    ORDER BY activation_sequence
  `).all(rootScopeId);
  let previousActivation = null;
  for (const row of activationRows) {
    try {
      const activation = releaseActivationFromRow(row);
      const body = JSON.parse(row.body_json);
      if (sha256Text(canonicalJson(body)) !== row.activation_hash) {
        issues.push({
          type: "release-activation-hash",
          activationId: row.activation_id,
        });
      }
      if (
        body.id !== row.activation_id
        || body.rootScopeId !== row.root_scope_id
        || body.sequence !== row.activation_sequence
        || body.mode !== row.mode
        || body.releaseId !== row.release_id
        || body.previousActivationId !== row.previous_activation_id
        || body.previousActiveReleaseId !== row.previous_active_release_id
        || body.reason !== row.reason
        || body.eligibilityHash !== row.eligibility_hash
        || body.createdAt !== row.created_at
        || body.createdBy !== row.created_by
      ) {
        issues.push({
          type: "release-activation-projection",
          activationId: row.activation_id,
        });
      }
      const releaseRow = db.prepare(`
        SELECT release_hash,previous_release_id
        FROM knowledge_releases
        WHERE root_scope_id=? AND release_id=?
      `).get(rootScopeId, row.release_id);
      if (!releaseRow || releaseRow.release_hash !== activation.releaseHash) {
        issues.push({
          type: "release-activation-release",
          activationId: row.activation_id,
        });
      }
      if (
        previousActivation == null
        ? (
            row.activation_sequence !== 1
            || row.mode !== "activate"
            || row.previous_activation_id != null
            || row.previous_active_release_id != null
            || releaseRow?.previous_release_id != null
          )
        : (
            row.activation_sequence
              !== previousActivation.activation_sequence + 1
            || row.previous_activation_id
              !== previousActivation.activation_id
            || row.previous_active_release_id
              !== previousActivation.release_id
            || (
              row.mode === "activate"
              && releaseRow?.previous_release_id
                !== previousActivation.release_id
            )
            || (
              row.mode === "rollback"
              && (
                row.release_id === previousActivation.release_id
                || !releaseIsAncestor(
                  db,
                  rootScopeId,
                  row.release_id,
                  previousActivation.release_id,
                )
              )
            )
          )
      ) {
        issues.push({
          type: "release-activation-chain",
          activationId: row.activation_id,
        });
      }
      expectedEvents.push(rootEventExpectation({
        type: row.mode === "rollback"
          ? "knowledge-release.rolled-back"
          : "knowledge-release.activated",
        subjectType: "knowledge-release-activation",
        subjectId: row.activation_id,
        scopeId: rootScopeId,
        at: row.created_at,
        actor: row.created_by,
        grantPermission: "release",
        payload: {
          activationHash: row.activation_hash,
          eligibilityHash: row.eligibility_hash,
          mode: row.mode,
          previousActivationId: row.previous_activation_id,
          previousActiveReleaseId: row.previous_active_release_id,
          releaseHash: activation.releaseHash,
          releaseId: row.release_id,
          sequence: row.activation_sequence,
        },
      }));
      previousActivation = row;
    } catch {
      issues.push({
        type: "release-activation-payload",
        activationId: row.activation_id,
      });
    }
  }

  let previousEventHash = null;
  let ledgerHead = null;
  const events = [];
  let canonicalGrantEvidenceCount = 0;
  let legacyGrantEvidenceCount = 0;
  for (const row of db.prepare(`
    SELECT *
    FROM knowledge_events
    WHERE root_scope_id=?
    ORDER BY sequence
  `).all(rootScopeId)) {
    try {
      const event = eventFromRow(row);
      events.push(event);
      if (sha256Text(canonicalJson(event.payload)) !== event.payloadHash) {
        issues.push({ type: "event-payload-hash", eventId: event.id });
      }
      if (event.previousEventHash !== previousEventHash) {
        issues.push({ type: "event-chain-link", eventId: event.id });
      }
      if (
        contentHash(eventHashBody(event, row.grant_json)) !== event.eventHash
      ) {
        issues.push({ type: "event-hash", eventId: event.id });
      }
      try {
        const evidence = assertEventGrantEvidence(event, row.grant_json);
        if (evidence.kind === "legacy-columns") {
          legacyGrantEvidenceCount += 1;
        } else {
          canonicalGrantEvidenceCount += 1;
        }
      } catch (error) {
        for (
          const type of error?.knowledgeIssueTypes
            ?? [error?.knowledgeIssueType ?? "event-grant-attestation"]
        ) {
          issues.push({ type, eventId: event.id });
        }
      }
      if (event.type === FEEDBACK_CAPTURED_EVENT_TYPE) {
        try {
          projectFeedbackLedgerEntry(event);
          assertFeedbackTargetIsolation(db, event.payload, {
            requireCurrent: false,
          });
          // feedback-event@1 ainda não possui classificação própria. Como o
          // texto original é privado e arbitrário, o backup falha fechado no
          // maior nível até existir um envelope/classificação explícita.
          privateEventClassificationFloor = "restricted";
          expectedEvents.push(rootEventExpectation({
            type: FEEDBACK_CAPTURED_EVENT_TYPE,
            subjectType: FEEDBACK_SUBJECT_TYPE,
            subjectId: event.subjectId,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({ type: "feedback-event", eventId: event.id });
        }
      } else if (
        event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
      ) {
        try {
          const projected = projectFeedbackInterpretationLedgerEntry(event);
          assertFeedbackInterpretationIsolation(db, event.payload, {
            verifiedEvents: events,
            requireSuggestedScopeActive: false,
            candidateEventSequence: event.sequence,
          });
          const classification =
            projected.candidate.governance.classification;
          if (!(classification in CLASSIFICATION_RANK)) {
            throw new Error(
              "Candidato de interpretação possui classificação inválida.",
            );
          }
          if (
            privateEventClassificationFloor == null
            || CLASSIFICATION_RANK[classification]
              > CLASSIFICATION_RANK[privateEventClassificationFloor]
          ) {
            privateEventClassificationFloor = classification;
          }
          expectedEvents.push(rootEventExpectation({
            type: FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE,
            subjectType: FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
            subjectId: event.subjectId,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({
            type: "feedback-interpretation-candidate-event",
            eventId: event.id,
          });
        }
      } else if (
        event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
      ) {
        try {
          const projected = projectFeedbackPromotionDecisionLedgerEntry(event);
          const candidateEntries = events
            .filter((candidateEvent) =>
              candidateEvent.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
              && candidateEvent.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
            )
            .map((candidateEvent) =>
              projectFeedbackInterpretationLedgerEntry(candidateEvent));
          const decisionEntries = events
            .filter((decisionEvent) =>
              decisionEvent.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
              && decisionEvent.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
            )
            .map((decisionEvent) =>
              projectFeedbackPromotionDecisionLedgerEntry(decisionEvent));
          assertFeedbackPromotionDecisionIsolation(db, projected.decision, {
            verifiedEvents: events,
            candidateEntries,
            decisionEntries: decisionEntries.filter((entry) =>
              entry.eventId !== projected.eventId),
          });
          privateEventClassificationFloor = "restricted";
          expectedEvents.push(rootEventExpectation({
            type: FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE,
            subjectType: FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
            subjectId: event.subjectId,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({
            type: "feedback-promotion-decision-event",
            eventId: event.id,
          });
        }
      } else if (event.type === PRODUCTION_REQUEST_CREATED_EVENT_TYPE) {
        try {
          assertProductionRequest(event.payload);
          const classification = event.payload.governance.classification;
          if (
            privateEventClassificationFloor == null
            || CLASSIFICATION_RANK[classification]
              > CLASSIFICATION_RANK[privateEventClassificationFloor]
          ) {
            privateEventClassificationFloor = classification;
          }
          expectedEvents.push(rootEventExpectation({
            type: PRODUCTION_REQUEST_CREATED_EVENT_TYPE,
            subjectType: PRODUCTION_REQUEST_SUBJECT_TYPE,
            subjectId: event.subjectId,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({ type: "production-request-event", eventId: event.id });
        }
      } else if (event.type === PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE) {
        try {
          assertProductionRequestLifecycleEvent(event.payload);
          expectedEvents.push(rootEventExpectation({
            type: PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE,
            subjectType: PRODUCTION_REQUEST_SUBJECT_TYPE,
            subjectId: event.subjectId,
            subjectRevision: event.subjectRevision,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({
            type: "production-request-lifecycle-event",
            eventId: event.id,
          });
        }
      } else if (event.type === VIDEO_PREFERENCE_EVENT_TYPE) {
        try {
          assertVideoPreferenceEvent(event.payload);
          expectedEvents.push(rootEventExpectation({
            type: VIDEO_PREFERENCE_EVENT_TYPE,
            subjectType: VIDEO_PREFERENCE_SUBJECT_TYPE,
            subjectId: event.subjectId,
            subjectRevision: event.subjectRevision,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({ type: "video-preference-event", eventId: event.id });
        }
      } else if (event.type === VIDEO_REVIEW_EVENT_TYPE) {
        try {
          assertVideoReviewEvent(event.payload);
          expectedEvents.push(rootEventExpectation({
            type: VIDEO_REVIEW_EVENT_TYPE,
            subjectType: VIDEO_REVIEW_SUBJECT_TYPE,
            subjectId: event.subjectId,
            subjectRevision: event.subjectRevision,
            scopeId: event.scopeId,
            at: event.at,
            actor: event.actor,
            grantPermission: "write",
            payload: event.payload,
          }));
        } catch {
          issues.push({ type: "video-review-event", eventId: event.id });
        }
      }
      previousEventHash = event.eventHash;
      ledgerHead = event.eventHash;
    } catch {
      issues.push({ type: "event-payload", sequence: row.sequence });
    }
  }

  const expectedByKey = new Map();
  for (const expected of expectedEvents) {
    const key = eventSubjectKey(expected);
    const list = expectedByKey.get(key) ?? [];
    list.push(expected);
    expectedByKey.set(key, list);
  }
  const actualByKey = new Map();
  for (const event of events) {
    const key = eventSubjectKey(event);
    const list = actualByKey.get(key) ?? [];
    list.push(event);
    actualByKey.set(key, list);
  }
  for (const [key, expectedList] of expectedByKey) {
    const actualList = actualByKey.get(key) ?? [];
    if (expectedList.length !== 1) {
      issues.push({ type: "event-expectation-duplicate" });
      continue;
    }
    const expected = expectedList[0];
    if (actualList.length === 0) {
      issues.push({
        type: "event-missing",
        subjectType: expected.subjectType,
        subjectId: expected.subjectId,
        subjectRevision: expected.subjectRevision,
      });
      continue;
    }
    if (actualList.length > 1) {
      issues.push({
        type: "event-duplicate",
        subjectType: expected.subjectType,
        subjectId: expected.subjectId,
        subjectRevision: expected.subjectRevision,
      });
    }
    for (const actual of actualList) {
      if (
        actual.scopeId !== expected.scopeId
        || actual.at !== expected.at
        || actual.actor !== expected.actor
        || actual.grantPermission !== expected.grantPermission
        || canonicalJson(actual.payload) !== canonicalJson(expected.payload)
      ) {
        issues.push({
          type: "event-projection",
          eventId: actual.id,
        });
      }
    }
  }
  for (const [key, actualList] of actualByKey) {
    if (!expectedByKey.has(key)) {
      for (const actual of actualList) {
        issues.push({ type: "event-orphan", eventId: actual.id });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    ledgerHead,
    eventCount: events.length,
    canonicalGrantEvidenceCount,
    legacyGrantEvidenceCount,
    privateEventClassificationFloor,
    scopeCount: scopeRows.length,
    itemRevisionCount: itemRows.length,
    reviewDecisionCount: reviewDecisionRows.length,
    releaseCount: releaseRows.length,
    releaseActivationCount: activationRows.length,
  };
}

function aggregatePrivateIssues(issues) {
  const counts = new Map();
  for (const issue of issues) {
    counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([type, count]) => ({ type: `root-data:${type}`, count }));
}

function inspectStoreStructure(db) {
  const issues = [];
  const userVersion = pragmaInteger(db, "user_version");
  const migrationState = inspectMigrationState(db);
  issues.push(...migrationState.issues);
  const sqlite = db.prepare("PRAGMA integrity_check").all()
    .map((row) => String(Object.values(row)[0]));
  for (const result of sqlite) {
    if (result !== "ok") issues.push({ type: "sqlite", detail: result });
  }
  const foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all();
  const foreignKeyTables = [...new Set(
    foreignKeyRows.map((row) => String(row.table)),
  )].sort();
  if (foreignKeyRows.length > 0) {
    issues.push({
      type: "foreign-key",
      violationCount: foreignKeyRows.length,
      tables: foreignKeyTables,
    });
  }
  const schema = inspectSchemaDefinitions(db);
  issues.push(...schema.issues);
  const migrationView = MIGRATIONS.map((migration) => {
    const expectedHash = sha256Text(migrationSql(migration));
    const applied = migrationState.rows.find(
      (row) => row.version === migration.version,
    );
    return {
      version: migration.version,
      id: migration.id,
      hash: expectedHash,
      appliedAt: applied?.applied_at ?? null,
      valid: Boolean(
        applied
        && applied.migration_id === migration.id
        && applied.migration_hash === expectedHash,
      ),
    };
  });
  const missingTriggers = APPEND_ONLY_TRIGGERS.filter((trigger) => {
    const definition = schemaDefinitions(db).find(
      (entry) => entry.type === "trigger" && entry.name === trigger,
    );
    const expected = expectedSchemaDefinitions().find(
      (entry) => entry.type === "trigger" && entry.name === trigger,
    );
    return !definition || definition.sql !== expected?.sql;
  });
  return {
    initialized: migrationState.ok && schema.ok,
    ok: issues.length === 0,
    issues,
    userVersion,
    sqlite,
    foreignKeyRows,
    foreignKeyTables,
    migrations: migrationView,
    missingTriggers,
  };
}

function inspectGlobalDatabase(db) {
  const structure = inspectStoreStructure(db);
  const dataTablesAvailable = [
    "knowledge_events",
    "knowledge_items",
    "knowledge_release_activations",
    "knowledge_release_members",
    "knowledge_releases",
    "knowledge_review_decisions",
    "knowledge_scopes",
  ].every((tableName) => sqliteTableExists(db, tableName));
  if (!dataTablesAvailable) {
    return {
      ...structure,
      rootCount: 0,
      eventCount: 0,
      headsAggregateHash: null,
      grantEvidence: {
        canonicalEventCount: 0,
        legacyEventCount: 0,
      },
      classificationFloor: "internal",
    };
  }
  const roots = db.prepare(`
    SELECT root_scope_id FROM knowledge_scopes
    UNION SELECT root_scope_id FROM knowledge_items
    UNION SELECT root_scope_id FROM knowledge_releases
    UNION SELECT root_scope_id FROM knowledge_release_activations
    UNION SELECT root_scope_id FROM knowledge_review_decisions
    UNION SELECT root_scope_id FROM knowledge_events
    ORDER BY root_scope_id
  `).all().map((row) => row.root_scope_id);
  const privateIssues = [];
  const heads = [];
  const privateEventClassificationFloors = [];
  let eventCount = 0;
  let canonicalGrantEvidenceCount = 0;
  let legacyGrantEvidenceCount = 0;
  for (const rootScopeId of roots) {
    const rootReport = inspectRootData(db, rootScopeId);
    privateIssues.push(...rootReport.issues);
    eventCount += rootReport.eventCount;
    canonicalGrantEvidenceCount += rootReport.canonicalGrantEvidenceCount;
    legacyGrantEvidenceCount += rootReport.legacyGrantEvidenceCount;
    if (rootReport.ledgerHead) heads.push(rootReport.ledgerHead);
    if (rootReport.privateEventClassificationFloor != null) {
      privateEventClassificationFloors.push(
        rootReport.privateEventClassificationFloor,
      );
    }
  }
  const issues = [
    ...structure.issues,
    ...aggregatePrivateIssues(privateIssues),
  ];
  const itemClassificationFloor = db.prepare(`
    SELECT classification
    FROM knowledge_items
    ORDER BY CASE classification
      WHEN 'restricted' THEN 3
      WHEN 'confidential' THEN 2
      WHEN 'internal' THEN 1
      ELSE 0
    END DESC
    LIMIT 1
  `).get()?.classification ?? "internal";
  const observedClassificationFloors = [
    itemClassificationFloor,
    ...privateEventClassificationFloors,
  ];
  const invalidClassificationFloor = observedClassificationFloors.some(
    (classification) => !(classification in CLASSIFICATION_RANK),
  );
  if (invalidClassificationFloor) {
    issues.push({ type: "classification-floor" });
  }
  const classificationFloor = invalidClassificationFloor
    ? "restricted"
    : observedClassificationFloors.reduce((highest, classification) =>
        CLASSIFICATION_RANK[classification] > CLASSIFICATION_RANK[highest]
          ? classification
          : highest
    );
  return {
    ...structure,
    ok: structure.initialized && issues.length === 0,
    issues,
    rootCount: roots.length,
    eventCount,
    headsAggregateHash: heads.length === 0
      ? null
      : contentHash(heads.sort()),
    grantEvidence: {
      canonicalEventCount: canonicalGrantEvidenceCount,
      legacyEventCount: legacyGrantEvidenceCount,
    },
    classificationFloor,
  };
}

function assertStoreStructure(db) {
  const report = inspectStoreStructure(db);
  if (!report.ok) {
    throw new Error(
      "Knowledge Store falhou na validação estrutural fail-closed.",
    );
  }
  return report;
}

function assertGloballyHealthy(db) {
  const report = inspectGlobalDatabase(db);
  if (!report.ok) {
    throw new Error("Knowledge Store falhou na verificação global de integridade.");
  }
  return report;
}

function searchKnowledgeItemsWithFts({ items, terms, limit }) {
  const db = new DatabaseSync(":memory:");
  db.enableDefensive(true);
  db.exec(`
    CREATE VIRTUAL TABLE retrieval_documents USING fts5(
      item_id UNINDEXED,
      revision UNINDEXED,
      scope_id UNINDEXED,
      record_type UNINDEXED,
      schema_id UNINDEXED,
      text,
      tokenize='unicode61'
    )
  `);
  const insert = db.prepare(`
    INSERT INTO retrieval_documents(
      item_id,revision,scope_id,record_type,schema_id,text
    ) VALUES (?,?,?,?,?,?)
  `);
  for (const item of items) {
    const text = [
      item.id,
      item.scopeId,
      item.recordType,
      item.schemaId,
      item.governance?.modality,
      item.governance?.owner?.type,
      item.governance?.owner?.id,
      canonicalJson(item.payload),
    ].filter(Boolean).join(" ");
    insert.run(
      item.id,
      item.revision,
      item.scopeId,
      item.recordType,
      item.schemaId,
      text,
    );
  }
  const match = terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" AND ");
  try {
    return db.prepare(`
      SELECT item_id,revision,scope_id,record_type,schema_id,
             bm25(retrieval_documents) AS bm25
      FROM retrieval_documents
      WHERE retrieval_documents MATCH ?
      ORDER BY bm25 ASC,item_id ASC,revision ASC
      LIMIT ?
    `).all(match, limit);
  } finally {
    db.close();
  }
}

class KnowledgeStoreRepository {
  #dbFile;
  #coreRoot;
  #clock;

  constructor({ dbFile, coreRoot, clock }) {
    this.#dbFile = dbFile;
    this.#coreRoot = coreRoot;
    this.#clock = clock;
  }

  get dbFile() {
    return this.#dbFile;
  }

  #now() {
    const value = this.#clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new Error("O clock do Knowledge Store retornou data inválida.");
    }
    return date;
  }

  #withWriteDb(work) {
    const dbFile = resolveKnowledgeStorePath({
      dbFile: this.#dbFile,
      coreRoot: this.#coreRoot,
    });
    const db = openExistingWriteDatabase(dbFile);
    try {
      assertGloballyHealthy(db);
      return work(db);
    } finally {
      db.close();
    }
  }

  #withReadDb(work, { requireStructure = true } = {}) {
    const dbFile = resolveKnowledgeStorePath({
      dbFile: this.#dbFile,
      coreRoot: this.#coreRoot,
    });
    const db = openReadOnlyDatabase(dbFile);
    try {
      return withReadSnapshot(db, () => {
        if (requireStructure) assertStoreStructure(db);
        return work(db);
      });
    } finally {
      db.close();
    }
  }

  #assertGrant(grant, rootScopeId, permission) {
    return assertScopeGrant(grant, {
      rootScopeId,
      permission,
      now: this.#now(),
    });
  }

  #appendReleaseActivation({
    grant,
    rootScopeId,
    releaseId,
    expectedReleaseHash,
    expectedCurrentActivationId,
    mode,
    reason,
    createdAt,
    createdBy,
  }) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedRelease = identifier(releaseId, "releaseId");
    this.#assertGrant(grant, normalizedRoot, "release");
    const normalizedReleaseHash = requiredText(
      expectedReleaseHash,
      "expectedReleaseHash",
      64,
    );
    if (!SHA256_PATTERN.test(normalizedReleaseHash)) {
      throw new Error("expectedReleaseHash deve ser SHA-256.");
    }
    if (expectedCurrentActivationId === undefined) {
      throw new Error(
        "expectedCurrentActivationId é obrigatório; use null somente na primeira ativação.",
      );
    }
    const normalizedExpectedActivation =
      expectedCurrentActivationId == null
        ? null
        : identifier(
            expectedCurrentActivationId,
            "expectedCurrentActivationId",
          );
    const normalizedMode = requiredText(mode, "mode", 20);
    if (!["activate", "rollback"].includes(normalizedMode)) {
      throw new Error("mode deve ser activate ou rollback.");
    }
    const normalizedAt = assertTimestampWithinGrant(
      createdAt ?? this.#now(),
      grant,
      "createdAt",
    );
    const normalizedBy = authorizedActor(createdBy, grant, "createdBy");
    const normalizedReason = requiredText(reason, "reason", 1000);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const target = releaseFromRow(db.prepare(`
        SELECT *
        FROM knowledge_releases
        WHERE root_scope_id=? AND release_id=?
      `).get(normalizedRoot, normalizedRelease));
      if (!target) {
        throw new Error(`Release inexistente: ${normalizedRelease}.`);
      }
      if (target.hash !== normalizedReleaseHash) {
        throw new Error("expectedReleaseHash diverge da release alvo.");
      }
      const currentRow = db.prepare(`
        SELECT *
        FROM knowledge_release_activations
        WHERE root_scope_id=?
        ORDER BY activation_sequence DESC
        LIMIT 1
      `).get(normalizedRoot);
      const currentId = currentRow?.activation_id ?? null;
      if (currentId !== normalizedExpectedActivation) {
        throw new Error(
          "Ativação corrente diverge de expectedCurrentActivationId.",
        );
      }
      if (currentRow == null) {
        if (normalizedMode !== "activate") {
          throw new Error("Rollback exige uma release ativa anterior.");
        }
        if (target.previousReleaseId != null) {
          throw new Error(
            "Primeira ativação exige uma release raiz sem predecessor.",
          );
        }
      } else if (normalizedMode === "activate") {
        if (
          target.id === currentRow.release_id
          || target.previousReleaseId !== currentRow.release_id
        ) {
          throw new Error(
            "Ativação forward exige descendente direto da release ativa.",
          );
        }
      } else if (
        target.id === currentRow.release_id
        || !releaseIsAncestor(
          db,
          normalizedRoot,
          target.id,
          currentRow.release_id,
        )
      ) {
        throw new Error(
          "Rollback exige uma release ancestral da release ativa.",
        );
      }
      const eligibility = releaseEligibilitySnapshot(
        db,
        target,
        normalizedAt,
      );
      const sequence = Number(currentRow?.activation_sequence ?? 0) + 1;
      const identity = {
        schema: KNOWLEDGE_RELEASE_ACTIVATION_SCHEMA,
        rootScopeId: normalizedRoot,
        sequence,
        mode: normalizedMode,
        releaseId: target.id,
        releaseHash: target.hash,
        previousActivationId: currentId,
        previousActiveReleaseId: currentRow?.release_id ?? null,
        reason: normalizedReason,
        eligibilityHash: eligibility.hash,
        createdAt: normalizedAt,
        createdBy: normalizedBy,
      };
      const id = `kra_${contentHash(identity, {
        maxBytes: MAX_AGGREGATE_JSON_BYTES,
      }).slice(0, 32)}`;
      const body = {
        schema: KNOWLEDGE_RELEASE_ACTIVATION_SCHEMA,
        id,
        rootScopeId: normalizedRoot,
        sequence,
        mode: normalizedMode,
        releaseId: target.id,
        releaseHash: target.hash,
        previousActivationId: currentId,
        previousActiveReleaseId: currentRow?.release_id ?? null,
        reason: normalizedReason,
        eligibilityHash: eligibility.hash,
        createdAt: normalizedAt,
        createdBy: normalizedBy,
      };
      const bodyJson = canonicalJson(body);
      const hash = sha256Text(bodyJson);
      db.prepare(`
        INSERT INTO knowledge_release_activations(
          root_scope_id,activation_sequence,activation_id,release_id,
          previous_activation_id,previous_active_release_id,mode,reason,
          eligibility_hash,body_json,activation_hash,created_at,created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        normalizedRoot,
        sequence,
        id,
        target.id,
        currentId,
        currentRow?.release_id ?? null,
        normalizedMode,
        normalizedReason,
        eligibility.hash,
        bodyJson,
        hash,
        normalizedAt,
        normalizedBy,
      );
      appendEvent(db, {
        rootScopeId: normalizedRoot,
        scopeId: normalizedRoot,
        type: normalizedMode === "rollback"
          ? "knowledge-release.rolled-back"
          : "knowledge-release.activated",
        subjectType: "knowledge-release-activation",
        subjectId: id,
        grant,
        grantPermission: "release",
        payload: {
          activationHash: hash,
          eligibilityHash: eligibility.hash,
          mode: normalizedMode,
          previousActivationId: currentId,
          previousActiveReleaseId: currentRow?.release_id ?? null,
          releaseHash: target.hash,
          releaseId: target.id,
          sequence,
        },
        at: normalizedAt,
      });
      return assertKnowledgeContract({
        ...body,
        hash,
      }, {
        schemaId: KNOWLEDGE_RELEASE_ACTIVATION_SCHEMA,
        label: "Knowledge release activation",
      });
    }));
  }

  createScope({ grant, scope } = {}) {
    const scopeId = identifier(scope?.id, "scope.id");
    const rootScopeId = identifier(scope?.rootScopeId, "scope.rootScopeId");
    this.#assertGrant(grant, rootScopeId, "write");
    const parentScopeId = scope?.parentScopeId == null
      ? null
      : identifier(scope.parentScopeId, "scope.parentScopeId");
    const kind = requiredText(scope?.kind, "scope.kind", 40);
    if (!SCOPE_KINDS.has(kind)) throw new Error(`Tipo de scope inválido: ${kind}.`);
    const createdAt = assertTimestampWithinGrant(
      scope?.createdAt ?? this.#now(),
      grant,
      "scope.createdAt",
    );
    const createdBy = authorizedActor(scope?.createdBy, grant, "scope.createdBy");
    const status = scope?.status == null ? "active" : requiredText(scope.status, "scope.status", 20);
    if (!["active", "inactive"].includes(status)) {
      throw new Error(`Status de scope inválido: ${status}.`);
    }
    if (parentScopeId == null && scopeId !== rootScopeId) {
      throw new Error("Scope raiz deve possuir id igual a rootScopeId.");
    }
    if (parentScopeId != null && scopeId === rootScopeId) {
      throw new Error("Scope raiz não pode possuir parentScopeId.");
    }
    const body = {
      schema: KNOWLEDGE_SCOPE_SCHEMA,
      id: scopeId,
      rootScopeId,
      parentScopeId,
      kind,
      name: requiredText(scope?.name, "scope.name", 240),
      status,
      attributes: normalizeJson(scope?.attributes ?? {}),
      createdAt,
      createdBy,
    };
    const bodyJson = canonicalJson(body);
    const hash = sha256Text(bodyJson);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      if (parentScopeId == null) {
        const existingRoot = db.prepare(
          `SELECT 1
           FROM knowledge_scopes
           WHERE root_scope_id=? AND scope_id=?`,
        ).get(rootScopeId, rootScopeId);
        if (existingRoot) throw new Error(`Scope já existe: ${scopeId}.`);
      } else {
        assertRootScopeExists(db, rootScopeId);
        const parent = db.prepare(`
          SELECT 1
          FROM knowledge_scopes
          WHERE root_scope_id=? AND scope_id=?
        `).get(rootScopeId, parentScopeId);
        if (!parent) {
          throw new Error(
            `Parent scope ${parentScopeId} não pertence a ${rootScopeId}.`,
          );
        }
      }
      db.prepare(`
        INSERT INTO knowledge_scopes(
          scope_id,root_scope_id,parent_scope_id,kind,name,status,body_json,
          content_hash,created_at,created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        scopeId,
        rootScopeId,
        parentScopeId,
        kind,
        body.name,
        status,
        bodyJson,
        hash,
        createdAt,
        createdBy,
      );
      appendEvent(db, {
        rootScopeId,
        scopeId,
        type: "scope.created",
        subjectType: "scope",
        subjectId: scopeId,
        grant,
        grantPermission: "write",
        payload: { contentHash: hash, kind, parentScopeId },
        at: createdAt,
      });
      return assertKnowledgeContract({
        ...body,
        contentHash: hash,
      }, {
        schemaId: KNOWLEDGE_SCOPE_SCHEMA,
        label: "Knowledge scope",
      });
    }));
  }

  getScope({ grant, rootScopeId, scopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedScope = identifier(scopeId, "scopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => scopeFromRow(db.prepare(`
      SELECT *
      FROM knowledge_scopes
      WHERE root_scope_id=? AND scope_id=?
    `).get(normalizedRoot, normalizedScope)));
  }

  listScopes({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => db.prepare(`
      SELECT *
      FROM knowledge_scopes
      WHERE root_scope_id=?
      ORDER BY scope_id
    `).all(normalizedRoot).map(scopeFromRow));
  }

  captureFeedbackEvent({ grant, feedback: feedbackValue } = {}) {
    const feedback = assertFeedbackEvent(feedbackValue);
    const rootScopeId = identifier(
      feedback.rootScopeId,
      "feedback.rootScopeId",
    );
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "feedback.recordedAt",
    );
    if (Date.parse(feedback.capturedAt) > Date.parse(recordedAt)) {
      throw new Error("feedback.capturedAt não pode estar no futuro.");
    }
    const subjectId = feedbackSubjectId(feedback);
    const expectedPayloadHash = feedbackEventHash(feedback);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      readVerifiedRootEventLedger(db, rootScopeId);
      assertFeedbackTargetIsolation(db, feedback, {
        requireCurrent: true,
        evaluatedAt: recordedAt,
      });
      const duplicate = db.prepare(`
        SELECT event_id
        FROM knowledge_events
        WHERE root_scope_id=?
          AND event_type=?
          AND subject_type=?
          AND subject_id=?
        LIMIT 1
      `).get(
        rootScopeId,
        FEEDBACK_CAPTURED_EVENT_TYPE,
        FEEDBACK_SUBJECT_TYPE,
        subjectId,
      );
      if (duplicate) {
        throw new Error("Feedback idêntico já foi capturado neste root.");
      }
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId: feedback.scopeId,
        type: FEEDBACK_CAPTURED_EVENT_TYPE,
        subjectType: FEEDBACK_SUBJECT_TYPE,
        subjectId,
        grant,
        grantPermission: "write",
        payload: feedback,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error("Hash do feedback divergiu durante a captura.");
      }
      const persisted = eventFromRow(db.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE event_id=?
      `).get(appended.id));
      readVerifiedRootEventLedger(db, rootScopeId);
      return projectFeedbackLedgerEntry(persisted);
    }));
  }

  listFeedbackEvents({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) =>
      readVerifiedRootEventLedger(db, normalizedRoot)
        .filter((event) =>
          event.type === FEEDBACK_CAPTURED_EVENT_TYPE
          && event.subjectType === FEEDBACK_SUBJECT_TYPE)
        .map((event) => {
      assertFeedbackTargetIsolation(db, event.payload, {
        requireCurrent: false,
      });
      return projectFeedbackLedgerEntry(event);
        }));
  }

  replayFeedbackEvents({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const entries = this.listFeedbackEvents({
      grant,
      rootScopeId: normalizedRoot,
    });
    return {
      rootScopeId: normalizedRoot,
      eventCount: entries.length,
      entries,
      aggregateHash: feedbackEntriesAggregateHash(
        normalizedRoot,
        entries,
      ),
    };
  }

  createProductionRequest({ grant, request: requestValue } = {}) {
    const request = assertProductionRequest(requestValue);
    const rootScopeId = identifier(request.rootScopeId, "request.rootScopeId");
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "productionRequest.recordedAt",
    );
    if (Date.parse(request.requestedAt) > Date.parse(recordedAt)) {
      throw new Error("productionRequest.requestedAt não pode estar no futuro.");
    }
    const subjectId = request.requestId;
    const expectedPayloadHash = productionRequestHash(request);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      readVerifiedRootEventLedger(db, rootScopeId);
      const duplicateId = db.prepare(`
        SELECT event_id
        FROM knowledge_events
        WHERE root_scope_id=?
          AND event_type=?
          AND subject_type=?
          AND subject_id=?
        LIMIT 1
      `).get(rootScopeId, PRODUCTION_REQUEST_CREATED_EVENT_TYPE, PRODUCTION_REQUEST_SUBJECT_TYPE, subjectId);
      if (duplicateId) {
        throw new Error("requestId já foi usado neste root.");
      }
      const duplicateIdempotencyKey = db.prepare(`
        SELECT event_id
        FROM knowledge_events
        WHERE root_scope_id=?
          AND event_type=?
          AND subject_type=?
          AND json_extract(payload_json, '$.idempotencyKey')=?
        LIMIT 1
      `).get(rootScopeId, PRODUCTION_REQUEST_CREATED_EVENT_TYPE, PRODUCTION_REQUEST_SUBJECT_TYPE, request.idempotencyKey);
      if (duplicateIdempotencyKey) {
        throw new Error("Pedido idêntico (chave idempotente) já existe neste root.");
      }
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId: request.scopeId,
        type: PRODUCTION_REQUEST_CREATED_EVENT_TYPE,
        subjectType: PRODUCTION_REQUEST_SUBJECT_TYPE,
        subjectId,
        grant,
        grantPermission: "write",
        payload: request,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error("Hash do pedido divergiu durante a captura.");
      }
      readVerifiedRootEventLedger(db, rootScopeId);
      return projectProductionRequestState({ request, lifecycleEvents: [] });
    }));
  }

  #readProductionRequestStream(db, rootScopeId, requestId) {
    const events = readVerifiedRootEventLedger(db, rootScopeId).filter(
      (event) => event.subjectType === PRODUCTION_REQUEST_SUBJECT_TYPE
        && event.subjectId === requestId,
    );
    const createdEvent = events.find(
      (event) => event.type === PRODUCTION_REQUEST_CREATED_EVENT_TYPE,
    );
    if (!createdEvent) throw new Error(`Pedido de produção inexistente: ${requestId}.`);
    const lifecycleEvents = events
      .filter((event) => event.type === PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE)
      .map((event) => event.payload);
    return { request: createdEvent.payload, lifecycleEvents };
  }

  appendProductionRequestLifecycleEvent({ grant, event: eventValue } = {}) {
    const event = createProductionRequestLifecycleEvent(eventValue);
    const rootScopeId = identifier(event.rootScopeId, "event.rootScopeId");
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "productionRequestLifecycleEvent.recordedAt",
    );
    if (Date.parse(event.at) > Date.parse(recordedAt)) {
      throw new Error("productionRequestLifecycleEvent.at não pode estar no futuro.");
    }
    const expectedPayloadHash = productionRequestLifecycleEventHash(event);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const { request, lifecycleEvents } = this.#readProductionRequestStream(
        db,
        rootScopeId,
        event.requestId,
      );
      const before = projectProductionRequestState({ request, lifecycleEvents });
      const allowed = PRODUCTION_REQUEST_TRANSITIONS[before.status] ?? [];
      if (!allowed.includes(event.kind)) {
        throw new Error(`Transição inválida: ${before.status} -> ${event.kind}.`);
      }
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId: request.scopeId,
        type: PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE,
        subjectType: PRODUCTION_REQUEST_SUBJECT_TYPE,
        subjectId: event.requestId,
        // Cada evento de ciclo de vida reusa o mesmo subjectId do pedido (para
        // WHERE subject_id=? trazer o stream inteiro), então precisa de um
        // subjectRevision distinto: a chave de unicidade do health-check é
        // (type, subjectType, subjectId, subjectRevision) e três lifecycle
        // events colidiriam sob revision nula.
        subjectRevision: lifecycleEvents.length + 1,
        grant,
        grantPermission: "write",
        payload: event,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error("Hash do evento de ciclo de vida divergiu durante a captura.");
      }
      return projectProductionRequestState({
        request,
        lifecycleEvents: [...lifecycleEvents, event],
      });
    }));
  }

  getProductionRequest({ grant, rootScopeId, requestId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedRequestId = identifier(requestId, "requestId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const { request, lifecycleEvents } = this.#readProductionRequestStream(
        db,
        normalizedRoot,
        normalizedRequestId,
      );
      return projectProductionRequestState({ request, lifecycleEvents });
    });
  }

  listProductionRequests({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const events = readVerifiedRootEventLedger(db, normalizedRoot).filter(
        (event) => event.subjectType === PRODUCTION_REQUEST_SUBJECT_TYPE,
      );
      const requestIds = [...new Set(
        events
          .filter((event) => event.type === PRODUCTION_REQUEST_CREATED_EVENT_TYPE)
          .map((event) => event.subjectId),
      )];
      return requestIds.map((requestId) => {
        const createdEvent = events.find(
          (event) => event.type === PRODUCTION_REQUEST_CREATED_EVENT_TYPE
            && event.subjectId === requestId,
        );
        const lifecycleEvents = events
          .filter((event) => event.type === PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE
            && event.subjectId === requestId)
          .map((event) => event.payload);
        return projectProductionRequestState({
          request: createdEvent.payload,
          lifecycleEvents,
        });
      });
    });
  }

  #appendVideoDecisionEvent({
    grant,
    rootScopeId,
    scopeId,
    type,
    subjectType,
    targetHash,
    payload,
    at,
  }) {
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(this.#now(), grant, `${subjectType}.recordedAt`);
    if (Date.parse(at) > Date.parse(recordedAt)) {
      throw new Error(`${subjectType}.at não pode estar no futuro.`);
    }
    const expectedPayloadHash = videoDecisionEventHash(payload);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const priorEvents = readVerifiedRootEventLedger(db, rootScopeId).filter(
        (event) => event.type === type
          && event.subjectType === subjectType
          && event.subjectId === targetHash,
      );
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId,
        type,
        subjectType,
        subjectId: targetHash,
        // Curtir/descurtir e reavaliar reusam o mesmo targetHash (identidade
        // do artefato) para todo o stream — cada evento novo precisa de
        // subjectRevision incremental, senão colide na chave de unicidade
        // (type,subjectType,subjectId,subjectRevision) do health-check.
        subjectRevision: priorEvents.length + 1,
        grant,
        grantPermission: "write",
        payload,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error(`Hash de ${subjectType} divergiu durante a captura.`);
      }
      return [...priorEvents.map((event) => event.payload), payload];
    }));
  }

  /** "Um cliente nunca recebe like de outro root": rootScopeId é sempre exigido
   * e o ScopeGrant do appendEvent já falha fechado para qualquer outro root. */
  recordVideoPreference({ grant, event: eventValue } = {}) {
    const event = createVideoPreferenceEvent(eventValue);
    const history = this.#appendVideoDecisionEvent({
      grant,
      rootScopeId: event.rootScopeId,
      scopeId: event.scopeId,
      type: VIDEO_PREFERENCE_EVENT_TYPE,
      subjectType: VIDEO_PREFERENCE_SUBJECT_TYPE,
      targetHash: event.targetHash,
      payload: event,
      at: event.at,
    });
    return projectVideoPreferenceState({ targetHash: event.targetHash, events: history });
  }

  recordVideoReview({ grant, event: eventValue } = {}) {
    const event = createVideoReviewEvent(eventValue);
    const history = this.#appendVideoDecisionEvent({
      grant,
      rootScopeId: event.rootScopeId,
      scopeId: event.scopeId,
      type: VIDEO_REVIEW_EVENT_TYPE,
      subjectType: VIDEO_REVIEW_SUBJECT_TYPE,
      targetHash: event.targetHash,
      payload: event,
      at: event.at,
    });
    return projectVideoReviewState({ targetHash: event.targetHash, events: history });
  }

  #readVideoDecisionEvents({ grant, rootScopeId, type, subjectType, targetHash }) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => readVerifiedRootEventLedger(db, normalizedRoot)
      .filter((event) => event.type === type
        && event.subjectType === subjectType
        && event.subjectId === targetHash)
      .map((event) => event.payload));
  }

  getVideoPreferenceState({ grant, rootScopeId, targetHash } = {}) {
    const events = this.#readVideoDecisionEvents({
      grant, rootScopeId, type: VIDEO_PREFERENCE_EVENT_TYPE, subjectType: VIDEO_PREFERENCE_SUBJECT_TYPE, targetHash,
    });
    return projectVideoPreferenceState({ targetHash, events });
  }

  getVideoReviewState({ grant, rootScopeId, targetHash } = {}) {
    const events = this.#readVideoDecisionEvents({
      grant, rootScopeId, type: VIDEO_REVIEW_EVENT_TYPE, subjectType: VIDEO_REVIEW_SUBJECT_TYPE, targetHash,
    });
    return projectVideoReviewState({ targetHash, events });
  }

  replayVideoPreferenceEvents({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    const entries = this.#withReadDb((db) => readVerifiedRootEventLedger(db, normalizedRoot)
      .filter((event) => event.type === VIDEO_PREFERENCE_EVENT_TYPE)
      .map((event) => event.payload));
    return {
      rootScopeId: normalizedRoot,
      eventCount: entries.length,
      entries,
      aggregateHash: videoDecisionReplayHash(normalizedRoot, entries),
    };
  }

  createFeedbackInterpretationCandidate({
    grant,
    candidate: candidateValue,
  } = {}) {
    const candidate = assertFeedbackInterpretationCandidate(candidateValue);
    const rootScopeId = identifier(
      candidate.rootScopeId,
      "candidate.rootScopeId",
    );
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "feedbackInterpretation.recordedAt",
    );
    if (
      Date.parse(candidate.interpretation.interpretedAt)
        > Date.parse(recordedAt)
    ) {
      throw new Error(
        "candidate.interpretation.interpretedAt não pode estar no futuro.",
      );
    }
    const subjectId = feedbackInterpretationSubjectId(candidate);
    const expectedPayloadHash =
      feedbackInterpretationCandidateHash(candidate);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const verifiedEvents = readVerifiedRootEventLedger(db, rootScopeId);
      assertFeedbackInterpretationIsolation(db, candidate, {
        verifiedEvents,
        requireSuggestedScopeActive: true,
      });
      const duplicate = db.prepare(`
        SELECT event_id
        FROM knowledge_events
        WHERE root_scope_id=?
          AND event_type=?
          AND subject_type=?
          AND subject_id=?
        LIMIT 1
      `).get(
        rootScopeId,
        FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE,
        FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
        subjectId,
      );
      if (duplicate) {
        throw new Error(
          "Feedback já possui candidato de interpretação; supersessão ainda não está habilitada.",
        );
      }
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId: candidate.sourceScopeId,
        type: FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE,
        subjectType: FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
        subjectId,
        grant,
        grantPermission: "write",
        payload: candidate,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error(
          "Hash do candidato de interpretação divergiu durante a criação.",
        );
      }
      const persisted = eventFromRow(db.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE event_id=?
      `).get(appended.id));
      const verifiedAfterAppend = readVerifiedRootEventLedger(
        db,
        rootScopeId,
      );
      assertFeedbackInterpretationIsolation(db, persisted.payload, {
        verifiedEvents: verifiedAfterAppend,
        requireSuggestedScopeActive: true,
        candidateEventSequence: persisted.sequence,
      });
      return projectFeedbackInterpretationLedgerEntry(persisted);
    }));
  }

  listFeedbackInterpretationCandidates({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const verifiedEvents = readVerifiedRootEventLedger(db, normalizedRoot);
      return verifiedEvents
        .filter((event) =>
          event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
          && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE)
        .map((event) => {
          assertFeedbackInterpretationIsolation(db, event.payload, {
            verifiedEvents,
            requireSuggestedScopeActive: false,
            candidateEventSequence: event.sequence,
          });
          return projectFeedbackInterpretationLedgerEntry(event);
        });
    });
  }

  replayFeedbackInterpretationCandidates({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const entries = this.listFeedbackInterpretationCandidates({
      grant,
      rootScopeId: normalizedRoot,
    });
    return {
      rootScopeId: normalizedRoot,
      eventCount: entries.length,
      entries,
      aggregateHash: feedbackInterpretationEntriesAggregateHash(
        normalizedRoot,
        entries,
      ),
    };
  }

  listFeedbackPromotionDecisions({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const events = readVerifiedRootEventLedger(db, normalizedRoot);
      return events
        .filter((event) =>
          event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
          && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        )
        .map((event) => {
          const projected = projectFeedbackPromotionDecisionLedgerEntry(event);
          assertFeedbackPromotionDecisionIsolation(db, projected.decision, {
            verifiedEvents: events,
            decisionEntries: events
              .filter((candidateEvent) =>
                candidateEvent.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
                && candidateEvent.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
              )
              .map(projectFeedbackPromotionDecisionLedgerEntry),
            currentDecisionSequence: projected.sequence,
          });
          return projected;
        });
    });
  }

  listFeedbackPromotionQueue({
    grant,
    rootScopeId,
    scopeId = null,
    asOf = null,
    limit = 5,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    const normalizedScope = scopeId == null
      ? null
      : identifier(scopeId, "scopeId");
    const normalizedAt = assertTimestampWithinGrant(
      asOf ?? this.#now(),
      grant,
      "feedbackPromotionQueue.asOf",
    );
    return this.#withReadDb((db) => {
      const events = readVerifiedRootEventLedger(db, normalizedRoot);
      const candidates = events
        .filter((event) =>
          event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
          && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
        )
        .map((event) => {
          const projected = projectFeedbackInterpretationLedgerEntry(event);
          assertFeedbackInterpretationIsolation(db, projected.candidate, {
            verifiedEvents: events,
            requireSuggestedScopeActive: false,
            candidateEventSequence: event.sequence,
          });
          return projected;
        });
      const decisions = events
        .filter((event) =>
          event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
          && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        )
        .map((event) => projectFeedbackPromotionDecisionLedgerEntry(event));
      const entries = buildFeedbackPromotionQueue({
        rootScopeId: normalizedRoot,
        candidates,
        decisions,
        asOf: normalizedAt,
        scopeId: normalizedScope,
        limit,
      });
      return {
        rootScopeId: normalizedRoot,
        asOf: normalizedAt,
        scopeId: normalizedScope,
        limit: Number(limit),
        queueCount: entries.length,
        entries,
        queueHash: feedbackPromotionQueueHash(
          normalizedRoot,
          {
            asOf: normalizedAt,
            scopeId: normalizedScope,
            limit: Number(limit),
          },
          entries,
        ),
      };
    });
  }

  recordFeedbackPromotionDecision({
    grant,
    decision: decisionValue,
  } = {}) {
    const decision = assertFeedbackPromotionDecision(decisionValue);
    const rootScopeId = identifier(decision.rootScopeId, "decision.rootScopeId");
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const recordedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "feedbackPromotionDecision.recordedAt",
    );
    if (Date.parse(decision.decidedAt) > Date.parse(recordedAt)) {
      throw new Error("decision.decidedAt não pode estar no futuro.");
    }
    if (decision.reviewedBy !== grant.actor) {
      throw new Error(
        "decision.reviewedBy deve coincidir com o actor autenticado do ScopeGrant.",
      );
    }
    const expectedPayloadHash = feedbackEventHash(decision);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const verifiedEvents = readVerifiedRootEventLedger(db, rootScopeId);
      const candidateEntries = verifiedEvents
        .filter((event) =>
          event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
          && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE,
        )
        .map((event) => projectFeedbackInterpretationLedgerEntry(event));
      const decisionEntries = verifiedEvents
        .filter((event) =>
          event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
          && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        )
        .map((event) => projectFeedbackPromotionDecisionLedgerEntry(event));
      assertFeedbackPromotionDecisionIsolation(db, decision, {
        verifiedEvents,
        candidateEntries,
        decisionEntries,
      });
      const duplicate = db.prepare(`
        SELECT event_id
        FROM knowledge_events
        WHERE root_scope_id=?
          AND event_type=?
          AND subject_type=?
          AND subject_id=?
        LIMIT 1
      `).get(
        rootScopeId,
        FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE,
        FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        decision.decisionId,
      );
      if (duplicate) {
        throw new Error("Decisão da fila já foi registrada neste root.");
      }
      const appended = appendEvent(db, {
        rootScopeId,
        scopeId: decision.scopeDecision.scopeId,
        type: FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE,
        subjectType: FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        subjectId: decision.decisionId,
        grant,
        grantPermission: "write",
        payload: decision,
        at: recordedAt,
      });
      if (appended.payloadHash !== expectedPayloadHash) {
        throw new Error(
          "Hash da decisão da fila divergiu durante o registro.",
        );
      }
      const persisted = eventFromRow(db.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE event_id=?
      `).get(appended.id));
      const verifiedAfterAppend = readVerifiedRootEventLedger(db, rootScopeId);
      const projected = projectFeedbackPromotionDecisionLedgerEntry(
        persisted,
      );
      if (!verifiedAfterAppend.some((event) => event.id === persisted.id)) {
        throw new Error("Decisão registrada não reaparece no ledger verificado.");
      }
      return projected;
    }));
  }

  canonicalizeFeedbackPromotion({
    grant,
    request: requestValue,
  } = {}) {
    const request = assertFeedbackCanonicalizationRequest(requestValue);
    const rootScopeId = identifier(request.rootScopeId, "request.rootScopeId");
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    const canonicalizedAt = assertTimestampWithinGrant(
      this.#now(),
      grant,
      "feedbackCanonicalization.canonicalizedAt",
    );
    if (Date.parse(request.requestedAt) > Date.parse(canonicalizedAt)) {
      throw new Error("request.requestedAt não pode estar no futuro.");
    }
    if (request.requestedBy !== grant.actor) {
      throw new Error(
        "request.requestedBy deve coincidir com o actor autenticado do ScopeGrant.",
      );
    }
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const events = readVerifiedRootEventLedger(db, rootScopeId);
      const decisionEvent = events.find((event) =>
        event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
        && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE
        && event.id === request.decisionEventId
        && event.subjectId === request.decisionId,
      );
      if (!decisionEvent) {
        throw new Error(
          "Pedido de canonicalização não resolve o evento de decisão exato.",
        );
      }
      const decisionProjection = projectFeedbackPromotionDecisionLedgerEntry(
        decisionEvent,
      );
      const decision = decisionProjection.decision;
      if (
        decision.hash !== request.decisionHash
        || decisionEvent.eventHash !== request.decisionEventHash
      ) {
        throw new Error(
          "Pedido de canonicalização diverge dos hashes da decisão.",
        );
      }
      if (decision.action !== "promote") {
        throw new Error(
          "Somente decisão promote pode ser canonicalizada.",
        );
      }
      const candidateEvent = events.find((event) =>
        event.type === FEEDBACK_INTERPRETATION_CREATED_EVENT_TYPE
        && event.subjectType === FEEDBACK_INTERPRETATION_SUBJECT_TYPE
        && event.subjectId === request.candidateSubjectId,
      );
      if (!candidateEvent) {
        throw new Error(
          "Pedido de canonicalização não resolve o candidato de interpretação.",
        );
      }
      const candidateProjection = projectFeedbackInterpretationLedgerEntry(
        candidateEvent,
      );
      assertFeedbackInterpretationIsolation(db, candidateProjection.candidate, {
        verifiedEvents: events,
        requireSuggestedScopeActive: false,
        candidateEventSequence: candidateEvent.sequence,
      });
      if (
        candidateProjection.candidateHash !== request.candidateHash
        || candidateProjection.subjectId !== request.candidateSubjectId
        || decision.candidateSubjectId !== request.candidateSubjectId
      ) {
        throw new Error(
          "Pedido de canonicalização diverge do candidato hash-bound.",
        );
      }
      const decisionHistory = events
        .filter((event) =>
          event.type === FEEDBACK_PROMOTION_DECISION_RECORDED_EVENT_TYPE
          && event.subjectType === FEEDBACK_PROMOTION_DECISION_SUBJECT_TYPE,
        )
        .map(projectFeedbackPromotionDecisionLedgerEntry)
        .filter((entry) => entry.candidateSubjectId === request.candidateSubjectId)
        .sort((left, right) => left.sequence - right.sequence);
      const latestDecision = decisionHistory.at(-1);
      if (
        latestDecision?.decision.decisionId !== decision.decisionId
        || latestDecision.decision.action !== "promote"
      ) {
        throw new Error(
          "A decisão promote não é mais a decisão terminal corrente do candidato.",
        );
      }
      if (decision.scopeDecision.mode === "global-proposal") {
        throw new Error(
          "global-proposal exige abstração e aprovação global separadas.",
        );
      }
      const scopeId = identifier(
        decision.scopeDecision.scopeId,
        "decision.scopeDecision.scopeId",
      );
      const scope = db.prepare(`
        SELECT kind,status
        FROM knowledge_scopes
        WHERE root_scope_id=? AND scope_id=?
      `).get(rootScopeId, scopeId);
      if (!scope || scope.status !== "active") {
        throw new Error("Scope de canonicalização deve existir e estar ativo.");
      }
      const ownerType = scope.kind;
      const candidate = candidateProjection.candidate;
      const ruleId = `preference:feedback:${candidateProjection.subjectId}`;
      const latestRuleRow = db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=?
        ORDER BY revision DESC
        LIMIT 1
      `).get(rootScopeId, ruleId);
      if (latestRuleRow) {
        const latestRule = itemFromRow(latestRuleRow);
        if (
          latestRule.schemaId === KNOWLEDGE_PREFERENCE_RULE_SCHEMA
          && latestRule.payload?.value?.decisionId === decision.decisionId
        ) {
          const evidenceRef = latestRule.payload.evidenceRefs?.[0];
          const evidenceRow = evidenceRef == null
            ? null
            : db.prepare(`
                SELECT *
                FROM knowledge_items
                WHERE root_scope_id=? AND item_id=? AND revision=?
              `).get(rootScopeId, evidenceRef.id, evidenceRef.revision);
          if (!evidenceRow) {
            throw new Error(
              "Regra já canonicalizada perdeu sua evidência governada.",
            );
          }
          return {
            schema: "mkt-videos/knowledge-feedback-canonicalization-action-result@1",
            action: "canonicalize-feedback-interpretation",
            status: "already-canonicalized",
            providerFree: true,
            readOnly: false,
            changed: false,
            humanConfirmed: true,
            rootScopeId,
            decisionId: decision.decisionId,
            candidateSubjectId: candidateProjection.subjectId,
            ruleItem: latestRule,
            evidenceItem: itemFromRow(evidenceRow),
          };
        }
      }
      const evidenceId = `evidence:feedback:${candidateProjection.subjectId}:${decision.decisionId}`;
      const scopeRef = {
        schema: "mkt-videos/knowledge-reference@1",
        kind: "scope",
        rootScopeId,
        id: scopeId,
      };
      const evidencePayload = {
        schema: "mkt-videos/evidence-link@1",
        source: {
          sourceType: "feedback-event",
          sourceRef: `feedback:${candidate.sourceFeedback.eventId}`,
          contentHash: candidate.sourceFeedback.feedbackHash,
          method: "human-canonicalization",
          observedAt: decision.decidedAt,
          fragment: {
            text: candidate.interpretation.preference.statement,
          },
        },
        relation: "supports",
        targetRefs: [scopeRef],
        observation: candidate.interpretation.preference.statement,
        confidence: 1,
        evidenceRefs: [],
      };
      const evidenceGovernance = createKnowledgeRecordEnvelope({
        classification: candidate.governance.classification,
        owner: { type: ownerType, id: scopeId },
        provenance: [{
          sourceType: "feedback-event",
          sourceRef: `feedback:${candidate.sourceFeedback.eventId}`,
          method: "human-canonicalization",
          observedAt: decision.decidedAt,
          contentHash: candidate.sourceFeedback.feedbackHash,
        }],
        modality: "observation",
        evidenceIds: [],
        retention: { policy: "manual-review" },
        rights: {
          inventory: "allowed",
          localAnalysis: "allowed",
          textualIndexing: "allowed",
          embedding: "denied",
          training: "denied",
          providerInput: "denied",
          publication: "denied",
          reuse: "denied",
        },
        createdAt: canonicalizedAt,
        createdBy: grant.actor,
      }, { expectedActor: grant.actor });
      const evidenceBody = {
        schema: KNOWLEDGE_ITEM_SCHEMA,
        id: evidenceId,
        revision: 1,
        rootScopeId,
        scopeId,
        recordType: "evidence",
        schemaId: "mkt-videos/evidence-link@1",
        schemaVersion: 1,
        status: "active",
        governance: evidenceGovernance,
        supersedesRevision: null,
        payload: evidencePayload,
        createdAt: canonicalizedAt,
        createdBy: grant.actor,
      };
      const evidenceItem = {
        ...evidenceBody,
        contentHash: contentHash(evidenceBody),
      };
      const evidenceRef = {
        schema: "mkt-videos/knowledge-reference@1",
        kind: "item",
        rootScopeId,
        id: evidenceId,
        revision: 1,
        recordType: "evidence",
        contentHash: evidenceItem.contentHash,
      };
      const rulePayload = {
        schema: KNOWLEDGE_PREFERENCE_RULE_SCHEMA,
        subjectRef: scopeRef,
        predicate: "preference.feedback",
        value: {
          candidateSubjectId: candidateProjection.subjectId,
          candidateHash: candidateProjection.candidateHash,
          decisionId: decision.decisionId,
          decisionHash: decision.hash,
          candidateEventId: candidateEvent.id,
          candidateEventHash: candidateEvent.eventHash,
          target: candidate.interpretation.target,
          operation: candidate.interpretation.preference.operation,
          statement: candidate.interpretation.preference.statement,
          dimensions: candidate.interpretation.dimensions,
          applicability: candidate.interpretation.applicability,
          exceptions: candidate.interpretation.exceptions,
          rationale: candidate.interpretation.rationale,
        },
        polarity: "positive",
        applicability: decision.scopeDecision,
        confidence: 1,
        evidenceRefs: [evidenceRef],
      };
      const ruleBody = {
        schema: KNOWLEDGE_ITEM_SCHEMA,
        id: ruleId,
        revision: latestRuleRow ? Number(latestRuleRow.revision) + 1 : 1,
        rootScopeId,
        scopeId,
        recordType: "assertion",
        schemaId: KNOWLEDGE_PREFERENCE_RULE_SCHEMA,
        schemaVersion: 1,
        status: "active",
        governance: createKnowledgeRecordEnvelope({
          classification: candidate.governance.classification,
          owner: { type: ownerType, id: scopeId },
          provenance: [{
            sourceType: "feedback-promotion-decision",
            sourceRef: `decision:${decision.decisionId}`,
            method: "human-canonicalization",
            observedAt: decision.decidedAt,
            contentHash: decision.hash,
          }],
          modality: "preference",
          evidenceIds: [evidenceId],
          retention: { policy: "manual-review" },
          rights: {
            inventory: "allowed",
            localAnalysis: "allowed",
            textualIndexing: "allowed",
            embedding: "denied",
            training: "denied",
            providerInput: "denied",
            publication: "denied",
            reuse: "allowed",
          },
          createdAt: canonicalizedAt,
          createdBy: grant.actor,
        }, { expectedActor: grant.actor }),
        supersedesRevision: latestRuleRow
          ? Number(latestRuleRow.revision)
          : null,
        payload: rulePayload,
        createdAt: canonicalizedAt,
        createdBy: grant.actor,
      };
      const ruleItem = {
        ...ruleBody,
        contentHash: contentHash(ruleBody),
      };
      const preparedItems = [evidenceItem, ruleItem].map((item, index) =>
        prepareCanonicalKnowledgeBatchItem(grant, item, index));
      const results = appendPreparedKnowledgeBatchItemsInTransaction(
        db,
        grant,
        rootScopeId,
        scopeId,
        preparedItems,
        [],
      );
      return {
        schema: "mkt-videos/knowledge-feedback-canonicalization-action-result@1",
        action: "canonicalize-feedback-interpretation",
        status: "canonicalized",
        providerFree: true,
        readOnly: false,
        changed: true,
        humanConfirmed: true,
        rootScopeId,
        decisionId: decision.decisionId,
        candidateSubjectId: candidateProjection.subjectId,
        evidenceItem: results[0],
        ruleItem: results[1],
      };
    }));
  }

  appendKnowledgeAssetLinkItem({ grant, item } = {}) {
    const rootScopeId = identifier(item?.rootScopeId, "item.rootScopeId");
    const scopeId = identifier(item?.scopeId, "item.scopeId");
    this.#assertGrant(grant, rootScopeId, "read");
    this.#assertGrant(grant, rootScopeId, "write");
    if (
      item?.recordType !== "relation"
      || item?.schemaId !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
      || Number(item?.schemaVersion) !== 1
    ) {
      throw new Error(
        "Asset link exige recordType relation e schema canônico @1.",
      );
    }
    const payload = assertKnowledgeAssetLinkPayload(item?.payload);
    const expectedId = knowledgeAssetLinkItemId({
      rootScopeId,
      rootKind: payload.rootKind,
      relativePath: payload.relativePath,
    });
    if (item?.id !== expectedId) {
      throw new Error("item.id diverge da localização governada do asset.");
    }
    const governance = assertKnowledgeRecordEnvelope(item?.governance, {
      expectedActor: grant.actor,
    });
    const scope = this.getScope({
      grant,
      rootScopeId,
      scopeId,
    });
    if (!scope) {
      throw new Error(`Scope não pertence ao root autorizado: ${scopeId}.`);
    }
    if (
      governance.owner.id !== scopeId
      || governance.owner.type !== scope.kind
    ) {
      throw new Error(
        "Owner do asset link deve corresponder ao scope governado.",
      );
    }
    const revision = Number(item?.revision);
    if (Number.isInteger(revision) && revision > 1) {
      const previous = this.getKnowledgeItem({
        grant,
        rootScopeId,
        id: item.id,
        revision: revision - 1,
      });
      if (!previous) {
        throw new Error("Revisão anterior do asset link é inexistente.");
      }
      const previousPayload = assertKnowledgeAssetLinkPayload(
        previous.payload,
      );
      if (
        previousPayload.rootKind !== payload.rootKind
        || previousPayload.relativePath !== payload.relativePath
      ) {
        throw new Error(
          "Localização física do asset link é imutável entre revisões.",
        );
      }
    }
    issuedAssetLinkWrites.add(item);
    try {
      return this.appendKnowledgeItem({ grant, item });
    } finally {
      issuedAssetLinkWrites.delete(item);
    }
  }

  getKnowledgeAssetLinkItem({
    grant,
    rootScopeId,
    id,
    revision = null,
  } = {}) {
    const item = this.getKnowledgeItem({
      grant,
      rootScopeId,
      id,
      revision,
    });
    if (item == null) return null;
    if (
      item.recordType !== "relation"
      || item.schemaId !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
    ) {
      throw new Error("Item solicitado não é um asset link governado.");
    }
    assertKnowledgeAssetLinkPayload(item.payload);
    return item;
  }

  listKnowledgeAssetLinkItems({
    grant,
    rootScopeId,
    history = false,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const rows = history
        ? db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=? AND schema_id=?
          ORDER BY item_id,revision
        `).all(normalizedRoot, KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA)
        : db.prepare(`
          SELECT item.*
          FROM knowledge_items AS item
          INNER JOIN (
            SELECT root_scope_id,item_id,MAX(revision) AS revision
            FROM knowledge_items
            WHERE root_scope_id=? AND schema_id=?
            GROUP BY root_scope_id,item_id
          ) AS head
          ON head.root_scope_id=item.root_scope_id
          AND head.item_id=item.item_id
          AND head.revision=item.revision
          ORDER BY item.item_id
        `).all(normalizedRoot, KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA);
      return rows.map((row) => {
        const item = itemFromRow(row);
        assertKnowledgeAssetLinkPayload(item.payload);
        return item;
      });
    });
  }

  appendKnowledgeItemsAtomic({ grant, items, expectedHeads } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("items deve ser um lote não vazio.");
    }
    const rootScopeIds = items.map((item, index) =>
      identifier(item?.rootScopeId, `items[${index}].rootScopeId`));
    const scopeIds = items.map((item, index) =>
      identifier(item?.scopeId, `items[${index}].scopeId`));
    if (new Set(rootScopeIds).size !== 1) {
      throw new Error("Lote atômico não aceita rootScopeIds divergentes.");
    }
    if (new Set(scopeIds).size !== 1) {
      throw new Error("Lote atômico não aceita scopeIds divergentes.");
    }
    const rootScopeId = rootScopeIds[0];
    const scopeId = scopeIds[0];
    this.#assertGrant(grant, rootScopeId, "write");
    const preparedItems = items.map((item, index) =>
      prepareCanonicalKnowledgeBatchItem(grant, item, index));
    const normalizedExpectedHeads = normalizeExpectedKnowledgeHeads(
      expectedHeads,
      rootScopeId,
      preparedItems,
    );
    const seen = new Set();
    let aggregateBytes = 0;
    for (const prepared of preparedItems) {
      const key = batchItemKey(prepared.body);
      if (seen.has(key)) {
        throw new Error(
          `Lote atômico não aceita item duplicado: ${prepared.body.id}@${prepared.body.revision}.`,
        );
      }
      seen.add(key);
      aggregateBytes += Buffer.byteLength(prepared.bodyJson, "utf8");
      if (aggregateBytes > MAX_AGGREGATE_JSON_BYTES) {
        throw new Error(
          `Lote atômico excede o limite de ${MAX_AGGREGATE_JSON_BYTES} bytes.`,
        );
      }
    }
    return this.#withWriteDb((db) => withTransaction(db, () => {
      return appendPreparedKnowledgeBatchItemsInTransaction(
        db,
        grant,
        rootScopeId,
        scopeId,
        preparedItems,
        normalizedExpectedHeads,
      );
    }));
  }

  appendKnowledgeItem({ grant, item } = {}) {
    const id = identifier(item?.id, "item.id");
    const rootScopeId = identifier(item?.rootScopeId, "item.rootScopeId");
    const scopeId = identifier(item?.scopeId, "item.scopeId");
    this.#assertGrant(grant, rootScopeId, "write");
    const revision = Number(item?.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error("item.revision deve ser um inteiro positivo.");
    }
    const recordType = requiredText(item?.recordType, "item.recordType", 40);
    if (!RECORD_TYPES.has(recordType)) {
      throw new Error(`recordType inválido: ${recordType}.`);
    }
    const status = item?.status == null
      ? "active"
      : requiredText(item.status, "item.status", 40);
    if (!RECORD_STATUSES.has(status)) {
      throw new Error(`Status de knowledge item inválido: ${status}.`);
    }
    if (status === "quarantined") {
      throw new Error(
        "Revisão quarantined exige reviewKnowledgeItem com decisão humana.",
      );
    }
    const { schemaId, schemaVersion } = validateSchemaIdentity(
      item?.schemaId ?? KNOWLEDGE_ITEM_SCHEMA,
      item?.schemaVersion ?? 1,
    );
    if (
      schemaId === KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
      && !issuedAssetLinkWrites.has(item)
    ) {
      throw new Error(
        "Asset link exige appendKnowledgeAssetLinkItem; append genérico bloqueado.",
      );
    }
    const payload = normalizeJson(item?.payload ?? {});
    const supersedesRevision = item?.supersedesRevision == null
      ? null
      : Number(item.supersedesRevision);
    if (item?.governance == null) {
      throw new Error("item.governance é obrigatório.");
    }
    const governance = assertKnowledgeRecordEnvelope(item.governance, {
      expectedActor: grant.actor,
    });
    const createdAt = assertTimestampWithinGrant(
      item?.createdAt ?? governance.createdAt,
      grant,
      "item.createdAt",
    );
    const createdBy = authorizedActor(
      item?.createdBy ?? governance.createdBy,
      grant,
      "item.createdBy",
    );
    if (
      createdAt !== governance.createdAt
      || createdBy !== governance.createdBy
    ) {
      throw new Error(
        "item.createdAt e item.createdBy devem corresponder ao item.governance.",
      );
    }
    const governanceJson = canonicalJson(governance);
    const body = {
      schema: KNOWLEDGE_ITEM_SCHEMA,
      id,
      revision,
      rootScopeId,
      scopeId,
      recordType,
      schemaId,
      schemaVersion,
      status,
      governance: normalizeJson(governance),
      supersedesRevision,
      payload,
      createdAt,
      createdBy,
    };
    const bodyJson = canonicalJson(body);
    const hash = sha256Text(bodyJson);
    return this.#withWriteDb((db) => withTransaction(db, () => {
      assertRootScopeExists(db, rootScopeId);
      const scope = db.prepare(`
        SELECT 1
        FROM knowledge_scopes
        WHERE root_scope_id=? AND scope_id=?
      `).get(rootScopeId, scopeId);
      if (!scope) throw new Error(`Scope não pertence ao root autorizado: ${scopeId}.`);
      const latest = db.prepare(`
        SELECT revision,record_type,status,schema_id
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=?
        ORDER BY revision DESC
        LIMIT 1
      `).get(rootScopeId, id);
      if (!latest && (revision !== 1 || supersedesRevision != null)) {
        throw new Error("Primeira revisão deve ser 1 e não pode superseder outra.");
      }
      if (latest) {
        if (
          revision !== latest.revision + 1
          || supersedesRevision !== latest.revision
        ) {
          throw new Error(
            `Nova revisão deve ser ${latest.revision + 1} e superseder ${latest.revision}.`,
          );
        }
        if (latest.record_type !== recordType) {
          throw new Error("recordType é imutável entre revisões.");
        }
        if (
          latest.schema_id === KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
          && !issuedAssetLinkWrites.has(item)
        ) {
          throw new Error(
            "Revisão de asset link exige appendKnowledgeAssetLinkItem.",
          );
        }
        if (latest.status === "candidate" && status === "active") {
          throw new Error(
            "Promoção candidate → active exige reviewKnowledgeItem.",
          );
        }
      }
      assertPersistableKnowledgeItemBindings(
        db,
        body,
        "Novo Knowledge item",
      );
      db.prepare(`
        INSERT INTO knowledge_items(
          root_scope_id,item_id,revision,scope_id,record_type,schema_id,
          schema_version,status,classification,owner_type,owner_id,modality,
          governance_json,governance_hash,supersedes_revision,body_json,
          content_hash,created_at,created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        rootScopeId,
        id,
        revision,
        scopeId,
        recordType,
        schemaId,
        schemaVersion,
        status,
        governance.classification,
        governance.owner.type,
        governance.owner.id,
        governance.modality,
        governanceJson,
        governance.hash,
        supersedesRevision,
        bodyJson,
        hash,
        createdAt,
        createdBy,
      );
      appendEvent(db, {
        rootScopeId,
        scopeId,
        type: "knowledge-item.appended",
        subjectType: recordType,
        subjectId: id,
        subjectRevision: revision,
        grant,
        grantPermission: "write",
        payload: {
          contentHash: hash,
          schemaId,
          schemaVersion,
          status,
          supersedesRevision,
          governanceHash: governance.hash,
        },
        at: createdAt,
      });
      return assertKnowledgeContract({
        ...body,
        contentHash: hash,
      }, {
        schemaId: KNOWLEDGE_ITEM_SCHEMA,
        label: "Knowledge item",
      });
    }));
  }

  reviewKnowledgeItem({
    grant,
    rootScopeId,
    itemId,
    expectedRevision,
    expectedContentHash,
    action,
    reason,
    evidenceIds = [],
    reviewedAt = null,
    reviewedBy = null,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedItemId = identifier(itemId, "itemId");
    this.#assertGrant(grant, normalizedRoot, "release");
    const normalizedRevision = Number(expectedRevision);
    if (!Number.isInteger(normalizedRevision) || normalizedRevision < 1) {
      throw new Error("expectedRevision deve ser um inteiro positivo.");
    }
    const normalizedContentHash = requiredText(
      expectedContentHash,
      "expectedContentHash",
      64,
    );
    if (!SHA256_PATTERN.test(normalizedContentHash)) {
      throw new Error("expectedContentHash deve ser SHA-256.");
    }
    const normalizedAction = requiredText(action, "action", 20);
    if (!["promote", "quarantine"].includes(normalizedAction)) {
      throw new Error("action deve ser promote ou quarantine.");
    }
    const resultStatus = normalizedAction === "promote"
      ? "active"
      : "quarantined";
    const normalizedReason = requiredText(reason, "reason", 1000);
    const normalizedEvidenceIds = identifierList(
      evidenceIds,
      "evidenceIds",
    );
    const normalizedAt = assertTimestampWithinGrant(
      reviewedAt ?? this.#now(),
      grant,
      "reviewedAt",
    );
    const normalizedBy = authorizedActor(
      reviewedBy,
      grant,
      "reviewedBy",
    );
    return this.#withWriteDb((db) => withTransaction(db, () => {
      const sourceRow = db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=?
        ORDER BY revision DESC
        LIMIT 1
      `).get(normalizedRoot, normalizedItemId);
      if (!sourceRow) {
        throw new Error(`Knowledge item inexistente: ${normalizedItemId}.`);
      }
      if (
        sourceRow.revision !== normalizedRevision
        || sourceRow.content_hash !== normalizedContentHash
      ) {
        throw new Error(
          "Head corrente diverge de expectedRevision/expectedContentHash.",
        );
      }
      if (
        normalizedAction === "promote"
        && sourceRow.status !== "candidate"
      ) {
        throw new Error("Promoção exige head candidate.");
      }
      if (
        normalizedAction === "quarantine"
        && !["candidate", "active"].includes(sourceRow.status)
      ) {
        throw new Error("Quarentena exige head candidate ou active.");
      }
      for (const evidenceId of normalizedEvidenceIds) {
        const evidence = db.prepare(`
          SELECT record_type,status
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=?
          ORDER BY revision DESC
          LIMIT 1
        `).get(normalizedRoot, evidenceId);
        if (!evidence || evidence.record_type !== "evidence") {
          throw new Error(
            `Evidência não pertence ao root autorizado: ${evidenceId}.`,
          );
        }
        if (evidence.status !== "active") {
          throw new Error(`Evidência não está active: ${evidenceId}.`);
        }
      }
      const source = itemFromRow(sourceRow);
      assertPersistableKnowledgeItemBindings(
        db,
        source,
        "Knowledge item em revisão",
      );
      const sequence = Number(db.prepare(`
        SELECT COALESCE(MAX(decision_sequence),0) AS value
        FROM knowledge_review_decisions
        WHERE root_scope_id=?
      `).get(normalizedRoot).value) + 1;
      const resultRevision = source.revision + 1;
      const decisionSeed = {
        rootScopeId: normalizedRoot,
        scopeId: source.scopeId,
        sequence,
        itemId: source.id,
        action: normalizedAction,
        sourceRevision: source.revision,
        sourceContentHash: source.contentHash,
        sourceStatus: source.status,
        resultRevision,
        resultStatus,
        reason: normalizedReason,
        evidenceIds: normalizedEvidenceIds,
        reviewedAt: normalizedAt,
        reviewedBy: normalizedBy,
        policyId: grant.policyId,
        policyHash: grant.policyHash,
      };
      const decisionId = reviewDecisionId(decisionSeed);
      const governance = createKnowledgeRecordEnvelope({
        classification: source.governance.classification,
        owner: source.governance.owner,
        provenance: [
          ...source.governance.provenance,
          {
            sourceType: "human-review",
            sourceRef: `review:${decisionId}`,
            method: "human-review",
            observedAt: normalizedAt,
            contentHash: source.contentHash,
          },
        ],
        modality: source.governance.modality,
        evidenceIds: source.governance.evidenceIds,
        retention: source.governance.retention,
        rights: source.governance.rights,
        createdAt: normalizedAt,
        createdBy: normalizedBy,
      }, {
        expectedActor: grant.actor,
      });
      const itemBody = {
        schema: KNOWLEDGE_ITEM_SCHEMA,
        id: source.id,
        revision: resultRevision,
        rootScopeId: source.rootScopeId,
        scopeId: source.scopeId,
        recordType: source.recordType,
        schemaId: source.schemaId,
        schemaVersion: source.schemaVersion,
        status: resultStatus,
        governance: normalizeJson(governance),
        supersedesRevision: source.revision,
        payload: normalizeJson(source.payload),
        createdAt: normalizedAt,
        createdBy: normalizedBy,
      };
      assertPersistableKnowledgeItemBindings(
        db,
        itemBody,
        "Resultado da revisão",
      );
      const itemBodyJson = canonicalJson(itemBody);
      const itemHash = sha256Text(itemBodyJson);
      db.prepare(`
        INSERT INTO knowledge_items(
          root_scope_id,item_id,revision,scope_id,record_type,schema_id,
          schema_version,status,classification,owner_type,owner_id,modality,
          governance_json,governance_hash,supersedes_revision,body_json,
          content_hash,created_at,created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        normalizedRoot,
        source.id,
        resultRevision,
        source.scopeId,
        source.recordType,
        source.schemaId,
        source.schemaVersion,
        resultStatus,
        governance.classification,
        governance.owner.type,
        governance.owner.id,
        governance.modality,
        canonicalJson(governance),
        governance.hash,
        source.revision,
        itemBodyJson,
        itemHash,
        normalizedAt,
        normalizedBy,
      );
      const decisionBody = {
        schema: KNOWLEDGE_REVIEW_DECISION_SCHEMA,
        id: decisionId,
        rootScopeId: normalizedRoot,
        scopeId: source.scopeId,
        sequence,
        itemId: source.id,
        action: normalizedAction,
        sourceRevision: source.revision,
        sourceContentHash: source.contentHash,
        sourceStatus: source.status,
        resultRevision,
        resultContentHash: itemHash,
        resultStatus,
        reason: normalizedReason,
        evidenceIds: normalizedEvidenceIds,
        reviewedAt: normalizedAt,
        reviewedBy: normalizedBy,
        policyId: grant.policyId,
        policyHash: grant.policyHash,
      };
      const decisionJson = canonicalJson(decisionBody);
      const decisionHash = sha256Text(decisionJson);
      db.prepare(`
        INSERT INTO knowledge_review_decisions(
          root_scope_id,decision_sequence,decision_id,scope_id,item_id,
          source_revision,result_revision,action,source_status,result_status,
          source_content_hash,result_content_hash,reason,evidence_json,
          policy_id,policy_hash,body_json,decision_hash,reviewed_at,reviewed_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        normalizedRoot,
        sequence,
        decisionId,
        source.scopeId,
        source.id,
        source.revision,
        resultRevision,
        normalizedAction,
        source.status,
        resultStatus,
        source.contentHash,
        itemHash,
        normalizedReason,
        canonicalJson(normalizedEvidenceIds),
        grant.policyId,
        grant.policyHash,
        decisionJson,
        decisionHash,
        normalizedAt,
        normalizedBy,
      );
      appendEvent(db, {
        rootScopeId: normalizedRoot,
        scopeId: source.scopeId,
        type: "knowledge-item.appended",
        subjectType: source.recordType,
        subjectId: source.id,
        subjectRevision: resultRevision,
        grant,
        grantPermission: "release",
        payload: {
          contentHash: itemHash,
          schemaId: source.schemaId,
          schemaVersion: source.schemaVersion,
          status: resultStatus,
          supersedesRevision: source.revision,
          governanceHash: governance.hash,
        },
        at: normalizedAt,
      });
      appendEvent(db, {
        rootScopeId: normalizedRoot,
        scopeId: source.scopeId,
        type: normalizedAction === "promote"
          ? "knowledge-item.promoted"
          : "knowledge-item.quarantined",
        subjectType: "knowledge-review-decision",
        subjectId: decisionId,
        grant,
        grantPermission: "release",
        payload: {
          action: normalizedAction,
          decisionHash,
          itemId: source.id,
          sourceRevision: source.revision,
          sourceContentHash: source.contentHash,
          resultRevision,
          resultContentHash: itemHash,
        },
        at: normalizedAt,
      });
      const itemResult = assertKnowledgeContract({
        ...itemBody,
        contentHash: itemHash,
      }, {
        schemaId: KNOWLEDGE_ITEM_SCHEMA,
        label: "Knowledge item revisado",
      });
      const decisionResult = assertKnowledgeContract({
        ...decisionBody,
        hash: decisionHash,
      }, {
        schemaId: KNOWLEDGE_REVIEW_DECISION_SCHEMA,
        label: "Knowledge review decision",
      });
      return {
        decision: decisionResult,
        item: itemResult,
      };
    }));
  }

  getReviewDecision({
    grant,
    rootScopeId,
    decisionId,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedDecision = identifier(decisionId, "decisionId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => reviewDecisionFromRow(db.prepare(`
      SELECT *
      FROM knowledge_review_decisions
      WHERE root_scope_id=? AND decision_id=?
    `).get(normalizedRoot, normalizedDecision)));
  }

  listReviewDecisions({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => db.prepare(`
      SELECT *
      FROM knowledge_review_decisions
      WHERE root_scope_id=?
      ORDER BY decision_sequence
    `).all(normalizedRoot).map(reviewDecisionFromRow));
  }

  retrieveKnowledgeShadow({ grant, request: requestValue } = {}) {
    const request = assertKnowledgeRetrievalRequest(requestValue);
    const normalizedRoot = identifier(request.rootScopeId, "request.rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    const evaluatedAt = assertTimestampWithinGrant(
      request.asOf,
      grant,
      "retrieval.asOf",
    );
    return this.#withReadDb((db) => {
      // A retrieval snapshot is only valid over a verified append-only ledger.
      readVerifiedRootEventLedger(db, normalizedRoot);
      const scopes = db.prepare(`
        SELECT *
        FROM knowledge_scopes
        WHERE root_scope_id=?
        ORDER BY scope_id
      `).all(normalizedRoot).map(scopeFromRow);
      const items = latestItemRows(db, normalizedRoot).map(itemFromRow);
      let activeRelease = null;
      const activation = releaseActivationFromRow(db.prepare(`
        SELECT *
        FROM knowledge_release_activations
        WHERE root_scope_id=?
        ORDER BY activation_sequence DESC
        LIMIT 1
      `).get(normalizedRoot));
      if (activation) {
        activeRelease = releaseFromRow(db.prepare(`
          SELECT *
          FROM knowledge_releases
          WHERE root_scope_id=? AND release_id=?
        `).get(normalizedRoot, activation.releaseId));
        if (!activeRelease) {
          throw new Error("Ativação corrente aponta para release inexistente.");
        }
        const releaseItems = activeRelease.members.map((member) => {
          const row = db.prepare(`
            SELECT *
            FROM knowledge_items
            WHERE root_scope_id=? AND item_id=? AND revision=?
          `).get(normalizedRoot, member.id, member.revision);
          if (!row) throw new Error("Release ativa possui membro inexistente.");
          const item = itemFromRow(row);
          assertPersistableKnowledgeItemBindings(db, item, "Release ativa");
          return item;
        });
        assertReleaseReferenceClosure(releaseItems, "Release ativa");
      }
      const result = buildKnowledgeRetrievalShadow({
        request: {
          ...request,
          asOf: evaluatedAt,
        },
        scopes,
        items,
        activeRelease,
        ftsSearch: searchKnowledgeItemsWithFts,
      });
      return result;
    });
  }

  getKnowledgeItem({
    grant,
    rootScopeId,
    id,
    revision = null,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedId = identifier(id, "id");
    this.#assertGrant(grant, normalizedRoot, "read");
    const normalizedRevision = revision == null ? null : Number(revision);
    if (
      normalizedRevision != null
      && (!Number.isInteger(normalizedRevision) || normalizedRevision < 1)
    ) {
      throw new Error("revision deve ser um inteiro positivo.");
    }
    return this.#withReadDb((db) => {
      const row = revision == null
        ? db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=?
          ORDER BY revision DESC
          LIMIT 1
        `).get(normalizedRoot, normalizedId)
        : db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=? AND revision=?
        `).get(normalizedRoot, normalizedId, normalizedRevision);
      return itemFromRow(row);
    });
  }

  resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId,
    referenceAssetId,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedAssetId = identifier(
      referenceAssetId,
      "referenceAssetId",
    );
    this.#assertGrant(grant, normalizedRoot, "read");
    const evaluatedAt = this.#now();
    return this.#withReadDb((db) => {
      const targetItem = itemFromRow(db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=?
        ORDER BY revision DESC
        LIMIT 1
      `).get(normalizedRoot, normalizedAssetId));
      if (targetItem == null) {
        throw new Error(
          `Reference asset inexistente no root autorizado: ${normalizedAssetId}.`,
        );
      }
      const rightsItemId = referenceRightsItemId(targetItem);
      const rightsHead = itemFromRow(db.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=?
        ORDER BY revision DESC
        LIMIT 1
      `).get(normalizedRoot, rightsItemId));
      const effectiveRights = resolveEffectiveRights({
        targetItem,
        rightsItems: rightsHead == null ? [] : [rightsHead],
        at: evaluatedAt,
      });
      return {
        targetItem,
        rightsHead,
        effectiveRights,
      };
    });
  }

  listKnowledgeItems({
    grant,
    rootScopeId,
    history = false,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const rows = history
        ? db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=?
          ORDER BY item_id,revision
        `).all(normalizedRoot)
        : latestItemRows(db, normalizedRoot);
      return rows.map(itemFromRow);
    });
  }

  createRelease({
    grant,
    rootScopeId,
    releaseId = null,
    label,
    previousReleaseId = null,
    members = null,
    createdAt = null,
    createdBy = null,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "release");
    const normalizedAt = assertTimestampWithinGrant(
      createdAt ?? this.#now(),
      grant,
      "createdAt",
    );
    const normalizedBy = authorizedActor(createdBy, grant, "createdBy");
    const normalizedPrevious = previousReleaseId == null
      ? null
      : identifier(previousReleaseId, "previousReleaseId");
    return this.#withWriteDb((db) => withTransaction(db, () => {
      assertRootScopeExists(db, normalizedRoot);
      if (normalizedPrevious) {
        const previous = db.prepare(`
          SELECT 1
          FROM knowledge_releases
          WHERE root_scope_id=? AND release_id=?
        `).get(normalizedRoot, normalizedPrevious);
        if (!previous) {
          throw new Error(`Release anterior inexistente: ${normalizedPrevious}.`);
        }
      }
      let selectedRows;
      if (members == null) {
        selectedRows = latestItemRows(db, normalizedRoot);
      } else {
        if (!Array.isArray(members)) throw new Error("members deve ser um array.");
        const seen = new Set();
        selectedRows = members.map((member, index) => {
          const memberId = identifier(member?.id, `members[${index}].id`);
          const memberRevision = Number(member?.revision);
          if (!Number.isInteger(memberRevision) || memberRevision < 1) {
            throw new Error(`members[${index}].revision é inválida.`);
          }
          const key = `${memberId}@${memberRevision}`;
          if (seen.has(memberId)) {
            throw new Error(
              `Release não pode conter mais de uma revisão de ${memberId}.`,
            );
          }
          seen.add(memberId);
          const row = db.prepare(`
            SELECT *
            FROM knowledge_items
            WHERE root_scope_id=? AND item_id=? AND revision=?
          `).get(normalizedRoot, memberId, memberRevision);
          if (!row) throw new Error(`Knowledge item inexistente: ${key}.`);
          return row;
        });
      }
      const selectedItems = selectedRows
        .map(itemFromRow)
        .sort((left, right) => compareText(left.id, right.id)
          || left.revision - right.revision);
      const ineligible = selectedItems.find((item) => item.status !== "active");
      if (ineligible) {
        throw new Error(
          `Release aceita somente revisões active; item inelegível: ${ineligible.id}.`,
        );
      }
      for (const item of selectedItems) {
        assertPersistableKnowledgeItemBindings(
          db,
          item,
          "Knowledge release member",
        );
      }
      assertReleaseReferenceClosure(selectedItems);
      const releaseMembers = selectedItems.map(releaseMemberFromItem);
      const identityBody = {
        schema: KNOWLEDGE_RELEASE_SCHEMA,
        rootScopeId: normalizedRoot,
        label: requiredText(label, "label", 240),
        previousReleaseId: normalizedPrevious,
        createdAt: normalizedAt,
        createdBy: normalizedBy,
        members: releaseMembers,
      };
      const normalizedReleaseId = releaseId == null
        ? `kr_${contentHash(identityBody, {
            maxBytes: MAX_AGGREGATE_JSON_BYTES,
          }).slice(0, 32)}`
        : identifier(releaseId, "releaseId");
      const body = {
        schema: KNOWLEDGE_RELEASE_SCHEMA,
        id: normalizedReleaseId,
        rootScopeId: normalizedRoot,
        label: identityBody.label,
        previousReleaseId: normalizedPrevious,
        createdAt: normalizedAt,
        createdBy: normalizedBy,
        members: releaseMembers,
      };
      const manifestJson = canonicalJson(body, {
        maxBytes: MAX_AGGREGATE_JSON_BYTES,
      });
      const hash = sha256Text(manifestJson);
      db.prepare(`
        INSERT INTO knowledge_releases(
          root_scope_id,release_id,previous_release_id,label,manifest_json,
          release_hash,created_at,created_by
        ) VALUES (?,?,?,?,?,?,?,?)
      `).run(
        normalizedRoot,
        normalizedReleaseId,
        normalizedPrevious,
        body.label,
        manifestJson,
        hash,
        normalizedAt,
        normalizedBy,
      );
      const insertMember = db.prepare(`
        INSERT INTO knowledge_release_members(
          root_scope_id,release_id,ordinal,item_id,revision,record_type,
          schema_id,schema_version,content_hash
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `);
      releaseMembers.forEach((member, ordinal) => {
        insertMember.run(
          normalizedRoot,
          normalizedReleaseId,
          ordinal,
          member.id,
          member.revision,
          member.recordType,
          member.schemaId,
          member.schemaVersion,
          member.contentHash,
        );
      });
      appendEvent(db, {
        rootScopeId: normalizedRoot,
        scopeId: normalizedRoot,
        type: "knowledge-release.created",
        subjectType: "knowledge-release",
        subjectId: normalizedReleaseId,
        grant,
        grantPermission: "release",
        payload: {
          releaseHash: hash,
          previousReleaseId: normalizedPrevious,
          memberCount: releaseMembers.length,
        },
        at: normalizedAt,
      });
      return assertKnowledgeContract({
        ...body,
        hash,
      }, {
        schemaId: KNOWLEDGE_RELEASE_SCHEMA,
        label: "Knowledge release",
      });
    }));
  }

  getRelease({ grant, rootScopeId, releaseId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedRelease = identifier(releaseId, "releaseId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => releaseFromRow(db.prepare(`
      SELECT *
      FROM knowledge_releases
      WHERE root_scope_id=? AND release_id=?
    `).get(normalizedRoot, normalizedRelease)));
  }

  listReleases({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => db.prepare(`
      SELECT *
      FROM knowledge_releases
      WHERE root_scope_id=?
      ORDER BY created_at,release_id
    `).all(normalizedRoot).map(releaseFromRow));
  }

  activateRelease(options = {}) {
    return this.#appendReleaseActivation({
      ...options,
      mode: "activate",
    });
  }

  rollbackRelease(options = {}) {
    return this.#appendReleaseActivation({
      ...options,
      mode: "rollback",
    });
  }

  listReleaseActivations({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => db.prepare(`
      SELECT *
      FROM knowledge_release_activations
      WHERE root_scope_id=?
      ORDER BY activation_sequence
    `).all(normalizedRoot).map(releaseActivationFromRow));
  }

  getActiveRelease({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    return this.#withReadDb((db) => {
      const activation = releaseActivationFromRow(db.prepare(`
        SELECT *
        FROM knowledge_release_activations
        WHERE root_scope_id=?
        ORDER BY activation_sequence DESC
        LIMIT 1
      `).get(normalizedRoot));
      if (!activation) return null;
      const release = releaseFromRow(db.prepare(`
        SELECT *
        FROM knowledge_releases
        WHERE root_scope_id=? AND release_id=?
      `).get(normalizedRoot, activation.releaseId));
      if (!release) {
        throw new Error("Ativação corrente aponta para release inexistente.");
      }
      return { activation, release };
    });
  }

  inspectActiveRelease({ grant, rootScopeId, at = null } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "read");
    this.#assertGrant(grant, normalizedRoot, "integrity");
    const normalizedAt = assertTimestampWithinGrant(
      at ?? this.#now(),
      grant,
      "at",
    );
    return this.#withReadDb((db) => {
      const activation = releaseActivationFromRow(db.prepare(`
        SELECT *
        FROM knowledge_release_activations
        WHERE root_scope_id=?
        ORDER BY activation_sequence DESC
        LIMIT 1
      `).get(normalizedRoot));
      if (!activation) {
        return {
          active: false,
          eligible: false,
          activation: null,
          release: null,
          eligibilityHash: null,
          issues: [],
        };
      }
      const release = releaseFromRow(db.prepare(`
        SELECT *
        FROM knowledge_releases
        WHERE root_scope_id=? AND release_id=?
      `).get(normalizedRoot, activation.releaseId));
      if (!release) {
        return {
          active: true,
          eligible: false,
          activation,
          release: null,
          eligibilityHash: null,
          issues: [{ type: "active-release-missing" }],
        };
      }
      try {
        const eligibility = releaseEligibilitySnapshot(
          db,
          release,
          normalizedAt,
        );
        return {
          active: true,
          eligible: true,
          activation,
          release,
          eligibilityHash: eligibility.hash,
          issues: [],
        };
      } catch {
        return {
          active: true,
          eligible: false,
          activation,
          release,
          eligibilityHash: null,
          issues: [{ type: "active-release-ineligible" }],
        };
      }
    });
  }

  authorizeReplay({
    grant,
    rootScopeId,
    releaseId,
    checkedAt = null,
    ttlMs = 60_000,
  } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    const normalizedRelease = identifier(releaseId, "releaseId");
    this.#assertGrant(grant, normalizedRoot, "read");
    this.#assertGrant(grant, normalizedRoot, "integrity");
    const normalizedTtl = Number(ttlMs);
    if (
      !Number.isInteger(normalizedTtl)
      || normalizedTtl < 1
      || normalizedTtl > 5 * 60 * 1000
    ) {
      throw new Error("ttlMs de replay deve ficar entre 1 e 300000.");
    }
    const normalizedAt = assertTimestampWithinGrant(
      checkedAt ?? this.#now(),
      grant,
      "checkedAt",
    );
    const expiresAtMs = Math.min(
      Date.parse(normalizedAt) + normalizedTtl,
      Date.parse(grant.expiresAt),
    );
    if (expiresAtMs <= Date.parse(normalizedAt)) {
      throw new Error("ScopeGrant expira antes da autorização de replay.");
    }
    return this.#withReadDb((db) => {
      const rootReport = inspectRootData(db, normalizedRoot);
      if (!rootReport.ok) {
        throw new Error(
          "Replay bloqueado: o root scope falhou na integridade.",
        );
      }
      const release = releaseFromRow(db.prepare(`
        SELECT *
        FROM knowledge_releases
        WHERE root_scope_id=? AND release_id=?
      `).get(normalizedRoot, normalizedRelease));
      if (!release) {
        throw new Error(`Release inexistente: ${normalizedRelease}.`);
      }
      const releaseItems = [];
      const currentItems = [];
      for (const member of release.members) {
        const releaseRow = db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=? AND revision=?
        `).get(normalizedRoot, member.id, member.revision);
        const currentRow = db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=?
          ORDER BY revision DESC
          LIMIT 1
        `).get(normalizedRoot, member.id);
        if (!releaseRow || !currentRow) {
          throw new Error(
            "Replay bloqueado: revisão da release ou head atual ausente.",
          );
        }
        const releaseItem = itemFromRow(releaseRow);
        const currentItem = itemFromRow(currentRow);
        assertPersistableKnowledgePayload(
          releaseItem,
          `Membro de replay ${releaseItems.length}`,
        );
        assertPersistableKnowledgePayload(
          currentItem,
          `Head de replay ${currentItems.length}`,
        );
        releaseItems.push(releaseItem);
        currentItems.push(currentItem);
      }
      assertReleaseReferenceClosure(
        releaseItems,
        "Autorização de replay",
      );
      return issueKnowledgeReplayAuthorization({
        rootScopeId: normalizedRoot,
        release,
        releaseItems,
        currentItems,
        checkedAt: normalizedAt,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
    });
  }

  exportKnowledge({ grant, rootScopeId, releaseId = null } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "export");
    const normalizedRelease = releaseId == null
      ? null
      : identifier(releaseId, "releaseId");
    return this.#withReadDb((db) => {
      assertGloballyHealthy(db);
      const scopedIntegrity = inspectRootData(db, normalizedRoot);
      if (!scopedIntegrity.ok) {
        throw new Error(
          "Export bloqueado: o root scope falhou na verificação de integridade.",
        );
      }
      assertRootScopeExists(db, normalizedRoot);
      let scopes;
      let items;
      let releases;
      let reviewDecisions;
      let releaseActivations;
      let events;
      if (normalizedRelease) {
        const release = releaseFromRow(db.prepare(`
          SELECT *
          FROM knowledge_releases
          WHERE root_scope_id=? AND release_id=?
        `).get(normalizedRoot, normalizedRelease));
        if (!release) throw new Error(`Release inexistente: ${normalizedRelease}.`);
        items = release.members.map((member) => {
          const row = db.prepare(`
            SELECT *
            FROM knowledge_items
            WHERE root_scope_id=? AND item_id=? AND revision=?
          `).get(normalizedRoot, member.id, member.revision);
          if (!row) {
            throw new Error(
              `Release ${normalizedRelease} possui membro ausente: ${member.id}@${member.revision}.`,
            );
          }
          return itemFromRow(row);
        });
        scopes = scopeRowsForRelease(db, normalizedRoot, items);
        releases = [release];
        const memberKeys = new Set(items.map((item) =>
          `${item.id}@${item.revision}`));
        reviewDecisions = db.prepare(`
          SELECT *
          FROM knowledge_review_decisions
          WHERE root_scope_id=?
          ORDER BY decision_sequence
        `).all(normalizedRoot)
          .filter((row) =>
            memberKeys.has(`${row.item_id}@${row.result_revision}`))
          .map(reviewDecisionFromRow);
        releaseActivations = db.prepare(`
          SELECT *
          FROM knowledge_release_activations
          WHERE root_scope_id=? AND release_id=?
          ORDER BY activation_sequence
        `).all(normalizedRoot, normalizedRelease)
          .map(releaseActivationFromRow);
        events = [];
      } else {
        scopes = db.prepare(`
          SELECT *
          FROM knowledge_scopes
          WHERE root_scope_id=?
          ORDER BY scope_id
        `).all(normalizedRoot).map(scopeFromRow);
        items = db.prepare(`
          SELECT *
          FROM knowledge_items
          WHERE root_scope_id=?
          ORDER BY item_id,revision
        `).all(normalizedRoot).map(itemFromRow);
        releases = db.prepare(`
          SELECT *
          FROM knowledge_releases
          WHERE root_scope_id=?
          ORDER BY created_at,release_id
        `).all(normalizedRoot).map(releaseFromRow);
        reviewDecisions = db.prepare(`
          SELECT *
          FROM knowledge_review_decisions
          WHERE root_scope_id=?
          ORDER BY decision_sequence
        `).all(normalizedRoot).map(reviewDecisionFromRow);
        releaseActivations = db.prepare(`
          SELECT *
          FROM knowledge_release_activations
          WHERE root_scope_id=?
          ORDER BY activation_sequence
        `).all(normalizedRoot).map(releaseActivationFromRow);
        events = db.prepare(`
          SELECT *
          FROM knowledge_events
          WHERE root_scope_id=?
          ORDER BY sequence
        `).all(normalizedRoot).map(eventFromRow);
      }
      const body = {
        schema: KNOWLEDGE_EXPORT_SCHEMA,
        storeSchema: KNOWLEDGE_STORE_SCHEMA,
        kind: normalizedRelease ? "release" : "scope",
        rootScopeId: normalizedRoot,
        releaseId: normalizedRelease,
        scopes,
        items,
        releases,
        reviewDecisions,
        releaseActivations,
        events,
      };
      return assertKnowledgeContract({
        ...body,
        hash: contentHash(body, { maxBytes: MAX_AGGREGATE_JSON_BYTES }),
      }, {
        schemaId: KNOWLEDGE_EXPORT_SCHEMA,
        label: "Knowledge export",
      });
    });
  }

  serializeExport(exportValue) {
    if (!SUPPORTED_KNOWLEDGE_EXPORT_SCHEMAS.has(exportValue?.schema)) {
      throw new Error(
        `Schema de export não suportado: ${exportValue?.schema ?? "ausente"}.`,
      );
    }
    assertKnowledgeContract(exportValue, {
      schemaId: exportValue.schema,
      label: "Knowledge export",
    });
    if (
      exportValue?.hash !== contentHash(
        Object.fromEntries(
          Object.entries(exportValue).filter(([key]) => key !== "hash"),
        ),
        { maxBytes: MAX_AGGREGATE_JSON_BYTES },
      )
    ) {
      throw new Error("Export do Knowledge Store inválido ou adulterado.");
    }
    return canonicalJson(exportValue, {
      pretty: true,
      maxBytes: MAX_AGGREGATE_JSON_BYTES,
    });
  }

  checkIntegrity({ grant, rootScopeId } = {}) {
    const normalizedRoot = identifier(rootScopeId, "rootScopeId");
    this.#assertGrant(grant, normalizedRoot, "integrity");
    return this.#withReadDb((db) => {
      const structure = inspectStoreStructure(db);
      let rootReport;
      try {
        rootReport = inspectRootData(db, normalizedRoot);
      } catch {
        rootReport = {
          ok: false,
          issues: [{ type: "store-structure" }],
          ledgerHead: null,
        };
      }
      const issues = [...structure.issues, ...rootReport.issues];
      return {
        schema: KNOWLEDGE_INTEGRITY_SCHEMA,
        storeSchema: KNOWLEDGE_STORE_SCHEMA,
        rootScopeId: normalizedRoot,
        ok: issues.length === 0,
        sqlite: structure.sqlite,
        ledgerHead: rootReport.ledgerHead,
        migrations: structure.migrations.map((migration) => ({
          version: migration.version,
          id: migration.id,
          hash: migration.hash,
        })),
        issues,
      };
    }, { requireStructure: false });
  }
}

export function createKnowledgeStoreRepository({
  dbFile = null,
  localAppData = process.env.LOCALAPPDATA,
  coreRoot = DEFAULT_CORE_ROOT,
  clock = () => new Date(),
} = {}) {
  if (typeof clock !== "function") throw new Error("clock deve ser uma função.");
  const resolvedDbFile = resolveKnowledgeStorePath({
    dbFile,
    localAppData,
    coreRoot,
  });
  return new KnowledgeStoreRepository({
    dbFile: resolvedDbFile,
    coreRoot: realPathThroughExistingAncestor(coreRoot),
    clock,
  });
}

function statusBase(dbFile) {
  return {
    schema: KNOWLEDGE_STATUS_SCHEMA,
    storeSchema: KNOWLEDGE_STORE_SCHEMA,
    dbFile,
    exists: false,
    initialized: false,
    userVersion: 0,
    migrations: [],
    ledgerHeads: [],
    ledgerSummary: {
      rootCount: 0,
      eventCount: 0,
      headsAggregateHash: null,
    },
    grantEvidence: {
      canonicalEventCount: 0,
      legacyEventCount: 0,
    },
    issues: [],
  };
}

function sqliteTableExists(db, tableName) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type='table' AND name=?
  `).get(tableName));
}

function sanitizedStatusError(error) {
  return String(error?.message ?? error ?? "unknown")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[local-path]")
    .slice(0, 500);
}

export function readKnowledgeStoreStatus({
  dbFile = null,
  localAppData = process.env.LOCALAPPDATA,
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const resolvedDbFile = resolveKnowledgeStorePath({
    dbFile,
    localAppData,
    coreRoot,
  });
  const base = statusBase(resolvedDbFile);
  if (!existsSync(resolvedDbFile)) return base;
  let db;
  try {
    db = openReadOnlyDatabase(resolvedDbFile);
    return withReadSnapshot(db, () => {
      const report = inspectGlobalDatabase(db);
      return {
        ...base,
        exists: true,
        initialized: report.initialized,
        userVersion: report.userVersion,
        migrations: report.migrations,
        ledgerHeads: [],
        ledgerSummary: {
          rootCount: report.rootCount,
          eventCount: report.eventCount,
          headsAggregateHash: report.headsAggregateHash,
        },
        grantEvidence: report.grantEvidence,
        issues: report.issues,
      };
    });
  } catch (error) {
    return {
      ...base,
      exists: true,
      issues: [{ type: "status-read", detail: sanitizedStatusError(error) }],
    };
  } finally {
    db?.close();
  }
}

export function checkKnowledgeStoreIntegrity({
  dbFile = null,
  localAppData = process.env.LOCALAPPDATA,
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const resolvedDbFile = resolveKnowledgeStorePath({
    dbFile,
    localAppData,
    coreRoot,
  });
  const base = {
    schema: KNOWLEDGE_STORE_INTEGRITY_SCHEMA,
    storeSchema: KNOWLEDGE_STORE_SCHEMA,
    dbFile: resolvedDbFile,
    exists: false,
    initialized: false,
    ok: false,
    userVersion: 0,
    sqlite: [],
    foreignKeys: { ok: false, violationCount: 0, tables: [] },
    migrations: [],
    appendOnlyTriggers: {
      expected: [...APPEND_ONLY_TRIGGERS],
      missing: [...APPEND_ONLY_TRIGGERS],
    },
    ledgerSummary: {
      rootCount: 0,
      eventCount: 0,
      headsAggregateHash: null,
    },
    grantEvidence: {
      canonicalEventCount: 0,
      legacyEventCount: 0,
    },
    classificationFloor: "internal",
    issues: [],
  };
  if (!existsSync(resolvedDbFile)) {
    return {
      ...base,
      issues: [{ type: "not-initialized" }],
    };
  }
  let db;
  try {
    db = openReadOnlyDatabase(resolvedDbFile);
    return withReadSnapshot(db, () => {
      const report = inspectGlobalDatabase(db);
      return {
        ...base,
        exists: true,
        initialized: report.initialized,
        ok: report.ok,
        userVersion: report.userVersion,
        sqlite: report.sqlite,
        foreignKeys: {
          ok: report.foreignKeyRows.length === 0,
          violationCount: report.foreignKeyRows.length,
          tables: report.foreignKeyTables,
        },
        migrations: report.migrations,
        appendOnlyTriggers: {
          expected: [...APPEND_ONLY_TRIGGERS],
          missing: report.missingTriggers,
        },
        ledgerSummary: {
          rootCount: report.rootCount,
          eventCount: report.eventCount,
          headsAggregateHash: report.headsAggregateHash,
        },
        grantEvidence: report.grantEvidence,
        classificationFloor: report.classificationFloor,
        issues: report.issues,
      };
    });
  } catch (error) {
    return {
      ...base,
      exists: true,
      issues: [{
        type: "integrity-read",
        detail: sanitizedStatusError(error),
      }],
    };
  } finally {
    db?.close();
  }
}

export function createKnowledgeStoreSnapshotAdapter() {
  return Object.freeze({
    async createConsistentSnapshot({ sourceFile, destinationFile } = {}) {
      const source = path.resolve(requiredText(sourceFile, "sourceFile"));
      const destination = path.resolve(
        requiredText(destinationFile, "destinationFile"),
      );
      if (existsSync(destination)) {
        throw new Error("Snapshot SQLite não pode sobrescrever o destino.");
      }
      const db = openReadOnlyDatabase(source);
      try {
        assertStoreStructure(db);
        await sqliteBackup(db, destination);
      } finally {
        db.close();
      }
    },

    async inspectSnapshot({ snapshotFile } = {}) {
      const snapshot = path.resolve(
        requiredText(snapshotFile, "snapshotFile"),
      );
      const db = openReadOnlyDatabase(snapshot);
      try {
        assertStoreStructure(db);
        return {
          applicationId: pragmaInteger(db, "application_id"),
          userVersion: pragmaInteger(db, "user_version"),
        };
      } finally {
        db.close();
      }
    },
  });
}

export function initializeKnowledgeStore({
  dbFile = null,
  localAppData = process.env.LOCALAPPDATA,
  coreRoot = DEFAULT_CORE_ROOT,
  clock = () => new Date(),
} = {}) {
  if (typeof clock !== "function") throw new Error("clock deve ser uma função.");
  const resolvedDbFile = resolveKnowledgeStorePath({
    dbFile,
    localAppData,
    coreRoot,
  });
  const atValue = clock();
  const at = atValue instanceof Date ? atValue : new Date(atValue);
  if (!Number.isFinite(at.getTime())) {
    throw new Error("O clock do Knowledge Store retornou data inválida.");
  }
  const db = openDatabaseForInitialization(resolvedDbFile);
  try {
    applyMigrationsExplicitly(db, at.toISOString());
    configureWriteDatabase(db, { ensureWal: true });
    assertGloballyHealthy(db);
  } finally {
    db.close();
  }
  return readKnowledgeStoreStatus({
    dbFile: resolvedDbFile,
    coreRoot,
  });
}
