import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { probeTiming } from "./audio-first.mjs";
import { commitTemporaryFile, copyFileAtomic, createStageReceipt, pathExists, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";

export const FILM_TRANSITIONS = new Set(["cut", "fade", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright"]);
export const CLIP_DURATION_ATTESTATION_SCHEMA = "mkt-videos/clip-duration-attestation@1";

// Edições locais são parâmetros da montagem existente, sem modificar as fontes.
export function validateAssemblyEdits(edits, probes, fps = 24) {
  if (!Array.isArray(edits) || !edits.length || edits.length !== probes.length || edits.length > 100) throw new Error('Informe de 1 a 100 trechos.');
  if (![24, 25, 30, 60].includes(fps)) throw new Error('FPS de exportação inválido.');
  return edits.map((edit, i) => {
    const start = Number(edit.sourceIn), end = Number(edit.sourceOut), gainDb = Number(edit.gainDb ?? 0);
    if (![start, end, gainDb].every(Number.isFinite) || start < 0 || end - start < 1 / fps || end > probes[i].duration + .04 || gainDb < -60 || gainDb > 12) throw new Error(`Trecho ${i + 1}: entrada, saída ou ganho inválido.`);
    const text = String(edit.text || '');
    if (text.length > 240 || /[\x00-\x08\x0b-\x1f]/.test(text)) throw new Error('Texto limitado a 240 caracteres.');
    const textPosition = edit.textPosition || 'bottom';
    if (!['top', 'center', 'bottom'].includes(textPosition)) throw new Error('Posição do texto inválida.');
    return { sourceIn: start, sourceOut: end, gainDb, text, textPosition, frames: Math.round((end - start) * fps) };
  });
}

async function renderAssemblyEdits({ sources, probes, edits, target, aspect, fps }) {
  const normalized = validateAssemblyEdits(edits, probes, fps);
  if (!['16:9', '9:16', '1:1'].includes(aspect)) throw new Error('Formato inválido.');
  const width = aspect === '9:16' ? 720 : aspect === '1:1' ? 720 : 1280, height = aspect === '9:16' ? 1280 : 720;
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp.mp4`), textFiles = [];
  const escapePath = value => value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
  const graph = [], args = ['-y', '-filter_complex_threads', '2'];
  try {
    for (const [i, source] of sources.entries()) {
      const e = normalized[i], duration = e.frames / fps;
      args.push('-i', source);
      let overlay = '';
      if (e.text) {
        const fontFile = process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'arial.ttf') : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        await access(fontFile);
        const textFile = path.join(path.dirname(target), `${randomUUID()}.txt`); textFiles.push(textFile);
        await writeFile(textFile, e.text, { flag: 'wx' });
        const y = e.textPosition === 'top' ? 'h*0.08' : e.textPosition === 'center' ? '(h-text_h)/2' : 'h*0.88-text_h';
        overlay = `,drawtext=fontfile='${escapePath(fontFile)}':textfile='${escapePath(textFile)}':expansion=none:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12:x=(w-text_w)/2:y=${y}`;
      }
      graph.push(`[${i}:v]trim=start=${e.sourceIn}:end=${e.sourceOut},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=0.1,trim=end_frame=${e.frames},format=yuv420p${overlay}[v${i}]`);
      graph.push(probes[i].audio
        ? `[${i}:a]atrim=start=${e.sourceIn}:end=${e.sourceOut},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${e.gainDb}dB,apad,atrim=duration=${duration}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[a${i}]`);
    }
    graph.push(normalized.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${normalized.length}:v=1:a=1[vout][aout]`);
    args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-threads', '4', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary);
    await runFfmpeg(args);
    const probe = await probeMedia(temporary), expected = normalized.reduce((n, e) => n + e.frames / fps, 0);
    if (!probe.video || !probe.audio || Math.abs(probe.duration - expected) > .12) throw new Error('Exportação divergente da montagem; o arquivo não foi publicado.');
    await commitTemporaryFile(temporary, target, { label: 'Montagem editada' });
    return normalized;
  } finally { await Promise.all([temporary, ...textFiles].map(file => rm(file, { force: true }))); }
}

async function attestSceneDuration({ source, sceneId, plannedFrames, fps, normalizedDir, attestationDir, planFingerprint, preserveAudio = false }) {
  const beforeTiming = await probeTiming({ mediaFile: source, expectedFrames: plannedFrames });
  const beforeVideo = beforeTiming.streams.find((stream) => stream.codec_type === "video");
  const measuredFrames = Number(beforeVideo?.decodedFrames);
  if (!Number.isSafeInteger(measuredFrames) || measuredFrames <= 0) throw new Error(`Cena ${sceneId} não possui contagem física de frames.`);
  if (preserveAudio && !beforeTiming.streams.some((stream) => stream.codec_type === "audio")) throw new Error(`preserveAudio exige áudio na cena ${sceneId}.`);
  let normalizedFile = source;
  let normalization = "none";
  if (measuredFrames !== plannedFrames) {
    await mkdir(normalizedDir, { recursive: true });
    normalizedFile = path.join(normalizedDir, `${sceneId}.mp4`);
    normalization = measuredFrames > plannedFrames ? "trim" : "pad-last-frame";
    if (!(await pathExists(normalizedFile))) {
      const temporary = path.join(normalizedDir, `.${sceneId}.${process.pid}.${randomUUID()}.tmp.mp4`);
      const targetSeconds = plannedFrames / fps;
      try {
        await runFfmpeg(["-y", "-i", source, "-map", "0:v:0", ...(preserveAudio ? ["-map", "0:a:0", "-af", `aresample=48000,apad,atrim=duration=${targetSeconds.toFixed(6)},asetpts=N/SR/TB`, "-c:a", "aac"] : ["-an"]), "-vf", `fps=${fps},tpad=stop_mode=clone:stop_duration=${targetSeconds.toFixed(6)},trim=end_frame=${plannedFrames},setpts=PTS-STARTPTS,format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", temporary]);
        await commitTemporaryFile(temporary, normalizedFile, { label: `Cena normalizada ${sceneId}` });
      } catch (error) { await rm(temporary, { force: true }); throw error; }
    }
  }
  const afterTiming = await probeTiming({ mediaFile: normalizedFile, expectedFrames: plannedFrames });
  const afterVideo = afterTiming.streams.find((stream) => stream.codec_type === "video");
  const normalizedFrames = Number(afterVideo?.decodedFrames);
  if (afterTiming.status !== "pass" || normalizedFrames !== plannedFrames) throw new Error(`Cena ${sceneId} não pôde ser normalizada para ${plannedFrames} frames; obtido ${normalizedFrames}.`);
  const [beforeArtifact, afterArtifact] = await Promise.all([
    createArtifactFromFile({ file: source, kind: "video", role: "duration-source" }),
    createArtifactFromFile({ file: normalizedFile, kind: "video", role: "duration-normalized", source: { provider: normalization === "none" ? "original" : "ffmpeg" } }),
  ]);
  const attestation = {
    schema: CLIP_DURATION_ATTESTATION_SCHEMA,
    planFingerprint,
    nodeId: `video:${sceneId}`,
    sceneId,
    plannedFrames,
    plannedTimeBase: { numerator: 1, denominator: fps },
    measured: { durationTs: beforeVideo?.duration_ts ?? null, timeBase: beforeVideo?.time_base ?? null, decodedFrames: measuredFrames },
    measuredFrames,
    deltaFrames: measuredFrames - plannedFrames,
    normalization,
    normalizedFrames,
    sha256Before: beforeArtifact.hash.value,
    sha256After: afterArtifact.hash.value,
    toleranceFrames: 0,
    sourcePreserved: true,
    attestedBy: "media-probe@1",
    attestedAt: new Date().toISOString(),
  };
  if (attestationDir) {
    await mkdir(attestationDir, { recursive: true });
    const file = path.join(attestationDir, `${sceneId}.json`);
    if (await pathExists(file)) {
      const existing = JSON.parse(await readFile(file, "utf8"));
      if (existing.sha256Before !== attestation.sha256Before || existing.sha256After !== attestation.sha256After || existing.normalizedFrames !== plannedFrames) throw new Error(`Atestação existente diverge para ${sceneId}.`);
    } else await writeJsonAtomic(file, attestation, { label: `Atestação de duração ${sceneId}` });
    attestation.file = file;
  }
  return { file: normalizedFile, attestation };
}

export function buildFilmAssemblyFilter({ durations, transition = "cut", transitionDuration = 0.5, transitions = null, aspect = "16:9", fps = 24, preserveAudio = false } = {}) {
  if (!Array.isArray(durations) || !durations.length || durations.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error("Durações de cenas inválidas.");
  if (!FILM_TRANSITIONS.has(transition)) throw new Error(`Transição inválida: ${transition}.`);
  const edges = transitions == null
    ? durations.slice(1).map(() => ({ transition, duration: transition === "cut" ? 0 : Number(transitionDuration) }))
    : transitions.map((edge) => ({ transition: String(edge.transition), duration: Number(edge.duration ?? edge.transitionDuration ?? 0) }));
  if (edges.length !== Math.max(0, durations.length - 1)) throw new Error("Transições por edge devem cobrir exatamente todos os pares de cenas.");
  for (const edge of edges) {
    if (!FILM_TRANSITIONS.has(edge.transition)) throw new Error(`Transição inválida: ${edge.transition}.`);
    if (edge.transition === "cut" && edge.duration !== 0) throw new Error("Transição cut exige duração zero.");
    if (edge.transition !== "cut" && (!Number.isFinite(edge.duration) || edge.duration <= 0)) throw new Error(`Transição ${edge.transition} exige duração positiva.`);
  }
  const [width, height] = aspect === "9:16" ? [720, 1280] : [1280, 720];
  const normalized = durations.map((_, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${Number(fps)},format=yuv420p,setpts=PTS-STARTPTS[v${index}]`);
  if (durations.length === 1) {
    if (preserveAudio) normalized.push(`[0:a]aresample=48000,apad,atrim=duration=${Number(durations[0]).toFixed(6)},asetpts=N/SR/TB[aout]`);
    return { graph: normalized.join(";"), outputLabel: "v0", audioOutputLabel: preserveAudio ? "aout" : null, duration: Number(durations[0]), width, height, fps };
  }
  if (edges.every((edge) => edge.transition === "cut")) {
    normalized.push(`${durations.map((_, index) => `[v${index}]`).join("")}concat=n=${durations.length}:v=1:a=0[vout]`);
    if (preserveAudio) {
      normalized.push(...durations.map((duration, index) => `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${Number(duration).toFixed(6)},asetpts=N/SR/TB[a${index}]`));
      normalized.push(`${durations.map((_, index) => `[a${index}]`).join("")}concat=n=${durations.length}:v=0:a=1[aout]`);
    }
    return { graph: normalized.join(";"), outputLabel: "vout", audioOutputLabel: preserveAudio ? "aout" : null, duration: durations.reduce((sum, value) => sum + Number(value), 0), width, height, fps };
  }
  if (preserveAudio) throw new Error("preserveAudio exige transição cut em todos os edges nesta versão.");
  let cumulative = Number(durations[0]);
  let previous = "v0";
  for (let index = 1; index < durations.length; index += 1) {
    const edge = edges[index - 1];
    const output = index === durations.length - 1 ? "vout" : `x${index}`;
    if (edge.transition === "cut") {
      normalized.push(`[${previous}][v${index}]concat=n=2:v=1:a=0[${output}]`);
      cumulative += Number(durations[index]);
    } else {
      const d = edge.duration;
      const offset = cumulative - d;
      if (offset <= 0 || d >= Math.min(cumulative, Number(durations[index]))) throw new Error(`Transição ${edge.transition} é longa demais no edge ${index - 1}.`);
      normalized.push(`[${previous}][v${index}]xfade=transition=${edge.transition}:duration=${d}:offset=${offset.toFixed(3)}[${output}]`);
      cumulative += Number(durations[index]) - d;
    }
    previous = output;
  }
  return { graph: normalized.join(";"), outputLabel: "vout", duration: cumulative, width, height, fps };
}

export async function assembleFilm({
  sceneFiles,
  outputFile,
  receiptFile = `${outputFile}.receipt.json`,
  transition = "cut",
  transitionDuration = 0.5,
  transitions = null,
  aspect = "16:9",
  fps = 24,
  parentReceipts = [],
  metadata = {},
  preserveAudio = false,
  sceneFrameTargets = null,
  expectedMasterFrames = null,
  planFingerprint = null,
  attestationDir = null,
  edits = null,
} = {}) {
  if (!Array.isArray(sceneFiles) || !sceneFiles.length) throw new Error("assembleFilm exige sceneFiles.");
  const originalSources = sceneFiles.map((file) => path.resolve(String(file)));
  let sources = originalSources;
  await Promise.all(originalSources.map((file) => access(file)));
  let durationAttestations = [];
  if (sceneFrameTargets != null) {
    if (!Array.isArray(sceneFrameTargets) || sceneFrameTargets.length !== originalSources.length) throw new Error("sceneFrameTargets deve cobrir todas as cenas.");
    const normalizedDir = path.join(path.dirname(path.resolve(String(outputFile))), preserveAudio ? "normalized-scenes-with-audio" : "normalized-scenes");
    const normalized = [];
    for (const [index, source] of originalSources.entries()) normalized.push(await attestSceneDuration({ source, sceneId: sceneFrameTargets[index].sceneId, plannedFrames: Number(sceneFrameTargets[index].plannedFrames), fps: Number(fps), normalizedDir, attestationDir, planFingerprint, preserveAudio }));
    sources = normalized.map((entry) => entry.file);
    durationAttestations = normalized.map((entry) => entry.attestation);
  }
  const probes = await Promise.all(sources.map((file) => probeMedia(file)));
  if (probes.some((probe) => !probe.video || !probe.duration)) throw new Error("Todas as cenas precisam conter vídeo e duração válida.");
  if (!edits && preserveAudio && probes.some((probe) => !probe.audio)) throw new Error("preserveAudio exige áudio em todas as cenas.");
  const target = path.resolve(String(outputFile));
  const startedAt = new Date();
  if (edits) {
    if (sceneFrameTargets || transition !== 'cut' || transitions) throw new Error('Edição local usa cortes explícitos sem normalização de cenas.');
    edits = await renderAssemblyEdits({ sources, probes, edits, target, aspect, fps });
  } else if (sources.length === 1 && transition === "cut" && transitions == null) {
    await copyFileAtomic(sources[0], target, { label: "Montagem do filme" });
  } else {
    const built = buildFilmAssemblyFilter({ durations: probes.map((probe) => probe.duration), transition, transitionDuration, transitions, aspect, fps, preserveAudio });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp.mp4`);
    const args = ["-y"];
    for (const source of sources) args.push("-i", source);
    args.push("-filter_complex", built.graph, "-map", `[${built.outputLabel}]`);
    if (built.audioOutputLabel) args.push("-map", `[${built.audioOutputLabel}]`, "-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push("-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", temporary);
    try {
      await runFfmpeg(args);
      await commitTemporaryFile(temporary, target, { label: "Montagem do filme" });
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  const [outputProbe, ...inputArtifacts] = await Promise.all([
    probeMedia(target),
    ...sources.map((file) => createArtifactFromFile({ file, kind: "video", role: "film-scene" })),
  ]);
  let outputTiming = null;
  if (expectedMasterFrames != null) {
    outputTiming = await probeTiming({ mediaFile: target, expectedFrames: Number(expectedMasterFrames) });
    const outputVideo = outputTiming.streams.find((stream) => stream.codec_type === "video");
    if (outputTiming.status !== "pass" || Number(outputVideo?.decodedFrames) !== Number(expectedMasterFrames)) throw new Error(`Montagem física diverge da timeline: esperado ${expectedMasterFrames} frames, obtido ${outputVideo?.decodedFrames ?? "desconhecido"}.`);
  }
  const outputArtifact = await createArtifactFromFile({ file: target, kind: "video", role: "assembled-film", source: { provider: "ffmpeg" } });
  const receipt = createStageReceipt({
    operation: "assemble-film",
    provider: "ffmpeg",
    mode: "studio",
    stage: "assembly",
    parameters: { transition, transitionDuration, transitions: structuredClone(transitions), aspect, fps, preserveAudio, edits, sceneFrameTargets: structuredClone(sceneFrameTargets), expectedMasterFrames, planFingerprint },
    inputs: inputArtifacts,
    artifacts: [outputArtifact],
    metadata: { ...structuredClone(metadata ?? {}), inputProbes: probes, outputProbe, outputTiming, durationAttestations },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, probe: outputProbe, timing: outputTiming, durationAttestations };
}
