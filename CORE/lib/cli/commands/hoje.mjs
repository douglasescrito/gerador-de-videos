export async function executar(contexto) {
  const {
    path,
    CliError,
    ERROR_CODES,
    buildDailySummary,
    renderDailySummary,
    listFilmJobs,
    coreRoot,
    runtimeDbFile,
    options,
  } = contexto;
  {
    // Junta o que já está no disco: a colheita diz o que rodou, os journals
    // dizem o que trancou, o runtime diz o que está em voo agora. Nenhuma
    // medição nova, nenhuma chamada de provider.
    const raiz = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
    const runtimeDb = path.resolve(String(options["runtime-db"] ?? runtimeDbFile));
    const horasPedidas = Number(options.desde ?? 24);
    if (!Number.isFinite(horasPedidas) || horasPedidas <= 0) throw new CliError("--desde deve ser um número de horas maior que zero.", { code: ERROR_CODES.USAGE });
    const resumo = await buildDailySummary({
      outputsRoot: raiz,
      runtimeDb,
      desdeMs: horasPedidas * 3_600_000,
      relatorioDeJobs: await listFilmJobs({ root: raiz, runtimeDb }),
    });
    const formato = String(options.format ?? "texto").toLowerCase();
    if (!["texto", "json"].includes(formato)) throw new CliError("--format deve ser texto ou json.", { code: ERROR_CODES.USAGE });
    console.log(formato === "json" ? JSON.stringify(resumo, null, 2) : renderDailySummary(resumo));
  }
}
