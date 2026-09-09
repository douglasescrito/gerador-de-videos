import { readJobFileBatchResume, runJobFileBatchPhases } from "../../media-pipeline/job-file-batch.mjs";
import { withProductionLock } from "../../media-pipeline/production-lock.mjs";

export async function executar(contexto) {
  const {
    mkdir,
    readFile,
    path,
    assertDirectProviderInputPermitJit,
    createConcurrencyController,
    profileForParallel,
    resolveConcurrencyProfile,
    assembleVideoResearchBatch,
    assertVideoResearchOutputPlanAvailable,
    createProductionProviderInputAuthorization,
    validateProductionProviderInputAuthorization,
    createVideoResearchOutputPlan,
    resolveVideoResearchProfile,
    writeJsonAtomic,
    accumulatedWork,
    buildJobTimingStats,
    estimatePoolEta,
    formatDuration,
    loadLatestBatchBaseline,
    summarizeMilliseconds,
    coreRoot,
    createCliResourceBroker,
    withCliResourceLease,
    parse,
    required,
    cookieRuntime,
    explicitBoolean,
    productionRetryDecision,
    directProviderInputConfirmed,
    preflightDirectProviderInputs,
    withDirectProviderInputMetadata,
    promptComposition,
    timestamp,
    assertAvailable,
    readJsonFile,
    runPool,
    batchParallel,
    prepareBatchJobs,
    assertUniqueBatchDestinations,
    errorMessage,
    finiteDuration,
    terminalText,
    progressFailureLabel,
    options,
  } = contexto;
  {
      const resumed = options.resume ? await readJobFileBatchResume(options.resume) : null;
      if (resumed) Object.assign(options, { ...resumed.job.cliBatch.options, ...options });
      const commandStartedAt = new Date().toISOString();
      const commandStartedMono = performance.now();
      const parallel = batchParallel(options.parallel);
      const { file: jobsFile, value } = await readJsonFile(options.jobs, "--jobs");
      const jobs = Array.isArray(value) ? value : value?.jobs;
      if (!Array.isArray(jobs) || jobs.length === 0) throw new Error("--jobs deve conter um array JSON ou um objeto { jobs: [...] }.");
      const researchProfile = resolveVideoResearchProfile(options["research-profile"]);
      const researchPlan = researchProfile
        ? createVideoResearchOutputPlan({
            profile: researchProfile,
            coreRoot,
            outDir: options["out-dir"] ?? null,
            generatedName: `research-${timestamp()}`,
          })
        : null;
      const batchOptions = researchProfile
        ? {
            ...options,
            mode: options.mode ?? researchProfile.mode,
            style: options.style ?? researchProfile.style,
          }
        : options;
      const outDir = researchPlan?.videosDir
        ?? path.resolve(String(options["out-dir"] ?? path.join(coreRoot, "outputs", `batch-${timestamp()}`)));
      return withProductionLock(outDir, { label: `batch:${path.basename(outDir)}` }, async () => {
      const summaryFile = path.join(outDir, resumed ? `summary.resume-${timestamp()}-${contexto.randomUUID()}.json` : "summary.json");
      const preparedJobs = await prepareBatchJobs(jobs, jobsFile, outDir, batchOptions);
      assertUniqueBatchDestinations(preparedJobs, summaryFile);
      if (!resumed) await assertVideoResearchOutputPlanAvailable(researchPlan);
      const providerInputPermits = new Map();
      const providerInputDescriptorsByJob = new Map();
      for (const prepared of preparedJobs) {
        const descriptors = [
          ...prepared.images.map((file) => ({
            file,
            role: "reference-image",
            operation: "generate-video",
          })),
          ...(prepared.referenceVideo
            ? [{
                file: prepared.referenceVideo,
                role: "reference-video",
                operation: "generate-video",
              }]
            : []),
        ];
        providerInputDescriptorsByJob.set(prepared.number, descriptors);
      }
      const allProviderInputs = [...providerInputDescriptorsByJob.values()].flat();
      const uniqueProviderInputs = [...new Map(allProviderInputs.map((input) => [
        `${path.resolve(input.file)}\0${input.role}\0${input.operation}`,
        input,
      ])).values()];
      const productionAuthorizationFile = options["production-authorization"]
        ? path.resolve(String(options["production-authorization"]))
        : null;
      const productionId = productionAuthorizationFile
        ? required(options["production-id"], "--production-id")
        : (options["production-id"] ? String(options["production-id"]) : null);
      let productionAuthorization = null;
      if (productionAuthorizationFile) {
        try {
          productionAuthorization = JSON.parse(await readFile(productionAuthorizationFile, "utf8"));
          validateProductionProviderInputAuthorization(productionAuthorization, { expectedProductionId: productionId });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          productionAuthorization = await createProductionProviderInputAuthorization({
            confirmProviderInput: directProviderInputConfirmed(options, uniqueProviderInputs.length > 0),
            productionId,
            inputs: uniqueProviderInputs,
            retryPolicy: String(options["retry-policy"] ?? "bounded-reconciled@1"),
            maxAttempts: Number(options["max-attempts"] ?? 3),
          });
          await writeJsonAtomic(productionAuthorizationFile, productionAuthorization, { label: "Autorização de provider-input da produção" });
        }
      } else {
        directProviderInputConfirmed(options, uniqueProviderInputs.length > 0);
      }
      for (const prepared of preparedJobs) {
        const descriptors = providerInputDescriptorsByJob.get(prepared.number) ?? [];
        providerInputPermits.set(
          prepared.number,
          await preflightDirectProviderInputs(
            options,
            descriptors,
            {
              purpose: "batch-video-generation",
              expectedOperations: "generate-video",
              productionAuthorization,
              productionId,
            },
          ),
        );
      }
      const { videoAdapter } = await cookieRuntime(options);
      await mkdir(outDir, { recursive: true });
      await assertAvailable(summaryFile);
      const baseline = await loadLatestBatchBaseline(path.dirname(outDir), { excludeDir: outDir });
      if (baseline) {
        const baselineStats = summarizeMilliseconds(baseline.durationsMs);
        console.error(`[batch] baseline ${terminalText(baseline.batch)} | ${baseline.sampleCount} amostras | mediana ${formatDuration(baselineStats.median)}`);
      }
      const preparationCompletedMono = performance.now();
      const preparationMs = preparationCompletedMono - commandStartedMono;
      const startedAt = new Date().toISOString();
      const poolStartedMono = performance.now();
      const active = new Map();
      const completedDurationsMs = [];
      let completedCount = 0;

      function batchProgressLine(now = performance.now()) {
        const activeElapsedMs = [...active.values()].map((item) => now - item.startedMono);
        const queuedCount = Math.max(0, preparedJobs.length - completedCount - active.size);
        const estimate = estimatePoolEta({
          parallel,
          queuedCount,
          activeElapsedMs,
          completedDurationsMs,
          baselineDurationsMs: baseline?.durationsMs ?? [],
        });
        console.error(`[batch ${completedCount}/${preparedJobs.length}] decorrido ${formatDuration(now - poolStartedMono)} | ETA ${formatDuration(estimate.etaMs)} | ativos ${active.size} | fila ${queuedCount}`);
      }

      const concurrencyController = createConcurrencyController({
        profile: options["concurrency-profile"]
          ? resolveConcurrencyProfile(options["concurrency-profile"], { benchmark: explicitBoolean(options.benchmark, "--benchmark", false) })
          : profileForParallel(parallel),
      });
      const globalBatchBroker = createCliResourceBroker();
      console.error(`[batch 0/${preparedJobs.length}] preparado em ${formatDuration(preparationMs)} | perfil ${concurrencyController.profile.id} | largura ${concurrencyController.limit} (teto ${concurrencyController.profile.max})`);
      batchProgressLine(poolStartedMono);
      const frozenKeys = ["jobs", "out-dir", "aspect", "model", "mode", "style", "research-profile", "production-authorization", "production-id", "retry-policy", "max-attempts", "parallel", "concurrency-profile", "benchmark", "timeout", "poll"];
      const frozenOptions = Object.fromEntries(frozenKeys.filter((key) => options[key] != null).map((key) => [key, options[key]]));
      frozenOptions.jobs = jobsFile;
      frozenOptions["out-dir"] = researchPlan?.root ?? outDir;
      const phased = await runJobFileBatchPhases({
        preparedJobs, videoAdapter, broker: globalBatchBroker, concurrency: concurrencyController,
        outDir, jobsFile, productionId, productionAuthorization, frozenOptions, resume: resumed,
        permits: providerInputPermits, descriptors: providerInputDescriptorsByJob,
        assertInputs: async (prepared) => {
          const permit = providerInputPermits.get(prepared.number);
          if (permit) await assertDirectProviderInputPermitJit(permit, providerInputDescriptorsByJob.get(prepared.number), { requireAll: true });
        },
        metadataFor: (prepared, attemptNumber) => withDirectProviderInputMetadata({
          batch: path.basename(jobsFile), batchIndex: prepared.number, batchId: prepared.job.id ?? null,
          mode: prepared.mode, promptComposition: prepared.composition, attemptNumber,
          productionAuthorization: productionAuthorization ? { schema: productionAuthorization.schema, productionId: productionAuthorization.productionId, authorizationHash: productionAuthorization.authorizationHash, retryPolicy: productionAuthorization.retryPolicy, maxAttempts: productionAuthorization.maxAttempts } : null,
        }, providerInputPermits.get(prepared.number)),
        onProgress: (job, event) => {
          if (["provider_accepted", "item_completed", "attempt_failed", "remote_wait_budget_exhausted"].includes(event?.type)) console.error(`[batch] ${event.type} | ${job.items.filter((item) => item.state === "completed").length}/${job.items.length}`);
        },
      });
      const results = phased?.results ?? await runPool(preparedJobs, concurrencyController.profile.max, async (prepared) => {
        const { job, index, number, label, prompt, mode, composition, images, referenceVideo, task, aspectRatio, timeoutMs, pollIntervalMs, outputFile } = prepared;
        const workerStartedMono = performance.now();
        const workerStartedAt = new Date().toISOString();
        const queueMs = workerStartedMono - poolStartedMono;
        const display = String(number).padStart(2, "0");
        const displayId = terminalText(job.id ?? label);
        const progressMarks = {};
        active.set(number, { startedMono: workerStartedMono, id: displayId });
        console.error(`[${display}/${preparedJobs.length}] iniciado | fila ${formatDuration(queueMs)} | id=${displayId}`);

        function onProgress(progress) {
          const event = progress?.event ?? progress?.type;
          const elapsedMs = finiteDuration(progress?.elapsedMs, performance.now() - workerStartedMono);
          const timings = progress?.timings ?? {};
          progressMarks[event] = elapsedMs;
          if (event === "post_started") {
            console.error(`[${display}/${preparedJobs.length}] solicitação Omni iniciada`);
          } else if (event === "post_accepted") {
            const requestMs = finiteDuration(timings.requestMs, elapsedMs - finiteDuration(progressMarks.post_started, 0));
            console.error(`[${display}/${preparedJobs.length}] Omni aceitou em ${formatDuration(requestMs)}`);
          } else if (event === "provider_poll") {
            const state = terminalText(progress?.state, "UNKNOWN");
            const poll = Number.isInteger(progress?.poll) ? progress.poll : "?";
            const providerElapsedMs = elapsedMs - finiteDuration(progressMarks.post_started, 0);
            console.error(`[${display}/${preparedJobs.length}] Omni ${state} | ${formatDuration(providerElapsedMs)} | poll ${poll}`);
          } else if (event === "provider_ready") {
            const providerMs = finiteDuration(timings.providerMs, elapsedMs - finiteDuration(progressMarks.post_started, 0));
            console.error(`[${display}/${preparedJobs.length}] Omni pronto em ${formatDuration(providerMs)}`);
          } else if (event === "download_started") {
            console.error(`[${display}/${preparedJobs.length}] download iniciado`);
          } else if (event === "download_completed") {
            const downloadMs = finiteDuration(timings.downloadMs, elapsedMs - finiteDuration(progressMarks.download_started, 0));
            console.error(`[${display}/${preparedJobs.length}] download concluído em ${formatDuration(downloadMs)}`);
          } else if (event === "committed") {
            console.error(`[${display}/${preparedJobs.length}] MP4 validado e publicado`);
          } else if (event === "receipt_written") {
            console.error(`[${display}/${preparedJobs.length}] recibo gravado`);
          }
        }

      try {
        await mkdir(path.dirname(outputFile), { recursive: true });
        const providerInputPermit = providerInputPermits.get(number) ?? null;
        const providerInputDescriptors =
          providerInputDescriptorsByJob.get(number) ?? [];
        const attempts = [];
        let result = null;
        const maxAttempts = productionAuthorization?.maxAttempts ?? 1;
        for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
          delete progressMarks.post_started;
          delete progressMarks.post_accepted;
          try {
            if (providerInputPermit) {
              await assertDirectProviderInputPermitJit(
                providerInputPermit,
                providerInputDescriptors,
                { requireAll: true },
              );
            }
            result = await withCliResourceLease({
              broker: globalBatchBroker,
              resource: "provider:omni",
              productionId: productionId ?? `research:${path.basename(outDir)}`,
              clientId: path.basename(outDir),
              priority: "interactive",
            }, () => videoAdapter.generate({
              prompt,
              outputFile,
              images,
              referenceVideo,
              task,
              aspectRatio,
              model: job.model ?? options.model ?? "nano-banana-pro-preview",
              timeoutMs,
              pollIntervalMs,
              providerInputPermit,
              metadata: withDirectProviderInputMetadata(
                {
                  batch: path.basename(jobsFile),
                  batchIndex: number,
                  batchId: job.id ?? null,
                  mode,
                  promptComposition: composition,
                  productionAuthorization: productionAuthorization ? {
                    schema: productionAuthorization.schema,
                    productionId: productionAuthorization.productionId,
                    authorizationHash: productionAuthorization.authorizationHash,
                    retryPolicy: productionAuthorization.retryPolicy,
                    maxAttempts: productionAuthorization.maxAttempts,
                  } : null,
                  attemptNumber,
                },
                providerInputPermit,
              ),
              onProgress,
            }));
            attempts.push({ attemptNumber, outcome: "completed" });
            break;
          } catch (error) {
            const decision = productionRetryDecision(error, {
              attemptNumber,
              maxAttempts,
              postAccepted: progressMarks.post_accepted !== undefined,
            });
            attempts.push({
              attemptNumber,
              outcome: decision.retry ? "retry-authorized" : "stopped",
              reason: decision.reason,
              code: error?.code ?? null,
              status: error?.status ?? null,
            });
            if (!decision.retry) {
              error.productionAttempts = attempts;
              throw error;
            }
            if (decision.dueAt) {
              const waitMs = Math.max(0, Date.parse(decision.dueAt) - Date.now());
              if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 60_000)));
            }
            console.error(`[${display}/${preparedJobs.length}] tentativa ${attemptNumber} recusada de forma terminal; nova tentativa ${attemptNumber + 1}/${maxAttempts} autorizada pela produção`);
          }
        }
        if (!result) throw new Error("A produção encerrou o limite de tentativas sem resultado.");
        const workerCompletedMono = performance.now();
        const adapterTimings = result.timings ?? {};
        const videoDeliveryMs = finiteDuration(adapterTimings.videoDeliveryMs, workerCompletedMono - workerStartedMono);
        const timings = {
          ...adapterTimings,
          queueMs,
          workerStartedAt,
          workerCompletedAt: new Date().toISOString(),
          videoDeliveryMs,
          totalMs: finiteDuration(adapterTimings.totalMs, videoDeliveryMs),
        };
        completedDurationsMs.push(videoDeliveryMs);
        console.error(`[${display}/${preparedJobs.length}] concluído | Omni ${formatDuration(timings.providerMs)} | download ${formatDuration(timings.downloadMs)} | local ${formatDuration(timings.localFinalizeMs)} | entrega ${formatDuration(timings.videoDeliveryMs)} | total ${formatDuration(timings.totalMs)}`);
        return { index: number, id: job.id ?? label, ok: true, file: result.file, receipt: result.receiptFile, interactionId: result.interactionId, fileId: result.fileId, attempts, timings };
      } catch (error) {
        const workerCompletedMono = performance.now();
        const partial = error?.timings ?? {};
        console.error(`[${display}/${preparedJobs.length}] falhou | ${progressFailureLabel(error)}`);
        return {
          index: number,
          id: job.id ?? label,
          ok: false,
          error: errorMessage(error),
          kind: error?.kind ?? null,
          status: error?.status ?? null,
          code: error?.code ?? null,
          attempts: error?.productionAttempts ?? [],
          timings: {
            ...partial,
            queueMs,
            workerStartedAt,
            workerCompletedAt: new Date().toISOString(),
            totalMs: finiteDuration(partial.totalMs, workerCompletedMono - workerStartedMono),
          },
        };
      } finally {
        const terminal = performance.now();
        active.delete(number);
        completedCount += 1;
        batchProgressLine(terminal);
      }
    }, { controller: concurrencyController });
    const measuredConcurrencyReport = concurrencyController.report();
    const concurrencyReport = productionAuthorization ? {
      ...measuredConcurrencyReport,
      policy: {
        autoRetry: true,
        reconciliation: "automatic-before-resubmit",
        maxAttempts: productionAuthorization.maxAttempts,
        authorizationHash: productionAuthorization.authorizationHash,
        note: "rejeição terminal conhecida pode repetir; estado aceito ou ambíguo exige reconciliação antes de nova submissão",
      },
    } : measuredConcurrencyReport;
    const poolCompletedMono = performance.now();
    const completedAt = new Date().toISOString();
    const summaryAssemblyStartedMono = performance.now();
    const ok = results.filter((result) => result.ok).length;
    const failed = results.length - ok;
    const poolMs = poolCompletedMono - poolStartedMono;
    const jobTimingStats = buildJobTimingStats(results);
    const work = accumulatedWork(results);
    const summaryAssemblyMs = performance.now() - summaryAssemblyStartedMono;
    const batchMeasuredMs = performance.now() - commandStartedMono;
    let research = null;
    if (researchPlan) {
      if (failed > 0) {
        research = {
          status: "skipped",
          profile: researchProfile.id,
          reason: "require-all-jobs",
        };
      } else {
        try {
          research = await withCliResourceLease({ broker: globalBatchBroker, resource: "cpu:ffmpeg", productionId: phased?.jobId ?? outDir }, () => assembleVideoResearchBatch({
            plan: researchPlan,
            results,
            mode: researchProfile.mode,
            resume: Boolean(resumed),
          }));
        } catch (error) {
          research = {
            status: "failed",
            profile: researchProfile.id,
            error: errorMessage(error),
          };
        }
      }
    }
    const summary = {
      schema: "mkt-videos/batch-summary@2",
      operation: "batch-generate-video",
      jobsFile,
      outDir,
      parallel,
      concurrency: concurrencyReport,
      researchProfile: researchProfile?.id ?? null,
      research,
      startedAt,
      completedAt,
      total: results.length,
      ok,
      failed,
      results,
      ...(phased ? { stateFile: phased.stateFile, jobId: phased.jobId, lifecycle: phased.lifecycle, executionTiming: phased.executionTiming } : {}),
      timings: {
        unit: "milliseconds",
        wallClock: {
          commandStartedAt,
          poolStartedAt: startedAt,
          poolCompletedAt: completedAt,
          preparationMs,
          poolMs,
          summaryAssemblyMs,
          batchMeasuredMs,
          note: "Wall clock medido até a montagem do summary; escrita do JSON e stdout ocorrem depois.",
        },
        jobs: jobTimingStats,
        throughputVideosPerMinute: poolMs > 0 ? Math.round((ok * 60_000 / poolMs) * 1_000) / 1_000 : null,
        accumulatedWork: work,
        baseline: baseline ? {
          batch: baseline.batch,
          summaryFile: baseline.summaryFile,
          source: baseline.source,
          sampleCount: baseline.sampleCount,
          videoDeliveryMs: summarizeMilliseconds(baseline.durationsMs),
        } : null,
      },
    };
    const summaryWriteStartedMono = performance.now();
    await writeJsonAtomic(summaryFile, summary, { label: "Resumo do batch" });
    const summaryWriteMs = performance.now() - summaryWriteStartedMono;
    console.error(`[batch] summary gravado em ${formatDuration(summaryWriteMs)} | processo total ${formatDuration(performance.now() - commandStartedMono)}`);
    console.log(JSON.stringify({ ...summary, summaryFile }, null, 2));
    if (summary.failed > 0 || summary.research?.status === "failed") process.exitCode = 1;
      });
  }
}
