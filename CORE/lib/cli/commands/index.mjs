export async function executar(contexto) {
  const {
    path,
    buildArchiveIndex,
    initializeArchiveLifecycle,
    summarizeArchiveLifecycle,
    coreRoot,
    explicitBoolean,
    options,
  } = contexto;
  {
    const root = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
    const dbFile = path.resolve(String(options.db ?? path.join(root, "archive.sqlite")));
    const indexed = await buildArchiveIndex({ root, dbFile });
    const lifecycle = explicitBoolean(options["initialize-lifecycle"], "--initialize-lifecycle", false)
      ? initializeArchiveLifecycle({ dbFile })
      : null;
    console.log(JSON.stringify({ ...indexed, lifecycle, summary: summarizeArchiveLifecycle({ dbFile }) }, null, 2));
  }
}
