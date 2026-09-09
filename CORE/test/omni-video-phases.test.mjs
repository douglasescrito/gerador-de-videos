import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createOmniVideoBrowserOperations } from "../scripts/omni-product-studio-submit.mjs";
import { createExecutionTiming, assertExecutionTiming } from "../lib/media-pipeline/execution-timing.mjs";

const mp4 = () => Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omni-video-phases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function browserDouble(respond) {
  const calls = [];
  let opened = 0;
  let closed = 0;
  const operations = createOmniVideoBrowserOperations({
    openSession: async () => {
      opened += 1;
      return {
        cookies: [{ value: "synthetic-session-secret" }], requests: [], responses: [], authSource: "credential-manager",
        frame: { async evaluate(fn, argument) {
          const evaluate = runInNewContext(`(${fn.toString()})`, {
            AbortSignal, Uint8Array, btoa,
            fetch: async (url, options = {}) => {
              const request = { url, method: options.method ?? "GET", options };
              calls.push(request);
              return respond(request);
            },
          });
          return evaluate(argument);
        } },
      };
    },
    closeSession: async () => { closed += 1; },
  });
  return { operations, calls, get opened() { return opened; }, get closed() { return closed; } };
}

test("submit devolve handle persistido sem consultar estado nem baixar mídia", async (t) => {
  const root = await directory(t);
  const order = [];
  const browser = browserDouble(({ url }) => {
    assert.equal(url, "/api/generate-video");
    order.push("post");
    return Response.json({ fileId: "file-1", interactionId: "interaction-1", token: "must-not-persist" });
  });
  const outputFile = path.join(root, "video.mp4");
  const result = await browser.operations.submit({
    prompt: "direção literal", task: "text_to_video", outputFile, attemptId: "attempt-1",
    onBeforeSubmit: async () => { await Promise.resolve(); order.push("reserved"); },
    onProviderHandle: async ({ fileId }) => { assert.equal(fileId, "file-1"); await Promise.resolve(); order.push("persisted"); },
  });
  assert.deepEqual(order, ["reserved", "post", "persisted"]);
  assert.equal(result.status, "pending");
  assert.equal(result.fileId, "file-1");
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.opened, 1);
  assert.equal(browser.closed, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-session-secret|must-not-persist/);
  await assert.rejects(access(outputFile), { code: "ENOENT" });
});

test("submit sem destino permite decidir o caminho somente na coleta", async () => {
  const browser = browserDouble(() => Response.json({ fileId: "file-later-output" }));
  const submitted = await browser.operations.submit({ prompt: "formas", task: "text_to_video" });
  assert.equal(submitted.fileId, "file-later-output");
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.closed, 1);
});

test("falha antes do POST prova ausência; falha após aceite mantém handle e ambiguidade", async (t) => {
  const root = await directory(t);
  const browser = browserDouble(() => Response.json({ fileId: "accepted-before-crash" }));
  const options = { prompt: "teste", task: "text_to_video", outputFile: path.join(root, "video.mp4") };
  await assert.rejects(browser.operations.submit({ ...options, onBeforeSubmit: async () => { throw new Error("reservation failed"); } }), (error) => {
    assert.equal(error.postStarted, false);
    assert.equal(error.submissionAmbiguous, false);
    return true;
  });
  assert.equal(browser.calls.length, 0);
  await assert.rejects(browser.operations.submit({ ...options, onProviderHandle: async () => { throw Object.freeze(new Error("journal failed")); } }), (error) => {
    assert.equal(error.postStarted, true);
    assert.equal(error.submissionAmbiguous, true);
    assert.equal(error.fileId, "accepted-before-crash");
    return true;
  });
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.closed, 2);
});

test("POST sem resposta e HTTP 503 não autorizam repetição por ausência presumida", async (t) => {
  const root = await directory(t);
  for (const respond of [() => { throw new Error("connection lost"); }, () => Response.json({ error: "unavailable" }, { status: 503 })]) {
    const browser = browserDouble(respond);
    await assert.rejects(browser.operations.submit({ prompt: "teste", outputFile: path.join(root, "video.mp4") }), (error) => {
      assert.equal(error.postStarted, true);
      assert.equal(error.submissionAmbiguous, true);
      assert.notEqual(error.effectAbsentProved, true);
      return true;
    });
    assert.equal(browser.calls.length, 1);
    assert.equal(browser.closed, 1);
  }
});

test("observeMany compartilha autenticação, não espera render e classifica cada handle independentemente", async () => {
  const states = [
    ["ready", 200, "ACTIVE", "ready"], ["pending", 200, "PROCESSING", "provider_pending"],
    ["failed", 200, "FAILED", "provider_failed"], ["auth", 403, null, "auth_or_scope_mismatch"],
    ["missing", 404, null, "remote_not_found"], ["upstream", 503, null, "upstream_unreachable"],
  ];
  const browser = browserDouble(({ url, method }) => {
    assert.equal(method, "GET");
    const id = url.split("/").at(-1);
    const entry = states.find(([fileId]) => fileId === id);
    return Response.json({ state: entry[2] }, { status: entry[1] });
  });
  const observed = await browser.operations.observeMany({ requests: states.map(([fileId]) => ({ fileId })) });
  assert.deepEqual(observed.map(({ classification }) => classification), states.map((entry) => entry[3]));
  assert.ok(observed.every(({ zeroPost }) => zeroPost));
  assert.equal(browser.calls.length, states.length);
  assert.equal(browser.opened, 1);
  assert.equal(browser.closed, 1);
  assert.deepEqual(await browser.operations.observeMany({ requests: [] }), []);
  assert.equal(browser.opened, 1, "lote vazio não autentica");
});

test("collect retoma handle em sessão nova e materializa MP4 com zero POST", async (t) => {
  const root = await directory(t);
  const outputFile = path.join(root, "collected.mp4");
  const browser = browserDouble(({ url, method }) => {
    assert.equal(method, "GET");
    assert.equal(url, "/api/video/persisted-handle");
    return new Response(mp4(), { headers: { "content-type": "video/mp4", "content-length": String(mp4().length) } });
  });
  const result = await browser.operations.collect({ fileId: "persisted-handle", outputFile });
  assert.equal(result.zeroPost, true);
  assert.equal(result.classification, "ready");
  assert.deepEqual(await readFile(outputFile), mp4());
  await assert.rejects(browser.operations.collect({ fileId: "persisted-handle", outputFile }), /não será sobrescrito/);
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.opened, browser.closed);
});

test("generate legado continua POST, poll e download na mesma sessão e encaminha hooks", async (t) => {
  const root = await directory(t);
  const browser = browserDouble(({ url }) => {
    if (url === "/api/generate-video") return Response.json({ fileId: "legacy-1" });
    if (url === "/api/file-status/legacy-1") return Response.json({ state: "ACTIVE" });
    return new Response(mp4(), { headers: { "content-type": "video/mp4" } });
  });
  const hooks = [];
  const result = await browser.operations.generate({
    prompt: "teste", outputFile: path.join(root, "legacy.mp4"),
    onBeforeSubmit: async () => hooks.push("before"), onProviderHandle: async () => hooks.push("handle"),
  });
  assert.deepEqual(hooks, ["before", "handle"]);
  assert.deepEqual(result.states, ["ACTIVE"]);
  assert.equal(result.fileId, "legacy-1");
  assert.equal(browser.calls.filter(({ method }) => method === "POST").length, 1);
  assert.equal(browser.opened, 1);
  assert.equal(browser.closed, 1);
});

test("transporte separa preparação, POST, polling, download e publicação sem atribuir espera ao render", async (t) => {
  const root = await directory(t);
  let observations = 0;
  const browser = browserDouble(({ url }) => {
    if (url === "/api/generate-video") return Response.json({ fileId: "timed-file" });
    if (url === "/api/file-status/timed-file") return Response.json({ state: ++observations === 1 ? "PROCESSING" : "ACTIVE" });
    return new Response(mp4(), { headers: { "content-type": "video/mp4" } });
  });
  const timing = createExecutionTiming();
  await timing.run(() => browser.operations.generate({ prompt: "synthetic-private-prompt", outputFile: path.join(root, "timed.mp4"), pollIntervalMs: 1 }));
  const measurement = assertExecutionTiming(timing.snapshot());
  for (const phase of ["preparation", "submission", "polling", "download", "publication", "pending-wait"]) assert.ok(measurement.phaseMs[phase] !== null, phase);
  assert.equal(measurement.intervals.filter((interval) => interval.phase === "submission").length, 1);
  assert.equal(measurement.intervals.filter((interval) => interval.phase === "polling").length, 2);
  assert.equal(measurement.remoteProcessingMs, null);
  assert.equal(measurement.phaseMs["capacity-wait"], null);
  assert.equal(browser.calls.filter(({ method }) => method === "POST").length, 1);
  assert.doesNotMatch(JSON.stringify(measurement), /synthetic-private-prompt|synthetic-session-secret|timed-file/);
});
