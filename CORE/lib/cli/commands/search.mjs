export async function executar(contexto) {
  const {
    path,
    searchArchive,
    required,
    options,
  } = contexto;
  {
    console.log(JSON.stringify(searchArchive({
      dbFile: path.resolve(required(options.db, "--db")),
      query: options.query ?? "",
      task: options.task ?? null,
      style: options.style ?? null,
      collection: options.collection ?? null,
      reviewStatus: options["review-status"] ?? null,
      recipeHash: options["recipe-hash"] ?? null,
      tag: options.tags?.[0] ?? null,
      limit: Number(options.limit ?? 20),
    }), null, 2));
  }
}
