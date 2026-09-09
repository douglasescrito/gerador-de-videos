import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "../media-pipeline/artifact.mjs";
import { probeMedia, runFfmpeg } from "../media-pipeline/media-tools.mjs";
import {
  createStageReceipt,
  pathExists,
  readVerifiedReceipt,
  replaceJsonAtomic,
  writeFileAtomic,
  writeJsonAtomic,
  writeStageReceipt,
} from "../media-pipeline/pipeline-operation.mjs";
import { createProvenanceManifest } from "../media-pipeline/provenance.mjs";

export const SERIES_SCHEMA = "mkt-videos/educational-series@1";
export const CURRICULUM_SCHEMA = "mkt-videos/educational-curriculum@1";
export const SERIES_STATE_SCHEMA = "mkt-videos/educational-series-state@1";
export const EPISODE_BRIEF_SCHEMA = "mkt-videos/educational-episode-brief@1";

const BLOCKING_STATUSES = new Set(["claimed", "prepared", "generating", "assembling", "attention_required"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function finiteInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} deve ser um inteiro entre ${min} e ${max}.`);
  return number;
}

function sanitizeReason(value) {
  return requiredText(value, "reason")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]")
    .replace(/(cookie|authorization|token)\s*[:=]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

export function slugify(value) {
  return requiredText(value, "Texto para slug")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function zonedDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateSeriesConfig(config) {
  if (config?.schema !== SERIES_SCHEMA) throw new Error("Schema da série inválido.");
  requiredText(config.id, "series.id");
  requiredText(config.title, "series.title");
  requiredText(config.timeZone, "series.timeZone");
  finiteInteger(config.ageBand?.min, "ageBand.min", { min: 3, max: 17 });
  finiteInteger(config.ageBand?.max, "ageBand.max", { min: config.ageBand.min, max: 17 });
  finiteInteger(config.episode?.contentScenes, "episode.contentScenes", { min: 1, max: 20 });
  finiteInteger(config.episode?.clipDurationSeconds, "episode.clipDurationSeconds", { min: 5, max: 20 });
  finiteInteger(config.production?.parallel, "production.parallel", { min: 1, max: 3 });
  finiteInteger(config.production?.maxEpisodesPerDay, "production.maxEpisodesPerDay", { min: 1, max: 48 });
  finiteInteger(config.production?.minFreeDiskGb, "production.minFreeDiskGb", { min: 1, max: 1024 });
  if (Number(config.production?.correctionPasses) !== 0) throw new Error("A série deve manter correctionPasses igual a zero.");
  if (config.production?.authentication !== "credential-manager") throw new Error("A série deve usar somente credential-manager.");
  requiredText(config.assets?.mascot, "assets.mascot");
  requiredText(config.assets?.opening, "assets.opening");
  requiredText(config.assets?.closing, "assets.closing");
  return config;
}

export function validateCurriculum(curriculum) {
  if (curriculum?.schema !== CURRICULUM_SCHEMA) throw new Error("Schema do currículo inválido.");
  if (!Array.isArray(curriculum.seasons) || !curriculum.seasons.length) throw new Error("O currículo deve conter temporadas.");
  const topicIds = new Set();
  for (const season of curriculum.seasons) {
    requiredText(season.id, "season.id");
    requiredText(season.title, "season.title");
    if (!Array.isArray(season.topics) || !season.topics.length) throw new Error(`A temporada ${season.id} não contém temas.`);
    for (const topic of season.topics) {
      const id = requiredText(topic.id, "topic.id");
      if (topicIds.has(id)) throw new Error(`Tema duplicado: ${id}`);
      topicIds.add(id);
      requiredText(topic.title, `topic ${id}.title`);
      requiredText(topic.question, `topic ${id}.question`);
      requiredText(topic.visualHint, `topic ${id}.visualHint`);
      if (!Array.isArray(topic.sourceHints) || topic.sourceHints.length < 2) throw new Error(`Tema ${id} precisa de pelo menos duas sugestões de fontes.`);
    }
  }
  return curriculum;
}

export function validateEpisodeBrief(brief, { expectedScenes = 10, claimToken = null } = {}) {
  if (brief?.schema !== EPISODE_BRIEF_SCHEMA) throw new Error("Schema do briefing inválido.");
  if (claimToken != null && brief.claimToken !== claimToken) throw new Error("O briefing não pertence ao claim informado.");
  requiredText(brief.title, "brief.title");
  requiredText(brief.question, "brief.question");
  requiredText(brief.visualWorld, "brief.visualWorld");
  if (!Array.isArray(brief.learningObjectives) || brief.learningObjectives.length < 2) throw new Error("O briefing precisa de ao menos dois objetivos de aprendizagem.");
  if (!Array.isArray(brief.sources) || brief.sources.length < 2) throw new Error("O briefing precisa de ao menos duas fontes.");
  for (const source of brief.sources) {
    requiredText(source.title, "source.title");
    requiredText(source.publisher, "source.publisher");
    const url = requiredText(source.url, "source.url");
    if (!/^https:\/\//i.test(url)) throw new Error(`Fonte sem HTTPS: ${url}`);
  }
  if (!Array.isArray(brief.scenes) || brief.scenes.length !== expectedScenes) throw new Error(`O briefing deve conter exatamente ${expectedScenes} cenas de conteúdo.`);
  const ids = new Set();
  brief.scenes.forEach((scene, index) => {
    const id = requiredText(scene.id, `scene[${index}].id`);
    if (ids.has(id)) throw new Error(`Cena duplicada: ${id}`);
    ids.add(id);
    requiredText(scene.role, `scene ${id}.role`);
    requiredText(scene.narration, `scene ${id}.narration`);
    requiredText(scene.visualDirection, `scene ${id}.visualDirection`);
    const words = String(scene.onScreenText ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length > 7) throw new Error(`Cena ${id} excede sete palavras na tela.`);
  });
  return brief;
}

function flattenTopics(curriculum) {
  return curriculum.seasons.flatMap((season) => season.topics.map((topic, index) => ({
    ...topic,
    seasonId: season.id,
    seasonTitle: season.title,
    seasonEpisodeNumber: index + 1,
  })));
}

export function selectNextTopic({ config, curriculum, state, now = new Date() }) {
  validateSeriesConfig(config);
  validateCurriculum(curriculum);
  const episodes = Array.isArray(state?.episodes) ? state.episodes : [];
  const blocking = episodes.find((episode) => BLOCKING_STATUSES.has(episode.status));
  if (blocking) return { decision: "no_op", reason: "active_or_attention_episode", episode: blocking };
  const today = zonedDay(now, config.timeZone);
  const producedToday = episodes.filter((episode) => episode.productionDay === today && episode.status !== "cancelled").length;
  if (producedToday >= config.production.maxEpisodesPerDay) return { decision: "no_op", reason: "daily_limit", productionDay: today, producedToday };
  const used = new Set(episodes.map((episode) => episode.topicId));
  const topic = flattenTopics(curriculum).find((candidate) => !used.has(candidate.id));
  if (!topic) return { decision: "no_op", reason: "curriculum_exhausted" };
  const episodeCode = `${topic.seasonId}E${String(topic.seasonEpisodeNumber).padStart(3, "0")}`;
  return {
    decision: "claim",
    productionDay: today,
    topic,
    episodeCode,
    slug: slugify(topic.title),
  };
}

export function buildEpisodeJobs({ config, claim, brief, mascotFile }) {
  validateEpisodeBrief(brief, { expectedScenes: config.episode.contentScenes, claimToken: claim.claimToken });
  return brief.scenes.map((scene, index) => ({
    id: `${String(index + 1).padStart(2, "0")}-${slugify(scene.id)}`,
    task: "reference_to_video",
    aspect: config.visual.aspect,
    images: [path.resolve(mascotFile)],
    prompt: `Create content chapter ${index + 1} of ${config.episode.contentScenes} for the Brazilian children's educational series ${config.title}, episode ${claim.episodeCode}: ${brief.title}. Duration ${config.episode.clipDurationSeconds} seconds. This is an educational draft for children ages ${config.ageBand.min} to ${config.ageBand.max}. Preserve the recurring series identity: ${config.visual.direction}. Use the supplied image as the recurring fictional mascot reference for Lumi; keep Lumi friendly, non-human and visually recognizable, without claiming literal frame fidelity. Episode-specific world: ${brief.visualWorld}. Scene role: ${scene.role}. Visual action: ${scene.visualDirection}. Narration: use the same warm, curious Brazilian Portuguese female narrator with neutral Brazilian accent and Brazilian cadence, saying exactly: “${scene.narration}” Integrate only this exact short on-screen text when non-empty: “${String(scene.onScreenText ?? "").trim()}” Keep one idea per scene, large readable forms, no frightening imagery, no unsafe experiment, no brands, no prices, no watermark, no interface and no incidental writing. Continue the same playful 104 BPM educational score with marimba, soft hand percussion, warm bass and small discovery chimes. End with a direct rhythmic handoff to the next chapter and no fade-out.`,
  }));
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

function filesForSeries(seriesDir) {
  const root = path.resolve(seriesDir);
  return {
    root,
    config: path.join(root, "series.json"),
    curriculum: path.join(root, "curriculum.json"),
    state: path.join(root, "state", "series-state.json"),
    lock: path.join(root, "state", ".series-state-lock"),
  };
}

async function loadSeries(seriesDir) {
  const files = filesForSeries(seriesDir);
  const [config, curriculum, state] = await Promise.all([readJson(files.config), readJson(files.curriculum), readJson(files.state)]);
  validateSeriesConfig(config);
  validateCurriculum(curriculum);
  if (state?.schema !== SERIES_STATE_SCHEMA || state.seriesId !== config.id) throw new Error("Estado da série inválido.");
  return { files, config, curriculum, state };
}

async function withStateLock(files, operation) {
  try {
    await mkdir(files.lock);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("O estado da série está sendo atualizado por outra execução.");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(files.lock, { recursive: true, force: true });
  }
}

function resolveCorePath(configuredPath) {
  return path.resolve(requiredText(configuredPath, "Caminho configurado"));
}

function episodeDirectory(config, selection) {
  return path.resolve(config.outputsRoot, `temporada-${selection.topic.seasonId.slice(1)}`, `${selection.episodeCode}-${selection.slug}`);
}

async function assertSharedAssets(config) {
  const assets = Object.fromEntries(Object.entries(config.assets).map(([key, value]) => [key, resolveCorePath(value)]));
  const readiness = {};
  for (const [key, file] of Object.entries(assets)) readiness[key] = await pathExists(file);
  return { assets, readiness, ready: Object.values(readiness).every(Boolean) };
}

async function readDiskStatus(config) {
  const outputRoot = path.resolve(config.outputsRoot);
  await mkdir(outputRoot, { recursive: true });
  const info = await statfs(outputRoot);
  const freeBytes = Number(info.bavail) * Number(info.bsize);
  const freeGb = freeBytes / (1024 ** 3);
  return {
    outputRoot,
    freeBytes,
    freeGb: Number(freeGb.toFixed(2)),
    minimumGb: config.production.minFreeDiskGb,
    ready: freeGb >= config.production.minFreeDiskGb,
  };
}

export async function bootstrapSeries({ seriesDir }) {
  const { files, config, curriculum, state } = await loadSeries(seriesDir);
  await mkdir(path.resolve(config.outputsRoot), { recursive: true });
  const assetStatus = await assertSharedAssets(config);
  return {
    schema: "mkt-videos/educational-series-bootstrap@1",
    seriesDir: files.root,
    seriesId: config.id,
    title: config.title,
    seasons: curriculum.seasons.length,
    topics: flattenTopics(curriculum).length,
    stateEpisodes: state.episodes.length,
    assets: assetStatus,
    disk: await readDiskStatus(config),
  };
}

export async function readSeriesStatus({ seriesDir }) {
  const { files, config, curriculum, state } = await loadSeries(seriesDir);
  const selection = selectNextTopic({ config, curriculum, state });
  return {
    schema: "mkt-videos/educational-series-status@1",
    seriesDir: files.root,
    seriesId: config.id,
    episodes: state.episodes,
    totals: {
      topics: flattenTopics(curriculum).length,
      claimedOrProduced: state.episodes.length,
      reviewPending: state.episodes.filter((episode) => episode.status === "review_pending").length,
    },
    next: selection,
    assets: await assertSharedAssets(config),
    disk: await readDiskStatus(config),
  };
}

export async function claimNextEpisode({ seriesDir, now = new Date() }) {
  const files = filesForSeries(seriesDir);
  return withStateLock(files, async () => {
    const { config, curriculum, state } = await loadSeries(seriesDir);
    const disk = await readDiskStatus(config);
    if (!disk.ready) return { schema: "mkt-videos/educational-series-claim@1", decision: "no_op", reason: "insufficient_disk", disk };
    const selection = selectNextTopic({ config, curriculum, state, now });
    if (selection.decision !== "claim") return { schema: "mkt-videos/educational-series-claim@1", ...selection };
    const claimToken = randomUUID();
    const episodeDir = episodeDirectory(config, selection);
    const claim = {
      schema: "mkt-videos/educational-episode-claim@1",
      claimToken,
      seriesId: config.id,
      episodeCode: selection.episodeCode,
      topicId: selection.topic.id,
      title: selection.topic.title,
      question: selection.topic.question,
      category: selection.topic.category,
      visualHint: selection.topic.visualHint,
      sourceHints: selection.topic.sourceHints,
      seasonId: selection.topic.seasonId,
      seasonTitle: selection.topic.seasonTitle,
      productionDay: selection.productionDay,
      status: "claimed",
      claimedAt: now.toISOString(),
      episodeDir,
    };
    await Promise.all([
      mkdir(path.join(episodeDir, "videos-soltos"), { recursive: true }),
      mkdir(path.join(episodeDir, "videos-unidos"), { recursive: true }),
      mkdir(path.join(episodeDir, "receitas"), { recursive: true }),
      mkdir(path.join(episodeDir, "metadados"), { recursive: true }),
      mkdir(path.join(episodeDir, "fontes"), { recursive: true }),
    ]);
    await writeJsonAtomic(path.join(episodeDir, "metadados", "claim.json"), claim, { label: "Claim do episódio" });
    const nextState = { ...state, updatedAt: now.toISOString(), episodes: [...state.episodes, claim] };
    await replaceJsonAtomic(files.state, nextState, { label: "Estado da série" });
    return { schema: "mkt-videos/educational-series-claim@1", decision: "claimed", claim };
  });
}

function findClaim(state, claimToken) {
  const token = requiredText(claimToken, "claim-token");
  const index = state.episodes.findIndex((episode) => episode.claimToken === token);
  if (index < 0) throw new Error("Claim não encontrado.");
  return { index, claim: state.episodes[index] };
}

export async function prepareEpisode({ seriesDir, claimToken, briefFile }) {
  const files = filesForSeries(seriesDir);
  return withStateLock(files, async () => {
    const { config, state } = await loadSeries(seriesDir);
    const { index, claim } = findClaim(state, claimToken);
    if (claim.status !== "claimed") throw new Error(`Claim em estado incompatível: ${claim.status}`);
    const brief = await readJson(requiredText(briefFile, "brief"));
    validateEpisodeBrief(brief, { expectedScenes: config.episode.contentScenes, claimToken });
    if (brief.title !== claim.title || brief.question !== claim.question) throw new Error("Título ou pergunta do briefing diverge do currículo reservado.");
    const { assets, ready } = await assertSharedAssets(config);
    if (!ready) throw new Error("Os ativos fixos da série ainda não estão completos.");
    const jobs = buildEpisodeJobs({ config, claim, brief, mascotFile: assets.mascot });
    const metadataDir = path.join(claim.episodeDir, "metadados");
    const storedBrief = path.join(metadataDir, "episode-brief.json");
    const jobsFile = path.join(metadataDir, "omni-jobs.json");
    await writeJsonAtomic(storedBrief, brief, { label: "Briefing do episódio" });
    await writeJsonAtomic(jobsFile, jobs, { label: "Jobs Omni do episódio" });
    const prepared = { ...claim, status: "prepared", preparedAt: new Date().toISOString(), briefFile: storedBrief, jobsFile };
    const episodes = [...state.episodes];
    episodes[index] = prepared;
    await replaceJsonAtomic(files.state, { ...state, updatedAt: prepared.preparedAt, episodes }, { label: "Estado da série" });
    return {
      schema: "mkt-videos/educational-series-prepared@1",
      episode: prepared,
      batchCommand: `npm run video -- batch --jobs "${jobsFile}" --parallel ${config.production.parallel} --out-dir "${path.join(claim.episodeDir, "videos-soltos")}"`,
    };
  });
}

function mediaSignature(probe) {
  return JSON.stringify({
    video: probe.video && { codec: probe.video.codec_name, width: probe.video.width, height: probe.video.height, fps: probe.video.r_frame_rate, pixelFormat: probe.video.pix_fmt },
    audio: probe.audio && { codec: probe.audio.codec_name, sampleRate: probe.audio.sample_rate, channels: probe.audio.channels },
  });
}

function concatLine(file) {
  return `file '${path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

export async function assembleEpisode({ seriesDir, claimToken }) {
  const files = filesForSeries(seriesDir);
  const { config, state } = await loadSeries(seriesDir);
  const { claim } = findClaim(state, claimToken);
  if (claim.status !== "prepared") throw new Error(`Claim em estado incompatível para montagem: ${claim.status}`);
  const { assets, ready } = await assertSharedAssets(config);
  if (!ready) throw new Error("Os ativos fixos da série não estão disponíveis.");
  const sceneDir = path.join(claim.episodeDir, "videos-soltos");
  const sceneNames = (await readdir(sceneDir)).filter((name) => name.toLowerCase().endsWith(".mp4")).sort();
  if (sceneNames.length !== config.episode.contentScenes) throw new Error(`Esperadas ${config.episode.contentScenes} cenas, encontradas ${sceneNames.length}. Nenhuma regeneração será iniciada.`);
  const sceneFiles = sceneNames.map((name) => path.join(sceneDir, name));
  const inputs = [assets.opening, ...sceneFiles, assets.closing];
  for (const file of inputs) await access(file);
  const probes = await Promise.all(inputs.map((file) => probeMedia(file)));
  const signature = mediaSignature(probes[0]);
  if (probes.some((probe) => mediaSignature(probe) !== signature)) throw new Error("Os clipes não são compatíveis para stream-copy. Nenhuma correção automática será feita.");
  if (probes.some((probe) => probe.duration == null || probe.duration < 8 || probe.duration > 12)) throw new Error("Um ou mais clipes estão fora da duração técnica esperada.");

  const assemblingAt = new Date().toISOString();
  await withStateLock(files, async () => {
    const latest = await readJson(files.state);
    const { index, claim: current } = findClaim(latest, claimToken);
    if (current.status !== "prepared") throw new Error(`Claim mudou de estado durante a montagem: ${current.status}`);
    const episodes = [...latest.episodes];
    episodes[index] = { ...current, status: "assembling", assemblingAt };
    await replaceJsonAtomic(files.state, { ...latest, updatedAt: assemblingAt, episodes }, { label: "Estado da série" });
  });

  const concatFile = path.join(claim.episodeDir, "metadados", "concat-list.txt");
  await writeFileAtomic(concatFile, `${inputs.map(concatLine).join("\n")}\n`, { label: "Lista de montagem", encoding: "utf8" });
  const outputFile = path.join(claim.episodeDir, "videos-unidos", `${claim.episodeCode}-${slugify(claim.title)}.mp4`);
  const startedAt = new Date();
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", concatFile, "-map", "0", "-c", "copy", outputFile]);
  const finalProbe = await probeMedia(outputFile);
  const expectedDuration = config.episode.totalClips * config.episode.clipDurationSeconds;
  if (finalProbe.duration == null || Math.abs(finalProbe.duration - expectedDuration) > config.episode.durationToleranceSeconds) throw new Error(`Duração final fora da tolerância: ${finalProbe.duration}.`);
  const artifact = await createArtifactFromFile({
    file: outputFile,
    kind: "video",
    role: "educational-episode-review-master",
    source: { provider: "local", operation: "ffmpeg-concat-stream-copy" },
    metadata: { episodeCode: claim.episodeCode, reviewStatus: "pending", duration: finalProbe.duration },
  });
  const receiptFiles = [
    `${assets.opening}.receipt.json`,
    ...sceneFiles.map((file) => `${file}.receipt.json`),
    `${assets.closing}.receipt.json`,
  ];
  const parentReceiptIds = [];
  for (const receiptFile of receiptFiles) {
    if (await pathExists(receiptFile)) parentReceiptIds.push((await readVerifiedReceipt(receiptFile)).id);
  }
  const receipt = createStageReceipt({
    operation: "assemble-educational-series-episode",
    provider: "local",
    model: "ffmpeg",
    mode: "studio",
    stage: "episode-assembly",
    parameters: {
      seriesId: config.id,
      episodeCode: claim.episodeCode,
      method: "concat-stream-copy",
      totalClips: inputs.length,
      contentScenes: sceneFiles.length,
      fixedOpening: true,
      fixedClosing: true,
      correctionPasses: 0,
      audioFadeOutSeconds: 0,
    },
    inputs,
    artifacts: [artifact],
    metadata: { probe: finalProbe, reviewStatus: "pending", sourcesFile: claim.briefFile, contentForChildren: true },
    parentReceipts: parentReceiptIds,
    startedAt,
    completedAt: new Date(),
  });
  const receiptFile = path.join(claim.episodeDir, "receitas", `${claim.episodeCode}.assembly.receipt.json`);
  await writeStageReceipt(receiptFile, receipt);
  const provenanceFile = path.join(claim.episodeDir, "metadados", "provenance.json");
  await createProvenanceManifest({ masterFile: outputFile, receiptIds: [...parentReceiptIds, receipt.id], outputFile: provenanceFile });
  const reviewFile = path.join(claim.episodeDir, "metadados", "review.json");
  await writeJsonAtomic(reviewFile, {
    schema: "mkt-videos/educational-review@1",
    episodeCode: claim.episodeCode,
    status: "pending",
    requiredChecks: ["factual_accuracy", "age_appropriateness", "narration_clarity", "visual_safety", "publication_authorization"],
    createdAt: new Date().toISOString(),
  }, { label: "Revisão do episódio" });

  const completedAt = new Date().toISOString();
  await withStateLock(files, async () => {
    const latest = await readJson(files.state);
    const { index } = findClaim(latest, claimToken);
    const episodes = [...latest.episodes];
    episodes[index] = { ...episodes[index], status: "review_pending", completedAt, finalVideo: outputFile, receiptFile, receiptId: receipt.id, provenanceFile, reviewFile };
    await replaceJsonAtomic(files.state, { ...latest, updatedAt: completedAt, episodes }, { label: "Estado da série" });
  });
  return { schema: "mkt-videos/educational-series-assembled@1", status: "review_pending", episodeCode: claim.episodeCode, outputFile, receiptFile, provenanceFile, reviewFile, duration: finalProbe.duration };
}

export async function markEpisodeAttention({ seriesDir, claimToken, reason }) {
  const files = filesForSeries(seriesDir);
  return withStateLock(files, async () => {
    const { state } = await loadSeries(seriesDir);
    const { index, claim } = findClaim(state, claimToken);
    if (claim.status === "review_pending") throw new Error("Episódio já concluído; não será rebaixado automaticamente.");
    const updatedAt = new Date().toISOString();
    const episodes = [...state.episodes];
    episodes[index] = { ...claim, status: "attention_required", attentionAt: updatedAt, reason: sanitizeReason(reason) };
    await replaceJsonAtomic(files.state, { ...state, updatedAt, episodes }, { label: "Estado da série" });
    return { schema: "mkt-videos/educational-series-attention@1", status: "attention_required", episode: episodes[index] };
  });
}
