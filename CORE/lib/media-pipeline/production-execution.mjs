import { operationFingerprint } from "./pipeline-operation.mjs";

export const PRODUCTION_EXECUTION_BINDING_SCHEMA = "mkt-videos/production-execution-binding@1";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const STATES = new Set(["planned", "executing", "completed", "failed", "cancelled"]);
const RETRY_POLICIES = new Set(["fixed", "exponential"]);
// Precisam ficar em sincronia com as constantes internas (não exportadas) de
// direct-provider-input-permit.mjs — inputAuthority só referencia dados, nunca
// o permit vivo (ele é ligado por identidade de objeto num WeakSet e não
// sobrevive a serialização).
const INPUT_ROLES = new Set(["first-frame", "reference-image", "reference-video"]);
const INPUT_OPERATIONS = new Set(["generate-image", "generate-video"]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  return value;
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} deve ser SHA-256 hexadecimal.`);
  return value;
}

function assertRetryPolicy(value, label) {
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "maxAttempts" && key !== "policy");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const maxAttempts = Number(value.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${label}.maxAttempts deve ser inteiro positivo.`);
  if (!RETRY_POLICIES.has(value.policy)) throw new Error(`${label}.policy inválida.`);
  return { maxAttempts, policy: value.policy };
}

function assertAuthorityInput(value, label) {
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["sha256", "bytes", "mimeType", "role", "operation"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const bytes = Number(value.bytes);
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error(`${label}.bytes deve ser inteiro positivo.`);
  if (!INPUT_ROLES.has(value.role)) throw new Error(`${label}.role inválido.`);
  if (!INPUT_OPERATIONS.has(value.operation)) throw new Error(`${label}.operation inválido.`);
  return {
    sha256: assertHash(value.sha256, `${label}.sha256`),
    bytes,
    mimeType: String(value.mimeType ?? "").trim() || (() => { throw new Error(`${label}.mimeType é obrigatório.`); })(),
    role: value.role,
    operation: value.operation,
  };
}

/**
 * inputAuthority nunca reimplementa a autorização — só a referencia:
 * "ad-hoc" é reconstruído no runtime guard, JIT, por invocação, e não tem
 * conteúdo persistível aqui; "production" espelha exatamente os campos de
 * mkt-videos/production-provider-input-authorization@1.inputs[] (plano §5.3)
 * como dados puros, nunca o permit vivo (ele é ligado por identidade de
 * objeto e não sobrevive a serialização — ver direct-provider-input-permit.mjs).
 */
function assertInputAuthority(value, label) {
  assertObject(value, label);
  if (value.mode === "ad-hoc") {
    const extraKeys = Object.keys(value).filter((key) => key !== "mode");
    if (extraKeys.length) throw new Error(`${label} ad-hoc não aceita campos além de mode.`);
    return { mode: "ad-hoc" };
  }
  if (value.mode === "production") {
    const extraKeys = Object.keys(value).filter((key) => key !== "mode" && key !== "productionId" && key !== "inputs");
    if (extraKeys.length) throw new Error(`${label} production possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
    if (!Array.isArray(value.inputs) || value.inputs.length === 0 || value.inputs.length > 64) {
      throw new Error(`${label}.inputs deve ter entre 1 e 64 itens.`);
    }
    return {
      mode: "production",
      productionId: assertId(value.productionId, `${label}.productionId`),
      inputs: value.inputs.map((entry, index) => assertAuthorityInput(entry, `${label}.inputs[${index}]`)),
    };
  }
  throw new Error(`${label}.mode deve ser ad-hoc ou production.`);
}

function validatedBody({
  contextBindingHash,
  planFingerprint,
  executionId,
  state,
  retryPolicy,
  inputAuthority,
} = {}) {
  return {
    schema: PRODUCTION_EXECUTION_BINDING_SCHEMA,
    contextBindingHash: assertHash(contextBindingHash, "contextBindingHash"),
    planFingerprint: assertHash(planFingerprint, "planFingerprint"),
    executionId: assertId(executionId, "executionId"),
    state: STATES.has(state) ? state : (() => { throw new Error("state inválido."); })(),
    retryPolicy: assertRetryPolicy(retryPolicy, "retryPolicy"),
    inputAuthority: assertInputAuthority(inputAuthority, "inputAuthority"),
  };
}

/**
 * Constrói o production-execution-binding@1: só depois da compilação, sem
 * ciclo de hash (plano §5.3). Referencia o context-binding e o plano só por
 * hash — o corpo privado de ambos continua no snapshot/spec/plano governado,
 * este binding não os reembute.
 */
export function buildProductionExecutionBinding(input = {}) {
  const body = validatedBody(input);
  return { ...body, hash: operationFingerprint(body) };
}

export function assertProductionExecutionBinding(value, { label = "productionExecutionBinding" } = {}) {
  assertObject(value, label);
  if (value.schema !== PRODUCTION_EXECUTION_BINDING_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const body = validatedBody(value);
  assertHash(value.hash, `${label}.hash`);
  const expected = operationFingerprint(body);
  if (value.hash !== expected) throw new Error(`${label} diverge do binding canônico.`);
  return clone(value);
}

/**
 * Guarda de transição de estado: falha fechado em qualquer ordem que não seja
 * planned -> executing -> completed|failed, com cancelled possível a partir
 * de planned ou executing. Não há retry automático nem fallback silencioso.
 */
export const PRODUCTION_EXECUTION_STATE_TRANSITIONS = Object.freeze({
  planned: Object.freeze(["executing", "cancelled"]),
  executing: Object.freeze(["completed", "failed", "cancelled"]),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export function assertProductionExecutionStateTransition(fromState, toState) {
  const allowed = PRODUCTION_EXECUTION_STATE_TRANSITIONS[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new Error(`Transição de execução inválida: ${fromState} -> ${toState}.`);
  }
}
