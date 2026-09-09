export async function executar(contexto) {
  const {
    path,
    harvestOutputsRoot,
    writeHarvestedRecipe,
    coreRoot,
    options,
  } = contexto;
  {
    // O caminho de volta do acervo. Uma peça pronta guarda tudo que a fez;
    // faltava juntar isso num arquivo que dá para ler, variar e repetir.
    if (options.colecao) {
      const raiz = path.resolve(String(options.colecao));
      const colhido = await writeHarvestedRecipe({ root: raiz, name: path.basename(raiz) });
      console.log(JSON.stringify(colhido
        ? { colecao: path.basename(raiz), file: colhido.file, resumo: colhido.recipe.resumo }
        : { colecao: path.basename(raiz), colhida: false, motivo: "nenhum recibo encontrado" }, null, 2));
    } else {
      const raiz = path.resolve(String(options.root ?? path.join(coreRoot, "outputs")));
      const resultado = await harvestOutputsRoot({ root: raiz });
      console.log(JSON.stringify(resultado, null, 2));
    }
  }
}
