// Fila local durável compartilhada entre app e CLI.
//
// A unidade de segurança é a tentativa, não o item. O runner persiste o
// `attemptId` antes de chamar `generate` e oferece hooks para gravar o limite de
// efeito assim que o provider devolver um handle. Depois desse limite nenhuma
// retomada volta o item para pending automaticamente.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { classifyRetryReconcile } from "./retry-reconcile-policy.mjs";
import { withProductionLock } from "./production-lock.mjs";
import { assertExecutionTiming, createExecutionTiming, measureExecutionPhase } from "./execution-timing.mjs";

export const BATCH_JOB_SCHEMA = "mkt-videos/batch-job@4";
export const REFERENCE_BATCH_JOB_SCHEMA = "mkt-videos/batch-job@3";
export const PRIOR_BATCH_JOB_SCHEMA = "mkt-videos/batch-job@2";
export const LEGACY_BATCH_JOB_SCHEMA = "mkt-videos/batch-job@1";

// Entradas externas de um item. O descritor é fato, não autoridade: ele permite
// reconhecer e reconferir os bytes autorizados, mas nunca autoriza um envio. A
// autoridade continua sendo o permit efêmero, que vive só em memória.
const INPUT_ROLES = new Set(["reference-image", "first-frame", "reference-video"]);
const MAX_ITEM_REFERENCES = 4;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const ITEM_STATES = new Set([
  "pending",
  "submitting",
  "provider_pending",
  "persisting",
  "completed",
  "cancelled",
  "pre_submit_failed",
  "provider_rejected",
  "ambiguous",
  "local_persist_failed",
]);

const TERMINAL_STATES = new Set([
  "completed",
  "cancelled",
  "provider_rejected",
]);

const ACTIVE_STATES = new Set(["submitting", "provider_pending", "persisting"]);
const ATTENTION_STATES = new Set(["ambiguous", "local_persist_failed"]);

function now() {
  return new Date().toISOString();
}

function safeText(value, max = 1_000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

function safeError(error) {
  return {
    message: safeText(error?.message ?? error ?? "Falha desconhecida."),
    code: error?.code ? safeText(error.code, 120) : null,
  };
}

function appendEvent(job, item, type, details = {}) {
  const sequence = (job.events.at(-1)?.sequence ?? 0) + 1;
  const event = {
    sequence,
    at: now(),
    type,
    itemId: item?.id ?? null,
    details: Object.fromEntries(
      Object.entries(details)
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, typeof value === "string" ? safeText(value, 300) : value]),
    ),
  };
  job.events.push(event);
  return event;
}

function legacyItem(item, index) {
  const state = String(item?.state ?? "pending");
  const projectedState = state === "completed"
    ? "completed"
    : state === "pending"
      ? "pending"
      : state === "failed" || state === "running"
        ? "ambiguous"
        : "ambiguous";
  return {
    id: String(item?.id ?? `item:${String(index + 1).padStart(3, "0")}`),
    name: String(item?.name ?? `parte-${String(index + 1).padStart(3, "0")}`),
    prompt: String(item?.prompt ?? ""),
    state: projectedState,
    attemptId: null,
    attemptNumber: 0,
    priorAttempts: [],
    effectBoundaryReached: projectedState === "ambiguous" ? null : false,
    interactionId: null,
    fileId: null,
    relPath: item?.relPath ?? null,
    receiptId: item?.receiptId ?? null,
    references: [],
    techniques: [],
    error: item?.error ? { message: safeText(item.error), code: "legacy_failure" } : null,
    recovery: projectedState === "ambiguous" ? "inspect_legacy_state" : null,
    startedAt: item?.startedAt ?? null,
    acceptedAt: null,
    completedAt: item?.completedAt ?? null,
  };
}

/**
 * Valida o descritor persistido de uma entrada externa. `file` é apenas o nome
 * dentro da área de preparo do próprio lote: separador de caminho, referência a
 * diretório-pai ou raiz são recusados para que o descritor jamais aponte para
 * fora dela.
 */
function normalizeReference(reference, index, label) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw new Error(`${label}.references[${index}] é inválido.`);
  }
  const inputId = String(reference.inputId ?? "");
  if (inputId !== `input-${String(index + 1).padStart(3, "0")}`) {
    throw new Error(`${label}.references[${index}].inputId é inválido.`);
  }
  const role = String(reference.role ?? "");
  if (!INPUT_ROLES.has(role)) {
    throw new Error(`${label}.references[${index}].role não é permitido.`);
  }
  const file = String(reference.file ?? "").trim();
  if (!file || file !== path.basename(file) || file === "." || file === "..") {
    throw new Error(`${label}.references[${index}].file precisa ser um nome simples.`);
  }
  const sha256 = String(reference.sha256 ?? "");
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${label}.references[${index}].sha256 é inválido.`);
  }
  const bytes = Number(reference.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(`${label}.references[${index}].bytes é inválido.`);
  }
  const mimeType = String(reference.mimeType ?? "").trim();
  if (!mimeType) throw new Error(`${label}.references[${index}].mimeType é obrigatório.`);
  if (role === "reference-video" ? !mimeType.startsWith("video/") : !mimeType.startsWith("image/")) {
    throw new Error(`${label}.references[${index}] possui MIME incompatível com o role.`);
  }
  return { inputId, role, file, sha256, bytes, mimeType };
}

/**
 * Guarda a seleção de técnicas do item. A fila valida somente a forma; a
 * compatibilidade com estilo e task é conferida na submissão, pelo catálogo
 * canônico, para que uma escolha inválida derrube o lote antes do primeiro POST
 * em vez de item a item.
 */
function normalizeTechniqueSelections(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label}.techniques deve ser uma lista.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const entryLabel = `${label}.techniques[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${entryLabel} deve ser um objeto.`);
    }
    const id = String(entry.id ?? "").trim();
    if (!id) throw new Error(`${entryLabel}.id é obrigatório.`);
    if (!/@\d+$/.test(id)) throw new Error(`${entryLabel}.id deve ser versionado.`);
    if (seen.has(id)) throw new Error(`${entryLabel}.id repetido: ${id}.`);
    seen.add(id);
    const values = entry.values ?? {};
    if (typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`${entryLabel}.values deve ser um objeto.`);
    }
    return {
      id,
      values: Object.fromEntries(
        Object.entries(values).map(([key, raw]) => [key, safeText(raw, 4_000)]),
      ),
    };
  });
}

/** Mesmos limites por task do CLI; um item não inventa combinação própria. */
function assertReferenceShape(task, references, label) {
  const images = references.filter((entry) => entry.role !== "reference-video").length;
  const videos = references.length - images;
  if (references.length > MAX_ITEM_REFERENCES) {
    throw new Error(`${label} aceita no máximo ${MAX_ITEM_REFERENCES} entradas externas.`);
  }
  if (task === "text_to_video" && references.length > 0) {
    throw new Error(`${label}: text_to_video não aceita referências.`);
  }
  if (task === "image_to_video" && (images < 1 || images > 2 || videos > 0)) {
    throw new Error(`${label}: image_to_video exige uma ou duas imagens e nenhum vídeo.`);
  }
  if (task === "reference_to_video" && (images < 1 || videos > 0)) {
    throw new Error(`${label}: reference_to_video exige imagens e nenhum vídeo.`);
  }
  if (task === "edit" && (videos !== 1 || images > 0)) {
    throw new Error(`${label}: edit exige exatamente um vídeo e nenhuma imagem.`);
  }
}

/**
 * Cada versão nova acrescentou um campo que muda a geração. Projetar com o
 * campo vazio preserva exatamente o comportamento do lote antigo; ignorar o
 * campo produziria uma peça diferente da autorizada, e por isso a versão sobe.
 */
function upcastItems(job, sourceSchema, { references = false, techniques = false }) {
  return {
    ...job,
    schema: BATCH_JOB_SCHEMA,
    sourceSchema: job.sourceSchema ?? sourceSchema,
    items: Array.isArray(job.items)
      ? job.items.map((item) => ({
          ...item,
          ...(references ? { references: [] } : {}),
          ...(techniques ? { techniques: [] } : {}),
        }))
      : [],
  };
}

export function projectBatchJob(job) {
  if (job?.schema === BATCH_JOB_SCHEMA) return job;
  // `@3` já conhecia entradas externas, mas não técnicas de prompt.
  if (job?.schema === REFERENCE_BATCH_JOB_SCHEMA) {
    return upcastItems(job, REFERENCE_BATCH_JOB_SCHEMA, { techniques: true });
  }
  // `@2` não conhecia nenhum dos dois.
  if (job?.schema === PRIOR_BATCH_JOB_SCHEMA) {
    return upcastItems(job, PRIOR_BATCH_JOB_SCHEMA, { references: true, techniques: true });
  }
  if (job?.schema !== LEGACY_BATCH_JOB_SCHEMA) return null;
  const projected = {
    schema: BATCH_JOB_SCHEMA,
    sourceSchema: LEGACY_BATCH_JOB_SCHEMA,
    id: String(job.id),
    createdAt: job.createdAt ?? now(),
    updatedAt: job.updatedAt ?? job.createdAt ?? now(),
    collection: String(job.collection ?? ""),
    defaults: {
      aspectRatio: job.defaults?.aspectRatio ?? "9:16",
      task: job.defaults?.task ?? "text_to_video",
      mode: job.defaults?.mode ?? "raw",
      directionPreset: job.defaults?.directionPreset ?? null,
      model: job.defaults?.model ?? "gemini-omni-flash-preview",
    },
    parallel: Number(job.parallel ?? 3),
    state: "attention_required",
    cancelRequested: false,
    events: [],
    items: Array.isArray(job.items) ? job.items.map(legacyItem) : [],
  };
  projected.state = deriveBatchState(projected);
  return projected;
}

/**
 * @param {object} args
 * @param {string} args.collection
 * @param {Array<{name?: string, prompt: string, templateBinding?: object}>} args.items
 * @param {Record<string, unknown>} [args.defaults]
 * @param {number} [args.parallel]
 * @param {string} [args.id]
 */
export function createBatchJob({ collection, items, defaults = {}, parallel = 3, id = null, retryPolicy = "bounded-reconciled@1", maxAttempts = 1 } = {}) {
  const normalized = String(collection ?? "").trim();
  if (!normalized) throw new Error("collection é obrigatória para o lote.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("O lote precisa de pelo menos um item.");

  const parsedParallel = Number(parallel);
  if (!Number.isInteger(parsedParallel) || parsedParallel < 1 || parsedParallel > 8) {
    throw new Error("parallel deve ser um inteiro entre 1 e 8.");
  }
  if (retryPolicy !== "bounded-reconciled@1") throw new Error("retryPolicy deve ser bounded-reconciled@1.");
  const parsedMaxAttempts = Number(maxAttempts);
  if (!Number.isInteger(parsedMaxAttempts) || parsedMaxAttempts < 1 || parsedMaxAttempts > 3) throw new Error("maxAttempts deve ficar entre 1 e 3.");

  const jobItems = items.map((item, index) => {
    const label = `Item ${index + 1}`;
    const prompt = String(item?.prompt ?? "").trim();
    if (!prompt) throw new Error(`${label} está sem prompt.`);
    const config = item?.config && typeof item.config === "object"
      ? {
          mode: item.config.mode ?? defaults.mode ?? "raw",
          directionPreset: item.config.directionPreset ?? null,
          aspectRatio: item.config.aspectRatio ?? defaults.aspectRatio ?? "9:16",
          task: item.config.task ?? defaults.task ?? "text_to_video",
          model: item.config.model ?? defaults.model ?? "gemini-omni-flash-preview",
        }
      : null;
    const rawReferences = item?.references;
    if (rawReferences != null && !Array.isArray(rawReferences)) {
      throw new Error(`${label}.references deve ser uma lista.`);
    }
    const references = (rawReferences ?? []).map((reference, referenceIndex) =>
      normalizeReference(reference, referenceIndex, label));
    assertReferenceShape(
      config?.task ?? defaults.task ?? "text_to_video",
      references,
      label,
    );
    const techniques = normalizeTechniqueSelections(item?.techniques, label);
    return {
      id: `item:${String(index + 1).padStart(3, "0")}`,
      name: String(item?.name ?? `parte-${String(index + 1).padStart(3, "0")}`),
      prompt,
      templateBinding: item?.templateBinding ?? null,
      config,
      references,
      techniques,
      state: "pending",
      attemptId: null,
      attemptNumber: 0,
      priorAttempts: [],
      effectBoundaryReached: false,
      interactionId: null,
      fileId: null,
      relPath: null,
      receiptId: null,
      error: null,
      recovery: null,
      retryDueAt: null,
      startedAt: null,
      acceptedAt: null,
      completedAt: null,
    };
  });

  const createdAt = now();
  const job = {
    schema: BATCH_JOB_SCHEMA,
    id: id ?? `batch:${randomUUID()}`,
    createdAt,
    updatedAt: createdAt,
    collection: normalized,
    defaults: {
      aspectRatio: defaults.aspectRatio ?? "9:16",
      task: defaults.task ?? "text_to_video",
      mode: defaults.mode ?? "raw",
      directionPreset: defaults.directionPreset ?? null,
      model: defaults.model ?? "gemini-omni-flash-preview",
    },
    parallel: parsedParallel,
    retryPolicy: { id: retryPolicy, maxAttempts: parsedMaxAttempts },
    state: "pending",
    cancelRequested: false,
    events: [],
    items: jobItems,
  };
  appendEvent(job, null, "batch_created", {
    itemCount: jobItems.length,
    parallel: parsedParallel,
    referencedItemCount: jobItems.filter((item) => item.references.length > 0).length,
  });
  return job;
}

export function batchStateFile(stateDir, jobId) {
  const safe = String(jobId).replace(/[^a-zA-Z0-9:_-]/g, "").replace(/:/g, "-");
  if (!safe) throw new Error("id de lote inválido.");
  return path.join(stateDir, `${safe}.json`);
}

export function saveBatchJob(stateDir, job) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Somente batch-job@4 pode ser persistido.");
  const file = batchStateFile(stateDir, job.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
  return file;
}

export function loadBatchJob(stateDir, jobId) {
  try {
    return projectBatchJob(JSON.parse(fs.readFileSync(batchStateFile(stateDir, jobId), "utf8")));
  } catch {
    return null;
  }
}

export function listBatchJobs(stateDir) {
  if (!fs.existsSync(stateDir)) return [];
  const jobs = [];
  for (const entry of fs.readdirSync(stateDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const projected = projectBatchJob(JSON.parse(fs.readFileSync(path.join(stateDir, entry), "utf8")));
      if (projected) jobs.push(summarizeBatchJob(projected));
    } catch {
      // Arquivo corrompido não derruba a listagem.
    }
  }
  return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function deriveBatchState(job) {
  const states = job.items.map((item) => item.state);
  if (states.some((state) => ACTIVE_STATES.has(state))) return "running";
  if (states.some((state) => ATTENTION_STATES.has(state))) return "attention_required";
  // Item que perdeu autoridade sobre entrada externa é pendência humana, não
  // fila: sem a reconfirmação explícita ele nunca sai do lugar sozinho, e o
  // lote precisa dizer isso em vez de parecer apenas pendente.
  if (job.items.some((item) => item.recovery === "reauthorize_references")) {
    return "attention_required";
  }
  if (job.items.some((item) => item.recovery === "retry_when_due")) return "pending";
  if (states.some((state) => state === "pending" || state === "pre_submit_failed")) {
    return job.cancelRequested ? "cancelled" : "pending";
  }
  const completed = states.filter((state) => state === "completed").length;
  const rejected = states.filter((state) => state === "provider_rejected").length;
  const cancelled = states.filter((state) => state === "cancelled").length;
  if (completed === states.length) return "completed";
  if (cancelled === states.length) return "cancelled";
  if (completed > 0 && (rejected > 0 || cancelled > 0)) return "completed_with_failures";
  if (rejected > 0 && completed === 0) return "failed";
  return "attention_required";
}

export function summarizeBatchJob(job) {
  const projected = projectBatchJob(job);
  if (!projected) throw new Error("Lote inválido.");
  const counts = {};
  for (const state of ITEM_STATES) counts[state] = 0;
  for (const item of projected.items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return {
    schema: BATCH_JOB_SCHEMA,
    sourceSchema: projected.sourceSchema ?? BATCH_JOB_SCHEMA,
    id: projected.id,
    collection: projected.collection,
    state: deriveBatchState(projected),
    cancelRequested: projected.cancelRequested,
    createdAt: projected.createdAt,
    updatedAt: projected.updatedAt,
    total: projected.items.length,
    lastEventSequence: projected.events.at(-1)?.sequence ?? 0,
    counts,
    ...(job.executionTiming ? { executionTiming: assertExecutionTiming(job.executionTiming) } : {}),
  };
}

function commitJob(stateDir, job, onProgress, event = null) {
  job.state = deriveBatchState(job);
  job.updatedAt = now();
  saveBatchJob(stateDir, job);
  if (onProgress) onProgress(job, event);
}

/**
 * Executa somente itens `pending`. Estados de atenção nunca voltam para a fila
 * por inferência; as ações explícitas abaixo preparam a transição permitida.
 */
/**
 * @param {{
 *   job: any,
 *   stateDir: string,
 *   generate: (item: any, job: any, hooks: { accepted: (details?: any) => Promise<void> }) => Promise<any>,
 *   persist: (payload: any, item: any, job: any) => Promise<any>,
 *   onProgress?: ((job: any) => void | Promise<void>) | null,
 *   concurrency?: { acquire: () => Promise<any>, release: (token: any, outcome: any) => any, report: () => any, observeQueue?: (depth: number) => void, profile?: any } | null
 * }} options
 */
export async function runBatchJob(options) {
  const timing = createExecutionTiming({ scope: "batch-invocation" });
  return timing.run(() => runMeasuredBatchJob({ ...options, timing }));
}

async function runMeasuredBatchJob({ job, stateDir, generate, persist, onProgress = null, concurrency = null, phases = null, _locked = false, timing }) {
  if (phases && !_locked) {
    const lockDirectory = path.join(stateDir, ".locks", String(job?.id ?? "invalid").replace(/[^a-zA-Z0-9_-]/g, "-"));
    return withProductionLock(lockDirectory, { label: job?.id }, () => {
      const persisted = loadBatchJob(stateDir, job.id);
      if ((persisted?.events.at(-1)?.sequence ?? 0) > (job.events.at(-1)?.sequence ?? 0)) {
        throw new Error("Lote foi atualizado por outra execução; releia o estado antes de retomar.");
      }
      return runMeasuredBatchJob({ job, stateDir, generate, persist, onProgress, concurrency, phases, _locked: true, timing });
    });
  }
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  if ((!phases && typeof generate !== "function") || typeof persist !== "function") {
    throw new Error("generate e persist são obrigatórios.");
  }

  let event = appendEvent(job, null, "batch_started");
  commitJob(stateDir, job, onProgress, event);

  const runStartedAt = new Date();
  function requeueDueRetries() {
    if (job.cancelRequested) return;
    for (const item of job.items) {
      if (item.recovery !== "retry_when_due" || !item.retryDueAt || Date.parse(item.retryDueAt) > Date.now()) continue;
      item.priorAttempts ??= [];
      item.priorAttempts.push({ attemptId: item.attemptId, attemptNumber: item.attemptNumber, state: item.state, fileId: item.fileId, interactionId: item.interactionId, startedAt: item.startedAt, completedAt: item.completedAt });
      item.attemptId = null;
      item.fileId = null;
      item.interactionId = null;
      item.acceptedAt = null;
      item.startedAt = null;
      item.nextObservationAt = null;
      item.state = "pending";
      item.error = null;
      item.recovery = null;
      item.retryDueAt = null;
      appendEvent(job, item, "retry_due_requeued", { priorAttempt: item.priorAttempts.at(-1)?.attemptId });
    }
  }
  requeueDueRetries();
  if (phases) {
    for (const item of job.items) {
      if (!["submitting", "provider_pending", "ambiguous", "local_persist_failed", "persisting"].includes(item.state)) continue;
      const recovered = await phases.recover(item, job);
      if (recovered?.fileId) {
        item.fileId = recovered.fileId;
        item.interactionId = recovered.interactionId ?? item.interactionId;
        item.state = "provider_pending";
        item.effectBoundaryReached = true;
        item.nextObservationAt = null;
        item.error = null;
      } else if (item.state === "submitting") {
        item.state = "ambiguous";
        item.recovery = "attention_required";
      }
    }
    commitJob(stateDir, job, onProgress, appendEvent(job, null, "remote_attempts_reconciled"));
  }
  const eligible = (item) => (item.state === "pending" && !job.cancelRequested) || (phases && item.state === "provider_pending");
  let queue = job.items.filter((item) => eligible(item) && (!item.nextObservationAt || Date.parse(item.nextObservationAt) <= Date.now()));
  let cursor = 0;
  // Sem controlador, a largura continua sendo exatamente `job.parallel` e nada
  // muda. Com controlador, o pool nasce no teto do perfil e a permissão de
  // começar uma tentativa passa a ser dele — o que ele nunca faz é reenviar.
  const poolWidth = concurrency?.profile?.max ?? job.parallel;

  const worker = async () => {
    while (cursor < queue.length) {
      if (job.cancelRequested && !phases) break;
      concurrency?.observeQueue?.(Math.max(0, queue.length - cursor));
      const permit = concurrency ? await measureExecutionPhase("capacity-wait", () => concurrency.acquire()) : null;
      if (job.cancelRequested && !phases) {
        if (permit) concurrency.release(permit, { outcome: "cancelled" });
        break;
      }
      const item = queue[cursor++];
      if (!item || !eligible(item)) {
        if (permit) concurrency.release(permit, { outcome: "skipped" });
        continue;
      }

      const submitting = item.state === "pending";
      if (submitting) {
        if (!item.attemptId || !item.startedAt || !phases) item.attemptNumber += 1;
        item.attemptId ??= `attempt:${randomUUID()}`;
        item.state = "submitting";
        item.effectBoundaryReached = false;
        item.startedAt ??= now();
        item.completedAt = null;
        item.error = null;
        item.recovery = null;
      }
      event = appendEvent(job, item, submitting ? "attempt_started" : "remote_observation_started", {
        attemptId: item.attemptId,
        attemptNumber: item.attemptNumber,
      });
      commitJob(stateDir, job, onProgress, event);

      const hooks = {
        accepted: ({ fileId = null, interactionId = null } = {}) => {
          item.effectBoundaryReached = true;
          item.fileId = fileId ?? item.fileId;
          item.interactionId = interactionId ?? item.interactionId;
          item.acceptedAt = now();
          item.state = "provider_pending";
          const acceptedEvent = appendEvent(job, item, "provider_accepted", {
            attemptId: item.attemptId,
            fileId: item.fileId,
            interactionId: item.interactionId,
          });
          commitJob(stateDir, job, onProgress, acceptedEvent);
        },
      };

      try {
        let generated;
        if (!phases) generated = await measureExecutionPhase("adapter-execution", () => generate(item, job, hooks));
        else if (submitting) generated = await phases.submit(item, job, hooks);
        else generated = await phases.collectWhenReady(item, job);
        if (phases && generated?.status === "deferred") {
          if (job.cancelRequested && generated.submitted === false) {
            item.state = "cancelled";
            item.completedAt = now();
            item.nextObservationAt = null;
            item.recovery = null;
            event = appendEvent(job, item, "item_cancelled", { reason: "capacity_wait_cancelled", effectSubmitted: false });
            continue;
          }
          item.state = generated.submitted === false ? "pending" : "provider_pending";
          item.nextObservationAt = generated.nextObservationAt ?? new Date(Date.now() + Number(phases.pollIntervalMs ?? 1000)).toISOString();
          item.recovery = item.state === "provider_pending" ? "reconcile_by_handle" : null;
          event = appendEvent(job, item, "remote_phase_deferred", { state: item.state, nextObservationAt: item.nextObservationAt });
          continue;
        }
        if (!item.effectBoundaryReached && (generated?.fileId || generated?.interactionId)) {
          hooks.accepted({
            fileId: generated.fileId ?? null,
            interactionId: generated.interactionId ?? null,
          });
        }
        item.fileId = generated?.fileId ?? item.fileId;
        item.interactionId = generated?.interactionId ?? item.interactionId;
        item.state = "persisting";
        event = appendEvent(job, item, "local_persist_started", {
          attemptId: item.attemptId,
          fileId: item.fileId,
        });
        commitJob(stateDir, job, onProgress, event);

        const effectiveConfig = item.config ?? job.defaults;
        const stored = await measureExecutionPhase("publication", () => persist({
          collection: job.collection,
          name: item.name,
          buffer: generated.buffer,
          prompt: generated.effectivePrompt ?? item.prompt,
          model: effectiveConfig.model,
          parameters: {
            task: effectiveConfig.task,
            aspectRatio: effectiveConfig.aspectRatio,
            mode: effectiveConfig.mode,
            source: "batch",
          },
          metadata: {
            batchId: job.id,
            batchItemId: item.id,
            attemptId: item.attemptId,
            ...(item.templateBinding ? { templateBinding: item.templateBinding } : {}),
            ...(generated.promptComposition ? { promptComposition: generated.promptComposition } : {}),
            ...(effectiveConfig.directionPreset
              && !generated.promptComposition
              ? {
                  promptComposition: {
                    directionPreset: effectiveConfig.directionPreset,
                    userPrompt: item.prompt,
                  },
                }
              : {}),
            ...(item.fileId ? { fileId: item.fileId } : {}),
            ...(item.interactionId ? { interactionId: item.interactionId } : {}),
          },
          startedAt: generated.startedAt ?? new Date(item.startedAt),
        }, item, job, generated));
        item.state = "completed";
        item.relPath = stored.relPath;
        item.receiptId = stored.receiptId;
        item.error = null;
        item.recovery = null;
        item.retryDueAt = null;
        item.completedAt = now();
        event = appendEvent(job, item, "item_completed", {
          attemptId: item.attemptId,
          receiptId: item.receiptId,
          relPath: item.relPath,
        });
      } catch (error) {
        const normalized = safeError(error);
        item.error = normalized;
        item.completedAt = now();
        if (phases && submitting && job.cancelRequested && error?.postStarted === false && !item.effectBoundaryReached) {
          item.state = "cancelled";
          item.recovery = null;
          item.nextObservationAt = null;
          event = appendEvent(job, item, "item_cancelled", { reason: "cancelled_before_effect", effectSubmitted: false });
          continue;
        }
        let classifierState;
        if (phases && error?.postStarted === true) item.effectBoundaryReached = true;
        if (item.state === "persisting") {
          item.state = "local_persist_failed";
          classifierState = "local_persist_failed";
        } else if (phases && !submitting) {
          item.state = error?.providerTerminal === true ? "provider_rejected" : "ambiguous";
          classifierState = item.state;
        } else if (error?.batchFailureKind === "provider_rejected") {
          item.state = "provider_rejected";
          item.effectBoundaryReached = true;
          classifierState = "provider_rejected";
        } else if (item.effectBoundaryReached === false) {
          item.state = "pre_submit_failed";
          classifierState = "pre_effect_failed";
        } else {
          item.state = "ambiguous";
          classifierState = "ambiguous";
        }
        const decision = classifyRetryReconcile({
          state: classifierState,
          attemptNumber: item.attemptNumber,
          maxAttempts: Number(job.retryPolicy?.maxAttempts ?? 1),
          terminalRejectionProved: classifierState === "provider_rejected",
          rejectionRetryable: Number(error?.status ?? 0) === 429 || Number(error?.status ?? 0) === 503 || error?.retryable === true,
          providerHandle: item.fileId ?? item.interactionId ?? null,
          retryAfter: error?.retryAfter ?? null,
          seed: `${job.id}:${item.id}`,
        });
        item.recovery = decision.action === "retry-when-due" ? "retry_when_due"
          : decision.action === "recover-artifact" ? (item.fileId ? "retry_persist_only" : "attention_required")
            : decision.action === "reconcile" ? (item.fileId || item.interactionId ? "reconcile_by_handle" : "attention_required")
              : classifierState === "provider_rejected" ? "authorize_new_attempt"
                : classifierState === "pre_effect_failed" ? "resume_same_attempt"
                  : "attention_required";
        item.retryDueAt = decision.dueAt;
        event = appendEvent(job, item, "attempt_failed", {
          attemptId: item.attemptId,
          state: item.state,
          errorCode: normalized.code,
          recovery: item.recovery,
          retryDecision: decision.action,
          dueAt: decision.dueAt,
        });
      } finally {
        if (permit) concurrency.release(permit, { outcome: item.state });
        commitJob(stateDir, job, onProgress, event);
      }
    }
  };

  for (;;) {
    if (phases) {
      requeueDueRetries();
      queue = job.items.filter((item) => eligible(item) && (!item.nextObservationAt || Date.parse(item.nextObservationAt) <= Date.now()));
      cursor = 0;
    }
    if (phases) await phases.prepareRound?.(job);
    await Promise.all(Array.from({ length: Math.min(poolWidth, queue.length) }, worker));
    if (!phases) break;
    const retries = job.cancelRequested ? [] : job.items.filter((item) => item.recovery === "retry_when_due" && item.retryDueAt);
    const remaining = job.items.filter(eligible);
    if (!remaining.length && !retries.length) break;
    if (Date.now() - runStartedAt.getTime() >= Number(phases.timeoutMs ?? 900_000)) {
      for (const item of remaining) {
        if (item.state === "provider_pending") { item.state = "ambiguous"; item.recovery = "reconcile_by_handle"; }
      }
      commitJob(stateDir, job, onProgress, appendEvent(job, null, "remote_wait_budget_exhausted"));
      break;
    }
    const next = Math.min(...remaining.map((item) => Date.parse(item.nextObservationAt ?? now())), ...retries.map((item) => Date.parse(item.retryDueAt)));
    // O coordenador espera sem ocupar nenhuma lane ou sessão de adapter.
    if (next > Date.now()) await measureExecutionPhase("pending-wait", () => new Promise((resolve) => setTimeout(resolve, Math.min(1000, next - Date.now()))));
    queue = remaining.filter((item) => !item.nextObservationAt || Date.parse(item.nextObservationAt) <= Date.now());
    cursor = 0;
  }

  const concurrencyReport = concurrency?.report ? concurrency.report() : null;
  if (concurrencyReport) {
    appendEvent(job, null, "batch_concurrency_measured", {
      profile: concurrencyReport.profile,
      finalLimit: concurrencyReport.finalLimit,
      utilization: concurrencyReport.utilization,
      effectiveParallelism: concurrencyReport.effectiveParallelism,
      providerRejectionRate: concurrencyReport.providerRejectionRate,
      meanLatencyMs: concurrencyReport.latencyMs.mean,
    });
  }
  job.executionTiming = timing.snapshot();
  event = appendEvent(job, null, "batch_settled", { state: deriveBatchState(job), executionTiming: job.executionTiming });
  commitJob(stateDir, job, onProgress, event);
  return { ...summarizeBatchJob(job), ...(concurrencyReport ? { concurrency: concurrencyReport } : {}) };
}

export function requestBatchCancellation(job) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  job.cancelRequested = true;
  for (const item of job.items) {
    if (item.state === "pending" || item.state === "pre_submit_failed") {
      item.state = "cancelled";
      item.completedAt = now();
      item.recovery = null;
      appendEvent(job, item, "item_cancelled");
    }
  }
  appendEvent(job, null, "batch_cancellation_requested");
  job.state = deriveBatchState(job);
  job.updatedAt = now();
  return job;
}

export function reorderPendingItems(job, itemIds) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  if (!Array.isArray(itemIds)) throw new Error("itemIds deve ser uma lista.");
  const pending = job.items.filter((item) => item.state === "pending");
  const expected = new Set(pending.map((item) => item.id));
  if (itemIds.length !== expected.size || new Set(itemIds).size !== itemIds.length) {
    throw new Error("A reordenação deve conter cada item pending exatamente uma vez.");
  }
  for (const id of itemIds) if (!expected.has(id)) throw new Error(`Item não está pending: ${id}`);
  const ordered = itemIds.map((id) => pending.find((item) => item.id === id));
  let cursor = 0;
  job.items = job.items.map((item) => item.state === "pending" ? ordered[cursor++] : item);
  appendEvent(job, null, "pending_items_reordered", { itemIds });
  job.updatedAt = now();
  return job;
}

export function prepareBatchItemAction(job, itemId, action, { confirmHuman = false } = {}) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  const item = job.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Item não encontrado: ${itemId}`);

  if (action === "resume-pre-submit") {
    if (item.state !== "pre_submit_failed" || item.effectBoundaryReached !== false) {
      throw new Error("Somente falha comprovadamente anterior ao POST pode retomar a mesma tentativa.");
    }
    // Autoridade sobre entrada externa não sobrevive ao processo. Retomar por
    // aqui devolveria o item à fila sem permit, então só a reconfirmação
    // explícita de referências pode fazê-lo.
    if (item.recovery === "reauthorize_references") {
      throw new Error(
        "Item com referências exige nova confirmação humana de entrada externa antes de retomar.",
      );
    }
    item.state = "pending";
    item.error = null;
    item.recovery = null;
    item.completedAt = null;
    appendEvent(job, item, "pre_submit_resume_authorized", { attemptId: item.attemptId });
  } else if (action === "new-attempt") {
    if (item.state !== "provider_rejected") throw new Error("Nova tentativa só parte de rejeição terminal conhecida.");
    if (confirmHuman !== true) throw new Error("Nova tentativa exige confirmação humana explícita.");
    item.priorAttempts.push({
      attemptId: item.attemptId,
      attemptNumber: item.attemptNumber,
      state: item.state,
      completedAt: item.completedAt,
    });
    item.attemptId = `attempt:${randomUUID()}`;
    item.interactionId = null;
    item.fileId = null;
    item.effectBoundaryReached = false;
    item.state = "pending";
    item.error = null;
    item.recovery = null;
    item.startedAt = null;
    item.acceptedAt = null;
    item.completedAt = null;
    appendEvent(job, item, "new_attempt_authorized", {
      attemptId: item.attemptId,
      priorAttemptCount: item.priorAttempts.length,
    });
  } else {
    throw new Error(`Ação de item inválida: ${action}`);
  }

  job.cancelRequested = false;
  job.state = deriveBatchState(job);
  job.updatedAt = now();
  return item;
}

/**
 * Autoridade sobre entrada externa vive apenas no processo que a emitiu. Ao
 * retomar um lote persistido, todo item pendente com referências sem permit
 * vigente sai da fila e vira pendência humana explícita. Nunca um reenvio.
 */
export function suspendUnauthorizedReferenceItems(job, hasAuthority) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  if (typeof hasAuthority !== "function") throw new Error("hasAuthority é obrigatório.");
  const suspended = [];
  for (const item of job.items) {
    if (item.state !== "pending" || (item.references ?? []).length === 0) continue;
    if (hasAuthority(item.id) === true) continue;
    item.state = "pre_submit_failed";
    item.effectBoundaryReached = false;
    item.recovery = "reauthorize_references";
    item.error = {
      message: "Referências desta parte exigem nova confirmação humana antes de qualquer envio.",
      code: "reference_authority_expired",
    };
    item.completedAt = now();
    appendEvent(job, item, "reference_authority_expired", {
      referenceCount: item.references.length,
    });
    suspended.push(item.id);
  }
  if (suspended.length > 0) {
    job.state = deriveBatchState(job);
    job.updatedAt = now();
  }
  return suspended;
}

/**
 * Devolve à fila, de uma vez, os itens que aguardavam reconfirmação. Esta função
 * não emite permit e não sabe enviar nada: quem chama só pode chamá-la depois de
 * reemitir a autoridade para exatamente estes itens.
 */
export function authorizeReferenceReattempt(job, { confirmHuman = false, itemIds = null } = {}) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  if (confirmHuman !== true) {
    throw new Error("Reconfirmar referências exige confirmação humana explícita.");
  }
  const targets = job.items.filter((item) =>
    item.recovery === "reauthorize_references"
    && item.state === "pre_submit_failed"
    && (itemIds === null || itemIds.includes(item.id)));
  if (targets.length === 0) {
    throw new Error("Nenhum item aguarda reconfirmação de referências.");
  }
  for (const item of targets) {
    item.state = "pending";
    item.error = null;
    item.recovery = null;
    item.completedAt = null;
    appendEvent(job, item, "reference_reauthorized", {
      referenceCount: item.references.length,
    });
  }
  job.cancelRequested = false;
  job.state = deriveBatchState(job);
  job.updatedAt = now();
  return targets.map((item) => item.id);
}

export function applyBatchItemRecoveryResult(job, itemId, result = {}) {
  if (!job || job.schema !== BATCH_JOB_SCHEMA) throw new Error("Lote inválido.");
  const item = job.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Item não encontrado: ${itemId}`);
  const allowed = new Set([
    "provider_pending",
    "provider_rejected",
    "ambiguous",
    "persisting",
    "local_persist_failed",
    "completed",
  ]);
  if (!allowed.has(result.state)) throw new Error(`Resultado de recuperação inválido: ${result.state}`);

  item.state = result.state;
  if (result.effectBoundaryReached != null) item.effectBoundaryReached = result.effectBoundaryReached;
  if (result.fileId != null) item.fileId = result.fileId;
  if (result.interactionId != null) item.interactionId = result.interactionId;
  if (result.relPath != null) item.relPath = result.relPath;
  if (result.receiptId != null) item.receiptId = result.receiptId;
  item.recovery = result.recovery ?? (
    result.state === "provider_pending" ? "reconcile_by_handle"
      : result.state === "provider_rejected" ? "authorize_new_attempt"
        : result.state === "ambiguous" ? "attention_required"
          : result.state === "local_persist_failed" ? "retry_persist_only"
            : null
  );
  item.error = result.error ? safeError(result.error) : null;
  if (result.state === "completed" || result.state === "provider_rejected") item.completedAt = now();
  appendEvent(job, item, result.eventType ?? "recovery_result_recorded", {
    attemptId: item.attemptId,
    state: item.state,
    recovery: item.recovery,
    fileId: item.fileId,
    receiptId: item.receiptId,
  });
  job.state = deriveBatchState(job);
  job.updatedAt = now();
  return item;
}

export const BATCH_PRUNE_SCHEMA = "mkt-videos/batch-prune-report@1";

/**
 * Estados em que um lote acabou: não há o que retomar, e o arquivo de estado
 * vira só histórico. `pending` fica de fora de propósito — um lote parado no
 * meio ainda pode ser retomado, e apagar o estado dele seria perder a única
 * memória de que ele existiu.
 */
const ESTADOS_TERMINAIS = new Set(["completed", "cancelled", "completed_with_failures"]);

/**
 * Lista (e opcionalmente apaga) os arquivos de estado de lotes já encerrados.
 *
 * Só remove o registro do lote em `.batches/`; nenhum vídeo, recibo ou coleção
 * é tocado. Dry-run por padrão, como o resto do estúdio: quem apaga precisa
 * dizer que quer apagar.
 */
export function pruneBatchJobs(stateDir, { olderThanDays = 30, dryRun = true, states = ESTADOS_TERMINAIS } = {}) {
  const dias = Number(olderThanDays);
  if (!Number.isFinite(dias) || dias < 0) throw new Error("olderThanDays deve ser um número >= 0.");
  const corte = Date.now() - dias * 86_400_000;

  const podados = [];
  const mantidos = [];
  for (const resumo of listBatchJobs(stateDir)) {
    const criadoEm = Date.parse(resumo.createdAt);
    const terminal = states.has(resumo.state);
    const velho = Number.isFinite(criadoEm) && criadoEm < corte;
    const alvo = terminal && velho;
    const registro = {
      id: resumo.id,
      collection: resumo.collection,
      state: resumo.state,
      createdAt: resumo.createdAt,
      motivo: alvo ? "encerrado e antigo" : !terminal ? `estado ${resumo.state} pode ser retomado` : "recente demais",
    };
    if (!alvo) { mantidos.push(registro); continue; }
    if (!dryRun) {
      try { fs.unlinkSync(batchStateFile(stateDir, resumo.id)); } catch { /* já não estava lá */ }
    }
    podados.push(registro);
  }

  return {
    schema: BATCH_PRUNE_SCHEMA,
    stateDir,
    olderThanDays: dias,
    dryRun,
    podados,
    mantidos,
    total: podados.length + mantidos.length,
    providerCalls: 0,
  };
}
