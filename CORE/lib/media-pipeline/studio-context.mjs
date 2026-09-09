import { operationFingerprint } from "./pipeline-operation.mjs";
import {
  assertStudioDecisionArtifacts,
} from "./studio-decision-artifacts.mjs";

export const STUDIO_BRIEF_SCHEMA = "mkt-videos/studio-brief@1";
export const KNOWLEDGE_CONTEXT_BINDING_SCHEMA = "mkt-videos/knowledge-context-binding@1";

export function assertStudioDecisionArtifactsForContext(value, { contextHash = null, label = "decisionArtifacts" } = {}) {
  const artifacts = assertStudioDecisionArtifacts(value, { label });
  if (contextHash != null && artifacts.contextHash !== contextHash) {
    throw new Error(`${label}.contextHash diverge do knowledge-context congelado.`);
  }
  return artifacts;
}

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const CONTEXT_ID = /^kc_[a-f0-9]{32}$/u;
const TRACE_ID = /^rt_[a-f0-9]{32}$/u;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function requiredText(value, label, max = 4096) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`${label} deve ser texto normalizado entre 1 e ${max} caracteres.`);
  }
  if (/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new Error(`${label} contém controle proibido.`);
  return value;
}

function optionalText(value, label, max = 4096) {
  if (value == null) return null;
  return requiredText(String(value), label, max);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} deve ser SHA-256 hexadecimal.`);
  return value;
}

function assertList(value, label, { max = 128 } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} deve ser uma lista com no máximo ${max} itens.`);
  return value.map((entry, index) => requiredText(String(entry), `${label}[${index}]`, 1024));
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  return value;
}

export function studioBriefHash(value) {
  const { hash: _hash, ...body } = value ?? {};
  return operationFingerprint(body);
}

export function createStudioBrief({
  briefId,
  userBrief,
  objective,
  audience = null,
  message = null,
  genre = null,
  channel = null,
  format = null,
  durationSeconds = null,
  clientId = null,
  brandId = null,
  projectId = null,
  requiredText: requiredOnScreenText = [],
  restrictions = [],
  cta = null,
  language = "pt-BR",
  accessibility = [],
  references = [],
  preferences = [],
  budget = null,
  deadline = null,
  intent = null,
  knowledgeContextHash = null,
} = {}) {
  const brief = {
    schema: STUDIO_BRIEF_SCHEMA,
    briefId: assertId(briefId, "briefId"),
    userBrief: requiredText(userBrief, "userBrief"),
    objective: requiredText(objective, "objective"),
    audience: optionalText(audience, "audience"),
    message: optionalText(message, "message"),
    genre: optionalText(genre, "genre"),
    channel: optionalText(channel, "channel"),
    format: optionalText(format, "format"),
    durationSeconds: durationSeconds == null ? null : Number(durationSeconds),
    clientId: clientId == null ? null : assertId(clientId, "clientId"),
    brandId: brandId == null ? null : assertId(brandId, "brandId"),
    projectId: projectId == null ? null : assertId(projectId, "projectId"),
    requiredText: assertList(requiredOnScreenText, "requiredText"),
    restrictions: assertList(restrictions, "restrictions"),
    cta: optionalText(cta, "cta"),
    language: requiredText(language, "language", 64),
    accessibility: assertList(accessibility, "accessibility"),
    references: assertList(references, "references"),
    preferences: assertList(preferences, "preferences"),
    budget: budget == null ? null : assertObject(budget, "budget"),
    deadline: optionalText(deadline, "deadline", 128),
    intent: optionalText(intent, "intent"),
    knowledgeContextHash: knowledgeContextHash == null ? null : assertHash(knowledgeContextHash, "knowledgeContextHash"),
  };
  if (brief.durationSeconds != null && (!Number.isFinite(brief.durationSeconds) || brief.durationSeconds <= 0)) {
    throw new Error("brief.durationSeconds deve ser positivo.");
  }
  return { ...brief, hash: studioBriefHash(brief) };
}

export function assertStudioBrief(value, { label = "brief" } = {}) {
  assertObject(value, label);
  if (value.schema !== STUDIO_BRIEF_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const rebuilt = createStudioBrief({
    ...value,
    requiredText: value.requiredText,
  });
  if (Object.keys(value).some((key) => !Object.hasOwn(rebuilt, key))) throw new Error(`${label} contém campo desconhecido fora do hash canônico.`);
  if (value.hash !== rebuilt.hash) throw new Error(`${label}.hash diverge do conteúdo canônico.`);
  return clone(value);
}

export function assertKnowledgeContextSnapshot(value, { label = "knowledgeContext" } = {}) {
  assertObject(value, label);
  if (value.schema !== "mkt-videos/knowledge-context@1") throw new Error(`${label}.schema inválido.`);
  assertId(value.rootScopeId, `${label}.rootScopeId`);
  if (value.releaseId != null) assertId(value.releaseId, `${label}.releaseId`);
  if (value.releaseHash != null) assertHash(value.releaseHash, `${label}.releaseHash`);
  assertHash(value.requestHash, `${label}.requestHash`);
  if (!CONTEXT_ID.test(value.contextId)) throw new Error(`${label}.contextId inválido.`);
  if (!TRACE_ID.test(value.retrievalTraceId)) throw new Error(`${label}.retrievalTraceId inválido.`);
  if (value.authority !== "none" || value.plannerInfluence !== "none") throw new Error(`${label} não pode conceder autoridade nem influência ao planner.`);
  if (value.rankerVersion !== "lexical-ranker@1") throw new Error(`${label}.rankerVersion incompatível.`);
  if (!value.scope || value.scope.rootScopeId !== value.rootScopeId || !Array.isArray(value.scope.scopeIds)) throw new Error(`${label}.scope diverge do root.`);
  if (!Array.isArray(value.appliedItems) || !Array.isArray(value.excludedItems) || !Array.isArray(value.conflicts) || !Array.isArray(value.overrides)) throw new Error(`${label} possui projeções inválidas.`);
  assertHash(value.hash, `${label}.hash`);
  const expected = operationFingerprint(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "hash")));
  if (value.hash !== expected) throw new Error(`${label}.hash diverge do conteúdo canônico.`);
  return clone(value);
}

export function buildKnowledgeContextBinding(context, { briefHash = null } = {}) {
  const snapshot = assertKnowledgeContextSnapshot(context);
  if (briefHash != null) assertHash(briefHash, "briefHash");
  const binding = {
    schema: KNOWLEDGE_CONTEXT_BINDING_SCHEMA,
    rootScopeId: snapshot.rootScopeId,
    releaseId: snapshot.releaseId,
    releaseHash: snapshot.releaseHash,
    requestHash: snapshot.requestHash,
    contextId: snapshot.contextId,
    contextHash: snapshot.hash,
    retrievalTraceId: snapshot.retrievalTraceId,
    rankerVersion: snapshot.rankerVersion,
    briefHash,
    authority: "none",
    plannerInfluence: "none",
  };
  return { ...binding, hash: operationFingerprint(binding) };
}

export function assertKnowledgeContextBinding(value, { context = null, briefHash = null, label = "knowledgeContextBinding" } = {}) {
  assertObject(value, label);
  if (value.schema !== KNOWLEDGE_CONTEXT_BINDING_SCHEMA) throw new Error(`${label}.schema inválido.`);
  assertId(value.rootScopeId, `${label}.rootScopeId`);
  if (value.releaseId != null) assertId(value.releaseId, `${label}.releaseId`);
  if (value.releaseHash != null) assertHash(value.releaseHash, `${label}.releaseHash`);
  assertHash(value.requestHash, `${label}.requestHash`);
  assertHash(value.contextHash, `${label}.contextHash`);
  if (!CONTEXT_ID.test(value.contextId) || !TRACE_ID.test(value.retrievalTraceId)) throw new Error(`${label} possui ID inválido.`);
  if (value.briefHash != null) assertHash(value.briefHash, `${label}.briefHash`);
  if (briefHash != null && value.briefHash !== briefHash) throw new Error(`${label}.briefHash diverge do brief.`);
  if (value.authority !== "none" || value.plannerInfluence !== "none") throw new Error(`${label} não pode conceder autoridade ou plannerInfluence.`);
  assertHash(value.hash, `${label}.hash`);
  const expected = operationFingerprint(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "hash")));
  if (value.hash !== expected) throw new Error(`${label}.hash diverge do binding canônico.`);
  if (context != null) {
    const snapshot = assertKnowledgeContextSnapshot(context);
    if (snapshot.contextId !== value.contextId || snapshot.hash !== value.contextHash || snapshot.rootScopeId !== value.rootScopeId) {
      throw new Error(`${label} não corresponde ao knowledge-context congelado.`);
    }
  }
  return clone(value);
}

export function studioReceiptContextMetadata({ brief = null, knowledgeContext = null, binding = null } = {}) {
  const validatedBrief = brief == null ? null : assertStudioBrief(brief);
  const validatedContext = knowledgeContext == null ? null : assertKnowledgeContextSnapshot(knowledgeContext);
  const expectedBriefHash = validatedBrief?.hash ?? null;
  const validatedBinding = binding == null
    ? (validatedContext == null ? null : buildKnowledgeContextBinding(validatedContext, { briefHash: expectedBriefHash }))
    : assertKnowledgeContextBinding(binding, { context: validatedContext, briefHash: expectedBriefHash });
  return {
    ...(expectedBriefHash ? { briefHash: expectedBriefHash } : {}),
    ...(validatedBinding ? { knowledgeContext: validatedBinding, knowledgeContextHash: validatedBinding.contextHash } : {}),
  };
}
