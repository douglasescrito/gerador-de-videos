export async function executar(contexto) {
  const {
    mkdir,
    readFile,
    writeFile,
    path,
    CliError,
    ERROR_CODES,
    gerarPlanoDiversidade,
    coreRoot,
    parse,
    lerPreferenciasFavoritas,
    carregarBancoMotion,
    anexarOrientacaoMotion,
    options,
  } = contexto;
  {
    // Plano de ondas determinístico (Fase 4): propostas diversificadas ao longo
    // de N dias, priorizando estilos curtidos. Somente leitura; cada onda é
    // decisão humana antes de gerar (nunca corre sozinho).
    const bank = path.resolve(String(options.bank ?? path.join(coreRoot, "outputs", "prompt-bank", "prompt-bank.json")));
    const promptBank = JSON.parse(await readFile(bank, "utf8"));
    const seed = String(options.seed ?? "estudio");
    const preferencias = await lerPreferenciasFavoritas(options["favoritos-db"]);
    const motionBank = await carregarBancoMotion(options["motion-bank"], options["motion-validation"]);
    const propostas = gerarPlanoDiversidade({
      promptBank,
      seed,
      dias: Number(options.dias ?? 5),
      porDia: Number(options["por-dia"] ?? 2),
      favoritos: preferencias?.estilos ?? null,
    });
    const plano = anexarOrientacaoMotion(propostas, motionBank, seed, false, preferencias);
    const out = options.out ? path.resolve(String(options.out)) : null;
    if (out) {
      await mkdir(path.dirname(out), { recursive: true }).catch(() => {});
      await writeFile(out, `${JSON.stringify(plano, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch((error) => {
        if (error?.code === "EEXIST") throw new CliError(`Arquivo de saída já existe: ${out}`, { code: ERROR_CODES.POLICY_DENIED });
        throw error;
      });
    }
    if ((options.format ?? "texto") === "json") {
      console.log(JSON.stringify(plano, null, 2));
    } else {
      console.log(`Plano de ${plano.dias} dia(s) × ${plano.porDia} proposta(s) = ${plano.total} (seed ${plano.seed}):`);
      for (const dia of plano.diasPlano) {
        console.log(`  dia ${String(dia.dia).padStart(2, "0")}: ${dia.propostas.join(", ")}`);
      }
      if (plano.motionGuidance) console.log(`  orientação motion candidata: ${plano.motionGuidance.assignments.length} vínculo(s), banco ${plano.motionGuidance.source.sha256}`);
      if (out) console.log(`\nSalvo em ${out}`);
    }
  }
}
