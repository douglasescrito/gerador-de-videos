import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function recovery(item) {
  const decisions = {
    pending: ["reorder", "cancel"],
    submitting: ["wait"],
    provider_pending: ["reconcile"],
    persisting: ["wait"],
    completed: ["open-artifact"],
    cancelled: [],
    pre_submit_failed: ["resume-pre-submit"],
    provider_rejected: ["close", "new-attempt-with-human-confirmation"],
    ambiguous: ["investigate", "reconcile"],
    local_persist_failed: ["retry-local-persistence"],
  };
  // Item que perdeu autoridade sobre entrada externa não retoma a mesma
  // tentativa: a única decisão disponível é reconfirmar as referências.
  const awaitingReferences = item.recovery === "reauthorize_references";
  const postAllowed = item.state === "provider_rejected" || awaitingReferences;
  return {
    schema: "mkt-videos/recovery-decision@1",
    itemId: item.id,
    attemptId: item.attemptId,
    observedState: item.state,
    actions: awaitingReferences
      ? ["reauthorize-references-with-human-confirmation"]
      : decisions[item.state] ?? [],
    providerPostAllowed: postAllowed ? "human-confirmation-only" : false,
    authority: "none",
  };
}

export function projectProductionOrder(job) {
  if (job?.schema !== "mkt-videos/batch-job@4") throw new Error("batch-job@4 é obrigatório.");
  const frozen = {
    collection: job.collection,
    defaults: job.defaults,
    parallel: job.parallel,
    items: job.items.map((item) => ({
      id: item.id,
      promptHash: fingerprint(item.prompt),
      templateBinding: item.templateBinding
        ? {
            templateId: item.templateBinding.templateId,
            templateRevision: item.templateBinding.templateRevision,
            templateHash: item.templateBinding.templateHash,
          }
        : null,
      config: item.config ?? null,
      // As entradas externas entram na ordem congelada pelo que elas são —
      // bytes, papel e tipo. Sem isso, dois lotes com o mesmo prompt e
      // referências diferentes teriam a mesma impressão digital. O nome do
      // arquivo preparado fica de fora por ser incidental.
      references: (item.references ?? []).map((reference) => ({
        inputId: reference.inputId,
        role: reference.role,
        sha256: reference.sha256,
        bytes: reference.bytes,
        mimeType: reference.mimeType,
      })),
    })),
  };
  return {
    schema: "mkt-videos/production-order@1",
    id: `order:${job.id.replace(/^batch:/, "")}`,
    batchId: job.id,
    createdAt: job.createdAt,
    collection: job.collection,
    itemCount: job.items.length,
    maximumProviderCalls: job.items.length,
    fingerprint: fingerprint(frozen),
  };
}

export function projectBatchAudit(job) {
  const order = projectProductionOrder(job);
  return {
    schema: "mkt-videos/production-order-audit@1",
    order,
    attempts: job.items.flatMap((item) => [
      ...(item.priorAttempts ?? []),
      ...(item.attemptId ? [{
        schema: "mkt-videos/generation-attempt@1",
        itemId: item.id,
        attemptId: item.attemptId,
        attemptNumber: item.attemptNumber,
        state: item.state,
        effectBoundaryReached: item.effectBoundaryReached,
        fileId: item.fileId,
        interactionId: item.interactionId,
        startedAt: item.startedAt,
        acceptedAt: item.acceptedAt,
        completedAt: item.completedAt,
        error: item.error,
      }] : []),
    ]),
    events: (job.events ?? []).map((event) => ({
      schema: "mkt-videos/attempt-event@1",
      batchId: job.id,
      sequence: event.sequence,
      at: event.at,
      type: event.type,
      itemId: event.itemId,
      details: event.details,
    })),
    recovery: job.items.map(recovery),
    promptContentIncluded: false,
  };
}
