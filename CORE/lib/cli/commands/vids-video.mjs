export async function executar(contexto) {
  const {
    path,
    createCookieVidsVideoOperation,
    withCliResourceLease,
    required,
    studioMode,
    optionText,
    options,
  } = contexto;
  {
    studioMode(options, "vids-video");
    const prompt = await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    const outputFile = path.resolve(required(options.out, "--out"));
    if (process.env.NODE_ENV === "test") throw new Error("Provider-free test guard: Google Vids real é proibido em NODE_ENV=test.");
    const generateVidsVideo = createCookieVidsVideoOperation();
    const result = await withCliResourceLease({ resource: "provider:vids", productionId: `vids-video:${outputFile}` }, () => generateVidsVideo({
      provider: "google-vids-video",
      prompt,
      outputFile,
      documentUrl: options["document-url"] ?? null,
      aspectRatio: options.aspect ?? "16:9",
      timeoutMs: options.timeout == null ? undefined : Number(options.timeout),
    }));
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, model: result.model, aspectRatio: result.aspectRatio, width: result.width, height: result.height, durationSeconds: result.durationSeconds, quota: result.quota, attempts: result.attempts }, null, 2));
  }
}
