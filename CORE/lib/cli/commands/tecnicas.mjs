export async function executar(contexto) {
  const {
    path,
    coreRoot,
    explicitBoolean,
    options,
  } = contexto;
  {
    const { listProductionTechniques } = await import("../../media-pipeline/prompt-techniques.mjs");
    const catalog = listProductionTechniques().filter((entry) => !options.status || entry.status === String(options.status).trim().toLowerCase());
    if (explicitBoolean(options["catalog-only"], "--catalog-only", false)) {
      console.log(JSON.stringify({ schema: "mkt-videos/production-technique-catalog@1", entries: catalog, providerCalls: 0 }, null, 2));
      return;
    }
    // O catálogo trazia a contagem de recibos anotada à mão; aqui ela é medida.
    const { medirEvidenciaDeTecnicas } = await import("../../media-pipeline/technique-evidence.mjs");
    const raiz = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
    const relatorio = { ...medirEvidenciaDeTecnicas({ raiz }), catalog };
    const filtrado = options.status
      ? { ...relatorio, tecnicas: relatorio.tecnicas.filter((t) => t.status === String(options.status).trim().toLowerCase()) }
      : relatorio;
    if (options.format === "json") { console.log(JSON.stringify(filtrado, null, 2)); return; }
    console.log(`${filtrado.recibosLidos} recibos lidos · ${filtrado.resumo.usosEstruturados} seleções explícitas · ${filtrado.resumo.usosTextuais} blocos copiados no prompt`);
    for (const t of filtrado.tecnicas) {
      const quando = t.ultimoUso ? t.ultimoUso.slice(0, 10) : "nunca";
      console.log(`  ${t.id.padEnd(28)}${String(t.status).padEnd(9)}selecionada ${String(t.estruturado).padStart(3)}  ·  copiada ${String(t.textual).padStart(3)}  ·  último uso ${quando}`);
    }
    return;
  }
}
