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
    // Último dos seis adapters de mídia sob o contrato.
    studioMode(options, "flow-video");
    const prompt = await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    const outputFile = path.resolve(required(options.out, "--out"));
    if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Flow real é proibido em NODE_ENV=test.");
    const { createFlowVideoAdapter } = await import("../../media-pipeline/adapters/flow-video.mjs");
    const adapterFlowVideo = createFlowVideoAdapter();
    const pedidoFlowVideo = {
      prompt,
      outputFile,
      projectUrl: options["project-url"] ?? null,
      aspectRatio: options.aspect ?? "16:9",
      count: options.count == null ? 1 : Number(options.count),
      resolution: options.resolution ?? "720p",
      duration: options.duration == null ? 8 : Number(options.duration),
      timeoutMs: options.timeout == null ? undefined : Number(options.timeout),
    };
    const invocacaoFlowVideo = buildAdapterInvocation({
      adapter: adapterFlowVideo,
      capabilityRegistry: await probeProviderRegistry({ probes: {} }),
      operation: "text-to-video",
      request: pedidoFlowVideo,
      estimate: await adapterFlowVideo.estimate({ request: pedidoFlowVideo }),
    });
    const saidaFlowVideo = await withCliResourceLease(
      { resource: "provider:flow", productionId: `flow-video:${outputFile}` },
      () => executeDirectAdapterInvocation({ adapter: adapterFlowVideo, invocation: invocacaoFlowVideo }),
    );
    console.log(JSON.stringify({
      adapter: adapterFlowVideo.id,
      status: saidaFlowVideo.status,
      files: saidaFlowVideo.metadata?.files ?? [],
      receipt: saidaFlowVideo.metadata?.receiptFile ?? null,
      model: saidaFlowVideo.metadata?.model ?? null,
      aspectRatio: saidaFlowVideo.metadata?.aspectRatio ?? null,
      resolution: saidaFlowVideo.metadata?.resolution ?? null,
      duration: saidaFlowVideo.metadata?.duration ?? null,
      count: saidaFlowVideo.metadata?.count ?? null,
      creditos: saidaFlowVideo.metadata?.creditos ?? null,
      attempts: saidaFlowVideo.metadata?.attempts ?? null,
      invocationFingerprint: invocacaoFlowVideo.fingerprint,
      preflight: invocacaoFlowVideo.preflight.status,
    }, null, 2));
  }
}
