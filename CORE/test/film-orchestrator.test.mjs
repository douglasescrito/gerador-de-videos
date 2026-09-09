import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileFilmVideo, validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import {
  approveDraft,
  createStageReceipt,
  executionTimelineDurationSeconds,
  planFilm,
  overrideFilmQa,
  readFilmState,
  resumeFilm,
  runFilm,
  statusFilm,
  writeFileAtomic,
  writeJsonAtomic,
  writeStageReceipt,
} from "../lib/media-pipeline/index.mjs";

test("duração musical deriva da timeline travada em frames", () => {
  assert.equal(executionTimelineDurationSeconds({ timeline: { locked: true, durationFrames: 4320, timeBase: { numerator: 1, denominator: 24 } } }), 180);
  assert.equal(executionTimelineDurationSeconds({ timeline: { locked: false, durationFrames: 4320, timeBase: { numerator: 1, denominator: 24 } } }), null);
});

function spec() {
  return {
    name: "teste-filme",
    scenes: [{ id: "abertura", prompt: "Uma esfera azul sobre fundo branco" }],
    narration: {
      provider: "google-vids",
      documentUrl: "https://docs.google.com/videos/d/test/edit",
      text: "Hoje começa uma nova história.",
      voice: "Nyla",
      blocks: [{ id: "narration-1", text: "Hoje começa uma nova história." }],
    },
    music: { preset: "institucional", backend: "flow-music" },
    qa: false,
    delivery: { profile: "web-1080p" },
  };
}

function multiVoiceSpec() {
  const input = spec();
  input.music = null;
  input.delivery = null;
  input.narration = {
    ...input.narration,
    speakerMode: "multi-voice",
    text: "Primeira fala. Segunda fala.",
    speakers: [{ id: "primeiro", voice: "Nyla" }, { id: "segundo", voice: "Charon" }],
    blocks: [
      { id: "abertura", speakerId: "primeiro", text: "Primeira fala." },
      { id: "resposta", speakerId: "segundo", text: "Segunda fala." },
    ],
  };
  return input;
}

test("multivoz preserva falantes e prevê uma chamada por bloco", () => {
  const input = multiVoiceSpec();
  const normalized = validateFilmSpec(input);
  assert.equal(normalized.narration.speakerMode, "multi-voice");
  assert.deepEqual(normalized.narration.blocks.map((block) => block.speakerId), ["primeiro", "segundo"]);
  assert.equal(normalized.calls.tts, 2);
  assert.deepEqual(normalized.narration.speakers, input.narration.speakers);
  assert.equal(validateFilmSpec(spec()).calls.tts, 1);
});

test("multivoz rejeita falante desconhecido antes de gerar", () => {
  const input = multiVoiceSpec();
  input.narration.blocks[1].speakerId = "ausente";
  assert.throws(() => validateFilmSpec(input), /speakerId.*declarado/);
});

test("multivoz rejeita modos, vozes ausentes e identidades ambíguas", () => {
  for (const [change, expected] of [
    [(n) => { n.speakerMode = "multiple"; }, /speakerMode inválido/],
    [(n) => { n.speakers[1].id = "primeiro"; }, /speaker inválido ou duplicado/],
    [(n) => { delete n.speakers[1].voice; }, /voice é obrigatório/],
    [(n) => { n.blocks = []; }, /exige blocos/],
    [(n) => { n.blocks[1].id = "abertura"; }, /Bloco multi-voz inválido ou duplicado/],
    [(n) => { n.blocks[1].id = "../escape"; }, /Bloco multi-voz inválido ou duplicado/],
  ]) {
    const input = multiVoiceSpec();
    change(input.narration);
    assert.throws(() => validateFilmSpec(input), expected);
  }
});

test("multivoz encaminha cada voz, alinha os blocos e não repete TTS na retomada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-multivoice-"));
  const calls = [];
  let alignments = 0;
  const operations = {
    async generateTts(options) {
      calls.push({ voice: options.voice, text: options.text, node: options.executionNodeId, speaker: options.metadata.speakerId });
      return result(options.outputFile, "tts", "tts");
    },
    async alignNarrationBlocks({ blocks, masterFile, parentReceipts }) {
      alignments += 1;
      assert.deepEqual(blocks.map((block) => block.speakerId), ["primeiro", "segundo"]);
      assert.equal(new Set(blocks.map((block) => block.file)).size, 2);
      assert.equal(parentReceipts.length, 2);
      return { ...await result(masterFile, "align-narration", "narration-align", parentReceipts), masterFile, status: "pass" };
    },
    async probeMedia() { return { audio: { codec_type: "audio" }, duration: 4 }; },
    async draftScenes({ spec: draftSpec, stateFile }) {
      const scene = draftSpec.scenes[0];
      const keyframeFile = path.join(draftSpec.root, "keyframes", `${scene.id}.png`);
      await writeFileAtomic(keyframeFile, Buffer.from("keyframe"));
      await writeJsonAtomic(stateFile, {
        schema: "mkt-videos/draft-workflow@1", id: "draft:multivoice", name: draftSpec.name,
        mode: "studio", status: "awaiting_approval", root: draftSpec.root, stateFile,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
        scenes: [{ ...scene, status: "awaiting_approval", keyframeFile, keyframeReceipt: null,
          videoFile: path.join(draftSpec.root, "videos-soltos", `${scene.id}.mp4`),
          videoReceipt: path.join(draftSpec.root, "receitas", `${scene.id}.receipt.json`), interactionId: null, error: null }],
      });
      return { status: "awaiting_approval" };
    },
  };
  try {
    const planned = await planFilm({ spec: multiVoiceSpec(), outputsRoot: root });
    await runFilm({ stateFile: planned.state.stateFile, operations });
    assert.deepEqual(calls, [
      { voice: "Nyla", text: "Primeira fala.", node: "voice:abertura", speaker: "primeiro" },
      { voice: "Charon", text: "Segunda fala.", node: "voice:resposta", speaker: "segundo" },
    ]);
    assert.equal(alignments, 1);
    await runFilm({ stateFile: planned.state.stateFile, operations });
    assert.equal(calls.length, 2);
    assert.equal(alignments, 1);
    assert.equal((await statusFilm({ stateFile: planned.state.stateFile })).stages.tts.status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function result(file, operation, stage, parentReceipts = []) {
  let artifact = Buffer.from(`artifact:${stage}`);
  if (path.extname(file).toLowerCase() === ".wav") {
    const sampleRate = 8_000;
    const dataBytes = sampleRate * 2;
    artifact = Buffer.alloc(44 + dataBytes);
    artifact.write("RIFF", 0);
    artifact.writeUInt32LE(36 + dataBytes, 4);
    artifact.write("WAVE", 8);
    artifact.write("fmt ", 12);
    artifact.writeUInt32LE(16, 16);
    artifact.writeUInt16LE(1, 20);
    artifact.writeUInt16LE(1, 22);
    artifact.writeUInt32LE(sampleRate, 24);
    artifact.writeUInt32LE(sampleRate * 2, 28);
    artifact.writeUInt16LE(2, 32);
    artifact.writeUInt16LE(16, 34);
    artifact.write("data", 36);
    artifact.writeUInt32LE(dataBytes, 40);
  }
  await writeFileAtomic(file, artifact);
  const receiptFile = `${file}.receipt.json`;
  const receipt = createStageReceipt({ operation, provider: "test", stage, parentReceipts });
  await writeStageReceipt(receiptFile, receipt);
  return { file, receiptFile, receipt };
}

async function alignmentResult({ wordsFile, spansFile, receiptFile, parentReceipts = [] }) {
  const words = ["Hoje", "começa", "uma", "nova", "história."].map((word, index) => ({
    word,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
    probability: 0.99,
  }));
  await writeJsonAtomic(wordsFile, words);
  await writeJsonAtomic(spansFile, [{ id: "google-vids-master", start: 0, end: 2.4 }]);
  const receipt = createStageReceipt({ operation: "align-narration", provider: "whisper-local", stage: "alignment", parentReceipts });
  await writeStageReceipt(receiptFile, receipt);
  return { status: "pass", words, wordsFile, spansFile, receiptFile, receipt };
}

test("falha da trilha espera a voz em voo e preserva o resultado independente", { timeout: 15_000 }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-independent-failure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const planned = await planFilm({ spec: spec(), outputsRoot: root });
  const voiceStarted = Promise.withResolvers();
  const musicFailed = Promise.withResolvers();
  let voiceFinished = false;
  let draftCalls = 0;
  const error = new Error("rejeição da trilha simulada");
  await assert.rejects(runFilm({
    stateFile: planned.state.stateFile,
    operations: {
      async generateTts({ outputFile }) {
        voiceStarted.resolve();
        await musicFailed.promise;
        const generated = await result(outputFile, "tts", "tts");
        voiceFinished = true;
        return generated;
      },
      async generateMusic() {
        await voiceStarted.promise;
        musicFailed.resolve();
        throw error;
      },
      async probeMedia() { return { audio: { codec_type: "audio" }, duration: 3 }; },
      async alignNarrationBlocks(options) { return alignmentResult(options); },
      async draftScenes() { draftCalls += 1; throw new Error("draft não pode começar"); },
    },
  }), (caught) => caught === error);
  assert.equal(voiceFinished, true);
  assert.equal(draftCalls, 0);
  const state = await readFilmState(planned.state.stateFile);
  assert.equal(state.stages.tts.status, "completed");
  assert.equal(state.stages.music.status, "ambiguous");
  assert.ok((await readFile(state.stages.tts.outputFile)).length > 0);
  const graph = state.history.findLast((entry) => entry.event === "run_graph_settled");
  assert.ok(graph.completed.includes("tts"));
  assert.ok(graph.blocked.includes("draft"));
});

test("dry-run valida e mostra chamadas pagas sem gravar estado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-dry-"));
  const planned = await planFilm({ spec: spec(), outputsRoot: root, dryRun: true });
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.plan.paidCalls.map((entry) => [entry.stage, entry.count]), [["draft", 1], ["tts", 1], ["music", 1], ["video", 1]]);
  await assert.rejects(readFile(planned.state.stateFile), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test("dry-run rejeita configuração local inválida antes de qualquer chamada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-invalid-"));
  try {
    await assert.rejects(
      planFilm({ spec: { name: "invalido", scenes: [{ prompt: "Cena" }], music: { preset: "nao-existe" } }, outputsRoot: root, dryRun: true }),
      /Preset musical desconhecido|Mixagem com música|Backend musical desconhecido/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("posse da produção impede duas fachadas e permite outra produção independente", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-operation-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await planFilm({ spec: { ...spec(), music: null }, outputsRoot: root });
  const second = await planFilm({ spec: { ...spec(), name: "independente", music: null }, outputsRoot: root });
  let release; let started;
  const barrier = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const active = runFilm({ stateFile: first.state.stateFile, operations: {
    async generateTts() { started(); await barrier; throw new Error("fim da fixture ativa"); },
  } });
  const settlement = assert.rejects(active, /fim da fixture ativa/);
  try {
    await Promise.race([entered, active]);
    const before = await readFile(first.state.stateFile);
    for (const execute of [runFilm, resumeFilm, reconcileFilmVideo]) await assert.rejects(execute({ stateFile: first.state.stateFile, sceneId: "abertura" }), /Produção em uso/);
    assert.deepEqual(await readFile(first.state.stateFile), before, "recusa não altera o estado da produção ativa");
    await assert.rejects(runFilm({ stateFile: second.state.stateFile, operations: { async generateTts() { throw new Error("produção independente iniciou"); } } }), /produção independente iniciou/);
  } finally { release(); await settlement; }
});

test("narração Omni usa o adapter de vídeo e entrega o master pelo alinhamento local", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-omni-narration-"));
  const omniSpec = {
    name: "omni-narration",
    scenes: [{ id: "cena", prompt: "Cena institucional", duration: 10 }],
    narration: {
      provider: "omni",
      text: "Primeiro bloco. Segundo bloco.",
      voice: "voz brasileira institucional",
      blocks: [
        { id: "primeiro", text: "Primeiro bloco.", seconds: 8 },
        { id: "segundo", text: "Segundo bloco.", seconds: 8 },
      ],
    },
    alignment: { model: "small", language: "pt" },
    workflow: { streamAlignment: true },
    budget: { image: 1, tts: 0, music: 0, omni: 3, semanticQa: 0 },
    qa: false,
  };
  const planned = await planFilm({ spec: omniSpec, outputsRoot: root });
  const calls = { narrationVideos: 0, align: 0, tts: 0, draft: 0 };
  const operations = {
    videoAdapter: {
      async generate({ outputFile, task, metadata }) {
        calls.narrationVideos += 1;
        assert.equal(task, "text_to_video");
        assert.match(metadata.sceneId, /^narration:/);
        return result(outputFile, "generate-video", "omni-narration");
      },
    },
    async alignNarrationBlocks({ blocks, masterFile, parentReceipts }) {
      calls.align += 1;
      assert.ok(blocks.length === 1 || blocks.length === 2);
      assert.equal(parentReceipts.length, blocks.length);
      const aligned = await result(masterFile, "align-narration", "narration-align", parentReceipts);
      return { ...aligned, status: "pass", masterFile };
    },
    async generateTts() {
      calls.tts += 1;
      throw new Error("Google Vids não deve ser chamado para provider omni.");
    },
    async probeMedia() {
      return { audio: { codec_type: "audio" }, duration: 5 };
    },
    async draftScenes({ spec: draftSpec, stateFile }) {
      calls.draft += 1;
      const scene = draftSpec.scenes[0];
      const keyframeFile = path.join(draftSpec.root, "keyframes", `${scene.id}.png`);
      await writeFileAtomic(keyframeFile, Buffer.from("keyframe"));
      await writeJsonAtomic(stateFile, {
        schema: "mkt-videos/draft-workflow@1",
        id: "draft:omni-narration",
        name: draftSpec.name,
        mode: "studio",
        status: "awaiting_approval",
        root: draftSpec.root,
        stateFile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        scenes: [{ ...scene, status: "awaiting_approval", keyframeFile, keyframeReceipt: null, videoFile: path.join(draftSpec.root, "videos-soltos", `${scene.id}.mp4`), videoReceipt: path.join(draftSpec.root, "receitas", `${scene.id}.receipt.json`), interactionId: null, error: null }],
      });
      return { status: "awaiting_approval" };
    },
  };
  try {
    assert.deepEqual(
      planned.plan.paidCalls.map((entry) => [entry.stage, entry.provider, entry.count]),
      [["draft", "gemini-image", 1], ["video", "gemini-omni", 3]],
    );
    await runFilm({ stateFile: planned.state.stateFile, operations });
    const current = await statusFilm({ stateFile: planned.state.stateFile });
    assert.equal(current.status, "awaiting_approval");
    assert.deepEqual(calls, { narrationVideos: 2, align: 1, tts: 0, draft: 1 });
    assert.equal(current.stages.tts.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run sobrepõe voz/música e alinhamento/fit, pausa e retoma sem repetir provedores", { timeout: 15_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-run-"));
  const planned = await planFilm({ spec: spec(), outputsRoot: root });
  const calls = { draft: 0, tts: 0, align: 0, probe: 0, music: 0, fit: 0, animate: 0, assembly: 0, mix: 0, mux: 0, finish: 0 };
  let musicFitTargetDuration = null;
  const generationStarted = new Set();
  const generationBarrier = Promise.withResolvers();
  const finishingStarted = new Set();
  const finishingBarrier = Promise.withResolvers();
  const assemblyStarted = new Set();
  const assemblyBarrier = Promise.withResolvers();
  async function meet(started, barrier, id) {
    started.add(id);
    if (started.size === 2) barrier.resolve();
    await barrier.promise;
  }
  const operations = {
    async draftScenes({ spec: draftSpec, stateFile }) {
      calls.draft += 1;
      const scene = draftSpec.scenes[0];
      const keyframeFile = path.join(draftSpec.root, "keyframes", `${scene.id}.png`);
      await writeFileAtomic(keyframeFile, Buffer.from("keyframe"));
      await writeJsonAtomic(stateFile, {
        schema: "mkt-videos/draft-workflow@1",
        id: "draft:test",
        name: draftSpec.name,
        mode: "studio",
        status: "awaiting_approval",
        root: draftSpec.root,
        stateFile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        scenes: [{ ...scene, status: "awaiting_approval", keyframeFile, keyframeReceipt: null, videoFile: path.join(draftSpec.root, "videos-soltos", `${scene.id}.mp4`), videoReceipt: path.join(draftSpec.root, "receitas", `${scene.id}.mp4.receipt.json`), interactionId: null, error: null }],
      });
      return { status: "awaiting_approval" };
    },
    async generateTts({ outputFile }) {
      calls.tts += 1;
      await meet(generationStarted, generationBarrier, "voice");
      return result(outputFile, "tts", "tts");
    },
    async alignNarrationBlocks(options) {
      calls.align += 1;
      await meet(finishingStarted, finishingBarrier, "alignment");
      return alignmentResult(options);
    },
    async generateMusic({ outputFile }) {
      calls.music += 1;
      await meet(generationStarted, generationBarrier, "music");
      return result(outputFile, "music", "music");
    },
    async probeMedia() {
      calls.probe += 1;
      return { audio: { codec_type: "audio" }, duration: 3 };
    },
    async fitMusicToDuration({ outputFile, parentReceipts, targetDuration }) {
      calls.fit += 1;
      await meet(finishingStarted, finishingBarrier, "fit");
      musicFitTargetDuration = targetDuration;
      return result(outputFile, "music-fit", "music-fit", parentReceipts);
    },
    async animateDraft({ draftFile }) {
      calls.animate += 1;
      const draft = JSON.parse(await readFile(draftFile, "utf8"));
      for (const scene of draft.scenes) {
        const generated = await result(scene.videoFile, "video", "draft-animate");
        scene.videoReceipt = generated.receiptFile;
        scene.status = "delivered";
      }
      draft.status = "delivered";
      await import("../lib/media-pipeline/pipeline-operation.mjs").then(({ replaceJsonAtomic }) => replaceJsonAtomic(draftFile, draft));
      return draft;
    },
    async assembleFilm({ outputFile, parentReceipts }) {
      calls.assembly += 1;
      await meet(assemblyStarted, assemblyBarrier, "assembly");
      return result(outputFile, "assembly", "assembly", parentReceipts);
    },
    async mixAudio({ outputFile, parentReceipts }) {
      calls.mix += 1;
      await meet(assemblyStarted, assemblyBarrier, "mix");
      return result(outputFile, "mix", "audio-mix", parentReceipts);
    },
    async muxMasterAudio({ outputFile, parentReceipts }) {
      calls.mux += 1;
      return result(outputFile, "mux", "audio-mux", parentReceipts);
    },
    async finishVideo({ outputFile, parentReceipts }) {
      calls.finish += 1;
      return result(outputFile, "finish", "delivery", parentReceipts);
    },
  };

  // Antes de rodar, nenhum provedor foi tocado: o plano é provider-free.
  const antesDeRodar = await readFilmState(planned.state.stateFile);
  assert.equal(antesDeRodar.status, "planned");
  assert.deepEqual(calls, { draft: 0, tts: 0, align: 0, probe: 0, music: 0, fit: 0, animate: 0, assembly: 0, mix: 0, mux: 0, finish: 0 });

  await runFilm({ stateFile: planned.state.stateFile, operations });
  const awaiting = await statusFilm({ stateFile: planned.state.stateFile });
  assert.equal(awaiting.status, "awaiting_approval");
  assert.deepEqual([calls.tts, calls.probe, calls.music, calls.fit, calls.draft], [1, 1, 1, 1, 1]);
  assert.equal(musicFitTargetDuration, 3);

  await approveDraft({ draftFile: planned.state.draftFile });
  await resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations });
  const delivered = await statusFilm({ stateFile: planned.state.stateFile });
  assert.equal(delivered.status, "delivered");
  assert.ok(delivered.finalFile.endsWith("teste-filme-final.mp4"));
  assert.deepEqual(calls, { draft: 1, tts: 1, align: 1, probe: 1, music: 1, fit: 1, animate: 1, assembly: 1, mix: 1, mux: 1, finish: 1 });

  await resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations });
  assert.deepEqual(calls, { draft: 1, tts: 1, align: 1, probe: 1, music: 1, fit: 1, animate: 1, assembly: 1, mix: 1, mux: 1, finish: 1 });
  await rm(root, { recursive: true, force: true });
});

for (const assertions of [undefined, ["audio-stream"]]) test(`QA bloqueante preserva o relatório e impede delivery inclusive na retomada (${assertions ? "áudio explícito" : "contrato legado"})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-qa-gate-"));
  const planned = await planFilm({
    spec: {
      name: "qa-bloqueante",
      scenes: [{ id: "cena", prompt: "Cena de teste" }],
      qa: { expectedDuration: 1, gate: "block", ...(assertions ? { assertions } : {}) },
      delivery: { profile: "web-1080p" },
    },
    outputsRoot: root,
  });
  const calls = { draft: 0, animate: 0, assembly: 0, qa: 0, finish: 0 };
  const operations = {
    async draftScenes({ spec: draftSpec, stateFile }) {
      calls.draft += 1;
      const scene = draftSpec.scenes[0];
      const keyframeFile = path.join(draftSpec.root, "keyframes", `${scene.id}.png`);
      await writeFileAtomic(keyframeFile, Buffer.from("keyframe"));
      await writeJsonAtomic(stateFile, {
        schema: "mkt-videos/draft-workflow@1", id: "draft:qa", name: draftSpec.name, mode: "studio",
        status: "awaiting_approval", root: draftSpec.root, stateFile,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
        scenes: [{ ...scene, status: "awaiting_approval", keyframeFile, keyframeReceipt: null, videoFile: path.join(draftSpec.root, "videos-soltos", `${scene.id}.mp4`), videoReceipt: path.join(draftSpec.root, "receitas", `${scene.id}.receipt.json`), interactionId: null, error: null }],
      });
      return { status: "awaiting_approval" };
    },
    async animateDraft({ draftFile }) {
      calls.animate += 1;
      const draft = JSON.parse(await readFile(draftFile, "utf8"));
      const generated = await result(draft.scenes[0].videoFile, "video", "draft-animate");
      draft.scenes[0].videoReceipt = generated.receiptFile;
      draft.scenes[0].status = "delivered";
      draft.status = "delivered";
      await import("../lib/media-pipeline/pipeline-operation.mjs").then(({ replaceJsonAtomic }) => replaceJsonAtomic(draftFile, draft));
      return draft;
    },
    async assembleFilm({ outputFile, parentReceipts }) {
      calls.assembly += 1;
      return result(outputFile, "assembly", "assembly", parentReceipts);
    },
    async runQa({ outputFile, receiptFile, parentReceipts, requireAudio }) {
      calls.qa += 1;
      const report = requireAudio === false
        ? { status: "passed", warnings: [] }
        : { status: "warning", warnings: ["duration_mismatch"] };
      await writeJsonAtomic(outputFile, report);
      const receipt = createStageReceipt({ operation: "qa", provider: "test", stage: "qa", parentReceipts });
      await writeStageReceipt(receiptFile, receipt);
      return { report, file: outputFile, receiptFile, receipt };
    },
    async finishVideo({ outputFile, parentReceipts }) {
      calls.finish += 1;
      return result(outputFile, "finish", "delivery", parentReceipts);
    },
  };
  try {
    await runFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations });
    await approveDraft({ draftFile: planned.state.draftFile });
    await assert.rejects(resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations }), /QA bloqueou a entrega/);
    let status = await statusFilm({ stateFile: planned.state.stateFile });
    assert.equal(status.status, "attention_required");
    assert.equal(status.stages.qa.status, "completed");
    assert.equal(status.stages.qa.gate.status, "blocked");
    assert.equal(status.stages.delivery.status, "blocked");
    assert.deepEqual(calls, { draft: 1, animate: 1, assembly: 1, qa: 2, finish: 0 });

    await assert.rejects(resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations }), /QA bloqueou a entrega/);
    status = await statusFilm({ stateFile: planned.state.stateFile });
    assert.equal(status.status, "attention_required");
    assert.deepEqual(calls, { draft: 1, animate: 1, assembly: 1, qa: 2, finish: 0 });

    await overrideFilmQa({ stateFile: planned.state.stateFile, author: "Ana", justification: "Diferença de duração revisada e aceita para este teste." });
    await resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations });
    status = await statusFilm({ stateFile: planned.state.stateFile });
    assert.equal(status.status, "delivered");
    assert.equal(status.stages.qa.gate.status, "overridden");
    assert.equal(status.stages.qa.override.author, "Ana");
    assert.deepEqual(calls, { draft: 1, animate: 1, assembly: 1, qa: 2, finish: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production-once entrega no resume sem decisão humana ou flag de autoApprove", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-auto-"));
  const planned = await planFilm({
    spec: {
      ...spec(),
      workflow: { authorizationMode: "production-once", humanReview: false, completionMode: "complete" },
      captions: { style: "kinetic-word@1" },
    },
    outputsRoot: root,
  });
  const calls = { draft: 0, tts: 0, align: 0, probe: 0, music: 0, fit: 0, animate: 0, assembly: 0, mix: 0, mux: 0, captions: 0, finish: 0 };
  let captionWordsFile = null;
  const operations = {
    async draftScenes({ spec: draftSpec, stateFile }) {
      calls.draft += 1;
      const scene = draftSpec.scenes[0];
      const keyframeFile = path.join(draftSpec.root, "keyframes", `${scene.id}.png`);
      await writeFileAtomic(keyframeFile, Buffer.from("keyframe"));
      await writeJsonAtomic(stateFile, {
        schema: "mkt-videos/draft-workflow@1",
        id: "draft:test",
        name: draftSpec.name,
        mode: "studio",
        status: "awaiting_approval",
        root: draftSpec.root,
        stateFile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        scenes: [{ ...scene, status: "awaiting_approval", keyframeFile, keyframeReceipt: null, videoFile: path.join(draftSpec.root, "videos-soltos", `${scene.id}.mp4`), videoReceipt: path.join(draftSpec.root, "receitas", `${scene.id}.mp4.receipt.json`), interactionId: null, error: null }],
      });
      return { status: "awaiting_approval" };
    },
    async generateTts({ outputFile }) { calls.tts += 1; return result(outputFile, "tts", "tts"); },
    async alignNarrationBlocks(options) { calls.align += 1; return alignmentResult(options); },
    async generateMusic({ outputFile }) { calls.music += 1; return result(outputFile, "music", "music"); },
    async probeMedia() { calls.probe += 1; return { audio: { codec_type: "audio" }, duration: 3 }; },
    async fitMusicToDuration({ outputFile, parentReceipts }) { calls.fit += 1; return result(outputFile, "music-fit", "music-fit", parentReceipts); },
    async animateDraft({ draftFile }) {
      calls.animate += 1;
      const draft = JSON.parse(await readFile(draftFile, "utf8"));
      for (const scene of draft.scenes) {
        const generated = await result(scene.videoFile, "video", "draft-animate");
        scene.videoReceipt = generated.receiptFile;
        scene.status = "delivered";
      }
      draft.status = "delivered";
      await import("../lib/media-pipeline/pipeline-operation.mjs").then(({ replaceJsonAtomic }) => replaceJsonAtomic(draftFile, draft));
      return draft;
    },
    async assembleFilm({ outputFile, parentReceipts }) { calls.assembly += 1; return result(outputFile, "assembly", "assembly", parentReceipts); },
    async mixAudio({ outputFile, parentReceipts }) { calls.mix += 1; return result(outputFile, "mix", "audio-mix", parentReceipts); },
    async muxMasterAudio({ outputFile, parentReceipts }) { calls.mux += 1; return result(outputFile, "mux", "audio-mux", parentReceipts); },
    async renderWordCaptions({ outputFile, parentReceipts, wordsFile }) {
      calls.captions += 1;
      captionWordsFile = wordsFile;
      return result(outputFile, "captions", "captions", parentReceipts);
    },
    async finishVideo({ outputFile, parentReceipts }) { calls.finish += 1; return result(outputFile, "finish", "delivery", parentReceipts); },
  };

  await runFilm({ stateFile: planned.state.stateFile, operations });
  let awaiting = await statusFilm({ stateFile: planned.state.stateFile });
  assert.equal(awaiting.status, "awaiting_approval");

  // Sem approve separado e sem flag: a autorização da produção governa a continuação.
  await resumeFilm({ stateFile: planned.state.stateFile, confirmPaid: true, operations });
  const delivered = await statusFilm({ stateFile: planned.state.stateFile });
  assert.equal(delivered.status, "delivered");
  assert.ok(captionWordsFile.endsWith("palavras-master.json"));
  assert.deepEqual(calls, { draft: 1, tts: 1, align: 1, probe: 1, music: 1, fit: 1, animate: 1, assembly: 1, mix: 1, mux: 1, captions: 1, finish: 1 });
});
