export async function executar(contexto) {
  const {
    path,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    withCliResourceLease,
    required,
    studioMode,
    optionText,
    options,
  } = contexto;
  {
    // Primeiro dos seis adapters de mídia a passar pelo contrato: a geração é a
    // mesma de sempre, o que entrou foi a moldura — preflight contra o registro
    // de capacidades antes de tocar o provedor, e resultado normalizado.
    studioMode(options, "flow-image");
    const prompt = await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    const outputFile = path.resolve(required(options.out, "--out"));
    if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Flow real é proibido em NODE_ENV=test.");
    const { createFlowImageAdapter } = await import("../../media-pipeline/adapters/flow-image.mjs");
    const adapterImagem = createFlowImageAdapter();
    const registroDeCapacidades = await probeProviderRegistry({ probes: {} });
    const pedido = {
      prompt,
      outputFile,
      projectUrl: options["project-url"] ?? null,
      aspectRatio: options.aspect ?? "16:9",
      count: options.count == null ? 1 : Number(options.count),
      timeoutMs: options.timeout == null ? undefined : Number(options.timeout),
    };
    const invocacao = buildAdapterInvocation({
      adapter: adapterImagem,
      capabilityRegistry: registroDeCapacidades,
      operation: "image-generate",
      request: pedido,
      estimate: await adapterImagem.estimate({ request: pedido }),
    });
    const saida = await withCliResourceLease(
      { resource: "provider:flow", productionId: `flow-image:${outputFile}` },
      () => executeDirectAdapterInvocation({ adapter: adapterImagem, invocation: invocacao }),
    );
    console.log(JSON.stringify({
      adapter: adapterImagem.id,
      status: saida.status,
      files: saida.metadata?.files ?? [],
      receipt: saida.metadata?.receiptFile ?? null,
      model: saida.metadata?.model ?? null,
      aspectRatio: saida.metadata?.aspectRatio ?? null,
      count: saida.metadata?.count ?? null,
      creditos: saida.metadata?.creditos ?? null,
      attempts: saida.metadata?.attempts ?? null,
      invocationFingerprint: invocacao.fingerprint,
      preflight: invocacao.preflight.status,
    }, null, 2));
  }
}
