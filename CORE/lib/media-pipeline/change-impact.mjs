export const CHANGE_IMPACT_SCHEMA = "mkt-videos/change-impact@1";

function staleStatus(node) {
  if (node.kind === "human-approval") return "reapproval_required";
  if (node.costClass === "paid" || node.costClass === "semantic-paid") return "stale_paid";
  return "stale_local";
}

function dependencyPropagates(node, dependencyId) {
  if (node.kind === "keyframe" || node.kind === "deterministic-card") return false;
  if (node.kind === "music-generate") return false;
  if (node.kind === "omni-video") return dependencyId.startsWith("keyframe:");
  return true;
}

export function analyzeChangeImpact(previousPlan, nextPlan) {
  if (previousPlan?.schema !== "mkt-videos/execution-plan@1" || nextPlan?.schema !== "mkt-videos/execution-plan@1") throw new Error("change-impact exige dois execution-plan@1.");
  const previous = new Map(previousPlan.nodes.map((node) => [node.id, node]));
  const next = new Map(nextPlan.nodes.map((node) => [node.id, node]));
  const impacts = new Map();
  for (const node of nextPlan.nodes) {
    const prior = previous.get(node.id);
    if (!prior) impacts.set(node.id, { nodeId: node.id, status: staleStatus(node), reason: "node_added", direct: true });
    else if (prior.fingerprint !== node.fingerprint) impacts.set(node.id, { nodeId: node.id, status: staleStatus(node), reason: "semantic_fingerprint_changed", direct: true, previousFingerprint: prior.fingerprint, nextFingerprint: node.fingerprint });
  }
  for (const node of previousPlan.nodes) if (!next.has(node.id)) impacts.set(node.id, { nodeId: node.id, status: staleStatus(node), reason: "node_removed", direct: true, removed: true });
  for (const node of nextPlan.nodes) {
    if (impacts.has(node.id)) continue;
    const upstream = node.dependencies.filter((dependency) => impacts.has(dependency) && dependencyPropagates(node, dependency));
    if (upstream.length) impacts.set(node.id, { nodeId: node.id, status: staleStatus(node), reason: "upstream_changed", direct: false, upstream });
  }
  const changes = [...impacts.values()];
  const counts = { stale_local: 0, stale_paid: 0, reapproval_required: 0 };
  for (const change of changes) counts[change.status] += 1;
  return {
    schema: CHANGE_IMPACT_SCHEMA,
    previousPlanFingerprint: previousPlan.fingerprint,
    nextPlanFingerprint: nextPlan.fingerprint,
    changed: previousPlan.fingerprint !== nextPlan.fingerprint,
    counts,
    paidPostsRequired: counts.stale_paid,
    changes,
  };
}
