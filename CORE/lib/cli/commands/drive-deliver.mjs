export async function executar(contexto) {
  const {
    path,
    CliError,
    ERROR_CODES,
    deliverCollectionToDrive,
    coreRoot,
    required,
    explicitBoolean,
    options,
  } = contexto;
  {
    const dryRun = explicitBoolean(options["dry-run"], "--dry-run", true);
    const confirmDriveWrite = explicitBoolean(options["confirm-drive-write"], "--confirm-drive-write", false);
    const includeOriginals = explicitBoolean(options["include-originals"], "--include-originals", false);
    const cleanupLocalMedia = explicitBoolean(options["cleanup-local-media"], "--cleanup-local-media", false);
    const confirmLocalMediaDelete = explicitBoolean(options["confirm-local-media-delete"], "--confirm-local-media-delete", false);
    if (!dryRun && !confirmDriveWrite) {
      throw new CliError(
        "A publicação no Drive exige --confirm-drive-write true.",
        {
          code: ERROR_CODES.CONFIRMATION_REQUIRED,
          hint: "Revise primeiro com --dry-run true; depois repita com --dry-run false --confirm-drive-write true.",
        },
      );
    }
    if (cleanupLocalMedia && (!confirmLocalMediaDelete || dryRun)) {
      throw new CliError(
        "A limpeza local exige publicação efetiva e --confirm-local-media-delete true.",
        {
          code: ERROR_CODES.CONFIRMATION_REQUIRED,
          hint: "Use --dry-run false --confirm-drive-write true --cleanup-local-media true --confirm-local-media-delete true.",
        },
      );
    }
    const result = await deliverCollectionToDrive({
      coreRoot,
      collection: required(options.collection, "--collection"),
      rootFolderId: required(options["root-folder-id"], "--root-folder-id"),
      client: required(options.client, '--client'),
      pieceName: options.name ?? null,
      date: options.date ?? null,
      receiptFile: options.receipt ? path.resolve(String(options.receipt)) : null,
      gcpCli: options["gcp-cli"] ? path.resolve(String(options["gcp-cli"])) : undefined,
      dryRun,
      confirmDriveWrite,
      includeOriginals,
      cleanupLocalMedia,
      confirmLocalMediaDelete,
    });
    console.log(JSON.stringify(result, null, 2));
  }
}
