export async function executar(contexto) {
  const {
    mkdir,
    readFile,
    path,
    CliError,
    ERROR_CODES,
    discoverRecipeFiles,
    coreRoot,
    parse,
    required,
    explicitBoolean,
    options,
  } = contexto;
  {
    const dir = path.resolve(String(options.dir ?? path.join(coreRoot, "recipes")));
    const action = String(options.action ?? "list").trim().toLowerCase();
    if (action === "direcoes") {
      if (Object.keys(options).some(key => !["action", "id", "format"].includes(key))) throw new Error("receitas --action direcoes aceita somente --id e --format texto|json|prompt.");
      const format = options.format ?? "texto";
      if (!["texto", "json", "prompt"].includes(format)) throw new Error("Formato de direcoes exige texto, json ou prompt.");
      if (format === "prompt" && !options.id) throw new Error("--format prompt exige --id da direção.");
      const { readMotionDirections } = await import("../../media-pipeline/motion-direction-library.mjs");
      const result = await readMotionDirections({ coreRoot, id: options.id ?? null });
      if (format === "json") console.log(JSON.stringify(result, null, 2));
      else if (format === "prompt") console.log(result.prompt);
      else if (result.selected) console.log([
        `${result.selected.id} — ${result.selected.title}`,
        result.selected.idea,
        `Mecanismo: ${result.selected.mechanism}`,
        `Assets locais: verificados. Receita de autoria: pronta. Preset executável: ainda não implementado.`,
        `Prompt para o Astra: receitas --action direcoes --id ${result.selected.id} --format prompt`,
        `Arquivo: ${result.files.prompt}`,
      ].join("\n"));
      else console.log([
        `${result.count} direções para Astra + HyperFrames (Studio; autoria pronta, presets ainda não implementados).`,
        ...result.recipes.map(item => `${item.id.padEnd(30)} ${item.title} — ${item.idea}`),
        "Selecionar: receitas --action direcoes --id 08-fita-de-ideias --format prompt",
      ].join("\n"));
      return;
    }
    if (options.id != null) throw new Error("--id pertence a receitas --action direcoes.");
    if (action === "suggested" || action === "favorite") {
      const preferencesDb = path.resolve(String(options["preferences-db"] ?? path.join(coreRoot, ".cache", "archive-index.sqlite")));
      const { readRecipeSuggestionShelf } = await import("../../media-pipeline/recipe-suggestion-shelf.mjs");
      const { listRecipePreferences, setRecipePreference } = await import("../../media-pipeline/archive-index.mjs");
      const shelf = await readRecipeSuggestionShelf({ recipesDir: dir });
      if (action === "favorite") {
        if (explicitBoolean(options["confirm-human"], "--confirm-human", false) !== true) {
          throw new CliError("O like de receita exige --confirm-human true.", { code: ERROR_CODES.POLICY_DENIED });
        }
        const preferenceKey = required(options["preference-key"], "--preference-key").trim().toLowerCase();
        const suggestion = shelf.suggestions.find((item) => item.preferenceKey === preferenceKey);
        if (!suggestion) throw new CliError("Receita sugerida não encontrada ou identidade divergente.", { code: ERROR_CODES.INTEGRITY_FAILURE });
        await mkdir(path.dirname(preferencesDb), { recursive: true });
        const preference = setRecipePreference({
          dbFile: preferencesDb,
          preferenceKey: suggestion.preferenceKey,
          recipeId: suggestion.recipeId,
          recipeHash: suggestion.recipeHash,
          style: suggestion.style,
          motionCombinationId: suggestion.motionCombinationId,
          motionInstructionIds: suggestion.motionInstructionIds,
          sourceFile: suggestion.sourceFiles[0] ?? null,
          liked: explicitBoolean(options.liked, "--liked", true),
        });
        console.log(JSON.stringify({
          schema: "mkt-videos/recipe-preference-result@1",
          preference,
          providerCalls: 0,
          generationTriggered: false,
          automaticPromotion: false,
        }, null, 2));
        return;
      }
      const preferences = listRecipePreferences({ dbFile: preferencesDb });
      const preferenceByKey = new Map(preferences.map((item) => [item.preferenceKey, item]));
      const suggestions = shelf.suggestions.map((suggestion) => {
        const preference = preferenceByKey.get(suggestion.preferenceKey);
        return { ...suggestion, liked: preference?.liked === true, likedAt: preference?.updatedAt ?? null };
      });
      const byCombination = new Map();
      for (const item of suggestions.filter((candidate) => candidate.liked)) {
        if (item.motionCombinationId) byCombination.set(item.motionCombinationId, (byCombination.get(item.motionCombinationId) ?? 0) + 1);
      }
      console.log(JSON.stringify({
        ...shelf,
        suggestions,
        learning: {
          authority: "none",
          likedRecipes: suggestions.filter((item) => item.liked).length,
          preferredMotionCombinations: [...byCombination.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([id, count]) => ({ id, count })),
          automaticPromotion: false,
          generationTriggered: false,
        },
      }, null, 2));
      return;
    }
    if (action === "validar") {
      // Portão da pasta: toda receita valida contra o validador do formato que
      // ela mesma declara. Somente leitura, sem provedor, sem cota.
      const { validarPastaDeReceitas } = await import("../../media-pipeline/recipe-validation.mjs");
      const relatorio = validarPastaDeReceitas({ raiz: dir });
      console.log(JSON.stringify(relatorio, null, 2));
      if (!relatorio.ok) {
        throw new CliError(
          `${relatorio.invalidas.length} de ${relatorio.total} receitas não validam.`,
          { code: ERROR_CODES.INTEGRITY_FAILURE },
        );
      }
      return;
    }
    if (action !== "list") throw new CliError(`Ação de receitas desconhecida: ${action}`, { code: ERROR_CODES.INTEGRITY_FAILURE });
    const { descreverReceita } = await import("../../media-pipeline/recipe-validation.mjs");
    const arquivos = await discoverRecipeFiles(dir);
    const prateleira = [];
    for (const arquivo of arquivos) {
      try {
        const description = descreverReceita(await readFile(arquivo.absoluteFile));
        prateleira.push({
          arquivo: arquivo.relativeFile,
          schema: description.schema,
          id: description.id,
          label: description.label,
          kind: description.kind,
          motor: description.motor,
          aspect: description.aspect,
          saidas: description.outputCount,
          colecao: description.collection,
          targetDurationSeconds: description.targetDurationSeconds,
          ...(description.productionCount == null ? {} : { productionCount: description.productionCount }),
          valid: description.valid,
          preflight: description.preflight,
        });
      } catch (error) {
        // Uma receita inválida não pode esconder as outras da prateleira.
        prateleira.push({ arquivo: arquivo.relativeFile, erro: error.message });
      }
    }
    if ((options.format ?? "texto") === "json") {
      console.log(JSON.stringify({ schema: "gerador-de-videos/prateleira@1", dir, receitas: prateleira }, null, 2));
    } else if (!prateleira.length) {
      console.log(`Nenhuma receita em ${dir}.`);
    } else {
      for (const entrada of prateleira) {
        if (entrada.erro) console.log(`  ${entrada.arquivo.padEnd(34)} INVÁLIDA: ${entrada.erro}`);
        else {
          const readiness = entrada.preflight.status === "blocked" ? ` · bloqueada: ${entrada.preflight.blockers.map((item) => item.code).join(", ")}` : "";
          console.log(`  ${entrada.id.padEnd(24)} ${entrada.kind.padEnd(6)} ${String(entrada.saidas).padStart(2)} vídeo(s)  ${entrada.aspect ?? "-"}  ${entrada.label}${readiness}`);
        }
      }
    }
  }
}
