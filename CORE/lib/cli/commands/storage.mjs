export async function executar(contexto) {
  const {
    path,
    buildStorageReport,
    coreRoot,
    options,
  } = contexto;
  {
    const step = String(options.step ?? "report");
    if (!new Set(["report", "plan"]).has(step)) throw new Error("storage --step deve ser report ou plan.");
    console.log(JSON.stringify(await buildStorageReport({ root: path.resolve(String(options.root ?? path.join(coreRoot, "outputs"))), graceHours: Number(options["grace-hours"] ?? 24), capacityAlertPercent: Number(options["capacity-alert-percent"] ?? 15) }), null, 2));
  }
}
