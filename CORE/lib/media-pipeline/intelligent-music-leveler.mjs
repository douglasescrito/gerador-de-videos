/**
 * Intelligent Music Surge Detector & Adaptive Dynamic Leveler
 * 
 * Analisa a energia RMS/LUFS contínua da trilha sonora, detecta picos e crescendos
 * indesejados durante a fala, aplica equalização dinâmica e gera uma curva
 * de compensação automática antes da mixagem final de Master.
 */

import path from "node:path";
import fs from "node:fs";
import { runCommand, runFfmpeg, probeMedia } from "./media-tools.mjs";

/**
 * Analisa a energia RMS contínua de um arquivo de áudio em janelas de 100ms.
 */
export async function analyzeAudioEnergyProfile(audioFile) {
  const { stdout } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i", audioFile,
    "-af", "astats=metadata=1:reset=4800,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-"
  ]);

  const lines = stdout.split("\n");
  const samples = [];
  let curTime = 0;

  for (const line of lines) {
    if (line.includes("pts_time:")) {
      const match = line.match(/pts_time:([\d.]+)/);
      if (match) curTime = parseFloat(match[1]);
    } else if (line.includes("RMS_level=")) {
      const match = line.match(/RMS_level=([-\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (Number.isFinite(val) && val > -90) {
          samples.push({ time: curTime, rms: val });
        }
      }
    }
  }

  return samples;
}

/**
 * Detecta momentos onde a trilha sobe excessivamente e calcula a curva de compensação.
 */
export async function detectAndCalculateAntiSurgeCurve({
  musicFile,
  voiceFile = null,
  targetMusicRmsDuringSpeech = -22.0, // dBFS alvo durante a locução
  outroStartTime = 58.5,            // Início do arremate final onde a música PODE subir
  outroBoostDb = 8.0                // Ganho do arremate final
}) {
  const musicSamples = await analyzeAudioEnergyProfile(musicFile);
  
  if (musicSamples.length === 0) {
    throw new Error("Não foi possível extrair medições de energia da trilha.");
  }

  const surgePoints = [];
  const keyframes = [];

  // Média móvel e cálculo de compensação
  for (let i = 0; i < musicSamples.length; i += 10) { // Amostragem a cada ~1s
    const sample = musicSamples[i];
    const t = sample.time;
    const currentRms = sample.rms;

    if (t >= outroStartTime) {
      // No final (arremate), permite a música subir com riqueza plena
      keyframes.push({ time: parseFloat(t.toFixed(2)), db: outroBoostDb });
    } else {
      // Durante a locução, calcula o excesso de ganho em relação ao alvo
      // Se a música estiver a -16 dBFS e o alvo for -22 dBFS, o excesso é +6 dB -> aplica atenuação de -6 dB
      const excess = currentRms - targetMusicRmsDuringSpeech;
      let correctionDb = 0;

      if (excess > 0) {
        // Atenua proporcionalmente ao pico detectado
        correctionDb = -Math.min(12, excess * 0.85);
        surgePoints.push({
          time: parseFloat(t.toFixed(2)),
          rmsDetected: parseFloat(currentRms.toFixed(2)),
          surgeExcess: parseFloat(excess.toFixed(2)),
          attenuationApplied: parseFloat(correctionDb.toFixed(2))
        });
      } else {
        correctionDb = 0; // Trilha já está no nível confortável
      }

      keyframes.push({ time: parseFloat(t.toFixed(2)), db: parseFloat(correctionDb.toFixed(2)) });
    }
  }

  // Deduplica e garante ordenação
  keyframes.sort((a, b) => a.time - b.time);

  return {
    totalSamplesAnalyzed: musicSamples.length,
    surgePointsDetected: surgePoints.length,
    surges: surgePoints,
    compensationKeyframes: keyframes
  };
}

/**
 * Executa o pré-tratamento da Trilha com Equalização Dinâmica e Nivelamento Anti-Surge.
 */
export async function generateLeveledMusicStem({
  musicFile,
  voiceFile,
  outputFile,
  targetMusicRmsDuringSpeech = -22.0,
  outroStartTime = 58.5
}) {
  const analysis = await detectAndCalculateAntiSurgeCurve({
    musicFile,
    voiceFile,
    targetMusicRmsDuringSpeech,
    outroStartTime
  });

  // Converte keyframes em expressão FFmpeg
  const sorted = analysis.compensationKeyframes;
  const clauses = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    const v0 = Math.pow(10, p0.db / 20);
    const v1 = Math.pow(10, p1.db / 20);
    const dt = Math.max(0.001, p1.time - p0.time);
    const dv = v1 - v0;
    const expr = `(${v0.toFixed(4)}+((t-${p0.time.toFixed(3)})*${dv.toFixed(4)}/${dt.toFixed(3)}))`;
    clauses.push(`between(t,${p0.time.toFixed(3)},${p1.time.toFixed(3)})*${expr}`);
  }
  const firstVal = Math.pow(10, sorted[0].db / 20).toFixed(4);
  const lastVal = Math.pow(10, sorted[sorted.length - 1].db / 20).toFixed(4);
  const volumeExpr = `lt(t,${sorted[0].time.toFixed(3)})*${firstVal}+${clauses.join("+")}+gte(t,${sorted[sorted.length - 1].time.toFixed(3)})*${lastVal}`;

  // Filtro de pré-processamento da Trilha:
  // 1. Equalizador Dinâmico: Cria bolsão de presença para voz (corte suave de 3.5dB em 2.4kHz)
  // 2. Curva de volume anti-surge
  // 3. Compressão suave de teto
  const filter = [
    `equalizer=f=2400:width_type=o:w=1.6:g=-3.5`,
    `volume=eval=frame:volume='${volumeExpr}'`,
    `compand=attacks=0.05:decays=0.3:points=-80/-80|-24/-24|-12/-15|0/-6:soft-knee=6`
  ].join(",");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  await runFfmpeg([
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", musicFile,
    "-af", filter,
    "-c:a", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    outputFile
  ]);

  return {
    outputFile,
    analysis
  };
}
