import { operationFingerprint } from "./pipeline-operation.mjs";

export const ADAPTER_CONTRACT_SCHEMA = "mkt-videos/adapter-contract@1";
export const ADAPTER_INVOCATION_SCHEMA = "mkt-videos/adapter-invocation@1";
export const ADAPTER_RESULT_SCHEMA = "mkt-videos/adapter-result@1";
export const ADAPTER_CONFORMANCE_SCHEMA = "mkt-videos/adapter-conformance@1";

const RESULT_STATUSES = new Set(["ready", "pending", "ambiguous", "failed"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function safeId(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized) || /[\\/]/.test(normalized)) throw new Error(`${label} contém identificador inválido.`);
  return normalized;
}

function sanitizeError(error) {
  return String(error?.message ?? error ?? "unknown")
    .replace(/(cookie|authorization|api[_-]?key|token|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]")
    .slice(0, 500);
}

function normalizedOperations(value) {
  if (!Array.isArray(value) || value.length < 1) throw new Error("adapter.operations deve conter ao menos uma operação.");
  const operations = value.map((item, index) => safeId(item, `adapter.operations[${index}]`));
  if (new Set(operations).size !== operations.length) throw new Error("adapter.operations não aceita duplicatas.");
  return operations;
}

function descriptorBody(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("Adapter inválido.");
  if (adapter.schema !== ADAPTER_CONTRACT_SCHEMA) throw new Error("Adapter sem schema adapter-contract@1.");
  const body = {
    schema: ADAPTER_CONTRACT_SCHEMA,
    id: safeId(adapter.id, "adapter.id"),
    providerId: safeId(adapter.providerId, "adapter.providerId"),
    kind: safeId(adapter.kind, "adapter.kind"),
    operations: normalizedOperations(adapter.operations),
    authMode: requiredText(adapter.authMode ?? "none", "adapter.authMode"),
    authContract: requiredText(adapter.authContract ?? "local-no-auth", "adapter.authContract"),
    paidOperations: [...new Set((adapter.paidOperations ?? []).map((item, index) => safeId(item, `adapter.paidOperations[${index}]`)))].sort(),
    reconcileOperations: [...new Set((adapter.reconcileOperations ?? []).map((item, index) => safeId(item, `adapter.reconcileOperations[${index}]`)))].sort(),
    resultKinds: [...new Set((adapter.resultKinds ?? [adapter.kind]).map((item, index) => safeId(item, `adapter.resultKinds[${index}]`)))].sort(),
  };
  for (const operation of [...body.paidOperations, ...body.reconcileOperations]) {
    if (!body.operations.includes(operation)) throw new Error(`Operação ${operation} não está declarada pelo adapter.`);
  }
  if (typeof adapter.estimate !== "function") throw new Error("Adapter precisa expor estimate().");
  if (typeof adapter.execute !== "function") throw new Error("Adapter precisa expor execute().");
  if (body.reconcileOperations.length > 0 && typeof adapter.reconcile !== "function") throw new Error("Adapter com reconcileOperations precisa expor reconcile().");
  return body;
}

export function assertAdapterContract(adapter) {
  const body = descriptorBody(adapter);
  if (adapter.fingerprint != null && adapter.fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint do adapter divergente.");
  return true;
}

export function createAdapterContract(adapter) {
  const body = descriptorBody(adapter);
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function capabilityPreflight({ adapter, capabilityRegistry, operation }) {
  const entry = capabilityRegistry?.providers?.find((item) => item.id === adapter.providerId);
  const blockers = [];
  if (!entry) blockers.push("provider_not_registered");
  else {
    if (!entry.operations?.includes(operation)) blockers.push("operation_not_declared");
    if (adapter.authMode !== "none" && !entry.auth?.includes(adapter.authMode)) blockers.push("auth_mode_not_declared");
    if (entry.status !== "supported") blockers.push(`capability_${entry.status}`);
    if (entry.health?.status === "unavailable") blockers.push("health_unavailable");
    if (entry.deliveryDependencyAllowed !== true && adapter.paidOperations.includes(operation)) blockers.push("delivery_dependency_blocked");
  }
  return {
    status: blockers.length ? "blocked" : "ready",
    blockers,
    capability: entry ? structuredClone(entry) : null,
  };
}

export function buildAdapterInvocation({ adapter, capabilityRegistry, operation, request = {}, estimate = null, now = new Date() } = {}) {
  assertAdapterContract(adapter);
  const normalizedOperation = safeId(operation, "operation");
  if (!adapter.operations.includes(normalizedOperation)) throw new Error(`Adapter ${adapter.id} não implementa ${normalizedOperation}.`);
  const preflight = capabilityPreflight({ adapter, capabilityRegistry, operation: normalizedOperation });
  const paid = adapter.paidOperations.includes(normalizedOperation);
  const body = {
    schema: ADAPTER_INVOCATION_SCHEMA,
    adapterId: adapter.id,
    providerId: adapter.providerId,
    operation: normalizedOperation,
    paid,
    request: structuredClone(request ?? {}),
    estimate: estimate == null ? null : structuredClone(estimate),
    preflight,
    authorizationRequired: paid,
    createdAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

function assertInvocation(invocation) {
  if (!invocation || invocation.schema !== ADAPTER_INVOCATION_SCHEMA) throw new Error("Invocation de adapter inválida.");
  const { fingerprint, ...body } = invocation;
  if (fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint da invocation de adapter divergente.");
}

export function normalizeAdapterResult(result, { adapterId, operation, reconcile = false } = {}) {
  const status = requiredText(result?.status, "adapter result.status");
  if (!RESULT_STATUSES.has(status)) throw new Error(`Status de adapter inválido: ${status}.`);
  const artifactIds = [...new Set((result?.artifacts ?? []).map((artifact, index) => {
    const id = artifact?.id ?? artifact?.artifactId ?? artifact;
    return safeId(id, `adapter result.artifacts[${index}]`);
  }))];
  const receiptId = result?.receipt?.id ?? result?.receiptId ?? null;
  if (status === "ready" && !requiredText(receiptId, "adapter result.receiptId")) throw new Error("Resultado ready exige receiptId.");
  if (status === "pending" && !requiredText(result?.providerHandle, "adapter result.providerHandle")) throw new Error("Resultado pending exige providerHandle.");
  const body = {
    schema: ADAPTER_RESULT_SCHEMA,
    adapterId: safeId(adapterId ?? result?.adapterId, "adapterId"),
    operation: safeId(operation ?? result?.operation, "operation"),
    status,
    reconcile,
    artifactIds,
    receiptId: receiptId == null ? null : safeId(receiptId, "receiptId"),
    providerHandle: result?.providerHandle == null ? null : safeId(result.providerHandle, "providerHandle"),
    nextAction: result?.nextAction == null ? (status === "ambiguous" ? "reconcile" : status === "pending" ? "wait-or-reconcile" : status === "failed" ? "report" : "none") : requiredText(result.nextAction, "nextAction"),
    error: result?.error == null ? null : sanitizeError(result.error),
    metadata: structuredClone(result?.metadata ?? {}),
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export async function executeAdapterInvocation({ adapter, invocation, authorization = null, authorize = null } = {}) {
  assertAdapterContract(adapter);
  assertInvocation(invocation);
  if (invocation.adapterId !== adapter.id || invocation.providerId !== adapter.providerId) throw new Error("Invocation não pertence ao adapter informado.");
  if (invocation.preflight.status !== "ready") throw new Error(`Adapter bloqueado antes da execução: ${invocation.preflight.blockers.join(", ")}.`);
  if (invocation.paid) {
    if (!authorization) throw new Error("Nó pago exige ExecutionAuthorization antes do adapter.");
    if (typeof authorize !== "function") throw new Error("Execução paga exige callback de autorização JIT.");
    await authorize({ adapter, invocation, authorization });
  }
  const result = await adapter.execute({ operation: invocation.operation, request: structuredClone(invocation.request), authorization });
  return normalizeAdapterResult(result, { adapterId: adapter.id, operation: invocation.operation });
}

/**
 * Execução avulsa: o comando de CLI que o humano acabou de digitar.
 *
 * `executeAdapterInvocation` exige `ExecutionAuthorization` em operação paga, e
 * está certo para o que ela governa — nó de filme planejado, preso a
 * planFingerprint, aprovação e decisão de direitos. Um comando avulso não tem
 * plano nem aprovação: fabricar esses hashes só para satisfazer a assinatura
 * poria no recibo uma autorização que não autoriza nada.
 *
 * O que **não** se perde aqui: o preflight contra o registro de capacidades já
 * foi feito ao montar a invocation, e continua sendo obrigatório — capacidade
 * `pending`, `blocked`, sem saúde ou vencida barra a execução antes de tocar o
 * provedor. O resultado sai normalizado na mesma taxonomia
 * `ready | pending | ambiguous | failed`.
 *
 * O que se dispensa é só a autorização presa a plano. Isto não é um portão de
 * gasto: o projeto removeu a confirmação por chamada em 07/08/2026 de propósito,
 * porque autenticação é por cookie e não há custo medido por chamada.
 */
export async function executeDirectAdapterInvocation({ adapter, invocation } = {}) {
  assertAdapterContract(adapter);
  assertInvocation(invocation);
  if (invocation.adapterId !== adapter.id || invocation.providerId !== adapter.providerId) throw new Error("Invocation não pertence ao adapter informado.");
  if (invocation.preflight.status !== "ready") throw new Error(`Adapter bloqueado antes da execução: ${invocation.preflight.blockers.join(", ")}.`);
  const result = await adapter.execute({ operation: invocation.operation, request: structuredClone(invocation.request), authorization: null });
  return normalizeAdapterResult(result, { adapterId: adapter.id, operation: invocation.operation });
}
export async function reconcileAdapterInvocation({ adapter, invocation, request = {}, authorization = null } = {}) {
  assertAdapterContract(adapter);
  assertInvocation(invocation);
  if (!adapter.reconcileOperations.includes(invocation.operation)) throw new Error(`Adapter ${adapter.id} não declara reconcile para ${invocation.operation}.`);
  const result = await adapter.reconcile({ operation: invocation.operation, request: structuredClone(request), authorization });
  return normalizeAdapterResult(result, { adapterId: adapter.id, operation: invocation.operation, reconcile: true });
}

export async function runAdapterConformanceSuite({ adapter, capabilityRegistry, operation, request = {}, now = new Date() } = {}) {
  assertAdapterContract(adapter);
  const invocation = buildAdapterInvocation({ adapter, capabilityRegistry, operation, request, now });
  const checks = [
    { id: "contract", passed: true },
    { id: "preflight", passed: invocation.preflight.status === "ready" },
    { id: "paid-gate", passed: adapter.paidOperations.includes(operation) ? invocation.authorizationRequired === true : invocation.authorizationRequired === false },
    { id: "reconcile-isolated", passed: adapter.reconcileOperations.includes(operation) ? typeof adapter.reconcile === "function" : true },
  ];
  return {
    schema: ADAPTER_CONFORMANCE_SCHEMA,
    adapterId: adapter.id,
    providerId: adapter.providerId,
    operation,
    providerFree: true,
    invocationFingerprint: invocation.fingerprint,
    checks,
    passed: checks.every((check) => check.passed),
    fingerprint: operationFingerprint({ adapterId: adapter.id, providerId: adapter.providerId, operation, checks, invocationFingerprint: invocation.fingerprint }),
  };
}

