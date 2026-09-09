export async function executar(contexto) {
  const {
    readFile,
    path,
    compilarProductionSpec,
    resumirEtapasDoPlano,
    parse,
    required,
    options,
  } = contexto;
  {
    // Documento Mestre (production-spec@1): valida, compila para film-spec@2 e
    // mostra o execution-plan (etapas de ponta a ponta). Somente leitura.
    const specFile = path.resolve(required(options.spec, "--spec"));
    const bruta = JSON.parse(await readFile(specFile, "utf8"));
    const { production, filmSpec, plan } = compilarProductionSpec(bruta);
    if ((options.format ?? "texto") === "json") {
      console.log(JSON.stringify({
        schema: "mkt-videos/production-compiled@1",
        production: { name: production.name, aspect: production.aspect, blocos: production.narration.blocks.length, cenas: production.scenes.length, sync: production.sync.scenesFollowSpeech ? "whisper dirige as cenas" : "cenas fixas", trilha: production.music?.preset ?? "sem trilha" },
        filmSpecSchema: filmSpec.schema,
        etapas: resumirEtapasDoPlano(plan),
        planoFingerprint: plan.fingerprint,
      }, null, 2));
    } else {
      console.log(`Documento mestre: ${production.name} (${production.aspect})`);
      console.log(`  narração  ${production.narration.blocks.length} bloco(s) · ${production.narration.provider}`);
      console.log(`  sincronismo  ${production.sync.scenesFollowSpeech ? "Whisper dirige as cenas" : "cenas fixas (10s)"} · modelo ${production.sync.whisperModel}`);
      console.log(`  cenas     ${production.scenes.length} · trilha ${production.music ? (production.music.preset ?? "sob medida (prompt)") : "sem trilha"}`);
      console.log(`  film-spec  ${filmSpec.schema}`);
      console.log(`\nEtapas de ponta a ponta (execution-plan):`);
      for (const etapa of resumirEtapasDoPlano(plan)) {
        const deps = etapa.dependencies.length ? ` ← ${etapa.dependencies.join(", ")}` : "";
        console.log(`  ${etapa.id.padEnd(24)} [${etapa.lane ?? "-"}]${deps}`);
      }
      console.log(`\n  fingerprint: ${plan.fingerprint}`);
    }
  }
}
