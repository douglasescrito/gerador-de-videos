export async function executar(contexto) {
  const {
    path,
    writeJsonAtomic,
    compileGovernedPlan,
    readJsonFile,
    loadFilmSpec,
    options,
  } = contexto;
  {
    const source = await readJsonFile(options.spec, "--spec");
    const spec = source.value?.schema === "gerador-de-videos/receita@2" ? await loadFilmSpec(source.file, options) : source.value;
    const plan = await compileGovernedPlan(spec, options);
    if (options.out) await writeJsonAtomic(path.resolve(String(options.out)), plan, { label: "Execution plan" });
    console.log(JSON.stringify(options.out ? { schema: plan.schema, fingerprint: plan.fingerprint, out: path.resolve(String(options.out)), nodes: plan.nodes.length } : plan, null, 2));
  }
}
