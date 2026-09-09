export async function executar(contexto) {
  const {
    path,
    coreRoot,
    options,
  } = contexto;
  {
    // Resumo dos likes de vídeos e receitas como evidência para sugestões.
    // Somente leitura: não promove nada; a promoção de preferência é humana.
    const dbFile = path.resolve(String(options.db ?? path.join(coreRoot, ".cache", "archive-index.sqlite")));
    const root = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
    const { listArchiveFavorites, listRecipePreferences } = await import("../../media-pipeline/archive-index.mjs");
    const { DatabaseSync } = await import("node:sqlite");
    const favs = listArchiveFavorites({ dbFile, root });
    const recipePreferences = listRecipePreferences({ dbFile, likedOnly: true });
    const porEstilo = new Map();
    const porColecao = new Map();
    let db = null;
    try {
      db = new DatabaseSync(dbFile, { readOnly: true });
      for (const fav of favs) {
        const row = db.prepare("SELECT style, collection FROM receipts WHERE path=?").get(fav.receiptPath);
        const estilo = row?.style ?? null;
        const colecao = row?.collection ?? null;
        porEstilo.set(estilo ?? "sem-estilo", (porEstilo.get(estilo ?? "sem-estilo") ?? 0) + 1);
        porColecao.set(colecao ?? "sem-colecao", (porColecao.get(colecao ?? "sem-colecao") ?? 0) + 1);
      }
    } finally {
      db?.close();
    }
    const recipeCombinationCounts = new Map();
    for (const item of recipePreferences) {
      if (item.motionCombinationId) recipeCombinationCounts.set(item.motionCombinationId, (recipeCombinationCounts.get(item.motionCombinationId) ?? 0) + 1);
    }
    const resumo = {
      schema: "mkt-videos/favorite-summary@1",
      db: dbFile,
      total: favs.length,
      porEstilo: [...porEstilo.entries()].sort((a, b) => b[1] - a[1]).map(([estilo, contagem]) => ({ estilo, contagem })),
      porColecao: [...porColecao.entries()].sort((a, b) => b[1] - a[1]).map(([colecao, contagem]) => ({ colecao, contagem })),
      favoritos: favs.slice(0, 20).map((f) => ({ relPath: f.relPath, likedAt: f.updatedAt })),
      receitas: {
        total: recipePreferences.length,
        combinacoesMotion: [...recipeCombinationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id, contagem]) => ({ id, contagem })),
        favoritas: recipePreferences.slice(0, 20).map((item) => ({ recipeId: item.recipeId, combinationId: item.motionCombinationId, likedAt: item.updatedAt })),
      },
    };
    if ((options.format ?? "texto") === "json") {
      console.log(JSON.stringify(resumo, null, 2));
    } else {
      console.log(`${resumo.total} vídeo(s) favorito(s):`);
      if (resumo.porEstilo.length) {
        console.log("\npor estilo:");
        for (const item of resumo.porEstilo) console.log(`  ${item.estilo.padEnd(28)} ${item.contagem}`);
      }
      if (resumo.porColecao.length) {
        console.log("\npor coleção:");
        for (const item of resumo.porColecao.slice(0, 10)) console.log(`  ${item.colecao.padEnd(40)} ${item.contagem}`);
      }
      console.log(`\n${resumo.receitas.total} receita(s) favorita(s):`);
      for (const item of resumo.receitas.combinacoesMotion) console.log(`  ${item.id.padEnd(40)} ${item.contagem}`);
    }
  }
}
