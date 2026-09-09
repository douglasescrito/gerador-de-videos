export async function executar(contexto) {
  const {
    path,
    reconcileFilmVideo,
    statusFilm,
    required,
    cookieRuntime,
    createCliResourceBroker,
    options,
  } = contexto;
  {
    if (String(options.stage ?? "video") !== "video") throw new Error("A primeira versão de reconcile aceita apenas --stage video.");
    const stateFile = path.resolve(required(options.state, "--state"));
    const { videoAdapter } = await cookieRuntime(options);
    const result = await reconcileFilmVideo({ stateFile, sceneId: required(options.scene, "--scene"), timeoutMs: Number(options.timeout ?? 120_000), operations: { videoAdapter }, resourceBroker: createCliResourceBroker() });
    console.log(JSON.stringify({ reconciliation: result.reconciliation, film: await statusFilm({ stateFile }) }, null, 2));
  }
}
