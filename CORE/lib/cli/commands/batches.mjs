export async function executar(contexto) {
  const {
    path,
    listBatchJobs,
    loadBatchJob,
    projectBatchAudit,
    pruneBatchJobs,
    summarizeBatchJob,
    coreRoot,
    explicitBoolean,
    errorMessage,
    options,
  } = contexto;
  {
    // Mesmo estado que a tela grava: o lote criado em /api/batch é inspecionável
    // aqui sem o app estar de pé, porque a fonte da verdade é o arquivo em disco.
    const stateDir = path.resolve(String(options["state-dir"] ?? path.join(coreRoot, ".batches")));

    if (options.id) {
      const job = loadBatchJob(stateDir, String(options.id));
      if (!job) throw new Error(`Lote "${options.id}" não encontrado em ${stateDir}.`);
      if (explicitBoolean(options.audit, "--audit", false)) {
        console.log(JSON.stringify(projectBatchAudit(job), null, 2));
        return;
      }
      if (options.format === "json") {
        console.log(JSON.stringify(job, null, 2));
        return;
      }
      const resumo = summarizeBatchJob(job);
      console.log(`${job.id}\n  coleção: ${job.collection}  ·  estado: ${resumo.state}  ·  ${resumo.total} itens`);
      for (const item of job.items) {
        const marca = {
          completed: "ok  ",
          provider_rejected: "RECUSADO",
          ambiguous: "ATENÇÃO",
          local_persist_failed: "PERSIST",
          pre_submit_failed: "PRÉ-POST",
          provider_pending: "…   ",
          submitting: "…   ",
          persisting: "…   ",
          cancelled: "CANCEL",
          pending: "-   ",
        }[item.state] ?? item.state;
        const errorMessage = item.error?.message ?? item.error ?? null;
        console.log(`  ${marca} ${item.name}${item.relPath ? `  →  ${item.relPath}` : ""}${errorMessage ? `  (${errorMessage})` : ""}`);
      }
      return;
    }

    if (String(options.action ?? "").trim().toLowerCase() === "prune") {
      // Apaga só o registro do lote encerrado em .batches/; nenhum vídeo,
      // recibo ou coleção é tocado. Dry-run por padrão.
      const relatorio = pruneBatchJobs(stateDir, {
        olderThanDays: options["older-than"] === undefined ? 30 : Number(options["older-than"]),
        dryRun: explicitBoolean(options["dry-run"], "--dry-run", true),
      });
      console.log(JSON.stringify(relatorio, null, 2));
      return;
    }

    const jobs = listBatchJobs(stateDir);
    if (options.format === "json") {
      console.log(JSON.stringify({ stateDir, jobs }, null, 2));
      return;
    }
    if (jobs.length === 0) {
      console.log(`Nenhum lote em ${stateDir}.`);
      return;
    }
    for (const job of jobs) {
      console.log(
        `${job.id}\n  ${job.collection}  ·  ${job.state}  ·  ${job.counts.completed}/${job.total} prontos` +
          `${job.counts.failed ? `  ·  ${job.counts.failed} falha(s)` : ""}  ·  ${job.createdAt.slice(0, 16).replace("T", " ")}`,
      );
    }
    console.log(`\n${jobs.length} lote(s).`);
  }
}
