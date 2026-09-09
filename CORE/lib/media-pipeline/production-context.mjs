import { operationFingerprint } from "./pipeline-operation.mjs";

export const PRODUCTION_CONTEXT_BINDING_SCHEMA = "mkt-videos/production-context-binding@1";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^preq_[a-f0-9]{32}$/u;

function clone(value) {
  return value == null ? value : structuredClone(value);
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

function assertNullableHash(value, label) {
  return value == null ? null : assertHash(value, label);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  return value;
}

function assertIdList(value, label, { max = 128 } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} deve ser lista com no máximo ${max} itens.`);
  const normalized = value.map((entry, index) => assertId(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} não aceita itens duplicados.`);
  return normalized;
}

function assertProductionRequestRef(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "requestId" && key !== "requestHash");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (!REQUEST_ID.test(value.requestId)) throw new Error(`${label}.requestId inválido.`);
  return { requestId: value.requestId, requestHash: assertHash(value.requestHash, `${label}.requestHash`) };
}

function assertRecipeTemplateRef(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["templateId", "templateRevision", "templateHash"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const templateRevision = Number(value.templateRevision);
  if (!Number.isInteger(templateRevision) || templateRevision < 1) {
    throw new Error(`${label}.templateRevision deve ser inteiro positivo.`);
  }
  return {
    templateId: assertId(value.templateId, `${label}.templateId`),
    templateRevision,
    templateHash: assertHash(value.templateHash, `${label}.templateHash`),
  };
}

function assertDirectorRef(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["directorId", "releaseId", "releaseHash", "fingerprint"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  return {
    directorId: assertId(value.directorId, `${label}.directorId`),
    releaseId: assertId(value.releaseId, `${label}.releaseId`),
    releaseHash: assertHash(value.releaseHash, `${label}.releaseHash`),
    fingerprint: assertHash(value.fingerprint, `${label}.fingerprint`),
  };
}

function assertCapabilitySnapshot(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "capabilities" && key !== "capturedAt");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) {
    throw new Error(`${label}.capturedAt deve ser timestamp ISO-8601.`);
  }
  return { capabilities: assertIdList(value.capabilities ?? [], `${label}.capabilities`), capturedAt: value.capturedAt };
}

function assertExecutionPolicy(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "maxAttempts" && key !== "retryPolicy");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const maxAttempts = Number(value.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${label}.maxAttempts deve ser inteiro positivo.`);
  if (!["fixed", "exponential"].includes(value.retryPolicy)) throw new Error(`${label}.retryPolicy inválido.`);
  return { maxAttempts, retryPolicy: value.retryPolicy };
}

function validatedBody({
  rootScopeId,
  projectId = null,
  campaignId = null,
  productionId = null,
  deliverableId = null,
  productionRequestRef = null,
  briefHash = null,
  recipeTemplateRef = null,
  directorRef = null,
  directorValidationRef = null,
  decisionArtifactsHash = null,
  motionBankRef = null,
  rightsEvidenceRefs = [],
  knowledgeContextBindingHash = null,
  capabilitySnapshot = null,
  executionPolicy = null,
} = {}) {
  return {
    schema: PRODUCTION_CONTEXT_BINDING_SCHEMA,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    projectId: assertNullableId(projectId, "projectId"),
    campaignId: assertNullableId(campaignId, "campaignId"),
    productionId: assertNullableId(productionId, "productionId"),
    deliverableId: assertNullableId(deliverableId, "deliverableId"),
    productionRequestRef: assertProductionRequestRef(productionRequestRef, "productionRequestRef"),
    briefHash: assertNullableHash(briefHash, "briefHash"),
    recipeTemplateRef: assertRecipeTemplateRef(recipeTemplateRef, "recipeTemplateRef"),
    directorRef: assertDirectorRef(directorRef, "directorRef"),
    directorValidationRef: assertNullableId(directorValidationRef, "directorValidationRef"),
    decisionArtifactsHash: assertNullableHash(decisionArtifactsHash, "decisionArtifactsHash"),
    motionBankRef: assertNullableId(motionBankRef, "motionBankRef"),
    rightsEvidenceRefs: assertIdList(rightsEvidenceRefs, "rightsEvidenceRefs"),
    knowledgeContextBindingHash: assertNullableHash(knowledgeContextBindingHash, "knowledgeContextBindingHash"),
    capabilitySnapshot: assertCapabilitySnapshot(capabilitySnapshot, "capabilitySnapshot"),
    executionPolicy: assertExecutionPolicy(executionPolicy, "executionPolicy"),
  };
}

/**
 * Constrói o production-context-binding@1: criado depois que brief e pedido
 * já estão materializados/hasheados, ficando adjacente ao brief dentro do
 * film-spec@2 (plano §5.2). Referencia outros artefatos congelados só por
 * hash (nunca reembute) para não criar ciclo de hash com o spec.
 * capabilitySnapshot é evidência congelada, nunca autoridade — quem executa
 * revalida direitos/capability no runtime guard, não confia neste campo.
 */
export function buildProductionContextBinding(input = {}) {
  const body = validatedBody(input);
  return { ...body, hash: operationFingerprint(body) };
}

// Revalida cada campo a partir do value recebido (nunca confia em hash sem
// recomputar) e só então compara contra value.hash: se um campo foi editado
// sem recalcular o hash, a divergência aparece aqui — igual assertKnowledgeContextBinding.
export function assertProductionContextBinding(value, { label = "productionContextBinding" } = {}) {
  assertObject(value, label);
  if (value.schema !== PRODUCTION_CONTEXT_BINDING_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const body = validatedBody(value);
  assertHash(value.hash, `${label}.hash`);
  const expected = operationFingerprint(body);
  if (value.hash !== expected) throw new Error(`${label} diverge do binding canônico.`);
  return clone(value);
}
