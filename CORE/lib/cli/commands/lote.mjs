import { createCliBatchPhases } from "../../media-pipeline/batch-dispatch.mjs";

export async function executar(contexto) {
  const {
    path,
    PROVIDER_WAIT_POLICY,
    resolveProviderWaitMs,
    createBatchJob,
    saveBatchJob,
    runBatchJob,
    assertNoBatchReferences,
    createCliBatchGenerate,
    createCliBatchPersist,
    preflightBatchItems,
    loadBatchJob,
    summarizeBatchJob,
    normalizePipelineMode,
    requireStudioMode,
    coreRoot,
    createCliResourceBroker,
    withCliResourceLease,
    BATCH_TASKS,
    BATCH_ASPECTS,
    required,
    cookieRuntime,
    readJsonFile,
    batchParallel,
    errorMessage,
    options,
  } = contexto;
  {
    // Escreve no MESMO job-state (.batches/) que POST /api/batch grava hoje,
    // para que `batches`/cancelar/reordenar/auditar continuem funcionando
    // depois que as rotas gerativas do Express forem removidas (Fase 2, §7).
    // Só itens sem referência: ver batch-dispatch.mjs para o motivo do corte.
    const stateDir = path.resolve(String(options["state-dir"] ?? path.join(coreRoot, ".batches")));
    const parallel = batchParallel(options.parallel);

    let job;
    if (options.resume) {
      if (options.collection || options.items) throw new Error("--resume não pode ser combinado com --collection/--items: retoma o lote existente como ele está.");
      job = loadBatchJob(stateDir, String(options.resume));
      if (!job) throw new Error(`Lote "${options.resume}" não encontrado em ${stateDir}.`);
    } else {
      const mode = normalizePipelineMode(options.mode ?? "raw");
      if (options.style != null) requireStudioMode(mode, "--style");
      const task = String(options.task ?? "text_to_video");
      if (!BATCH_TASKS.has(task)) throw new Error(`--task deve ser um de: ${[...BATCH_TASKS].join(", ")}.`);
      const aspectRatio = String(options["aspect-ratio"] ?? "9:16");
      if (!BATCH_ASPECTS.has(aspectRatio)) throw new Error(`--aspect-ratio deve ser um de: ${[...BATCH_ASPECTS].join(", ")}.`);
      const { value: rawItems } = await readJsonFile(options.items, "--items");
      const items = Array.isArray(rawItems) ? rawItems : rawItems?.items;
      if (!Array.isArray(items) || items.length === 0) throw new Error("--items deve conter um array JSON ou um objeto { items: [...] }.");
      assertNoBatchReferences(items);
      job = createBatchJob({
        collection: required(options.collection, "--collection"),
        items,
        parallel,
        retryPolicy: String(options["retry-policy"] ?? "bounded-reconciled@1"),
        maxAttempts: Number(options["max-attempts"] ?? 1),
        defaults: {
          mode,
          task,
          aspectRatio,
          model: options.model ?? undefined,
          directionPreset: options.style ?? null,
        },
      });
      preflightBatchItems(job);
      saveBatchJob(stateDir, job);
    }

    assertNoBatchReferences(job.items);
    preflightBatchItems(job);
    const { videoAdapter } = await cookieRuntime(options);
    const generateWithoutBroker = createCliBatchGenerate({
      videoAdapter,
      timeoutMs: resolveProviderWaitMs("omni", options.timeout ?? PROVIDER_WAIT_POLICY.omni.defaultMs),
      pollIntervalMs: Number(options.poll ?? 5_000),
    });
    const batchBroker = createCliResourceBroker();
    const generate = (item, currentJob, hooks) => withCliResourceLease({
      broker: batchBroker,
      resource: "provider:omni",
      productionId: currentJob.id,
      clientId: currentJob.collection,
      priority: "interactive",
    }, () => generateWithoutBroker(item, currentJob, hooks));
    const persist = createCliBatchPersist({ outputsRoot: path.join(coreRoot, "outputs") });
    const phases = await createCliBatchPhases({ videoAdapter, broker: batchBroker, timeoutMs: resolveProviderWaitMs("omni", options.timeout ?? PROVIDER_WAIT_POLICY.omni.defaultMs), pollIntervalMs: Number(options.poll ?? 5_000) });

    const result = await runBatchJob({
      job,
      stateDir,
      generate,
      persist,
      phases,
      onProgress: (current) => {
        const resumo = summarizeBatchJob(current);
        console.error(`[lote ${resumo.counts.completed}/${resumo.total}] ${current.id} · ${resumo.state}`);
      },
    });
    if (job.items.some((item) => item.state !== "completed" && item.state !== "cancelled")) process.exitCode = 1;
    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.id}\n  coleção: ${job.collection}  ·  estado: ${result.state}  ·  ${result.counts.completed}/${result.total} prontos`);
      for (const item of job.items) {
        const errorMessage = item.error?.message ?? item.error ?? null;
        console.log(`  ${item.state === "completed" ? "ok  " : item.state} ${item.name}${item.relPath ? `  →  ${item.relPath}` : ""}${errorMessage ? `  (${errorMessage})` : ""}`);
      }
    }
  }
}
