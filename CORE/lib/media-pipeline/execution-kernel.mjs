import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  inferMimeType,
  sha256File,
  verifyArtifact,
} from "./artifact.mjs";
import {
  assertExecutionEffectAuthorizationConsumed,
  assertJournalNodeArtifacts,
  authorizeJournalNode,
  beginNodeAttempt,
  claimNodeReconciliation,
  buildExecutionRightsDecision,
  initializeExecutionJournal,
  materializeExecutionSnapshot,
  persistJournalProviderHandle,
  recordNodeCompletion,
  recordNodeFailure,
} from "./execution-journal.mjs";
import { issueExecutionAuthorization } from "./execution-authorization.mjs";
import { loadEffectiveProviderCapabilities } from "./provider-registry.mjs";
import { readReceipt, verifyReceipt } from "./receipt.mjs";
import { withResourceLease } from "./resource-lease.mjs";
import { createExecutionTiming, measureExecutionPhase } from "./execution-timing.mjs";

export const EXECUTION_KERNEL_SCHEMA = "mkt-videos/execution-kernel@1";

const OUTPUT_REQUIRED_NODE_KINDS = new Set([
  "keyframe",
  "tts",
  "music-generate",
  "omni-video",
  "omni-narration",
]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function canonicalNow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("now inválido.");
  return date;
}

function mediaArtifactDescriptor(artifact, receipt) {
  return {
    sha256: artifact.hash.value,
    bytes: artifact.bytes,
    mimeType: artifact.mimeType,
    receiptId: receipt.id,
    receiptSha256: receipt.hash.value,
  };
}

async function verifiedReceiptFromResult(result) {
  let receipt = result?.receipt ?? null;
  if (result?.receiptFile) {
    const fromDisk = await readReceipt(path.resolve(String(result.receiptFile)));
    if (receipt && receipt.hash?.value !== fromDisk.hash?.value) {
      throw new Error("Recibo retornado pelo adapter diverge do recibo persistido.");
    }
    receipt = fromDisk;
  }
  const validation = verifyReceipt(receipt);
  if (!validation.valid) {
    throw new Error(
      `Adapter pago não retornou recibo canônico: ${validation.errors.join(" ")}`,
    );
  }
  return receipt;
}

async function verifiedOutputArtifacts(result, { requireOutput }) {
  const receipt = await verifiedReceiptFromResult(result);
  const mediaArtifacts = (receipt.artifacts ?? []).filter((artifact) =>
    /^(?:image|video|audio)\//.test(String(artifact?.mimeType ?? "")));
  if (requireOutput && mediaArtifacts.length === 0) {
    throw new Error("Nó pago concluiu sem artifact audiovisual governado.");
  }
  for (const artifact of mediaArtifacts) {
    const validation = await verifyArtifact(artifact);
    if (!validation.valid) {
      throw new Error(
        `Artifact retornado pelo adapter diverge: ${validation.errors.join(" ")}`,
      );
    }
  }
  return {
    receipt,
    artifacts: mediaArtifacts.map((artifact) =>
      mediaArtifactDescriptor(artifact, receipt)),
  };
}

async function verifySameExecutionInputs(
  rightsDecision,
  {
    inputFiles = [],
    receiptFiles = [],
  } = {},
) {
  const files = (inputFiles ?? []).map((file) => path.resolve(String(file)));
  const receipts = [];
  for (const file of receiptFiles ?? []) {
    receipts.push(await readReceipt(path.resolve(String(file))));
  }
  if (rightsDecision.scope === "no-provider-input") {
    if (files.length > 0 || receipts.length > 0) {
      throw new Error(
        "Nó sem provider input recebeu bindings externos não autorizados.",
      );
    }
    return true;
  }
  if (files.length !== rightsDecision.inputs.length) {
    throw new Error(
      "Bindings de provider input divergem dos artifacts autorizados.",
    );
  }
  const remaining = [...rightsDecision.inputs];
  for (const file of files) {
    const [digest, info] = await Promise.all([sha256File(file), stat(file)]);
    if (!info.isFile()) throw new Error(`Provider input não é arquivo: ${file}`);
    const mimeType = inferMimeType(file);
    const index = remaining.findIndex(
      (input) =>
        input.sha256 === digest
        && input.bytes === info.size
        && input.mimeType === mimeType,
    );
    if (index < 0) {
      throw new Error(
        `Provider input mudou depois da aprovação: ${path.basename(file)}.`,
      );
    }
    const [binding] = remaining.splice(index, 1);
    const receipt = receipts.find(
      (candidate) =>
        candidate.id === binding.receiptId
        && candidate.hash?.value === binding.receiptSha256,
    );
    if (!receipt) {
      throw new Error(
        `Recibo governado ausente para provider input ${path.basename(file)}.`,
      );
    }
    const artifact = (receipt.artifacts ?? []).find(
      (candidate) =>
        candidate.hash?.value === binding.sha256
        && candidate.bytes === binding.bytes
        && candidate.mimeType === binding.mimeType,
    );
    if (!artifact) {
      throw new Error(
        `Recibo não cobre provider input ${path.basename(file)}.`,
      );
    }
    const validation = await verifyArtifact(artifact);
    if (!validation.valid) {
      throw new Error(
        `Provider input diverge do recibo: ${validation.errors.join(" ")}`,
      );
    }
  }
  if (remaining.length > 0) {
    throw new Error("Nem todos os artifacts autorizados foram vinculados.");
  }
  return true;
}

export function createExecutionKernel({
  dbFile,
  plan,
  confirmFingerprint = null,
  source = "cli",
  actor = "local-human",
  allowConceptPilot = false,
  clock = () => new Date(),
  resourceBroker = null,
  admissionProvider = null,
  validateReusedArtifact = null,
  productionId = plan?.spec?.productionContextBinding?.productionId ?? plan?.spec?.name ?? "production",
  clientId = plan?.spec?.productionContextBinding?.rootScopeId ?? "local",
} = {}) {
  const journalFile = path.resolve(requiredText(dbFile, "dbFile"));
  if (plan?.schema !== "mkt-videos/execution-plan@1") {
    throw new Error("Execution Kernel exige execution-plan@1.");
  }
  if (typeof clock !== "function") throw new Error("clock deve ser função.");
  if (admissionProvider != null && typeof admissionProvider !== "function") throw new Error("admissionProvider deve ser função.");
  initializeExecutionJournal({ dbFile: journalFile, plan });
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));

  async function validateReusedAncestors(node, snapshot) {
    const visited = new Set();
    const pending = [...node.dependencies];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(nodesById.get(id)?.dependencies ?? []));
      const ancestor = snapshot.nodes[id];
      if (ancestor?.reuseSource !== "approved-archive") continue;
      if (typeof validateReusedArtifact !== "function") throw new Error("Consumo de material reutilizado exige autorização vigente do root.");
      const checked = await verifiedOutputArtifacts({ receiptFile: ancestor.receipt }, { requireOutput: true });
      assertJournalNodeArtifacts({ dbFile: journalFile, nodeId: id, artifacts: checked.artifacts });
      await validateReusedArtifact(checked.receipt);
    }
  }

  async function withNodeLease(node, { attemptId, priority = "interactive" } = {}, execute) {
    if (!resourceBroker || !Array.isArray(node.resources) || node.resources.length === 0) return execute();
    // O ciclo vive em resource-lease.mjs: era esta implementação, e agora a
    // rota direta e as duas rotas de lote usam exatamente a mesma.
    return withResourceLease({
      broker: resourceBroker,
      requestId: `${plan.fingerprint}:${node.id}:${attemptId}`,
      productionId: String(productionId),
      clientId: String(clientId),
      priority,
      resources: node.resources,
      label: node.id,
      admission: admissionProvider == null
        ? null
        : () => admissionProvider({ node: structuredClone(node), planFingerprint: plan.fingerprint }),
    }, execute);
  }

  return Object.freeze({
    schema: EXECUTION_KERNEL_SCHEMA,
    journalFile,
    planFingerprint: plan.fingerprint,

    async executeLocalNode({
      nodeId,
      execute,
      reuse = null,
      attemptId = randomUUID(),
      priority = "interactive",
    } = {}) {
      if (typeof execute !== "function") {
        throw new Error("execute deve ser função.");
      }
      const node = plan.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error(`Nó desconhecido: ${nodeId}.`);
      if (
        node.costClass !== "local"
        || ["human-approval", "workflow-authorization"].includes(node.kind)
      ) {
        throw new Error(
          `Nó ${nodeId} não é uma etapa local executável pelo kernel.`,
        );
      }
      const timing = createExecutionTiming({ scope: "node" });
      return timing.run(async () => {
      const current = materializeExecutionSnapshot({ dbFile: journalFile });
      await validateReusedAncestors(node, current);
      if (current.nodes[nodeId]?.status === "completed") {
        const completed = current.nodes[nodeId];
        const file = completed.output;
        const receiptFile = completed.receipt;
        if (completed.reuseSource === "approved-archive" && !receiptFile) throw new Error("Nó reutilizado perdeu o recibo registrado no journal.");
        if (file && !(await stat(file)).isFile()) throw new Error(`Artefato local concluído não é arquivo: ${file}.`);
        let receipt = null;
        if (receiptFile) {
          receipt = await readReceipt(receiptFile);
          const validation = verifyReceipt(receipt);
          if (!validation.valid) throw new Error(`Recibo local divergente: ${validation.errors.join(" ")}`);
          if (completed.reuseSource === "approved-archive") {
            const checked = await verifiedOutputArtifacts({ receipt, receiptFile }, { requireOutput: true });
            assertJournalNodeArtifacts({ dbFile: journalFile, nodeId, artifacts: checked.artifacts });
          }
          if (receipt.metadata?.approvedReuse) {
            if (typeof reuse?.validate !== "function") throw new Error("Retomada de material reutilizado exige autorização vigente de reuso.");
            await measureExecutionPhase("verification", () => reuse.validate(receipt));
          }
          for (const artifact of receipt.artifacts ?? []) {
            const checked = await verifyArtifact(artifact);
            if (!checked.valid) throw new Error(`Artefato local divergente: ${checked.errors.join(" ")}`);
          }
        }
        return {
          ...(file ? { file } : {}),
          ...(receiptFile ? { receiptFile, receipt } : {}),
          execution: {
            schema: EXECUTION_KERNEL_SCHEMA,
            journalFile,
            nodeId,
            attemptId: current.nodes[nodeId].attemptId ?? null,
            status: "completed",
            reused: true,
          },
        };
      }
      const started = beginNodeAttempt({
        dbFile: journalFile,
        nodeId,
        attemptId,
        now: canonicalNow(clock()),
      });
      try {
        const cached = typeof reuse?.try === "function" ? await measureExecutionPhase("verification", () => reuse.try()) : null;
        const result = cached?.hit === true ? cached : await withNodeLease(node, { attemptId, priority }, async () => {
          await validateReusedAncestors(node, current);
          return measureExecutionPhase("local-execution", () => execute({ attemptId: started.attemptId }));
        });
        await validateReusedAncestors(node, current);
        const reusedArtifacts = cached?.hit === true ? (await verifiedOutputArtifacts(result, { requireOutput: true })).artifacts : [];
        const snapshot = recordNodeCompletion({
          dbFile: journalFile,
          nodeId,
          attemptId: started.attemptId,
          output: result?.file ?? result?.outputFile ?? null,
          receipt: result?.receiptFile ?? null,
          artifacts: reusedArtifacts,
          ...(cached?.hit === true ? { reuseSource: "approved-archive" } : {}),
          now: canonicalNow(clock()),
          executionTiming: timing.snapshot(),
        });
        return {
          ...(result && typeof result === "object" ? result : { value: result }),
          execution: {
            schema: EXECUTION_KERNEL_SCHEMA,
            journalFile,
            nodeId,
            attemptId: started.attemptId,
            status: snapshot.nodes[nodeId].status,
            reused: cached?.hit === true,
            ...(cached?.hit === true ? { reuseSource: "approved-archive" } : {}),
          },
        };
      } catch (error) {
        recordNodeFailure({
          dbFile: journalFile,
          nodeId,
          attemptId: started.attemptId,
          error,
          status: "attention_required",
          executionTiming: timing.snapshot(),
        });
        throw error;
      }
      });
    },

    async executePaidNode({
      nodeId,
      execute,
      phasedVideo = null,
      inputFiles = [],
      receiptFiles = [],
      attemptId = randomUUID(),
      priority = "interactive",
    } = {}) {
      if (typeof execute !== "function" && !phasedVideo) {
        throw new Error("execute deve ser função.");
      }
      const node = plan.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error(`Nó desconhecido: ${nodeId}.`);
      if (node.costClass === "local") {
        throw new Error(`Nó local ${nodeId} não pertence ao limite pago.`);
      }
      const usePhases = Boolean(phasedVideo && resourceBroker
        && ["omni-video", "omni-narration"].includes(node.kind)
        && ["submit", "observe", "collect"].every((name) => typeof phasedVideo.adapter?.[name] === "function"));
      if (phasedVideo && !usePhases) throw new Error("Execução por fases exige nó Omni, broker e adapter com submit/observe/collect.");
      const timing = createExecutionTiming({ scope: "node" });
      const runEffect = async () => {
        let authorization;
        let started;
        let reconciliationClaim;
        const previous = phasedVideo?.reconcile === true ? materializeExecutionSnapshot({ dbFile: journalFile }).nodes[nodeId] : null;
        if (previous) {
          if (!previous.attemptId || !["running", "reconciling", "provider_pending", "ambiguous", "attention_required", "completed"].includes(previous.status)) throw new Error(`Nó ${nodeId} não possui tentativa reconciliável nesta rota.`);
          attemptId = previous.attemptId;
        }
        const start = async () => {
          if (started) return;
          return measureExecutionPhase("preparation", async () => {
          const issuedAt = canonicalNow(clock());
          const providerCapabilities = await loadEffectiveProviderCapabilities({ now: issuedAt });
          const rightsDecision = buildExecutionRightsDecision({
            dbFile: journalFile,
            nodeId,
          });
          await verifySameExecutionInputs(rightsDecision, {
            inputFiles,
            receiptFiles,
          });
          authorization = issueExecutionAuthorization({
            providerCapabilities,
            plan,
            nodeId,
            rightsDecision,
            confirmFingerprint,
            source,
            actor,
            allowConceptPilot,
            now: issuedAt,
          });
          authorizeJournalNode({
            providerCapabilities,
            dbFile: journalFile,
            nodeId,
            authorization,
            now: issuedAt,
          });
          started = beginNodeAttempt({
            providerCapabilities,
            dbFile: journalFile,
            nodeId,
            attemptId,
            authorization,
            now: issuedAt,
          });
          });
        };
        try {
          const onProviderHandle = async (handle) => persistJournalProviderHandle({ dbFile: journalFile, nodeId, attemptId, handle });
          let result;
          if (usePhases) {
            const { createCliBatchPhases } = await import("./batch-dispatch.mjs");
            const { readMatchingLocalReceipt } = await import("./local-publication-recovery.mjs");
            const options = phasedVideo.options;
            const timeoutMs = options.timeoutMs ?? 900_000;
            const pollIntervalMs = options.pollIntervalMs ?? 5_000;
            const item = { attemptId, startedAt: canonicalNow(clock()).toISOString(), state: "pending" };
            const job = { id: String(productionId), collection: String(clientId), items: [item] };
            const verifyInputs = async (phase = "submit") => {
              const decision = buildExecutionRightsDecision({ dbFile: journalFile, nodeId });
              await verifySameExecutionInputs(decision, { inputFiles, receiptFiles });
              if (admissionProvider) {
                const admission = await admissionProvider({ node: structuredClone(node), planFingerprint: plan.fingerprint, phase, attemptId, fileId: item.fileId ?? null });
                if (admission?.status !== "ready") throw new Error(`Admissão de ${nodeId} bloqueada: ${(admission?.blockers ?? []).join(", ")}.`);
              }
            };
            const recoverArtifact = previous ? async (_item, _job, request) => {
              const receiptFile = request.receiptFile ?? `${request.outputFile}.receipt.json`;
              const receipt = await readMatchingLocalReceipt({ file: receiptFile, operation: "generate-video", inputFiles, outputFile: request.outputFile, parameters: { attemptId, task: request.task, aspectRatio: request.aspectRatio ?? "16:9" } });
              if (!receipt) return null;
              if (receipt.prompt !== request.prompt || receipt.providerResponse?.fileId !== previous.providerHandle.fileId) throw new Error("Recibo da geração não pertence ao pedido reconciliado.");
              return { adapterResult: { file: request.outputFile, receiptFile, receipt, fileId: previous.providerHandle.fileId, zeroPost: true } };
            } : null;
            const phases = await createCliBatchPhases({
              broker: resourceBroker, timeoutMs, pollIntervalMs,
              videoAdapter: {
                ...phasedVideo.adapter,
                submit: async (request) => {
                  if (previous) throw new Error("Reconciliação não autoriza submissão.");
                  // A autoridade nasce depois da fila, imediatamente antes do
                  // adapter; esperar capacidade não consome tentativa ou nonce.
                  await start();
                  return phasedVideo.adapter.submit({ ...request, executionEffectAuthorization: started.effectAuthorization });
                },
              },
              requestFor: async () => ({
                ...options,
                operationIdentity: { planFingerprint: plan.fingerprint, nodeId },
                inputIdentity: { inputFiles, receiptFiles },
                admission: admissionProvider ? () => admissionProvider({ node: structuredClone(node), planFingerprint: plan.fingerprint }) : null,
                onBeforeSubmit: () => verifyInputs("submit"),
                onBeforeCollect: () => verifyInputs("collect"),
                onProviderHandle: undefined,
                recoverExistingOutput: Boolean(previous),
              }),
              recoverArtifact,
            });
            if (previous) {
              const handle = await phases.recover(item, job);
              if (!handle?.fileId) throw new Error("Broker sem handle comprovado; reconciliação não autoriza nova submissão.");
              if (previous.providerHandle?.fileId && handle.fileId !== previous.providerHandle.fileId) throw new Error("Handle do broker diverge da tentativa do journal.");
              item.fileId = handle.fileId;
              // recover verifica produção, cliente, tentativa e fingerprint do
              // pedido antes de recompor a evidência que faltou ao journal.
              // A posse por nó já excluiu um executor vivo nesta mesma rota.
              if (!previous.providerHandle?.fileId || ["running", "reconciling"].includes(previous.status)) {
                if (previous.status === "completed") throw new Error("Nó concluído sem handle original no journal.");
                await onProviderHandle(handle);
                previous.providerHandle = structuredClone(handle);
              }
              if (previous.status === "completed") {
                await verifyInputs("collect");
                const cached = await recoverArtifact(item, job, options);
                if (!cached || path.resolve(previous.output) !== path.resolve(cached.adapterResult.file) || path.resolve(previous.receipt) !== path.resolve(cached.adapterResult.receiptFile)) throw new Error("Nó concluído perdeu sua saída ou seu recibo original.");
                const verified = await verifiedOutputArtifacts(cached.adapterResult, { requireOutput: true });
                assertJournalNodeArtifacts({ dbFile: journalFile, nodeId, artifacts: verified.artifacts });
                return { ...cached.adapterResult, execution: { schema: EXECUTION_KERNEL_SCHEMA, journalFile, nodeId, attemptId, authorizationHash: previous.authorizationHash, status: "completed", reused: true } };
              }
              reconciliationClaim = claimNodeReconciliation({ dbFile: journalFile, nodeId });
              if (reconciliationClaim.attemptId !== attemptId) throw new Error("Reconciliação assumiu outra tentativa.");
              item.state = "provider_pending";
              item.fileId = handle.fileId;
              await options.onProviderHandle?.({ ...handle, attemptId });
            }
            const wait = options.waitWithoutWorker ?? ((work) => work());
            const deadline = Date.now() + timeoutMs;
            for (;;) {
              const next = item.state === "provider_pending"
                ? await phases.collectWhenReady(item, job)
                : await phases.submit(item, job, { accepted: async (handle) => {
                  await onProviderHandle(handle);
                  item.state = "provider_pending";
                  item.fileId = handle.fileId;
                  await options.onProviderHandle?.({ ...handle, attemptId });
                } });
              if (next.status !== "deferred") { result = next.adapterResult; break; }
              if (Date.now() >= deadline) throw new Error(`Espera de ${nodeId} excedeu a janela de observação; reconcilie a mesma tentativa.`);
              await measureExecutionPhase("pending-wait", () => wait(() => new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))))));
            }
          } else {
            await start();
            result = await measureExecutionPhase("adapter-execution", () => execute({
              attemptId,
              executionEffectAuthorization: started.effectAuthorization,
              onProviderHandle,
            }));
          }
          if (started) assertExecutionEffectAuthorizationConsumed(started.effectAuthorization);
          const verified = await measureExecutionPhase("verification", () => verifiedOutputArtifacts(result, {
            requireOutput: OUTPUT_REQUIRED_NODE_KINDS.has(node.kind),
          }));
          const snapshot = recordNodeCompletion({
            dbFile: journalFile,
            nodeId,
            attemptId,
            output: result?.file ?? result?.outputFile ?? null,
            receipt: result?.receiptFile ?? null,
            artifacts: verified.artifacts,
            reconciled: Boolean(reconciliationClaim),
            now: canonicalNow(clock()),
            executionTiming: timing.snapshot(),
          });
          return {
            ...result,
            execution: {
              schema: EXECUTION_KERNEL_SCHEMA,
              journalFile,
              nodeId,
              attemptId,
              authorizationHash: authorization?.authorizationHash ?? previous?.authorizationHash,
              ...(started?.humanRetry ? { humanRetry: structuredClone(started.humanRetry) } : {}),
              receiptId: verified.receipt.id,
              status: snapshot.nodes[nodeId].status,
            },
          };
        } catch (error) {
          if (started || reconciliationClaim) recordNodeFailure({
            dbFile: journalFile,
            nodeId,
            attemptId,
            error,
            status: "ambiguous",
            executionTiming: timing.snapshot(),
          });
          throw error;
        }
      };
      if (!usePhases) return timing.run(() => withNodeLease(node, { attemptId, priority }, runEffect));
      const { withProductionLock } = await import("./production-lock.mjs");
      return timing.run(() => withProductionLock(path.join(path.dirname(journalFile), ".execution-node-locks", encodeURIComponent(nodeId)), { label: nodeId }, runEffect));
    },
  });
}
