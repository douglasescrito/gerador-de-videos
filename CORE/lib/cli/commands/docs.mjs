export async function executar(contexto) {
  const {
    buildEffectiveCapabilityMap,
    officialDocs,
  } = contexto;
  {
    const capabilityMap = await buildEffectiveCapabilityMap();
    const operationalPending = Object.fromEntries(capabilityMap.capabilities
      .filter((entry) => entry.status === "pending")
      .map((entry) => [entry.id, { status: entry.status, lastLiveProbe: entry.evidenceAt, evidence: entry.evidence, deliveryDependencyAllowed: entry.deliveryDependencyAllowed }]));
    console.log(JSON.stringify({ ...officialDocs, operationalPending, capabilityMap }, null, 2));
  }
}
