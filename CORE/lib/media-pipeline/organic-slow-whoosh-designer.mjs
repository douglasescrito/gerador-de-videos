/**
 * Organic Slow Whoosh & Low-Noise Cinema Engine
 * 
 * Gera efeitos sonoros 100% ORGÂNICOS, aveludados e ritmados:
 * - Slow Organic Whooshes (passagens de ar suaves de 0.8s a 1.2s).
 * - Low-Noise Sweeps (ruído marrom aveludado filtrado abaixo de 600Hz para ambiência profunda de cinema).
 * - Velvet Sub-Air Bloom (graves profundos e macios em 50Hz, sem aspereza digital).
 * - Cadência e Ritmo Musical (alinhado com as respirações e compassos, sem metralhadora de clicks).
 */

import path from "node:path";
import fs from "node:fs";
import { runFfmpeg, probeMedia } from "./media-tools.mjs";

const ORGANIC_DIR = path.resolve(import.meta.dirname, "../../assets/sfx/organic-cinema");

/**
 * Gera a paleta de timbres orgânicos de baixa frequência e whooshes lentos.
 */
export async function ensureOrganicCinemaKit({ directory = ORGANIC_DIR } = {}) {
  const targetDir = path.resolve(directory);
  fs.mkdirSync(targetDir, { recursive: true });

  const kit = {
    // 1. Slow Organic Whoosh (1.2s): Ar analógico suave varrendo de 150Hz a 650Hz com cauda macia
    slowWhoosh: path.join(targetDir, "organic-slow-whoosh-1200ms.wav"),
    // 2. Deep Low-Noise Swell (1.0s): Sucção de ar de baixa frequência (Brownian Noise abaixo de 450Hz)
    lowNoiseSwell: path.join(targetDir, "organic-low-noise-swell.wav"),
    // 3. Velvet Sub-Air Bloom (1.5s): Graves aveludados em 48Hz com respiração de fita analógica
    velvetSubAir: path.join(targetDir, "organic-velvet-sub-air.wav"),
    // 4. Soft Air Transit (0.8s): Deslize de ar macio em estéreo largo
    softAirTransit: path.join(targetDir, "organic-soft-air-transit.wav")
  };

  if (!fs.existsSync(kit.slowWhoosh)) {
    // Ruído rosa filtrado com sweep exponencial lento e ressonância suave
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "anoisesrc=d=1.2:c=pink:r=48000,bandpass=f=420:w=1.4,lowpass=f=900,afade=t=in:st=0:d=0.45:curve=qsin,afade=t=out:st=0.55:d=0.65:curve=hsin,volume=3.2",
      "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      kit.slowWhoosh
    ]);
  }

  if (!fs.existsSync(kit.lowNoiseSwell)) {
    // Ruído marrom profundo (Brownian noise) filtrado em 350Hz gerando sucção de ar
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "anoisesrc=d=1.0:c=brown:r=48000,lowpass=f=380,equalizer=f=180:width_type=o:w=1.5:g=4,afade=t=in:st=0:d=0.75:curve=exp,afade=t=out:st=0.75:d=0.25:curve=log,volume=4.0",
      "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      kit.lowNoiseSwell
    ]);
  }

  if (!fs.existsSync(kit.velvetSubAir)) {
    // Onda senoidal amortecida em 48Hz combinada com ar de subgrave aveludado
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "aevalsrc=(sin(2*PI*48*t)+0.3*sin(2*PI*96*t))*exp(-t/0.65):d=1.5,lowpass=f=220,volume=3.5",
      "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      kit.velvetSubAir
    ]);
  }

  if (!fs.existsSync(kit.softAirTransit)) {
    // Deslize de ar estéreo com separação e corte em 750Hz
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "anoisesrc=d=0.8:c=pink:r=48000,bandpass=f=320:w=1.2,lowpass=f=750,afade=t=in:st=0:d=0.3:curve=esin,afade=t=out:st=0.35:d=0.45:curve=hsin,volume=2.8,pan=stereo|c0=c0|c1=0.75*c0",
      "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      kit.softAirTransit
    ]);
  }

  return kit;
}

/**
 * Cria a partitura rítmica e espaçada de Sound Design Orgânico:
 * Foco em compassos musicais, transições lentas e respiro acústico.
 */
export function buildOrganicRhythmicCueSheet({
  durationSeconds = 60.04
}) {
  const cues = [];

  // Ritmo de Respiração: Gatilhos estruturais espaçados a cada 2.5s - 3.5s (nunca em cada sílaba)
  // 1. Impacto Aveludado de Abertura (0s)
  cues.push({
    atMs: 0,
    sound: "velvetSubAir",
    gain: 1.1,
    reason: "Abertura com Velvet Sub-Air (0.0s)"
  });
  cues.push({
    atMs: 0,
    sound: "slowWhoosh",
    gain: 0.9,
    reason: "Slow Whoosh de Abertura (0.0s)"
  });

  // 2. Transições Orgânicas ao longo da Timeline
  for (let t = 2.5; t < durationSeconds; t += 2.5) {
    const isMajorBlock = (t % 10.0 === 0);

    if (isMajorBlock) {
      // 700ms antes do corte: Low-Noise Swell (sucção lenta de ar)
      cues.push({
        atMs: Math.max(0, Math.round((t - 0.7) * 1000)),
        sound: "lowNoiseSwell",
        gain: 1.0,
        reason: `Low-Noise Swell pré-bloco ${t}s`
      });
      // No corte: Sub-Air macio + Slow Whoosh estéreo
      cues.push({
        atMs: Math.round(t * 1000),
        sound: "velvetSubAir",
        gain: 1.15,
        reason: `Velvet Sub-Air no Bloco ${t}s`
      });
      cues.push({
        atMs: Math.round(t * 1000),
        sound: "slowWhoosh",
        gain: 0.85,
        reason: `Slow Whoosh de Bloco ${t}s`
      });
    } else {
      // Transição interna de compasso: Soft Air Transit suave
      cues.push({
        atMs: Math.max(0, Math.round((t - 0.35) * 1000)),
        sound: "softAirTransit",
        gain: 0.75,
        reason: `Soft Air Transit no compasso ${t}s`
      });
    }
  }

  cues.sort((a, b) => a.atMs - b.atMs);

  return {
    durationMs: Math.round(durationSeconds * 1000),
    cues
  };
}

/**
 * Compila a Pista de SFX Orgânico (Slow Whooshes & Low Noise).
 */
export async function compileOrganicCinemaSfx({
  durationSeconds = 10.0,
  outputFile
}) {
  const kit = await ensureOrganicCinemaKit();
  const cueSheet = buildOrganicRhythmicCueSheet({ durationSeconds });
  const cues = cueSheet.cues;

  const soundInputs = {
    slowWhoosh: 0,
    lowNoiseSwell: 1,
    velvetSubAir: 2,
    softAirTransit: 3
  };

  const ffmpegArgs = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", kit.slowWhoosh,
    "-i", kit.lowNoiseSwell,
    "-i", kit.velvetSubAir,
    "-i", kit.softAirTransit
  ];

  const filterParts = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const inputIdx = soundInputs[cue.sound] ?? 0;
    const delayMs = Math.max(0, cue.atMs);
    const gain = cue.gain || 1.0;
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${gain}[a${i}]`);
  }

  // Gerador de silêncio para preencher a timeline exata
  ffmpegArgs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${durationSeconds.toFixed(3)}`);
  const silenceIdx = 4;

  const mixInputs = cues.map((_, i) => `[a${i}]`).join("") + `[${silenceIdx}:a]`;
  const numInputs = cues.length + 1;
  filterParts.push(`${mixInputs}amix=inputs=${numInputs}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,alimiter=limit=0.95:attack=10:release=100[out]`);

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
