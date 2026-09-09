import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { inspectMasterRecipe, parseMasterRecipe, preflightResolvedMasterRecipe, resolveMasterRecipe } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, runFilm, resumeFilm, statusFilm, validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createResourceBroker } from "../lib/media-pipeline/resource-broker.mjs";
import { consumeExecutionEffectAuthorization, materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { createCookieVideoAdapter } from "../scripts/cookie-studio-operations.mjs";
import { createArtifactFromFile, sha256File } from "../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { probeMedia, runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { mixAudio } from "../lib/media-pipeline/audio-mix.mjs";
import { assembleFilm } from "../lib/media-pipeline/film-assembly.mjs";
import { createCliContext } from "../lib/cli/context.mjs";
import { executar as executeRunCommand } from "../lib/cli/commands/run.mjs";
import { executar as executeResumeCommand } from "../lib/cli/commands/resume.mjs";
import { governedSfxFixture } from "./fixtures/governed-sfx.mjs";
import { handleRecipeCommand } from "../lib/cli/recipe-command-handler.mjs";
import { createSyntheticToneFixtures } from "./fixtures/synthetic-tones.mjs";
import { animateDraft } from "../lib/media-pipeline/draft-workflow.mjs";
import { alignNarrationBlocks } from "../lib/media-pipeline/narration-align.mjs";

const sourceTones = createSyntheticToneFixtures();
after(() => sourceTones.dispose());

const golden = JSON.parse(await readFile(new URL("../recipes/golden-30s.receita-v2.5b.json", import.meta.url), "utf8"));
const mixSettings = { ...golden.mix, voiceGainDb: 6, musicGainDb: -12 };
function proposal(mode, asset = null) {
  const narration = { ...structuredClone(golden.narration), blocks: [{ id: "voice-1", speakerId: "principal", text: "Teste de áudio." }, { id: "voice-2", speakerId: "principal", text: "Segundo bloco." }] };
  const modules = mode === "music" ? { music: golden.music, mix: mixSettings }
    : mode === "voice" ? { narration, alignment: { ...golden.alignment, backend: "openai-whisper" }, mix: mixSettings }
    : mode === "sfx" ? { assets: [asset], sfx: { module: "local-sfx@1", cues: [{ id: "cue", assetId: asset.id, atFrame: 24, gainDb: -3 }] }, mix: mixSettings }
    : mode === "scene" ? { mix: { ...mixSettings, sceneAudioGainDb: -10 } } : {};
  return suggestMasterRecipeFromBrief({ rootScopeId: "client:teste", style: "flat-2d@1", modules,
    ...(mode === "music" ? { components: { material: "solid-vector@1", composition: "swiss-grid@1", rhythm: "stepwise@1" } } : {}),
    brief: { briefId: `brief:${mode}`, clientId: "client:teste", projectId: "project:teste", userBrief: "Geometria em movimento.", objective: "Mostrar geometria.", message: "Observe.", durationSeconds: 6, format: "16:9" } });
}

test("receitas explicitam módulos inativos e exigem apenas as capacidades usadas", () => {
  for (const mode of ["music", "voice", "silent", "scene"]) {
    const suggestion = proposal(mode);
    const { filmSpec, executionPlan } = inspectMasterRecipe(JSON.stringify(suggestion.recipe));
    assert.equal(filmSpec.narration.mode !== "none", mode === "voice");
    assert.equal(filmSpec.music.mode !== "none", mode === "music");
    assert.equal(executionPlan.nodes.some((node) => node.id === "audio-mix"), mode !== "silent");
    const intents = filmSpec.source.capabilityIntents.map((entry) => entry.intent);
    assert.equal(intents.some((intent) => intent.startsWith("narration.")), mode === "voice");
    assert.equal(intents.includes("music.generate.timeline"), mode === "music");
    assert.equal(suggestion.recipe.captions, null);
    if (mode === "scene") assert.ok(executionPlan.nodes.find((node) => node.id === "audio-mix").dependencies.includes("assembly"));
  }
  const music = proposal("music").recipe;
  music.captions = golden.captions;
  assert.throws(() => parseMasterRecipe(JSON.stringify(music)), /legendas.*narração/);
  const voice = proposal("voice").recipe;
  voice.alignment = null;
  assert.throws(() => parseMasterRecipe(JSON.stringify(voice)), /alignment explícito/);
  const missingMix = proposal("music").recipe;
  missingMix.mix = null;
  assert.throws(() => parseMasterRecipe(JSON.stringify(missingMix)), /mix explícito/);
  const sceneWithFade = inspectMasterRecipe(JSON.stringify(proposal("scene").recipe)).filmSpec;
  sceneWithFade.finishing.assembly.transition = "fade";
  assert.throws(() => compileFilmSpec(sceneWithFade), /exige transições cut/);
  const mutedScenes = proposal("scene").recipe;
  mutedScenes.mix.sceneAudioGainDb = null;
  assert.throws(() => parseMasterRecipe(JSON.stringify(mutedScenes)), /sem áudio, mix deve ser null/);
  const sfx = proposal("music").recipe;
  sfx.assets = [{ id: "effect", mediaKind: "audio", role: "sfx", source: { kind: "workspace", locator: "effect.wav" }, bytes: 44, sha256: "a".repeat(64), mimeType: "audio/wav", rights: { providerInput: "allowed", reuse: "allowed" }, authorization: { mode: "scope-grant", bindingHash: "b".repeat(64) } }];
  sfx.sfx.cues = [{ id: "cue", assetId: "effect", atFrame: 24, gainDb: 0 }];
  const resolved = resolveMasterRecipe(parseMasterRecipe(JSON.stringify(sfx)));
  assert.ok(preflightResolvedMasterRecipe(resolved).blockers.some((entry) => entry.code === "local-sfx-authorization-required"));
  assert.throws(() => inspectMasterRecipe(JSON.stringify(sfx)), /local-sfx-authorization-required/);
  const direct = inspectMasterRecipe(JSON.stringify(proposal("music").recipe)).filmSpec;
  direct.finishing.audio.sfx = sfx.sfx;
  assert.throws(() => compileFilmSpec(direct), /asset de áudio/);
  sfx.assets[0].source = { kind: "knowledge-core", locator: "reference:effect" };
  const canonical = inspectMasterRecipe(JSON.stringify(sfx)).executionPlan;
  const facade = adaptExecutionPlanToLegacy(canonical);
  assert.doesNotThrow(() => validateFilmSpec(facade, { executionPlan: canonical }));
  facade.audio.sfxGainDb += 1;
  assert.throws(() => validateFilmSpec(facade, { executionPlan: canonical }), /ganho idênticos/);
  delete facade.audio.sfx;
  assert.throws(() => validateFilmSpec(facade, { executionPlan: canonical }), /plano canônico/);
  const scenePlan = inspectMasterRecipe(JSON.stringify(proposal("scene").recipe)).executionPlan;
  const sceneFacade = adaptExecutionPlanToLegacy(scenePlan);
  delete sceneFacade.audio.sceneAudioGainDb;
  assert.throws(() => validateFilmSpec(sceneFacade, { executionPlan: scenePlan }), /sceneAudioGainDb diverge/);
});

test("trilha sem voz recusa duração indefinida antes do provider e ganhos inválidos antes do plano", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-music-duration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = { name: "music-duration", scenes: [{ id: "a", prompt: "Geometria" }], music: { preset: "institucional" }, qa: false };
  const planned = await planFilm({ spec: source, outputsRoot: root });
  let calls = 0;
  await assert.rejects(runFilm({ stateFile: planned.state.stateFile, operations: { async generateMusic() { calls++; } } }), /duração congelada/);
  assert.equal(calls, 0);
  assert.throws(() => validateFilmSpec({ ...source, audio: { voiceGainDb: "invalid" } }), /ganho finito/);
  assert.throws(() => validateFilmSpec({ ...source, audio: { sfx: { cues: [{ id: "cue" }] } } }), /plano canônico/);
});

for (const mode of ["music", "voice", "sfx", "scene"]) test(`proposta ${mode} chega ao master físico e retoma sem refazer áudio ou vídeo`, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `recipe-${mode}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceVideo = path.join(root, "source.mp4");
  const sourceAudio = path.join(root, "source.wav");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x36:r=24:d=2", ...(mode === "scene" ? ["-f", "lavfi", "-i", "sine=frequency=600:duration=2", "-c:a", "aac"] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", sourceVideo]);
  // Tom local representa o áudio do provider simulado; não é prova de dicção/TTS.
  await sourceTones.materialize(sourceAudio, { frequency: mode === "voice" ? 440 : 220, duration: 6, channels: 2 });
  const originalHashes = await Promise.all([sha256File(sourceVideo), sha256File(sourceAudio)]);
  const governed = mode === "sfx" ? await governedSfxFixture({ root, file: sourceAudio }) : null;
  const { executionPlan } = inspectMasterRecipe(JSON.stringify(proposal(mode, governed?.asset).recipe));
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, "productions") });
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite") });
  const calls = { video: 0, voice: 0, music: 0, mix: 0, align: 0 };
  let originalVoice = null;
  const produceAudio = async (kind, options) => {
    assert.equal(kind, mode, "módulo inativo não pode consumir provider");
    consumeExecutionEffectAuthorization(options.executionEffectAuthorization, { provider: kind === "voice" ? "google-vids" : "flow-music", operation: kind === "voice" ? "text-to-speech" : "music-generate", attemptId: options.attemptId });
    calls[kind]++;
    await copyFile(sourceAudio, options.outputFile);
    if (kind === "voice") originalVoice = { file: options.outputFile, hash: await sha256File(options.outputFile), mtimeMs: (await stat(options.outputFile)).mtimeMs };
    const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "audio", role: kind });
    const receipt = createStageReceipt({ operation: kind === "voice" ? "tts" : "music", provider: "test", stage: kind === "voice" ? "tts" : "music", artifacts: [artifact] });
    await writeStageReceipt(options.receiptFile, receipt);
    return { file: options.outputFile, receiptFile: options.receiptFile, receipt };
  };
  let failAssembly = mode === "music" || mode === "sfx";
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint, resourceBroker: broker, operations: {
    imageAdapter: { generate() { assert.fail("text-to-video não gera imagem remota"); } },
    videoAdapter: createCookieVideoAdapter({
      async submit(options) { if (mode === "music") assert.match(options.prompt, /modular Swiss grid/); await options.onBeforeSubmit({}); calls.video++; const fileId = `fixture-${calls.video}`; await options.onProviderHandle({ fileId, attemptId: options.attemptId }); return { fileId }; },
      async observeMany({ requests }) { return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
      async collect(options) { await copyFile(sourceVideo, options.outputFile); return { fileId: options.fileId, zeroPost: true }; },
    }),
    // O provider local já está ready; o intervalo produtivo não faz parte desta prova.
    animateDraft: (options) => animateDraft({ ...options, pollIntervalMs: 1 }),
    generateTts: (options) => produceAudio("voice", options),
    generateMusic: (options) => produceAudio("music", options),
    async alignNarrationBlocks(options) {
      assert.equal(mode, "voice"); calls.align++;
      assert.equal(options.blocks.length, 1, "um WAV contínuo não deve ser repetido por bloco editorial");
      assert.equal(options.blocks[0].audioFile, originalVoice.file);
      assert.equal(options.preserveSingleAudioMaster, true);
      assert.equal(options.whisperBackend, "openai-whisper");
      return alignNarrationBlocks({ ...options, cache: false,
        planWhisperExecutionImpl: async ({ backend }) => ({ backend, device: "cpu", requested: "cpu", fp16: false, reason: "test", fingerprint: "single-voice-test" }),
        runWhisperBackendImpl: async () => ({ backend: "openai-whisper", transcript: options.blocks[0].text, words: options.blocks[0].text.split(/\s+/).map((word, index) => ({ word, start: 0.5 + index * 0.5, end: 0.9 + index * 0.5, probability: 0.99 })), jsonFile: null }),
      });
    },
    async mixAudio(options) {
      calls.mix++;
      assert.equal(Boolean(options.voiceFile), mode === "voice");
      assert.equal(Boolean(options.musicFile), mode === "music");
      assert.equal(options.voiceGain, 10 ** (mixSettings.voiceGainDb / 20));
      assert.equal(options.musicGain, 10 ** (mixSettings.musicGainDb / 20));
      if (mode === "sfx") {
        assert.equal(options.sfxInputs[0].atSeconds, 1);
        assert.equal(options.sfxInputs[0].gainDb, mixSettings.sfxGainDb - 3);
      }
      if (mode === "scene") {
        assert.equal(options.sfxInputs[0].role, "scene-audio");
        assert.equal(options.sfxInputs[0].gainDb, -10);
        assert.ok((await probeMedia(options.sfxInputs[0].file)).audio);
      }
      return mixAudio(options);
    },
    async assembleFilm(options) { if (failAssembly) { failAssembly = false; throw new Error("fixture assembly interrupted"); } return assembleFilm(options); },
  } };
  // A fachada real de run deve continuar automaticamente para resume.
  const assetContextFile = path.join(root, "asset-context.json");
  if (governed) {
    await assert.rejects(runFilm(options), /--asset-context/);
    assert.equal(calls.video + calls.voice + calls.music, 0);
    await writeFile(assetContextFile, JSON.stringify(governed.context));
    const recipeFile = path.join(root, "sfx.receita.json");
    await writeFile(recipeFile, JSON.stringify(proposal(mode, governed.asset).recipe));
    let preflight;
    await handleRecipeCommand({ action: "preflight", file: recipeFile }, { stdout: (value) => { preflight = JSON.parse(value); } });
    assert.ok(preflight.blockers.some((entry) => entry.code === "governed-asset-context-required"));
    await handleRecipeCommand({ action: "preflight", file: recipeFile, "asset-context": assetContextFile }, { stdout: (value) => { preflight = JSON.parse(value); } });
    assert.equal(preflight.status, "ready", JSON.stringify(preflight.blockers));
    assert.ok(!JSON.stringify(preflight).includes(governed.context.dbFile));
  }
  const cli = await createCliContext(["run", "--state", options.stateFile, "--confirm-fingerprint", options.confirmFingerprint, ...(governed ? ["--asset-context", assetContextFile] : [])]);
  const cliOptions = cli.parse(cli.args);
  cli.validateOptions(cli.command, cliOptions);
  const commandContext = { ...cli, options: cliOptions,
    cookieRuntime: async () => ({ operations: options.operations }), createCliResourceBroker: () => broker };
  if (mode === "scene") commandContext.options["output-format"] = "text";
  const outputLines = [];
  const originalLog = console.log;
  console.log = (value) => outputLines.push(String(value));
  try {
    if (failAssembly) await assert.rejects(executeRunCommand(commandContext), /fixture assembly interrupted/);
    else await executeRunCommand(commandContext);
  } finally { console.log = originalLog; }
  if (mode === "music" || mode === "sfx") {
    assert.equal((await statusFilm({ stateFile: options.stateFile })).stages.audioMix.status, "completed");
    if (governed) {
      governed.changeRights({ permissions: { reuse: "denied" } });
      await assert.rejects(executeResumeCommand(commandContext), /reuse bloqueado: denied/);
      assert.equal(calls.mix, 1);
      assert.equal(calls.video, 3);
      governed.changeRights({ permissions: { reuse: "allowed" } });
      commandContext.options["output-format"] = "text";
      console.log = (value) => outputLines.push(String(value));
      try { await executeResumeCommand(commandContext); } finally { console.log = originalLog; }
    } else await resumeFilm({ ...options, autoApprove: true });
  }
  const status = await statusFilm({ stateFile: options.stateFile });
  assert.equal(status.status, "delivered");
  if (mode === "scene" || mode === "sfx") assert.match(outputLines.at(-1), /Estado: delivered/, "run/resume em texto refletem a entrega do executor");
  if (mode === "music") {
    const receipt = JSON.parse(await readFile(status.stages.audioMix.receiptFile, "utf8"));
    assert.equal(receipt.metadata.styleCompositionHash, executionPlan.spec.styleComposition.hash);
    assert.deepEqual(receipt.metadata.styleComponentSelections, executionPlan.spec.styleComposition.composition.selected.map(({ dimension, id }) => ({ dimension, id })));
  }
  const media = await probeMedia(status.finalFile);
  assert.ok(media.video && media.audio);
  assert.ok(Math.abs(media.duration - 6) < 0.05);
  const statistics = (await runCommand("ffmpeg", ["-hide_banner", "-i", status.finalFile, "-af", "volumedetect", "-f", "null", "-"])).stderr;
  assert.ok(Number(statistics.match(/mean_volume: (-?[\d.]+) dB/)?.[1]) > -60);
  if (governed) {
    const receipt = JSON.parse(await readFile(status.stages.audioMix.receiptFile, "utf8"));
    assert.equal(receipt.inputs[0].hash.value, governed.asset.sha256);
    assert.equal(receipt.parameters.sfxCues[0].authorization.itemHash, governed.target.contentHash);
    assert.ok(!JSON.stringify(receipt).includes(governed.context.dbFile));
  }
  assert.deepEqual(calls, { video: 3, voice: mode === "voice" ? 1 : 0, music: mode === "music" ? 1 : 0, mix: 1, align: mode === "voice" ? 1 : 0 });
  const finalHash = await sha256File(status.finalFile);
  if (originalVoice) {
    const alignmentReceipt = JSON.parse(await readFile(status.stages.tts.alignment.receiptFile, "utf8"));
    assert.equal(alignmentReceipt.parameters.preserveSingleAudioMaster, true);
    assert.equal(alignmentReceipt.parameters.whisperBackend, "openai-whisper");
    assert.equal(alignmentReceipt.metadata.duration, 6, "alinhamento preserva duração do WAV inteiro");
    assert.equal(alignmentReceipt.inputs[0].kind, "audio");
  }
  await resumeFilm(options);
  assert.equal(await sha256File(status.finalFile), finalHash);
  assert.equal(calls.mix, 1);
  assert.equal(calls.video, 3);
  if (originalVoice) {
    assert.equal(await sha256File(originalVoice.file), originalVoice.hash);
    assert.equal((await stat(originalVoice.file)).mtimeMs, originalVoice.mtimeMs);
  }
  assert.deepEqual(await Promise.all([sha256File(sourceVideo), sha256File(sourceAudio)]), originalHashes);
  const journal = materializeExecutionSnapshot({ dbFile: path.join(path.dirname(options.stateFile), "execution-journal.sqlite") });
  assert.equal(journal.nodes["audio-mix"].status, "completed");
  assert.equal(journal.nodes.master.status, "completed");
});

test("falha objetiva do alinhamento Vids preserva o WAV e bloqueia retomada sem outro TTS", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-voice-blocked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planned = await planFilm({ spec: { name: "voice-blocked", scenes: [{ id: "visual", prompt: "Geometria" }],
    narration: { provider: "google-vids", documentUrl: "https://docs.google.com/videos/d/test/edit", voice: "Nyla", text: "Teste de áudio. Segundo bloco.", blocks: [{ id: "a", text: "Teste de áudio." }, { id: "b", text: "Segundo bloco." }] },
    alignment: { backend: "openai-whisper", language: "pt" }, qa: false,
  }, outputsRoot: root });
  let ttsCalls = 0;
  let alignmentCalls = 0;
  let voice;
  const options = { stateFile: planned.state.stateFile, operations: {
    async generateTts({ outputFile, receiptFile }) {
      ttsCalls++;
      await sourceTones.materialize(outputFile, { duration: 6, frequency: 440 });
      voice = { file: outputFile, hash: await sha256File(outputFile), mtimeMs: (await stat(outputFile)).mtimeMs };
      const artifact = await createArtifactFromFile({ file: outputFile, kind: "audio", role: "voice" });
      const receipt = createStageReceipt({ operation: "tts", provider: "test", stage: "tts", artifacts: [artifact] });
      await writeStageReceipt(receiptFile, receipt);
      return { file: outputFile, receiptFile, receipt };
    },
    async alignNarrationBlocks(args) {
      alignmentCalls++;
      return alignNarrationBlocks({ ...args, cache: false,
        planWhisperExecutionImpl: async ({ backend }) => ({ backend, device: "cpu", requested: "cpu", fp16: false, reason: "test", fingerprint: "single-voice-blocked-test" }),
        runWhisperBackendImpl: async () => ({ backend: "openai-whisper", transcript: "Teste", words: [{ word: "Teste", start: 0.5, end: 0.9, probability: 0.99 }], jsonFile: null }),
      });
    },
    async draftScenes() { assert.fail("alinhamento bloqueado impede geração visual"); },
  } };
  await assert.rejects(runFilm(options), /Alinhamento da narração bloqueado/);
  await assert.rejects(runFilm(options), /Alinhamento da narração bloqueado/);
  const status = await statusFilm({ stateFile: planned.state.stateFile });
  assert.notEqual(status.status, "delivered");
  assert.equal(status.stages.tts.alignment.status, "blocked");
  assert.equal(ttsCalls, 1);
  assert.equal(alignmentCalls, 1);
  assert.equal(await sha256File(voice.file), voice.hash);
  assert.equal((await stat(voice.file)).mtimeMs, voice.mtimeMs);
});

test("voz maior que timeline fixa bloqueia antes de alinhamento e mix sem truncar original", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-voice-too-long-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { executionPlan } = inspectMasterRecipe(JSON.stringify(proposal("voice").recipe));
  const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: root });
  const broker = createResourceBroker({ dbFile: path.join(root, "broker.sqlite") });
  let ttsCalls = 0;
  let voice;
  const options = { stateFile: planned.state.stateFile, confirmFingerprint: executionPlan.governance.approval.fingerprint, resourceBroker: broker, operations: {
    async generateTts(args) {
      consumeExecutionEffectAuthorization(args.executionEffectAuthorization, { provider: "google-vids", operation: "text-to-speech", attemptId: args.attemptId });
      ttsCalls++;
      await sourceTones.materialize(args.outputFile, { duration: 7, frequency: 440 });
      voice = { file: args.outputFile, hash: await sha256File(args.outputFile), mtimeMs: (await stat(args.outputFile)).mtimeMs };
      const artifact = await createArtifactFromFile({ file: args.outputFile, kind: "audio", role: "voice" });
      const receipt = createStageReceipt({ operation: "tts", provider: "test", stage: "tts", artifacts: [artifact] });
      await writeStageReceipt(args.receiptFile, receipt);
      return { file: args.outputFile, receiptFile: args.receiptFile, receipt };
    },
    async alignNarrationBlocks() { assert.fail("voz excessiva não inicia alinhamento"); },
    async draftScenes() { assert.fail("voz excessiva não inicia geração visual"); },
    async mixAudio() { assert.fail("voz excessiva não chega ao atrim da mixagem"); },
  } };
  await assert.rejects(runFilm(options), /Narração.*excede a timeline fixa/);
  await assert.rejects(resumeFilm(options), /Narração.*excede a timeline fixa/);
  assert.equal(ttsCalls, 1);
  assert.equal(await sha256File(voice.file), voice.hash);
  assert.equal((await stat(voice.file)).mtimeMs, voice.mtimeMs);
  assert.equal((await probeMedia(voice.file)).duration, 7);
});
