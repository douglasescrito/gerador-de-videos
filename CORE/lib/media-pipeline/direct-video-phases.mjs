import { realpath } from "node:fs/promises";
import path from "node:path";
import { readJobFileBatchResume, runJobFileBatchPhases } from "./job-file-batch.mjs";
import { batchStateFile, saveBatchJob } from "./omni-batch-runner.mjs";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { readReceipt } from "./receipt.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

const schema = "mkt-videos/direct-generate-context@1";
const ephemeral = new Set(["resume", "confirm-provider-input", "auth", "har", "timeout", "poll", "prompt-file"]);

export async function readDirectGenerateResume(file) {
  const resume = await readJobFileBatchResume(file);
  const context = resume.job.cliBatch.requestContext;
  if (context?.schema !== schema || resume.job.items.length !== 1 || !context.plan?.outputFile || !context.options?.prompt) throw new Error("--resume exige o stateFile publicado por generate.");
  return { ...resume, plan: structuredClone(context.plan), options: structuredClone(context.options) };
}

export function directGenerateOptions(options, userPrompt) {
  return { ...Object.fromEntries(Object.entries(options).filter(([key]) => !ephemeral.has(key))), prompt: userPrompt };
}

export async function runDirectVideoPhases({ request, videoAdapter, broker, plan, frozenOptions, localInputs = [], providerInputPermit, descriptors, assertInputs, admission, resume = null }) {
  const outDir = plan.collection?.root ?? path.dirname(request.outputFile);
  const canonicalDirectory = await realpath(path.dirname(request.outputFile));
  const outputKey = path.join(canonicalDirectory, path.basename(request.outputFile));
  const jobId = `generate:${operationFingerprint(process.platform === "win32" ? outputKey.toLowerCase() : outputKey).slice(0, 32)}`;
  const stateFile = batchStateFile(path.join(outDir, ".batch-state"), jobId);
  const context = { schema, plan, options: frozenOptions, localInputs };
  const prepared = {
    number: 1, job: { id: jobId, model: request.model }, label: "generate",
    prompt: request.prompt, mode: request.metadata?.mode ?? "raw", composition: request.metadata?.promptComposition,
    task: request.task, aspectRatio: request.aspectRatio, model: request.model,
    outputFile: request.outputFile, receiptFile: request.receiptFile ?? `${request.outputFile}.receipt.json`,
    images: request.images ?? [], inputRoles: request.inputRoles ?? [], referenceVideo: request.referenceVideo ?? null,
    timeoutMs: request.timeoutMs, pollIntervalMs: Math.max(1, request.pollIntervalMs),
  };
  try {
    const report = await runJobFileBatchPhases({
      preparedJobs: [prepared], videoAdapter, broker, concurrency: null, outDir,
      jobsFile: null, productionId: jobId, productionAuthorization: null,
      permits: new Map([[1, providerInputPermit]]), descriptors: new Map([[1, descriptors]]),
      metadataFor: () => request.metadata ?? {}, frozenOptions, requestContext: context,
      assertInputs: async () => {
        await assertInputs();
        const evaluated = await admission({ phase: "before-submit" });
        if (evaluated?.status !== "ready") throw new Error(`Admissão da submissão bloqueada: ${(evaluated?.blockers ?? []).join(", ")}.`);
      },
      admissionFor: () => admission,
      jobId, resume, resumePreSubmit: Boolean(resume),
    });
    if (!report) throw new Error("Adapter sem fases retomáveis para generate.");
    const result = report.results[0];
    if (!result.ok) throw Object.assign(new Error(result.error ?? `Geração em ${result.state}.`), { batchState: result.state });
    return { file: result.file, receiptFile: result.receipt, receipt: await readReceipt(result.receipt), fileId: result.fileId, interactionId: result.interactionId, timings: result.timings, stateFile: report.stateFile, lifecycle: report.lifecycle };
  } catch (error) {
    // Mesmo sem handle, o estado preserva o fato de que um POST pode ter sido
    // aceito. O próximo comando recebe o caminho exato para reconciliar.
    const existingState = resume?.stateFile ?? stateFile;
    try { await readDirectGenerateResume(existingState); error.generateStateFile = existingState; } catch {}
    throw error;
  }
}

// Checkpoints locais no mesmo job, sob a posse já mantida pelo handler. Não
// disputa provider nem redefine execução: apenas verifica e reaproveita saídas.
export async function runDirectGenerateLocalStage({ stateFile, key, run, files, withResources = (execute) => execute() }) {
  if (!stateFile) return withResources(run);
  const resume = await readDirectGenerateResume(stateFile);
  const fingerprint = resume.job.cliBatch.fingerprint;
  const stage = resume.job.cliDirectStages?.[key];
  if (stage) {
    const { hash, ...body } = stage;
    if (stage.requestFingerprint !== fingerprint || stage.key !== key || hash !== operationFingerprint(body)) throw new Error(`Checkpoint local divergente: ${key}.`);
    for (const artifact of stage.artifacts) {
      const verified = await verifyArtifact(artifact);
      if (!verified.valid) throw new Error(`Etapa local ${key} alterada: ${verified.errors.join(" ")}`);
    }
    return structuredClone(stage.payload);
  }
  const payload = await withResources(run);
  const artifacts = await Promise.all([...new Set(files(payload).filter(Boolean))].map((file) => createArtifactFromFile({ file, kind: "data", role: `direct-generation-${key}` })));
  const body = { key, requestFingerprint: fingerprint, payload, artifacts };
  resume.job.cliDirectStages ??= {};
  resume.job.cliDirectStages[key] = { ...body, hash: operationFingerprint(body) };
  saveBatchJob(resume.stateDir, resume.job);
  return payload;
}

export async function readDirectGenerateDelivery(stateFile) {
  const resume = await readDirectGenerateResume(stateFile);
  const delivery = resume.job.cliDirectDelivery;
  if (!delivery) return null;
  if (delivery.requestFingerprint !== resume.job.cliBatch.fingerprint || delivery.hash !== operationFingerprint({ payload: delivery.payload, artifacts: delivery.artifacts, requestFingerprint: delivery.requestFingerprint })) throw new Error("Entrega local diverge do pedido retomado.");
  for (const artifact of delivery.artifacts) {
    const verified = await verifyArtifact(artifact);
    if (!verified.valid) throw new Error(`Entrega local alterada: ${verified.errors.join(" ")}`);
  }
  return structuredClone(delivery.payload);
}

export async function saveDirectGenerateDelivery(stateFile, payload) {
  const resume = await readDirectGenerateResume(stateFile);
  const files = [...new Set([
    payload.file, payload.receipt, payload.finished?.file, payload.finished?.receipt,
    payload.narration?.file, payload.narration?.receipt, payload.narration?.metadata,
    typeof payload.collection?.finalVideo === "string" ? payload.collection.finalVideo : payload.collection?.finalVideo?.file,
    payload.collection?.finalVideo?.receipt,
  ].filter(Boolean))];
  const artifacts = await Promise.all(files.map((file) => createArtifactFromFile({ file, kind: "data", role: "direct-generation-delivery" })));
  const body = { payload, artifacts, requestFingerprint: resume.job.cliBatch.fingerprint };
  resume.job.cliDirectDelivery = { ...body, hash: operationFingerprint(body) };
  saveBatchJob(resume.stateDir, resume.job);
}
