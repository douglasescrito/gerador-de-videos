export async function executar(contexto) {
  const {
    path,
    loadFilmSpec,
    command,
    required,
    planStudioFilm,
    options,
  } = contexto;
  {
    const specFile = path.resolve(required(options.spec, "--spec"));
    const spec = await loadFilmSpec(specFile, options);
    const result = await planStudioFilm({ spec, specFile, options, dryRun: command === "dry-run" });
    console.log(JSON.stringify({ dryRun: result.dryRun, plan: result.plan, stateFile: result.state.stateFile }, null, 2));
  }
}
