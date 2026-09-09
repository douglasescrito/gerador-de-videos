import { createIsolatedCliWorkspace } from "./fixtures/isolated-cli-workspace.mjs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { listCommands } from "../lib/cli/command-registry.mjs";
import { after, before, test } from "node:test";

let cli;
let workspace;
const MP4 = Buffer.alloc(24);
MP4.writeUInt32BE(24, 0);
MP4.write("ftyp", 4, "ascii");
MP4.write("isom", 8, "ascii");
MP4.writeUInt32BE(0, 12);
MP4.write("isom", 16, "ascii");
MP4.write("iso2", 20, "ascii");
let root;

before(async () => {
  workspace = await createIsolatedCliWorkspace(path.resolve(import.meta.dirname, ".."));
  root = path.join(workspace.coreRoot, "test-data");
  await mkdir(root);
  cli = path.join(workspace.coreRoot, "scripts/omni-cli.mjs");
});
after(async () => { await workspace?.dispose(); });

function cookieTestInvocation(args) {
  const normalized = [...args];
  // Planejamento desta fixture não depende do acervo operacional da máquina.
  if (["plan", "dry-run", "compile", "run"].includes(normalized[0]) && !normalized.includes("--eta-root")) normalized.push("--eta-root", path.join(root, "receipts"));
  const supportsCookieBridge = ["image", "generate", "batch", "draft", "animate", "run", "resume", "reconcile"].includes(normalized[0]);
  const endpointIndex = supportsCookieBridge ? normalized.indexOf("--endpoint") : -1;
  const endpoint = endpointIndex >= 0 ? normalized.splice(endpointIndex, 2)[1] : null;
  return { args: normalized, env: { ...process.env, NODE_ENV: "test", ...(endpoint ? { MKT_VIDEO_TEST_COOKIE_ENDPOINT: endpoint } : {}) } };
}

function run(args) {
  const invocation = cookieTestInvocation(args);
  return spawnSync(process.execPath, ["--import", pathToFileURL(workspace.guardFile).href, cli, ...invocation.args], { cwd: workspace.coreRoot, encoding: "utf8", env: invocation.env });
}

function runWithoutCookieTestBridge(args) {
  return spawnSync(process.execPath, ["--import", pathToFileURL(workspace.guardFile).href, cli, ...args], { cwd: workspace.coreRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
}

function runAsync(args) {
  return new Promise((resolve, reject) => {
    const invocation = cookieTestInvocation(args);
    const child = spawn(process.execPath, ["--import", pathToFileURL(workspace.guardFile).href, cli, ...invocation.args], { cwd: workspace.coreRoot, stdio: ["ignore", "pipe", "pipe"], env: invocation.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

async function close(server) {
  server.close();
  await once(server, "close");
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

test("expõe documentação e limitações oficiais no CLI", () => {
  const result = run(["docs"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.limitations.videoExtension, "not supported");
  assert.equal(payload.imageModel, "gemini-3.1-flash-image");
  assert.equal(payload.prompting.recognizableAdultReference.learnedFrom, "technical guidance; private production reference omitted");
  assert.ok(payload.prompting.recognizableAdultReference.saferFraming.includes("fictional adult male presenter"));
  assert.ok(payload.prompting.recognizableAdultReference.blockedOrRiskyFraming.includes("live-action"));
  assert.equal(payload.prompting.batch.recommendedParallel, 3);
  assert.equal(payload.prompting.batch.researchProfile.id, "react-audiovisual@1");
  assert.match(payload.prompting.batch.researchProfile.behavior, /joined clean-cut/i);
  assert.equal(payload.prompting.photoAnimation.firstFrameFlag, "--first-frame forces image_to_video without rewriting the user prompt");
  assert.match(payload.prompting.photoAnimation.multipleLiteralPhotos, /not guaranteed/);
  assert.match(payload.prompting.photoAnimation.windowsMultiline, /--prompt-file/);
  assert.match(payload.imageGeneration, /^https:\/\/ai\.google\.dev\//);
  assert.match(payload.videoGeneration, /^https:\/\/ai\.google\.dev\//);
});

test("rejeita argumentos órfãos que indicam prompt truncado pelo shell", () => {
  const result = run(["generate", "--prompt", "parte inicial", "fala truncada"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Argumentos posicionais inesperados/);
  assert.match(result.stderr, /--prompt-file/);
});

test("lê prompt com aspas por arquivo sem truncá-lo", async () => {
  const promptFile = path.join(root, "prompt.txt");
  await writeFile(promptFile, 'He says: "Olá, mundo!"', "utf8");
  const result = run(["generate", "--prompt-file", promptFile, "--task", "montage"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Task inválida: montage/);
  assert.doesNotMatch(result.stderr, /argumentos posicionais/i);
});

test("rejeita opção desconhecida e flag sem valor", () => {
  const unknown = run(["generate", "--prompt", "x", "--unknown", "y"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Opção desconhecida/);
  // Opção desconhecida passou a ser um erro de uso declarado: o lugar que
  // detecta sabe a categoria e lança CliError, em vez de deixar a
  // classificação para quem adivinhasse pelo texto. Ganha a dica em
  // português para quem lê o terminal e a linha JSON para quem automatiza.
  assert.match(unknown.stderr, /mkt-videos\/cli-error@1/);
  assert.equal(JSON.parse(unknown.stderr.trim().split(/\r?\n/).at(-1)).code, "usage");
  // Sem nada parecido com "--unknown" em generate, a dica aponta o caminho.
  assert.match(unknown.stderr, /npm run video -- generate --help/);

  const missing = run(["generate", "--prompt", "x", "--image"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--image exige um valor/);
});

test("--confirm-paid não existe mais e é recusada como opção desconhecida", async () => {
  const specFile = path.join(root, "draft-confirm.json");
  await writeFile(specFile, JSON.stringify({ name: "piloto", scenes: [{ prompt: "Cena inicial" }], qa: false }), "utf8");
  const result = run(["draft", "--spec", specFile, "--confirm-paid", "true"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /confirm-paid/);
});

test("CLI rejeita chave/API e endpoint de geração, mantendo somente sessão cookie", () => {
  const api = run(["generate", "--prompt", "x", "--auth", "api", "--out", path.join(root, "api-blocked.mp4")]);
  assert.equal(api.status, 1);
  assert.match(api.stderr, /cookie-only/);
  assert.match(api.stderr, /credential-manager ou har/);

  const endpoint = runWithoutCookieTestBridge(["generate", "--prompt", "x", "--endpoint", "http://127.0.0.1:3000"]);
  assert.equal(endpoint.status, 1);
  assert.match(endpoint.stderr, /Opção desconhecida.*--endpoint/);

  const guarded = runWithoutCookieTestBridge(["generate", "--prompt", "x", "--out", path.join(root, "provider-guard.mp4")]);
  assert.equal(guarded.status, 1);
  assert.match(guarded.stderr, /Provider-free test guard/);

  const capabilities = run(["capabilities"]);
  assert.equal(capabilities.status, 0);
  const payload = JSON.parse(capabilities.stdout);
  assert.deepEqual(Object.keys(payload.musicBackends), ["flow-music"]);
  assert.equal(payload.narrationProvider, "google-vids");
  assert.equal("ttsFallbackModels" in payload, false);
  assert.equal("gemini-tts" in payload.operationalPending, false);
  assert.equal("lyria-realtime" in payload.operationalPending, false);
  assert.equal(payload.capabilityMap.summary.pending, Object.values(payload.operationalPending).length);
  assert.match(payload.capabilityMap.capabilities.find((entry) => entry.id === "gemini-omni").expiresAt, /^2026-09-23T/);
});

test("modo raw preserva prompt literal e bloqueia composição de estilo", () => {
  const result = run(["generate", "--prompt", "texto literal", "--style", "aquarela-2d@1"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--style exige --mode studio/);
});

test("modo studio registra prompt do usuário e prompt efetivo separadamente", async () => {
  const output = path.join(root, "studio-style.mp4");
  let postedBody = null;
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      postedBody = await jsonBody(request);
      return sendJson(response, 200, { fileId: "file-studio", interactionId: "interaction-studio" });
    }
    if (request.method === "GET" && url.pathname === "/api/file-status/file-studio") return sendJson(response, 200, { state: "ACTIVE" });
    if (request.method === "GET" && url.pathname === "/api/video/file-studio") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(MP4.length) });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const result = await runAsync(["generate", "--prompt", "Uma flor abrindo", "--mode", "studio", "--style", "aquarela-2d@1", "--out", output, "--endpoint", fake.endpoint, "--poll", "0", "--timeout", "5000"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(postedBody.prompt, /watercolor/i);
    assert.match(postedBody.prompt, /Uma flor abrindo/);
    const receipt = JSON.parse(await readFile(`${output}.receipt.json`, "utf8"));
    assert.equal(receipt.parameters.mode, "studio");
    assert.equal(receipt.metadata.promptComposition.userPrompt, "Uma flor abrindo");
    assert.equal(receipt.metadata.promptComposition.directionPreset, "aquarela-2d@1");
    assert.equal(receipt.metadata.promptComposition.effectivePrompt, postedBody.prompt);
    assert.equal(receipt.metadata.pipeline.stage, "omni-video");
  } finally {
    await close(fake.server);
  }
});

test("dry-run de filme lista gasto e não cria diretório", async () => {
  const specFile = path.join(root, "film-dry-run.json");
  const outRoot = path.join(root, "film-dry-output");
  await writeFile(specFile, JSON.stringify({ name: "piloto", scenes: [{ prompt: "Cena inicial" }], qa: false }), "utf8");
  const result = run(["dry-run", "--spec", specFile, "--out-root", outRoot]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload.plan.paidCalls.map((entry) => entry.stage), ["draft", "video"]);
  await assert.rejects(readFile(payload.stateFile), /ENOENT/);
});

test("--first-frame preserva o prompt, força image_to_video e registra o papel da foto", async () => {
  const image = path.join(root, "first-frame.jpg");
  const output = path.join(root, "first-frame.mp4");
  await writeFile(image, Buffer.from("imagem-de-teste"));
  let postedBody = null;
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      postedBody = await jsonBody(request);
      return sendJson(response, 200, { fileId: "file-first-frame", interactionId: "interaction-first-frame" });
    }
    if (request.method === "GET" && url.pathname === "/api/file-status/file-first-frame") return sendJson(response, 200, { state: "ACTIVE" });
    if (request.method === "GET" && url.pathname === "/api/video/file-first-frame") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(MP4.length) });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const prompt = "Não altere esta fotografia. Movimento somente de câmera.";
    const result = await runAsync(["generate", "--prompt", prompt, "--first-frame", image, "--confirm-provider-input", "true", "--out", output, "--endpoint", fake.endpoint, "--poll", "0", "--timeout", "5000"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(postedBody.prompt, prompt);
    assert.equal(postedBody.task, "image_to_video");
    assert.equal(postedBody.productImages.length, 1);
    const receipt = JSON.parse(await readFile(`${output}.receipt.json`, "utf8"));
    assert.equal(receipt.parameters.task, "image_to_video");
    assert.equal(receipt.inputs[0].role, "first-frame");
    const authorization = receipt.metadata.providerInputAuthorization;
    assert.equal(authorization.schema, "mkt-videos/direct-provider-input-permit@1");
    assert.equal(authorization.version, 1);
    assert.equal(authorization.inputs.length, 1);
    assert.equal(authorization.inputs[0].role, "first-frame");
    assert.equal(authorization.inputs[0].operation, "generate-video");
    assert.equal(authorization.inputs[0].bytes, Buffer.byteLength("imagem-de-teste"));
    assert.match(authorization.inputs[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(authorization.permitHash, /^[a-f0-9]{64}$/);
    const serializedAuthorization = JSON.stringify(authorization);
    assert.doesNotMatch(serializedAuthorization, /"file"|"path"|"data"|"base64"/i);
    assert.doesNotMatch(serializedAuthorization, /first-frame\.jpg/i);
  } finally {
    await close(fake.server);
  }
});

test("--first-frame rejeita combinações ambíguas", () => {
  const mixedImages = run(["generate", "--prompt", "x", "--first-frame", "a.jpg", "--image", "b.jpg"]);
  assert.equal(mixedImages.status, 1);
  assert.match(mixedImages.stderr, /não misture com --image/);

  const wrongTask = run(["generate", "--prompt", "x", "--first-frame", "a.jpg", "--task", "reference_to_video"]);
  assert.equal(wrongTask.status, 1);
  assert.match(wrongTask.stderr, /somente --task image_to_video ou --task auto/);
});

test("entradas externas exigem confirmação explícita e o batch preflight bloqueia todo POST", async () => {
  const image = path.join(root, "provider-gate.png");
  const video = path.join(root, "provider-gate.mp4");
  const jobsFile = path.join(root, "provider-gate-jobs.json");
  const invalidJobsFile = path.join(root, "provider-gate-invalid-jobs.json");
  await Promise.all([
    writeFile(image, Buffer.from("provider-gate-image")),
    writeFile(video, MP4),
    writeFile(jobsFile, JSON.stringify([
      { id: "with-image", prompt: "x", images: [image] },
    ])),
    writeFile(invalidJobsFile, JSON.stringify([
      { id: "valid", prompt: "x", images: [image] },
      {
        id: "missing",
        prompt: "y",
        images: [path.join(root, "missing-provider-gate.png")],
      },
    ])),
  ]);

  let adapterCalls = 0;
  const fake = await listen((_request, response) => {
    adapterCalls += 1;
    response.writeHead(500);
    response.end();
  });
  try {
    const invocations = [
      ["image", "--prompt", "x", "--image", image],
      ["generate", "--prompt", "x", "--first-frame", image],
      ["generate", "--prompt", "x", "--video", video],
      ["batch", "--jobs", jobsFile],
    ];
    for (const invocation of invocations) {
      const result = await runAsync([...invocation, "--endpoint", fake.endpoint]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--confirm-provider-input true/);
      const classificationLine = result.stderr.trim().split("\n").at(-1);
      const classification = JSON.parse(classificationLine);
      assert.equal(classification.schema, "mkt-videos/cli-error@1");
      assert.equal(classification.code, "confirmation_required");
      assert.equal(classification.retryable, false);
    }

    const implicit = run([
      "generate",
      "--prompt",
      "x",
      "--image",
      image,
      "--confirm-provider-input",
    ]);
    assert.equal(implicit.status, 1);
    assert.match(implicit.stderr, /--confirm-provider-input exige um valor/);

    const invalidBoolean = run([
      "generate",
      "--prompt",
      "x",
      "--image",
      image,
      "--confirm-provider-input",
      "yes",
    ]);
    assert.equal(invalidBoolean.status, 1);
    assert.match(invalidBoolean.stderr, /deve ser true ou false/);

    const invalidBatch = await runAsync([
      "batch",
      "--jobs",
      invalidJobsFile,
      "--confirm-provider-input",
      "true",
      "--endpoint",
      fake.endpoint,
    ]);
    assert.equal(invalidBatch.status, 1);
    assert.match(invalidBatch.stderr, /ENOENT/);
    assert.equal(adapterCalls, 0);
  } finally {
    await close(fake.server);
  }
});

test("batch valida arquivo de jobs antes de gerar", async () => {
  const jobsFile = path.join(root, "empty-jobs.json");
  await writeFile(jobsFile, JSON.stringify({ jobs: [] }), "utf8");
  const result = run(["batch", "--jobs", jobsFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /array JSON/);
});

test("doctor normaliza health ausente e conexão recusada sem stack", async () => {
  const exposed = await listen((_request, response) => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  try {
    const result = await runAsync(["doctor", "--endpoint", exposed.endpoint]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.reachable, true);
    assert.equal(payload.configured, null);
    assert.equal(payload.ready, null);
    assert.equal(payload.health, "not_exposed");
    assert.equal(payload.httpStatus, 404);
    assert.equal(payload.local.cliVersion, "0.1.0");
    assert.equal(payload.local.node.version, process.version);
    assert.equal(payload.local.node.satisfies, true);
    assert.equal(typeof payload.local.ffmpeg.available, "boolean");
    // Conta contra o registry, não contra um número escrito à mão: o que este
    // teste quer dizer é "o doctor reporta o manifesto fielmente", e um literal
    // aqui só quebrava a cada comando novo.
    assert.equal(payload.local.manifest.commandCount, listCommands().length);
    assert.deepEqual(payload.local.manifest.protectedCommands, ["approve", "status", "resume", "reconcile"]);
  } finally {
    await close(exposed.server);
  }

  const closed = await listen((_request, response) => response.end());
  const endpoint = closed.endpoint;
  await close(closed.server);
  const refused = await runAsync(["doctor", "--endpoint", endpoint]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, "");
  const payload = JSON.parse(refused.stdout);
  assert.equal(payload.reachable, false);
  assert.equal(payload.configured, null);
  assert.equal(payload.ready, false);
  assert.equal(payload.health, "unreachable");
  assert.doesNotMatch(refused.stdout, /\n\s*at\s/);
});

test("doctor preserva readiness conhecida e só retorna zero quando ready", async () => {
  let ready = false;
  const local = await listen((_request, response) => {
    sendJson(response, ready ? 200 : 503, {
      ready,
      configured: true,
      provider: "fake",
      model: "fake-model",
      ...(!ready ? { error: { message: "not ready", code: "not_ready", stack: "Error: not ready\n    at server.ts:1" } } : {}),
    });
  });
  try {
    const unavailable = await runAsync(["doctor", "--endpoint", local.endpoint]);
    assert.equal(unavailable.status, 1);
    assert.equal(JSON.parse(unavailable.stdout).ready, false);
    assert.doesNotMatch(unavailable.stdout, /server\.ts|\n\s*at\s/);
    ready = true;
    const available = await runAsync(["doctor", "--endpoint", local.endpoint]);
    assert.equal(available.status, 0);
    const payload = JSON.parse(available.stdout);
    assert.equal(payload.reachable, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.ready, true);
    assert.equal(payload.health, "ready");
  } finally {
    await close(local.server);
  }
});

test("generate inclui resumo de entrega com tokens e tempos", async () => {
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      await jsonBody(request);
      return sendJson(response, 200, {
        fileId: "file-summary",
        interactionId: "interaction-summary",
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          totalTokenCount: 18,
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/file-status/file-summary") return sendJson(response, 200, { state: "ACTIVE" });
    if (request.method === "GET" && url.pathname === "/api/video/file-summary") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(MP4.length) });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const output = path.join(root, "single-summary.mp4");
    const result = await runAsync(["generate", "--prompt", "filme curto", "--out", output, "--endpoint", fake.endpoint, "--poll", "0", "--timeout", "5000"]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.file, output);
    assert.equal(payload.deliverySummary.schema, "mkt-videos/delivery-summary@1");
    assert.equal(payload.deliverySummary.tokens.available, true);
    assert.equal(payload.deliverySummary.tokens.inputTokens, 11);
    assert.equal(payload.deliverySummary.tokens.outputTokens, 7);
    assert.equal(payload.deliverySummary.tokens.totalTokens, 18);
    assert.equal(payload.deliverySummary.timings.polls, 1);
    assert.equal(payload.deliverySummary.timings.stages.some((stage) => stage.field === "providerProcessingMs" && stage.duration !== "indisponível"), true);
    const receipt = JSON.parse(await readFile(`${output}.receipt.json`, "utf8"));
    assert.equal(receipt.providerResponse.usageMetadata.totalTokenCount, 18);
  } finally {
    await close(fake.server);
  }
});

test("generate com collection organiza parte, recibo e vídeo final", async () => {
  const collection = `cli-collection-${process.pid}-${Date.now()}`;
  const collectionRoot = path.join(workspace.coreRoot, "outputs", collection);
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      await jsonBody(request);
      return sendJson(response, 200, { fileId: "file-collection", interactionId: "interaction-collection" });
    }
    if (request.method === "GET" && url.pathname === "/api/file-status/file-collection") return sendJson(response, 200, { state: "ACTIVE" });
    if (request.method === "GET" && url.pathname === "/api/video/file-collection") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(MP4.length) });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const result = await runAsync(["generate", "--prompt", "filme curto", "--collection", collection, "--endpoint", fake.endpoint, "--poll", "0", "--timeout", "5000"]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.collection.name, collection);
    assert.equal(payload.collection.partNumber, 1);
    assert.equal(path.resolve(payload.file), path.join(collectionRoot, "videos-soltos", "parte-001.mp4"));
    assert.equal(path.resolve(payload.receipt), path.join(collectionRoot, "receitas", "parte-001.mp4.receipt.json"));
    assert.equal(path.resolve(payload.collection.finalVideo.file), path.join(collectionRoot, "videos-unidos", `${collection}-partes-juntas.mp4`));
    assert.equal(payload.collection.finalVideo.parts, 1);
    const manifest = JSON.parse(await readFile(path.join(collectionRoot, "manifest.json"), "utf8"));
    assert.equal(manifest.parts.length, 1);
  } finally {
    await close(fake.server);
    await rm(collectionRoot, { recursive: true, force: true });
  }
});

test("batch valida parallel, objetos e destinos antes do pool", async () => {
  const jobsFile = path.join(root, "invalid-batch-jobs.json");
  await writeFile(jobsFile, JSON.stringify([{ id: "one", prompt: "one" }]), "utf8");
  for (const parallel of ["0", "9", "1.5", "abc"]) {
    const result = run(["batch", "--jobs", jobsFile, "--parallel", parallel]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inteiro entre 1 e 8/);
  }

  await writeFile(jobsFile, JSON.stringify([null]), "utf8");
  const invalidObject = run(["batch", "--jobs", jobsFile]);
  assert.equal(invalidObject.status, 1);
  assert.match(invalidObject.stderr, /job 1 deve ser um objeto JSON válido/);

  const duplicate = path.join(root, "same.mp4");
  await writeFile(jobsFile, JSON.stringify([
    { id: "one", prompt: "one", out: duplicate },
    { id: "two", prompt: "two", out: duplicate },
  ]), "utf8");
  const duplicated = run(["batch", "--jobs", jobsFile]);
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stderr, /Destino duplicado no batch/);

  await writeFile(jobsFile, JSON.stringify([{ id: "one", prompt: "one" }]), "utf8");
  const unknownResearch = run([
    "batch",
    "--jobs",
    jobsFile,
    "--research-profile",
    "desconhecido",
  ]);
  assert.equal(unknownResearch.status, 1);
  assert.match(unknownResearch.stderr, /Perfil de pesquisa desconhecido/);
});

test("batch limita concorrência, isola falha e faz um POST por job", async () => {
  const nestedStress = process.env.MKT_VIDEOS_TEST_CONCURRENCY === "default" && process.env.MKT_VIDEOS_CONCURRENCY_GATE !== "1";
  const expectedParallel = nestedStress ? 1 : 3;
  const batchRoot = path.join(root, "batch-integration");
  const prompts = path.join(batchRoot, "prompts");
  await mkdir(prompts, { recursive: true });
  await writeFile(path.join(prompts, "quoted.txt"), 'Prompt from file: "olá"', "utf8");
  const jobsFile = path.join(batchRoot, "jobs.json");
  const jobs = [
    { id: "file-prompt", promptFile: "prompts/quoted.txt" },
    { id: "two", prompt: "prompt two" },
    { id: "blocked", prompt: "forced failure" },
    { id: "four", prompt: "prompt four" },
    { id: "five", prompt: "prompt five" },
    { id: "six", prompt: "prompt six" },
  ];
  await writeFile(jobsFile, JSON.stringify({ jobs }), "utf8");

  let active = 0;
  let maxActive = 0;
  const posts = [];
  let nextFile = 0;
  let releaseFirstWave;
  const firstWave = new Promise((resolve) => { releaseFirstWave = resolve; });
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      const body = await jsonBody(request);
      posts.push(body.prompt);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (maxActive === expectedParallel) releaseFirstWave();
      await Promise.race([
        firstWave,
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      active -= 1;
      if (body.prompt === "forced failure") return sendJson(response, 400, { error: { message: "forced failure", code: "invalid_request" } });
      nextFile += 1;
      return sendJson(response, 200, { fileId: `file-${nextFile}`, interactionId: `interaction-${nextFile}` });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/file-status/")) return sendJson(response, 200, { state: "ACTIVE" });
    if (request.method === "GET" && url.pathname.startsWith("/api/video/")) {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(MP4.length) });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });

  let generatedDir = null;
  try {
    const outputDir = path.join(batchRoot, "generated");
    const result = await runAsync(["batch", "--jobs", jobsFile, "--out-dir", outputDir, "--endpoint", fake.endpoint, "--parallel", String(expectedParallel), "--poll", "0", "--timeout", "5000"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[batch 0\/6\] preparado/);
    assert.match(result.stderr, /ETA calculando/);
    assert.match(result.stderr, /\[01\/6\] iniciado/);
    assert.match(result.stderr, /Omni aceitou/);
    assert.match(result.stderr, /Omni ACTIVE/);
    assert.match(result.stderr, /concluído/);
    assert.match(result.stderr, /falhou/);
    assert.match(result.stderr, /summary gravado/);
    assert.doesNotMatch(result.stderr, /Prompt from file|forced failure|http:\/\//i);
    const summary = JSON.parse(result.stdout);
    generatedDir = summary.outDir;
    assert.equal(summary.schema, "mkt-videos/batch-summary@2");
    assert.equal(summary.parallel, expectedParallel);
    assert.equal(summary.total, 6);
    assert.equal(summary.ok, 5);
    assert.equal(summary.failed, 1);
    assert.equal(maxActive, expectedParallel);
    assert.equal(posts.length, jobs.length);
    assert.equal(new Set(posts).size, jobs.length);
    assert.ok(posts.includes('Prompt from file: "olá"'));
    assert.equal(path.resolve(summary.outDir), path.resolve(outputDir));
    assert.equal(summary.timings.jobs.videoDeliveryMs.count, 5);
    assert.ok(summary.timings.jobs.videoDeliveryMs.median >= 0);
    assert.ok(summary.timings.wallClock.preparationMs >= 0);
    assert.ok(summary.timings.wallClock.poolMs >= 0);
    assert.ok(summary.timings.throughputVideosPerMinute > 0);
    assert.equal(summary.timings.accumulatedWork.count, 5);
    assert.equal(summary.results.filter((item) => item.ok).every((item) => item.timings.videoDeliveryMs >= 0), true);
    const diskSummary = JSON.parse(await readFile(summary.summaryFile, "utf8"));
    assert.deepEqual(diskSummary.results.map((item) => item.ok), [true, true, false, true, true, true]);
    assert.equal(diskSummary.results.filter((item) => !item.ok)[0].error.includes("forced failure"), true);
  } finally {
    await close(fake.server);
    const outputsRoot = `${path.join(workspace.coreRoot, "outputs")}${path.sep}`.toLowerCase();
    if (generatedDir && `${path.resolve(generatedDir)}${path.sep}`.toLowerCase().startsWith(outputsRoot)) {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }
});

test("batch emite permit mínimo por job e não autoriza job text-only", async () => {
  const batchRoot = path.join(root, "batch-provider-permits");
  const firstImage = path.join(batchRoot, "first.png");
  const secondImage = path.join(batchRoot, "second.png");
  const jobsFile = path.join(batchRoot, "jobs.json");
  const firstBytes = Buffer.from("first-provider-input");
  const secondBytes = Buffer.from("second-provider-input");
  await mkdir(batchRoot, { recursive: true });
  await Promise.all([
    writeFile(firstImage, firstBytes),
    writeFile(secondImage, secondBytes),
    writeFile(jobsFile, JSON.stringify([
      { id: "first-ref", prompt: "first", images: [firstImage] },
      { id: "text-only", prompt: "text only" },
      { id: "second-ref", prompt: "second", images: [secondImage] },
    ])),
  ]);

  let nextFile = 0;
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      await jsonBody(request);
      nextFile += 1;
      return sendJson(response, 200, {
        fileId: `permit-file-${nextFile}`,
        interactionId: `permit-interaction-${nextFile}`,
      });
    }
    if (
      request.method === "GET"
      && url.pathname.startsWith("/api/file-status/permit-file-")
    ) {
      return sendJson(response, 200, { state: "ACTIVE" });
    }
    if (
      request.method === "GET"
      && url.pathname.startsWith("/api/video/permit-file-")
    ) {
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": String(MP4.length),
      });
      return response.end(MP4);
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const result = await runAsync([
      "batch",
      "--jobs",
      jobsFile,
      "--out-dir",
      path.join(batchRoot, "out"),
      "--parallel",
      "1",
      "--confirm-provider-input",
      "true",
      "--endpoint",
      fake.endpoint,
      "--poll",
      "0",
      "--timeout",
      "5000",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(nextFile, 3);
    const summary = JSON.parse(result.stdout);
    const receipts = new Map();
    for (const item of summary.results) {
      receipts.set(item.id, JSON.parse(await readFile(item.receipt, "utf8")));
    }
    const firstAuthorization =
      receipts.get("first-ref").metadata.providerInputAuthorization;
    const secondAuthorization =
      receipts.get("second-ref").metadata.providerInputAuthorization;
    assert.equal(firstAuthorization.inputs.length, 1);
    assert.equal(secondAuthorization.inputs.length, 1);
    assert.equal(
      firstAuthorization.inputs[0].sha256,
      createHash("sha256").update(firstBytes).digest("hex"),
    );
    assert.equal(
      secondAuthorization.inputs[0].sha256,
      createHash("sha256").update(secondBytes).digest("hex"),
    );
    assert.notEqual(
      firstAuthorization.invocationId,
      secondAuthorization.invocationId,
    );
    assert.equal(
      Object.hasOwn(
        receipts.get("text-only").metadata,
        "providerInputAuthorization",
      ),
      false,
    );
  } finally {
    await close(fake.server);
  }
});
