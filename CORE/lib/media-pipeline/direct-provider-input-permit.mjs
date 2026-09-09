import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { inferMimeType } from "./artifact.mjs";

export const DIRECT_PROVIDER_INPUT_PERMIT_SCHEMA =
  "mkt-videos/direct-provider-input-permit@1";
export const PRODUCTION_PROVIDER_INPUT_AUTHORIZATION_SCHEMA =
  "mkt-videos/production-provider-input-authorization@1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INPUT_ROLES = new Set([
  "first-frame",
  "reference-image",
  "reference-video",
]);
const INPUT_OPERATIONS = new Set(["generate-image", "generate-video"]);
const PERMIT_ACTORS = new Set(["local-cli-human", "local-app-human"]);
const MAX_DIRECT_PROVIDER_INPUTS = 4;
const MAX_PRODUCTION_PROVIDER_INPUTS = 64;
const permittedObjects = new WeakSet();
const permitBindings = new WeakMap();

function requiredText(value, label, maxLength = 160) {
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

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("createdAt do permit é inválido.");
  }
  return date.toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Json(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`${label} contém campos ausentes ou não permitidos.`);
  }
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function inputMimeType(file, role) {
  const mimeType = inferMimeType(file);
  if (role === "reference-video") {
    if (!mimeType.startsWith("video/")) {
      throw new Error(`Entrada ${role} precisa ter extensão de vídeo reconhecida.`);
    }
  } else if (!mimeType.startsWith("image/")) {
    throw new Error(`Entrada ${role} precisa ter extensão de imagem reconhecida.`);
  }
  return mimeType;
}

function normalizeInputDescriptor({ file, role, operation } = {}, index) {
  const absolute = path.resolve(requiredText(file, `inputs[${index}].file`, 32_768));
  const normalizedRole = requiredText(role, `inputs[${index}].role`);
  const normalizedOperation = requiredText(
    operation,
    `inputs[${index}].operation`,
  );
  if (!INPUT_ROLES.has(normalizedRole)) {
    throw new Error(`inputs[${index}].role não é permitido.`);
  }
  if (!INPUT_OPERATIONS.has(normalizedOperation)) {
    throw new Error(`inputs[${index}].operation não é permitida.`);
  }
  if (
    normalizedOperation === "generate-image"
    && normalizedRole !== "reference-image"
  ) {
    throw new Error("generate-image aceita somente role reference-image.");
  }
  const mimeType = inputMimeType(absolute, normalizedRole);
  return {
    file: absolute,
    role: normalizedRole,
    operation: normalizedOperation,
    mimeType,
  };
}

async function inspectFile(descriptor, index, inputId = null) {
  const {
    file: absolute,
    role: normalizedRole,
    operation: normalizedOperation,
    mimeType,
  } = normalizeInputDescriptor(descriptor, index);
  const handle = await open(absolute, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`Entrada ${index + 1} não é um arquivo regular.`);
    }
    if (!Number.isSafeInteger(before.size) || before.size < 0) {
      throw new Error(`Entrada ${index + 1} possui tamanho inválido.`);
    }
    if (before.size === 0) {
      throw new Error(`Entrada ${index + 1} está vazia.`);
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (
      before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes !== after.size
    ) {
      throw new Error(`Entrada ${index + 1} mudou durante o preflight.`);
    }

    return {
      binding: {
        file: absolute,
        role: normalizedRole,
        operation: normalizedOperation,
      },
      projection: {
        inputId: inputId ?? `input-${String(index + 1).padStart(3, "0")}`,
        sha256: hash.digest("hex"),
        bytes,
        mimeType,
        role: normalizedRole,
        operation: normalizedOperation,
      },
    };
  } finally {
    await handle.close();
  }
}

function permitBody({ invocationId, actor, createdAt, inputs, purpose }) {
  return {
    schema: DIRECT_PROVIDER_INPUT_PERMIT_SCHEMA,
    version: 1,
    invocationId,
    actor,
    purpose,
    authority: "explicit-single-invocation-confirmation",
    reusable: false,
    knowledgeCoreAuthority: false,
    createdAt,
    inputs,
  };
}

function productionAuthorizationBody({ productionId, actor, issuedAt, inputs, retryPolicy, maxAttempts }) {
  return {
    schema: PRODUCTION_PROVIDER_INPUT_AUTHORIZATION_SCHEMA,
    version: 1,
    productionId,
    actor,
    decision: "explicit",
    purpose: "provider-input-for-production",
    scope: "exact-production-and-input-hashes",
    reusableWithinProduction: true,
    issuedAt,
    retryPolicy,
    maxAttempts,
    inputs,
  };
}

function validateInputProjection(input, index, label = "inputs") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label}[${index}] é inválido.`);
  }
  assertExactKeys(
    input,
    ["inputId", "sha256", "bytes", "mimeType", "role", "operation"],
    `${label}[${index}]`,
  );
  requiredText(input.inputId, `${label}[${index}].inputId`);
  if (!SHA256_PATTERN.test(String(input.sha256 ?? ""))) {
    throw new Error(`${label}[${index}].sha256 é inválido.`);
  }
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) {
    throw new Error(`${label}[${index}].bytes é inválido.`);
  }
  const mimeType = requiredText(input.mimeType, `${label}[${index}].mimeType`);
  const role = requiredText(input.role, `${label}[${index}].role`);
  const operation = requiredText(input.operation, `${label}[${index}].operation`);
  if (!INPUT_ROLES.has(role) || !INPUT_OPERATIONS.has(operation)) {
    throw new Error(`${label}[${index}] possui role/operação inválida.`);
  }
  if (operation === "generate-image" && role !== "reference-image") {
    throw new Error("generate-image aceita somente role reference-image.");
  }
  if (role === "reference-video" ? !mimeType.startsWith("video/") : !mimeType.startsWith("image/")) {
    throw new Error(`${label}[${index}] possui MIME incompatível.`);
  }
  return input;
}

export function validateProductionProviderInputAuthorization(authorization, { expectedProductionId = null } = {}) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
    throw new Error("Autorização de produção ausente ou inválida.");
  }
  assertExactKeys(
    authorization,
    [
      "schema", "version", "productionId", "actor", "decision", "purpose", "scope",
      "reusableWithinProduction", "issuedAt", "retryPolicy", "maxAttempts", "inputs", "authorizationHash",
    ],
    "Autorização de produção",
  );
  if (authorization.schema !== PRODUCTION_PROVIDER_INPUT_AUTHORIZATION_SCHEMA || authorization.version !== 1) {
    throw new Error("Autorização de produção usa schema ou versão inválida.");
  }
  const productionId = requiredText(authorization.productionId, "authorization.productionId");
  if (expectedProductionId !== null && productionId !== expectedProductionId) {
    throw new Error("Autorização pertence a outra produção.");
  }
  if (!PERMIT_ACTORS.has(authorization.actor)) throw new Error("Autorização de produção possui actor inválido.");
  if (
    authorization.decision !== "explicit"
    || authorization.purpose !== "provider-input-for-production"
    || authorization.scope !== "exact-production-and-input-hashes"
    || authorization.reusableWithinProduction !== true
  ) {
    throw new Error("Autorização de produção possui autoridade inválida.");
  }
  if (isoTimestamp(authorization.issuedAt) !== authorization.issuedAt) {
    throw new Error("Autorização de produção possui issuedAt não canônico.");
  }
  if (authorization.retryPolicy !== "bounded-reconciled@1") {
    throw new Error("authorization.retryPolicy deve ser bounded-reconciled@1.");
  }
  if (!Number.isInteger(authorization.maxAttempts) || authorization.maxAttempts < 1 || authorization.maxAttempts > 3) {
    throw new Error("authorization.maxAttempts deve ficar entre 1 e 3.");
  }
  if (!Array.isArray(authorization.inputs) || authorization.inputs.length < 1 || authorization.inputs.length > MAX_PRODUCTION_PROVIDER_INPUTS) {
    throw new Error(`authorization.inputs deve conter de 1 a ${MAX_PRODUCTION_PROVIDER_INPUTS} entradas.`);
  }
  authorization.inputs.forEach((input, index) => validateInputProjection(input, index, "authorization.inputs"));
  const identities = authorization.inputs.map((input) => `${input.sha256}:${input.role}:${input.operation}`);
  if (new Set(identities).size !== identities.length) throw new Error("Autorização de produção contém entradas duplicadas.");
  if (!SHA256_PATTERN.test(String(authorization.authorizationHash ?? ""))) {
    throw new Error("authorization.authorizationHash é inválido.");
  }
  const { authorizationHash, ...body } = authorization;
  if (sha256Json(body) !== authorizationHash) throw new Error("Autorização de produção diverge do hash canônico.");
  return true;
}

export async function createProductionProviderInputAuthorization({
  confirmProviderInput,
  productionId,
  inputs,
  actor = "local-cli-human",
  retryPolicy = "bounded-reconciled@1",
  maxAttempts = 3,
  clock = () => new Date(),
} = {}) {
  if (confirmProviderInput !== true) throw new Error("Criar a autorização da produção exige confirmação explícita uma única vez.");
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_PRODUCTION_PROVIDER_INPUTS) {
    throw new Error(`inputs deve conter de 1 a ${MAX_PRODUCTION_PROVIDER_INPUTS} entradas externas.`);
  }
  const normalizedActor = requiredText(actor, "actor");
  if (!PERMIT_ACTORS.has(normalizedActor)) throw new Error("actor da autorização de produção não é permitido.");
  const inspected = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const current = await inspectFile(inputs[index], index, `input-${String(index + 1).padStart(3, "0")}`);
    inspected.push(current.projection);
  }
  const body = productionAuthorizationBody({
    productionId: requiredText(productionId, "productionId"),
    actor: normalizedActor,
    issuedAt: isoTimestamp(clock()),
    inputs: inspected,
    retryPolicy,
    maxAttempts: Number(maxAttempts),
  });
  const authorization = freezeDeep({ ...body, authorizationHash: sha256Json(body) });
  validateProductionProviderInputAuthorization(authorization, { expectedProductionId: body.productionId });
  return authorization;
}

export async function createDirectProviderInputPermitFromProductionAuthorization({
  authorization,
  productionId,
  inputs,
  purpose = "direct-provider-generation",
  invocationId = randomUUID(),
  clock = () => new Date(),
} = {}) {
  validateProductionProviderInputAuthorization(authorization, { expectedProductionId: requiredText(productionId, "productionId") });
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_DIRECT_PROVIDER_INPUTS) {
    throw new Error(`inputs deve conter de 1 a ${MAX_DIRECT_PROVIDER_INPUTS} entradas externas por chamada.`);
  }
  const bindings = [];
  const projections = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const current = await inspectFile(inputs[index], index);
    const authorized = authorization.inputs.find((candidate) =>
      candidate.sha256 === current.projection.sha256
      && candidate.bytes === current.projection.bytes
      && candidate.mimeType === current.projection.mimeType
      && candidate.role === current.projection.role
      && candidate.operation === current.projection.operation);
    if (!authorized) throw new Error(`Entrada ${index + 1} não pertence à autorização desta produção.`);
    const projection = { ...current.projection, inputId: `input-${String(index + 1).padStart(3, "0")}` };
    projections.push(projection);
    bindings.push({ ...current.binding, index, projection });
  }
  const body = permitBody({
    invocationId: requiredText(invocationId, "invocationId"),
    actor: authorization.actor,
    createdAt: isoTimestamp(clock()),
    inputs: projections,
    purpose: requiredText(purpose, "purpose"),
  });
  const permit = freezeDeep({ ...body, permitHash: sha256Json(body) });
  permittedObjects.add(permit);
  permitBindings.set(permit, bindings);
  return assertDirectProviderInputPermit(permit, {
    expectedActor: authorization.actor,
    expectedInputCount: inputs.length,
  });
}

export function validateDirectProviderInputPermitProjection(
  permit,
  { expectedActor = null } = {},
) {
  if (!permit || typeof permit !== "object" || Array.isArray(permit)) {
    throw new Error("Provider input permit ausente ou inválido.");
  }
  assertExactKeys(
    permit,
    [
      "schema",
      "version",
      "invocationId",
      "actor",
      "purpose",
      "authority",
      "reusable",
      "knowledgeCoreAuthority",
      "createdAt",
      "inputs",
      "permitHash",
    ],
    "Provider input permit",
  );
  if (permit.schema !== DIRECT_PROVIDER_INPUT_PERMIT_SCHEMA || permit.version !== 1) {
    throw new Error("Provider input permit usa schema ou versão inválida.");
  }
  requiredText(permit.invocationId, "permit.invocationId");
  if (!PERMIT_ACTORS.has(permit.actor)) {
    throw new Error("Provider input permit possui actor inválido.");
  }
  if (expectedActor !== null && permit.actor !== expectedActor) {
    throw new Error("Provider input permit não pertence ao actor esperado.");
  }
  if (
    permit.authority !== "explicit-single-invocation-confirmation"
    || permit.reusable !== false
    || permit.knowledgeCoreAuthority !== false
  ) {
    throw new Error("Provider input permit possui autoridade inválida.");
  }
  requiredText(permit.purpose, "permit.purpose");
  if (isoTimestamp(permit.createdAt) !== permit.createdAt) {
    throw new Error("Provider input permit possui createdAt não canônico.");
  }
  if (
    !Array.isArray(permit.inputs)
    || permit.inputs.length === 0
    || permit.inputs.length > MAX_DIRECT_PROVIDER_INPUTS
  ) {
    throw new Error(
      `Provider input permit deve conter de 1 a ${MAX_DIRECT_PROVIDER_INPUTS} entradas.`,
    );
  }
  permit.inputs.forEach((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`permit.inputs[${index}] é inválido.`);
    }
    assertExactKeys(
      input,
      ["inputId", "sha256", "bytes", "mimeType", "role", "operation"],
      `permit.inputs[${index}]`,
    );
    if (input.inputId !== `input-${String(index + 1).padStart(3, "0")}`) {
      throw new Error(`permit.inputs[${index}].inputId é inválido.`);
    }
    if (!SHA256_PATTERN.test(String(input.sha256 ?? ""))) {
      throw new Error(`permit.inputs[${index}].sha256 é inválido.`);
    }
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) {
      throw new Error(`permit.inputs[${index}].bytes é inválido.`);
    }
    const mimeType = requiredText(
      input.mimeType,
      `permit.inputs[${index}].mimeType`,
    );
    const role = requiredText(input.role, `permit.inputs[${index}].role`);
    const operation = requiredText(
      input.operation,
      `permit.inputs[${index}].operation`,
    );
    if (!INPUT_ROLES.has(role) || !INPUT_OPERATIONS.has(operation)) {
      throw new Error(`permit.inputs[${index}] possui role/operação inválida.`);
    }
    if (operation === "generate-image" && role !== "reference-image") {
      throw new Error("generate-image aceita somente role reference-image.");
    }
    if (role === "reference-video" && !mimeType.startsWith("video/")) {
      throw new Error(`permit.inputs[${index}] possui MIME incompatível.`);
    }
    if (role !== "reference-video" && !mimeType.startsWith("image/")) {
      throw new Error(`permit.inputs[${index}] possui MIME incompatível.`);
    }
  });
  if (!SHA256_PATTERN.test(String(permit.permitHash ?? ""))) {
    throw new Error("Provider input permit possui permitHash inválido.");
  }
  const { permitHash, ...body } = permit;
  if (sha256Json(body) !== permitHash) {
    throw new Error("Provider input permit diverge do hash canônico.");
  }
  return true;
}

/**
 * Performs a local, provider-free preflight and issues a process-local permit.
 * File paths are used only while reading the files and never enter the permit.
 */
export async function createDirectProviderInputPermit({
  confirmProviderInput,
  inputs,
  invocationId = randomUUID(),
  purpose = "direct-provider-generation",
  actor = "local-cli-human",
  clock = () => new Date(),
} = {}) {
  if (confirmProviderInput !== true) {
    throw new Error(
      "Entradas externas exigem --confirm-provider-input true antes do envio ao provedor.",
    );
  }
  if (
    !Array.isArray(inputs)
    || inputs.length === 0
    || inputs.length > MAX_DIRECT_PROVIDER_INPUTS
  ) {
    throw new Error(
      `inputs deve conter de 1 a ${MAX_DIRECT_PROVIDER_INPUTS} entradas externas.`,
    );
  }
  const normalizedInvocationId = requiredText(invocationId, "invocationId");
  const normalizedPurpose = requiredText(purpose, "purpose");
  const normalizedActor = requiredText(actor, "actor");
  if (!PERMIT_ACTORS.has(normalizedActor)) {
    throw new Error("actor do provider input permit não é permitido.");
  }
  const inspected = [];
  const bindings = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const inspectedInput = await inspectFile(inputs[index], index);
    inspected.push(inspectedInput.projection);
    bindings.push({
      ...inspectedInput.binding,
      index,
      projection: inspectedInput.projection,
    });
  }
  const body = permitBody({
    invocationId: normalizedInvocationId,
    actor: normalizedActor,
    createdAt: isoTimestamp(clock()),
    inputs: inspected,
    purpose: normalizedPurpose,
  });
  const permit = freezeDeep({
    ...body,
    permitHash: sha256Json(body),
  });
  permittedObjects.add(permit);
  permitBindings.set(permit, bindings);
  return permit;
}

/**
 * Rejects serialized/cloned permits even when every visible field is identical.
 */
export function assertDirectProviderInputPermit(
  permit,
  {
    expectedActor = null,
    expectedOperations = null,
    expectedInputCount = null,
  } = {},
) {
  if (!permittedObjects.has(permit)) {
    throw new Error(
      "Provider input permit não foi emitido pelo preflight desta execução.",
    );
  }
  validateDirectProviderInputPermitProjection(permit, { expectedActor });
  if (
    expectedInputCount !== null
    && permit.inputs.length !== expectedInputCount
  ) {
    throw new Error("Provider input permit não cobre todas as entradas esperadas.");
  }
  if (expectedOperations !== null) {
    const allowed = new Set(
      (Array.isArray(expectedOperations)
        ? expectedOperations
        : [expectedOperations])
        .map((value) => requiredText(value, "expectedOperations")),
    );
    if (permit.inputs.some((input) => !allowed.has(input.operation))) {
      throw new Error("Provider input permit não cobre a operação esperada.");
    }
  }
  return permit;
}

export function projectDirectProviderInputPermit(permit) {
  assertDirectProviderInputPermit(permit);
  return structuredClone(permit);
}

/**
 * Re-reads the exact bound files immediately before an adapter call.
 * A subset is allowed for one job of an aggregate batch permit, but its
 * descriptors must preserve the original permit order and identity.
 */
export async function assertDirectProviderInputPermitJit(
  permit,
  inputs,
  { requireAll = false, expectedInputIds = null } = {},
) {
  assertDirectProviderInputPermit(permit);
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("JIT provider input guard exige ao menos uma entrada.");
  }
  const bindings = permitBindings.get(permit);
  if (!bindings) {
    throw new Error("Bindings privados do provider input permit estão ausentes.");
  }
  if (requireAll && inputs.length !== bindings.length) {
    throw new Error("JIT provider input guard não recebeu todas as entradas.");
  }
  if (
    expectedInputIds !== null
    && (
      !Array.isArray(expectedInputIds)
      || expectedInputIds.length !== inputs.length
    )
  ) {
    throw new Error("expectedInputIds não corresponde às entradas JIT.");
  }

  let previousBindingIndex = -1;
  for (let index = 0; index < inputs.length; index += 1) {
    const normalized = normalizeInputDescriptor(inputs[index], index);
    const expectedInputId = expectedInputIds?.[index] ?? null;
    const bindingIndex = bindings.findIndex((binding, candidateIndex) =>
      candidateIndex > previousBindingIndex
      && (
        expectedInputId === null
        || binding.projection.inputId === expectedInputId
      )
      && binding.file === normalized.file
      && binding.role === normalized.role
      && binding.operation === normalized.operation);
    if (bindingIndex < 0) {
      throw new Error(
        `Entrada JIT ${index + 1} não pertence ao permit ou está fora de ordem.`,
      );
    }
    if (requireAll && bindingIndex !== index) {
      throw new Error("JIT provider input guard recebeu identidade divergente.");
    }
    const current = await inspectFile(
      normalized,
      index,
      bindings[bindingIndex].projection.inputId,
    );
    if (
      canonicalJson(current.projection)
      !== canonicalJson(bindings[bindingIndex].projection)
    ) {
      throw new Error(
        `Entrada JIT ${index + 1} diverge do preflight autorizado.`,
      );
    }
    previousBindingIndex = bindingIndex;
  }
  return permit;
}
