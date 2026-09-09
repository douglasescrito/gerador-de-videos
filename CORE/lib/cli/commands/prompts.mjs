export async function executar(contexto) {
  const {
    path,
    buildPromptIndex,
    groupByPrompt,
    loadIndexCache,
    queryPromptIndex,
    saveIndexCache,
    listStyleSpecs,
    coreRoot,
    required,
    lerAcervoParaMineracao,
    options,
  } = contexto;
  {
    // Fase 9 (E2/E3/E4): mineração em sombra do acervo. Vive aqui, e não num
    // comando novo, porque o assunto é o mesmo — o que foi pedido e o que o
    // Studio fez com o pedido. O relatório não tem autoridade nenhuma.
    if (options.insight != null || options.minerar != null) {
      const {
        construirArchiveInsight,
        assertArchiveInsight,
        extrairCandidatoDeAchado,
      } = await import("../../media-pipeline/request-mining.mjs");
      const linhas = await lerAcervoParaMineracao(options.catalog);
      const presets = listStyleSpecs({ includeConcepts: false, includeDeprecated: false }).map((entrada) => entrada.id);
      const insight = construirArchiveInsight({
        rootScopeId: required(options["root-scope-id"], "--root-scope-id"),
        linhas,
        registries: {
          presets,
          tarefas: ["text-to-video", "image-to-video", "reference-to-video", "edit"],
          formatos: ["16:9", "9:16"],
        },
      });
      assertArchiveInsight(insight);
      if (options.preset) {
        console.log(JSON.stringify(extrairCandidatoDeAchado({ insight, preset: String(options.preset) }), null, 2));
        return;
      }
      if (options.format === "json") {
        console.log(JSON.stringify(insight, null, 2));
        return;
      }
      console.log(`acervo ${insight.universo.linhas} · com pedido ${insight.universo.comPedido} · com tradução ${insight.universo.comTraducao} · julgados ${insight.universo.julgados}`);
      console.log("\nTradução aplicada por preset (somente com amostra suficiente):");
      for (const entrada of insight.deltas.presets.filter((item) => item.evidenciaSuficiente)) {
        console.log(`  ${entrada.preset.padEnd(24)} n=${String(entrada.n).padStart(5)}  ${entrada.formato}`);
        console.log(`    acrescenta: ${entrada.termosAcrescentados.slice(0, 8).map((item) => item.termo).join(" ") || "(nada estável)"}`);
      }
      console.log(`\nCobertura do espaço criativo: ${insight.lacunas.espacoExercitado}/${insight.lacunas.espacoDeclarado} (${Math.round(insight.lacunas.fracaoExercitada * 100)}%)`);
      console.log(`Nunca tentadas: ${insight.lacunas.naoTentadas.length}`);
      for (const combinacao of insight.lacunas.naoTentadas.slice(0, 8)) console.log(`  · ${combinacao}`);
      console.log(`\nVeredito humano: ${insight.veredito.julgados} julgados · ${insight.veredito.conclusivo ? "há combinação com evidência" : "inconclusivo (nenhuma combinação atingiu a amostra mínima)"}`);
      console.log(`\nfingerprint ${insight.fingerprint}`);
      console.log("Este relatório não altera preset, receita nem planner. Promover exige decisão humana registrada.");
      return;
    }
    const root = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
    const cacheFile = path.join(coreRoot, ".cache", "prompt-index.json");
    const index = buildPromptIndex(root, { cache: loadIndexCache(cacheFile) });
    saveIndexCache(cacheFile, index);

    // Fase 9/E0, passo retroativo: metade do acervo não tem prompt gravado
    // porque é anterior ao sistema de recibos. O que as receitas históricas
    // permitirem recuperar é recuperado; o resto fica marcado como
    // irrecuperável, nunca inferido.
    if (options.backfill != null) {
      const { inspectPromptBackfill } = await import("../../media-pipeline/archive-prompt-backfill.mjs");
      const relatorio = inspectPromptBackfill({ outputsRoot: root, promptIndex: index });
      if (options.format === "json") {
        console.log(JSON.stringify(relatorio, null, 2));
        return;
      }
      const semPrompt = index.stats.withoutReceipt ?? 0;
      console.log(`acervo ${index.stats.videos} vídeos · sem prompt gravado ${semPrompt}`);
      console.log(`fontes varridas ${relatorio.sourceFiles} · ilegíveis ${relatorio.unreadableSources}`);
      console.log(`recuperáveis ${relatorio.candidateCount} · ambíguos ${relatorio.ambiguousCount} (mais de uma origem possível, nunca escolhidos por adivinhação)`);
      const irrecuperaveis = Math.max(0, semPrompt - relatorio.candidateCount - relatorio.ambiguousCount);
      console.log(`irrecuperáveis ${irrecuperaveis}`);
      for (const candidato of relatorio.candidates.slice(0, 5)) console.log(`  · ${candidato.relPath}`);
      console.log("\nEste comando é somente leitura. Aplicar exige decisão explícita.");
      return;
    }

    // --video pergunta direto: que prompt gerou este arquivo?
    if (options.video) {
      const rel = String(options.video).replace(/\\/g, "/").replace(/^.*?outputs\//, "");
      const entry = index.entries[rel];
      if (!entry) {
        throw new Error(
          `Sem recibo de geração para "${rel}". ${index.stats.withoutReceipt} dos ${index.stats.videos} vídeos do acervo são anteriores ao sistema de recibos e não têm prompt gravado.`,
        );
      }
      console.log(JSON.stringify({ relPath: rel, ...entry }, null, 2));
      return;
    }

    const rows = queryPromptIndex(index, {
      text: options.text ?? null,
      provider: options.provider ?? null,
      model: options.model ?? null,
      task: options.task ?? null,
      aspect: options.aspect ?? null,
      mode: options.mode ?? null,
      collection: options.collection ?? null,
      from: options.from ?? null,
      to: options.to ?? null,
      limit: options.limit ? Number(options.limit) : null,
    });

    if (options.group) {
      const groups = groupByPrompt(rows);
      if (options.format === "json") {
        console.log(JSON.stringify({ stats: index.stats, groups }, null, 2));
        return;
      }
      for (const group of groups) {
        console.log(`${String(group.count).padStart(4)}x  ${group.prompt.replace(/\s+/g, " ").slice(0, 110)}`);
      }
      console.log(`\n${groups.length} prompts distintos em ${rows.length} vídeos.`);
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify({ stats: index.stats, count: rows.length, results: rows }, null, 2));
      return;
    }

    for (const row of rows) {
      const head = [row.model, row.task, row.aspectRatio, row.mode].filter(Boolean).join(" · ");
      console.log(`\n${row.relPath}`);
      console.log(`  ${head}${row.completedAt ? `  ·  ${row.completedAt.slice(0, 16).replace("T", " ")}` : ""}`);
      const prompt = options.full ? row.prompt : row.prompt.replace(/\s+/g, " ").slice(0, 160);
      console.log(`  ${prompt}${!options.full && row.prompt.length > 160 ? "…" : ""}`);
    }
    console.log(
      `\n${rows.length} resultado(s). Índice: ${index.stats.indexed} vídeos com prompt de ${index.stats.videos} (${index.stats.promptCoverage}%).`,
    );
  }
}
