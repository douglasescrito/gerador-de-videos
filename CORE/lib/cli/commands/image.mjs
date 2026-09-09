export async function executar(contexto) {
  const {
    mkdir,
    path,
    DIRECT_REQUIRED_BYTES,
    createDirectAdmission,
    assertDirectProviderInputPermitJit,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    withCliResourceLease,
    cookieRuntime,
    preflightDirectProviderInputs,
    withDirectProviderInputMetadata,
    promptComposition,
    optionText,
    defaultImageOutput,
    options,
  } = contexto;
  {
    const userPrompt = await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    const { mode, composition } = promptComposition(userPrompt, options);
    const images = (options.images ?? []).map((file) => path.resolve(String(file)));
    const providerInputDescriptors = images.map((file) => ({
      file,
      role: "reference-image",
      operation: "generate-image",
    }));
    const providerInputPermit = await preflightDirectProviderInputs(
      options,
      providerInputDescriptors,
      {
        purpose: "direct-image-generation",
        expectedOperations: "generate-image",
      },
    );
    const outputFile = path.resolve(String(options.out ?? defaultImageOutput()));
    await mkdir(path.dirname(outputFile), { recursive: true });
    const { imageAdapter } = await cookieRuntime(options);
    if (providerInputPermit) {
      await assertDirectProviderInputPermitJit(
        providerInputPermit,
        providerInputDescriptors,
        { requireAll: true },
      );
    }
    // Quinto adapter sob o contrato: mesma geração, com preflight de capacidade
    // antes de tocar o provedor e resultado normalizado.
    const { createGeminiImageAdapter } = await import("../../media-pipeline/adapters/gemini-image.mjs");
    const adapterImagemOmni = createGeminiImageAdapter({ operacaoDeImagem: imageAdapter });
    const pedidoImagem = {
      prompt: composition.effectivePrompt,
      outputFile,
      images,
      model: options.model ?? "gemini-3.1-flash-image",
      aspectRatio: options.aspect ?? "1:1",
      imageSize: options.size ?? "2K",
      timeoutMs: Number(options.timeout ?? 300_000),
      providerInputPermit,
      metadata: withDirectProviderInputMetadata(
        { mode, promptComposition: composition },
        providerInputPermit,
      ),
    };
    const invocacaoImagem = buildAdapterInvocation({
      adapter: adapterImagemOmni,
      capabilityRegistry: await probeProviderRegistry({ probes: {} }),
      operation: "image-generate",
      request: pedidoImagem,
      estimate: await adapterImagemOmni.estimate({ request: pedidoImagem }),
    });
    const result = await withCliResourceLease(
      {
        resource: "provider:omni",
        productionId: `image:${outputFile}`,
        admission: createDirectAdmission({
          invocation: invocacaoImagem,
          permit: providerInputPermit,
          permitDescriptors: providerInputDescriptors,
          outputFile,
          requiredBytes: DIRECT_REQUIRED_BYTES.image,
        }),
      },
      () => executeDirectAdapterInvocation({ adapter: adapterImagemOmni, invocation: invocacaoImagem }),
    );
    console.log(JSON.stringify({
      adapter: adapterImagemOmni.id,
      status: result.status,
      file: result.metadata?.file ?? null,
      receipt: result.metadata?.receiptFile ?? null,
      interactionId: result.metadata?.interactionId ?? null,
      invocationFingerprint: invocacaoImagem.fingerprint,
      preflight: invocacaoImagem.preflight.status,
    }, null, 2));
  }
}
