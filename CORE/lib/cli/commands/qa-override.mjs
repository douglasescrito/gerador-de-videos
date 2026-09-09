export async function executar(contexto) {
  const {
    path,
    overrideFilmQa,
    statusFilm,
    required,
    options,
  } = contexto;
  {
    const stateFile = path.resolve(required(options.state, "--state"));
    const result = await overrideFilmQa({ stateFile, author: required(options.author, "--author"), justification: required(options.justification, "--justification") });
    console.log(JSON.stringify({ override: result.override, film: await statusFilm({ stateFile }) }, null, 2));
  }
}
