/**
 * Post-Video Sound Designer & Flow SFX Generator
 * 
 * Cria uma camada dedicada de efeitos sonoros (Sound Design) pós-vídeo:
 * 1. Gera cama de sound design/foley via Flow Music com prompt focado em Sound FX.
 * 2. Compila efeitos pontuais sincronizados com cortes de cena e palavras de impacto (Whoosh, Boom, Glitch, UI Tick).
 * 3. Mixa tudo em uma pista limpa de SFX (sfx-master.wav) pronta para o Master e o Editor.
 */

import path from "node:path";
import fs from "node:fs";
import { runFfmpeg, runCommand } from "./media-tools.mjs";
import { generateFlowMusicWithBrowserAuth } from "../../scripts/flow-music-headless.mjs";

const SFX_ASSETS_DIR = path.resolve(import.meta.dirname, "../../assets/sfx");

/**
 * Cria a Cue Sheet de Sound Design baseada nos cortes de cena e palavras-chave.
 */
export function buildKineticSfxCueSheet({
  durationSeconds = 60.04,
  sceneCutIntervalSeconds = 10.0,
  whisperWords = []
}) {
  const cues = [];

  // 1. Efeitos de Transição de Cena (Whooshes nos cortes 10s, 20s, 30s, 40s, 50s)
  for (let t = sceneCutIntervalSeconds; t < durationSeconds; t += sceneCutIntervalSeconds) {
    cues.push({
      atMs: Math.round((t - 0.25) * 1000), // Inicia 250ms antes do corte para criar rampa
      sound: "whoosh",
      gain: 0.85,
      reason: `Transição de Cena em ${t}s`
    });
  }

  // 2. Efeitos de Impacto em Palavras de Alta Energia
  const impactWords = [
    { word: "BEM-VINDO", sound: "boom", gain: 0.8 },
    { word: "REVOLUCIONÁRIA", sound: "glitch", gain: 0.75 },
    { word: "SOUND", sound: "whoosh", gain: 0.7 },
    { word: "CINEMA", sound: "boom", gain: 0.8 },
    { word: "4K", sound: "glass", gain: 0.7 },
    { word: "PERFEIÇÃO", sound: "boom", gain: 0.75 },
    { word: "FUTURO", sound: "whoosh", gain: 0.8 },
    { word: "INTELIGENTE", sound: "boom", gain: 0.85 },
  ];

  for (const imp of impactWords) {
    const found = whisperWords.find(w => w.text.toUpperCase().includes(imp.word));
    if (found) {
      cues.push({
        atMs: Math.round(found.start * 1000),
        sound: imp.sound,
        gain: imp.gain,
        reason: `Impacto Vocal em '${found.text}' (${found.start}s)`
      });
    }
  }

  // Ordena por tempo
  cues.sort((a, b) => a.atMs - b.atMs);

  return {
    durationMs: Math.round(durationSeconds * 1000),
    cues
  };
}

/**
 * Compila os arquivos de SFX pontuais sincronizados na timeline.
 */
export async function compileKineticSfxBed({ cues, durationMs, outputFile }) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  if (!cues || cues.length === 0) {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${(durationMs / 1000).toFixed(3)}`,
      "-c:a", "pcm_s16le", outputFile
    ]);
    return outputFile;
  }

  const uniqueSounds = [...new Set(cues.map(c => c.sound))];
  const soundInputs = {};
  const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-y"];

  // Entradas de áudio dos assets WAV
  for (let i = 0; i < uniqueSounds.length; i++) {
    const s = uniqueSounds[i];
    const p = path.join(SFX_ASSETS_DIR, `${s}.wav`);
    ffmpegArgs.push("-i", p);
    soundInputs[s] = i;
  }

  const filterParts = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const inputIdx = soundInputs[cue.sound];
    const delayMs = cue.atMs;
    const gain = cue.gain || 1.0;
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${gain}[a${i}]`);
  }

  // Gerador de silêncio de fundo para preencher toda a timeline
  const durationSecs = durationMs / 1000;
  ffmpegArgs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${durationSecs.toFixed(3)}`);
  const silenceIdx = uniqueSounds.length;

  const mixInputs = cues.map((_, i) => `[a${i}]`).join("") + `[${silenceIdx}:a]`;
  const numInputs = cues.length + 1;
  filterParts.push(`${mixInputs}amix=inputs=${numInputs}:duration=first:dropout_transition=0,alimiter=limit=0.98[out]`);

  ffmpegArgs.push("-filter_complex", filterParts.join(";"));
  ffmpegArgs.push("-map", "[out]");
  ffmpegArgs.push("-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2");
  ffmpegArgs.push(outputFile);

  await runFfmpeg(ffmpegArgs);
  return outputFile;
}

/**
 * Gera uma camada de Sound Design usando Flow Music com prompt exclusivo de FX.
 */
export async function generateFlowSoundDesignBed({
  durationSeconds = 60,
  outputFile,
  style = "cinematic-motion"
}) {
  const prompt = `[Format: ${durationSeconds}-second sound design cue, no melody, no music chords, no vocals] Pure motion graphics sound design bed, dynamic whoosh transitions, sub-bass impacts, digital pops and clicks, futuristic risers, atmospheric foley, tactile cinematic sound effects, high-fidelity stereo, crisp transients, [NEGATIVE AUDIO PROMPT: NO SINGING, NO MELODY, NO HARMONY, NO VOCALS, SOUND FX ONLY]`;

  console.log(`⚡ Solicitando Cama de Sound Design ao Flow Music (${durationSeconds}s)...`);
  
  const res = await generateFlowMusicWithBrowserAuth({
    prompt,
    durationSeconds,
    outputFile,
    preserveOriginalDuration: true,
  });

  return res;
}

/**
 * Mixa e combina a camada de Sound Design completa pós-vídeo.
 */
export async function createCompletePostVideoSfxLayer({
  durationSeconds = 60.04,
  whisperWords = [],
  outputFile,
  includeFlowBed = false,
  flowBedFile = null
}) {
  const cueSheet = buildKineticSfxCueSheet({
    durationSeconds,
    sceneCutIntervalSeconds: 10.0,
    whisperWords
  });

  const kineticBedFile = path.resolve(path.dirname(outputFile), "sfx-kinetic-triggers.wav");
  await compileKineticSfxBed({
    cues: cueSheet.cues,
    durationMs: cueSheet.durationMs,
    outputFile: kineticBedFile
  });

  if (includeFlowBed && flowBedFile && fs.existsSync(flowBedFile)) {
    // Mixa os gatilhos pontuais com a cama atmosférica do Flow
    const filter = `[0:a]volume=0.8[kin];[1:a]volume=0.5[flow];[kin][flow]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.98[out]`;
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", kineticBedFile,
      "-i", flowBedFile,
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "pcm_s16le",
      "-ar", "48000", "-ac", "2",
      outputFile
    ]);
  } else {
    fs.copyFileSync(kineticBedFile, outputFile);
  }

  return {
    outputFile,
    cuesCount: cueSheet.cues.length,
    cues: cueSheet.cues
  };
}
