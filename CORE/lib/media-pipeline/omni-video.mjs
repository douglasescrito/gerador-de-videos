import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createArtifactFromFile, createArtifactFromKnownFile, inferMimeType, sha256Buffer } from "./artifact.mjs";
import { clockValue, normalizeEndpoint, requireFetch, requireText, responseJson } from "./http.mjs";
import { receiptPathForArtifact, writeReceipt } from "./receipt.mjs";
import { createStageReceipt } from "./pipeline-operation.mjs";
import { consumeExecutionEffectAuthorization } from "./execution-journal.mjs";

const DEFAULT_SLEEP = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SUCCESS_STATES = new Set(["ACTIVE", "COMPLETED", "SUCCEEDED"]);
const FAILURE_STATES = new Set(["FAILED", "CANCELLED", "CANCELED", "ERROR"]);
const PENDING_STATES = new Set(["PROCESSING", "PENDING", "QUEUED", "RUNNING"]);
const ACCEPTED_MP4_CONTENT_TYPES = new Set(["video/mp4", "application/mp4", "application/octet-stream"]);
const MP4_HEADER_BYTES = 64;
const MINIMUM_LOCK_LEASE_MS = 60_000;
const MALFORMED_LOCK_STALE_MS = 24 * 60 * 60 * 1_000;
const LOCK_SCHEMA = "mkt-videos/output-lock@1";
const VIDEO_TIMINGS_SCHEMA = "mkt-videos/video-timings@1";
const VIDEO_PROGRESS_SCHEMA = "mkt-videos/video-progress@1";
export const OMNI_RECONCILE_SCHEMA = "mkt-videos/omni-reconcile@1";

export const OMNI_VIDEO_TASKS = new Set(["text_to_video", "image_to_video", "reference_to_video", "edit"]);
export const OMNI_ASPECT_RATIOS = new Set(["16:9", "9:16"]);
export const OMNI_AUTO_TASK = "auto";

function expiredByEvidence(expirationTime, nowMs) {
  const expires = Date.parse(String(expirationTime ?? ""));
  return Number.isFinite(expires) && expires <= nowMs;
}

export function classifyOmniRemoteState({ httpStatus = 200, state = "UNKNOWN", expirationTime = null, nowMs = Date.now() } = {}) {
  const normalized = String(state ?? "UNKNOWN").toUpperCase();
  if (httpStatus === 401 || httpStatus === 403) return "auth_or_scope_mismatch";
  if (httpStatus === 404 || httpStatus === 410) return expiredByEvidence(expirationTime, nowMs) ? "remote_expired" : "remote_not_found";
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return "upstream_unreachable";
  if (httpStatus < 200 || httpStatus >= 300) return "unknown_state";
  if (SUCCESS_STATES.has(normalized)) return "ready";
  if (FAILURE_STATES.has(normalized)) return "provider_failed";
  if (PENDING_STATES.has(normalized)) return "provider_pending";
  return "unknown_state";
}

function roundMilliseconds(value) {
  return Number(Math.max(0, value).toFixed(3));
}

function safelyReportProgress(onProgress, event) {
  if (typeof onProgress !== "function") return;
  try {
    const pending = onProgress(event);
    if (pending && typeof pending.then === "function") pending.catch(() => {});
  } catch {
    // Observability is best-effort and must never change the generation result.
  }
}

function createVideoTimingTracker({ monotonicNow, clock, onProgress }) {
  const points = Object.create(null);
  const statusTimeline = [];
  let lastMonotonic = -Infinity;

  function readMonotonic() {
    const value = Number(monotonicNow());
    if (!Number.isFinite(value)) throw new Error("monotonicNow deve retornar um número finito.");
    if (value < lastMonotonic) throw new Error("monotonicNow deve ser monotônico.");
    lastMonotonic = value;
    return value;
  }

  function mark(name) {
    const point = { monotonic: readMonotonic(), at: clockValue(clock) };
    points[name] = point;
    return point;
  }

  function duration(start, end) {
    if (!points[start] || !points[end]) return null;
    return roundMilliseconds(points[end].monotonic - points[start].monotonic);
  }

  function elapsed(point) {
    return roundMilliseconds(point.monotonic - points.operationStarted.monotonic);
  }

  function emit(event, details = {}, point = mark(event)) {
    safelyReportProgress(onProgress, {
      schema: VIDEO_PROGRESS_SCHEMA,
      event,
      at: point.at,
      elapsedMs: elapsed(point),
      ...details,
    });
    return point;
  }

  function snapshot() {
    const timings = {
      schema: VIDEO_TIMINGS_SCHEMA,
      unit: "milliseconds",
      operationStartedAt: points.operationStarted.at,
      polls: statusTimeline.length,
      statusTimeline: structuredClone(statusTimeline),
    };
    const timestamps = [
      ["postStartedAt", "post_started"],
      ["providerAcceptedAt", "post_accepted"],
      ["handlePersistedAt", "handle_persisted"],
      ["providerReadyAt", "provider_ready"],
      ["downloadStartedAt", "download_started"],
      ["downloadCompletedAt", "download_completed"],
      ["videoCommittedAt", "committed"],
      ["completedAt", "receipt_written"],
    ];
    for (const [field, point] of timestamps) {
      if (points[point]) timings[field] = points[point].at;
    }
    const durations = [
      ["preparationMs", "operationStarted", "post_started"],
      ["requestMs", "post_started", "post_accepted"],
      ["handlePersistenceMs", "post_accepted", "handle_persisted"],
      ["providerProcessingMs", "post_accepted", "provider_ready"],
      ["providerMs", "post_started", "provider_ready"],
      ["downloadMs", "download_started", "download_completed"],
      ["artifactCommitMs", "download_completed", "committed"],
      ["receiptMs", "committed", "receipt_written"],
      ["localFinalizeMs", "download_completed", "receipt_written"],
      ["videoDeliveryMs", "operationStarted", "committed"],
      ["totalMs", "operationStarted", "receipt_written"],
    ];
    for (const [field, start, end] of durations) {
      const value = duration(start, end);
      if (value !== null) timings[field] = value;
    }
    return timings;
  }

  mark("operationStarted");
  return {
    get operationStartedAt() { return points.operationStarted.at; },
    emit,
    poll(state, poll) {
      const point = mark("provider_poll");
      const entry = { poll, state, at: point.at, elapsedMs: elapsed(point) };
      statusTimeline.push(entry);
      safelyReportProgress(onProgress, {
        schema: VIDEO_PROGRESS_SCHEMA,
        event: "provider_poll",
        at: point.at,
        elapsedMs: entry.elapsedMs,
        poll,
        state,
      });
      return point;
    },
    providerReady(point, state) {
      points.provider_ready = point;
      safelyReportProgress(onProgress, {
        schema: VIDEO_PROGRESS_SCHEMA,
        event: "provider_ready",
        at: point.at,
        elapsedMs: elapsed(point),
        polls: statusTimeline.length,
        state,
      });
    },
    pointAt(name) { return points[name]?.at ?? null; },
    snapshot,
  };
}

function attachPartialTimings(error, timing) {
  const timings = timing.snapshot();
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      error.timings = timings;
      return error;
    } catch {
      // Fall through to a writable Error wrapper.
    }
  }
  const wrapped = new Error(error?.message ?? String(error), { cause: error });
  wrapped.timings = timings;
  return wrapped;
}

async function assertDestinationsAbsent(destinations) {
  for (const { file, label } of destinations) {
    try {
      await lstat(file);
      throw new Error(`${label} já existe e não será sobrescrito: ${file}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function releaseDestinationLocks(locks) {
  let cleanupError = null;
  for (const lock of [...locks].reverse()) {
    await lock.handle.close().catch(() => {});
    try {
      const current = JSON.parse(await readFile(lock.file, "utf8"));
      if (current?.lockId === lock.lockId) await rm(lock.file, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) cleanupError ??= error;
    }
  }
  if (cleanupError) throw cleanupError;
}

function ownerProcessExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    return null;
  }
}

async function recoverOrphanedLock(lockFile) {
  let snapshot;
  let info;
  try {
    [snapshot, info] = await Promise.all([readFile(lockFile, "utf8"), lstat(lockFile)]);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  let record = null;
  try {
    record = JSON.parse(snapshot);
  } catch {
    // A lock whose owner crashed before writing metadata is recoverable only
    // after a conservative age threshold based on the filesystem timestamp.
  }
  const now = Date.now();
  const validRecord = record?.schema === LOCK_SCHEMA
    && typeof record?.lockId === "string"
    && Number.isSafeInteger(record?.pid)
    && Number.isFinite(Date.parse(record?.createdAt))
    && Number.isFinite(Date.parse(record?.expiresAt));
  const expired = validRecord && Date.parse(record.expiresAt) <= now;
  const processExists = validRecord ? ownerProcessExists(record.pid) : null;
  const ownerGone = processExists === false;
  const expiredWithoutLiveOwner = expired && processExists !== true;
  const malformedAndOld = !validRecord && now - info.mtimeMs >= MALFORMED_LOCK_STALE_MS;
  if (!expiredWithoutLiveOwner && !ownerGone && !malformedAndOld) return false;

  // Re-read before the atomic rename so a freshly replaced lock is not
  // intentionally classified using stale metadata from the prior owner.
  let current;
  try {
    current = await readFile(lockFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (current !== snapshot) return false;
  const orphan = `${lockFile}.${process.pid}.${randomUUID()}.orphan`;
  try {
    await rename(lockFile, orphan);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  await rm(orphan, { force: true });
  return true;
}

// Dois caminhos diferentes podem apontar para o MESMO arquivo: junction,
// symlink, unidade mapeada, ou só caixa diferente no Windows. Sem resolver
// isso, cada alias cria o próprio lock e duas gerações escrevem no mesmo
// destino achando que estão sozinhas. realpath devolve o caminho canônico
// — inclusive a caixa real gravada no volume.
async function canonicalDestination(file) {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  await mkdir(directory, { recursive: true });
  try {
    return path.join(await realpath(directory), path.basename(absolute));
  } catch {
    // Diretório recém-criado que o SO ainda não resolve não deve derrubar a
    // geração; o caminho absoluto continua sendo um identificador válido.
    return absolute;
  }
}

async function acquireDestinationLocks(destinations, { leaseMs } = {}) {
  const locks = [];
  try {
    const canonical = await Promise.all(destinations.map(({ file }) => canonicalDestination(file)));
    const files = [...new Set(canonical)].sort();
    for (const file of files) {
      const lockFile = path.join(path.dirname(file), `.${path.basename(file)}.omni.lock`);
      while (true) {
        try {
          const handle = await open(lockFile, "wx");
          const lockId = randomUUID();
          const createdAt = new Date();
          const expiresAt = new Date(createdAt.getTime() + Math.max(MINIMUM_LOCK_LEASE_MS, Number(leaseMs) || 0));
          const record = {
            schema: LOCK_SCHEMA,
            lockId,
            pid: process.pid,
            createdAt: createdAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            target: file,
          };
          try {
            await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
            await handle.sync();
          } catch (error) {
            await handle.close().catch(() => {});
            await rm(lockFile, { force: true }).catch(() => {});
            throw error;
          }
          locks.push({ file: lockFile, handle, lockId });
          break;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          if (await recoverOrphanedLock(lockFile)) continue;
          throw new Error(`Destino em uso por outra geração: ${file}`);
        }
      }
    }
    return locks;
  } catch (error) {
    await releaseDestinationLocks(locks);
    throw error;
  }
}

function temporaryVideoPath(target) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
}

function normalizedContentType(response) {
  return String(response.headers?.get?.("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function declaredContentLength(response) {
  const value = response.headers?.get?.("content-length");
  if (value == null || value === "") return null;
  if (!/^\d+$/.test(value)) throw new Error(`Content-Length inválido no download do Gemini Omni: ${value}.`);
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new Error(`Content-Length inválido no download do Gemini Omni: ${value}.`);
  return length;
}

function assertMp4Container(header, bytes) {
  if (bytes === 0) throw new Error("Gemini Omni retornou um vídeo vazio.");
  if (bytes < 12 || header.length < 12) throw new Error("Gemini Omni retornou conteúdo curto demais para ser um MP4 válido.");
  const boxType = header.toString("ascii", 4, 8);
  if (boxType !== "ftyp") throw new Error("Gemini Omni retornou conteúdo sem a assinatura ftyp de um MP4 válido.");

  const compactSize = header.readUInt32BE(0);
  let boxSize = BigInt(compactSize);
  let brandOffset = 8;
  if (compactSize === 1) {
    if (header.length < 20) throw new Error("Gemini Omni retornou um cabeçalho MP4 estendido incompleto.");
    boxSize = header.readBigUInt64BE(8);
    brandOffset = 16;
    if (boxSize < 20n) throw new Error("Gemini Omni retornou uma caixa ftyp MP4 com tamanho inválido.");
  } else if (compactSize !== 0 && compactSize < 12) {
    throw new Error("Gemini Omni retornou uma caixa ftyp MP4 com tamanho inválido.");
  }
  if (boxSize !== 0n && boxSize > BigInt(bytes)) throw new Error("Gemini Omni retornou uma caixa ftyp MP4 truncada.");

  const majorBrand = header.toString("ascii", brandOffset, brandOffset + 4);
  if (majorBrand.length !== 4 || !/^[\x20-\x7e]{4}$/.test(majorBrand)) {
    throw new Error("Gemini Omni retornou uma marca principal MP4 inválida.");
  }
}

async function responseBodyStream(response) {
  if (response.body && typeof response.body.getReader === "function") return Readable.fromWeb(response.body);
  if (response.body && typeof response.body[Symbol.asyncIterator] === "function") return Readable.from(response.body);
  if (typeof response.arrayBuffer === "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    return Readable.from([buffer]);
  }
  throw new Error("Download do Gemini Omni não retornou um corpo legível.");
}

async function streamMp4ToTemporary(response, temporary, { signal } = {}) {
  const contentType = normalizedContentType(response);
  if (!ACCEPTED_MP4_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Download do Gemini Omni retornou Content-Type incompatível com MP4: ${contentType || "ausente"}.`);
  }
  const expectedBytes = declaredContentLength(response);
  if (expectedBytes === 0) throw new Error("Gemini Omni retornou um vídeo vazio.");

  const hash = createHash("sha256");
  let bytes = 0;
  let header = Buffer.alloc(0);
  const inspector = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
      if (header.length < MP4_HEADER_BYTES) {
        const take = Math.min(MP4_HEADER_BYTES - header.length, buffer.length);
        header = Buffer.concat([header, buffer.subarray(0, take)]);
      }
      callback(null, buffer);
    },
  });

  const source = await responseBodyStream(response);
  try {
    await pipeline(source, inspector, createWriteStream(temporary, { flags: "wx" }), { signal });
  } catch (error) {
    throw new Error(`Falha durante o stream do vídeo Gemini Omni: ${error?.message ?? error}`, { cause: error });
  }
  if (expectedBytes !== null && bytes !== expectedBytes) {
    throw new Error(`Download do Gemini Omni foi truncado: esperado ${expectedBytes} bytes, recebido ${bytes}.`);
  }
  assertMp4Container(header, bytes);
  return { bytes, digest: hash.digest("hex"), mimeType: "video/mp4" };
}

async function encodeImage(value, role) {
  if (typeof value === "string") {
    const file = path.resolve(value);
    const data = await readFile(file);
    const artifact = await createArtifactFromFile({ file, kind: "image", role });
    return { request: { data: data.toString("base64"), mimeType: artifact.mimeType }, artifact };
  }
  if (value?.file) return encodeImage(value.file, value.role ?? role);
  if (typeof value?.data === "string" && value?.mimeType) {
    const buffer = Buffer.from(value.data, "base64");
    return {
      request: { data: value.data, mimeType: value.mimeType },
      artifact: {
        kind: "image-data",
        role,
        mimeType: value.mimeType,
        bytes: buffer.length,
        hash: { algorithm: "sha256", value: sha256Buffer(buffer) },
      },
    };
  }
  throw new Error(`Imagem ${role} inválida; informe um caminho de arquivo ou data/mimeType.`);
}

async function encodeImages(values, role) {
  const encoded = await Promise.all((values ?? []).map((value, index) => encodeImage(value, typeof role === "function" ? role(index, value) : role)));
  return {
    request: encoded.map((entry) => entry.request),
    artifacts: encoded.map((entry) => entry.artifact),
  };
}

async function encodeVideo(value, role) {
  const file = path.resolve(typeof value === "string" ? value : requireText(value?.file, "arquivo de vídeo"));
  const data = await readFile(file);
  const artifact = await createArtifactFromFile({ file, kind: "video", role, mimeType: inferMimeType(file, "video/mp4") });
  return { request: { data: data.toString("base64"), mimeType: artifact.mimeType }, artifact };
}

function normalizeState(payload) {
  return String(payload?.state ?? payload?.status ?? "UNKNOWN").toUpperCase();
}

function providerFailureDetail(payload) {
  const candidate = payload?.error ?? payload?.message ?? payload?.details;
  if (!candidate) return "";
  if (typeof candidate === "string") return candidate;
  if (candidate?.message) return String(candidate.message);
  return JSON.stringify(candidate);
}

function assertTask(task) {
  if (task === OMNI_AUTO_TASK) return null;
  if (task !== null && task !== undefined && !OMNI_VIDEO_TASKS.has(task)) {
    throw new Error(`Task inválida: ${task}. Use ${OMNI_AUTO_TASK} ou ${[...OMNI_VIDEO_TASKS].join(", ")}.`);
  }
  return task ?? null;
}

function assertAspectRatio(aspectRatio) {
  if (aspectRatio !== null && aspectRatio !== undefined && !OMNI_ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(`Aspecto inválido: ${aspectRatio}. Use ${[...OMNI_ASPECT_RATIOS].join(", ")}.`);
  }
  return aspectRatio ?? null;
}

function assertInputs(task, images, referenceVideo) {
  const count = images.length;
  if (count > 4) throw new Error("O Gemini Omni aceita no máximo quatro imagens de referência neste CLI.");
  if (task === "text_to_video" && (count || referenceVideo)) throw new Error("text_to_video não aceita imagem nem vídeo de referência.");
  if (task === "image_to_video" && (count < 1 || count > 2 || referenceVideo)) throw new Error("image_to_video exige uma ou duas imagens e não aceita vídeo de referência.");
  if (task === "reference_to_video" && (count < 1 || referenceVideo)) throw new Error("reference_to_video exige pelo menos uma imagem e não aceita vídeo de referência.");
  if (task === "edit" && (!referenceVideo || count)) throw new Error("edit exige exatamente um vídeo e não aceita imagens adicionais.");
}

export function createOmniVideoEndpointAdapter({
  endpoint = "http://127.0.0.1:3000",
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  now = () => Date.now(),
  monotonicNow = () => performance.now(),
  sleep = DEFAULT_SLEEP,
  generateRoute = "/api/generate-video",
  editRoute = "/api/edit-video",
  statusRoute = (fileId) => `/api/file-status/${encodeURIComponent(fileId)}`,
  downloadRoute = (fileId) => `/api/video/${encodeURIComponent(fileId)}`,
  attemptRoute = (attemptId) => `/api/attempts/${encodeURIComponent(attemptId)}`,
} = {}) {
  const baseUrl = normalizeEndpoint(endpoint);
  const request = requireFetch(fetchImpl);
  if (typeof sleep !== "function" || typeof now !== "function" || typeof monotonicNow !== "function") {
    throw new Error("sleep, now e monotonicNow devem ser funções.");
  }

  async function runVideoJob({
    route,
    body,
    operation,
    prompt,
    model,
    parameters,
    inputs,
    metadata,
    outputFile,
    timeoutMs,
    pollIntervalMs,
    receiptFile,
    timing,
    attemptId,
    onProviderHandle,
  }) {
    const target = path.resolve(requireText(outputFile, "outputFile"));
    const receiptTarget = path.resolve(receiptFile ?? receiptPathForArtifact(target));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs deve ser positivo.");
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) throw new Error("pollIntervalMs não pode ser negativo.");
    const destinations = [
      { file: target, label: "Arquivo de saída" },
      { file: receiptTarget, label: "Recibo de saída" },
    ];
    const locks = await acquireDestinationLocks(destinations, { leaseMs: timeoutMs + MINIMUM_LOCK_LEASE_MS });
    let temporary = null;
    let outputCommitted = false;
    let receiptCommitted = false;
    try {
      await assertDestinationsAbsent(destinations);
      const deadline = now() + timeoutMs;
      async function requestBeforeDeadline(url, init, phase) {
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error(`Tempo excedido durante ${phase} (${timeoutMs} ms).`);
        const controller = new AbortController();
        let timer;
        try {
          return await Promise.race([
            request(url, { ...init, signal: controller.signal }),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error(`Tempo excedido durante ${phase} (${timeoutMs} ms).`));
              }, remaining);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      timing.emit("post_started");
      const generationResponse = await requestBeforeDeadline(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, "a solicitação de geração");
      const generation = await responseJson(generationResponse, "Gemini Omni");
      const fileId = requireText(generation.fileId, "fileId retornado pelo Gemini Omni");
      timing.emit("post_accepted");
      const providerHandle = {
        provider: "gemini-omni-video-endpoint",
        operation,
        attemptId,
        fileId,
        interactionId: generation.interactionId ?? null,
        requestId: generation.requestId ?? null,
        acceptedAt: clockValue(clock),
        expirationTime: generation.expirationTime ?? null,
        createTime: generation.createTime ?? null,
        updateTime: generation.updateTime ?? null,
      };
      if (typeof onProviderHandle === "function") await onProviderHandle(providerHandle);
      timing.emit("handle_persisted", { attemptId, fileId });
      const statusHistory = [];

      while (true) {
        const statusResponse = await requestBeforeDeadline(`${baseUrl}${statusRoute(fileId)}`, {}, "a consulta de status");
        const statusPayload = await responseJson(statusResponse, "Status do Gemini Omni");
        const state = normalizeState(statusPayload);
        statusHistory.push(state);
        const pollPoint = timing.poll(state, statusHistory.length);
        if (SUCCESS_STATES.has(state)) {
          timing.providerReady(pollPoint, state);
          break;
        }
        if (FAILURE_STATES.has(state)) {
          const detail = providerFailureDetail(statusPayload);
          throw new Error(`Gemini Omni finalizou com estado ${state}${detail ? `: ${detail}` : "."}`);
        }
        if (now() >= deadline) throw new Error(`Tempo excedido aguardando o vídeo (${timeoutMs} ms).`);
        await sleep(pollIntervalMs);
      }

      timing.emit("download_started");
      const download = await requestBeforeDeadline(`${baseUrl}${downloadRoute(fileId)}`, {}, "o download do vídeo");
      if (!download.ok) {
        const detail = typeof download.text === "function" ? await download.text().catch(() => "") : "";
        throw new Error(`Download do Gemini Omni: HTTP ${download.status}${detail ? `: ${detail}` : "."}`);
      }
      temporary = temporaryVideoPath(target);
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`Tempo excedido durante o stream do vídeo (${timeoutMs} ms).`);
      const streamController = new AbortController();
      const streamTimer = setTimeout(() => streamController.abort(), remaining);
      let transferred;
      try {
        transferred = await streamMp4ToTemporary(download, temporary, { signal: streamController.signal });
      } catch (error) {
        if (streamController.signal.aborted) throw new Error(`Tempo excedido durante o stream do vídeo (${timeoutMs} ms).`, { cause: error });
        throw error;
      } finally {
        clearTimeout(streamTimer);
      }
      timing.emit("download_completed", { bytes: transferred.bytes });

      await assertDestinationsAbsent(destinations);
      await rename(temporary, target);
      temporary = null;
      outputCommitted = true;
      const artifact = await createArtifactFromKnownFile({
        file: target,
        kind: "video",
        role: "generated-video",
        mimeType: transferred.mimeType,
        bytes: transferred.bytes,
        digest: transferred.digest,
        source: { provider: "gemini-omni-video-endpoint", model: generation.model ?? model, fileId },
        metadata,
        createdAt: clockValue(clock),
      });
      timing.emit("committed", { bytes: transferred.bytes });
      const receiptTimings = timing.snapshot();
      const receipt = createStageReceipt({
        operation,
        provider: "gemini-omni-video-endpoint",
        model: generation.model ?? model,
        mode: metadata.mode ?? "raw",
        stage: metadata.pipeline?.stage ?? "omni-video",
        prompt,
        parameters: { ...parameters, attemptId, timeoutMs, pollIntervalMs },
        inputs,
        artifacts: [artifact],
        providerResponse: {
          requestId: generation.requestId ?? null,
          interactionId: generation.interactionId ?? null,
          fileId,
          attemptId,
          finalState: statusHistory.at(-1),
          polls: statusHistory.length,
          usageMetadata: generation.usageMetadata ?? generation.usage_metadata ?? generation.usage ?? generation.tokenUsage ?? null,
        },
        metadata,
        parentReceipts: metadata.pipeline?.parentReceiptIds ?? [],
        timings: receiptTimings,
        startedAt: timing.operationStartedAt,
        completedAt: timing.pointAt("committed"),
      });
      await assertDestinationsAbsent([{ file: receiptTarget, label: "Recibo de saída" }]);
      const writtenReceipt = await writeReceipt(receiptTarget, receipt);
      receiptCommitted = true;
      timing.emit("receipt_written");
      return {
        file: target,
        artifact,
        receipt,
        receiptFile: writtenReceipt,
        fileId,
        attemptId,
        interactionId: generation.interactionId ?? null,
        statusHistory,
        timings: timing.snapshot(),
      };
    } catch (error) {
      if (outputCommitted && !receiptCommitted) {
        await Promise.all([
          rm(target, { force: true }),
          rm(receiptTarget, { force: true }),
        ]);
      }
      throw error;
    } finally {
      if (temporary) await rm(temporary, { force: true });
      await releaseDestinationLocks(locks);
    }
  }

  async function getWithin(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await request(url, { method: "GET", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function reconcile({
    fileId = null,
    attemptId = null,
    expirationTime = null,
    outputFile = null,
    receiptFile = null,
    model = "gemini-omni-flash-preview",
    metadata = {},
    timeoutMs = 120_000,
  } = {}) {
    const startedAt = clockValue(clock);
    let resolvedFileId = fileId == null ? null : requireText(fileId, "fileId");
    const normalizedAttemptId = attemptId == null ? null : requireText(attemptId, "attemptId");
    let knownExpiration = expirationTime;
    let attempt = null;
    const baseResult = (classification, details = {}) => ({
      schema: OMNI_RECONCILE_SCHEMA,
      classification,
      zeroPost: true,
      attemptId: normalizedAttemptId,
      fileId: resolvedFileId,
      checkedAt: clockValue(clock),
      expirationTime: knownExpiration ?? null,
      ...details,
    });
    if (!resolvedFileId && !normalizedAttemptId) return baseResult("missing_handle", { nextAction: "Intervenção manual; nenhuma repetição automática é autorizada." });
    if (!resolvedFileId && normalizedAttemptId) {
      let response;
      try {
        response = await getWithin(`${baseUrl}${attemptRoute(normalizedAttemptId)}`, timeoutMs);
      } catch (error) {
        return baseResult("upstream_unreachable", { error: error?.message ?? String(error), nextAction: "Repetir somente a consulta GET quando o app estiver acessível." });
      }
      if (!response.ok) {
        if (response.status === 404) return baseResult("missing_handle", { httpStatus: 404, nextAction: "Localizar o handle manualmente; não repetir o POST." });
        const classification = classifyOmniRemoteState({ httpStatus: response.status, expirationTime: knownExpiration, nowMs: now() });
        return baseResult(classification, { httpStatus: response.status, nextAction: "Corrigir o acesso e repetir somente a consulta GET." });
      }
      attempt = await response.json().catch(() => ({}));
      resolvedFileId = attempt?.fileId ? requireText(attempt.fileId, "fileId do ledger") : null;
      knownExpiration = attempt?.expirationTime ?? knownExpiration;
      if (!resolvedFileId) return baseResult("missing_handle", { attemptState: attempt?.state ?? null, nextAction: "O ledger não contém fileId; não repetir o POST." });
    }

    let statusResponse;
    try {
      statusResponse = await getWithin(`${baseUrl}${statusRoute(resolvedFileId)}`, timeoutMs);
    } catch (error) {
      return baseResult("upstream_unreachable", { error: error?.message ?? String(error), nextAction: "Repetir somente a consulta GET quando o app estiver acessível." });
    }
    if (!statusResponse.ok) {
      const classification = classifyOmniRemoteState({ httpStatus: statusResponse.status, expirationTime: knownExpiration, nowMs: now() });
      return baseResult(classification, {
        httpStatus: statusResponse.status,
        nextAction: classification === "auth_or_scope_mismatch" ? "Corrigir credencial/escopo e repetir somente o GET." : "Recuperação automática encerrada; um novo POST exige autorização humana.",
      });
    }
    const statusPayload = await statusResponse.json().catch(() => ({}));
    knownExpiration = statusPayload.expirationTime ?? knownExpiration;
    const state = normalizeState(statusPayload);
    const classification = classifyOmniRemoteState({ state, expirationTime: knownExpiration, nowMs: now() });
    if (classification !== "ready") {
      return baseResult(classification, {
        state,
        status: statusPayload,
        nextAction: classification === "provider_pending"
          ? "Consultar novamente por GET antes do expirationTime."
          : classification === "auth_or_scope_mismatch" || classification === "upstream_unreachable"
            ? "Corrigir a condição e repetir somente o GET."
            : "Nenhum novo POST é autorizado automaticamente.",
      });
    }
    if (!outputFile) return baseResult("ready", { state, status: statusPayload, downloadRequired: true, nextAction: "Informe outputFile para baixar e publicar o artefato sem novo POST." });

    const target = path.resolve(requireText(outputFile, "outputFile"));
    const receiptTarget = path.resolve(receiptFile ?? receiptPathForArtifact(target));
    const destinations = [{ file: target, label: "Arquivo de saída" }, { file: receiptTarget, label: "Recibo de saída" }];
    const locks = await acquireDestinationLocks(destinations, { leaseMs: timeoutMs + MINIMUM_LOCK_LEASE_MS });
    let temporary = null;
    let outputCommitted = false;
    let receiptCommitted = false;
    try {
      await assertDestinationsAbsent(destinations);
      let download;
      try {
        download = await getWithin(`${baseUrl}${downloadRoute(resolvedFileId)}`, timeoutMs);
      } catch (error) {
        return baseResult("upstream_unreachable", { state, error: error?.message ?? String(error), nextAction: "Repetir somente o GET/download." });
      }
      if (!download.ok) {
        const downloadClassification = classifyOmniRemoteState({ httpStatus: download.status, expirationTime: knownExpiration, nowMs: now() });
        return baseResult(downloadClassification, { state, httpStatus: download.status, phase: "download", nextAction: "Nenhum novo POST é autorizado automaticamente." });
      }
      temporary = temporaryVideoPath(target);
      const transferred = await streamMp4ToTemporary(download, temporary);
      await assertDestinationsAbsent(destinations);
      await rename(temporary, target);
      temporary = null;
      outputCommitted = true;
      const completedAt = clockValue(clock);
      const artifact = await createArtifactFromKnownFile({
        file: target,
        kind: "video",
        role: "reconciled-video",
        mimeType: transferred.mimeType,
        bytes: transferred.bytes,
        digest: transferred.digest,
        source: { provider: "gemini-omni-video-endpoint", model, fileId: resolvedFileId },
        metadata: { ...metadata, reconciliation: true },
        createdAt: completedAt,
      });
      const receipt = createStageReceipt({
        operation: "reconcile-video",
        provider: "gemini-omni-video-endpoint",
        model,
        mode: metadata.mode ?? "studio",
        stage: metadata.pipeline?.stage ?? "omni-video-reconcile",
        parameters: { attemptId: normalizedAttemptId, zeroPost: true },
        inputs: [],
        artifacts: [artifact],
        providerResponse: { attemptId: normalizedAttemptId, fileId: resolvedFileId, finalState: state, expirationTime: knownExpiration, status: statusPayload },
        metadata: { ...metadata, reconciliation: { classification: "ready", zeroPost: true } },
        parentReceipts: metadata.pipeline?.parentReceiptIds ?? [],
        startedAt,
        completedAt,
      });
      const writtenReceipt = await writeReceipt(receiptTarget, receipt);
      receiptCommitted = true;
      return baseResult("ready", { state, status: statusPayload, file: target, artifact, receipt, receiptFile: writtenReceipt, nextAction: "Artefato recuperado e publicado." });
    } catch (error) {
      if (outputCommitted && !receiptCommitted) await Promise.all([rm(target, { force: true }), rm(receiptTarget, { force: true })]);
      throw error;
    } finally {
      if (temporary) await rm(temporary, { force: true });
      await releaseDestinationLocks(locks);
    }
  }

  return {
    id: "gemini-omni-video-endpoint",
    kind: "video",
    reconcile,
    async generate({
      prompt,
      outputFile,
      images = [],
      referenceVideo = null,
      task = null,
      aspectRatio = null,
      model = null,
      parameters = {},
      metadata = {},
      timeoutMs = 360_000,
      pollIntervalMs = 5_000,
      receiptFile = null,
      onProgress = null,
      attemptId = randomUUID(),
      onProviderHandle = null,
      executionEffectAuthorization = null,
    } = {}) {
      const normalizedPrompt = requireText(prompt, "prompt");
      const normalizedAttemptId = requireText(attemptId, "attemptId");
      const normalizedTask = assertTask(task);
      const normalizedAspect = assertAspectRatio(aspectRatio);
      assertInputs(normalizedTask, images, referenceVideo);
      if (metadata.executionKernel === "required") {
        consumeExecutionEffectAuthorization(executionEffectAuthorization, {
          provider: "gemini-omni",
          operation: normalizedTask
            ? normalizedTask.replaceAll("_", "-")
            : "video-generate",
          attemptId: normalizedAttemptId,
        });
      }
      const timing = createVideoTimingTracker({ monotonicNow, clock, onProgress });
      try {
        const references = await encodeImages(images, normalizedTask === "image_to_video"
          ? (index) => index === 0 ? "first-frame" : "image-to-video-reference"
          : "reference");
        const video = referenceVideo ? await encodeVideo(referenceVideo, "reference-video") : null;
        if (normalizedTask === "edit" && !video) throw new Error("A task edit exige referenceVideo. A disponibilidade de edição de vídeo enviado depende da região e das limitações atuais do Gemini Omni.");
        const requestParameters = {
          ...parameters,
          ...(normalizedTask ? { task: normalizedTask } : {}),
          ...(normalizedAspect ? { aspectRatio: normalizedAspect } : {}),
        };
        const providerParameters = {
          ...parameters,
          // Uploaded-video editing follows the official Files API document+text
          // example; keep edit in the local receipt but do not force videoConfig.task.
          ...(normalizedTask && !(normalizedTask === "edit" && video) ? { task: normalizedTask } : {}),
          ...(normalizedAspect ? { aspectRatio: normalizedAspect } : {}),
        };
        return await runVideoJob({
          route: generateRoute,
          body: {
            ...providerParameters,
            attemptId: normalizedAttemptId,
            prompt: normalizedPrompt,
            productImages: references.request,
            ...(video ? { referenceVideo: video.request } : {}),
          },
          operation: "generate-video",
          prompt: normalizedPrompt,
          model,
          parameters: requestParameters,
          inputs: [...references.artifacts, ...(video ? [video.artifact] : [])],
          metadata,
          outputFile,
          timeoutMs,
          pollIntervalMs,
          receiptFile,
          timing,
          attemptId: normalizedAttemptId,
          onProviderHandle,
        });
      } catch (error) {
        throw attachPartialTimings(error, timing);
      }
    },
    async refine({
      instructions,
      previousInteractionId,
      aspectRatio = null,
      outputFile,
      model = null,
      parameters = {},
      metadata = {},
      timeoutMs = 360_000,
      pollIntervalMs = 5_000,
      receiptFile = null,
      onProgress = null,
      attemptId = randomUUID(),
      onProviderHandle = null,
    } = {}) {
      const normalizedInstructions = requireText(instructions, "instructions");
      const normalizedAttemptId = requireText(attemptId, "attemptId");
      const previous = requireText(previousInteractionId, "previousInteractionId");
      const normalizedAspect = assertAspectRatio(aspectRatio);
      const requestParameters = { ...parameters, previousInteractionId: previous, ...(normalizedAspect ? { aspectRatio: normalizedAspect } : {}) };
      const timing = createVideoTimingTracker({ monotonicNow, clock, onProgress });
      try {
        return await runVideoJob({
          route: editRoute,
          body: { attemptId: normalizedAttemptId, previousInteractionId: previous, instructions: normalizedInstructions, ...(normalizedAspect ? { aspectRatio: normalizedAspect } : {}) },
          operation: "edit-video",
          prompt: normalizedInstructions,
          model,
          parameters: requestParameters,
          inputs: [],
          metadata,
          outputFile,
          timeoutMs,
          pollIntervalMs,
          receiptFile,
          timing,
          attemptId: normalizedAttemptId,
          onProviderHandle,
        });
      } catch (error) {
        throw attachPartialTimings(error, timing);
      }
    },
  };
}
