export const RUNTIME_ADMISSION_SCHEMA = "mkt-videos/runtime-admission@1";

// A exclusividade pertence ao efeito e às suas entradas. Uma operação de
// outro ramo pode estar gerando normalmente enquanto este nó fica pronto.
export function unresolvedExecutionDependencies({ nodeId, nodes, snapshot }) {
  const byId = nodes instanceof Map ? nodes : new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set();
  const unresolved = [];
  const visit = (id) => {
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new Error(`Nó de dependência desconhecido: ${id}.`);
    visited.add(id);
    if (["ambiguous", "provider_pending"].includes(snapshot.nodes[id]?.status)) unresolved.push(id);
    for (const dependency of node.dependencies ?? []) visit(dependency);
  };
  visit(nodeId);
  return unresolved.sort();
}

function instant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} inválido.`);
  return date;
}

export function evaluateRuntimeAdmission({
  capability = null,
  rights = null,
  freeBytes = null,
  requiredBytes = 0,
  circuit = null,
  pendingAmbiguous = false,
  now = new Date(),
} = {}) {
  const timestamp = instant(now, "now");
  const blockers = [];
  if (!capability || capability.status !== "supported" || capability.proof?.valid !== true) blockers.push("capability_not_proved");
  if (capability?.expiresAt != null && Date.parse(capability.expiresAt) <= timestamp.getTime()) blockers.push("capability_expired");
  if (!rights || rights.status !== "allowed" || rights.revoked === true) blockers.push(rights?.revoked ? "rights_revoked" : "rights_not_allowed");
  const needed = Number(requiredBytes);
  if (!Number.isFinite(needed) || needed < 0) throw new Error("requiredBytes inválido.");
  if (freeBytes != null && (!Number.isFinite(Number(freeBytes)) || Number(freeBytes) < needed)) blockers.push("insufficient_disk_space");
  if (circuit?.status === "open" && (circuit.retryAt == null || Date.parse(circuit.retryAt) > timestamp.getTime())) blockers.push("circuit_open");
  if (pendingAmbiguous) blockers.push("ambiguous_attempt_requires_reconciliation");
  return Object.freeze({
    schema: RUNTIME_ADMISSION_SCHEMA,
    status: blockers.length ? "blocked" : "ready",
    evaluatedAt: timestamp.toISOString(),
    blockers: [...new Set(blockers)].sort(),
    checks: {
      capabilityId: capability?.id ?? null,
      capabilityProofHash: capability?.proof?.hash ?? null,
      rightsDecisionId: rights?.id ?? null,
      freeBytes: freeBytes == null ? null : Number(freeBytes),
      requiredBytes: needed,
      circuit: circuit?.status ?? "closed",
      pendingAmbiguous: Boolean(pendingAmbiguous),
    },
  });
}
