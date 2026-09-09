import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  validateAudioRecipe,
  resolveAudioRecipe,
  planAudioRecipe,
  countWords,
  estimateSpeechDuration,
  calculateTargetWordCount,
  adaptScriptForDuration,
  buildAudioRecipeMusicPrompt,
  executeAudioRecipe,
  AUDIO_RECIPE_SCHEMA,
} from "../lib/media-pipeline/audio-recipe.mjs";
import { AUDIO_RECIPE_PRESETS, resolveAudioRecipePreset } from "../lib/media-pipeline/audio-recipe-presets.mjs";

test("cadência e contagem de palavras calculam orçamentos precisos", () => {
  const words = countWords("Esta é uma locução comercial com exatamente oito palavras");
  assert.equal(words, 9);

  const duration = estimateSpeechDuration("Um dois três quatro cinco seis sete oito nove dez", 2.5);
  assert.equal(duration, 4);

  // Trilha de 30s com 5s de tail = 25s de fala. A 2.4 wps = 60 palavras
  const targetWords = calculateTargetWordCount({ musicDuration: 30, tailSeconds: 5, wordsPerSecond: 2.4 });
  assert.equal(targetWords, 60);
});

test("adaptScriptForDuration expande roteiro curto para casar com trilha longa", () => {
  const shortText = "Atenção clientes! Mega saldão com até 70% de desconto!";
  const adapted = adaptScriptForDuration({
    text: shortText,
    musicDuration: 60,
    tailSeconds: 5,
    wordsPerSecond: 2.4,
  });

  assert.equal(adapted.adapted, true);
  assert.ok(adapted.actualWords >= 100);
  assert.match(adapted.text, /Mega saldão/);
  assert.match(adapted.text, /parcelamento facilitado/);
});

test("buildAudioRecipeMusicPrompt injeta especificações precisas de timing e fechamento", () => {
  const prompt = buildAudioRecipeMusicPrompt({
    prompt: "High-impact retail beat",
    voiceDuration: 22.8,
    targetDuration: 28,
  });

  assert.match(prompt, /High-impact retail beat/);
  assert.match(prompt, /28-second short commercial radio bumper cue/);
  assert.match(prompt, /0s-23s driving background rhythm/);
  assert.match(prompt, /ending on second 28/);
  assert.match(prompt, /no fade out/);
});

test("catálogo de presets de áudio contém definições de alto impacto", () => {
  assert.ok(AUDIO_RECIPE_PRESETS["propaganda-varejo"]);
  assert.ok(AUDIO_RECIPE_PRESETS["spot-promocional"]);
  assert.ok(AUDIO_RECIPE_PRESETS["institucional-premium"]);
  assert.ok(AUDIO_RECIPE_PRESETS["oferta-relampago"]);
  assert.ok(AUDIO_RECIPE_PRESETS["teaser-epico"]);

  const varejo = resolveAudioRecipePreset("propaganda-varejo");
  assert.equal(varejo.voice.name, "Jett");
  assert.equal(varejo.voice.gain, "+15dB");
  assert.equal(varejo.music.gain, "+10dB");
  assert.equal(varejo.music.tailSeconds, 4.0);
});

test("validateAudioRecipe exige texto e normaliza estrutura", () => {
  assert.throws(() => validateAudioRecipe({}), /exige um texto de locução/);

  const validated = validateAudioRecipe({
    schema: AUDIO_RECIPE_SCHEMA,
    title: "Meu Spot",
    voice: {
      text: "Grande queima de estoque neste sábado!",
      name: "Jett",
    },
  });

  assert.equal(validated.schema, AUDIO_RECIPE_SCHEMA);
  assert.equal(validated.title, "Meu Spot");
  assert.equal(validated.voice.name, "Jett");
  assert.equal(validated.voice.gain, "+5dB");
  assert.equal(validated.music.backend, "flow-music");
  assert.equal(validated.music.gain, "+10dB");
  assert.equal(validated.music.tailSeconds, 4.0);
});

test("resolveAudioRecipe mescla preset e sobreposições de flags", async () => {
  const resolved = await resolveAudioRecipe({
    preset: "spot-promocional",
    text: "Super promoção exclusiva com 50% de desconto.",
    voiceGain: "+6dB",
    musicTail: 6,
  });

  assert.equal(resolved.voice.name, "Kero");
  assert.equal(resolved.voice.gain, "+6dB");
  assert.equal(resolved.music.tailSeconds, 6);
  assert.match(resolved.music.prompt, /Modern hype commercial beat/i);
});

test("planAudioRecipe projeta estimativas de tempo e caminhos de saída", () => {
  const recipe = validateAudioRecipe({
    schema: AUDIO_RECIPE_SCHEMA,
    title: "Spot Teste",
    voice: {
      name: "Jett",
      text: "Um dois três quatro cinco seis sete oito nove dez.",
    },
    music: {
      tailSeconds: 5,
    },
  });

  const plan = planAudioRecipe(recipe, { collection: "campanha-teste", outRoot: "CORE/outputs" });
  assert.equal(plan.voice.resolvedName, "Jett");
  assert.ok(plan.voice.wordsCount > 0);
  assert.ok(plan.voice.estimatedDurationSeconds > 0);
  assert.equal(plan.music.estimatedDurationSeconds, Math.ceil(plan.voice.estimatedDurationSeconds + 5));
  assert.match(plan.plannedArtifacts.voiceFile, /audios-soltos[/\\]voz\.wav/);
  assert.match(plan.plannedArtifacts.musicFile, /audios-soltos[/\\]trilha\.wav/);
  assert.match(plan.plannedArtifacts.masterWav, /audios-unidos[/\\]master\.wav/);
  assert.match(plan.plannedArtifacts.masterMp3, /audios-unidos[/\\]master\.mp3/);
});

test("executeAudioRecipe orquestra dublês com cálculo dinâmico de duração e mixagem", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-recipe-test-"));
  try {
    const dummyVoiceWav = path.join(tempDir, "voice-dummy.wav");
    const dummyMusicWav = path.join(tempDir, "music-dummy.wav");

    // Cria arquivos PCM WAV válidos mínimos para teste
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(44 + 48000 * 2 * 2 * 2 - 8, 4); // ~2s a 48kHz stereo
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(2, 22); // Stereo
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(48000 * 2 * 2, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(48000 * 2 * 2 * 2, 40);

    const wavData = Buffer.concat([header, Buffer.alloc(48000 * 2 * 2 * 2)]);
    await writeFile(dummyVoiceWav, wavData);
    await writeFile(dummyMusicWav, wavData);

    let requestedMusicDuration = null;

    const mockTts = async ({ outputFile }) => {
      await writeFile(outputFile, wavData);
      return {
        file: outputFile,
        receipt: `${outputFile}.receipt.json`,
      };
    };

    const mockMusic = async ({ durationSeconds, outputFile }) => {
      requestedMusicDuration = durationSeconds;
      await writeFile(outputFile, wavData);
      return {
        file: outputFile,
        receipt: `${outputFile}.receipt.json`,
      };
    };

    const recipe = await resolveAudioRecipe({
      preset: "propaganda-varejo",
      text: "Texto do spot de varejo de alto impacto.",
      musicTail: 5,
    });

    const result = await executeAudioRecipe({
      recipe,
      collection: "teste-spot",
      outRoot: tempDir,
      generateTts: mockTts,
      generateMusic: mockMusic,
    });

    assert.equal(result.ok, true);
    assert.equal(requestedMusicDuration, 20);
    assert.ok(result.musicDuration > 0);
    assert.ok(result.masterWav);
    assert.ok(result.receiptFile);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
