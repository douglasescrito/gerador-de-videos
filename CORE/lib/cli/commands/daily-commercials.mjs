export async function executar(contexto) {
  const {
    path,
    CliError,
    ERROR_CODES,
    archiveDailyCommercialWave,
    assembleDailyCommercialWave,
    readDailyCommercialStatus,
    prepareDailyCommercialWave,
    markDailyCommercialAttention,
    coreRoot,
    required,
    explicitBoolean,
    options,
  } = contexto;
  {
    const action = String(options.action ?? "status").trim().toLowerCase();
    const missionDir = path.resolve(required(options.mission, "--mission"));
    const dryRun = explicitBoolean(options["dry-run"], "--dry-run", action === "plan");
    const requestedDate = options.date == null ? null : String(options.date);
    const now = requestedDate == null ? new Date() : new Date(`${requestedDate}T12:00:00-03:00`);
    if (Number.isNaN(now.getTime())) throw new CliError("--date inválida; use AAAA-MM-DD.");
    let result;
    if (action === "status") {
      result = await readDailyCommercialStatus({ missionDir, now });
    } else if (action === "plan" || action === "prepare") {
      result = await prepareDailyCommercialWave({
        missionDir,
        waveNumber: Number(required(options.wave, "--wave")),
        now,
        dryRun: action === "plan" ? true : dryRun,
      });
    } else if (action === "assemble") {
      result = await assembleDailyCommercialWave({
        missionDir,
        waveId: required(options["wave-id"], "--wave-id"),
      });
    } else if (action === "archive") {
      const confirmDriveWrite = explicitBoolean(options["confirm-drive-write"], "--confirm-drive-write", false);
      const confirmLocalMediaDelete = explicitBoolean(options["confirm-local-media-delete"], "--confirm-local-media-delete", false);
      if (!dryRun && (!confirmDriveWrite || !confirmLocalMediaDelete)) {
        throw new CliError(
          "O arquivo definitivo exige --confirm-drive-write true e --confirm-local-media-delete true.",
          { code: ERROR_CODES.CONFIRMATION_REQUIRED },
        );
      }
      result = await archiveDailyCommercialWave({
        missionDir,
        waveId: required(options["wave-id"], "--wave-id"),
        coreRoot,
        dryRun,
        confirmDriveWrite,
        confirmLocalMediaDelete,
      });
    } else if (action === "attention") {
      result = await markDailyCommercialAttention({
        missionDir,
        waveId: required(options["wave-id"], "--wave-id"),
        reason: required(options.reason, "--reason"),
      });
    } else {
      throw new CliError("--action deve ser status, plan, prepare, assemble, archive ou attention.");
    }
    console.log(JSON.stringify(result, null, 2));
  }
}
