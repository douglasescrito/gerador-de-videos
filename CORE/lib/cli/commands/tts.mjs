export async function executar(contexto) {
  const {
    path,
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
    // Terceiro adapter sob o contrato: mesma geração, com preflight de
    // capacidade antes de tocar o provedor e resultado normalizado.
    studioMode(options, "tts");
    const text = await optionText(options.text, options["text-file"], "--text", "--text-file");
    const outputFile = path.resolve(required(options.out, "--out"));
    const provider = String(options.provider ?? "google-vids").trim().toLowerCase();
    if (provider !== "google-vids") throw new Error("--provider deve ser google-vids.");
    if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: TTS real é proibido em NODE_ENV=test.");
    const { createGoogleVidsTtsAdapter } = await import("../../media-pipeline/adapters/google-vids-tts.mjs");
    const adapterNarracao = createGoogleVidsTtsAdapter();
    const pedidoNarracao = {
      text,
      outputFile,
      documentUrl: required(options["document-url"], "--document-url"),
      newScene: explicitBoolean(options["new-scene"], "--new-scene", true),
      voice: options.voice ?? "Nyla",
    };
    const invocacaoNarracao = buildAdapterInvocation({
      adapter: adapterNarracao,
      capabilityRegistry: await probeProviderRegistry({ probes: {} }),
      operation: "text-to-speech",
      request: pedidoNarracao,
      estimate: await adapterNarracao.estimate({ request: pedidoNarracao }),
    });
    const saidaNarracao = await withCliResourceLease(
      { resource: "provider:vids", productionId: `tts:${outputFile}` },
      () => executeDirectAdapterInvocation({ adapter: adapterNarracao, invocation: invocacaoNarracao }),
    );
    console.log(JSON.stringify({
      adapter: adapterNarracao.id,
      status: saidaNarracao.status,
      file: saidaNarracao.metadata?.file ?? null,
      receipt: saidaNarracao.metadata?.receiptFile ?? null,
      model: saidaNarracao.metadata?.model ?? null,
      voice: saidaNarracao.metadata?.voice ?? options.voice ?? null,
      attempts: saidaNarracao.metadata?.attempts ?? null,
      invocationFingerprint: invocacaoNarracao.fingerprint,
      preflight: invocacaoNarracao.preflight.status,
    }, null, 2));
  }
}
