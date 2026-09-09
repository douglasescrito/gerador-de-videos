// Processo real, transporte simulado: usa o handler público e o broker SQLite.
import { writeFile, readdir } from "node:fs/promises";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCliContext } from "../../lib/cli/context.mjs";
import { executar } from "../../lib/cli/commands/generate.mjs";
import { createResourceBroker } from "../../lib/media-pipeline/resource-broker.mjs";
import { createCookieVideoAdapter } from "../../scripts/cookie-studio-operations.mjs";
import { buildRuntimeOperationsSnapshot } from "../../lib/media-pipeline/operational-reports.mjs";

const [root, id, route = "generate"] = process.argv.slice(2);
const record = (event) => appendFileSync(path.join(root, `${id}.events.jsonl`), JSON.stringify({ at: Date.now(), ...event }) + "\n");
record({ phase: "worker-start" });
const broker = createResourceBroker({ dbFile: path.join(root, "runtime.sqlite"), capacities: { "provider:omni": 2, "browser:omni": 1, "provider:flow": 1, "provider:vids": 1, "cpu:ffmpeg": 1 } });
record({ phase: "broker-ready" });
const intervals = []; const snapshots = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const windowProof = path.join(root, "remote-window-observed");
function capture() {
  const snapshot = buildRuntimeOperationsSnapshot({ dbFile: broker.dbFile });
  if (snapshot.status === "ready") {
    snapshots.push({ at: Date.now(), ...snapshot.broker });
    if (snapshot.broker.remoteInFlight === 2 && (snapshot.broker.used["browser:omni"] ?? 0) === 0) {
      try { writeFileSync(windowProof, JSON.stringify(snapshot.broker), { flag: "wx" }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  } else record({ phase: "snapshot-unavailable", status: snapshot.status });
}
const measuredBroker = { ...broker, release(leaseId) { const result = broker.release(leaseId); capture(); return result; } };
let remoteStart; let remoteEnd;
const adapter = createCookieVideoAdapter({
  async submit(options) {
    record({ phase: "submit-enter" });
    await options.onBeforeSubmit({});
    const start = Date.now();
    await sleep(70);
    remoteStart = Date.now();
    await options.onProviderHandle({ fileId: id, attemptId: options.attemptId });
    await writeFile(path.join(root, `${id}.submitted`), String(remoteStart));
    record({ phase: "submit-end" });
    intervals.push({ phase: "submit", start, end: Date.now() });
    return { fileId: id };
  },
  async observeMany({ requests }) {
    const start = Date.now();
    const count = (await readdir(root)).filter((file) => file.endsWith(".submitted")).length;
    const ready = count >= 2 && existsSync(windowProof);
    record({ phase: "observe", count, ready });
    await sleep(40);
    intervals.push({ phase: "observe", start, end: Date.now() });
    if (ready) remoteEnd ??= Date.now();
    return requests.map(({ fileId }) => ({ fileId, classification: ready ? "ready" : "pending", zeroPost: true }));
  },
  async collect({ outputFile, fileId }) {
    const start = Date.now();
    await sleep(70);
    await writeFile(outputFile, Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
    intervals.push({ phase: "collect", start, end: Date.now() });
    return { fileId, zeroPost: true };
  },
});
const timer = setInterval(capture, 25);
try {
  if (route === "audio-local") {
    const { withResourceLease } = await import("../../lib/media-pipeline/resource-lease.mjs");
    const waitFor = async (condition) => {
      const deadline = Date.now() + 30_000;
      while (!condition()) { if (Date.now() > deadline) throw new Error("barreira de recursos excedeu limite"); await sleep(10); }
    };
    await Promise.all([
      ...["flow", "vids"].map((provider) => withResourceLease({ broker: measuredBroker, productionId: `${id}-${provider}`, resources: [`provider:${provider}`] }, async () => {
        const start = Date.now();
        await writeFile(path.join(root, `${provider}.active`), "active");
        await waitFor(() => existsSync(windowProof) && existsSync(path.join(root, "local.completed")));
        intervals.push({ phase: provider, start, end: Date.now() });
      })),
      withResourceLease({ broker: measuredBroker, productionId: `${id}-local`, resources: ["cpu:ffmpeg"] }, async () => {
        await waitFor(() => ["flow", "vids"].every((provider) => existsSync(path.join(root, `${provider}.active`))));
        const start = Date.now();
        await sleep(40);
        intervals.push({ phase: "local", start, end: Date.now() });
        await writeFile(path.join(root, "local.completed"), "completed");
      }),
    ]);
  } else if (route === "studio") {
    const { compileFilmSpec } = await import("../../lib/media-pipeline/film-compiler.mjs");
    const { createExecutionKernel } = await import("../../lib/media-pipeline/execution-kernel.mjs");
    const { recordExecutionNodeApproval } = await import("../../lib/media-pipeline/execution-journal.mjs");
    const plan = compileFilmSpec({ name: id, scenes: [{ id, prompt: `literal ${id}`, generationTask: "text_to_video", duration: 2 }], qa: false, budget: { image: 0, tts: 0, music: 0, omni: 1, semanticQa: 0 } });
    const dbFile = path.join(root, `${id}.journal.sqlite`);
    const kernel = createExecutionKernel({ dbFile, plan, resourceBroker: measuredBroker, confirmFingerprint: plan.governance.approval.fingerprint });
    for (const nodeId of ["alignment", "timeline-lock", `keyframe:${id}`, "animatic"]) await kernel.executeLocalNode({ nodeId, execute: async () => ({ completed: true }) });
    recordExecutionNodeApproval({ dbFile, nodeId: "animatic-approval", targetHash: "a".repeat(64), actor: "test:human", approvedAt: new Date() });
    await kernel.executePaidNode({ nodeId: `video:${id}`, phasedVideo: { adapter, options: { prompt: `literal ${id}`, task: "text_to_video", outputFile: path.join(root, `${id}.mp4`), pollIntervalMs: 80, timeoutMs: 30_000, metadata: { mode: "studio", executionKernel: "required" } } } });
  } else if (route === "batch") {
    const { executar: executeBatch } = await import("../../lib/cli/commands/batch.mjs");
    const jobsFile = path.join(root, `${id}.jobs.json`);
    await writeFile(jobsFile, JSON.stringify([{ id, prompt: `literal ${id}`, task: "text_to_video" }]));
    const context = await createCliContext(["batch", "--jobs", jobsFile, "--out-dir", path.join(root, `${id}-batch`), "--parallel", "1", "--poll", "80"]);
    await executeBatch({ ...context, options: context.parse(context.args), cookieRuntime: async () => ({ videoAdapter: adapter }), createCliResourceBroker: () => measuredBroker });
  } else if (route === "generate") {
  const context = await createCliContext(["generate", "--prompt", `literal ${id}`, "--out", path.join(root, `${id}.mp4`), "--poll", "80"]);
  record({ phase: "context-ready" });
  await executar({ ...context, options: context.parse(context.args), cookieRuntime: async () => ({ videoAdapter: adapter }), createCliResourceBroker: () => measuredBroker });
  } else throw new Error(`Rota de teste desconhecida: ${route}`);
} finally {
  clearInterval(timer);
  await writeFile(path.join(root, `${id}.report.json`), JSON.stringify({ pid: process.pid, route, intervals, snapshots, remoteStart, remoteEnd }));
}
