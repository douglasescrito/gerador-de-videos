/**
 * Dense Cinema Motion FX Engine (Hiper-Sonorização Tátil & Cinema Sound Design)
 * 
 * Gera uma camada rica, densa e impactante de efeitos sonoros sincronizados:
 * - Micro-UI Pops e Clicks em cada palavra que surge na tela.
 * - Dynamic Fast Whooshes e Pitch Sweeps em cada transição e slide de layout.
 * - Sub-Bass Heavy Impacts e Braams em palavras de ênfase.
 * - Digital Glitches e Sci-Fi Risers em mudanças de energia.
 */

import path from "node:path";
import fs from "node:fs";
import { runFfmpeg, probeMedia } from "./media-tools.mjs";

const SFX_DIR = path.resolve(import.meta.dirname, "../../assets/sfx");

/**
 * Gera assets sintéticos de alta fidelidade se ainda não existirem (UI clicks, Risers, Sub-drops).
 */
export async function ensureRichSfxLibrary({ directory = SFX_DIR } = {}) {
  const targetDir = path.resolve(directory);
  fs.mkdirSync(targetDir, { recursive: true });

  const requiredSounds = [
    {
      name: "ui-pop.wav",
      // Sine wave pitch sweep descendente rápido (1200Hz -> 300Hz em 40ms) para click tátil
      filter: "aevalsrc=sin(2*PI*(1200-900*t/0.04)*t)*exp(-t/0.015):d=0.05,volume=2.0"
    },
    {
      name: "ui-tick.wav",
      // Micro ruído estalado de alta frequência (mechanical switch)
      filter: "aevalsrc=sin(2*PI*2800*t)*exp(-t/0.008):d=0.03,volume=1.5"
    },
    {
      name: "sub-impact.wav",
      // Sub-bass 50Hz com distorção harmônica e decaimento pesado
      filter: "aevalsrc=(sin(2*PI*(90-50*t/0.6)*t)+0.3*sin(2*PI*40*t))*exp(-t/0.3):d=0.7,volume=2.5"
    },
    {
      name: "fast-swoosh.wav",
      // Ruído branco filtrado em bandpass com sweep de frequência (whoosh rápido)
      filter: "anoisesrc=d=0.3:c=pink:r=48000,bandpass=f=1200:w=1.2,afade=t=in:st=0:d=0.08,afade=t=out:st=0.15:d=0.15,volume=3.0"
    },
    {
      name: "laser-riser.wav",
      // Riser ascendente com sweep de 200Hz a 1800Hz
      filter: "aevalsrc=sin(2*PI*(200+1600*(t/0.5)*(t/0.5))*t):d=0.5,afade=t=in:st=0:d=0.1,afade=t=out:st=0.4:d=0.1,volume=1.8"
    }
  ];

  for (const snd of requiredSounds) {
    const p = path.join(targetDir, snd.name);
    if (!fs.existsSync(p)) {
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", snd.filter,
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
        p
      ]);
    }
  }
}

/**
 * Cria uma Cue Sheet densa com dezenas de micro e macro efeitos sonoros.
 */
export function buildDenseKineticSfxCueSheet({
  durationSeconds = 60.04,
  whisperWords = []
}) {
  const cues = [];

  // 1. Macro-Efeitos: Sub-Impacts e Whooshes nos Cortes de Cena (0s, 10s, 20s, 30s, 40s, 50s)
  for (let t = 0; t < durationSeconds; t += 10.0) {
    cues.push({
      atMs: Math.max(0, Math.round(t * 1000)),
      sound: "sub-impact",
      gain: 1.2,
      reason: `Impacto de Transição de Cena ${t}s`
    });
    if (t > 0) {
      cues.push({
        atMs: Math.round((t - 0.28) * 1000),
        sound: "fast-swoosh",
        gain: 1.1,
        reason: `Whoosh de Entrada de Bloco ${t}s`
      });
      cues.push({
        atMs: Math.round((t - 0.5) * 1000),
        sound: "laser-riser",
        gain: 0.8,
        reason: `Riser de Transição ${t}s`
      });
    }
  }

  // 2. Micro-Efeitos: UI Clicks / Pops em Palavras Visuais do Whisper
  whisperWords.forEach((w, idx) => {
    const isMajorWord = w.text.length >= 6 || ["BEM-VINDO", "NOVA", "GERADOR", "VÍDEOS", "4K", "SOUND", "CINEMA", "FUTURO", "MARKETING", "AUTORIDADE"].includes(w.text.toUpperCase());
    
    if (isMajorWord) {
      cues.push({
        atMs: Math.round(w.start * 1000),
        sound: "ui-pop",
        gain: 0.9,
        reason: `UI Pop na palavra '${w.text}' (${w.start}s)`
      });
      cues.push({
        atMs: Math.max(0, Math.round((w.start - 0.12) * 1000)),
        sound: "fast-swoosh",
        gain: 0.7,
        reason: `Micro-Swoosh em '${w.text}'`
      });
    } else if (idx % 2 === 0) {
      cues.push({
        atMs: Math.round(w.start * 1000),
        sound: "ui-tick",
        gain: 0.6,
        reason: `UI Tick tátil em '${w.text}'`
      });
    }
  });

  // Ordena cronologicamente
  cues.sort((a, b) => a.atMs - b.atMs);

  return {
    durationMs: Math.round(durationSeconds * 1000),
    cues
  };
}

/**
 * Compila a Trilha de FX Densa com mixagem balanceada e limitador de pico.
 */
export async function compileDenseCinemaSfxBed({
  durationSeconds = 60.04,
  whisperWords = [],
  outputFile
}) {
  await ensureRichSfxLibrary();
  const cueSheet = buildDenseKineticSfxCueSheet({ durationSeconds, whisperWords });
  const cues = cueSheet.cues;

  const uniqueSounds = [...new Set(cues.map(c => c.sound))];
  const soundInputs = {};
  const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-y"];

  for (let i = 0; i < uniqueSounds.length; i++) {
    const s = uniqueSounds[i];
    const p = path.join(SFX_DIR, s.endsWith(".wav") ? s : `${s}.wav`);
    ffmpegArgs.push("-i", p);
    soundInputs[s] = i;
  }

  const filterParts = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const inputIdx = soundInputs[cue.sound];
    const delayMs = Math.max(0, cue.atMs);
    const gain = cue.gain || 1.0;
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${gain}[a${i}]`);
  }

  // Gerador de silêncio mestre
  ffmpegArgs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${durationSeconds.toFixed(3)}`);
  const silenceIdx = uniqueSounds.length;

  const mixInputs = cues.map((_, i) => `[a${i}]`).join("") + `[${silenceIdx}:a]`;
  const numInputs = cues.length + 1;
  filterParts.push(`${mixInputs}amix=inputs=${numInputs}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=50[out]`);

  ffmpegArgs.push("-filter_complex", filterParts.join(";"));
  ffmpegArgs.push("-map", "[out]");
  ffmpegArgs.push("-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2");
  ffmpegArgs.push(outputFile);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  await runFfmpeg(ffmpegArgs);

  return {
    outputFile,
    totalCues: cues.length,
    cues
  };
}
