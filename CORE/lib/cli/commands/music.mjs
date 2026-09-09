export async function executar(contexto) {
  const {
    path,
    PROVIDER_WAIT_POLICY,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    withCliResourceLease,
    required,
    explicitBoolean,
    studioMode,
    optionText,
    options,
  } = contexto;
  {
    // Segundo adapter sob o contrato: geração idêntica, com preflight de
    // capacidade antes de tocar o provedor e resultado normalizado.
    studioMode(options, "music");
    const prompt = options.prompt === undefined && options["prompt-file"] === undefined ? null : await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Flow Music real é proibido em NODE_ENV=test.");
    const { createFlowMusicAdapter } = await import("../../media-pipeline/adapters/flow-music.mjs");
    const adapterMusica = createFlowMusicAdapter();
    const musicOutput = path.resolve(required(options.out, "--out"));
    const pedidoMusica = {
      prompt,
      preset: options.preset ?? null,
      backend: options.backend ?? "flow-music",
      outputFile: musicOutput,
      durationSeconds: Number(options.duration ?? 30),
      preserveOriginalDuration: explicitBoolean(options["preserve-original-duration"] ?? options["preserve-music-end"] ?? options["natural-end"], "--preserve-original-duration", false),
      vocals: options.vocals !== undefined ? explicitBoolean(options.vocals, "--vocals") : false,
      timeoutMs: options.timeout == null ? PROVIDER_WAIT_POLICY.flow.defaultMs : Number(options.timeout),
    };
    const invocacaoMusica = buildAdapterInvocation({
      adapter: adapterMusica,
      capabilityRegistry: await probeProviderRegistry({ probes: {} }),
      operation: "music-generate",
      request: pedidoMusica,
      estimate: await adapterMusica.estimate({ request: pedidoMusica }),
    });
    const saidaMusica = await withCliResourceLease(
      { resource: "provider:flow", productionId: `music:${musicOutput}` },
      () => executeDirectAdapterInvocation({ adapter: adapterMusica, invocation: invocacaoMusica }),
    );
    console.log(JSON.stringify({
      adapter: adapterMusica.id,
      status: saidaMusica.status,
      file: saidaMusica.metadata?.file ?? null,
      receipt: saidaMusica.metadata?.receiptFile ?? null,
      providerFile: saidaMusica.metadata?.providerFile ?? null,
      attemptFile: saidaMusica.metadata?.attemptFile ?? null,
      model: saidaMusica.metadata?.model ?? null,
      backend: saidaMusica.metadata?.backend ?? null,
      invocationFingerprint: invocacaoMusica.fingerprint,
      preflight: invocacaoMusica.preflight.status,
    }, null, 2));
  }
}
