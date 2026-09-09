import { readFile } from "node:fs/promises";
import path from "node:path";
import { createBatchJob, runBatchJob, batchStateFile, loadBatchJob, saveBatchJob, prepareBatchItemAction, authorizeReferenceReattempt } from "./omni-batch-runner.mjs";
import { createCliBatchPhases } from "./batch-dispatch.mjs";
import { operationFingerprint, assertPathAvailable } from "./pipeline-operation.mjs";
import { readReceipt } from "./receipt.mjs";
import { verifyArtifact } from "./artifact.mjs";

/** Read-only: a retomada deriva argumentos do pedido congelado, nunca do receipt. */
export async function readJobFileBatchResume(file) {
  const absolute = path.resolve(String(file));
  const raw = JSON.parse(await readFile(absolute, "utf8"));
  if (!raw?.cliBatch || path.resolve(batchStateFile(path.dirname(absolute), raw.id)) !== absolute) throw new Error("--resume exige o stateFile publicado pelo batch --jobs.");
  const job = loadBatchJob(path.dirname(absolute), raw.id);
  if (!job || job.cliBatch.schema !== "mkt-videos/job-file-batch@1") throw new Error("Estado de batch --jobs inválido.");
  return { job, stateFile: absolute, stateDir: path.dirname(absolute) };
}

/** Ponte para o MESMO runner; o handler mantém a posse da coleção até o summary. */
export async function runJobFileBatchPhases({ preparedJobs, videoAdapter, broker, concurrency, outDir, jobsFile, productionId, productionAuthorization, permits, descriptors, metadataFor, assertInputs, frozenOptions, resume = null, onProgress = null, jobId = null, requestContext = null, admissionFor = null, resumePreSubmit = false } = {}) {
  if (!["submit", "observe", "collect"].every((name) => typeof videoAdapter?.[name] === "function")) {
    if (resume) throw new Error("O adapter atual não expõe fases retomáveis para este batch.");
    return null;
  }
  const manifest = preparedJobs.map((prepared) => ({
    number: prepared.number, id: prepared.job.id ?? prepared.label, label: prepared.label,
    prompt: prepared.prompt, mode: prepared.mode, composition: prepared.composition,
    task: prepared.task, aspectRatio: prepared.aspectRatio,
    model: prepared.job.model ?? frozenOptions.model ?? "nano-banana-pro-preview",
    outputFile: prepared.outputFile,
    ...(prepared.receiptFile ? { receiptFile: prepared.receiptFile } : {}),
    ...(prepared.inputRoles ? { inputRoles: prepared.inputRoles } : {}),
    images: prepared.images, referenceVideo: prepared.referenceVideo,
    inputs: permits.get(prepared.number)?.inputs ?? [],
  }));
  const fingerprint = operationFingerprint({ manifest, productionId, authorizationHash: productionAuthorization?.authorizationHash ?? null, researchProfile: frozenOptions["research-profile"] ?? null, ...(requestContext ? { requestContext } : {}) });
  let job = resume?.job;
  const stateDir = resume?.stateDir ?? path.join(outDir, ".batch-state");
  if (job) {
    if (job.cliBatch.fingerprint !== fingerprint || job.cliBatch.outDir !== outDir || job.collection !== path.basename(outDir)) throw new Error("Batch retomado diverge dos jobs, destinos ou autorização congelados.");
    if (job.retryPolicy?.maxAttempts !== (productionAuthorization?.maxAttempts ?? 1) || job.items.length !== manifest.length) throw new Error("Estado retomado alterou o limite de tentativas ou a quantidade de pedidos.");
  } else {
    if (jobId) await assertPathAvailable(batchStateFile(stateDir, jobId), "Estado existente; retome a tentativa registrada");
    await Promise.all(manifest.flatMap((entry) => [assertPathAvailable(entry.outputFile, "MP4"), assertPathAvailable(entry.receiptFile ?? `${entry.outputFile}.receipt.json`, "Recibo")]));
    job = createBatchJob({
      id: jobId,
      collection: path.basename(outDir), parallel: concurrency?.profile?.max ?? 3,
      maxAttempts: productionAuthorization?.maxAttempts ?? 1,
      items: manifest.map((entry) => ({
        name: entry.label, prompt: entry.prompt,
        config: { mode: entry.mode, task: entry.task, aspectRatio: entry.aspectRatio, model: entry.model },
        references: entry.inputs.map((input, index) => ({ ...input, inputId: `input-${String(index + 1).padStart(3, "0")}`, file: path.basename((descriptors.get(entry.number) ?? [])[index].file) })),
      })),
    });
    job.cliBatch = { schema: "mkt-videos/job-file-batch@1", fingerprint, manifest, jobsFile, outDir, options: frozenOptions, ...(requestContext ? { requestContext } : {}) };
    saveBatchJob(stateDir, job);
  }
  const currentById = new Map(job.items.map((item, index) => [item.id, { prepared: preparedJobs[index], entry: manifest[index] }]));
  const requestFor = async (item) => {
    const { prepared, entry } = currentById.get(item.id);
    return {
      ...entry, timeoutMs: prepared.timeoutMs, providerInputPermit: permits.get(prepared.number) ?? null, recoverExistingOutput: true,
      inputIdentity: entry.inputs,
      ...(requestContext ? { operationIdentity: fingerprint } : {}),
      metadata: { ...metadataFor(prepared, item.attemptNumber), cliBatch: { fingerprint, itemId: item.id } },
      ...(admissionFor ? { admission: admissionFor(prepared), onBeforeCollect: async () => {
        const report = await admissionFor(prepared)({ phase: "before-collect" });
        if (report?.status !== "ready") throw new Error(`Admissão da coleta bloqueada: ${(report?.blockers ?? []).join(", ")}.`);
      } } : {}),
      onBeforeSubmit: async () => { await assertInputs(prepared); },
    };
  };
  async function recoverArtifact(item, _job, options) {
    let receipt;
    try { receipt = await readReceipt(options.receiptFile ?? `${options.outputFile}.receipt.json`); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (receipt.operation !== "generate-video" || receipt.parameters?.attemptId !== item.attemptId || receipt.providerResponse?.fileId !== item.fileId || receipt.metadata?.cliBatch?.fingerprint !== fingerprint || receipt.metadata?.cliBatch?.itemId !== item.id || receipt.prompt !== options.prompt) {
      throw new Error("Artefato local não comprova a tentativa congelada deste batch.");
    }
    const artifact = receipt.artifacts?.find((entry) => path.resolve(entry.file) === path.resolve(options.outputFile));
    const verified = await verifyArtifact(artifact);
    if (!verified.valid) throw new Error(`Artefato do batch divergente: ${verified.errors.join(" ")}`);
    return {
      buffer: await readFile(options.outputFile), fileId: item.fileId, interactionId: item.interactionId,
      startedAt: new Date(item.startedAt), effectivePrompt: options.prompt, promptComposition: options.metadata.promptComposition,
      adapterResult: { file: options.outputFile, receiptFile: options.receiptFile ?? `${options.outputFile}.receipt.json`, receipt, fileId: item.fileId, interactionId: item.interactionId, zeroPost: true },
    };
  }
  // Concluído só continua concluído se os bytes e o receipt ainda conferirem.
  for (const item of job.items.filter((entry) => entry.state === "completed")) {
    if (!await recoverArtifact(item, job, await requestFor(item))) throw new Error("Recibo de um item concluído está ausente.");
  }
  if (resumePreSubmit) {
    for (const item of job.items.filter((entry) => entry.state === "pre_submit_failed" && entry.effectBoundaryReached === false)) {
      const { prepared } = currentById.get(item.id);
      await assertInputs(prepared);
      if (item.recovery === "reauthorize_references") {
        if (!permits.get(prepared.number)) throw new Error("Retomada de referências exige permit vigente desta invocação.");
        authorizeReferenceReattempt(job, { confirmHuman: true, itemIds: [item.id] });
      } else prepareBatchItemAction(job, item.id, "resume-pre-submit");
    }
  }
  const phases = await createCliBatchPhases({
    videoAdapter, broker, requestFor, recoverArtifact,
    timeoutMs: Math.max(...preparedJobs.map((entry) => entry.timeoutMs)),
    pollIntervalMs: Math.max(1, Math.min(...preparedJobs.map((entry) => entry.pollIntervalMs))),
  });
  const invokedAt = Date.now();
  await runBatchJob({ job, stateDir, phases, concurrency, onProgress, persist: async (_payload, item, _job, generated) => {
    const result = generated.adapterResult;
    if (!result?.file || !result.receiptFile) throw new Error("Coleta do batch não devolveu MP4 e recibo.");
    const options = await requestFor(item);
    if (!await recoverArtifact(item, job, options)) throw new Error("Coleta do batch não publicou recibo verificável.");
    const started = Date.parse(item.startedAt);
    const totalMs = Date.now() - started;
    item.delivery = {
      file: result.file, receipt: result.receiptFile, fileId: item.fileId, interactionId: item.interactionId,
      timings: { ...(result.timings ?? {}), queueMs: Math.max(0, started - invokedAt), workerStartedAt: item.startedAt, workerCompletedAt: new Date().toISOString(), videoDeliveryMs: totalMs, totalMs },
    };
    return { relPath: path.relative(outDir, result.file), receiptId: result.receipt?.id ?? null };
  } });
  const results = job.items.map((item, index) => ({
    index: manifest[index].number, id: manifest[index].id, ok: item.state === "completed",
    ...(item.delivery ?? { error: item.error?.message ?? `Item em ${item.state}.`, kind: item.state, timings: null }),
    state: item.state, recovery: item.recovery,
    attempts: [...item.priorAttempts, { attemptId: item.attemptId, attemptNumber: item.attemptNumber, outcome: item.state }],
  }));
  return { results, stateFile: batchStateFile(stateDir, job.id), jobId: job.id, lifecycle: "submit-observe-collect", executionTiming: job.executionTiming };
}
