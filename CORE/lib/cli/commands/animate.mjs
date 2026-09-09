export async function executar(contexto) {
  const {
    path,
    PROVIDER_WAIT_POLICY,
    resolveProviderWaitMs,
    animateDraft,
    withCliResourceLease,
    required,
    cookieRuntime,
    options,
  } = contexto;
  {
    const { videoAdapter } = await cookieRuntime(options);
    const parallel = Number(options.parallel ?? 3);
    const result = await withCliResourceLease({ resource: "provider:omni", weight: Math.min(3, parallel), productionId: `animate:${path.resolve(required(options.draft, "--draft"))}` }, () => animateDraft({
      draftFile: path.resolve(required(options.draft, "--draft")),
      videoAdapter,
      budget: options.budget == null ? null : Number(options.budget),
      parallel,
      timeoutMs: resolveProviderWaitMs("omni", options.timeout ?? PROVIDER_WAIT_POLICY.omni.defaultMs),
      pollIntervalMs: Number(options.poll ?? 5_000),
    }));
    console.log(JSON.stringify({ status: result.status, draft: result.stateFile, scenes: result.scenes.map((scene) => ({ id: scene.id, status: scene.status, video: scene.videoFile, receipt: scene.videoReceipt })) }, null, 2));
  }
}
