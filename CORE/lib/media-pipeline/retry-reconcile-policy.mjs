import { createHash } from "node:crypto";

export const RETRY_RECONCILE_DECISION_SCHEMA = "mkt-videos/retry-reconcile-decision@1";

const STATES = new Set([
  "pre_effect_failed",
  "provider_rejected",
  "provider_pending",
  "local_persist_failed",
  "ambiguous",
  "aesthetic_failure",
  "completed",
]);

function instant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} inválido.`);
  return date;
}

function boundedInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} deve ser inteiro entre ${min} e ${max}.`);
  }
  return number;
}

function retryAfterDelayMs(value, now) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value) * 1_000);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed - now.getTime()) : null;
}

function deterministicJitter(seed, ceilingMs) {
  if (ceilingMs <= 0) return 0;
  const digest = createHash("sha256").update(String(seed)).digest();
  return digest.readUInt32BE(0) % (Math.floor(ceilingMs) + 1);
}

function retryDueAt({ now, attemptNumber, retryAfter, baseDelayMs, maxDelayMs, jitterRatio, seed }) {
  const retryAfterDelay = retryAfterDelayMs(retryAfter, now) ?? 0;
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attemptNumber - 1)));
  const jitter = deterministicJitter(seed, exponential * jitterRatio);
  return new Date(now.getTime() + Math.min(maxDelayMs, Math.max(retryAfterDelay, exponential + jitter))).toISOString();
}

export function classifyRetryReconcile({
  state,
  attemptNumber = 1,
  maxAttempts = 1,
  terminalRejectionProved = false,
  rejectionRetryable = false,
  providerHandle = null,
  retryAfter = null,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
  jitterRatio = 0.2,
  seed = "retry",
  now = new Date(),
} = {}) {
  const normalizedState = String(state ?? "").trim();
  if (!STATES.has(normalizedState)) throw new Error(`Estado de retry desconhecido: ${normalizedState || "<vazio>"}.`);
  const currentAttempt = boundedInteger(attemptNumber, "attemptNumber", { min: 1, max: 100 });
  const limit = boundedInteger(maxAttempts, "maxAttempts", { min: 1, max: 100 });
  const timestamp = instant(now, "now");
  const hasCapacity = currentAttempt < limit;
  let action = "stop";
  let reason = "terminal";
  let createsNewAttempt = false;
  let dueAt = null;

  if (normalizedState === "completed") {
    action = "reuse-completed";
    reason = "effect_already_completed";
  } else if (normalizedState === "provider_pending") {
    if (!String(providerHandle ?? "").trim()) throw new Error("provider_pending exige handle para reconciliação.");
    action = "reconcile";
    reason = "provider_effect_may_exist";
  } else if (normalizedState === "ambiguous") {
    action = "reconcile";
    reason = "external_effect_unknown";
  } else if (normalizedState === "local_persist_failed") {
    action = "recover-artifact";
    reason = "provider_effect_completed_local_persistence_failed";
  } else if (normalizedState === "aesthetic_failure") {
    action = "preserve-original";
    reason = "aesthetic_evaluation_never_authorizes_retry";
  } else if (normalizedState === "provider_rejected" && (!terminalRejectionProved || rejectionRetryable !== true)) {
    action = "stop";
    reason = !terminalRejectionProved ? "terminal_rejection_not_proved" : "permanent_provider_rejection";
  } else if ((normalizedState === "pre_effect_failed" || normalizedState === "provider_rejected") && hasCapacity) {
    action = "retry-when-due";
    reason = normalizedState === "pre_effect_failed" ? "external_effect_absent" : "terminal_provider_rejection";
    createsNewAttempt = true;
    dueAt = retryDueAt({
      now: timestamp,
      attemptNumber: currentAttempt,
      retryAfter,
      baseDelayMs: boundedInteger(baseDelayMs, "baseDelayMs", { min: 0, max: 86_400_000 }),
      maxDelayMs: boundedInteger(maxDelayMs, "maxDelayMs", { min: 0, max: 86_400_000 }),
      jitterRatio: Math.min(1, Math.max(0, Number(jitterRatio))),
      seed: `${seed}:${normalizedState}:${currentAttempt}`,
    });
  } else if (normalizedState === "pre_effect_failed" || normalizedState === "provider_rejected") {
    reason = "max_attempts_reached";
  }

  return Object.freeze({
    schema: RETRY_RECONCILE_DECISION_SCHEMA,
    state: normalizedState,
    action,
    reason,
    createsNewAttempt,
    dueAt,
    providerHandle: providerHandle == null ? null : String(providerHandle),
    attemptNumber: currentAttempt,
    maxAttempts: limit,
    evaluatedAt: timestamp.toISOString(),
    invariants: {
      ambiguousNeverSubmits: normalizedState !== "ambiguous" || !createsNewAttempt,
      persistenceFailureNeverSubmits: normalizedState !== "local_persist_failed" || !createsNewAttempt,
      aestheticFailureNeverSubmits: normalizedState !== "aesthetic_failure" || !createsNewAttempt,
    },
  });
}
