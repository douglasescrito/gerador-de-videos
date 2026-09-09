import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { classifyOmniRemoteState, createOmniVideoEndpointAdapter, createReceipt, readReceipt, verifyReceipt } from "../lib/media-pipeline/index.mjs";

let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "omni-video-test-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function box(type, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4(payload = "video") {
  return Buffer.concat([
    box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isommp42")])),
    box("mdat", Buffer.from(payload)),
  ]);
}

function response({ status = 200, json = {}, bytes = Buffer.alloc(0), type = "application/json", streamError = null, contentLength = bytes.length } = {}) {
  const body = new ReadableStream({
    start(controller) {
      if (bytes.length) {
        const length = streamError ? Math.max(1, Math.floor(bytes.length / 2)) : bytes.length;
        controller.enqueue(bytes.subarray(0, length));
      }
      if (streamError) controller.error(streamError);
      else controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    headers: {
      get: (name) => {
        if (name.toLowerCase() === "content-type") return type;
        if (name.toLowerCase() === "content-length" && contentLength !== null) return String(contentLength);
        return null;
      },
    },
    async json() { return json; },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test("gera, consulta, baixa e registra o vídeo Omni", async () => {
  const image = path.join(root, "reference.jpg");
  const output = path.join(root, "v1.mp4");
  await writeFile(image, Buffer.from("image"));
  const calls = [];
  const video = mp4("video-v1");
  let poll = 0;
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/generate-video")) return response({ json: { fileId: "file-v1", interactionId: "interaction-v1" } });
      if (url.endsWith("/api/file-status/file-v1")) return response({ json: { state: ++poll === 1 ? "PROCESSING" : "ACTIVE" } });
      if (url.endsWith("/api/video/file-v1")) return response({ bytes: video, type: "video/mp4" });
      return response({ status: 404 });
    },
  });
  const result = await adapter.generate({ prompt: "slow orbit", images: [image], task: "image_to_video", aspectRatio: "16:9", outputFile: output, timeoutMs: 5_000, pollIntervalMs: 0 });
  assert.deepEqual(await readFile(output), video);
  assert.equal(result.interactionId, "interaction-v1");
  assert.deepEqual(result.statusHistory, ["PROCESSING", "ACTIVE"]);
  assert.equal(JSON.parse(calls[0].init.body).task, "image_to_video");
  const receipt = await readReceipt(result.receiptFile);
  assert.equal(receipt.providerResponse.fileId, "file-v1");
  assert.equal(receipt.artifacts[0].bytes, video.length);
  assert.equal(receipt.artifacts[0].hash.value, createHash("sha256").update(video).digest("hex"));
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock")), []);
});

test("persiste o handle por barreira aguardável antes do primeiro polling", async () => {
  const output = path.join(root, "handle-barrier.mp4");
  const calls = [];
  const handles = [];
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    sleep: async () => {},
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/api/generate-video")) return response({ json: { fileId: "file-handle", interactionId: "interaction-handle" } });
      if (url.endsWith("/api/file-status/file-handle")) return response({ json: { state: "ACTIVE" } });
      if (url.endsWith("/api/video/file-handle")) return response({ bytes: mp4("handle"), type: "video/mp4" });
      return response({ status: 404 });
    },
  });
  const result = await adapter.generate({
    attemptId: "attempt-handle",
    prompt: "handle",
    outputFile: output,
    timeoutMs: 1_000,
    pollIntervalMs: 0,
    async onProviderHandle(handle) {
      assert.equal(calls.length, 1);
      handles.push(handle);
    },
  });
  assert.equal(result.attemptId, "attempt-handle");
  assert.deepEqual(handles.map(({ attemptId, fileId }) => ({ attemptId, fileId })), [{ attemptId: "attempt-handle", fileId: "file-handle" }]);
  assert.equal(calls.filter((url) => url.includes("file-status")).length, 1);
});

test("falha da barreira de handle bloqueia polling e download sem segundo POST", async () => {
  const calls = [];
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (url) => {
      calls.push(url);
      return response({ json: { fileId: "file-unpersisted" } });
    },
  });
  await assert.rejects(adapter.generate({
    attemptId: "attempt-unpersisted",
    prompt: "x",
    outputFile: path.join(root, "unpersisted.mp4"),
    timeoutMs: 100,
    async onProviderHandle() { throw new Error("disk unavailable"); },
  }), /disk unavailable/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /generate-video$/);
});

test("taxonomia de reconcile distingue estado, expiração, acesso e indisponibilidade", () => {
  const nowMs = Date.parse("2026-07-22T12:00:00.000Z");
  assert.equal(classifyOmniRemoteState({ state: "ACTIVE", nowMs }), "ready");
  assert.equal(classifyOmniRemoteState({ state: "PROCESSING", nowMs }), "provider_pending");
  assert.equal(classifyOmniRemoteState({ state: "FAILED", nowMs }), "provider_failed");
  assert.equal(classifyOmniRemoteState({ state: "MYSTERY", nowMs }), "unknown_state");
  assert.equal(classifyOmniRemoteState({ httpStatus: 404, expirationTime: "2026-07-22T11:00:00.000Z", nowMs }), "remote_expired");
  assert.equal(classifyOmniRemoteState({ httpStatus: 404, expirationTime: "2026-07-22T13:00:00.000Z", nowMs }), "remote_not_found");
  assert.equal(classifyOmniRemoteState({ httpStatus: 403, nowMs }), "auth_or_scope_mismatch");
  assert.equal(classifyOmniRemoteState({ httpStatus: 503, nowMs }), "upstream_unreachable");
});

test("reconcile recupera por attemptId usando apenas GET e publica MP4 com recibo", async () => {
  const output = path.join(root, "reconciled.mp4");
  const calls = [];
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      if (url.endsWith("/api/attempts/attempt-lost-response")) return response({ json: { attemptId: "attempt-lost-response", fileId: "file-reconcile", state: "provider_pending" } });
      if (url.endsWith("/api/file-status/file-reconcile")) return response({ json: { state: "ACTIVE", expirationTime: "2026-07-24T12:00:00.000Z" } });
      if (url.endsWith("/api/video/file-reconcile")) return response({ bytes: mp4("reconciled"), type: "video/mp4" });
      return response({ status: 404 });
    },
  });
  const result = await adapter.reconcile({ attemptId: "attempt-lost-response", outputFile: output, timeoutMs: 5_000 });
  assert.equal(result.classification, "ready");
  assert.equal(result.fileId, "file-reconcile");
  assert.deepEqual(await readFile(output), mp4("reconciled"));
  assert.equal((await readReceipt(result.receiptFile)).providerResponse.fileId, "file-reconcile");
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("reconcile não baixa pending e classifica corrida ACTIVE para 404 por expiração", async () => {
  const pendingCalls = [];
  const pendingAdapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (url, init = {}) => {
      pendingCalls.push({ url, method: init.method ?? "GET" });
      return response({ json: { state: "PROCESSING", expirationTime: "2099-01-01T00:00:00.000Z" } });
    },
  });
  const pending = await pendingAdapter.reconcile({ fileId: "pending", outputFile: path.join(root, "pending.mp4"), timeoutMs: 100 });
  assert.equal(pending.classification, "provider_pending");
  assert.equal(pendingCalls.length, 1);

  const raceCalls = [];
  const raceAdapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      raceCalls.push({ url, method: init.method ?? "GET" });
      if (url.includes("file-status")) return response({ json: { state: "ACTIVE", expirationTime: "2026-07-22T11:00:00.000Z" } });
      return response({ status: 404 });
    },
  });
  const raced = await raceAdapter.reconcile({ fileId: "expired-race", outputFile: path.join(root, "expired-race.mp4"), timeoutMs: 100 });
  assert.equal(raced.classification, "remote_expired");
  assert.equal(raced.phase, "download");
  assert.equal(raceCalls.every((call) => call.method === "GET"), true);
});

test("edição de vídeo enviado omite task no payload e preserva task no recibo", async () => {
  const referenceVideo = path.join(root, "uploaded-reference.mp4");
  const output = path.join(root, "uploaded-edit.mp4");
  await writeFile(referenceVideo, mp4("uploaded-reference"));
  const calls = [];
  const video = mp4("uploaded-edit");
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/generate-video")) return response({ json: { fileId: "file-uploaded-edit", interactionId: "interaction-uploaded-edit" } });
      if (url.endsWith("/api/file-status/file-uploaded-edit")) return response({ json: { state: "ACTIVE" } });
      if (url.endsWith("/api/video/file-uploaded-edit")) return response({ bytes: video, type: "video/mp4" });
      return response({ status: 404 });
    },
  });

  const result = await adapter.generate({
    prompt: "Add a vortex. Keep everything else the same.",
    referenceVideo,
    task: "edit",
    aspectRatio: "16:9",
    outputFile: output,
    timeoutMs: 5_000,
    pollIntervalMs: 0,
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal("task" in body, false);
  assert.equal(body.aspectRatio, "16:9");
  const receipt = await readReceipt(result.receiptFile);
  assert.equal(receipt.parameters.task, "edit");
});

test("mede fases monotônicas, emite progresso sem novas requisições e preserva recibos antigos", async () => {
  const output = path.join(root, "timed.mp4");
  const video = mp4("timed-video");
  const monotonicValues = [0, 10, 20, 22, 30, 50, 55, 65, 70, 72];
  let lastMonotonic = 0;
  let monotonicIndex = 0;
  const events = [];
  const calls = [];
  let poll = 0;
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    sleep: async () => {},
    monotonicNow: () => {
      lastMonotonic = monotonicValues[monotonicIndex++];
      return lastMonotonic;
    },
    clock: () => new Date(Date.UTC(2026, 0, 1) + lastMonotonic),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/api/generate-video")) return response({ json: { fileId: "file-timed" } });
      if (url.endsWith("/api/file-status/file-timed")) return response({ json: { state: ++poll === 1 ? "PROCESSING" : "ACTIVE" } });
      if (url.endsWith("/api/video/file-timed")) return response({ bytes: video, type: "video/mp4" });
      return response({ status: 404 });
    },
  });

  const result = await adapter.generate({
    prompt: "timed",
    task: "text_to_video",
    outputFile: output,
    timeoutMs: 1_000,
    pollIntervalMs: 0,
    onProgress(event) {
      events.push(event);
      throw new Error("telemetry callback must be isolated");
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(monotonicIndex, monotonicValues.length);
  assert.deepEqual(events.map((event) => event.event), [
    "post_started",
    "post_accepted",
    "handle_persisted",
    "provider_poll",
    "provider_poll",
    "provider_ready",
    "download_started",
    "download_completed",
    "committed",
    "receipt_written",
  ]);
  assert.deepEqual(result.timings, {
    schema: "mkt-videos/video-timings@1",
    unit: "milliseconds",
    operationStartedAt: "2026-01-01T00:00:00.000Z",
    polls: 2,
    statusTimeline: [
      { poll: 1, state: "PROCESSING", at: "2026-01-01T00:00:00.030Z", elapsedMs: 30 },
      { poll: 2, state: "ACTIVE", at: "2026-01-01T00:00:00.050Z", elapsedMs: 50 },
    ],
    postStartedAt: "2026-01-01T00:00:00.010Z",
    providerAcceptedAt: "2026-01-01T00:00:00.020Z",
    handlePersistedAt: "2026-01-01T00:00:00.022Z",
    providerReadyAt: "2026-01-01T00:00:00.050Z",
    downloadStartedAt: "2026-01-01T00:00:00.055Z",
    downloadCompletedAt: "2026-01-01T00:00:00.065Z",
    videoCommittedAt: "2026-01-01T00:00:00.070Z",
    completedAt: "2026-01-01T00:00:00.072Z",
    preparationMs: 10,
    requestMs: 10,
    handlePersistenceMs: 2,
    providerProcessingMs: 30,
    providerMs: 40,
    downloadMs: 10,
    artifactCommitMs: 5,
    receiptMs: 2,
    localFinalizeMs: 7,
    videoDeliveryMs: 70,
    totalMs: 72,
  });

  const receipt = await readReceipt(result.receiptFile);
  assert.equal(receipt.timings.videoDeliveryMs, 70);
  assert.equal("completedAt" in receipt.timings, false);
  assert.equal("receiptMs" in receipt.timings, false);
  assert.equal("localFinalizeMs" in receipt.timings, false);
  assert.equal("totalMs" in receipt.timings, false);
  assert.deepEqual(verifyReceipt(receipt), { valid: true, errors: [] });

  const legacyReceipt = createReceipt({ operation: "legacy", provider: "test" });
  assert.equal("timings" in legacyReceipt, false);
  assert.deepEqual(verifyReceipt(legacyReceipt), { valid: true, errors: [] });
});

test("anexa timings parciais quando a geração falha", async () => {
  const calls = [];
  const monotonicValues = [0, 7];
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    monotonicNow: () => monotonicValues.shift(),
    fetchImpl: async (url) => {
      calls.push(url);
      return response({ status: 500, json: { error: { message: "provider failed" } } });
    },
  });

  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "timing-failure.mp4"), timeoutMs: 100 }),
    (error) => {
      assert.equal(error.timings.schema, "mkt-videos/video-timings@1");
      assert.equal(error.timings.preparationMs, 7);
      assert.equal(error.timings.polls, 0);
      assert.equal("requestMs" in error.timings, false);
      assert.equal("completedAt" in error.timings, false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("task auto preserva a imagem e não força task no request", async () => {
  const image = path.join(root, "first-frame.jpg");
  const output = path.join(root, "auto.mp4");
  await writeFile(image, Buffer.from("image"));
  const calls = [];
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/generate-video")) return response({ json: { fileId: "file-auto" } });
      if (url.endsWith("/api/file-status/file-auto")) return response({ json: { state: "ACTIVE" } });
      if (url.endsWith("/api/video/file-auto")) return response({ bytes: mp4("video-auto"), type: "video/mp4" });
      return response({ status: 404 });
    },
  });
  await adapter.generate({
    prompt: "<FIRST_FRAME> Use the given image as the starting frame.",
    images: [image],
    task: "auto",
    aspectRatio: "16:9",
    outputFile: output,
    timeoutMs: 5_000,
    pollIntervalMs: 0,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal("task" in body, false);
  assert.equal(body.productImages.length, 1);
});

test("ajusta uma interação e salva nova versão", async () => {
  const output = path.join(root, "v2.mp4");
  const video = mp4("video-v2");
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith("/api/edit-video")) {
        assert.deepEqual(JSON.parse(init.body), { attemptId: "attempt-refine", previousInteractionId: "interaction-v1", instructions: "mais lento", aspectRatio: "16:9" });
        return response({ json: { fileId: "file-v2", interactionId: "interaction-v2" } });
      }
      if (url.endsWith("/api/file-status/file-v2")) return response({ json: { state: "ACTIVE" } });
      if (url.endsWith("/api/video/file-v2")) return response({ bytes: video, type: "video/mp4" });
      return response({ status: 404 });
    },
  });
  const result = await adapter.refine({ attemptId: "attempt-refine", previousInteractionId: "interaction-v1", instructions: "mais lento", aspectRatio: "16:9", outputFile: output, timeoutMs: 5_000, pollIntervalMs: 0 });
  assert.equal(result.interactionId, "interaction-v2");
  assert.deepEqual(await readFile(output), video);
});

test("rejeita tarefas e formatos fora do contrato", async () => {
  const adapter = createOmniVideoEndpointAdapter({ endpoint: "http://fake.local" });
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.mp4"), task: "montage" }), /Task inválida/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.mp4"), aspectRatio: "4:3" }), /Aspecto inválido/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.mp4"), task: "reference_to_video" }), /pelo menos uma imagem/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.mp4"), task: "text_to_video", images: [path.join(root, "unused.png")] }), /não aceita imagem/);
});

test("preserva status, código e mensagem estruturada do upstream", async () => {
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => response({
      status: 400,
      json: { error: { message: "Input blocked", code: "invalid_request" } },
    }),
  });
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "blocked.mp4") }),
    (error) => {
      assert.equal(error.name, "OmniHttpError");
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.kind, "provider_input_blocked");
      assert.equal(error.retryable, false);
      assert.match(error.message, /Input blocked \[HTTP 400, invalid_request\]/);
      assert.match(error.message, /personagem ficcional/);
      assert.match(error.message, /premium cinematic 3D/);
      return true;
    },
  );
});

test("desembrulha HTTP 400 serializado incorretamente como erro 500", async () => {
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => response({
      status: 500,
      json: { error: '400 {"error":{"message":"Input blocked","code":"invalid_request"}}' },
    }),
  });
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "wrapped.mp4") }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.kind, "provider_input_blocked");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("aplica o timeout também ao POST inicial", async () => {
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "timeout.mp4"), timeoutMs: 10 }),
    /Tempo excedido durante a solicitação de geração/,
  );
});

test("modo kernel rejeita ausência de effect authorization antes do POST", async () => {
  let posts = 0;
  const adapter = createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => {
      posts += 1;
      return response({ json: { fileId: "should-not-run" } });
    },
  });
  await assert.rejects(
    adapter.generate({
      prompt: "x",
      outputFile: path.join(root, "kernel-blocked.mp4"),
      task: "text_to_video",
      metadata: { mode: "studio", executionKernel: "required" },
    }),
    /não foi emitida pelo journal/,
  );
  assert.equal(posts, 0);
});
