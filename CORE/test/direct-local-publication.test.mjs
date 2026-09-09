import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFfmpeg, probeMedia } from "../lib/media-pipeline/media-tools.mjs";
import { createArtifactFromFile, sha256File } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt, writeJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { readReceipt } from "../lib/media-pipeline/receipt.mjs";
import { materializeDirectNarration } from "../lib/media-pipeline/direct-narration-stage.mjs";
import { finishVideo } from "../lib/media-pipeline/delivery-profile.mjs";
import { rebuildDirectCollection } from "../lib/media-pipeline/collection-final.mjs";
import { createCliContext } from "../lib/cli/context.mjs";
import { executar } from "../lib/cli/commands/generate.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { buildRuntimeOperationsSnapshot } from "../lib/media-pipeline/operational-reports.mjs";

let root; let video; let audio;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "local-publication-"));
  video = path.join(root, "source.mp4"); audio = path.join(root, "voice.wav");
  await Promise.all([
    runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", video]),
    runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.7", "-c:a", "pcm_s16le", audio]),
  ]);
});
after(async () => { await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(path.join(root, "case-"));
  const source = path.join(dir, "source.mp4"); const voice = path.join(dir, "voice.wav");
  await Promise.all([copyFile(video, source), copyFile(audio, voice)]);
  const wordsFile = path.join(dir, "words.json");
  const words = [{ word: "Teste", start: 0, end: 0.7 }];
  await writeFile(wordsFile, JSON.stringify(words));
  const sourceReceipt = createStageReceipt({ operation: "generate-video", provider: "fixture", mode: "studio", stage: "video", artifacts: [await createArtifactFromFile({ file: source, kind: "video" })] });
  return { dir, source, voice, wordsFile, sourceReceipt, options: {
    plan: { file: path.join(dir, "narrated.mp4"), receipt: path.join(dir, "narrated.receipt.json"), metadata: path.join(dir, "narrated.json") },
    narration: { audioFile: voice, wordsFile, words, timingGuide: "[0.00s–0.70s] Teste" }, source: { file: source, receipt: sourceReceipt },
  } };
}
const unchanged = async (file) => ({ hash: await sha256File(file), mtime: (await stat(file)).mtimeMs });

test("narração recupera MP4 sem recibo por recomputação local sem sobrescrever bytes", async () => {
  const f = await fixture();
  await assert.rejects(materializeDirectNarration({ ...f.options, operations: { writeStageReceipt: async () => { throw new Error("queda antes do recibo"); } } }), /queda/);
  const original = await unchanged(f.options.plan.file);
  const result = await materializeDirectNarration({ ...f.options, recoverExisting: true });
  assert.deepEqual(await unchanged(result.file), original);
  assert.ok((await probeMedia(result.file)).audio);
  assert.equal((await readReceipt(result.receipt)).inputs.length, 3);
});

test("narração recupera sidecar ausente e recusa metadados alterados sem novo mux", async () => {
  const f = await fixture();
  await assert.rejects(materializeDirectNarration({ ...f.options, operations: { writeJsonAtomic: async () => { throw new Error("queda antes do metadata"); } } }), /queda/);
  const original = await unchanged(f.options.plan.file);
  const noMux = { replaceVideoAudio: async () => { assert.fail("recibo completo dispensa mux"); } };
  const result = await materializeDirectNarration({ ...f.options, recoverExisting: true, operations: noMux });
  assert.deepEqual(await unchanged(result.file), original);
  const metadata = JSON.parse(await readFile(result.metadata, "utf8")); metadata.words = 900;
  await writeFile(result.metadata, JSON.stringify(metadata));
  await assert.rejects(materializeDirectNarration({ ...f.options, recoverExisting: true, operations: noMux }), /Metadados.*divergem/);
});

test("sidecar legado sem recibo é recuperado, mas um MP4 diferente permanece intacto", async () => {
  const f = await fixture();
  const initial = await materializeDirectNarration(f.options);
  const sidecar = await readFile(initial.metadata, "utf8");
  await rm(initial.receipt);
  await materializeDirectNarration({ ...f.options, recoverExisting: true });
  assert.equal(await readFile(initial.metadata, "utf8"), sidecar);
  await rm(initial.receipt);
  await writeFile(initial.file, "arquivo de outra operação");
  const original = await unchanged(initial.file);
  await assert.rejects(materializeDirectNarration({ ...f.options, recoverExisting: true }), /existente diverge/);
  assert.deepEqual(await unchanged(initial.file), original);
});

test("acabamento recupera publicação parcial e verifica recibo antes de ocupar encoder", async () => {
  const f = await fixture();
  const outputFile = path.join(f.dir, "finished.mp4");
  const options = { inputFile: f.source, outputFile, profile: "archive-original", parentReceipts: [f.sourceReceipt.id] };
  const initial = await finishVideo(options);
  const original = await unchanged(initial.file);
  await rm(initial.receiptFile);
  await finishVideo({ ...options, recoverExisting: true });
  assert.deepEqual(await unchanged(initial.file), original);
  await finishVideo({ ...options, recoverExisting: true, withEncoderResources: () => assert.fail("não deve renderizar outra vez") });
  await assert.rejects(finishVideo({ ...options, profile: "web-1080p", recoverExisting: true }), /Recibo local diverge/);
});

test("acabamento vincula LUT aos bytes e recusa entrada alterada durante a fila", async () => {
  const f = await fixture();
  const lut = path.join(f.dir, "identity.cube");
  await writeFile(lut, "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n");
  const options = { inputFile: f.source, outputFile: path.join(f.dir, "lut.mp4"), profile: "web-1080p", lut };
  const result = await finishVideo(options);
  assert.equal(result.receipt.inputs[1].role, "delivery-lut");
  await writeFile(lut, "LUT alterada");
  await assert.rejects(finishVideo({ ...options, recoverExisting: true }), /Arquivo local divergente/);
  await assert.rejects(finishVideo({ inputFile: f.source, outputFile: path.join(f.dir, "changed.mp4"), profile: "archive-original", withEncoderResources: async (_encoder, work) => { await writeFile(f.source, "entrada trocada durante a espera"); return work(); } }), /Entrada do acabamento alterada/);
  await assert.rejects(finishVideo({ ...options, profile: "archive-original" }), /LUT exige perfil com reencodificação/);
});

async function collectionFixture() {
  const f = await fixture();
  const collection = { name: "fixture", root: f.dir, mode: "raw", partNumber: 1, videosDir: path.join(f.dir, "videos-soltos"), receiptsDir: path.join(f.dir, "receitas"), finalDir: path.join(f.dir, "videos-unidos"), metadataDir: path.join(f.dir, "metadados"), manifestFile: path.join(f.dir, "manifest.json") };
  await Promise.all([collection.videosDir, collection.receiptsDir, collection.finalDir, collection.metadataDir].map((file) => mkdir(file)));
  collection.finalFile = path.join(collection.finalDir, "joined.mp4");
  collection.assemblyReceipt = path.join(collection.receiptsDir, "assembly-1.receipt.json");
  collection.concatList = path.join(collection.metadataDir, "concat.txt");
  const addPart = async (number) => {
    const file = path.join(collection.videosDir, `parte-${String(number).padStart(3, "0")}.mp4`);
    await copyFile(f.source, file);
    await writeStageReceipt(path.join(collection.receiptsDir, `${path.basename(file)}.receipt.json`), createStageReceipt({ operation: "generate-video", provider: "fixture", mode: "raw", stage: "video", artifacts: [await createArtifactFromFile({ file, kind: "video" })] }));
  };
  await addPart(1);
  const concat = (list, out) => runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  return { ...f, collection, addPart, concat };
}

test("coleção recupera recibo e manifesto ausentes sem regravar master confirmado", async () => {
  const f = await collectionFixture();
  await rebuildDirectCollection(f.collection, { concat: f.concat });
  const original = await unchanged(f.collection.finalFile);
  await rm(f.collection.assemblyReceipt);
  await rebuildDirectCollection(f.collection, { recoverExisting: true, concat: f.concat });
  assert.deepEqual(await unchanged(f.collection.finalFile), original);
  await rm(f.collection.manifestFile);
  await rebuildDirectCollection(f.collection, { recoverExisting: true, concat: () => assert.fail("recibo existente dispensa concatenação") });
  const manifest = JSON.parse(await readFile(f.collection.manifestFile, "utf8"));
  assert.equal(manifest.parts.length, 1);
});

test("coleção retoma troca de agregado anterior e rejeita master alheio ou partes posteriores", async () => {
  const f = await collectionFixture();
  await rebuildDirectCollection(f.collection, { concat: f.concat });
  await f.addPart(2);
  const next = { ...f.collection, partNumber: 2, assemblyReceipt: path.join(f.collection.receiptsDir, "assembly-2.receipt.json") };
  await rebuildDirectCollection(next, { recoverExisting: true, concat: f.concat });
  assert.ok((await probeMedia(next.finalFile)).duration > 1.9);
  await rm(next.assemblyReceipt);
  await writeFile(next.finalFile, "master alheio");
  const original = await unchanged(next.finalFile);
  await assert.rejects(rebuildDirectCollection(next, { recoverExisting: true, concat: f.concat }), /Manifesto anterior diverge/);
  assert.deepEqual(await unchanged(next.finalFile), original);
  await f.addPart(3);
  await assert.rejects(rebuildDirectCollection(next, { recoverExisting: true, concat: f.concat }), /outra parte/);
});

test("generate retoma publicação local, reserva CPU e entrega acabamento com áudio real", async () => {
  const f = await fixture();
  const dbFile = path.join(f.dir, "runtime.sqlite");
  const broker = createResourceBroker({ dbFile, capacities: { "provider:omni": 2, "browser:omni": 1, "cpu:ffmpeg": 1, "gpu:nvenc": 1 } });
  const priorDb = process.env.MKT_VIDEOS_RUNTIME_DB; process.env.MKT_VIDEOS_RUNTIME_DB = dbFile;
  let posts = 0; let fail = true; const resources = []; let stateFile;
  const videoAdapter = createCookieVideoAdapter({
    submit: async (options) => { await options.onBeforeSubmit({}); posts++; await options.onProviderHandle({ fileId: "file-1", attemptId: options.attemptId }); return { fileId: "file-1" }; },
    observeMany: async ({ requests }) => requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })),
    collect: async ({ outputFile, fileId }) => { await copyFile(f.source, outputFile); return { fileId, zeroPost: true }; },
  });
  const invoke = async (args) => {
    const context = await createCliContext(["generate", ...args]); let result;
    const log = console.log; console.log = (value) => { result = JSON.parse(value); };
    try {
      await executar({ ...context, options: context.parse(context.args), cookieRuntime: async () => ({ videoAdapter }), createCliResourceBroker: () => broker,
        withCliResourceLease: (request, work) => context.withCliResourceLease(request, async () => {
          resources.push(request.resources);
          const snapshot = buildRuntimeOperationsSnapshot({ dbFile }).broker;
          assert.equal(snapshot.used["cpu:ffmpeg"], 1);
          assert.equal(snapshot.used["provider:omni"] ?? 0, 0);
          return work();
        }),
        writeJsonAtomic: async (...values) => { if (fail) { fail = false; throw new Error("queda na publicação local"); } return writeJsonAtomic(...values); },
      }); return result;
    } finally { console.log = log; }
  };
  try {
    await assert.rejects(invoke(["--prompt", "Cena visual", "--out", path.join(f.dir, "generated.mp4"), "--mode", "studio", "--style", "flat-2d@1", "--poll", "1", "--narration-audio", f.voice, "--word-timestamps", f.wordsFile, "--delivery-profile", "archive-original"]), (error) => { stateFile = error.generateStateFile; return /queda na publicação local/.test(error.message); });
    const result = await invoke(["--resume", stateFile]);
    assert.equal(posts, 1);
    assert.ok((await probeMedia(result.finished.file)).audio);
    assert.equal((await readReceipt(result.finished.receipt)).inputs[0].file, result.narration.file);
    assert.ok(resources.every((items) => items.length === 1 && items[0] === "cpu:ffmpeg"));
    assert.equal(buildRuntimeOperationsSnapshot({ dbFile }).broker.activeLeases, 0);
  } finally { if (priorDb === undefined) delete process.env.MKT_VIDEOS_RUNTIME_DB; else process.env.MKT_VIDEOS_RUNTIME_DB = priorDb; }
});
