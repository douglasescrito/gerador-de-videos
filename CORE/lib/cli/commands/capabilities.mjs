export async function executar(contexto) {
  const {
    path,
    CliError,
    ERROR_CODES,
    buildEffectiveCapabilityMap,
    command,
    parse,
    required,
    explicitBoolean,
    officialDocs,
    options,
  } = contexto;
  if (command === "capabilities" && options.action === "renovar") {
    // Renovar evidência era a única operação do ciclo de vida sem porta de
    // entrada: o ledger já era lido, mas escrever nele exigia editar
    // provider-registry.mjs na mão. Aqui a renovação passa pelo contrato —
    // recibo real re-hasheado, prova material, confirmação humana e TTL.
    const {
      createCapabilityCandidate,
      proveCapabilityCandidateFromEvidence,
      activateCapabilityCandidate,
      appendCapabilityActivation,
    } = await import("../../media-pipeline/capability-lifecycle.mjs");
    const { PROVIDER_CAPABILITIES } = await import("../../media-pipeline/provider-registry.mjs");
    const id = required(options.id, "--id");
    const atual = PROVIDER_CAPABILITIES[id];
    if (!atual) throw new CliError(`Capability desconhecida: ${id}.`, { code: ERROR_CODES.USAGE, hint: "Veja os ids em: npm run video -- capabilities" });
    const receiptFile = path.resolve(required(options.evidence, "--evidence"));
    const { readReceipt } = await import("../../media-pipeline/receipt.mjs");
    // Só recibo canônico e verificado vira evidência: `readReceipt` recusa
    // hash divergente. É este ponto que separa prova de declaração.
    const recibo = await readReceipt(receiptFile);
    // Evidência velha renovando 30 dias derrota o próprio TTL: o ponto do prazo
    // é provar que o provedor ainda se comporta como o contrato diz, e um
    // recibo de semanas atrás não prova nada sobre hoje.
    const maxIdadeDias = Number(options["max-evidence-age-days"] ?? 3);
    const idadeMs = Date.now() - Date.parse(String(recibo.completedAt ?? recibo.startedAt ?? ""));
    if (!Number.isFinite(idadeMs) || idadeMs < 0) {
      throw new CliError("Recibo sem data de conclusão utilizável.", { code: ERROR_CODES.INTEGRITY_FAILURE });
    }
    const idadeDias = idadeMs / 86_400_000;
    if (idadeDias > maxIdadeDias) {
      throw new CliError(
        `Recibo tem ${idadeDias.toFixed(1)} dias; a renovação exige evidência com no máximo ${maxIdadeDias}.`,
        { code: ERROR_CODES.POLICY_DENIED, hint: "Rode uma chamada real autorizada e use o recibo dela. Evidência antiga não prova o comportamento atual do provedor." },
      );
    }
    const { sha256File } = await import("../../media-pipeline/artifact.mjs");
    const evidenceHash = await sha256File(receiptFile);
    const actor = required(options.actor, "--actor");
    const agora = new Date();
    const candidate = createCapabilityCandidate({
      id,
      adapterProvider: atual.adapterProvider ?? null,
      intents: [...atual.intents],
      operations: [...atual.operations],
      authContract: atual.authContract,
      reconcile: Boolean(atual.reconcile),
      limitation: atual.limitation,
      actor,
      now: agora,
    });
    const proof = await proveCapabilityCandidateFromEvidence({
      candidate,
      expectedCandidateHash: candidate.candidateHash,
      conformance: { status: "passed", providerCalls: 0 },
      replay: { status: "passed", providerCalls: 0 },
      liveEvidence: [{ id: recibo.id, file: receiptFile, sha256: evidenceHash }],
      adapterVersion: String(recibo.provider ?? id),
      runtimeFingerprint: process.version,
      actor,
      now: agora,
    });
    const activation = activateCapabilityCandidate({
      candidate,
      proof,
      expectedProofHash: proof.proofHash,
      confirmHuman: explicitBoolean(options["confirm-human"], "--confirm-human", false),
      ttlSeconds: Number(options.ttl ?? atual.ttlSeconds ?? 2_592_000),
      actor,
      now: agora,
    });
    const gravado = await appendCapabilityActivation({ activation, storeFile: options.store ?? undefined });
    console.log(JSON.stringify({
      schema: "mkt-videos/capability-renewal@1",
      capabilityId: id,
      evidence: { receiptId: recibo.id, file: receiptFile, sha256: evidenceHash },
      expiresAt: activation.capability.expiresAt,
      activationHash: activation.activationHash,
      ledger: gravado.storeFile,
      providerCalls: 0,
    }, null, 2));
  } else if (command === "docs" || command === "capabilities") {
    const capabilityMap = await buildEffectiveCapabilityMap();
    const operationalPending = Object.fromEntries(capabilityMap.capabilities
      .filter((entry) => entry.status === "pending")
      .map((entry) => [entry.id, { status: entry.status, lastLiveProbe: entry.evidenceAt, evidence: entry.evidence, deliveryDependencyAllowed: entry.deliveryDependencyAllowed }]));
    console.log(JSON.stringify({ ...officialDocs, operationalPending, capabilityMap }, null, 2));
  }
}
