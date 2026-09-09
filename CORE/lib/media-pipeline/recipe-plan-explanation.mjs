/** Projeção somente de leitura do plano já compilado; não agenda nem executa. */
export function explainRecipeExecution(plan) {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const ancestry = new Map();
  function ancestors(id) {
    if (ancestry.has(id)) return ancestry.get(id);
    const result = new Set();
    ancestry.set(id, result);
    for (const dependency of byId.get(id).dependencies) {
      result.add(dependency);
      for (const prior of ancestors(dependency)) result.add(prior);
    }
    return result;
  }
  const overlap = [];
  let truncated = false;
  outer: for (let left = 0; left < plan.nodes.length; left++) {
    for (let right = left + 1; right < plan.nodes.length; right++) {
      const a = plan.nodes[left];
      const b = plan.nodes[right];
      if (ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id)) continue;
      if (overlap.length === 24) { truncated = true; break outer; }
      const sharedResources = a.resources.filter((resource) => b.resources.some((other) => other.id === resource.id)).map((resource) => resource.id);
      overlap.push({ nodes: [a.id, b.id], sharedResources });
    }
  }
  return {
    planFingerprint: plan.fingerprint,
    ...(plan.spec.styleComposition ? { styleComposition: structuredClone(plan.spec.styleComposition) } : {}),
    nodes: plan.nodes.map(({ id, kind, dependencies, resources, costClass }) => ({ id, kind, dependencies: [...dependencies], resources: structuredClone(resources), costClass })),
    initiallyReady: plan.nodes.filter((node) => !node.dependencies.length).map((node) => node.id),
    possibleOverlap: { pairs: overlap, truncated, meaning: "Sem dependência material entre os nós; a capacidade disponível e a admissão do runtime ainda condicionam a execução." },
    declaredInputs: (plan.spec.resources ?? []).map(({ id, role, source, sha256, bytes }) => ({ id, role, source: structuredClone(source), sha256, bytes, verification: "requires-byte-preflight-and-runtime-rights" })),
    reuse: structuredClone(plan.spec.reuse),
    outputs: { masterFormat: plan.spec.formats.master, variants: structuredClone(plan.spec.formats.variants), physicalValidation: "pending-production", receipts: "emitted-by-executor" },
    measuredDuration: null,
    providerCalls: 0,
  };
}
