export async function executar(contexto) {
  const {
    readFile,
    path,
    compilarReceita,
    parse,
    required,
    options,
  } = contexto;
  {
    // Mesmo compilador que a tela usa. Somente leitura: mostra o que sairia,
    // sem escrever estado nem chamar provedor.
    const arquivo = path.resolve(required(options.file, "--file"));
    const receita = JSON.parse(await readFile(arquivo, "utf8"));
    const compilado = compilarReceita(receita, { sufixoColecao: options.suffix ?? "" });
    const resumo = {
      schema: "gerador-de-videos/receita-compilada@1",
      receita: { id: compilado.receita.id, label: compilado.receita.label, kind: compilado.receita.kind },
      motor: compilado.motor,
      colecao: compilado.colecao,
      saidas: compilado.saidas,
      aspect: compilado.receita.aspect,
      style: compilado.receita.style,
      ...(compilado.motor === "filme" ? { filmSpec: compilado.filmSpec } : { lote: compilado.lote }),
    };
    if ((options.format ?? "json") === "json") {
      console.log(JSON.stringify(resumo, null, 2));
    } else {
      console.log(`${compilado.receita.label} (${compilado.receita.kind})`);
      console.log(`  motor    ${compilado.motor}`);
      console.log(`  coleção  ${compilado.colecao}`);
      console.log(`  produz   ${compilado.saidas} vídeo(s) em ${compilado.receita.aspect}`);
      console.log(`  estilo   ${compilado.receita.style ?? "sem estilo (prompt literal)"}`);
    }
  }
}
