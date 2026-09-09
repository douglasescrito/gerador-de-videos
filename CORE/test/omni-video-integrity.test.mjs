import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createOmniVideoEndpointAdapter, readReceipt, verifyReceipt } from "../lib/media-pipeline/index.mjs";

function box(type, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4(payload = "media") {
  return Buffer.concat([
    box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isommp42")])),
    box("mdat", Buffer.from(payload)),
  ]);
}

function response({ status = 200, json = {}, bytes = Buffer.alloc(0), type = "application/json", contentLength = bytes.length, streamError = null } = {}) {
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
      get(name) {
        if (name.toLowerCase() === "content-type") return type;
        if (name.toLowerCase() === "content-length" && contentLength !== null) return String(contentLength);
        return null;
      },
    },
    async json() { return json; },
    async text() { return ""; },
    async arrayBuffer() { throw new Error("o caminho streaming não deve usar arrayBuffer"); },
  };
}

function adapterForVideo(videoResponse, { onPost = null } = {}) {
  return createOmniVideoEndpointAdapter({
    endpoint: "http://fake.local",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith("/api/generate-video")) {
        await onPost?.(init);
        return response({ json: { fileId: "integrity-file", interactionId: "integrity-interaction" } });
      }
      if (url.endsWith("/api/file-status/integrity-file")) return response({ json: { state: "ACTIVE" } });
      if (url.endsWith("/api/video/integrity-file")) return videoResponse;
      return response({ status: 404 });
    },
  });
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omni-integrity-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function assertNoResidues(directory) {
  const names = await readdir(directory);
  assert.deepEqual(names.filter((name) => name.endsWith(".tmp") || name.endsWith(".omni.lock")), []);
}

test("faz commit atômico do MP4 e usa hash e bytes calculados durante o stream", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "success.mp4");
  const video = mp4("streamed-success");
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4; charset=binary" }));

  const result = await adapter.generate({ prompt: "x", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 });
  const receipt = await readReceipt(result.receiptFile);
  assert.deepEqual(await readFile(output), video);
  assert.equal(receipt.artifacts[0].bytes, video.length);
  assert.equal(receipt.artifacts[0].hash.value, createHash("sha256").update(video).digest("hex"));
  assert.deepEqual(verifyReceipt(receipt), { valid: true, errors: [] });
  await assertNoResidues(directory);
});

test("rejeita Content-Type, assinatura e corpo vazio sem publicar saída", async (t) => {
  const directory = await temporaryDirectory(t);
  const cases = [
    { name: "wrong-type", response: response({ bytes: mp4(), type: "text/html" }), pattern: /Content-Type incompatível/ },
    { name: "wrong-signature", response: response({ bytes: Buffer.from("not-an-mp4-container"), type: "video/mp4" }), pattern: /assinatura ftyp/ },
    { name: "empty", response: response({ bytes: Buffer.alloc(0), type: "video/mp4" }), pattern: /vídeo vazio/ },
  ];

  for (const item of cases) {
    const output = path.join(directory, `${item.name}.mp4`);
    await assert.rejects(
      adapterForVideo(item.response).generate({ prompt: "x", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 }),
      item.pattern,
    );
    assert.equal(await exists(output), false);
    assert.equal(await exists(`${output}.receipt.json`), false);
  }
  await assertNoResidues(directory);
});

test("remove temporário e não publica recibo quando o stream falha", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "broken-stream.mp4");
  const failure = new Error("stream interrompido no teste");
  const adapter = adapterForVideo(response({ bytes: mp4("partial"), type: "video/mp4", streamError: failure }));

  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 }),
    /stream interrompido no teste/,
  );
  assert.equal(await exists(output), false);
  assert.equal(await exists(`${output}.receipt.json`), false);
  await assertNoResidues(directory);
});

test("detecta stream encerrado antes do Content-Length e limpa resíduos", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "truncated.mp4");
  const video = mp4("short-response");
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4", contentLength: video.length + 20 }));

  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 }),
    /foi truncado/,
  );
  assert.equal(await exists(output), false);
  assert.equal(await exists(`${output}.receipt.json`), false);
  await assertNoResidues(directory);
});

test("recusa output ou receipt preexistente antes do POST e preserva os arquivos", async (t) => {
  const directory = await temporaryDirectory(t);
  let posts = 0;
  const adapter = adapterForVideo(response({ bytes: mp4() }), { onPost: async () => { posts += 1; } });

  const existingOutput = path.join(directory, "existing-output.mp4");
  await writeFile(existingOutput, "sentinel-output");
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: existingOutput }), /Arquivo de saída já existe/);
  assert.equal(await readFile(existingOutput, "utf8"), "sentinel-output");

  const outputWithReceipt = path.join(directory, "existing-receipt.mp4");
  await writeFile(`${outputWithReceipt}.receipt.json`, "sentinel-receipt");
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: outputWithReceipt }), /Recibo de saída já existe/);
  assert.equal(await readFile(`${outputWithReceipt}.receipt.json`, "utf8"), "sentinel-receipt");
  assert.equal(await exists(outputWithReceipt), false);
  assert.equal(posts, 0);
  await assertNoResidues(directory);
});

test("serializa colisão concorrente no mesmo destino sem duplicar o POST", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "concurrent.mp4");
  const video = mp4("concurrent-success");
  let posts = 0;
  let releasePost;
  const postGate = new Promise((resolve) => { releasePost = resolve; });
  t.after(() => releasePost());
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4" }), {
    onPost: async () => {
      posts += 1;
      await postGate;
    },
  });

  const first = adapter.generate({ prompt: "first", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 });
  while (posts === 0) await new Promise((resolve) => setImmediate(resolve));
  const activeLock = JSON.parse(await readFile(path.join(directory, ".concurrent.mp4.omni.lock"), "utf8"));
  assert.equal(activeLock.schema, "mkt-videos/output-lock@1");
  assert.equal(activeLock.pid, process.pid);
  assert.ok(Date.parse(activeLock.expiresAt) > Date.parse(activeLock.createdAt));
  await assert.rejects(
    adapter.generate({ prompt: "second", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 }),
    /Destino em uso por outra geração/,
  );
  releasePost();
  await first;
  assert.equal(posts, 1);
  assert.deepEqual(await readFile(output), video);
  await assertNoResidues(directory);
});

test("recupera lock órfão somente quando o processo proprietário não existe", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "orphaned.mp4");
  const lockFile = path.join(directory, ".orphaned.mp4.omni.lock");
  const video = mp4("recovered-orphan");
  const now = Date.now();
  await writeFile(lockFile, `${JSON.stringify({
    schema: "mkt-videos/output-lock@1",
    lockId: "orphan-lock-id",
    pid: 2_147_483_647,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    target: output,
  })}\n`, "utf8");
  let posts = 0;
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4" }), {
    onPost: async () => { posts += 1; },
  });

  await adapter.generate({ prompt: "recover", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 });
  assert.equal(posts, 1);
  assert.deepEqual(await readFile(output), video);
  assert.equal(await exists(lockFile), false);
  await assertNoResidues(directory);
});

test("não toma lock expirado enquanto o processo proprietário continua ativo", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "live-owner.mp4");
  const lockFile = path.join(directory, ".live-owner.mp4.omni.lock");
  const now = Date.now();
  await writeFile(lockFile, `${JSON.stringify({
    schema: "mkt-videos/output-lock@1",
    lockId: "live-owner-lock-id",
    pid: process.pid,
    createdAt: new Date(now - 120_000).toISOString(),
    expiresAt: new Date(now - 60_000).toISOString(),
    target: output,
  })}\n`, "utf8");
  let posts = 0;
  const adapter = adapterForVideo(response({ bytes: mp4("must-not-run"), type: "video/mp4" }), {
    onPost: async () => { posts += 1; },
  });

  await assert.rejects(
    adapter.generate({ prompt: "blocked", outputFile: output, timeoutMs: 1_000, pollIntervalMs: 0 }),
    /Destino em uso por outra geração/,
  );
  assert.equal(posts, 0);
  assert.equal(await exists(lockFile), true);
});

test("alias de caminho não abre um segundo lock para o mesmo destino", async (t) => {
  const directory = await temporaryDirectory(t);
  const real = path.join(directory, "real");
  const alias = path.join(directory, "alias");
  await mkdir(real, { recursive: true });
  try {
    // Junction no Windows não exige privilégio; em POSIX vale o symlink.
    await symlink(real, alias, "junction");
  } catch {
    t.skip("sistema de arquivos não permite criar alias de diretório");
    return;
  }
  const video = mp4("alias-success");
  let posts = 0;
  let releasePost;
  const postGate = new Promise((resolve) => { releasePost = resolve; });
  t.after(() => releasePost());
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4" }), {
    onPost: async () => { posts += 1; await postGate; },
  });

  const first = adapter.generate({ prompt: "first", outputFile: path.join(real, "colisao.mp4"), timeoutMs: 1_000, pollIntervalMs: 0 });
  while (posts === 0) await new Promise((resolve) => setImmediate(resolve));
  // O mesmo arquivo, alcançado por outro caminho, tem de ser o mesmo destino.
  await assert.rejects(
    adapter.generate({ prompt: "second", outputFile: path.join(alias, "colisao.mp4"), timeoutMs: 1_000, pollIntervalMs: 0 }),
    /Destino em uso por outra geração/,
  );
  releasePost();
  await first;
  assert.equal(posts, 1);
});

test("caixa diferente no mesmo caminho não abre um segundo lock", async (t) => {
  const directory = await temporaryDirectory(t);
  const pasta = path.join(directory, "Saidas");
  await mkdir(pasta, { recursive: true });
  const video = mp4("case-success");
  let posts = 0;
  let releasePost;
  const postGate = new Promise((resolve) => { releasePost = resolve; });
  t.after(() => releasePost());
  const adapter = adapterForVideo(response({ bytes: video, type: "video/mp4" }), {
    onPost: async () => { posts += 1; await postGate; },
  });

  const first = adapter.generate({ prompt: "first", outputFile: path.join(pasta, "peca.mp4"), timeoutMs: 1_000, pollIntervalMs: 0 });
  while (posts === 0) await new Promise((resolve) => setImmediate(resolve));
  const outraCaixa = path.join(directory, "SAIDAS", "peca.mp4");
  if (path.resolve(outraCaixa).toLowerCase() === path.resolve(path.join(pasta, "peca.mp4")).toLowerCase()
    && process.platform === "win32") {
    await assert.rejects(
      adapter.generate({ prompt: "second", outputFile: outraCaixa, timeoutMs: 1_000, pollIntervalMs: 0 }),
      /Destino em uso por outra geração/,
    );
  }
  releasePost();
  await first;
  assert.equal(posts, 1);
});
