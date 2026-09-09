import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createGeminiImageEndpointAdapter, readReceipt } from "../lib/media-pipeline/index.mjs";

let root;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-body")]);
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "gemini-image-test-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null },
    async json() { return payload; },
  };
}

function generatedPngResponse(interactionId = "image-interaction") {
  return jsonResponse({ imageUrl: `data:image/png;base64,${PNG.toString("base64")}`, interactionId });
}

async function assertMissing(file) {
  await assert.rejects(readFile(file), (error) => error?.code === "ENOENT");
}

async function assertNoResidue(fragment) {
  const names = await readdir(root);
  assert.deepEqual(names.filter((name) => name.includes(fragment) && (name.endsWith(".tmp") || name.endsWith(".lock"))), []);
}

test("gera imagem por data URL e grava recibo com referência", async () => {
  const reference = path.join(root, "reference.png");
  const output = path.join(root, "generated.png");
  await writeFile(reference, PNG);
  let requestBody;
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        imageUrl: `data:image/png;base64,${PNG.toString("base64")}`,
        interactionId: "image-interaction-1",
        model: "gemini-3.1-flash-image",
      });
    },
  });
  const result = await adapter.generate({
    prompt: 'Create a presenter saying "hello"',
    images: [reference],
    outputFile: output,
    aspectRatio: "16:9",
    imageSize: "2K",
  });
  assert.deepEqual(await readFile(output), PNG);
  assert.equal(requestBody.productImages.length, 1);
  assert.equal(requestBody.aspectRatio, "16:9");
  assert.equal(requestBody.imageSize, "2K");
  assert.equal(result.interactionId, "image-interaction-1");
  const receipt = await readReceipt(result.receiptFile);
  assert.equal(receipt.operation, "generate-image");
  assert.equal(receipt.inputs.length, 1);
  assert.equal(receipt.artifacts[0].role, "generated-image");
});

test("baixa imageUrl remoto sem registrar a URL no recibo", async () => {
  const output = path.join(root, "remote.png");
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async (url) => {
      if (url === "https://images.example/result.png") {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "image/png" },
          async arrayBuffer() { return JPEG; },
        };
      }
      return jsonResponse({ imageUrl: "https://images.example/result.png" });
    },
  });
  const result = await adapter.generate({ prompt: "weather presenter", outputFile: output });
  assert.equal(path.extname(result.file), ".jpg");
  assert.deepEqual(await readFile(result.file), JPEG);
  const receiptText = await readFile(result.receiptFile, "utf8");
  assert.doesNotMatch(receiptText, /images\.example/);
  assert.match(receiptText, /"delivery": "uri"/);
});

test("valida aspecto, tamanho e limite de referências antes da chamada", async () => {
  const adapter = createGeminiImageEndpointAdapter({ endpoint: "http://fake.local" });
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.png"), aspectRatio: "7:5" }), /Aspecto de imagem inválido/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.png"), imageSize: "8K" }), /Tamanho de imagem inválido/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.png"), images: ["1", "2", "3", "4", "5"] }), /no máximo quatro/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.mp4") }), /extensão \.png/);
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: path.join(root, "x.png"), model: "unknown-image-model" }), /Modelo de imagem não permitido/);
});

test("rejeita base64 e bytes que não formam uma imagem", async () => {
  const invalidBase64 = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => jsonResponse({ imageUrl: "not-base64" }),
  });
  await assert.rejects(invalidBase64.generate({ prompt: "x", outputFile: path.join(root, "invalid.png") }), /base64 inválido/);

  const invalidBytes = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => jsonResponse({ imageUrl: Buffer.from("not-an-image").toString("base64") }),
  });
  await assert.rejects(invalidBytes.generate({ prompt: "x", outputFile: path.join(root, "invalid-bytes.png") }), /não são PNG ou JPEG/);
});

test("faz preflight de PNG, JPEG e recibo antes do único POST", async () => {
  let posts = 0;
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => {
      posts += 1;
      return generatedPngResponse();
    },
  });

  const existingJpeg = path.join(root, "preflight-image.jpg");
  await writeFile(existingJpeg, "jpeg-preservado", "utf8");
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "preflight-image.png") }),
    /já existe e não será sobrescrito/,
  );
  assert.equal(await readFile(existingJpeg, "utf8"), "jpeg-preservado");

  const alternateReceipt = path.join(root, "preflight-receipt.jpg.receipt.json");
  await writeFile(alternateReceipt, "recibo-preservado", "utf8");
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "preflight-receipt.png") }),
    /já existe e não será sobrescrito/,
  );
  assert.equal(await readFile(alternateReceipt, "utf8"), "recibo-preservado");

  const explicitReceipt = path.join(root, "preflight-explicit-receipt.json");
  await writeFile(explicitReceipt, "recibo-explícito", "utf8");
  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: path.join(root, "preflight-explicit.png"), receiptFile: explicitReceipt }),
    /já existe e não será sobrescrito/,
  );
  assert.equal(await readFile(explicitReceipt, "utf8"), "recibo-explícito");
  assert.equal(posts, 0);
  await assertNoResidue("preflight-");
});

test("serializa duas gerações no mesmo destino e mantém exatamente um POST", async () => {
  const output = path.join(root, "concurrent.png");
  let posts = 0;
  let releaseRequest;
  let markStarted;
  const requestStarted = new Promise((resolve) => { markStarted = resolve; });
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => {
      posts += 1;
      markStarted();
      await requestGate;
      return generatedPngResponse("concurrent-interaction");
    },
  });

  const first = adapter.generate({ prompt: "first", outputFile: output });
  await requestStarted;
  await assert.rejects(
    adapter.generate({ prompt: "second", outputFile: output }),
    /Destino em uso por outra geração de imagem/,
  );
  releaseRequest();
  const result = await first;
  assert.equal(posts, 1);
  assert.deepEqual(await readFile(result.file), PNG);
  assert.equal((await readReceipt(result.receiptFile)).providerResponse.interactionId, "concurrent-interaction");
  await assertNoResidue("concurrent");
});

test("não sobrescreve imagem criada durante o POST e limpa o temporário", async () => {
  const output = path.join(root, "commit-race.png");
  const preserved = Buffer.from("imagem de outro processo");
  let posts = 0;
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => {
      posts += 1;
      await writeFile(output, preserved);
      return generatedPngResponse();
    },
  });
  await assert.rejects(adapter.generate({ prompt: "x", outputFile: output }), /já existe e não será sobrescrito/);
  assert.equal(posts, 1);
  assert.deepEqual(await readFile(output), preserved);
  await assertMissing(`${output}.receipt.json`);
  await assertNoResidue("commit-race");
});

test("remove a imagem publicada quando o commit do recibo falha", async () => {
  const output = path.join(root, "receipt-rollback.png");
  const receipt = path.join(root, "receipt-rollback.json");
  let clockCalls = 0;
  let posts = 0;
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    clock: () => {
      clockCalls += 1;
      if (clockCalls === 2) writeFileSync(receipt, "recibo concorrente", "utf8");
      return new Date(`2026-07-14T00:00:0${clockCalls}.000Z`);
    },
    fetchImpl: async () => {
      posts += 1;
      return generatedPngResponse();
    },
  });

  await assert.rejects(
    adapter.generate({ prompt: "x", outputFile: output, receiptFile: receipt }),
    /Recibo de imagem já existe e não será sobrescrito/,
  );
  assert.equal(posts, 1);
  await assertMissing(output);
  assert.equal(await readFile(receipt, "utf8"), "recibo concorrente");
  await assertNoResidue("receipt-rollback");
});

test("modo kernel rejeita ausência de effect authorization antes do POST", async () => {
  let posts = 0;
  const adapter = createGeminiImageEndpointAdapter({
    endpoint: "http://fake.local",
    fetchImpl: async () => {
      posts += 1;
      return generatedPngResponse();
    },
  });
  await assert.rejects(
    adapter.generate({
      prompt: "x",
      outputFile: path.join(root, "kernel-blocked.png"),
      metadata: { mode: "studio", executionKernel: "required" },
    }),
    /não foi emitida pelo journal/,
  );
  assert.equal(posts, 0);
});
