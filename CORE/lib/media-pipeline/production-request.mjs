import { createHash, randomUUID } from "node:crypto";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import { assertKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";

export const PRODUCTION_REQUEST_SCHEMA = "mkt-videos/production-request@1";
export const PRODUCTION_REQUEST_LIFECYCLE_EVENT_SCHEMA =
  "mkt-videos/production-request-lifecycle-event@1";
export const PRODUCTION_REQUEST_CREATED_EVENT_TYPE = "production-request.created";
export const PRODUCTION_REQUEST_SUBJECT_TYPE = "production-request";
export const PRODUCTION_REQUEST_LIFECYCLE_EVENT_TYPE = "production-request.lifecycle";

const REQUEST_ID = /^preq_[a-f0-9]{32}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ORIGINS = new Set(["human", "agent", "schedule"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CADENCE_MODES = new Set(["ad-hoc", "scheduled", "recurring"]);

// pending -> accepted -> linked -> completed, com rejected/cancelled como saídas.
// Qualquer transição fora deste mapa falha fechado (nunca assume estado implícito).
export const PRODUCTION_REQUEST_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["accepted", "rejected", "cancelled"]),
  accepted: Object.freeze(["production-linked", "cancelled"]),
  linked: Object.freeze(["completed", "cancelled"]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([]),
  completed: Object.freeze([]),
});

const LIFECYCLE_KIND_TO_STATUS = Object.freeze({
  accepted: "accepted",
  "production-linked": "linked",
  completed: "completed",
  rejected: "rejected",
  cancelled: "cancelled",
});

const NEXT_ACTION_BY_STATUS = Object.freeze({
  pending: "aguardando aceite",
  accepted: "aguardar vínculo de produção",
  linked: "aguardar conclusão da produção",
  completed: "nenhuma (estado terminal)",
  rejected: "nenhuma (estado terminal)",
  cancelled: "nenhuma (estado terminal)",
});

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Pedido de produção contém número não finito.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Pedido de produção deve conter somente valores JSON.");
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]),
    );
  }
  throw new Error("Pedido de produção deve conter somente valores JSON.");
}

function canonicalProductionJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function productionRequestHash(value) {
  return createHash("sha256").update(canonicalProductionJson(value), "utf8").digest("hex");
}

export function productionRequestLifecycleEventHash(value) {
  return createHash("sha256").update(canonicalProductionJson(value), "utf8").digest("hex");
}

export function newProductionRequestId() {
  return `preq_${randomUUID().replace(/-/gu, "")}`;
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function assertNullableId(value, label) {
  return value == null ? null : assertId(value, label);
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} deve ser SHA-256 hexadecimal.`);
  return value;
}

function requiredText(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`${label} deve ser texto normalizado entre 1 e ${max} caracteres.`);
  }
  return value;
}

function optionalText(value, label, max = 2000) {
  return value == null ? null : requiredText(String(value), label, max);
}

function assertRef(value, label, requiredKeys, hashKey) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto ou null.`);
  const extraKeys = Object.keys(value).filter((key) => !requiredKeys.includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const result = {};
  for (const key of requiredKeys) {
    result[key] = key === hashKey ? assertHash(value[key], `${label}.${key}`) : assertId(value[key], `${label}.${key}`);
  }
  return result;
}

function assertCapabilityList(value, label) {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} deve ser lista com no máximo 64 itens.`);
  const normalized = value.map((entry, index) => assertId(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} não aceita itens duplicados.`);
  return normalized;
}

function assertRefList(value, label, { max = 128 } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} deve ser lista com no máximo ${max} itens.`);
  const normalized = value.map((entry, index) => assertId(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} não aceita referências duplicadas.`);
  return normalized;
}

function assertCadencePolicy(value, label) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto ou null.`);
  const extraKeys = Object.keys(value).filter((key) => key !== "mode" && key !== "scheduleRef");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (!CADENCE_MODES.has(value.mode)) throw new Error(`${label}.mode inválido.`);
  return { mode: value.mode, scheduleRef: assertNullableId(value.scheduleRef, `${label}.scheduleRef`) };
}

/**
 * Constrói um production-request@1 imutável. O pedido nunca concede direitos
 * nem autorização de gasto — authorizationRef é só um ponteiro para a
 * production-provider-input-authorization@1 aplicável, avaliada em outra
 * camada (plano §5.1 e §5.3).
 */
export function createProductionRequest({
  requestId = newProductionRequestId(),
  rootScopeId,
  scopeId,
  actor,
  origin,
  requestedAt,
  projectId = null,
  campaignId = null,
  deliverable,
  objective,
  audience = null,
  channel = null,
  format = null,
  deadline = null,
  recipeRef = null,
  directorReleaseRef = null,
  creativeEnvelopeRef = null,
  desiredCapabilities = [],
  requiredCapabilities = [],
  priority = "normal",
  cadencePolicy = null,
  idempotencyKey,
  rightsEvidenceRefs = [],
  authorizationRef = null,
  governance,
} = {}) {
  if (!REQUEST_ID.test(requestId)) throw new Error("requestId inválido.");
  if (!ORIGINS.has(origin)) throw new Error("origin inválido.");
  if (!PRIORITIES.has(priority)) throw new Error("priority inválido.");
  const request = {
    schema: PRODUCTION_REQUEST_SCHEMA,
    requestId,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    scopeId: assertId(scopeId, "scopeId"),
    actor: requiredText(actor, "actor", 200),
    origin,
    requestedAt: requiredText(requestedAt, "requestedAt", 64),
    projectId: assertNullableId(projectId, "projectId"),
    campaignId: assertNullableId(campaignId, "campaignId"),
    deliverable: requiredText(deliverable, "deliverable", 200),
    objective: requiredText(objective, "objective", 2000),
    audience: optionalText(audience, "audience", 500),
    channel: optionalText(channel, "channel", 200),
    format: optionalText(format, "format", 200),
    deadline: optionalText(deadline, "deadline", 64),
    recipeRef: assertRef(recipeRef, "recipeRef", ["templateId", "templateRevision", "templateHash"], "templateHash"),
    directorReleaseRef: assertRef(directorReleaseRef, "directorReleaseRef", ["directorId", "releaseId", "releaseHash"], "releaseHash"),
    creativeEnvelopeRef: assertRef(creativeEnvelopeRef, "creativeEnvelopeRef", ["directorId", "releaseId", "envelopeHash"], "envelopeHash"),
    desiredCapabilities: assertCapabilityList(desiredCapabilities, "desiredCapabilities"),
    requiredCapabilities: assertCapabilityList(requiredCapabilities, "requiredCapabilities"),
    priority,
    cadencePolicy: assertCadencePolicy(cadencePolicy, "cadencePolicy"),
    idempotencyKey: requiredText(idempotencyKey, "idempotencyKey", 200),
    rightsEvidenceRefs: assertRefList(rightsEvidenceRefs, "rightsEvidenceRefs"),
    authorizationRef: assertNullableId(authorizationRef, "authorizationRef"),
    governance: assertKnowledgeRecordEnvelope(governance),
  };
  if (request.recipeRef) {
    request.recipeRef.templateRevision = Number(recipeRef.templateRevision);
    if (!Number.isInteger(request.recipeRef.templateRevision) || request.recipeRef.templateRevision < 1) {
      throw new Error("recipeRef.templateRevision deve ser inteiro positivo.");
    }
  }
  assertKnowledgeContract(request, { schemaId: PRODUCTION_REQUEST_SCHEMA, label: "production-request@1" });
  return request;
}

export function assertProductionRequest(value, { label = "production-request@1" } = {}) {
  assertKnowledgeContract(value, { schemaId: PRODUCTION_REQUEST_SCHEMA, label });
  const rebuilt = createProductionRequest(value);
  if (productionRequestHash(rebuilt) !== productionRequestHash(value)) {
    throw new Error(`${label} diverge do conteúdo canônico.`);
  }
  return value;
}

export function createProductionRequestLifecycleEvent({
  requestId,
  rootScopeId,
  kind,
  actor,
  at,
  reason = null,
  productionId = null,
} = {}) {
  if (!REQUEST_ID.test(requestId)) throw new Error("requestId inválido.");
  if (!(kind in LIFECYCLE_KIND_TO_STATUS)) throw new Error(`kind inválido: ${kind}.`);
  const event = {
    schema: PRODUCTION_REQUEST_LIFECYCLE_EVENT_SCHEMA,
    requestId,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    kind,
    actor: requiredText(actor, "actor", 200),
    at: requiredText(at, "at", 64),
    reason: optionalText(reason, "reason", 2000),
    productionId: assertNullableId(productionId, "productionId"),
  };
  if (kind === "production-linked" && event.productionId == null) {
    throw new Error("production-linked exige productionId.");
  }
  if (kind !== "production-linked" && event.productionId != null) {
    throw new Error("productionId só é permitido em production-linked.");
  }
  if ((kind === "rejected" || kind === "cancelled") && event.reason == null) {
    throw new Error(`${kind} exige reason.`);
  }
  assertKnowledgeContract(event, { schemaId: PRODUCTION_REQUEST_LIFECYCLE_EVENT_SCHEMA, label: "production-request-lifecycle-event@1" });
  return event;
}

export function assertProductionRequestLifecycleEvent(value, { label = "production-request-lifecycle-event@1" } = {}) {
  assertKnowledgeContract(value, { schemaId: PRODUCTION_REQUEST_LIFECYCLE_EVENT_SCHEMA, label });
  const rebuilt = createProductionRequestLifecycleEvent(value);
  if (productionRequestLifecycleEventHash(rebuilt) !== productionRequestLifecycleEventHash(value)) {
    throw new Error(`${label} diverge do conteúdo canônico.`);
  }
  return value;
}

/**
 * Reduz o stream (created + lifecycle) a uma production-request-projection@1
 * reconstruível. Qualquer transição fora de PRODUCTION_REQUEST_TRANSITIONS
 * falha fechado em vez de assumir o último kind como verdade.
 */
export function projectProductionRequestState({ request, lifecycleEvents = [] } = {}) {
  const validatedRequest = assertProductionRequest(request);
  let status = "pending";
  let linkedProductionId = null;
  const history = [];
  for (const rawEvent of lifecycleEvents) {
    const event = assertProductionRequestLifecycleEvent(rawEvent);
    if (event.requestId !== validatedRequest.requestId || event.rootScopeId !== validatedRequest.rootScopeId) {
      throw new Error("Evento de ciclo de vida não pertence a este pedido.");
    }
    const allowed = PRODUCTION_REQUEST_TRANSITIONS[status] ?? [];
    if (!allowed.includes(event.kind)) {
      throw new Error(`Transição inválida: ${status} -> ${event.kind}.`);
    }
    status = LIFECYCLE_KIND_TO_STATUS[event.kind];
    if (event.kind === "production-linked") linkedProductionId = event.productionId;
    history.push({ kind: event.kind, actor: event.actor, at: event.at, reason: event.reason, productionId: event.productionId });
  }
  return {
    schema: "mkt-videos/production-request-projection@1",
    requestId: validatedRequest.requestId,
    rootScopeId: validatedRequest.rootScopeId,
    status,
    nextAction: NEXT_ACTION_BY_STATUS[status],
    linkedProductionId,
    history,
    request: validatedRequest,
  };
}
