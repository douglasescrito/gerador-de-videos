// Ponte entre o job-state compartilhado (createBatchJob/saveBatchJob/
// runBatchJob, em omni-batch-runner.mjs — o mesmo formato que POST /api/batch
// grava hoje) e o adapter de vídeo cookie-only que a CLI já usa em `generate`/
// `batch`. Sem isto, só o Express consegue criar lotes no formato que a
// Galeria lê (GET/cancelar/reordenar); esta ponte é o que permite a CLI
// também criar e dispachar lotes ali, para que remover as rotas gerativas do
// Express (Fase 2, §7) não deixe essas telas sem nada para gerenciar.
//
// `lote` permanece uma entrada textual. `batch --jobs` reutiliza as mesmas
// fases com requestFor, permits por job e autorização de produção; a ponte
// desse contrato está em job-file-batch.mjs.
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { composeDirection } from "./direction-presets.mjs";
import { persistOmniVideo } from "./omni-artifact-store.mjs";

export const BATCH_DISPATCH_UNSUPPORTED_REFERENCES_MESSAGE =
  "O comando lote aceita somente texto. Para referências de imagem/vídeo, use batch --jobs com confirmação de entradas ou autorização de produção.";

/** Falha fechado antes de criar o job: nunca aceita silenciosamente um item
 * com referência que este dispatcher não sabe autorizar/verificar. */
export function assertNoBatchReferences(items) {
  for (const [index, item] of items.entries()) {
    if ((item?.references ?? []).length > 0) {
      throw new Error(`Item ${index + 1}: ${BATCH_DISPATCH_UNSUPPORTED_REFERENCES_MESSAGE}`);
    }
  }
}

function effectiveItemConfig(item, job) {
  return item.config ?? job.defaults;
}

function composeItemDirection(item, job) {
  const effective = effectiveItemConfig(item, job);
  return composeDirection({
    userPrompt: item.prompt,
    style: effective.mode === "studio" ? effective.directionPreset : null,
    techniques: item.techniques ?? [],
    task: effective.task,
  });
}

/** Mesma preflight de POST /api/batch: técnica incompatível com estilo/task,
 * slot obrigatório ausente ou id desconhecido derrubam o lote inteiro antes
 * de qualquer chamada ao provedor. */
export function preflightBatchItems(job) {
  for (const item of job.items) composeItemDirection(item, job);
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Constrói o callback `generate` que runBatchJob espera: recebe (item, job,
 * hooks) e devolve { buffer, fileId, interactionId, startedAt,
 * effectivePrompt, promptComposition }. videoAdapter é o mesmo adapter
 * cookie-only que `generate`/`batch` já usam (createCookieVideoAdapter ou o
 * endpoint provider-free de teste) — escreve num arquivo temporário efêmero
 * (nunca no acervo: persist() é quem grava o arquivo final, via
 * persistOmniVideo) e lê os bytes de volta.
 */
export function createCliBatchGenerate({ videoAdapter, timeoutMs, pollIntervalMs }) {
  if (typeof videoAdapter?.generate !== "function") throw new Error("videoAdapter.generate é obrigatório.");
  return async function generate(item, job, hooks) {
    const composition = composeItemDirection(item, job);
    const effectiveConfig = effectiveItemConfig(item, job);
    const startedAt = new Date();
    const workDir = await mkdtemp(path.join(tmpdir(), "gerador-lote-cli-"));
    const outputFile = path.join(workDir, "clipe.mp4");
    const receiptFile = path.join(workDir, "clipe.mp4.receipt.json");
    try {
      const result = await videoAdapter.generate({
        prompt: composition.effectivePrompt,
        outputFile,
        receiptFile,
        images: [],
        task: effectiveConfig.task,
        aspectRatio: effectiveConfig.aspectRatio,
        model: effectiveConfig.model,
        attemptId: item.attemptId,
        timeoutMs,
        pollIntervalMs,
        metadata: { mode: effectiveConfig.mode, promptComposition: composition },
        onProviderHandle: hooks.accepted,
      });
      const buffer = await readFile(outputFile);
      return {
        buffer,
        fileId: result.fileId ?? null,
        interactionId: result.interactionId ?? null,
        startedAt,
        effectivePrompt: composition.effectivePrompt,
        promptComposition: composition,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** Constrói o callback `persist` que runBatchJob espera, gravando no MESMO
 * acervo (persistOmniVideo, compartilhado de propósito com a tela). */
export function createCliBatchPersist({ outputsRoot }) {
  if (!outputsRoot) throw new Error("outputsRoot é obrigatório.");
  return async function persist(payload) {
    return persistOmniVideo({ outputsRoot, ...payload, exists: fileExists });
  };
}

/** Ciclo remoto do mesmo runner. As fases curtas nunca aguardam render. */
export async function createCliBatchPhases({ videoAdapter, broker, timeoutMs = 900_000, pollIntervalMs = 5_000, requestFor = null, onCollected = null, recoverArtifact = null }) {
  if (!["submit", "observe", "collect"].every((name) => typeof videoAdapter?.[name] === "function")) return null;
  if (![timeoutMs, pollIntervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("timeoutMs e pollIntervalMs devem ser inteiros positivos.");
  const { withResourceLease, ResourceCapacityTimeoutError } = await import("./resource-lease.mjs");
  const observationTimeoutMs = Math.min(timeoutMs, 30_000);
  const operationId = (item) => `omni:${item.attemptId}`;
  const observed = new Map();
  const browserResources = broker.capacities["browser:omni"] ? ["browser:omni"] : [];
  const withBrowser = (job, work) => browserResources.length
    ? withResourceLease({ broker, productionId: job.id, clientId: job.collection, resources: browserResources, capacityWaitMs: 1, pollMs: 1, maxPollMs: 1 }, work)
    : work();
  const deferred = (submitted = true) => ({ status: "deferred", submitted, nextObservationAt: new Date(Date.now() + pollIntervalMs).toISOString() });
  const request = async (item, job) => {
    if (requestFor) return requestFor(item, job);
    const composition = composeItemDirection(item, job);
    const config = effectiveItemConfig(item, job);
    return { prompt: composition.effectivePrompt, task: config.task, aspectRatio: config.aspectRatio, model: config.model, images: [], metadata: { mode: config.mode, promptComposition: composition } };
  };
  const requestHash = (options) => createHash("sha256").update(JSON.stringify({ prompt: options.prompt, task: options.task, aspectRatio: options.aspectRatio, model: options.model, inputs: options.inputIdentity ?? options.providerInputPermit?.inputs ?? [], ...(options.operationIdentity ? { operationIdentity: options.operationIdentity } : {}) })).digest("hex");
  const assertIdentity = (remote, item, job, options) => {
    if (remote && (remote.productionId !== job.id || remote.clientId !== job.collection || remote.attemptId !== item.attemptId || remote.requestFingerprint !== requestHash(options))) {
      throw new Error("Operação remota não pertence ao pedido e à produção congelados.");
    }
  };
  return {
    timeoutMs,
    pollIntervalMs,
    async prepareRound(job) {
      observed.clear();
      if (typeof videoAdapter.observeMany !== "function") return;
      const claims = [];
      for (const item of job.items) {
        if (item.state !== "provider_pending" || (item.nextObservationAt && Date.parse(item.nextObservationAt) > Date.now())) continue;
        const current = broker.readRemoteOperation(operationId(item));
        if (!current?.handle || current.terminalProof) continue;
        const claim = broker.claimRemoteOperation({ operationId: current.operationId, claimMs: Math.max(120_000, timeoutMs) });
        if (claim) claims.push(claim);
      }
      if (!claims.length) return;
      try {
        const observations = await withBrowser(job, () => videoAdapter.observeMany({ requests: claims.map((claim) => claim.handle), timeoutMs: observationTimeoutMs }));
        for (const claim of claims) {
          const observation = observations.find((entry) => entry.fileId === claim.handle.fileId);
          if (!observation) continue;
          broker.recordRemoteObservation({ operationId: claim.operationId, claimToken: claim.claimToken, observation, nextObservationAt: new Date(Date.now() + pollIntervalMs) });
          observed.set(claim.operationId, observation);
        }
      } catch (error) {
        // Falha de observação não prova falha do render nem libera sua vaga.
        for (const claim of claims) observed.set(claim.operationId, { fileId: claim.handle.fileId, classification: "upstream_unreachable", zeroPost: true });
      } finally {
        for (const claim of claims) broker.releaseRemoteClaim({ operationId: claim.operationId, claimToken: claim.claimToken });
      }
    },
    async recover(item, job) {
      if (!item.attemptId) return null;
      const remote = broker.readRemoteOperation(operationId(item));
      assertIdentity(remote, item, job, await request(item, job));
      return remote?.handle ?? null;
    },
    async submit(item, job, hooks) {
      const id = operationId(item);
      const options = await request(item, job);
      const previous = broker.readRemoteOperation(id);
      assertIdentity(previous, item, job, options);
      if (previous && previous.state !== "not_submitted") {
        if (!previous.handle) { const error = new Error("Tentativa remota já pode ter sido submetida; reconciliação necessária."); error.postStarted = true; throw error; }
        await hooks.accepted(previous.handle);
        return deferred();
      }
      let detached = false;
      try {
        return await withResourceLease({ broker, productionId: job.id, clientId: job.collection, resources: ["provider:omni", ...browserResources], admission: options.admission ?? null, capacityWaitMs: 1, pollMs: 1, maxPollMs: 1 }, async (lease) => {
          const submitted = await videoAdapter.submit({
            ...options,
            attemptId: item.attemptId,
            timeoutMs: options.timeoutMs ?? timeoutMs,
            onBeforeSubmit: async (details) => {
              try {
                await options.onBeforeSubmit?.(details);
                if (job.cancelRequested) throw new Error("Lote cancelado antes da submissão.");
                broker.detachRemoteLease({ leaseId: lease.leaseId, operationId: id, attemptId: item.attemptId, requestFingerprint: requestHash(options) });
                detached = true;
              } catch (error) {
                // Este hook antecede o POST. Uma recusa aqui não pode herdar a
                // ambiguidade conservadora de um erro posterior no transporte.
                throw Object.assign(new Error(error.message, { cause: error }), { postStarted: false, submissionAmbiguous: false });
              }
            },
            onProviderHandle: async (handle) => {
              broker.bindRemoteHandle({ operationId: id, attemptId: item.attemptId, handle });
              await hooks.accepted(handle);
              await options.onProviderHandle?.(handle);
            },
          });
          if (!broker.readRemoteOperation(id)?.handle) {
            broker.bindRemoteHandle({ operationId: id, attemptId: item.attemptId, handle: submitted });
            await hooks.accepted(submitted);
          }
          return deferred();
        });
      } catch (error) {
        if (error instanceof ResourceCapacityTimeoutError) return deferred(false);
        if (detached && error.postStarted === false) broker.proveRemoteNotSubmitted({ operationId: id, attemptId: item.attemptId });
        throw error;
      }
    },
    async collectWhenReady(item, job) {
      const id = operationId(item);
      const claim = broker.claimRemoteOperation({ operationId: id, claimMs: Math.max(120_000, timeoutMs) });
      if (!claim) return deferred();
      try {
        const options = await request(item, job);
        assertIdentity(claim, item, job, options);
        await options.onBeforeCollect?.();
        const recoveredArtifact = await recoverArtifact?.(item, job, options);
        if (recoveredArtifact) return recoveredArtifact;
        const observation = claim.terminalProof
          ? { ...claim.terminalProof, fileId: claim.handle.fileId, zeroPost: true }
          : observed.get(id) ?? await withBrowser(job, () => videoAdapter.observe({ fileId: claim.handle.fileId, expirationTime: claim.handle.expirationTime, timeoutMs: observationTimeoutMs }));
        const remote = broker.recordRemoteObservation({ operationId: id, claimToken: claim.claimToken, observation, nextObservationAt: new Date(Date.now() + pollIntervalMs) });
        if (remote.state === "provider_failed") {
          const error = new Error("Provider comprovou falha terminal da geração remota.");
          error.providerTerminal = true;
          throw error;
        }
        if (remote.state !== "ready") return deferred();
        const workDir = options.outputFile ? null : await mkdtemp(path.join(tmpdir(), "gerador-coleta-cli-"));
        const outputFile = options.outputFile ?? path.join(workDir, "clipe.mp4");
        try {
          const result = await withBrowser(job, () => videoAdapter.collect({ ...options, outputFile, attemptId: item.attemptId, fileId: remote.handle.fileId, interactionId: remote.handle.interactionId, startedAt: item.startedAt, timeoutMs }));
          const buffer = await readFile(result.file ?? outputFile);
          await onCollected?.(item, result);
          return { buffer, fileId: remote.handle.fileId, interactionId: remote.handle.interactionId, startedAt: new Date(item.startedAt), effectivePrompt: options.prompt, promptComposition: options.metadata?.promptComposition, adapterResult: result };
        } finally {
          if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
      } catch (error) {
        // Falta de uma sessão local não altera a geração já aceita.
        if (error instanceof ResourceCapacityTimeoutError) return deferred();
        throw error;
      } finally {
        broker.releaseRemoteClaim({ operationId: id, claimToken: claim.claimToken });
      }
    },
  };
}
