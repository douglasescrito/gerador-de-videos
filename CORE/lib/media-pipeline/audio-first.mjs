import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { probeMedia, runCommand, runFfmpeg } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, operationFingerprint, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { recipeFromReceipt } from "./recipe.mjs";

export const CUE_TIMELINE_SCHEMA = "mkt-videos/cue-timeline@1";
export const MUSIC_FIT_SCHEMA = "mkt-videos/music-fit@1";
export const NARRATION_FIT_SCHEMA = "mkt-videos/narration-fit@1";
export const TIMING_REPORT_SCHEMA = "mkt-videos/timing-report@1";
export const LOCKED_TIMELINE_SCHEMA = "mkt-videos/locked-timeline@1";
export const VIDEO_DURATION_ADAPT_SCHEMA = "mkt-videos/video-duration-adapt@1";
export const AUDIO_FIRST_ENDING_SCHEMA = "mkt-videos/audio-first-ending@1";

function normalizedToken(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function scriptTokens(value) {
  return String(value ?? "").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.map((token) => ({ text: token, normalized: normalizedToken(token) })) ?? [];
}

export function createNarrationCues({ script, words, blocks = [], corrections = [] } = {}) {
  const expected = scriptTokens(script);
  if (!expected.length) throw new Error("O roteiro de alinhamento está vazio.");
  if (!Array.isArray(words) || !words.length) throw new Error("O alinhamento medido não contém palavras.");
  const measured = words.map((word, index) => {
    const start = Number(word.start);
    const end = Number(word.end);
    const text = String(word.word ?? word.text ?? "").trim();
    const confidence = word.confidence == null ? null : Number(word.confidence);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Palavra medida ${index + 1} inválida.`);
    return { index, text, normalized: normalizedToken(text), start, end, confidence, speaker: word.speaker ?? null };
  });
  const findings = [];
  for (let index = 0; index < measured.length; index += 1) {
    if (index && measured[index].start < measured[index - 1].end) findings.push({ code: "non_monotonic_alignment", severity: "block", index });
    if (measured[index].confidence != null && measured[index].confidence < 0.6) findings.push({ code: "low_alignment_confidence", severity: "block", index, confidence: measured[index].confidence });
  }
  const maximum = Math.max(expected.length, measured.length);
  for (let index = 0; index < maximum; index += 1) {
    if (!expected[index]) findings.push({ code: "repeated_or_extra_word", severity: "block", index, actual: measured[index]?.text ?? null });
    else if (!measured[index]) findings.push({ code: "missing_word", severity: "block", index, expected: expected[index].text });
    else if (expected[index].normalized !== measured[index].normalized) findings.push({ code: "word_mismatch", severity: "block", index, expected: expected[index].text, actual: measured[index].text });
  }
  const phraseCues = [];
  let phraseStart = 0;
  expected.forEach((token, index) => {
    if (/[.!?…]$/.test(token.text) || index === expected.length - 1) {
      if (measured[phraseStart] && measured[index]) phraseCues.push({ id: `phrase-${phraseCues.length + 1}`, start: measured[phraseStart].start, end: measured[index].end, text: expected.slice(phraseStart, index + 1).map((entry) => entry.text).join(" "), wordRange: [phraseStart, index] });
      phraseStart = index + 1;
    }
  });
  const blockCues = blocks.map((block, index) => {
    const from = Number(block.wordStart ?? block.startWord ?? 0);
    const to = Number(block.wordEnd ?? block.endWord ?? measured.length - 1);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || !measured[from] || !measured[to]) throw new Error(`Bloco ${block.id ?? index + 1} possui word range inválido.`);
    return { id: block.id ?? `block-${index + 1}`, start: measured[from].start, end: measured[to].end, text: block.text ?? expected.slice(from, to + 1).map((entry) => entry.text).join(" "), wordRange: [from, to] };
  });
  const cue = {
    schema: CUE_TIMELINE_SCHEMA,
    script: String(script),
    duration: measured.at(-1).end,
    status: findings.some((entry) => entry.severity === "block") ? "blocked" : "pass",
    words: measured,
    phrases: phraseCues,
    blocks: blockCues,
    findings,
    corrections: structuredClone(corrections),
    policy: { source: "measured-alignment", inventedTimestamps: false },
  };
  return { ...cue, fingerprint: operationFingerprint(cue) };
}

export function lockTimelineFromCues({ cues, scenes, fps = { numerator: 24, denominator: 1 }, holdOutFrames = 0 } = {}) {
  if (cues?.schema !== CUE_TIMELINE_SCHEMA || cues.status !== "pass") throw new Error("Timeline só pode ser bloqueada com cues completos e aprovados.");
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("Timeline bloqueada exige cenas.");
  const rate = Number(fps.numerator) / Number(fps.denominator);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("FPS racional inválido.");
  const cueById = new Map([...(cues.blocks ?? []), ...(cues.phrases ?? [])].map((cue) => [String(cue.id), cue]));
  const spans = scenes.map((scene, index) => {
    const cue = cueById.get(String(scene.cueId ?? scene.id)) ?? cues.blocks?.[index] ?? cues.phrases?.[index];
    if (!cue) throw new Error(`Cena ${scene.id ?? index + 1} não possui cue medido.`);
    const startFrame = Math.round(Number(cue.start) * rate);
    const endFrame = Math.max(startFrame + 1, Math.round(Number(cue.end) * rate));
    return { sceneId: String(scene.id ?? `scene-${index + 1}`), cueId: cue.id, startFrame, endFrame, durationFrames: endFrame - startFrame, start: startFrame / rate, end: endFrame / rate };
  });
  for (let index = 1; index < spans.length; index += 1) if (spans[index].startFrame < spans[index - 1].startFrame) throw new Error("Spans de cena não são monotônicos.");
  const body = { schema: LOCKED_TIMELINE_SCHEMA, sourceCueFingerprint: cues.fingerprint, fps: structuredClone(fps), locked: true, durationFrames: spans.at(-1).endFrame + Number(holdOutFrames), spans, policy: { source: "measured-cues", inventedTimestamps: false } };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export async function adaptVideoDuration({ sourceFile, targetDuration, policy = "freeze-tail", outputFile, receiptFile = `${outputFile}.receipt.json`, fps = 24, parentReceipts = [] } = {}) {
  const source = path.resolve(String(sourceFile));
  await access(source);
  const before = await probeMedia(source);
  if (!before.video || !Number.isFinite(Number(before.duration))) throw new Error("Adaptação exige vídeo reproduzível.");
  const target = Number(targetDuration);
  if (!Number.isFinite(target) || target <= 0) throw new Error("targetDuration deve ser positivo.");
  const allowed = new Set(["loop", "freeze-tail", "extend"]);
  if (!allowed.has(policy)) throw new Error(`Política visual inválida: ${policy}.`);
  if (target + 0.001 < before.duration) throw new Error("Adaptação visual não comprime nem corta o vídeo para caber.");
  const targetFile = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(targetFile), `.${path.basename(targetFile)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const delta = Math.max(0, target - before.duration);
  const startedAt = new Date();
  try {
    const args = ["-y"];
    if (policy === "loop") args.push("-stream_loop", "-1");
    args.push("-i", source);
    if (policy === "loop") args.push("-t", target.toFixed(6), "-vf", `fps=${fps},format=yuv420p`);
    else args.push("-vf", `tpad=stop_mode=clone:stop_duration=${delta.toFixed(6)},fps=${fps},trim=duration=${target.toFixed(6)},format=yuv420p`);
    args.push("-map", "0:v:0", "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", temporary);
    await runFfmpeg(args);
    await commitTemporaryFile(temporary, targetFile, { label: "Vídeo adaptado à timeline" });
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  const after = await probeMedia(targetFile);
  if (Math.abs(Number(after.duration) - target) > (1 / Number(fps)) + 0.01) throw new Error("Vídeo adaptado divergiu do alvo em mais de um frame.");
  const [inputArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "duration-source" }),
    createArtifactFromFile({ file: targetFile, kind: "video", role: "duration-adapted", source: { provider: "ffmpeg" } }),
  ]);
  const receipt = createStageReceipt({ operation: "adapt-video-duration", provider: "ffmpeg", stage: "duration-adapt", parameters: { schema: VIDEO_DURATION_ADAPT_SCHEMA, policy, targetDuration: target, fps, semanticExtension: false }, inputs: [inputArtifact], artifacts: [outputArtifact], metadata: { before, after, sourcePreserved: true, omniAudioDiscarded: true }, parentReceipts, startedAt, completedAt: new Date() });
  await writeStageReceipt(receiptFile, receipt);
  return { file: targetFile, receiptFile: path.resolve(receiptFile), receipt, before, after };
}

export async function fitNarrationToDuration({ sourceFile, targetDuration, outputFile, receiptFile = `${outputFile}.receipt.json`, maxTempoRatio = 1.15, parentReceipts = [], metadata = {} } = {}) {
  const source = path.resolve(String(sourceFile));
  await access(source);
  const before = await probeMedia(source);
  if (!before.audio || !Number.isFinite(Number(before.duration)) || Number(before.duration) <= 0) throw new Error("Ajuste de narração exige áudio reproduzível.");
  const target = Number(targetDuration);
  const maximum = Number(maxTempoRatio);
  if (!Number.isFinite(target) || target <= 0) throw new Error("targetDuration deve ser positivo.");
  if (!Number.isFinite(maximum) || maximum < 1 || maximum > 2) throw new Error("maxTempoRatio deve ficar entre 1 e 2.");
  if (Number(before.duration) <= target + 0.001) throw new Error("A narração já cabe na duração alvo; preserve o áudio original e deixe a cauda visual livre.");
  const tempoRatio = Number(before.duration) / target;
  if (tempoRatio > maximum + 0.000001) throw new Error(`A compressão exigiria andamento ${tempoRatio.toFixed(4)}x, acima do limite ${maximum.toFixed(4)}x.`);
  const targetFile = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(targetFile), `.${path.basename(targetFile)}.${process.pid}.${randomUUID()}.tmp.wav`);
  const audioFilter = `atempo=${tempoRatio.toFixed(8)},atrim=duration=${target.toFixed(6)},asetpts=N/SR/TB`;
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", "-i", source, "-map", "0:a:0", "-af", audioFilter, "-c:a", "pcm_s16le", temporary]);
    await commitTemporaryFile(temporary, targetFile, { label: "Narração ajustada à timeline" });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const after = await probeMedia(targetFile);
  if (Math.abs(Number(after.duration) - target) > 0.05) throw new Error(`Narração ajustada fora da tolerância de 50 ms: alvo ${target}s, obtido ${after.duration}s.`);
  const [inputArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: source, kind: "audio", role: "narration-source" }),
    createArtifactFromFile({ file: targetFile, kind: "audio", role: "narration-fitted", source: { provider: "ffmpeg" } }),
  ]);
  const receipt = createStageReceipt({
    operation: "fit-narration-duration",
    provider: "ffmpeg",
    mode: "studio",
    stage: "narration-fit",
    parameters: { schema: NARRATION_FIT_SCHEMA, targetDuration: target, tempoRatio, maxTempoRatio: maximum, audioFilter },
    inputs: [inputArtifact],
    artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), before, after, sourcePreserved: true, semanticTextChanged: false, providerCalls: 0, toleranceSeconds: 0.05 },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: targetFile, receiptFile: path.resolve(receiptFile), receipt, before, after, tempoRatio };
}

export async function renderAudioFirstEnding({
  sourceFile,
  targetDuration,
  narrationEndSeconds,
  outputFile,
  receiptFile = `${outputFile}.receipt.json`,
  dipToBlackSeconds = 3,
  omniTailGainDb = 3.5,
  omniTailRiseSeconds = 0.52,
  fadeColor = "#000000",
  fps = 24,
  parentReceipts = [],
  metadata = {},
} = {}) {
  const source = path.resolve(String(sourceFile));
  await access(source);
  const before = await probeMedia(source);
  if (!before.video || !before.audio || !Number.isFinite(Number(before.duration))) throw new Error("Ending audio-first exige vídeo Omni com faixa de efeitos sonoros.");
  const target = Number(targetDuration);
  const narrationEnd = Number(narrationEndSeconds);
  const dip = Number(dipToBlackSeconds);
  const rise = Number(omniTailRiseSeconds);
  const gainDb = Number(omniTailGainDb);
  if (![target, narrationEnd, dip, rise, gainDb].every(Number.isFinite) || target <= 0 || narrationEnd <= 0 || dip <= 0 || rise <= 0 || gainDb < 0) throw new Error("Parâmetros do ending audio-first são inválidos.");
  if (target > Number(before.duration) + 0.001) throw new Error(`O original Omni tem ${Number(before.duration).toFixed(3)} s, abaixo dos ${target.toFixed(3)} s exigidos pelo ending; nova geração automática é proibida.`);
  if (dip > target - narrationEnd) throw new Error("dipToBlackSeconds não cabe depois do fim da narração.");
  if (String(fadeColor).toLowerCase() !== "#000000") throw new Error("O ending validado aceita somente fadeColor #000000.");
  const fadeStart = target - dip;
  const gainLinear = 10 ** (gainDb / 20);
  const riseEnd = Math.min(target, narrationEnd + rise);
  const endSample = Math.round(target * 48_000);
  const videoFilter = `scale=1280:720,fps=${Number(fps)},trim=duration=${target.toFixed(6)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeStart.toFixed(6)}:d=${dip.toFixed(6)}:color=black,format=yuv420p`;
  const audioFilter = `aresample=48000:first_pts=0,atrim=end_sample=${endSample},asetpts=N/SR/TB,volume='if(lt(t,${narrationEnd.toFixed(6)}),1,if(lt(t,${riseEnd.toFixed(6)}),1+(t-${narrationEnd.toFixed(6)})*(${(gainLinear - 1).toFixed(6)}/${Math.max(0.001, riseEnd - narrationEnd).toFixed(6)}),${gainLinear.toFixed(6)}))':eval=frame`;
  const targetFile = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(targetFile), `.${path.basename(targetFile)}.${process.pid}.${randomUUID()}.tmp.mp4`);
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-vf", videoFilter, "-af", audioFilter, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temporary]);
    await commitTemporaryFile(temporary, targetFile, { label: "Ending audio-first" });
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  const after = await probeMedia(targetFile);
  if (Math.abs(Number(after.duration) - target) > (1 / Number(fps)) + 0.01) throw new Error("Ending audio-first divergiu do alvo em mais de um frame.");
  const [inputArtifact, outputArtifact] = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "omni-program-source" }),
    createArtifactFromFile({ file: targetFile, kind: "video", role: "audio-first-ending", source: { provider: "ffmpeg" } }),
  ]);
  const parameters = { schema: AUDIO_FIRST_ENDING_SCHEMA, targetDuration: target, narrationEndSeconds: narrationEnd, dipToBlackSeconds: dip, audioFadeOutSeconds: dip, omniTailGainDb: gainDb, omniTailRiseSeconds: rise, fadeColor: "#000000", insufficientRemainderPolicy: "fail", videoFilter, audioFilter };
  const receipt = createStageReceipt({ operation: "render-audio-first-ending", provider: "ffmpeg", mode: "studio", stage: "finishing", parameters, inputs: [inputArtifact], artifacts: [outputArtifact], metadata: { ...structuredClone(metadata ?? {}), before, after, sourcePreserved: true, providerCalls: 0 }, parentReceipts, startedAt, completedAt: new Date() });
  await writeStageReceipt(receiptFile, receipt);
  return { file: targetFile, receiptFile: path.resolve(receiptFile), receipt, before, after, targetDuration: target };
}

export function buildMusicFitFilter({ sourceDuration, targetDuration, crossfadeSeconds = 0.25, fadeOutSeconds = 0 } = {}) {
  const source = Number(sourceDuration);
  const target = Number(targetDuration);
  const crossfade = Math.min(Number(crossfadeSeconds), source / 4);
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(target) || target <= 0) throw new Error("musicFit exige durações positivas.");
  const requestedFade = Number(fadeOutSeconds);
  if (!Number.isFinite(requestedFade) || requestedFade < 0) throw new Error("fadeOutSeconds deve ser número não negativo.");
  const fade = Math.min(requestedFade, target);
  const tail = [`atrim=0:${target.toFixed(6)}`, "asetpts=N/SR/TB"];
  if (fade > 0) tail.push(`afade=t=out:st=${Math.max(0, target - fade).toFixed(6)}:d=${fade.toFixed(6)}`);
  const tailFilter = tail.join(",");
  if (source + 0.001 >= target) return { mode: "trim", loops: 1, filter: `[0:a]${tailFilter}[out]`, sourceDuration: source, targetDuration: target, crossfadeSeconds: 0, fadeOutSeconds: fade };
  const loops = Math.ceil((target - crossfade) / (source - crossfade));
  const split = `[0:a]asplit=${loops}${Array.from({ length: loops }, (_, index) => `[a${index}]`).join("")}`;
  const layers = Array.from({ length: loops }, (_, index) => {
    const filters = [`atrim=0:${source.toFixed(6)}`, "asetpts=N/SR/TB"];
    if (index > 0) filters.push(`afade=t=in:st=0:d=${crossfade.toFixed(6)}`);
    if (index < loops - 1) filters.push(`afade=t=out:st=${Math.max(0, source - crossfade).toFixed(6)}:d=${crossfade.toFixed(6)}`);
    const delay = Math.round(index * (source - crossfade) * 1000);
    if (delay) filters.push(`adelay=delays=${delay}:all=1`);
    return `[a${index}]${filters.join(",")}[s${index}]`;
  });
  const mix = `${Array.from({ length: loops }, (_, index) => `[s${index}]`).join("")}amix=inputs=${loops}:normalize=0:duration=longest[mixed]`;
  return { mode: "loop-crossfade", loops, filter: `${split};${layers.join(";")};${mix};[mixed]${tailFilter}[out]`, sourceDuration: source, targetDuration: target, crossfadeSeconds: crossfade, fadeOutSeconds: fade };
}

const MUSIC_FIT_CONSUMER = Object.freeze({ id: "music-fit", version: "music-fit@1.1.0" });

async function prepareMusicFit({ sourceFile, targetDuration, crossfadeSeconds = 0.25, fadeOutSeconds = 0 }) {
  const source = path.resolve(String(sourceFile));
  await access(source);
  const inputArtifact = await createArtifactFromFile({ file: source, kind: "audio", role: "music-source" });
  const sourceProbe = await probeMedia(source);
  if (!sourceProbe.audio || !sourceProbe.duration) throw new Error("musicFit exige uma fonte de áudio reproduzível.");
  const decision = buildMusicFitFilter({ sourceDuration: sourceProbe.duration, targetDuration, crossfadeSeconds, fadeOutSeconds });
  if (!(await verifyArtifact(inputArtifact)).valid) throw new Error("Fonte de musicFit mudou durante a preparação.");
  return { source, sourceProbe, decision, inputArtifact };
}

export async function musicFitRecipe(options) {
  const { decision, inputArtifact } = await prepareMusicFit(options);
  return recipeFromReceipt(createStageReceipt({ operation: "music-fit", provider: "ffmpeg", mode: "studio", stage: "music-fit",
    parameters: { ...decision, consumer: MUSIC_FIT_CONSUMER }, inputs: [inputArtifact], metadata: options.metadata ?? {} }));
}

export async function fitMusicToDuration({ sourceFile, targetDuration, outputFile, receiptFile = `${outputFile}.receipt.json`, crossfadeSeconds = 0.25, fadeOutSeconds = 0, parentReceipts = [], metadata = {} } = {}) {
  const { source, sourceProbe, decision, inputArtifact } = await prepareMusicFit({ sourceFile, targetDuration, crossfadeSeconds, fadeOutSeconds });
  const target = path.resolve(String(outputFile));
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.wav`);
  const startedAt = new Date();
  try {
    await runFfmpeg(["-y", "-i", source, "-filter_complex", decision.filter, "-map", "[out]", "-c:a", "pcm_s24le", temporary]);
    if (!(await verifyArtifact(inputArtifact)).valid) throw new Error("Fonte de musicFit mudou durante o ajuste.");
    await commitTemporaryFile(temporary, target, { label: "Music bed" });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const outputProbe = await probeMedia(target);
  if (Math.abs(Number(outputProbe.duration) - Number(targetDuration)) > 0.05) throw new Error(`musicFit fora da tolerância de 50 ms: alvo ${targetDuration}s, obtido ${outputProbe.duration}s.`);
  const outputArtifact = await createArtifactFromFile({ file: target, kind: "audio", role: "music-bed", source: { provider: "ffmpeg" } });
  const receipt = createStageReceipt({
    operation: "music-fit", provider: "ffmpeg", mode: "studio", stage: "music-fit",
    parameters: { ...decision, consumer: MUSIC_FIT_CONSUMER }, inputs: [inputArtifact], artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), schema: MUSIC_FIT_SCHEMA, sourceProbe, outputProbe, toleranceSeconds: 0.05 }, parentReceipts, startedAt, completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, decision, probe: outputProbe };
}

function rational(value) {
  const [numerator, denominator = "1"] = String(value ?? "0/1").split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : null;
}

export async function probeTiming({ mediaFile, expectedFrames = null, expectedAudioStart = 0, expectedAudioDuration = null, coextensive = false, outputFile = null } = {}) {
  const source = path.resolve(String(mediaFile));
  const { stdout } = await runCommand("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=index,codec_type,time_base,start_time,duration,duration_ts,nb_read_frames,r_frame_rate,sample_rate", "-of", "json", source]);
  const payload = JSON.parse(stdout);
  const streams = (payload.streams ?? []).map((stream) => ({
    ...stream,
    timeBaseSeconds: rational(stream.time_base),
    durationFromTimeBase: Number.isFinite(Number(stream.duration_ts)) && rational(stream.time_base) != null ? Number(stream.duration_ts) * rational(stream.time_base) : null,
    decodedFrames: Number.isFinite(Number(stream.nb_read_frames)) ? Number(stream.nb_read_frames) : null,
  }));
  const video = streams.find((stream) => stream.codec_type === "video") ?? null;
  const audio = streams.find((stream) => stream.codec_type === "audio") ?? null;
  const findings = [];
  if (expectedFrames != null && (!video || Math.abs(Number(video.decodedFrames) - Number(expectedFrames)) > 1)) findings.push({ code: "video_frame_count_mismatch", severity: "block", expected: Number(expectedFrames), actual: video?.decodedFrames ?? null, toleranceFrames: 1 });
  if (audio && expectedAudioStart != null && Math.abs(Number(audio.start_time ?? 0) - Number(expectedAudioStart)) > 0.05) findings.push({ code: "audio_start_mismatch", severity: "block", expected: Number(expectedAudioStart), actual: Number(audio.start_time ?? 0), toleranceSeconds: 0.05 });
  const actualAudioDuration = audio?.durationFromTimeBase ?? (Number.isFinite(Number(audio?.duration)) ? Number(audio.duration) : null);
  if (expectedAudioDuration != null && (actualAudioDuration == null || Math.abs(actualAudioDuration - Number(expectedAudioDuration)) > 0.05)) findings.push({ code: "audio_duration_mismatch", severity: "block", expected: Number(expectedAudioDuration), actual: actualAudioDuration, toleranceSeconds: 0.05 });
  if (coextensive && video && audio) {
    const videoDuration = video.durationFromTimeBase ?? Number(video.duration);
    if (Number.isFinite(videoDuration) && actualAudioDuration != null && Math.abs(videoDuration - actualAudioDuration) > 0.05) findings.push({ code: "track_end_mismatch", severity: "block", videoDuration, audioDuration: actualAudioDuration, toleranceSeconds: 0.05 });
  }
  const report = { schema: TIMING_REPORT_SCHEMA, mediaFile: source, status: findings.length ? "blocked" : "pass", expected: { frames: expectedFrames, audioStart: expectedAudioStart, audioDuration: expectedAudioDuration, coextensive }, streams, findings };
  if (outputFile) await writeJsonAtomic(outputFile, report, { label: "Timing report" });
  return report;
}
