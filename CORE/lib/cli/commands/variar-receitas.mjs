export async function executar(contexto) {
  const {
    mkdir,
    readFile,
    writeFile,
    path,
    CliError,
    ERROR_CODES,
    gerarReceitasCompletas,
    gerarReceitasDiversificadas,
    coreRoot,
    parse,
    lerPreferenciasFavoritas,
    carregarBancoMotion,
    anexarOrientacaoMotion,
    options,
  } = contexto;
  {
    // Proposta de receitas@1 diversificadas (Fase 3). Somente leitura: gera os
    // candidatos combinando prompt-bank + estilos + técnicas; a geração é humana.
    const bank = path.resolve(String(options.bank ?? path.join(coreRoot, "outputs", "prompt-bank", "prompt-bank.json")));
    const promptBank = JSON.parse(await readFile(bank, "utf8"));
    const seed = String(options.seed ?? "estudio");
    const categorias = options.categorias ? String(options.categorias).split(",").map((s) => s.trim()).filter(Boolean) : null;
    const estilos = options.estilos ? String(options.estilos).split(",").map((s) => s.trim()).filter(Boolean) : null;
    const tecnicas = options.tecnicas ? String(options.tecnicas).split(",").map((s) => s.trim()).filter(Boolean) : null;

    // Estilos curtidos (like) entram como prioridade de sugestão, não ranker:
    // o gerador usa os favoritos primeiro e o restante do catálogo depois.
    const preferencias = await lerPreferenciasFavoritas(options["favoritos-db"]);

    const filme = options.filme === true || String(options.filme ?? "").toLowerCase() === "true";
    const motionBank = await carregarBancoMotion(options["motion-bank"], options["motion-validation"]);
    const propostas = filme
      ? gerarReceitasCompletas({
          promptBank,
          seed,
          count: Number(options.count ?? 3),
          parallel: Number(options.parallel ?? 3),
          duracaoPorCena: Number(options["duracao-cena"] ?? 10),
          categorias,
          estilos,
          tecnicas,
          favoritos: preferencias?.estilos ?? null,
          presetTrilha: options["preset-trilha"] ? String(options["preset-trilha"]) : "institucional",
        })
      : gerarReceitasDiversificadas({
          promptBank,
          seed,
          count: Number(options.count ?? 3),
          parallel: Number(options.parallel ?? 3),
          partesPorReceita: Number(options.partes ?? 5),
          categorias,
          estilos,
          tecnicas,
          favoritos: preferencias?.estilos ?? null,
        });
    const geradas = anexarOrientacaoMotion(propostas, motionBank, seed, filme, preferencias);
    const out = options.out ? path.resolve(String(options.out)) : null;
    if (out) {
      await mkdir(path.dirname(out), { recursive: true }).catch(() => {});
      await writeFile(out, `${JSON.stringify(geradas, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch((error) => {
        if (error?.code === "EEXIST") throw new CliError(`Arquivo de saída já existe: ${out}`, { code: ERROR_CODES.POLICY_DENIED });
        throw error;
      });
    }
    const lista = filme ? geradas.receitas : geradas.propostas;
    if ((options.format ?? "texto") === "json") {
      console.log(JSON.stringify(geradas, null, 2));
    } else {
      console.log(`${lista.length} proposta(s) de receita ${filme ? "(filme completo)" : ""} (seed ${geradas.seed}):`);
      for (const proposta of lista) {
        const extra = filme ? ` · ${proposta.scenes.length} cenas de ${proposta.scenes[0]?.duration ?? "?"}s · trilha ${proposta.audio?.musicPreset ?? "-"}` : ` · ${proposta.aspect}`;
        console.log(`  ${proposta.id.padEnd(44)} ${proposta.label}${extra}`);
      }
      if (geradas.motionGuidance) {
        console.log("\nOrientação motion candidata (planejamento local; não altera prompt):");
        for (const item of geradas.motionGuidance.assignments) {
          console.log(`  ${item.recipeId.padEnd(44)} ${item.combinationId} · principal ${item.primary.id}`);
        }
        console.log(`  banco sha256 ${geradas.motionGuidance.source.sha256}`);
      }
      if (out) console.log(`\nSalvo em ${out}`);
    }
  }
}
