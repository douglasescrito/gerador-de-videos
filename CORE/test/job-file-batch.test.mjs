import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { runJobFileBatchPhases, readJobFileBatchResume } from "../lib/media-pipeline/job-file-batch.mjs";
import { createConcurrencyController, profileForParallel } from "../lib/media-pipeline/omni-concurrency.mjs";
import { createCliContext } from "../lib/cli/context.mjs";
import { executar } from "../lib/cli/commands/batch.mjs";
import { createProductionProviderInputAuthorization, createDirectProviderInputPermitFromProductionAuthorization } from "../lib/media-pipeline/direct-provider-input-permit.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";

const mp4 = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
async function setup(t, { failBeforePost = 0, failAfterPost = false, failCollection = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "job-file-batch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const broker = createResourceBroker({ dbFile: path.join(root, "runtime.sqlite"), capacities: { "provider:omni": 2, "browser:omni": 1 } });
  let posts = 0; let collections = 0; let inputChecks = 0;
  let submissionCalls = 0;
  const videoAdapter = createCookieVideoAdapter({
    async submit(options) {
      await options.onBeforeSubmit({});
      if (++submissionCalls <= failBeforePost) throw Object.assign(new Error("Falha local antes do POST"), { postStarted: false });
      const fileId = `file-${++posts}`;
      if (failAfterPost) throw Object.assign(new Error("Resposta perdida após POST"), { postStarted: true });
      await options.onProviderHandle({ fileId, attemptId: options.attemptId });
      return { fileId };
    },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect({ outputFile, fileId }) {
      collections += 1;
      if (failCollection && collections === 1) throw new Error("download interrompido");
      await writeFile(outputFile, mp4); return { fileId, zeroPost: true };
    },
  });
  const preparedJobs = ["a", "b", "c"].map((name, index) => ({ number: index + 1, job: { id: name }, label: name, prompt: `literal ${name}`, mode: "raw", composition: { userPrompt: `literal ${name}`, effectivePrompt: `literal ${name}` }, task: "text_to_video", aspectRatio: "16:9", images: [], referenceVideo: null, outputFile: path.join(root, `${name}.mp4`), timeoutMs: 30_000, pollIntervalMs: 1 }));
  const options = { preparedJobs, videoAdapter, broker, concurrency: createConcurrencyController({ profile: profileForParallel(1) }), outDir: root, jobsFile: path.join(root, "jobs.json"), productionId: null, productionAuthorization: null, permits: new Map(), descriptors: new Map(), metadataFor: (prepared) => ({ mode: "raw", promptComposition: prepared.composition }), assertInputs: async () => { inputChecks += 1; }, frozenOptions: { jobs: path.join(root, "jobs.json"), "out-dir": root } };
  return { root, options, get posts() { return posts; }, get collections() { return collections; }, get inputChecks() { return inputChecks; }, get submissionCalls() { return submissionCalls; } };
}

async function authorizedOptions(f, productionId) {
  const file = path.join(f.root, "reference.png");
  await writeFile(file, "reference-image");
  const inputs = [{ file, role: "reference-image", operation: "generate-video" }];
  const productionAuthorization = await createProductionProviderInputAuthorization({ productionId, inputs, confirmProviderInput: true, maxAttempts: 2 });
  const permit = await createDirectProviderInputPermitFromProductionAuthorization({ authorization: productionAuthorization, productionId, inputs });
  return { ...f.options, preparedJobs: [{ ...f.options.preparedJobs[0], task: "reference_to_video", images: [file] }], productionId, productionAuthorization, permits: new Map([[1, permit]]), descriptors: new Map([[1, inputs]]) };
}

test("fases retomam falha anterior ao POST na mesma invocação dentro da autorização", async (t) => {
  const f = await setup(t, { failBeforePost: 1 });
  const result = await runJobFileBatchPhases(await authorizedOptions(f, "batch-retry"));
  assert.equal(result.results[0].ok, true);
  assert.equal(f.posts, 1);
  assert.equal(f.submissionCalls, 2);
  assert.equal(result.results[0].attempts.length, 2);
  assert.notEqual(result.results[0].attempts[0].attemptId, result.results[0].attempts[1].attemptId);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: f.options.broker.dbFile }).broker.remoteInFlight, 0);
});

test("fases esgotam o limite autorizado sem criar retry ilimitado", async (t) => {
  const f = await setup(t, { failBeforePost: 5 });
  const result = await runJobFileBatchPhases(await authorizedOptions(f, "batch-retry-limit"));
  assert.equal(result.results[0].ok, false);
  assert.equal(f.posts, 0);
  assert.equal(f.submissionCalls, 2);
  assert.equal(result.results[0].attempts.length, 2);
});

test("batch --jobs usa fases com destinos originais e retoma concluídos sem POST nem coleta", async (t) => {
  const f = await setup(t);
  const first = await runJobFileBatchPhases(f.options);
  assert.equal(first.executionTiming.scope, "batch-invocation");
  assert.ok(first.executionTiming.phaseMs["capacity-wait"] !== null);
  assert.equal(first.executionTiming.remoteProcessingMs, null);
  assert.equal(first.results.filter((item) => item.ok).length, 3);
  assert.equal(f.posts, 3);
  assert.equal(f.inputChecks, 3);
  const resume = await readJobFileBatchResume(first.stateFile);
  assert.deepEqual(resume.job.executionTiming, first.executionTiming);
  const second = await runJobFileBatchPhases({ ...f.options, resume });
  assert.deepEqual(second.results.map(({ file }) => file), f.options.preparedJobs.map(({ outputFile }) => outputFile));
  assert.equal(f.posts, 3);
  assert.equal(f.collections, 3);
  assert.equal(second.executionTiming.phaseMs.submission, null);
  assert.equal(second.executionTiming.phaseMs.download, null);
  await writeFile(f.options.preparedJobs[0].outputFile, "adulterado");
  await assert.rejects(runJobFileBatchPhases({ ...f.options, resume: await readJobFileBatchResume(first.stateFile) }), /divergente/);
  assert.equal(f.posts, 3);
});

test("resposta de POST perdida mantém a reserva e resume nunca reenvia sem prova", async (t) => {
  const f = await setup(t, { failAfterPost: true });
  const options = { ...f.options, preparedJobs: f.options.preparedJobs.slice(0, 1) };
  const first = await runJobFileBatchPhases(options);
  assert.equal(first.results[0].state, "ambiguous");
  const resumed = await runJobFileBatchPhases({ ...options, resume: await readJobFileBatchResume(first.stateFile) });
  assert.equal(resumed.results[0].state, "ambiguous");
  assert.equal(f.posts, 1);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: f.options.broker.dbFile }).broker.remoteInFlight, 1);
});

test("download interrompido retoma por handle e preserva o attemptId", async (t) => {
  const f = await setup(t, { failCollection: true });
  const options = { ...f.options, preparedJobs: f.options.preparedJobs.slice(0, 1) };
  const first = await runJobFileBatchPhases(options);
  assert.equal(first.results[0].ok, false);
  const resumed = await runJobFileBatchPhases({ ...options, resume: await readJobFileBatchResume(first.stateFile) });
  assert.equal(resumed.results[0].ok, true);
  assert.equal(resumed.results[0].attempts[0].attemptId, first.results[0].attempts[0].attemptId);
  assert.equal(f.posts, 1);
  assert.equal(f.collections, 2);
});

test("queda após gravar MP4/receipt recupera o mesmo artefato e recusa outro prompt", async (t) => {
  const f = await setup(t);
  const first = await runJobFileBatchPhases(f.options);
  const raw = JSON.parse(await readFile(first.stateFile, "utf8"));
  raw.items[0].state = "persisting";
  delete raw.items[0].delivery;
  await writeFile(first.stateFile, JSON.stringify(raw));
  const resumed = await runJobFileBatchPhases({ ...f.options, resume: await readJobFileBatchResume(first.stateFile) });
  assert.equal(resumed.results[0].ok, true);
  assert.equal(f.posts, 3);
  assert.equal(f.collections, 3);
  const preparedJobs = structuredClone(f.options.preparedJobs);
  preparedJobs[0].prompt = "pedido diferente";
  await assert.rejects(runJobFileBatchPhases({ ...f.options, preparedJobs, resume: await readJobFileBatchResume(first.stateFile) }), /diverge/);
  assert.equal(f.posts, 3);
});

test("MP4 publicado sem receipt é conferido pela coleta do mesmo handle e nunca sobrescrito", async (t) => {
  const f = await setup(t);
  const first = await runJobFileBatchPhases(f.options);
  const output = f.options.preparedJobs[0].outputFile;
  async function partial() {
    const raw = JSON.parse(await readFile(first.stateFile, "utf8"));
    raw.items[0].state = "persisting";
    delete raw.items[0].delivery;
    await writeFile(first.stateFile, JSON.stringify(raw));
    await rm(`${output}.receipt.json`);
    return readJobFileBatchResume(first.stateFile);
  }
  const recovered = await runJobFileBatchPhases({ ...f.options, resume: await partial() });
  assert.equal(recovered.results[0].ok, true);
  assert.equal(f.posts, 3);
  assert.equal(f.collections, 4);
  assert.deepEqual(await readFile(output), mp4);
  const resume = await partial();
  await writeFile(output, "conteúdo alheio");
  const refused = await runJobFileBatchPhases({ ...f.options, resume });
  assert.equal(refused.results[0].ok, false);
  assert.match(refused.results[0].error, /diverge/);
  assert.equal(await readFile(output, "utf8"), "conteúdo alheio");
  assert.equal(f.posts, 3);
});

test("handler batch emite summary compatível e aceita somente --resume na retomada", async (t) => {
  const f = await setup(t);
  const jobsFile = path.join(f.root, "jobs.json");
  await writeFile(jobsFile, JSON.stringify([{ id: "clip", prompt: "literal" }]));
  const context = await createCliContext(["batch", "--jobs", jobsFile, "--out-dir", f.root, "--poll", "0"]);
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (text) => lines.push(JSON.parse(text)); console.error = () => {};
  t.after(() => Object.assign(console, original));
  const runtime = { cookieRuntime: async () => ({ videoAdapter: f.options.videoAdapter }), createCliResourceBroker: () => f.options.broker };
  await executar({ ...context, ...runtime, options: context.parse(context.args) });
  const first = lines.at(-1);
  assert.equal(first.schema, "mkt-videos/batch-summary@2");
  assert.equal(first.ok, 1);
  assert.equal(first.lifecycle, "submit-observe-collect");
  assert.equal(first.executionTiming.scope, "batch-invocation");
  assert.equal(f.posts, 1);
  const resumed = await createCliContext(["batch", "--resume", first.stateFile]);
  await executar({ ...resumed, ...runtime, options: resumed.parse(resumed.args) });
  assert.equal(lines.at(-1).ok, 1);
  assert.notEqual(lines.at(-1).summaryFile, first.summaryFile);
  assert.equal(f.posts, 1);
  assert.deepEqual(JSON.parse(await readFile(first.summaryFile, "utf8")).results, first.results);
});

test("batch preserva referências por job e autorização de produção durante resume", async (t) => {
  const f = await setup(t);
  const reference = path.join(f.root, "reference.png");
  const source = path.join(f.root, "source.mp4");
  await writeFile(reference, "image-source");
  await writeFile(source, mp4);
  const jobsFile = path.join(f.root, "jobs.json");
  await writeFile(jobsFile, JSON.stringify([
    { id: "reference", prompt: "com referência", images: [reference] },
    { id: "edit", prompt: "edição literal", video: source },
    { id: "text", prompt: "sem referência" },
  ]));
  const args = ["batch", "--jobs", jobsFile, "--out-dir", f.root, "--production-id", "batch-inputs", "--production-authorization", path.join(f.root, "authorization.json"), "--confirm-provider-input", "true", "--poll", "0"];
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (value) => lines.push(JSON.parse(value)); console.error = () => {};
  t.after(() => Object.assign(console, original));
  const runtime = { cookieRuntime: async () => ({ videoAdapter: f.options.videoAdapter }), createCliResourceBroker: () => f.options.broker };
  async function run(argv) {
    const context = await createCliContext(argv);
    await executar({ ...context, ...runtime, options: context.parse(context.args) });
    return lines.at(-1);
  }
  const first = await run(args);
  assert.equal(first.ok, 3);
  const receipts = await Promise.all(first.results.map(async (result) => JSON.parse(await readFile(result.receipt, "utf8"))));
  assert.deepEqual(receipts.map((receipt) => receipt.inputs.length), [1, 1, 0]);
  assert.deepEqual(receipts.map((receipt) => receipt.parameters.task), ["reference_to_video", "edit", "text_to_video"]);
  const resumed = await run(["batch", "--resume", first.stateFile]);
  assert.equal(resumed.ok, 3);
  assert.equal(f.posts, 3);
  await writeFile(reference, "changed-reference");
  await assert.rejects(run(["batch", "--resume", first.stateFile]), /autorização/);
  assert.equal(f.posts, 3);
});
