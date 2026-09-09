export async function executar(contexto) {
  const {
    path,
    buildUsageCostReport,
    coreRoot,
    readJsonFile,
    options,
  } = contexto;
  {
    const priceBook = options["price-book"] ? (await readJsonFile(options["price-book"], "--price-book")).value : null;
    console.log(JSON.stringify(await buildUsageCostReport({ root: path.resolve(String(options.root ?? path.join(coreRoot, "outputs"))), from: options.from ?? null, to: options.to ?? null, priceBook }), null, 2));
  }
}
