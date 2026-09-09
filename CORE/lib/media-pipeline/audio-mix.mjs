import { randomUUID } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { recipeFromReceipt } from "./recipe.mjs";
import { probeMedia, runCommand, runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, writeStageReceipt } from "./pipeline-operation.mjs";

export const LOUDNESS_PROFILES = Object.freeze({
  platform: Object.freeze({ integratedLufs: -14, truePeakDb: -1.5, lra: 11 }),
  speech: Object.freeze({ integratedLufs: -16, truePeakDb: -1.5, lra: 9 }),
  broadcast: Object.freeze({ integratedLufs: -23, truePeakDb: -2, lra: 7 }),
  raw: Object.freeze({ id: "raw" }),
});

export function resolveLoudnessProfile(value = "platform") {
  if (value === "raw") return { id: "raw" };
  if (typeof value === "object" && value) {
    const integratedLufs = Number(value.integratedLufs);
    const truePeakDb = Number(value.truePeakDb);
    const lra = Number(value.lra ?? 11);
    if (![integratedLufs, truePeakDb, lra].every(Number.isFinite)) throw new Error("Perfil de loudness customizado inválido.");
    return { id: "custom", integratedLufs, truePeakDb, lra };
  }
  const id = String(value);
  const selected = LOUDNESS_PROFILES[id];
  if (!selected) throw new Error(`Perfil de loudness desconhecido: ${id}.`);
  return { id, ...selected };
}

export function validateMuxDuration({ videoDuration, audioDuration, policy = "fail", toleranceSeconds = 0.05 } = {}) {
  const video = Number(videoDuration);
  const audio = Number(audioDuration);
  const tolerance = Number(toleranceSeconds);
  if (![video, audio].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Não foi possível medir durações válidas de vídeo e áudio antes do mux.");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("toleranceSeconds deve ser número não negativo.");
  if (policy !== "fail") throw new Error(`Política de duração ainda não suportada no mux: ${policy}. Use fail.`);
  const differenceSeconds = audio - video;
  if (differenceSeconds > tolerance) {
    throw new Error(`Master de áudio (${audio.toFixed(3)} s) excede o vídeo (${video.toFixed(3)} s) em ${differenceSeconds.toFixed(3)} s; mux bloqueado para evitar truncamento. Ajuste a timeline antes de tentar novamente.`);
  }
  return { policy, toleranceSeconds: tolerance, videoDuration: video, audioDuration: audio, differenceSeconds };
}

export function parseGain(value, defaultValue = 1.0) {
  if (value == null) return defaultValue;
  if (typeof value === "number") return value;
  const str = String(value).trim();
  if (/^[+-]?\d+(?:\.\d+)?\s*db$/i.test(str)) {
    const db = parseFloat(str);
    return Math.pow(10, db / 20);
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function buildAudioMixFilter({
  hasVoice = true,
  hasMusic = true,
  hasAmbience = false,
  sfxCues = [],
  loudness = "platform",
  voiceGain = 1.0,
  musicGain = 0.45,
  musicTempoRatio = 1,
  ambienceGain = 0.2,
  duckingThreshold = 0.08,
  duckingRatio = 8,
  fadeIn = 0.25,
  fadeOut = 0,
  duration = null,
  bypassDucking = false,
} = {}) {
  const profile = resolveLoudnessProfile(loudness);
  const vGain = parseGain(voiceGain, 1.0);
  const mGain = parseGain(musicGain, 0.45);
  const aGain = parseGain(ambienceGain, 0.2);
  if (!Number.isFinite(musicTempoRatio) || musicTempoRatio < .9 || musicTempoRatio > 1.1 || (!hasMusic && musicTempoRatio !== 1)) throw new Error("Andamento musical exige trilha e razão entre 0.9 e 1.1.");
  if (!Array.isArray(sfxCues)) throw new Error("sfxCues deve ser uma lista.");
  if (!hasVoice && !hasMusic && !hasAmbience && !sfxCues.length) throw new Error("Mixagem exige ao menos uma entrada de áudio.");
  const voiceFilters = ["aresample=48000", "asetpts=PTS-STARTPTS"];
  if (Math.abs(vGain - 1.0) > 0.001) {
    voiceFilters.push(`volume=${vGain.toFixed(4)}`);
  }
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
    voiceFilters.push(`apad=whole_dur=${Number(duration).toFixed(6)}`);
  }
  const graph = hasVoice ? [`[0:a]${voiceFilters.join(",")}[voice]`] : [];
  let current = hasVoice ? "voice" : null;
  let nextInput = hasVoice ? 1 : 0;
  if (hasMusic) {
    const tempo = musicTempoRatio === 1 ? "" : `atempo=${musicTempoRatio.toFixed(8)},asetpts=PTS-STARTPTS,`;
    graph.push(`[${nextInput}:a]aresample=48000,${tempo}volume=${mGain.toFixed(4)}[music]`);
    if (!hasVoice) {
      current = "music";
    } else if (bypassDucking || profile.id === "raw") {
      graph.push("[voice][music]amix=inputs=2:duration=longest:normalize=0[mix1]");
    } else {
      // Equal packet sizes keep the detector and music aligned through padded
      // silence. Unequal EOF packets produced non-deterministic silent tails.
      graph.push("[voice]asetnsamples=n=1024:p=1,asplit=2[voice_mix][voice_sidechain]");
      graph.push("[music]asetnsamples=n=1024:p=1[music_duck]");
      graph.push(`[music_duck][voice_sidechain]sidechaincompress=threshold=${Number(duckingThreshold)}:ratio=${Number(duckingRatio)}:attack=20:release=400[ducked]`);
      graph.push("[voice_mix][ducked]amix=inputs=2:duration=longest:normalize=0[mix1]");
    }
    if (hasVoice) current = "mix1";
    nextInput += 1;
  }
  if (hasAmbience) {
    graph.push(`[${nextInput}:a]aresample=48000,volume=${aGain.toFixed(4)}[ambience]`);
    if (current) {
      graph.push(`[${current}][ambience]amix=inputs=2:duration=longest:normalize=0[mix2]`);
      current = "mix2";
    } else current = "ambience";
    nextInput++;
  }
  for (const [index, cue] of sfxCues.entries()) {
    const offset = Number(cue.atSeconds ?? 0);
    const gainDb = Number(cue.gainDb ?? 0);
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(gainDb) || gainDb < -192 || gainDb > 24) throw new Error("Cue de áudio exige offset não negativo e ganho combinado entre -192 e 24 dB.");
    const label = `sfx${index}`;
    graph.push(`[${nextInput++}:a]aresample=48000,asetpts=PTS-STARTPTS,volume=${gainDb}dB,adelay=delays=${Math.round(offset * 48000)}S:all=1[${label}]`);
    if (current) {
      graph.push(`[${current}][${label}]amix=inputs=2:duration=longest:normalize=0[sfxmix${index}]`);
      current = `sfxmix${index}`;
    } else current = label;
  }
  const fadeInSeconds = Number(fadeIn);
  const fadeOutSeconds = Number(fadeOut);
  if (!Number.isFinite(fadeInSeconds) || fadeInSeconds < 0) throw new Error("fadeIn deve ser número não negativo.");
  if (!Number.isFinite(fadeOutSeconds) || fadeOutSeconds < 0) throw new Error("fadeOut deve ser número não negativo.");
  const fades = [];
  if (sfxCues.length && Number.isFinite(Number(duration)) && Number(duration) > 0) fades.push(`apad=whole_dur=${Number(duration).toFixed(6)}`, `atrim=duration=${Number(duration).toFixed(6)}`);
  if (fadeInSeconds > 0) fades.push(`afade=t=in:st=0:d=${fadeInSeconds}`);
  if (fadeOutSeconds > 0 && Number.isFinite(duration) && duration > fadeOutSeconds) fades.push(`afade=t=out:st=${Math.max(0, duration - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds}`);
  if (profile.id !== "raw") {
    fades.push(`loudnorm=I=${profile.integratedLufs}:TP=${profile.truePeakDb}:LRA=${profile.lra}`);
  }
  if (Number.isFinite(Number(duration)) && Number(duration) > 0 && profile.id !== "raw") fades.push(`atrim=duration=${Number(duration).toFixed(6)}`, "asetpts=N/SR/TB");
  if (fades.length > 0) {
    graph.push(`[${current}]${fades.join(",")}[master]`);
  } else {
    graph.push(`[${current}]anull[master]`);
  }
  return { graph: graph.join(";"), profile };
}

export async function analyzeAudio(file) {
  const { stderr } = await runCommand("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
  const integratedMatches = [...stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)];
  const peakMatches = [...stderr.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/g)];
  return {
    integratedLufs: integratedMatches.length ? Number(integratedMatches.at(-1)[1]) : null,
    truePeakDb: peakMatches.length ? Number(peakMatches.at(-1)[1]) : null,
    clippingDetected: peakMatches.length ? Number(peakMatches.at(-1)[1]) >= 0 : null,
  };
}

async function prepareAudioMix({
  voiceFile,
  musicFile = null,
  musicDurationSeconds = null,
  ambienceFile = null,
  sfxInputs = [],
  durationSeconds = null,
  beforeMix = null,
  outputFile,
  receiptFile = `${outputFile}.receipt.json`,
  loudness = "platform",
  voiceGain = 1.0,
  musicGain = 0.45,
  ambienceGain = 0.2,
  musicTail = 0,
  preserveMusicEnd = false,
  duckingThreshold = 0.08,
  duckingRatio = 8,
  bypassDucking = false,
  fadeIn = 0.25,
  fadeOut = 0,
  parentReceipts = [],
  metadata = {},
} = {}) {
  if (!Array.isArray(sfxInputs)) throw new Error("sfxInputs deve ser uma lista.");
  sfxInputs = structuredClone(sfxInputs);
  if (beforeMix != null && typeof beforeMix !== "function") throw new Error("beforeMix deve ser uma função.");
  if (durationSeconds != null && (!Number.isFinite(Number(durationSeconds)) || Number(durationSeconds) <= 0)) throw new Error("durationSeconds deve ser positivo.");
  const musicTarget = musicDurationSeconds == null ? null : Number(musicDurationSeconds);
  if (musicTarget != null && (!musicFile || !Number.isFinite(musicTarget) || musicTarget <= 0)) throw new Error("musicDurationSeconds exige trilha e duração positiva.");
  if (musicTarget != null && durationSeconds != null && Number(durationSeconds) < musicTarget - .05) throw new Error("A duração do master cortaria a conclusão musical solicitada.");
  const sourceEntries = [
    { file: voiceFile, role: "voice" },
    { file: musicFile, role: "music" },
    { file: ambienceFile, role: "ambience" },
    ...sfxInputs.map((cue) => {
      if (!cue.file || !["sfx", "scene-audio"].includes(cue.role ?? "sfx")) throw new Error("Cue exige arquivo e papel sfx ou scene-audio.");
      return { ...cue, role: cue.role ?? "sfx" };
    }),
  ].filter((entry) => entry.file).map((entry) => ({ ...entry, file: path.resolve(String(entry.file)) }));
  const sources = sourceEntries.map((entry) => entry.file);
  if (!sources.length) throw new Error("Mixagem exige ao menos uma entrada de áudio.");
  await Promise.all(sources.map((file) => access(file)));
  const inputArtifacts = await Promise.all(sourceEntries.map(({ file, role }) => createArtifactFromFile({ file, kind: role === "scene-audio" ? "video" : "audio", role })));
  const verifyInputs = async () => {
    for (const artifact of inputArtifacts) if (!(await verifyArtifact(artifact)).valid) throw new Error("Entrada da mixagem mudou durante o uso.");
  };
  const probes = await Promise.all(sources.map((file) => probeMedia(file)));
  await verifyInputs();
  if (probes.some((probe) => !probe.audio)) throw new Error("Todas as entradas da mixagem precisam conter áudio.");
  const tail = Number(musicTail ?? 0);
  const maxProbeDuration = Math.max(...probes.map((probe, index) => (sourceEntries[index].role === "music" && musicTarget != null ? musicTarget : Number(probe.duration ?? 0)) + Number(sourceEntries[index].atSeconds ?? 0)));
  const calculatedDuration = tail > 0 && probes[0]?.duration ? probes[0].duration + tail : maxProbeDuration;
  const musicProbe = probes[sourceEntries.findIndex((entry) => entry.role === "music")];
  const musicTempoRatio = musicTarget == null ? 1 : Number(musicProbe.duration) / musicTarget;
  const duration = durationSeconds == null ? (preserveMusicEnd ? maxProbeDuration : Math.max(calculatedDuration, musicFile ? (musicTarget ?? musicProbe?.duration ?? 0) : calculatedDuration)) : Number(durationSeconds);
  const built = buildAudioMixFilter({
    hasVoice: Boolean(voiceFile),
    hasMusic: Boolean(musicFile),
    hasAmbience: Boolean(ambienceFile),
    sfxCues: sfxInputs,
    loudness,
    voiceGain,
    musicGain,
    musicTempoRatio,
    ambienceGain,
    duckingThreshold,
    duckingRatio,
    bypassDucking,
    fadeIn,
    fadeOut,
    duration,
  });
  const parameters = { consumer: { id: "mix-audio", version: musicTarget == null ? "mix-audio@1.1.0" : "mix-audio@1.2.0" }, loudness: built.profile,
    ...(musicTarget == null ? {} : { musicFit: { strategy: "pitch-preserving-tempo", sourceDuration: musicProbe.duration, targetDuration: musicTarget, tempoRatio: musicTempoRatio, loops: 0, voiceTimingChanged: false } }),
    voiceGain, musicGain, ambienceGain, musicTail: tail, preserveMusicEnd, duckingThreshold, duckingRatio, bypassDucking,
    fadeIn, fadeOut, durationSeconds: duration, filterGraph: built.graph,
    outputFormat: { codec: "pcm_s16le", sampleRate: 48000, channels: 2 },
    inputBindings: inputArtifacts.map(({ role, kind, hash, bytes, mimeType }) => ({ role, kind, sha256: hash.value, bytes, mimeType })),
    ...(sfxInputs.length ? { sfxCues: sfxInputs.map(({ file: _file, ...cue }) => cue) } : {}) };
  return { sources, inputArtifacts, probes, parameters, built, verifyInputs, beforeMix, outputFile, receiptFile, parentReceipts, metadata };
}

export async function audioMixRecipe(options) {
  if (typeof options?.beforeMix === "function") await options.beforeMix();
  const { inputArtifacts, parameters, metadata } = await prepareAudioMix(options);
  return recipeFromReceipt(createStageReceipt({ operation: "mix-audio", provider: "ffmpeg", mode: "studio", stage: "audio-mix", parameters, inputs: inputArtifacts, metadata }));
}

export async function mixAudio(options = {}) {
  const { sources, inputArtifacts, probes, parameters, built, verifyInputs, beforeMix, outputFile, receiptFile, parentReceipts, metadata } = await prepareAudioMix(options);
  const target = path.resolve(String(outputFile));
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.wav`);
  const args = ["-y"];
  for (const source of sources) args.push("-i", source);
  args.push("-filter_complex", built.graph, "-map", "[master]", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", temporary);
  const startedAt = new Date();
  try {
    if (beforeMix) await beforeMix();
    await verifyInputs();
    await runFfmpeg(args);
    // Direitos e bytes podem mudar enquanto o FFmpeg processa a entrada.
    if (beforeMix) await beforeMix();
    await verifyInputs();
    await commitTemporaryFile(temporary, target, { label: "Master de áudio" });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const [analysis, outputProbe] = await Promise.all([
    analyzeAudio(target),
    probeMedia(target),
  ]);
  const outputArtifact = await createArtifactFromFile({ file: target, kind: "audio", role: "audio-master", source: { provider: "ffmpeg" } });
  const receipt = createStageReceipt({
    operation: "mix-audio",
    provider: "ffmpeg",
    mode: "studio",
    stage: "audio-mix",
    parameters,
    inputs: inputArtifacts,
    artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), inputProbes: probes, outputProbe, analysis },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, analysis, probe: outputProbe };
}

export async function muxMasterAudio({
  videoFile,
  audioFile,
  outputFile,
  receiptFile = `${outputFile}.receipt.json`,
  durationPolicy = "fail",
  durationToleranceSeconds = 0.05,
  preserveVideoAudio = false,
  videoAudioGain = "+5dB",
  parentReceipts = [],
  metadata = {},
} = {}) {
  const video = path.resolve(String(videoFile));
  const audio = path.resolve(String(audioFile));
  await Promise.all([access(video), access(audio)]);
  const [videoProbe, audioProbe] = await Promise.all([probeMedia(video), probeMedia(audio)]);
  if (!videoProbe.video) throw new Error("A entrada de vídeo do mux não contém faixa de vídeo reproduzível.");
  if (!audioProbe.audio) throw new Error("A entrada de áudio do mux não contém faixa de áudio reproduzível.");
  const validation = validateMuxDuration({
    videoDuration: videoProbe.duration,
    audioDuration: audioProbe.duration,
    policy: durationPolicy,
    toleranceSeconds: durationToleranceSeconds,
  });
  const target = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const startedAt = new Date();
  try {
    if (preserveVideoAudio && videoProbe.audio) {
      const vGain = parseGain(videoAudioGain, 1.778);
      const filterGraph = `[0:a]aresample=48000,volume=${vGain.toFixed(4)}[omni_sfx];[1:a]aresample=48000[master_audio];[omni_sfx][master_audio]amix=inputs=2:duration=first:normalize=0[aout]`;
      await runFfmpeg(["-y", "-i", video, "-i", audio, "-c:v", "copy", "-filter_complex", filterGraph, "-map", "0:v:0", "-map", "[aout]", "-c:a", "aac", "-b:a", "320k", "-shortest", temporary]);
    } else {
      await runFfmpeg(["-y", "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-map", "0:v:0", "-map", "1:a:0", "-shortest", temporary]);
    }
    await commitTemporaryFile(temporary, target, { label: "Vídeo muxed" });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const [videoArtifact, audioArtifact, outputArtifact, outputProbe] = await Promise.all([
    createArtifactFromFile({ file: video, kind: "video", role: "mux-video-source" }),
    createArtifactFromFile({ file: audio, kind: "audio", role: "mux-audio-source" }),
    createArtifactFromFile({ file: target, kind: "video", role: "mastered-video", source: { provider: "ffmpeg" } }),
    probeMedia(target),
  ]);
  const receipt = createStageReceipt({
    operation: "mux-master-audio",
    provider: "ffmpeg",
    mode: "studio",
    stage: "mux",
    parameters: { durationPolicy, durationToleranceSeconds: validation.toleranceSeconds },
    inputs: [videoArtifact, audioArtifact],
    artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), videoProbe, audioProbe, outputProbe, validation },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, probe: outputProbe, validation };
}
