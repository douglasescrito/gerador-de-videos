import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runTestProcessGroup } from "./fixtures/test-process-group.mjs";

const run = promisify(execFile);
const coreRoot = path.resolve(import.meta.dirname, "..");
const brokerUrl = pathToFileURL(path.join(coreRoot, "lib", "media-pipeline", "resource-broker.mjs")).href;
const leaseUrl = pathToFileURL(path.join(coreRoot, "lib", "media-pipeline", "resource-lease.mjs")).href;

// Provedor simulado: só ocupa a vaga por um tempo medido. Nada de cookie,
// nada de rede, nenhuma geração consumida. O que se prova aqui é a
// coordenação entre processos de verdade — PIDs reais, SQLite aberto ao
// mesmo tempo, encerramento real — que mocks dentro de um processo só não
// conseguem provar.
const WORKER = `
import { writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createResourceBroker } from ${JSON.stringify(brokerUrl)};
import { withResourceLease } from ${JSON.stringify(leaseUrl)};

const [dbFile, reportFile, capacity, holdMs, weight, capacityWaitMs, barrier, index, count] = process.argv.slice(2);
const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": Number(capacity) } });
const queued = [];
const mark = (stage) => writeFileSync(barrier + "." + index + "." + stage, "ready");
async function waitForParticipants(stages) {
  const deadline = Date.now() + 15_000;
  while (!Array.from({ length: Number(count) }, (_, i) => stages.some((stage) => existsSync(barrier + "." + i + "." + stage))).every(Boolean)) {
    if (Date.now() >= deadline) throw new Error("Barreira dos processos não foi alcançada.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
try {
  mark("ready");
  await waitForParticipants(["ready"]);
  const window = await withResourceLease({
    broker,
    resources: [{ id: "provider:omni", weight: Number(weight) }],
    productionId: \`producao-\${process.pid}\`,
    clientId: \`cliente-\${process.pid}\`,
    capacityWaitMs: Number(capacityWaitMs),
    pollMs: 10,
    maxPollMs: 50,
    onQueued: (event) => { queued.push(event.status); mark("queued"); },
  }, async () => {
    const start = Date.now();
    mark("acquired");
    await waitForParticipants(Number(capacity) >= Number(count) * Number(weight) ? ["acquired"] : ["acquired", "queued"]);
    await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
    return { start, end: Date.now() };
  });
  await writeFile(reportFile, JSON.stringify({ pid: process.pid, ok: true, queued, ...window }), "utf8");
} catch (error) {
  await writeFile(reportFile, JSON.stringify({ pid: process.pid, ok: false, queued, error: String(error?.message ?? error) }), "utf8");
  process.exitCode = 1;
}
`;

async function runWorkers(root, { count, capacity, holdMs = 400, weight = 1, capacityWaitMs = 30_000 }) {
  const workerFile = path.join(root, "worker.mjs");
  await writeFile(workerFile, WORKER, "utf8");
  const dbFile = path.join(root, "runtime.sqlite");
  const barrier = path.join(root, `barrier-${randomUUID()}`);
  const reports = Array.from({ length: count }, (_, index) => path.join(root, `report-${index}.json`));
  await Promise.all(reports.map((reportFile, index) => run(
    process.execPath,
    [workerFile, dbFile, reportFile, String(capacity), String(holdMs), String(weight), String(capacityWaitMs), barrier, String(index), String(count)],
    { cwd: coreRoot, windowsHide: true, timeout: 30_000 },
  ).catch((error) => error)));
  return Promise.all(reports.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
}

const overlaps = (left, right) => left.start < right.end && right.start < left.end;

test("quatro aberturas frias na mesma transição WAL inicializam sem perder um produtor", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-cold-open-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = path.join(import.meta.dirname, "fixtures", "cold-broker-worker.mjs");
  const pending = runTestProcessGroup(Array.from({ length: 4 }, (_, id) => ({ id, args: [worker, root, String(id)] })), { timeout: 20_000 });
  const deadline = Date.now() + 15_000;
  let ready;
  do {
    ready = (await readdir(root)).filter(file => file.endsWith(".ready")).length;
    if (ready === 4 || Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (true);
  await writeFile(path.join(root, "go"), "go");
  const results = await pending;
  assert.equal(ready, 4, "todos devem alcançar a transição antes da liberação");
  assert.deepEqual(results.filter(row => row.status !== "fulfilled").map(row => ({ id: row.id, error: row.reason.stderr || row.reason.message })), []);
  assert.ok(results.every(row => row.value.stdout.trim() === "ready"));
});

test("dois processos reais produzem ao mesmo tempo quando há vaga para os dois", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-parallel-"));
  try {
    const windows = await runWorkers(root, { count: 2, capacity: 2 });
    assert.equal(windows.every((entry) => entry.ok), true, JSON.stringify(windows));
    // Dois sucessos em sequência não provariam nada. O que prova é a
    // sobreposição medida dos intervalos de atividade.
    assert.equal(overlaps(windows[0], windows[1]), true, `sem sobreposição: ${JSON.stringify(windows)}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("acima da capacidade a fila anda: todos concluem, nenhum se sobrepõe, nenhum falha", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-queue-"));
  try {
    const windows = await runWorkers(root, { count: 3, capacity: 1, holdMs: 250 });
    assert.equal(windows.every((entry) => entry.ok), true, JSON.stringify(windows));
    // Espera por capacidade não pode virar erro de geração: os três
    // terminam, e ao menos um passou pela fila antes de conseguir a vaga.
    assert.equal(windows.some((entry) => entry.queued.includes("queued")), true, JSON.stringify(windows));
    const ordered = [...windows].sort((left, right) => left.start - right.start);
    for (let index = 1; index < ordered.length; index += 1) {
      assert.equal(overlaps(ordered[index - 1], ordered[index]), false, `pico global violado: ${JSON.stringify(ordered)}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("processo que desiste por falta de capacidade não deixa vaga presa para o próximo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "broker-giveup-"));
  try {
    // Espera curta de propósito: o primeiro segura a vaga além do prazo do
    // segundo, que desiste. Antes da correção o cancelamento podia perder um
    // lease concedido na corrida e a vaga só voltava com o fim do processo.
    const windows = await runWorkers(root, { count: 2, capacity: 1, holdMs: 600, capacityWaitMs: 150 });
    const desistiu = windows.filter((entry) => !entry.ok);
    assert.equal(desistiu.length >= 1, true, JSON.stringify(windows));
    for (const entry of desistiu) assert.match(entry.error, /Sem capacidade/);

    // A prova real: depois da desistência, a vaga está livre de novo.
    const depois = await runWorkers(root, { count: 1, capacity: 1, holdMs: 50, capacityWaitMs: 2_000 });
    assert.equal(depois[0].ok, true, JSON.stringify(depois));
  } finally { await rm(root, { recursive: true, force: true }); }
});
