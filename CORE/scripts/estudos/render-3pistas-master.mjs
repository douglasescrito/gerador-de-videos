import path from "node:path";
import { lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runFfmpeg, probeMedia } from "../../lib/media-pipeline/media-tools.mjs";
import { analyzeAudio, mixAudio } from "../../lib/media-pipeline/audio-mix.mjs";
import { createArtifactFromFile } from "../../lib/media-pipeline/artifact.mjs";
import { createStageReceipt, writeStageReceipt } from "../../lib/media-pipeline/pipeline-operation.mjs";

export async function render3PistasMaster({ voice, music, sfx, out, duration, voiceGain = 1, musicGain = 0.45, sfxGain = 0.2 } = {}) {
  if (![voice, music, sfx, out].every(value => typeof value === "string" && value.trim())) throw new Error("Informe voice, music, sfx e out.");
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Duração deve ser positiva em segundos.");
  for (const gain of [voiceGain, musicGain, sfxGain]) {
    if (!Number.isFinite(Number(gain)) || Number(gain) < 0) throw new Error("Ganhos devem ser números não negativos em escala linear.");
  }
  const sfxGainDb = 20 * Math.log10(Number(sfxGain));
  if (!Number.isFinite(sfxGainDb) || sfxGainDb < -192 || sfxGainDb > 24) throw new Error("Ganho SFX deve ser positivo e corresponder a -192 até +24 dB.");
  const outWav = path.resolve(out);
  if (path.extname(outWav).toLowerCase() !== ".wav") throw new Error("A saída deve ter extensão .wav.");
  const outMp3 = outWav.slice(0, -4) + ".mp3";
  for (const file of [outWav, outMp3, `${outWav}.receipt.json`, `${outMp3}.receipt.json`]) {
    try { await lstat(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error(`Saída já existe; escolha outro destino: ${file}`);
  }
  const mixed = await mixAudio({
    voiceFile: path.resolve(voice), musicFile: path.resolve(music),
    sfxInputs: [{ file: path.resolve(sfx), role: "sfx", atSeconds: 0, gainDb: sfxGainDb }],
    outputFile: outWav, durationSeconds: seconds,
    voiceGain: Number(voiceGain), musicGain: Number(musicGain),
    loudness: "platform", fadeIn: 0, fadeOut: 0,
    metadata: { helper: "render-3pistas-master", soundDesign: "user-supplied-synchronized-track" },
  });
  await runFfmpeg(["-nostdin", "-n", "-i", outWav, "-b:a", "320k", outMp3]);
  const [analysis, probe, artifact] = await Promise.all([
    analyzeAudio(outMp3), probeMedia(outMp3),
    createArtifactFromFile({ file: outMp3, kind: "audio", role: "audio-master", source: { provider: "ffmpeg" } }),
  ]);
  const receipt = createStageReceipt({
    operation: "encode-mp3", provider: "ffmpeg", mode: "studio", stage: "audio-encode",
    parameters: { bitrate: "320k", source: outWav, fadeOut: 0 },
    inputs: mixed.receipt.artifacts, artifacts: [artifact],
    metadata: { analysis, probe, sourceReceiptFile: mixed.receiptFile },
  });
  await writeStageReceipt(`${outMp3}.receipt.json`, receipt);
  return { outWav, outMp3, wavReceipt: mixed.receiptFile, mp3Receipt: `${outMp3}.receipt.json`, wavAnalysis: mixed.analysis, mp3Analysis: analysis };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Uso: node scripts/estudos/render-3pistas-master.mjs --voice voz.wav --music trilha.wav --sfx efeitos.wav --duration 30 --out outputs/estudo/master.wav [--voice-gain 1] [--music-gain 0.45] [--sfx-gain 0.2]\nUsa o mixer Studio existente. WAV, MP3 e recibos novos; sem fade. SFX devem chegar sincronizados. Ganhos em escala linear.");
  } else {
    const allowed = new Map([["voice", "voice"], ["music", "music"], ["sfx", "sfx"], ["duration", "duration"], ["out", "out"], ["voice-gain", "voiceGain"], ["music-gain", "musicGain"], ["sfx-gain", "sfxGain"]]);
    const options = {};
    for (let i = 0; i < args.length; i += 1) {
      const key = allowed.get(args[i].replace(/^--/, ""));
      if (!args[i].startsWith("--") || !key || Object.hasOwn(options, key)) throw new Error("Opção desconhecida ou repetida; consulte --help.");
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Valor de opção ausente.");
      options[key] = value;
    }
    console.log(JSON.stringify(await render3PistasMaster(options), null, 2));
  }
}
