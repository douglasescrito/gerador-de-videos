import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { createCliContext } from "../lib/cli/context.mjs";
import { executar } from "../lib/cli/commands/generate.mjs";
import { readDirectGenerateResume } from "../lib/media-pipeline/direct-video-phases.mjs";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";

const mp4 = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
async function setup(t, { failAfterPost = false, failCollection = false, failBeforePost = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-video-phases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousDb = process.env.MKT_VIDEOS_RUNTIME_DB;
  process.env.MKT_VIDEOS_RUNTIME_DB = path.join(root, "runtime.sqlite");
  t.after(() => { if (previousDb === undefined) delete process.env.MKT_VIDEOS_RUNTIME_DB; else process.env.MKT_VIDEOS_RUNTIME_DB = previousDb; });
  const broker = createResourceBroker({ dbFile: path.join(root, "runtime.sqlite"), capacities: { "provider:omni": 2, "browser:omni": 1, "cpu:ffmpeg": 1, "gpu:nvenc": 1 } });
  const submissions = []; const collections = [];
  let calls = 0;
  const videoAdapter = createCookieVideoAdapter({
    async submit(options) {
      await options.onBeforeSubmit({});
      if (failBeforePost && calls++ === 0) throw Object.assign(new Error("Falha local antes do envio"), { postStarted: false });
      const fileId = `file-${submissions.length + 1}`;
      submissions.push({ prompt: options.prompt, task: options.task, attemptId: options.attemptId, fileId });
      if (failAfterPost) throw Object.assign(new Error("Resposta perdida após envio"), { postStarted: true });
      await options.onProviderHandle({ fileId, attemptId: options.attemptId });
      return { fileId };
    },
    async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    async collect({ outputFile, fileId }) {
      collections.push(fileId);
      if (failCollection && collections.length === 1) throw new Error("download interrompido");
      await writeFile(outputFile, mp4); return { fileId, zeroPost: true };
    },
  });
  const outputFile = path.join(root, "clip.mp4");
  async function invoke(args, overrides = {}) {
    const context = await createCliContext(["generate", ...args]);
    const lines = []; const log = console.log;
    console.log = (line) => lines.push(JSON.parse(line));
    try {
      await executar({ ...context, options: context.parse(context.args), cookieRuntime: async () => ({ videoAdapter }), createCliResourceBroker: () => broker, ...overrides });
      return lines.at(-1);
    } finally { console.log = log; }
  }
  return { root, broker, outputFile, submissions, collections, invoke, args: ["--prompt", "Direção literal. Não expandir.", "--out", outputFile, "--poll", "1"] };
}

test("generate usa fases, preserva raw e retoma entrega verificada sem outro POST", async (t) => {
  const f = await setup(t);
  const result = await f.invoke(f.args);
  assert.equal(result.lifecycle, "submit-observe-collect");
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].prompt, "Direção literal. Não expandir.");
  const receipt = JSON.parse(await readFile(result.receipt, "utf8"));
  assert.equal(receipt.parameters.attemptId, f.submissions[0].attemptId);
  assert.equal(receipt.metadata.mode, "raw");
  const resumed = await f.invoke(["--resume", result.stateFile]);
  assert.deepEqual(resumed, result);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.collections.length, 1);
  await assert.rejects(f.invoke(f.args), /retome a tentativa registrada/);
  await writeFile(f.outputFile, "alterado");
  await assert.rejects(f.invoke(["--resume", result.stateFile]), /divergente/);
  assert.equal(f.submissions.length, 1);
});

test("generate retoma download da mesma tentativa e publica o stateFile na falha", async (t) => {
  const f = await setup(t, { failCollection: true });
  let failure;
  await assert.rejects(f.invoke(f.args), (error) => { failure = error; return /generate --resume/.test(error.message); });
  assert.ok(failure.generateStateFile);
  const before = await readDirectGenerateResume(failure.generateStateFile);
  const result = await f.invoke(["--resume", failure.generateStateFile, "--poll", "1"]);
  const after = await readDirectGenerateResume(result.stateFile);
  assert.equal(after.job.items[0].attemptId, before.job.items[0].attemptId);
  assert.deepEqual(f.collections, ["file-1", "file-1"]);
  assert.equal(f.submissions.length, 1);
});

test("generate mantém envio sem handle ambíguo e recusa uma segunda submissão", async (t) => {
  const f = await setup(t, { failAfterPost: true });
  let stateFile;
  await assert.rejects(f.invoke(f.args), (error) => { stateFile = error.generateStateFile; return Boolean(stateFile); });
  await assert.rejects(f.invoke(["--resume", stateFile]), /Retome com/);
  await assert.rejects(f.invoke(f.args), /retome a tentativa registrada/);
  assert.equal(f.submissions.length, 1);
  const state = await readDirectGenerateResume(stateFile);
  assert.equal(state.job.items[0].state, "ambiguous");
});

test("generate retoma falha comprovadamente anterior ao POST sem ampliar maxAttempts", async (t) => {
  const f = await setup(t, { failBeforePost: true });
  let stateFile;
  await assert.rejects(f.invoke(f.args), (error) => { stateFile = error.generateStateFile; return Boolean(stateFile); });
  assert.equal(f.submissions.length, 0);
  const result = await f.invoke(["--resume", stateFile, "--poll", "1"]);
  const state = await readDirectGenerateResume(result.stateFile);
  assert.equal(state.job.retryPolicy.maxAttempts, 1);
  assert.equal(f.submissions.length, 1);
});

test("generate congela destinos e argumentos sem guardar confirmação ou autenticação", async (t) => {
  const f = await setup(t);
  const result = await f.invoke([...f.args, "--auth", "credential-manager", "--confirm-provider-input", "true"]);
  const state = await readDirectGenerateResume(result.stateFile);
  assert.equal(state.options.auth, undefined);
  assert.equal(state.options["confirm-provider-input"], undefined);
  assert.equal(state.options.out, f.outputFile);
  await assert.rejects(f.invoke(["--resume", result.stateFile, "--prompt", "outro pedido"]), /preserva o pedido salvo/);
  state.job.retryPolicy.maxAttempts = 3;
  await writeFile(result.stateFile, JSON.stringify(state.job));
  await assert.rejects(f.invoke(["--resume", result.stateFile]), /limite de tentativas/);
  assert.equal(f.submissions.length, 1);
});

test("generate revalida referência na retomada e auto preserva seu papel", async (t) => {
  const f = await setup(t, { failCollection: true });
  const image = path.join(f.root, "reference.png");
  await writeFile(image, "referencia-original");
  let stateFile;
  const args = [...f.args, "--first-frame", image, "--task", "auto", "--confirm-provider-input", "true"];
  await assert.rejects(f.invoke(args), (error) => { stateFile = error.generateStateFile; return Boolean(stateFile); });
  assert.equal(f.submissions[0].task, "image_to_video");
  await assert.rejects(f.invoke(["--resume", stateFile]), /confirm-provider-input/);
  const result = await f.invoke(["--resume", stateFile, "--confirm-provider-input", "true", "--poll", "1"]);
  const receipt = JSON.parse(await readFile(result.receipt, "utf8"));
  assert.equal(receipt.inputs[0].role, "first-frame");
  await writeFile(image, "outra referencia");
  await assert.rejects(f.invoke(["--resume", stateFile, "--confirm-provider-input", "true"]), /diverge/);
  assert.equal(f.submissions.length, 1);
});

test("generate recusa opções locais incompatíveis antes de chamar runtime", async (t) => {
  const f = await setup(t);
  await assert.rejects(f.invoke([...f.args, "--lut", "missing.cube"], { cookieRuntime: async () => { assert.fail("não deve carregar provider"); } }), /exige --delivery-profile/);
  await assert.rejects(f.invoke([...f.args, "--mode", "studio", "--style", "flat-2d@1", "--delivery-profile", "inventado"], { cookieRuntime: async () => { assert.fail("não deve carregar provider"); } }), /Perfil de entrega desconhecido/);
  assert.equal(f.submissions.length, 0);
});

test("generate reserva CPU e GPU juntas somente no acabamento NVENC escolhido", async (t) => {
  const f = await setup(t);
  let checked = false;
  await f.invoke([...f.args, "--mode", "studio", "--style", "flat-2d@1", "--delivery-profile", "web-1080p", "--accel", "nvenc"], {
    finishVideo: ({ outputFile, withEncoderResources }) => withEncoderResources({ accel: "nvenc" }, async () => {
      const snapshot = buildRuntimeOperationsSnapshot({ dbFile: f.broker.dbFile }).broker;
      assert.equal(snapshot.used["gpu:nvenc"], 1);
      assert.equal(snapshot.used["cpu:ffmpeg"], 1);
      assert.equal(snapshot.used["provider:omni"] ?? 0, 0);
      checked = true;
      await writeFile(outputFile, mp4);
      const receiptFile = `${outputFile}.receipt.json`;
      await writeFile(receiptFile, "fixture do encoder");
      return { file: outputFile, receiptFile };
    }),
  });
  assert.equal(checked, true);
  assert.equal(buildRuntimeOperationsSnapshot({ dbFile: f.broker.dbFile }).broker.activeLeases, 0);
});

test("generate revalida admissão junto ao envio e junto à coleta", async (t) => {
  const f = await setup(t);
  let block = "before-submit"; let stateFile;
  const phases = [];
  const overrides = { createDirectAdmission: () => async ({ phase }) => {
    phases.push(phase);
    return phase === block ? { status: "blocked", blockers: ["capability_expired"] } : { status: "ready", blockers: [] };
  } };
  await assert.rejects(f.invoke(f.args, overrides), (error) => { stateFile = error.generateStateFile; return /capability_expired/.test(error.message); });
  assert.equal(f.submissions.length, 0);
  block = "before-collect";
  await assert.rejects(f.invoke(["--resume", stateFile], overrides), /capability_expired/);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.collections.length, 0);
  block = null;
  await f.invoke(["--resume", stateFile], overrides);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.collections.length, 1);
  assert.ok(phases.includes("before-submit"));
  assert.ok(phases.includes("before-collect"));
});

test("generate usa recibo de coleção e reaproveita etapas locais após falha posterior", async (t) => {
  const f = await setup(t);
  const customReceipt = path.join(f.root, "receitas", "parte.receipt.json");
  const audio = path.join(f.root, "voice.wav");
  const words = path.join(f.root, "words.json");
  await writeFile(audio, "audio material local");
  await writeFile(words, JSON.stringify([{ word: "Olá", start: 0, end: 1 }]));
  let muxes = 0; let assemblies = 0; let finishes = 0; let stateFile;
  const overrides = {
    collectionOutputPlan: async () => ({ outputFile: f.outputFile, receiptFile: customReceipt, collection: null }),
    rebuildCollectionFinal: async () => { assemblies++; return null; },
    replaceVideoAudio: async ({ outputFile }) => { muxes++; await writeFile(outputFile, mp4); return { outputDuration: 1 }; },
    finishVideo: async ({ outputFile, inputFile, parentReceipts }) => {
      if (++finishes === 1) throw new Error("falha local de acabamento");
      await writeFile(outputFile, mp4);
      const artifact = await createArtifactFromFile({ file: outputFile, kind: "video" });
      const input = await createArtifactFromFile({ file: inputFile, kind: "video" });
      const receipt = createStageReceipt({ operation: "finish-video", provider: "ffmpeg", mode: "studio", stage: "delivery", inputs: [input], artifacts: [artifact], parentReceipts });
      await writeStageReceipt(`${outputFile}.receipt.json`, receipt);
      return { file: outputFile, receiptFile: `${outputFile}.receipt.json`, receipt };
    },
  };
  await assert.rejects(f.invoke([...f.args, "--mode", "studio", "--style", "flat-2d@1", "--narration-audio", audio, "--word-timestamps", words, "--delivery-profile", "archive-original"], overrides), (error) => { stateFile = error.generateStateFile; return /falha local de acabamento/.test(error.message); });
  assert.ok(stateFile);
  assert.equal(muxes, 1);
  assert.equal(assemblies, 1);
  const result = await f.invoke(["--resume", stateFile], overrides);
  assert.equal(result.receipt, customReceipt);
  assert.equal(muxes, 1);
  assert.equal(assemblies, 1);
  assert.equal(finishes, 2);
  assert.equal(f.submissions.length, 1);
  const raw = await readFile(f.outputFile);
  assert.deepEqual(raw, mp4);
  await writeFile(result.narration.file, "alterado");
  await assert.rejects(f.invoke(["--resume", stateFile], overrides), /Entrega local alterada/);
  assert.equal(f.submissions.length, 1);
});
