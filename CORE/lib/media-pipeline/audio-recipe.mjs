import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveGoogleVidsVoice } from "./google-vids-voices.mjs";
import { AUDIO_RECIPE_PRESETS, resolveAudioRecipePreset } from "./audio-recipe-presets.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { mixAudio } from "./audio-mix.mjs";
import { createArtifactFromFile } from "./artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";

export const AUDIO_RECIPE_SCHEMA = "audio-recipe@1";
export const DEFAULT_WORDS_PER_SECOND = 2.4; // Cadência padrão ajustada (-10% palavras para fala ágil e respiração de trilha)

export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export function estimateSpeechDuration(text, wordsPerSecond = DEFAULT_WORDS_PER_SECOND) {
  const words = countWords(text);
  const wps = Number(wordsPerSecond > 0 ? wordsPerSecond : DEFAULT_WORDS_PER_SECOND);
  return words > 0 ? Math.round((words / wps) * 100) / 100 : 0;
}

export function calculateTargetWordCount({
  musicDuration,
  tailSeconds = 4.0, // Janela canônica de 3 a 5s (ponto central: 4.0s)
  wordsPerSecond = DEFAULT_WORDS_PER_SECOND,
} = {}) {
  const mDur = Number(musicDuration);
  const tail = Number(tailSeconds >= 0 ? tailSeconds : 4.0);
  const wps = Number(wordsPerSecond > 0 ? wordsPerSecond : DEFAULT_WORDS_PER_SECOND);
  const availableVoiceSeconds = Math.max(3, mDur - tail);
  return Math.round(availableVoiceSeconds * wps);
}

export function adaptScriptForDuration({
  text,
  musicDuration,
  tailSeconds = 4.0, // Janela canônica de 3 a 5s (ponto central: 4.0s)
  wordsPerSecond = DEFAULT_WORDS_PER_SECOND,
} = {}) {
  const targetWords = calculateTargetWordCount({ musicDuration, tailSeconds, wordsPerSecond });
  const rawText = String(text ?? "").trim();
  const currentWords = countWords(rawText);

  // Se já está próximo do alvo (dentro de 10%), mantém o texto original
  if (currentWords > 0 && Math.abs(currentWords - targetWords) <= Math.max(4, Math.round(targetWords * 0.10))) {
    return {
      text: rawText,
      targetWords,
      actualWords: currentWords,
      adapted: false,
    };
  }

  // Se o texto for mais curto que o alvo da trilha, expande com blocos comerciais modulares
  if (currentWords < targetWords) {
    const expansionBlocks = [
      "São condições imperdíveis com descontos reais de até setenta por cento e parcelamento facilitado em até vinte e quatro vezes sem juros em todos os cartões!",
      "Smartphones de última geração, notebooks de alto desempenho, Smart TVs, eletroeletrônicos e acessórios de ponta com os menores preços do mercado!",
      "Aproveite a entrega super rápida e a garantia total para renovar seus equipamentos e economizar de verdade como você sempre quis!",
      "Não deixe para depois, acesse agora mesmo o aplicativo oficial ou visite a loja mais próxima antes que os estoques acabem!",
      "É o maior saldão da temporada por tempo limitadíssimo, corra e garanta já o seu!",
    ];

    let combined = rawText;
    for (const block of expansionBlocks) {
      if (countWords(combined) >= targetWords) break;
      combined = `${combined} ${block}`;
    }

    return {
      text: combined.trim(),
      targetWords,
      actualWords: countWords(combined),
      adapted: true,
    };
  }

  // Se o texto for mais longo que o alvo da trilha, condensa mantendo as frases principais
  const sentences = rawText.match(/[^.!?]+[.!?]+/g) || [rawText];
  let condensed = "";
  for (const sentence of sentences) {
    if (countWords(condensed + " " + sentence) > targetWords + 4) break;
    condensed = `${condensed} ${sentence}`.trim();
  }
  if (!condensed) condensed = rawText;

  return {
    text: condensed.trim(),
    targetWords,
    actualWords: countWords(condensed),
    adapted: true,
  };
}

export function buildAudioRecipeMusicPrompt({
  prompt,
  preset = null,
  voiceDuration = 20,
  targetDuration = 20,
} = {}) {
  const tSec = Math.max(10, Math.min(60, Math.round(Number(targetDuration ?? 20))));
  const vSec = Math.max(5, Math.round(Number(voiceDuration ?? (tSec - 5))));
  const base = String(prompt ?? "High-impact energetic commercial radio bumper, punchy modern beat").trim();

  return [
    `[Format: ${tSec}-second short commercial radio bumper cue, instrumental only, no vocals, ${tSec}s duration]`,
    `Style: ${base}`,
    `[Structure: 0s-${vSec}s driving background rhythm with dynamic pocket for voiceover, ${vSec}s-${tSec}s rapid energy build-up to climax, ending on second ${tSec} with a decisive stinger finish and clean resolved chord, no fade out]`,
  ].join("\n\n");
}

export function validateAudioRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("Receita de áudio inválida: deve ser um objeto.");
  }
  const schema = recipe.schema ?? AUDIO_RECIPE_SCHEMA;
  if (schema !== AUDIO_RECIPE_SCHEMA) {
    throw new Error(`Schema de receita de áudio não suportado: "${schema}". Esperado: "${AUDIO_RECIPE_SCHEMA}".`);
  }
  const text = String(recipe.voice?.text ?? recipe.text ?? "").trim();
  if (!text) {
    throw new Error("A receita de áudio exige um texto de locução em 'voice.text' ou 'text'.");
  }
  return {
    schema: AUDIO_RECIPE_SCHEMA,
    title: recipe.title ?? "Spot de Áudio",
    description: recipe.description ?? "",
    strategy: recipe.strategy === "voice-first" ? "voice-first" : "music-first",
    wordsPerSecond: Number(recipe.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND),
    voice: {
      provider: recipe.voice?.provider ?? "google-vids",
      name: recipe.voice?.name ?? "Jett",
      gain: recipe.voice?.gain ?? "+5dB",
      text,
    },
    music: {
      backend: recipe.music?.backend ?? "flow-music",
      prompt: recipe.music?.prompt ?? "High-impact energetic commercial music bed with definitive clean closure, no vocals",
      gain: recipe.music?.gain ?? "+10dB",
      requestedDuration: Number(recipe.music?.requestedDuration ?? recipe.musicDuration ?? 20),
      tailSeconds: Number(recipe.music?.tailSeconds ?? recipe.musicTail ?? 4.0),
      duckingThreshold: Number(recipe.music?.duckingThreshold ?? 0.08),
      duckingRatio: Number(recipe.music?.duckingRatio ?? 8),
    },
    master: {
      loudness: recipe.master?.loudness ?? "platform",
      fadeIn: Number(recipe.master?.fadeIn ?? 0.2),
      fadeOut: Number(recipe.master?.fadeOut ?? 0),
      bypassDucking: Boolean(recipe.master?.bypassDucking),
    },
  };
}

export async function resolveAudioRecipe({
  recipe = null,
  recipeFile = null,
  preset = null,
  strategy = null,
  wordsPerSecond = null,
  text = null,
  textFile = null,
  voice = null,
  voiceGain = null,
  musicPrompt = null,
  musicPreset = null,
  musicGain = null,
  musicTail = null,
  musicDuration = null,
  loudness = null,
  title = null,
} = {}) {
  let baseRecipe = {};

  if (recipeFile) {
    const raw = await readFile(path.resolve(String(recipeFile)), "utf8");
    baseRecipe = JSON.parse(raw);
  } else if (recipe && typeof recipe === "object") {
    baseRecipe = recipe;
  }

  const selectedPreset = resolveAudioRecipePreset(preset ?? baseRecipe.preset);
  if (selectedPreset) {
    baseRecipe = {
      ...selectedPreset,
      ...baseRecipe,
      voice: { ...selectedPreset.voice, ...baseRecipe.voice },
      music: { ...selectedPreset.music, ...baseRecipe.music },
      master: { ...selectedPreset.master, ...baseRecipe.master },
    };
  }

  let effectiveText = text;
  if (!effectiveText && textFile) {
    effectiveText = await readFile(path.resolve(String(textFile)), "utf8");
  }
  if (!effectiveText && baseRecipe.voice?.text) {
    effectiveText = baseRecipe.voice.text;
  }
  if (!effectiveText && baseRecipe.text) {
    effectiveText = baseRecipe.text;
  }

  const merged = {
    schema: AUDIO_RECIPE_SCHEMA,
    title: title ?? baseRecipe.title ?? (preset ? `Spot ${preset}` : "Spot de Áudio Studio"),
    description: baseRecipe.description ?? "",
    strategy: strategy ?? baseRecipe.strategy ?? "music-first",
    wordsPerSecond: Number(wordsPerSecond ?? baseRecipe.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND),
    voice: {
      provider: baseRecipe.voice?.provider ?? "google-vids",
      name: voice ?? baseRecipe.voice?.name ?? "Jett",
      gain: voiceGain ?? baseRecipe.voice?.gain ?? "+5dB",
      text: String(effectiveText ?? "").trim(),
    },
    music: {
      backend: baseRecipe.music?.backend ?? "flow-music",
      prompt: musicPrompt ?? baseRecipe.music?.prompt ?? "High-impact energetic commercial music bed with definitive clean closure, no vocals",
      preset: musicPreset ?? baseRecipe.music?.preset ?? null,
      gain: musicGain ?? baseRecipe.music?.gain ?? "+10dB",
      requestedDuration: Number(musicDuration ?? baseRecipe.music?.requestedDuration ?? 20),
      tailSeconds: Number(musicTail ?? baseRecipe.music?.tailSeconds ?? 4.0),
      duckingThreshold: Number(baseRecipe.music?.duckingThreshold ?? 0.08),
      duckingRatio: Number(baseRecipe.music?.duckingRatio ?? 8),
    },
    master: {
      loudness: loudness ?? baseRecipe.master?.loudness ?? "platform",
      fadeIn: Number(baseRecipe.master?.fadeIn ?? 0.2),
      fadeOut: Number(baseRecipe.master?.fadeOut ?? 0),
      bypassDucking: Boolean(baseRecipe.master?.bypassDucking),
    },
  };

  return validateAudioRecipe(merged);
}

export function planAudioRecipe(validatedRecipe, { collection = null, out = null, outRoot = "outputs" } = {}) {
  const resolvedVoice = resolveGoogleVidsVoice(validatedRecipe.voice.name);
  const wordsCount = countWords(validatedRecipe.voice.text);
  const estimatedVoiceDuration = estimateSpeechDuration(validatedRecipe.voice.text, validatedRecipe.wordsPerSecond);
  const estimatedMusicDuration = Math.ceil(estimatedVoiceDuration + validatedRecipe.music.tailSeconds);

  const collectionName = collection || `audio-spot-${Date.now()}`;
  const baseDir = path.resolve(outRoot, collectionName);
  const masterWav = out ? path.resolve(out) : path.join(baseDir, "audios-unidos", "master.wav");
  const masterMp3 = masterWav.replace(/\.wav$/i, ".mp3");
  const recipeReceipt = path.join(baseDir, "receitas", "audio-recipe.receipt.json");

  return {
    schema: AUDIO_RECIPE_SCHEMA,
    title: validatedRecipe.title,
    strategy: validatedRecipe.strategy,
    voice: {
      ...validatedRecipe.voice,
      resolvedName: resolvedVoice.name,
      engine: resolvedVoice.engine,
      wordsCount,
      estimatedDurationSeconds: estimatedVoiceDuration,
    },
    music: {
      ...validatedRecipe.music,
      estimatedDurationSeconds: estimatedMusicDuration,
    },
    master: {
      ...validatedRecipe.master,
      estimatedTotalDurationSeconds: estimatedMusicDuration,
    },
    plannedArtifacts: {
      collection: collectionName,
      voiceFile: path.join(baseDir, "audios-soltos", "voz.wav"),
      musicFile: path.join(baseDir, "audios-soltos", "trilha.wav"),
      masterWav,
      masterMp3,
      mixReceipt: `${masterWav}.receipt.json`,
      recipeReceipt,
      receipt: recipeReceipt,
    },
  };
}

export async function executeAudioRecipe({
  recipe,
  collection = null,
  out = null,
  outRoot = "outputs",
  documentUrl = null,
  generateTts = null,
  generateMusic = null,
} = {}) {
  const plan = planAudioRecipe(recipe, { collection, out, outRoot });
  const { plannedArtifacts } = plan;

  if (!generateTts || !generateMusic) {
    throw new Error("Executores de TTS e Música são obrigatórios para rodar uma receita de áudio.");
  }

  await mkdir(path.dirname(plannedArtifacts.voiceFile), { recursive: true });
  await mkdir(path.dirname(plannedArtifacts.musicFile), { recursive: true });
  await mkdir(path.dirname(plannedArtifacts.masterWav), { recursive: true });
  await mkdir(path.dirname(plannedArtifacts.recipeReceipt), { recursive: true });

  let musicResult = null;
  let ttsResult = null;
  let voiceDuration = null;
  let musicDuration = null;
  let targetMusicDuration = null;

  if (recipe.strategy === "music-first") {
    // ESTRATÉGIA 1: MUSIC-FIRST (A música lidera a timeline orgânica)
    // 1. Gera a trilha sonora no Flow Music com a duração inicial solicitada (ex: 20s)
    const requestedDuration = recipe.music.requestedDuration ?? 20;
    const initialPrompt = buildAudioRecipeMusicPrompt({
      prompt: recipe.music.prompt,
      preset: recipe.music.preset,
      voiceDuration: Math.max(5, requestedDuration - recipe.music.tailSeconds),
      targetDuration: requestedDuration,
    });

    musicResult = await generateMusic({
      backend: recipe.music.backend,
      prompt: initialPrompt,
      preset: recipe.music.preset,
      durationSeconds: requestedDuration,
      preserveOriginalDuration: true,
      outputFile: plannedArtifacts.musicFile,
    });

    // 2. Mede a duração física real da música gerada pelo Flow
    const musicProbe = await probeMedia(musicResult.file ?? plannedArtifacts.musicFile);
    musicDuration = musicProbe.duration ?? requestedDuration;

    // 3. Adapta o roteiro dinamicamente para casar perfeitamente com a duração real da trilha gerada
    const adaptation = adaptScriptForDuration({
      text: recipe.voice.text,
      musicDuration,
      tailSeconds: recipe.music.tailSeconds,
      wordsPerSecond: recipe.wordsPerSecond,
    });
    const effectiveText = adaptation.text;

    // 4. Sintetiza a locução no Google Vids com o texto dimensionado
    ttsResult = await generateTts({
      provider: recipe.voice.provider,
      text: effectiveText,
      voice: recipe.voice.name,
      outputFile: plannedArtifacts.voiceFile,
      documentUrl,
      newScene: true,
    });

    const voiceProbe = await probeMedia(ttsResult.file ?? plannedArtifacts.voiceFile);
    voiceDuration = voiceProbe.duration ?? Math.max(3, musicDuration - recipe.music.tailSeconds);
    targetMusicDuration = musicDuration;
  } else {
    // ESTRATÉGIA 2: VOICE-FIRST (A fala lidera a timeline)
    ttsResult = await generateTts({
      provider: recipe.voice.provider,
      text: recipe.voice.text,
      voice: recipe.voice.name,
      outputFile: plannedArtifacts.voiceFile,
      documentUrl,
      newScene: true,
    });

    const voiceProbe = await probeMedia(ttsResult.file ?? plannedArtifacts.voiceFile);
    voiceDuration = voiceProbe.duration ?? plan.voice.estimatedDurationSeconds;
    targetMusicDuration = Math.ceil(voiceDuration + recipe.music.tailSeconds);

    const effectiveMusicPrompt = buildAudioRecipeMusicPrompt({
      prompt: recipe.music.prompt,
      preset: recipe.music.preset,
      voiceDuration,
      targetDuration: targetMusicDuration,
    });

    musicResult = await generateMusic({
      backend: recipe.music.backend,
      prompt: effectiveMusicPrompt,
      preset: recipe.music.preset,
      durationSeconds: targetMusicDuration,
      preserveOriginalDuration: true,
      outputFile: plannedArtifacts.musicFile,
    });

    const musicProbe = await probeMedia(musicResult.file ?? plannedArtifacts.musicFile);
    musicDuration = musicProbe.duration ?? targetMusicDuration;
  }

  // 5. Mixagem Master Studio com preservação integral do final da música
  const mixResult = await mixAudio({
    voiceFile: ttsResult.file ?? plannedArtifacts.voiceFile,
    musicFile: musicResult.file ?? plannedArtifacts.musicFile,
    outputFile: plannedArtifacts.masterWav,
    receiptFile: plannedArtifacts.mixReceipt,
    loudness: recipe.master.loudness,
    voiceGain: recipe.voice.gain,
    musicGain: recipe.music.gain,
    musicTail: recipe.music.tailSeconds,
    preserveMusicEnd: true,
    duckingThreshold: recipe.music.duckingThreshold,
    duckingRatio: recipe.music.duckingRatio,
    bypassDucking: recipe.master.bypassDucking,
    fadeIn: recipe.master.fadeIn,
    fadeOut: recipe.master.fadeOut,
    parentReceipts: [ttsResult.receipt, musicResult.receipt].filter(Boolean),
    metadata: {
      recipe: recipe.title,
      recipeSchema: AUDIO_RECIPE_SCHEMA,
      strategy: recipe.strategy,
      voiceDuration,
      musicDuration,
    },
  });

  // 6. Converte para MP3 320k para audição imediata
  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    plannedArtifacts.masterWav,
    "-b:a",
    "320k",
    plannedArtifacts.masterMp3,
  ]);

  const [masterArtifact, mp3Artifact] = await Promise.all([
    createArtifactFromFile({ file: plannedArtifacts.masterWav, kind: "audio", role: "audio-master" }),
    createArtifactFromFile({ file: plannedArtifacts.masterMp3, kind: "audio", role: "audio-mp3-preview" }),
  ]);

  const overallReceipt = createStageReceipt({
    operation: "audio-recipe-production",
    provider: "studio-composite",
    mode: "studio",
    stage: "audio-master",
    parameters: {
      recipe,
      strategy: recipe.strategy,
      voiceDuration,
      musicDuration,
      analysis: mixResult.analysis,
    },
    inputs: [
      ttsResult.receipt ? { role: "voice-receipt", path: ttsResult.receipt } : null,
      musicResult.receipt ? { role: "music-receipt", path: musicResult.receipt } : null,
    ].filter(Boolean),
    artifacts: [masterArtifact, mp3Artifact],
    startedAt: new Date(),
    completedAt: new Date(),
  });

  await writeStageReceipt(plannedArtifacts.recipeReceipt, overallReceipt);

  return {
    ok: true,
    recipe: recipe.title,
    strategy: recipe.strategy,
    voiceDuration,
    musicDuration,
    masterWav: plannedArtifacts.masterWav,
    masterMp3: plannedArtifacts.masterMp3,
    receiptFile: plannedArtifacts.receipt,
    analysis: mixResult.analysis,
  };
}
