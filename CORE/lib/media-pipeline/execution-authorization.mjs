import { randomUUID } from "node:crypto";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { PROVIDER_CAPABILITIES } from "./provider-registry.mjs";
import { assertPaidExecutionAuthorized } from "./studio-governance.mjs";

export const EXECUTION_AUTHORIZATION_SCHEMA =
  "mkt-videos/execution-authorization@1";
export const EXECUTION_RIGHTS_DECISION_SCHEMA =
  "mkt-videos/execution-rights-decision@1";
export const CAPABILITY_SNAPSHOT_SCHEMA =
  "mkt-videos/execution-capability-snapshot@1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AUTHORIZATION_SOURCES = new Set(["cli", "app"]);
const RIGHTS_SCOPES = new Set(["no-provider-input", "same-execution"]);
const MEDIA_INPUT_NODE_KINDS = new Set(["omni-video", "qa", "qa-scene"]);
const BUDGET_KEYS = Object.freeze({
  "gemini-image": "image",
  "google-vids": "tts",
  "flow-music": "music",
  "gemini-omni": "omni",
  "gemini-vision": "semanticQa",
});
const issuedAuthorizations = new WeakSet();

export function executionNodeRequiresMediaInputs(node, call) {
  if (!MEDIA_INPUT_NODE_KINDS.has(node?.kind)) return false;
  return !(node.kind === "omni-video" && call?.operation === "text-to-video");
}

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

function canonicalIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} é inválido.`);
  const iso = date.toISOString();
  if (typeof value === "string" && value !== iso) {
    throw new Error(`${label} não está em formato ISO canônico.`);
  }
  return iso;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} deve ser inteiro não negativo.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} deve ser inteiro positivo.`);
  }
  return value;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} deve ser objeto.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (operationFingerprint(actual) !== operationFingerprint(expected)) {
    throw new Error(`${label} contém campos ausentes ou não permitidos.`);
  }
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function assertNoSecretFields(value, label = "authorization") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(cookie|authorizationheader|api.?key|token|password|secret|sesskey|harfile)/i.test(key)) {
      throw new Error(`${label} contém campo secreto proibido: ${key}.`);
    }
    assertNoSecretFields(child, `${label}.${key}`);
  }
}

function authorizationBody(value) {
  const { authorizationHash: _authorizationHash, ...body } = value;
  return body;
}

function rightsDecisionBody(value) {
  const { decisionHash: _decisionHash, ...body } = value;
  return body;
}

function normalizeNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("now é inválido.");
  return date;
}

function paidCallForNode(plan, nodeId) {
  if (plan?.schema !== "mkt-videos/execution-plan@1") {
    throw new Error("ExecutionAuthorization exige execution-plan@1.");
  }
  const node = plan.nodes?.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`Nó desconhecido: ${nodeId}.`);
  if (node.costClass === "local") {
    throw new Error(`Nó local ${nodeId} não aceita ExecutionAuthorization paga.`);
  }
  const calls = (plan.governance?.paidCalls ?? [])
    .filter((entry) => Array.isArray(entry.nodeIds) && entry.nodeIds.includes(nodeId));
  if (calls.length !== 1) {
    throw new Error(`Nó ${nodeId} não possui uma capability paga canônica única.`);
  }
  return { node, call: calls[0] };
}

function capabilityExpiry(capability) {
  const checkedAt = canonicalIso(capability.checkedAt, "capability.checkedAt");
  const ttlSeconds = positiveInteger(
    capability.ttlSeconds,
    "capability.ttlSeconds",
  );
  return {
    checkedAt,
    ttlSeconds,
    expiresAt: new Date(
      Date.parse(checkedAt) + ttlSeconds * 1_000,
    ).toISOString(),
  };
}

export function currentExecutionCapabilitySnapshot({
  provider,
  operation,
  now = new Date(),
  providerCapabilities = PROVIDER_CAPABILITIES,
} = {}) {
  const current = normalizeNow(now);
  const providerId = requiredText(provider, "provider");
  const operationId = requiredText(operation, "operation");
  const capability = providerCapabilities[providerId];
  if (!capability) throw new Error(`Capability ausente para ${providerId}.`);
  if (!capability.operations.includes(operationId)) {
    throw new Error(`${providerId} não declara a operação ${operationId}.`);
  }
  if (
    capability.status !== "supported"
    || capability.deliveryDependencyAllowed !== true
  ) {
    throw new Error(`${providerId} não está autorizado como dependência de entrega.`);
  }
  const freshness = capabilityExpiry(capability);
  if (current.getTime() >= Date.parse(freshness.expiresAt)) {
    throw new Error(`Capability ${providerId}/${operationId} está expirada.`);
  }
  const snapshot = {
    schema: CAPABILITY_SNAPSHOT_SCHEMA,
    provider: providerId,
    operation: operationId,
    status: capability.status,
    authenticationMode: requiredText(
      capability.authContract,
      "capability.authContract",
    ),
    deliveryDependencyAllowed: true,
    evidence: requiredText(capability.evidence, "capability.evidence"),
    checkedAt: freshness.checkedAt,
    ttlSeconds: freshness.ttlSeconds,
    expiresAt: freshness.expiresAt,
  };
  return freezeDeep({
    ...snapshot,
    snapshotHash: operationFingerprint(snapshot),
  });
}

function validateRightsInput(input, index) {
  assertExactKeys(
    input,
    [
      "artifactId",
      "nodeId",
      "sha256",
      "bytes",
      "mimeType",
      "receiptId",
      "receiptSha256",
      "createdSequence",
    ],
    `rights.inputs[${index}]`,
  );
  requiredText(input.artifactId, `rights.inputs[${index}].artifactId`);
  requiredText(input.nodeId, `rights.inputs[${index}].nodeId`);
  requiredHash(input.sha256, `rights.inputs[${index}].sha256`);
  positiveInteger(input.bytes, `rights.inputs[${index}].bytes`);
  const mimeType = requiredText(
    input.mimeType,
    `rights.inputs[${index}].mimeType`,
  );
  if (!/^(?:image|video|audio)\//.test(mimeType)) {
    throw new Error(`rights.inputs[${index}].mimeType não é audiovisual.`);
  }
  requiredText(input.receiptId, `rights.inputs[${index}].receiptId`);
  requiredHash(
    input.receiptSha256,
    `rights.inputs[${index}].receiptSha256`,
  );
  nonNegativeInteger(
    input.createdSequence,
    `rights.inputs[${index}].createdSequence`,
  );
}

function validateRightsApproval(approval, index) {
  assertExactKeys(
    approval,
    [
      "nodeId",
      "approvalHash",
      "actor",
      "actorKind",
      "source",
      "approvedAt",
      "createdSequence",
    ],
    `rights.approvals[${index}]`,
  );
  requiredText(approval.nodeId, `rights.approvals[${index}].nodeId`);
  requiredHash(
    approval.approvalHash,
    `rights.approvals[${index}].approvalHash`,
  );
  requiredText(approval.actor, `rights.approvals[${index}].actor`);
  const actorKind = requiredText(approval.actorKind, `rights.approvals[${index}].actorKind`);
  if (!new Set(["human", "automation", "legacy-unknown"]).has(actorKind)) throw new Error(`rights.approvals[${index}].actorKind inválido.`);
  requiredText(approval.source, `rights.approvals[${index}].source`);
  canonicalIso(
    approval.approvedAt,
    `rights.approvals[${index}].approvedAt`,
  );
  nonNegativeInteger(
    approval.createdSequence,
    `rights.approvals[${index}].createdSequence`,
  );
}

export function validateExecutionRightsDecision(
  decision,
  {
    expectedPlanFingerprint = null,
    expectedNodeId = null,
    expectedOperation = null,
    requireMediaInputs = false,
    requireApprovals = false,
  } = {},
) {
  assertExactKeys(
    decision,
    [
      "schema",
      "version",
      "planFingerprint",
      "nodeId",
      "operation",
      "scope",
      "providerInputAllowed",
      "inputs",
      "approvals",
      "headSequence",
      "decisionHash",
    ],
    "Execution rights decision",
  );
  if (
    decision.schema !== EXECUTION_RIGHTS_DECISION_SCHEMA
    || decision.version !== 1
  ) {
    throw new Error("Execution rights decision usa schema ou versão inválida.");
  }
  const planFingerprint = requiredHash(
    decision.planFingerprint,
    "rights.planFingerprint",
  );
  const nodeId = requiredText(decision.nodeId, "rights.nodeId");
  const operation = requiredText(decision.operation, "rights.operation");
  if (expectedPlanFingerprint !== null && planFingerprint !== expectedPlanFingerprint) {
    throw new Error("Execution rights decision pertence a outro plano.");
  }
  if (expectedNodeId !== null && nodeId !== expectedNodeId) {
    throw new Error("Execution rights decision pertence a outro nó.");
  }
  if (expectedOperation !== null && operation !== expectedOperation) {
    throw new Error("Execution rights decision não cobre a operação do nó.");
  }
  if (!RIGHTS_SCOPES.has(decision.scope)) {
    throw new Error("Execution rights decision possui scope inválido.");
  }
  if (decision.providerInputAllowed !== true) {
    throw new Error("Execution rights decision não autoriza provider input.");
  }
  if (!Array.isArray(decision.inputs)) {
    throw new Error("Execution rights decision exige inputs.");
  }
  if (decision.inputs.length > 64) {
    throw new Error("Execution rights decision excede o limite de inputs.");
  }
  decision.inputs.forEach(validateRightsInput);
  const artifactIds = decision.inputs.map((entry) => entry.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error("Execution rights decision contém artifacts duplicados.");
  }
  if (!Array.isArray(decision.approvals)) {
    throw new Error("Execution rights decision exige approvals.");
  }
  if (decision.approvals.length > 64) {
    throw new Error("Execution rights decision excede o limite de approvals.");
  }
  decision.approvals.forEach(validateRightsApproval);
  const approvalNodeIds = decision.approvals.map((entry) => entry.nodeId);
  if (new Set(approvalNodeIds).size !== approvalNodeIds.length) {
    throw new Error("Execution rights decision contém approvals duplicadas.");
  }
  if (decision.inputs.length === 0 && decision.scope !== "no-provider-input") {
    throw new Error("Rights sem inputs exigem scope no-provider-input.");
  }
  if (decision.inputs.length > 0 && decision.scope !== "same-execution") {
    throw new Error("Rights com inputs exigem scope same-execution.");
  }
  if (requireMediaInputs && decision.inputs.length === 0) {
    throw new Error("O nó exige artifact audiovisual governado da mesma execução.");
  }
  if (requireApprovals && decision.approvals.length === 0) {
    throw new Error("O nó exige aprovação humana governada da mesma execução.");
  }
  nonNegativeInteger(decision.headSequence, "rights.headSequence");
  const decisionHash = requiredHash(
    decision.decisionHash,
    "rights.decisionHash",
  );
  if (operationFingerprint(rightsDecisionBody(decision)) !== decisionHash) {
    throw new Error("Execution rights decision diverge do hash canônico.");
  }
  assertNoSecretFields(decision, "rights");
  return true;
}

export function createNoProviderInputRightsDecision({
  plan,
  nodeId,
  approvals = [],
  headSequence = 0,
} = {}) {
  const { node, call } = paidCallForNode(plan, nodeId);
  if (executionNodeRequiresMediaInputs(node, call)) {
    throw new Error(`Nó ${nodeId} exige artifact audiovisual como provider input.`);
  }
  const body = {
    schema: EXECUTION_RIGHTS_DECISION_SCHEMA,
    version: 1,
    planFingerprint: requiredHash(plan.fingerprint, "plan.fingerprint"),
    nodeId,
    operation: call.operation,
    scope: "no-provider-input",
    providerInputAllowed: true,
    inputs: [],
    approvals: structuredClone(approvals ?? []),
    headSequence: nonNegativeInteger(headSequence, "headSequence"),
  };
  return freezeDeep({
    ...body,
    decisionHash: operationFingerprint(body),
  });
}

export function createSameExecutionRightsDecision({
  plan,
  nodeId,
  inputs,
  approvals = [],
  headSequence,
} = {}) {
  const { node, call } = paidCallForNode(plan, nodeId);
  if (!executionNodeRequiresMediaInputs(node, call)) {
    throw new Error(`Nó ${nodeId} não declara media input governado.`);
  }
  const body = {
    schema: EXECUTION_RIGHTS_DECISION_SCHEMA,
    version: 1,
    planFingerprint: requiredHash(plan.fingerprint, "plan.fingerprint"),
    nodeId,
    operation: call.operation,
    scope: "same-execution",
    providerInputAllowed: true,
    inputs: structuredClone(inputs ?? []),
    approvals: structuredClone(approvals ?? []),
    headSequence: nonNegativeInteger(headSequence, "headSequence"),
  };
  const decision = freezeDeep({
    ...body,
    decisionHash: operationFingerprint(body),
  });
  validateExecutionRightsDecision(decision, {
    expectedPlanFingerprint: plan.fingerprint,
    expectedNodeId: nodeId,
    expectedOperation: call.operation,
    requireMediaInputs: true,
    requireApprovals: (node.dependencies ?? []).some((dependencyId) =>
      plan.nodes.some(
        (candidate) =>
          candidate.id === dependencyId && candidate.kind === "human-approval",
      )),
  });
  return decision;
}

function hardLimitForCall(plan, call) {
  const budgetKey = BUDGET_KEYS[call.provider];
  if (!budgetKey) {
    throw new Error(`Provider ${call.provider} não possui budget key canônica.`);
  }
  const required = plan.governance?.budget?.required?.[budgetKey];
  const declared = plan.governance?.budget?.declared?.[budgetKey];
  const amount = declared == null ? required : declared;
  positiveInteger(amount, `budget.${budgetKey}`);
  if (amount < call.nodeIds.length) {
    throw new Error(`Hard limit ${budgetKey} é menor que o inventário aprovado.`);
  }
  return {
    unit: "session-quota-call",
    budgetKey,
    amount,
  };
}

function assertApprovalActorKinds(plan, node, approvals) {
  if ((approvals ?? []).some((approval) => approval.actorKind === "legacy-unknown")) {
    throw new Error("Aprovação legada sem actorKind é somente leitura e não autoriza novo efeito pago.");
  }
  for (const dependencyId of node.dependencies ?? []) {
    const dependency = plan.nodes.find((candidate) => candidate.id === dependencyId);
    if (!dependency || !["human-approval", "workflow-authorization"].includes(dependency.kind)) continue;
    const approval = (approvals ?? []).find((candidate) => candidate.nodeId === dependencyId);
    if (!approval) throw new Error(`Nó pago exige autorização governada de ${dependencyId}.`);
    const expected = dependency.kind === "human-approval" ? "human" : "automation";
    if (approval.actorKind !== expected) throw new Error(`${dependencyId} exige actorKind ${expected}.`);
  }
}

function explicitConfirmation({
  source,
  actor,
  approvalFingerprint,
}) {
  const normalizedSource = requiredText(source, "confirmation.source");
  if (!AUTHORIZATION_SOURCES.has(normalizedSource)) {
    throw new Error("confirmation.source deve ser cli ou app.");
  }
  return {
    confirmed: true,
    source: normalizedSource,
    actor: requiredText(actor, "confirmation.actor"),
    approvalFingerprint: requiredHash(
      approvalFingerprint,
      "confirmation.approvalFingerprint",
    ),
  };
}

export function validateExecutionAuthorizationProjection(
  authorization,
  {
    expectedPlanFingerprint = null,
    expectedNodeId = null,
    expectedProvider = null,
    expectedOperation = null,
  } = {},
) {
  assertExactKeys(
    authorization,
    [
      "schema",
      "version",
      "planFingerprint",
      "approvalFingerprint",
      "nodeId",
      "nodeFingerprint",
      "provider",
      "operation",
      "capabilitySnapshotHash",
      "capabilityExpiresAt",
      "rightsDecisionHash",
      "rightsHeadSequence",
      "estimatedCostOrQuota",
      "hardLimit",
      "authenticationMode",
      "explicitConfirmation",
      "issuedAt",
      "expiresAt",
      "nonce",
      "authorizationHash",
    ],
    "ExecutionAuthorization",
  );
  if (
    authorization.schema !== EXECUTION_AUTHORIZATION_SCHEMA
    || authorization.version !== 1
  ) {
    throw new Error("ExecutionAuthorization usa schema ou versão inválida.");
  }
  const planFingerprint = requiredHash(
    authorization.planFingerprint,
    "authorization.planFingerprint",
  );
  requiredHash(
    authorization.approvalFingerprint,
    "authorization.approvalFingerprint",
  );
  const nodeId = requiredText(authorization.nodeId, "authorization.nodeId");
  requiredHash(
    authorization.nodeFingerprint,
    "authorization.nodeFingerprint",
  );
  const provider = requiredText(
    authorization.provider,
    "authorization.provider",
  );
  const operation = requiredText(
    authorization.operation,
    "authorization.operation",
  );
  if (expectedPlanFingerprint !== null && planFingerprint !== expectedPlanFingerprint) {
    throw new Error("ExecutionAuthorization pertence a outro plano.");
  }
  if (expectedNodeId !== null && nodeId !== expectedNodeId) {
    throw new Error("ExecutionAuthorization pertence a outro nó.");
  }
  if (expectedProvider !== null && provider !== expectedProvider) {
    throw new Error("ExecutionAuthorization pertence a outro provider.");
  }
  if (expectedOperation !== null && operation !== expectedOperation) {
    throw new Error("ExecutionAuthorization pertence a outra operação.");
  }
  requiredHash(
    authorization.capabilitySnapshotHash,
    "authorization.capabilitySnapshotHash",
  );
  canonicalIso(
    authorization.capabilityExpiresAt,
    "authorization.capabilityExpiresAt",
  );
  requiredHash(
    authorization.rightsDecisionHash,
    "authorization.rightsDecisionHash",
  );
  nonNegativeInteger(
    authorization.rightsHeadSequence,
    "authorization.rightsHeadSequence",
  );
  assertExactKeys(
    authorization.estimatedCostOrQuota,
    ["unit", "amount", "provider", "operation"],
    "authorization.estimatedCostOrQuota",
  );
  if (authorization.estimatedCostOrQuota.unit !== "session-quota-call") {
    throw new Error("estimatedCostOrQuota.unit inválida.");
  }
  positiveInteger(
    authorization.estimatedCostOrQuota.amount,
    "estimatedCostOrQuota.amount",
  );
  if (
    authorization.estimatedCostOrQuota.provider !== provider
    || authorization.estimatedCostOrQuota.operation !== operation
  ) {
    throw new Error("estimatedCostOrQuota diverge do provider/operação.");
  }
  assertExactKeys(
    authorization.hardLimit,
    ["unit", "budgetKey", "amount"],
    "authorization.hardLimit",
  );
  if (authorization.hardLimit.unit !== "session-quota-call") {
    throw new Error("hardLimit.unit inválida.");
  }
  requiredText(authorization.hardLimit.budgetKey, "hardLimit.budgetKey");
  positiveInteger(authorization.hardLimit.amount, "hardLimit.amount");
  requiredText(
    authorization.authenticationMode,
    "authorization.authenticationMode",
  );
  assertExactKeys(
    authorization.explicitConfirmation,
    ["confirmed", "source", "actor", "approvalFingerprint"],
    "authorization.explicitConfirmation",
  );
  if (authorization.explicitConfirmation.confirmed !== true) {
    throw new Error("ExecutionAuthorization não contém confirmação humana.");
  }
  if (!AUTHORIZATION_SOURCES.has(authorization.explicitConfirmation.source)) {
    throw new Error("ExecutionAuthorization possui confirmation.source inválida.");
  }
  requiredText(
    authorization.explicitConfirmation.actor,
    "authorization.explicitConfirmation.actor",
  );
  if (
    requiredHash(
      authorization.explicitConfirmation.approvalFingerprint,
      "authorization.explicitConfirmation.approvalFingerprint",
    ) !== authorization.approvalFingerprint
  ) {
    throw new Error("Confirmação diverge do approval fingerprint.");
  }
  const issuedAt = canonicalIso(authorization.issuedAt, "authorization.issuedAt");
  const expiresAt = canonicalIso(
    authorization.expiresAt,
    "authorization.expiresAt",
  );
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error("ExecutionAuthorization deve expirar depois de issuedAt.");
  }
  if (Date.parse(expiresAt) > Date.parse(authorization.capabilityExpiresAt)) {
    throw new Error("ExecutionAuthorization excede o TTL da capability.");
  }
  requiredText(authorization.nonce, "authorization.nonce", 128);
  const authorizationHash = requiredHash(
    authorization.authorizationHash,
    "authorization.authorizationHash",
  );
  if (
    operationFingerprint(authorizationBody(authorization))
    !== authorizationHash
  ) {
    throw new Error("ExecutionAuthorization diverge do hash canônico.");
  }
  assertNoSecretFields(authorization);
  return true;
}

export function issueExecutionAuthorization({
  plan,
  nodeId,
  rightsDecision,
  confirmFingerprint = null,
  source = "cli",
  actor = "local-human",
  now = new Date(),
  ttlMs = 5 * 60 * 1_000,
  nonce = randomUUID(),
  allowConceptPilot = false,
  providerCapabilities = PROVIDER_CAPABILITIES,
} = {}) {
  const issued = normalizeNow(now);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60 * 1_000) {
    throw new Error("ttlMs deve ficar entre 1 segundo e 15 minutos.");
  }
  const planFingerprint = requiredHash(plan?.fingerprint, "plan.fingerprint");
  const { node, call } = paidCallForNode(plan, nodeId);
  const approval = assertPaidExecutionAuthorized(plan, {
    providerCapabilities,
    confirmFingerprint,
    allowConceptPilot,
    now: issued,
  });
  validateExecutionRightsDecision(rightsDecision, {
    expectedPlanFingerprint: planFingerprint,
    expectedNodeId: nodeId,
    expectedOperation: call.operation,
    requireMediaInputs: executionNodeRequiresMediaInputs(node, call),
    requireApprovals: (node.dependencies ?? []).some((dependencyId) =>
      plan.nodes.some(
        (candidate) =>
          candidate.id === dependencyId && candidate.kind === "human-approval",
      )),
  });
  assertApprovalActorKinds(plan, node, rightsDecision.approvals);
  const capability = currentExecutionCapabilitySnapshot({
    providerCapabilities,
    provider: call.provider,
    operation: call.operation,
    now: issued,
  });
  const planCapability = (plan.governance?.capabilities ?? []).find(
    (entry) =>
      entry.provider === call.provider && entry.operation === call.operation,
  );
  if (!planCapability) {
    throw new Error("Plano não contém o capability snapshot do nó.");
  }
  const planCapabilityHash = operationFingerprint({
    schema: CAPABILITY_SNAPSHOT_SCHEMA,
    provider: planCapability.provider,
    operation: planCapability.operation,
    status: planCapability.status,
    authenticationMode: planCapability.authContract,
    deliveryDependencyAllowed: planCapability.deliveryDependencyAllowed,
    evidence: planCapability.evidence,
    checkedAt: planCapability.freshness?.checkedAt,
    ttlSeconds: planCapability.freshness?.ttlSeconds,
    expiresAt: planCapability.freshness?.expiresAt,
  });
  if (planCapabilityHash !== capability.snapshotHash) {
    throw new Error("Capability atual diverge do snapshot congelado no plano.");
  }
  const expiresAt = new Date(
    Math.min(
      issued.getTime() + ttlMs,
      Date.parse(capability.expiresAt),
    ),
  ).toISOString();
  const confirmation = explicitConfirmation({
    source,
    actor,
    approvalFingerprint: approval.fingerprint,
  });
  const body = {
    schema: EXECUTION_AUTHORIZATION_SCHEMA,
    version: 1,
    planFingerprint,
    approvalFingerprint: approval.fingerprint,
    nodeId,
    nodeFingerprint: requiredHash(node.fingerprint, "node.fingerprint"),
    provider: call.provider,
    operation: call.operation,
    capabilitySnapshotHash: capability.snapshotHash,
    capabilityExpiresAt: capability.expiresAt,
    rightsDecisionHash: rightsDecision.decisionHash,
    rightsHeadSequence: rightsDecision.headSequence,
    estimatedCostOrQuota: {
      unit: "session-quota-call",
      amount: 1,
      provider: call.provider,
      operation: call.operation,
    },
    hardLimit: hardLimitForCall(plan, call),
    authenticationMode: capability.authenticationMode,
    explicitConfirmation: confirmation,
    issuedAt: issued.toISOString(),
    expiresAt,
    nonce: requiredText(nonce, "nonce", 128),
  };
  const authorization = freezeDeep({
    ...body,
    authorizationHash: operationFingerprint(body),
  });
  validateExecutionAuthorizationProjection(authorization, {
    expectedPlanFingerprint: planFingerprint,
    expectedNodeId: nodeId,
    expectedProvider: call.provider,
    expectedOperation: call.operation,
  });
  issuedAuthorizations.add(authorization);
  return authorization;
}

export function assertExecutionAuthorization(
  authorization,
  expected = {},
) {
  if (!issuedAuthorizations.has(authorization)) {
    throw new Error(
      "ExecutionAuthorization não foi emitida pelo Execution Kernel desta execução.",
    );
  }
  validateExecutionAuthorizationProjection(authorization, expected);
  return authorization;
}

export function projectExecutionAuthorization(authorization) {
  assertExecutionAuthorization(authorization);
  return structuredClone(authorization);
}

export function assertExecutionAuthorizationRuntime(
  authorization,
  {
    plan,
    nodeId,
    rightsDecision,
    now = new Date(),
    providerCapabilities = PROVIDER_CAPABILITIES,
  } = {},
) {
  const current = normalizeNow(now);
  const planFingerprint = requiredHash(plan?.fingerprint, "plan.fingerprint");
  const { node, call } = paidCallForNode(plan, nodeId);
  assertExecutionAuthorization(authorization, {
    expectedPlanFingerprint: planFingerprint,
    expectedNodeId: nodeId,
    expectedProvider: call.provider,
    expectedOperation: call.operation,
  });
  if (authorization.nodeFingerprint !== node.fingerprint) {
    throw new Error("ExecutionAuthorization diverge do fingerprint do nó.");
  }
  if (current.getTime() >= Date.parse(authorization.expiresAt)) {
    throw new Error("ExecutionAuthorization está expirada.");
  }
  validateExecutionRightsDecision(rightsDecision, {
    expectedPlanFingerprint: planFingerprint,
    expectedNodeId: nodeId,
    expectedOperation: call.operation,
    requireMediaInputs: executionNodeRequiresMediaInputs(node, call),
    requireApprovals: (node.dependencies ?? []).some((dependencyId) =>
      plan.nodes.some(
        (candidate) =>
          candidate.id === dependencyId && candidate.kind === "human-approval",
      )),
  });
  if (
    rightsDecision.decisionHash !== authorization.rightsDecisionHash
    || rightsDecision.headSequence !== authorization.rightsHeadSequence
  ) {
    throw new Error("Head de rights mudou depois da emissão da autorização.");
  }
  const capability = currentExecutionCapabilitySnapshot({
    providerCapabilities,
    provider: call.provider,
    operation: call.operation,
    now: current,
  });
  if (
    capability.snapshotHash !== authorization.capabilitySnapshotHash
    || capability.expiresAt !== authorization.capabilityExpiresAt
    || capability.authenticationMode !== authorization.authenticationMode
  ) {
    throw new Error("Capability mudou depois da emissão da autorização.");
  }
  assertPaidExecutionAuthorized(plan, {
    providerCapabilities,
    confirmFingerprint:
      authorization.explicitConfirmation.approvalFingerprint,
    // A pilot authorization is validated once at issuance. Preserve that
    // governed allowance when the same immutable authorization is rechecked
    // immediately before the provider effect.
    allowConceptPilot: plan?.governance?.style?.status === "concept",
    now: current,
  });
  return authorization;
}
