import { randomUUID } from "node:crypto";
import { DEFAULT_CAPACITY_WAIT_MS } from "./resource-broker.mjs";
import { measureExecutionPhase } from "./execution-timing.mjs";

export const RESOURCE_LEASE_WAIT_SCHEMA = "mkt-videos/resource-lease-wait@1";
// Renovação do lease durante o efeito. O kernel já usava 10 s; a rota direta
// e as duas rotas de lote passam a usar a mesma, porque assimetria aqui é o
// que quebra quando a espera por capacidade fica longa.
export const DEFAULT_HEARTBEAT_MS = 10_000;
// Depois de esperar mais que isto na fila, a admissão é reavaliada antes do
// efeito: capability, prova e disco podem ter vencido enquanto o job
// aguardava. Fila concluída não reaproveita verificação vencida.
export const DEFAULT_REVALIDATE_AFTER_MS = 60_000;

export class ResourceCapacityTimeoutError extends Error {
  constructor(label, waitedMs) {
    super(`Sem capacidade para ${label} após ${Math.round(waitedMs / 1000)}s de espera. Nenhuma submissão foi feita.`);
    this.name = "ResourceCapacityTimeoutError";
    this.label = label;
    this.waitedMs = waitedMs;
    this.effectSubmitted = false;
  }
}

export class ResourceAdmissionBlockedError extends Error {
  constructor(label, blockers) {
    super(`Admissão bloqueou ${label}: ${blockers.join(", ")}.`);
    this.name = "ResourceAdmissionBlockedError";
    this.label = label;
    this.blockers = [...blockers];
    this.effectSubmitted = false;
  }
}

function normalizeResources(resources) {
  const list = Array.isArray(resources) ? resources : [resources];
  if (!list.length) throw new Error("withResourceLease exige ao menos um recurso.");
  return list.map((entry) => (typeof entry === "string"
    ? { id: entry, weight: 1 }
    : { id: entry.id, weight: Math.max(1, Number(entry.weight) || 1) }));
}

async function resolveAdmission(admission, context) {
  if (admission == null) return null;
  return typeof admission === "function" ? await admission(context) : admission;
}

/**
 * Ciclo único de lease para toda submissão paga: admissão antes da vaga,
 * espera por capacidade separada do timeout do provedor, heartbeat durante
 * o efeito, aborto se o lease for revogado, liberação garantida.
 *
 * Era a implementação do execution-kernel. Agora é a de todo mundo.
 */
export async function withResourceLease({
  broker,
  resources,
  productionId,
  clientId = "local",
  priority = "interactive",
  requestId = null,
  admission = null,
  capacityWaitMs = DEFAULT_CAPACITY_WAIT_MS,
  pollMs,
  maxPollMs,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  revalidateAfterMs = DEFAULT_REVALIDATE_AFTER_MS,
  signal = null,
  onQueued = null,
  label = null,
}, execute) {
  if (!broker || typeof broker.acquire !== "function") throw new Error("withResourceLease exige um broker.");
  const normalizedResources = normalizeResources(resources);
  const description = label ?? normalizedResources.map((resource) => resource.id).join("+");
  // Identidade de disputa é da INVOCAÇÃO. Derivar de relógio faz dois
  // processos no mesmo milissegundo colidirem e um deles morrer em vez de
  // entrar na fila.
  const normalizedRequestId = requestId ?? randomUUID();
  const context = { productionId, clientId, resources: normalizedResources, requestId: normalizedRequestId };

  const assertNotCancelled = () => {
    if (!signal?.aborted) return;
    const error = new Error("Aquisição de recurso cancelada antes do efeito.");
    error.name = "AbortError";
    error.postStarted = false;
    throw error;
  };
  assertNotCancelled();
  const initialAdmission = admission == null ? null : await measureExecutionPhase("admission", () => resolveAdmission(admission, { ...context, phase: "before-queue" }));
  assertNotCancelled();
  if (initialAdmission && initialAdmission.status !== "ready") {
    throw new ResourceAdmissionBlockedError(description, initialAdmission.blockers ?? ["admission_blocked"]);
  }

  const acquired = await measureExecutionPhase("capacity-wait", () => broker.acquire({
    requestId: normalizedRequestId,
    productionId,
    clientId,
    priority,
    resources: normalizedResources,
    admission: initialAdmission,
  }, { timeoutMs: capacityWaitMs, signal, onQueued, ...(pollMs == null ? {} : { pollMs }), ...(maxPollMs == null ? {} : { maxPollMs }) }));

  if (acquired.status === "blocked") throw new ResourceAdmissionBlockedError(description, acquired.blockers ?? ["admission_blocked"]);
  if (acquired.status !== "acquired" || !acquired.lease) throw new ResourceCapacityTimeoutError(description, acquired.waitedMs ?? capacityWaitMs);

  const leaseId = acquired.lease.leaseId;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  let heartbeatError = null;
  const heartbeat = setInterval(() => {
    try { broker.heartbeat(leaseId); }
    catch (error) {
      heartbeatError = error;
      controller.abort(error);
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    assertNotCancelled();
    if (admission != null && Number(acquired.waitedMs ?? 0) >= revalidateAfterMs) {
      const revalidated = await measureExecutionPhase("admission", () => resolveAdmission(admission, { ...context, phase: "after-queue", waitedMs: acquired.waitedMs }));
      if (revalidated && revalidated.status !== "ready") {
        throw new ResourceAdmissionBlockedError(description, revalidated.blockers ?? ["admission_blocked"]);
      }
    }
    assertNotCancelled();
    const result = await execute(Object.freeze({ ...acquired.lease, signal: controller.signal, waitedMs: acquired.waitedMs ?? 0 }));
    if (heartbeatError) throw new Error(`Lease de ${description} foi revogado durante o efeito; o estado deve ser reconciliado.`, { cause: heartbeatError });
    return result;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearInterval(heartbeat);
    broker.release(leaseId);
  }
}

/**
 * Aviso padrão de espera por capacidade. Vai para stderr porque stdout dos
 * comandos carrega JSON que outros processos leem — e porque fila não é
 * resultado, é estado.
 */
export function reportQueueWait({ label, stream = process.stderr } = {}) {
  return (event) => {
    stream.write(`${JSON.stringify({
      schema: RESOURCE_LEASE_WAIT_SCHEMA,
      status: "waiting-for-capacity",
      label: label ?? null,
      requestId: event.requestId,
      deadlineAt: event.deadlineAt,
      effectSubmitted: false,
    })}\n`);
  };
}
