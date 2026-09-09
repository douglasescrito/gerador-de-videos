import { createIsolatedCliWorkspace } from "./fixtures/isolated-cli-workspace.mjs";
import { pathToFileURL } from "node:url";
// Comando `lote`: cria e dispacha um lote no MESMO job-state (.batches/) que
// POST /api/batch grava hoje. Ver batch-dispatch.mjs para o porquê (Fase 2,
// §7: sem isto, remover as rotas gerativas do Express deixaria a Galeria sem
// nada que crie lotes no formato que ela lê).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { after, before, test } from "node:test";

let cli;
let workspace;
const MP4 = Buffer.alloc(32);
MP4.writeUInt32BE(32, 0);
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

function run(args, { endpoint = null } = {}) {
  const env = { ...process.env, NODE_ENV: "test", ...(endpoint ? { MKT_VIDEO_TEST_COOKIE_ENDPOINT: endpoint } : {}) };
  return spawnSync(process.execPath, ["--import", pathToFileURL(workspace.guardFile).href, cli, ...args], { cwd: workspace.coreRoot, encoding: "utf8", windowsHide: true, env });
}

function runAsync(args, { endpoint = null } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_ENV: "test", ...(endpoint ? { MKT_VIDEO_TEST_COOKIE_ENDPOINT: endpoint } : {}) };
    const child = spawn(process.execPath, ["--import", pathToFileURL(workspace.guardFile).href, cli, ...args], { cwd: workspace.coreRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
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

test("lote recusa item com referência antes de tocar o provedor ou o estado do lote", async () => {
  const batchRoot = path.join(root, "referencias");
  await mkdir(batchRoot, { recursive: true });
  const itemsFile = path.join(batchRoot, "itens.json");
  await writeFile(itemsFile, JSON.stringify([{ prompt: "cena um", references: [{ inputId: "x" }] }]), "utf8");
  const stateDir = path.join(batchRoot, ".batches");

  const result = run(["lote", "--collection", "lote-referencia", "--items", itemsFile, "--state-dir", stateDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lote aceita somente texto/);
  assert.match(result.stderr, /use batch --jobs com confirmação de entradas ou autorização de produção/);
  await assert.rejects(access(stateDir), { code: "ENOENT" });
});

test("lote cria e dispacha um lote real no job-state compartilhado, legível por `batches`", async () => {
  // O destino padrão continua CORE/outputs/<coleção>, agora dentro da cópia
  // temporária. A prova não depende de --out-dir nem acessa o acervo real.
  const collection = "lote-dispatch-teste-e2e";
  const outputsRoot = path.join(workspace.coreRoot, "outputs");
  const generatedDir = path.join(outputsRoot, collection);
  await rm(generatedDir, { recursive: true, force: true });

  const batchRoot = path.join(root, "dispatch");
  await mkdir(batchRoot, { recursive: true });
  const itemsFile = path.join(batchRoot, "itens.json");
  await writeFile(itemsFile, JSON.stringify([
    { name: "parte-um", prompt: "primeira cena" },
    { name: "parte-dois", prompt: "segunda cena" },
  ]), "utf8");
  const stateDir = path.join(batchRoot, ".batches");

  const posts = [];
  let nextFile = 0;
  const fake = await listen(async (request, response) => {
    const url = new URL(request.url, "http://fake.local");
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
      const body = await jsonBody(request);
      posts.push(body.prompt);
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

  try {
    const result = await runAsync([
      "lote", "--collection", collection, "--items", itemsFile,
      // Concorrência do pool tem cobertura dedicada; este E2E valida
      // persistência/inspeção e fica serial para não disputar processos e
      // SQLite com dezenas de arquivos da suíte no modo default do Node.
      "--state-dir", stateDir, "--parallel", "1", "--poll", "0", "--timeout", "5000", "--format", "json",
    ], { endpoint: fake.endpoint });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(posts.length, 2);
    assert.ok(posts.includes("primeira cena"));
    assert.ok(posts.includes("segunda cena"));

    const summary = JSON.parse(result.stdout);
    assert.equal(summary.state, "completed");
    assert.equal(summary.total, 2);
    assert.equal(summary.counts.completed, 2);
    const jobId = summary.id;

    const inspect = run(["batches", "--id", jobId, "--state-dir", stateDir, "--format", "json"]);
    assert.equal(inspect.status, 0, inspect.stderr);
    const job = JSON.parse(inspect.stdout);
    assert.equal(job.collection, collection);
    assert.equal(job.items.length, 2);
    for (const item of job.items) {
      assert.equal(item.state, "completed");
      assert.ok(item.relPath.startsWith(`${collection}/`));
      assert.ok(item.receiptId);
      const videoBytes = await readFile(path.join(outputsRoot, item.relPath));
      assert.ok(videoBytes.equals(MP4));
    }
  } finally {
    await close(fake.server);
    await rm(generatedDir, { recursive: true, force: true });
  }
});
