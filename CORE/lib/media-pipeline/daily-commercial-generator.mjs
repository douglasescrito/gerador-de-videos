import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rm,
  statfs,
} from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { deliverCollectionToDrive } from "./drive-daily-delivery.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import {
  assertPathAvailable,
  createStageReceipt,
  operationFingerprint,
  pathExists,
  readVerifiedReceipt,
  replaceJsonAtomic,
  writeFileAtomic,
  writeJsonAtomic,
  writeStageReceipt,
} from "./pipeline-operation.mjs";
import { DEFAULT_COMMERCIAL_BRAND_KIT, LEGACY_COMMERCIAL_EDITORIAL, findBrandTermViolations, BRAND_KIT_SCHEMA } from "./studio-policies.mjs";

export const DAILY_COMMERCIAL_MISSION_SCHEMA = "mkt-videos/daily-commercial-mission@1";
export const DAILY_COMMERCIAL_STATE_SCHEMA = "mkt-videos/daily-commercial-state@1";
export const DAILY_COMMERCIAL_WAVE_PLAN_SCHEMA = "mkt-videos/daily-commercial-wave-plan@1";

const BLOCKING_STATUSES = new Set([
  "claimed",
  "plan_ready",
  "generating",
  "assembled",
  "drive_planned",
  "remote_archived",
  "attention_required",
]);

const TERRITORIES = Object.freeze([
  ["kinetic-type", "kinetic typography built from a few oversized geometric letterforms"],
  ["logo-choreography", "the supplied mark acting as the physical source of the motion"],
  ["clean-interface", "clean contemporary interface motion with purposeful components and no decorative HUD"],
  ["physics", "a lucid realtime physics experiment with gravity, elasticity and constrained collisions"],
  ["tactile-3d", "tactile premium 3D materials with disciplined studio light and sparse composition"],
  ["flat-2d", "premium flat 2D graphic motion with crisp hierarchy and generous negative space"],
  ["cartoon-stopmotion", "playful stop-motion-inspired animation with handcrafted rhythm and clean staging"],
  ["fast-abstract", "fast smooth abstract advertising motion with youthful editorial energy"],
  ["editorial-story", "an editorial visual story that turns one learning possibility into a memorable image"],
  ["organic-systems", "particles, fluid ribbons and organic systems moving with coherent physical rules"],
]);

const MECHANISMS = Object.freeze([
  ["flow", "continuous flow passes energy from one authored state to the next"],
  ["assembly", "independent pieces assemble into a precise living system"],
  ["elasticity", "elastic deformation stores and releases energy without unstable geometry"],
  ["propagation", "one small event propagates across the composition"],
  ["fold", "a surface folds and reveals a new spatial logic"],
  ["orbit", "elements orbit a calm visual anchor and exchange roles"],
  ["magnetism", "attraction and repulsion create a readable choreography"],
  ["morph", "one clear form morphs into another through continuous topology"],
  ["trail", "motion trails become structure rather than decoration"],
  ["cascade", "a controlled cascade increases scale while preserving hierarchy"],
  ["pulse", "a restrained pulse synchronizes motion and sound without becoming a logo sting"],
  ["modular-shift", "modules reconfigure through a smooth state transition"],
]);

const COMPOSITIONS = Object.freeze([
  ["center-field", "central composition with one dominant visual anchor"],
  ["diagonal-flow", "clean diagonal flow with strong entrance and exit vectors"],
  ["radial", "radial composition with balanced negative space"],
  ["split-merge", "two visual fields split, interact and merge"],
  ["macro-to-wide", "macro detail expands into a controlled wide composition"],
  ["layered-depth", "three depth layers with restrained parallax"],
  ["single-path", "one continuous path guides every transition"],
  ["grid-release", "a strict grid gradually releases into organic motion"],
]);

const LOGO_ROLES = Object.freeze([
  ["seed", "the official logo is an offscreen reference and its geometry seeds the system"],
  ["tool", "the mark behaves as a tool that cuts, guides or connects the motion"],
  ["environment", "the mark's geometry becomes a spatial environment without distorting the official asset"],
  ["character", "the mark behaves playfully as a graphic character while retaining exact proportions"],
  ["reveal", "the complete official logo is revealed only after the visual idea is understood"],
  ["trace", "a restrained trace derived from the mark guides the sequence before the full identity appears"],
]);

const ENDINGS = Object.freeze([
  ["open-motion", "end on continuing motion that can loop conceptually, with a clean audio cut"],
  ["resolved-object", "end on the transformed object, not a canonical end card"],
  ["logo-in-action", "end with the complete logo still participating in the motion"],
  ["negative-space", "end with a confident negative-space composition and no tonal sonic closure"],
  ["unexpected-scale", "end on an unexpected change of scale that remains visually stable"],
  ["quiet-continuation", "end on a quiet ongoing system with immersive ambience and no sting"],
]);

const SOUND_WORLDS = Object.freeze([
  "soft mechanical clicks, elastic impacts and a continuous airy bed",
  "warm granular textures, restrained pulses and spatial movement",
  "clean interface ticks, subtle swishes and a low immersive ambience",
  "tactile material sounds synchronized to contact, fold and release",
  "playful percussive details with no melody resolving at the end",
  "fluid spatial audio whose movement follows the visual energy",
]);



const VERTICAL_DIRECTIONS = Object.freeze([
  ["tech-minimal-neon", "dark premium flat field, precise blue and violet luminous vector lines, sparse depth and fluid technical motion"],
  ["pop-art-vibrant", "bold premium pop-art composition, energetic primary color blocks, crisp dark contours, graphic stamps and controlled geometric bounce"],
  ["watercolor-story", "soft animated watercolor washes on tactile paper, pastel and earthy accents, organic transitions and an elegant editorial rhythm"],
  ["cartoon-mascot", "playful polished cartoon staging, one expressive graphic character or mark-derived mascot, comic timing and clean shape language"],
]);



const CHAPTERS = Object.freeze([
  ["hook", "Introduce one immediately readable visual event in the first frame. No poster frame, logo card or preview flash."],
  ["discovery", "Reveal the rule behind the event and expand the same visual system without adding clutter."],
  ["transformation", "Transform the central form through the declared motion mechanism while preserving continuity."],
  ["demonstration", "Demonstrate the idea through one purposeful interaction or interface state change."],
  ["expansion", "Increase emotional and spatial scale while keeping no more than three element families."],
  ["ending", "Resolve with the declared noncanonical ending. Keep the official identity faithful and cut audio cleanly without fade or sting."],
]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function integer(value, label, { min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} deve ser inteiro entre ${min} e ${max}.`);
  }
  return parsed;
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

function sanitizeSlug(value) {
  return requiredText(value, "slug")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function seededNumber(value) {
  return Number.parseInt(createHash("sha256").update(String(value)).digest("hex").slice(0, 12), 16);
}

function selectEntry(entries, seed, offset) {
  return entries[(seed + offset) % entries.length];
}

function missionPaths(missionDir) {
  const root = path.resolve(requiredText(missionDir, "--mission"));
  return {
    root,
    config: path.join(root, "mission.json"),
    state: path.join(root, "state", "mission-state.json"),
    lock: path.join(root, "state", ".mission-lock"),
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

function missionBrandKit(config) {
  const kit = config.brand?.brandKit ?? DEFAULT_COMMERCIAL_BRAND_KIT;
  const body = Object.fromEntries(Object.entries(kit).filter(([key]) => key !== 'hash'));
  if (kit.schema !== BRAND_KIT_SCHEMA || kit.hash !== operationFingerprint(body) || config.brand?.brandKitHash !== kit.hash || config.brand?.brandKitId !== kit.id) throw new Error('BrandKit da missão ausente ou divergente; informe a política explícita da missão.');
  return kit;
}

function missionEditorial(config) {
  const editorial = config.editorial ?? (config.brand?.brandKitHash === DEFAULT_COMMERCIAL_BRAND_KIT.hash ? LEGACY_COMMERCIAL_EDITORIAL : null);
  if (!editorial) throw new Error('mission.editorial é obrigatório nesta instalação.');
  requiredText(editorial.brandDisplayName, 'editorial.brandDisplayName');
  requiredText(editorial.logoGuidance, 'editorial.logoGuidance');
  if (!Array.isArray(editorial.messages) || !editorial.messages.length) throw new Error('editorial.messages exige mensagens próprias.');
  editorial.messages.forEach(message => requiredText(message, 'editorial.messages[]'));
  if (!Array.isArray(editorial.copySequences) || !editorial.copySequences.length) throw new Error('editorial.copySequences exige sequências próprias.');
  for (const sequence of editorial.copySequences) {
    if (!Array.isArray(sequence) || sequence.length !== config.production?.chaptersPerCommercial) throw new Error('Cada sequência editorial exige um texto por capítulo.');
    for (const line of sequence) requiredText(line, 'editorial.copySequences[][]');
  }
  return editorial;
}

export function validateDailyCommercialMission(config) {
  if (config?.schema !== DAILY_COMMERCIAL_MISSION_SCHEMA) throw new Error("Schema da missão diária inválido.");
  requiredText(config.id, "mission.id");
  requiredText(config.title, "mission.title");
  requiredText(config.timeZone, "mission.timeZone");
  requiredText(config.outputsRoot, "mission.outputsRoot");
  requiredText(config.brand?.brandKitId, "brand.brandKitId");
  requiredText(config.brand?.brandKitHash, "brand.brandKitHash");
  requiredText(config.brand?.logoFile, "brand.logoFile");
  requiredText(config.brand?.logoSha256, "brand.logoSha256");
  missionBrandKit(config);
  missionEditorial(config);
  if (config.visual?.aspect !== "9:16") throw new Error("A missão diária vertical exige visual.aspect 9:16.");
  if (config.visual.profile !== "vertical-social-safe-area@1") throw new Error("A missão vertical exige visual.profile vertical-social-safe-area@1.");
  integer(config.visual.safeArea?.leftPercent, "visual.safeArea.leftPercent", { min: 10, max: 25 });
  integer(config.visual.safeArea?.rightPercent, "visual.safeArea.rightPercent", { min: 10, max: 25 });
  integer(config.visual.safeArea?.topPercent, "visual.safeArea.topPercent", { min: 10, max: 30 });
  integer(config.visual.safeArea?.bottomPercent, "visual.safeArea.bottomPercent", { min: 10, max: 30 });
  integer(config.visual.safeArea?.maxWordsPerTextCard, "visual.safeArea.maxWordsPerTextCard", { min: 1, max: 5 });
  integer(config.production?.commercialsPerDay, "production.commercialsPerDay", { min: 1, max: 40 });
  integer(config.production?.wavesPerDay, "production.wavesPerDay", { min: 1, max: 8 });
  integer(config.production?.commercialsPerWave, "production.commercialsPerWave", { min: 1, max: 10 });
  integer(config.production?.chaptersPerCommercial, "production.chaptersPerCommercial", { min: 6, max: 6 });
  integer(config.production?.clipDurationSeconds, "production.clipDurationSeconds", { min: 5, max: 20 });
  integer(config.production?.targetCommercialDurationSeconds, "production.targetCommercialDurationSeconds", { min: 30, max: 180 });
  integer(config.production?.maxProviderCallsPerDay, "production.maxProviderCallsPerDay", { min: 1, max: 240 });
  integer(config.production?.parallel, "production.parallel", { min: 1, max: 3 });
  integer(config.production?.minFreeDiskGb, "production.minFreeDiskGb", { min: 1, max: 1024 });
  if (config.production.commercialsPerDay !== config.production.wavesPerDay * config.production.commercialsPerWave) {
    throw new Error("commercialsPerDay deve ser wavesPerDay × commercialsPerWave.");
  }
  if (config.production.targetCommercialDurationSeconds !== config.production.chaptersPerCommercial * config.production.clipDurationSeconds) {
    throw new Error("A duração comercial deve ser chaptersPerCommercial × clipDurationSeconds.");
  }
  if (config.production.maxProviderCallsPerDay !== config.production.commercialsPerDay * config.production.chaptersPerCommercial) {
    throw new Error("maxProviderCallsPerDay deve cobrir exatamente comerciais × capítulos.");
  }
  if (config.production.automaticRetry !== false || Number(config.production.correctionPasses) !== 0) {
    throw new Error("A missão exige automaticRetry=false e correctionPasses=0.");
  }
  if (config.production.authentication !== "credential-manager") throw new Error("A missão deve usar credential-manager.");
  if (config.retention?.localMedia !== "until-drive-verified") throw new Error("A retenção local deve ser until-drive-verified.");
  requiredText(config.delivery?.rootFolderId, "delivery.rootFolderId");
  return config;
}

async function loadMission(missionDir) {
  const files = missionPaths(missionDir);
  const [config, state] = await Promise.all([readJson(files.config), readJson(files.state)]);
  validateDailyCommercialMission(config);
  if (state?.schema !== DAILY_COMMERCIAL_STATE_SCHEMA || state.missionId !== config.id || !Array.isArray(state.waves)) {
    throw new Error("Estado da missão diária inválido.");
  }
  return { files, config, state };
}

async function withMissionLock(files, operation) {
  try {
    await mkdir(files.lock);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Outra execução já mantém o lock da missão diária.");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(files.lock, { recursive: true, force: true });
  }
}

function usedSignatures(state) {
  return new Set(state.waves.flatMap((wave) => wave.conceptSignatures ?? []));
}

function commercialConcept({ config, productionDay, waveNumber, commercialNumber, used }) {
  const editorial = missionEditorial(config);
  const baseSeed = seededNumber(`${config.id}:${productionDay}:${waveNumber}:${commercialNumber}`);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const territory = selectEntry(TERRITORIES, baseSeed, commercialNumber + attempt);
    const mechanism = selectEntry(MECHANISMS, baseSeed, waveNumber * 3 + attempt * 5);
    const composition = selectEntry(COMPOSITIONS, baseSeed, commercialNumber * 7 + attempt * 3);
    const logoRole = selectEntry(LOGO_ROLES, baseSeed, waveNumber + commercialNumber + attempt * 7);
    const ending = selectEntry(ENDINGS, baseSeed, waveNumber * 5 + commercialNumber + attempt * 11);
    const signature = operationFingerprint({
      territory: territory[0],
      mechanism: mechanism[0],
      composition: composition[0],
      logoRole: logoRole[0],
      ending: ending[0],
    });
    if (used.has(signature)) continue;
    used.add(signature);
    const soundWorld = selectEntry(SOUND_WORLDS, baseSeed, attempt + commercialNumber);
    const message = selectEntry(editorial.messages, baseSeed, waveNumber + commercialNumber * 2);
    const verticalDirection = selectEntry(VERTICAL_DIRECTIONS, baseSeed, commercialNumber * 11 + attempt);
    const copySequence = selectEntry(editorial.copySequences, baseSeed, waveNumber + commercialNumber + attempt);
    return {
      signature,
      title: `${territory[0]} — ${mechanism[0]}`,
      territory: { id: territory[0], direction: territory[1] },
      mechanism: { id: mechanism[0], direction: mechanism[1] },
      composition: { id: composition[0], direction: composition[1] },
      logoRole: { id: logoRole[0], direction: logoRole[1] },
      ending: { id: ending[0], direction: ending[1] },
      soundWorld,
      message,
      verticalDirection: {
        id: verticalDirection[0],
        direction: verticalDirection[1],
      },
      copySequence: [...copySequence],
    };
  }
  throw new Error("A matriz criativa não encontrou assinatura inédita.");
}

function continuityBible(config, concept, commercialId) {
  const editorial = missionEditorial(config);
  const safeArea = config.visual.safeArea;
  const verticalDirection = config.visual.aspect === "9:16"
    ? [
        `Vertical creative direction: ${concept.verticalDirection.direction}.`,
        `Use a full-bleed 9:16 background, but keep every essential subject, logo and text inside x=${safeArea.leftPercent}%-${100 - safeArea.rightPercent}% and y=${safeArea.topPercent}%-${100 - safeArea.bottomPercent}% of the frame.`,
        "Reserve the outer zones for nonessential background motion only; never place readable content near the frame edges or behind typical mobile social UI.",
      ].join(" ")
    : "";
  return [
    `Commercial ${commercialId} for ${editorial.brandDisplayName}, ${config.production.chaptersPerCommercial} connected ${config.production.clipDurationSeconds}-second motion chapters, total intended duration ${config.production.targetCommercialDurationSeconds} seconds.`,
    `Creative premise: ${concept.message}.`,
    `Visual territory: ${concept.territory.direction}.`,
    `Motion rule: ${concept.mechanism.direction}.`,
    `Composition: ${concept.composition.direction}.`,
    `Logo role: ${concept.logoRole.direction}.`,
    `Sound world: ${concept.soundWorld}.`,
    verticalDirection,
    editorial.logoGuidance,
    "Frame zero is already the authored motion state; never flash the reference image, a poster frame, a canonical logo card or a later composition at the start.",
    "Modern React/JSX motion-graphics logic, stable geometry, no decorative HUD, no hexadecimal color text, no captions, no narration, no watermark and no incidental writing. When ExactText is declared, render only those exact uppercase Portuguese words and no other writing.",
    "Use no more than three major element families. Maintain the same materials, lighting, spatial rules, motion cadence and immersive sound world across all six chapters.",
    "Every chapter ends in a direct visual and sonic handoff to the next, with no fade-out.",
    `Aspect ${config.visual.aspect}.`,
  ].join(" ");
}

function chapterPrompt({ config, concept, commercialId, chapterNumber }) {
  const [role, action] = CHAPTERS[chapterNumber - 1] ?? CHAPTERS.at(-1);
  const bible = continuityBible(config, concept, commercialId);
  const ending = chapterNumber === config.production.chaptersPerCommercial
    ? `Final behavior: ${concept.ending.direction}`
    : "Do not resolve the campaign or present a final end card yet.";
  return [
    bible,
    `<Commercial id="${commercialId}" chapter="${chapterNumber}" totalChapters="${config.production.chaptersPerCommercial}">`,
    `<VerticalCanvas aspect="${config.visual.aspect}" width="100vw" height="100vh">`,
    `<SafeArea left="${config.visual.safeArea.leftPercent}%" right="${config.visual.safeArea.rightPercent}%" top="${config.visual.safeArea.topPercent}%" bottom="${config.visual.safeArea.bottomPercent}%">`,
    `<Scene role="${role}" durationIntent="${config.production.clipDurationSeconds}s">`,
    `<ExactText maxWords="${config.visual.safeArea.maxWordsPerTextCard}">${concept.copySequence[chapterNumber - 1]}</ExactText>`,
    action,
    ending,
    "Animate visual and sound events in precise synchronization. Keep the action clean, bold, youthful and commercially polished.",
    "</Scene>",
    "</SafeArea>",
    "</VerticalCanvas>",
    "</Commercial>",
  ].join("\n");
}

function waveDirectory(config, productionDay, waveNumber) {
  return path.resolve(config.outputsRoot, productionDay, `run-${String(waveNumber).padStart(2, "0")}`);
}

export function createDailyCommercialWavePlan({
  config,
  state,
  waveNumber,
  now = new Date(),
} = {}) {
  validateDailyCommercialMission(config);
  if (state?.schema !== DAILY_COMMERCIAL_STATE_SCHEMA || state.missionId !== config.id) throw new Error("Estado incompatível com a missão.");
  const number = integer(waveNumber, "waveNumber", { min: 1, max: config.production.wavesPerDay });
  const productionDay = zonedDay(now, config.timeZone);
  const waveId = `${productionDay}-W${String(number).padStart(2, "0")}`;
  if (state.waves.some((wave) => wave.waveId === waveId)) throw new Error(`A onda ${waveId} já existe.`);
  const blocking = state.waves.find((wave) => BLOCKING_STATUSES.has(wave.status));
  if (blocking) throw new Error(`A onda ${blocking.waveId} ainda bloqueia uma nova execução (${blocking.status}).`);
  const callsToday = state.waves
    .filter((wave) => wave.productionDay === productionDay && wave.status !== "cancelled")
    .reduce((total, wave) => total + Number(wave.providerCallBudget ?? 0), 0);
  const waveCallBudget = config.production.commercialsPerWave * config.production.chaptersPerCommercial;
  if (callsToday + waveCallBudget > config.production.maxProviderCallsPerDay) {
    throw new Error("A onda excederia o teto diário de chamadas do provedor.");
  }

  const used = usedSignatures(state);
  const waveRoot = waveDirectory(config, productionDay, number);
  const videosRoot = path.join(waveRoot, "videos-soltos");
  const commercials = [];
  const jobs = [];
  for (let index = 0; index < config.production.commercialsPerWave; index += 1) {
    const commercialNumber = index + 1;
    const commercialId = `W${String(number).padStart(2, "0")}-C${String(commercialNumber).padStart(2, "0")}`;
    const concept = commercialConcept({
      config,
      productionDay,
      waveNumber: number,
      commercialNumber,
      used,
    });
    const scenes = [];
    for (let chapter = 1; chapter <= config.production.chaptersPerCommercial; chapter += 1) {
      const id = `${commercialId}-S${String(chapter).padStart(2, "0")}`;
      const outputFile = path.join(videosRoot, `${id}.mp4`);
      const prompt = chapterPrompt({
        config,
        concept,
        commercialId,
        chapterNumber: chapter,
      });
      const violations = findBrandTermViolations(prompt, missionBrandKit(config));
      if (violations.length) throw new Error(`Brand lint bloqueou ${id}.`);
      const job = {
        id,
        mode: "studio",
        style: "react-audiovisual@1",
        task: "reference_to_video",
        aspect: config.visual.aspect,
        images: [path.resolve(config.brand.logoFile)],
        prompt,
        out: outputFile,
      };
      jobs.push(job);
      scenes.push({
        id,
        chapter,
        role: CHAPTERS[chapter - 1][0],
        promptFingerprint: operationFingerprint(prompt),
        outputFile,
      });
    }
    commercials.push({
      id: commercialId,
      title: concept.title,
      concept,
      fingerprint: operationFingerprint({
        concept: concept.signature,
        sceneFingerprints: scenes.map((scene) => scene.promptFingerprint),
      }),
      scenes,
    });
  }

  const base = {
    schema: DAILY_COMMERCIAL_WAVE_PLAN_SCHEMA,
    missionId: config.id,
    waveId,
    productionDay,
    waveNumber: number,
    waveRoot,
    providerCallBudget: jobs.length,
    targetCommercialDurationSeconds: config.production.targetCommercialDurationSeconds,
    commercials,
    jobs,
  };
  return {
    ...base,
    fingerprint: operationFingerprint(base),
  };
}

async function diskStatus(config) {
  const root = path.resolve(config.outputsRoot);
  await mkdir(root, { recursive: true });
  const info = await statfs(root);
  const freeBytes = Number(info.bavail) * Number(info.bsize);
  const freeGb = freeBytes / (1024 ** 3);
  return {
    freeBytes,
    freeGb: Number(freeGb.toFixed(2)),
    minimumGb: config.production.minFreeDiskGb,
    ready: freeGb >= config.production.minFreeDiskGb,
  };
}

async function assertLogo(config) {
  const logo = path.resolve(config.brand.logoFile);
  await access(logo);
  const artifact = await createArtifactFromFile({
    file: logo,
    kind: "image",
    role: "official-brand-reference",
  });
  if (artifact.hash.value !== config.brand.logoSha256) throw new Error("A logo oficial diverge do hash autorizado.");
  return artifact;
}

/**
 * @param {{missionDir: string, now?: Date}} options
 */
export async function readDailyCommercialStatus({ missionDir, now = new Date() }) {
  const { files, config, state } = await loadMission(missionDir);
  const productionDay = zonedDay(now, config.timeZone);
  const today = state.waves.filter((wave) => wave.productionDay === productionDay);
  return {
    schema: "mkt-videos/daily-commercial-status@1",
    missionDir: files.root,
    missionId: config.id,
    productionDay,
    target: {
      commercials: config.production.commercialsPerDay,
      minutes: config.production.commercialsPerDay,
      providerCalls: config.production.maxProviderCallsPerDay,
    },
    today: {
      waves: today.length,
      providerCallsReserved: today.reduce((total, wave) => total + Number(wave.providerCallBudget ?? 0), 0),
      statuses: Object.fromEntries([...new Set(today.map((wave) => wave.status))].map((status) => [
        status,
        today.filter((wave) => wave.status === status).length,
      ])),
    },
    blockingWave: state.waves.find((wave) => BLOCKING_STATUSES.has(wave.status)) ?? null,
    disk: await diskStatus(config),
    logo: await assertLogo(config),
  };
}

export async function prepareDailyCommercialWave({
  missionDir,
  waveNumber,
  now = new Date(),
  dryRun = false,
} = {}) {
  const files = missionPaths(missionDir);
  if (dryRun) {
    const { config, state } = await loadMission(missionDir);
    const disk = await diskStatus(config);
    if (!disk.ready) throw new Error("Espaço livre insuficiente para preparar a onda.");
    await assertLogo(config);
    return {
      status: "planned",
      dryRun: true,
      plan: createDailyCommercialWavePlan({ config, state, waveNumber, now }),
      disk,
    };
  }
  return withMissionLock(files, async () => {
    const { config, state } = await loadMission(missionDir);
    const disk = await diskStatus(config);
    if (!disk.ready) throw new Error("Espaço livre insuficiente para preparar a onda.");
    await assertLogo(config);
    const plan = createDailyCommercialWavePlan({ config, state, waveNumber, now });
    const metadataRoot = path.join(plan.waveRoot, "metadados");
    const receiptsRoot = path.join(plan.waveRoot, "receitas");
    await Promise.all([
      mkdir(path.join(plan.waveRoot, "videos-soltos"), { recursive: true }),
      mkdir(path.join(plan.waveRoot, "videos-unidos", "pecas"), { recursive: true }),
      mkdir(metadataRoot, { recursive: true }),
      mkdir(receiptsRoot, { recursive: true }),
    ]);
    const planFile = path.join(metadataRoot, "run-plan.json");
    const jobsFile = path.join(metadataRoot, "jobs.json");
    const claim = {
      schema: "mkt-videos/daily-commercial-wave-claim@1",
      claimToken: randomUUID(),
      missionId: config.id,
      waveId: plan.waveId,
      productionDay: plan.productionDay,
      waveNumber: plan.waveNumber,
      status: "plan_ready",
      providerCallBudget: plan.providerCallBudget,
      conceptSignatures: plan.commercials.map((commercial) => commercial.concept.signature),
      planFingerprint: plan.fingerprint,
      waveRoot: plan.waveRoot,
      planFile,
      jobsFile,
      claimedAt: now.toISOString(),
    };
    await writeJsonAtomic(planFile, plan, { label: "Plano da onda" });
    await writeJsonAtomic(jobsFile, plan.jobs, { label: "Jobs da onda" });
    await writeJsonAtomic(path.join(metadataRoot, "claim.json"), claim, { label: "Claim da onda" });
    await replaceJsonAtomic(files.state, {
      ...state,
      updatedAt: now.toISOString(),
      waves: [...state.waves, claim],
    }, { label: "Estado da missão diária" });
    return {
      status: "plan_ready",
      dryRun: false,
      wave: claim,
      plan: planFile,
      jobs: jobsFile,
      batchCommand: `npm run video -- batch --jobs "${jobsFile}" --parallel ${config.production.parallel} --out-dir "${path.join(plan.waveRoot, "videos-soltos")}" --confirm-provider-input true`,
      expectedCommercials: config.production.commercialsPerWave,
      expectedClips: plan.jobs.length,
      disk,
    };
  });
}

function concatLine(file) {
  return `file '${path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function mediaSignature(probe) {
  return JSON.stringify({
    video: probe.video && {
      codec: probe.video.codec_name,
      width: probe.video.width,
      height: probe.video.height,
      fps: probe.video.r_frame_rate,
      pixelFormat: probe.video.pix_fmt,
    },
    audio: probe.audio && {
      codec: probe.audio.codec_name,
      sampleRate: probe.audio.sample_rate,
      channels: probe.audio.channels,
    },
  });
}

async function concatCompatible(files, outputFile, concatFile, expectedDuration, tolerance) {
  const probes = await Promise.all(files.map((file) => probeMedia(file)));
  const signature = mediaSignature(probes[0]);
  if (probes.some((probe) => mediaSignature(probe) !== signature)) {
    throw new Error("Os clipes não são compatíveis para stream-copy.");
  }
  await writeFileAtomic(concatFile, `${files.map(concatLine).join("\n")}\n`, {
    label: "Lista de concatenação",
    encoding: "utf8",
  });
  await assertPathAvailable(outputFile, "Saída de montagem");
  await runFfmpeg(["-n", "-f", "concat", "-safe", "0", "-i", concatFile, "-map", "0", "-c", "copy", outputFile]);
  const probe = await probeMedia(outputFile);
  if (probe.duration == null || Math.abs(probe.duration - expectedDuration) > tolerance) {
    throw new Error(`Duração montada fora da tolerância: ${probe.duration}.`);
  }
  return probe;
}

function findWave(state, waveId) {
  const id = requiredText(waveId, "--wave-id");
  const index = state.waves.findIndex((wave) => wave.waveId === id);
  if (index < 0) throw new Error(`Onda não encontrada: ${id}.`);
  return { index, wave: state.waves[index] };
}

export async function assembleDailyCommercialWave({ missionDir, waveId } = {}) {
  const files = missionPaths(missionDir);
  const { config, state } = await loadMission(missionDir);
  const { wave } = findWave(state, waveId);
  if (wave.status !== "plan_ready") throw new Error(`Onda em estado incompatível para montagem: ${wave.status}.`);
  const plan = await readJson(wave.planFile);
  if (plan.schema !== DAILY_COMMERCIAL_WAVE_PLAN_SCHEMA || plan.fingerprint !== wave.planFingerprint) {
    throw new Error("Plano da onda inválido ou divergente do claim.");
  }
  const outputRoot = path.join(wave.waveRoot, "videos-unidos");
  const commercialsRoot = path.join(outputRoot, "pecas");
  const metadataRoot = path.join(wave.waveRoot, "metadados");
  const artifacts = [];
  const parentReceiptIds = [];
  const commercialFiles = [];
  for (const commercial of plan.commercials) {
    const sceneFiles = commercial.scenes.map((scene) => path.resolve(scene.outputFile));
    for (const sceneFile of sceneFiles) {
      await access(sceneFile);
      const receiptFile = `${sceneFile}.receipt.json`;
      await access(receiptFile);
      parentReceiptIds.push((await readVerifiedReceipt(receiptFile)).id);
      const sceneProbe = await probeMedia(sceneFile);
      if (sceneProbe.duration == null || sceneProbe.duration < 8 || sceneProbe.duration > 12) {
        throw new Error(`Clipe fora da faixa técnica esperada: ${sceneFile}.`);
      }
    }
    const masterFile = path.join(commercialsRoot, `${commercial.id}-${sanitizeSlug(commercial.title)}.mp4`);
    const concatFile = path.join(metadataRoot, `${commercial.id}.concat.txt`);
    await concatCompatible(
      sceneFiles,
      masterFile,
      concatFile,
      config.production.targetCommercialDurationSeconds,
      config.production.chaptersPerCommercial * 1.5,
    );
    commercialFiles.push(masterFile);
    artifacts.push(await createArtifactFromFile({
      file: masterFile,
      kind: "video",
      role: "daily-commercial-master",
      metadata: { waveId, commercialId: commercial.id },
    }));
  }
  const reelFile = path.join(outputRoot, `reel-${waveId}.mp4`);
  const reelConcatFile = path.join(metadataRoot, "reel.concat.txt");
  await concatCompatible(
    commercialFiles,
    reelFile,
    reelConcatFile,
    config.production.commercialsPerWave * config.production.targetCommercialDurationSeconds,
    config.production.commercialsPerWave * config.production.chaptersPerCommercial * 1.5,
  );
  artifacts.push(await createArtifactFromFile({
    file: reelFile,
    kind: "video",
    role: "daily-commercial-wave-reel",
    metadata: { waveId, commercials: commercialFiles.length },
  }));
  const receipt = createStageReceipt({
    operation: "assemble-daily-commercial-wave",
    provider: "local",
    model: "ffmpeg",
    mode: "studio",
    stage: "wave-assembly",
    parameters: {
      missionId: config.id,
      waveId,
      commercials: commercialFiles.length,
      chaptersPerCommercial: config.production.chaptersPerCommercial,
      method: "concat-stream-copy",
    },
    artifacts,
    parentReceipts: parentReceiptIds,
    metadata: {
      dailyCommercials: {
        planFingerprint: plan.fingerprint,
        targetCommercialDurationSeconds: config.production.targetCommercialDurationSeconds,
      },
    },
  });
  const receiptFile = path.join(wave.waveRoot, "receitas", "montagem-onda.receipt.json");
  await writeStageReceipt(receiptFile, receipt);
  await withMissionLock(files, async () => {
    const latest = await readJson(files.state);
    const current = findWave(latest, waveId);
    if (current.wave.status !== "plan_ready") throw new Error("O estado da onda mudou durante a montagem.");
    const waves = [...latest.waves];
    waves[current.index] = {
      ...current.wave,
      status: "assembled",
      assembledAt: new Date().toISOString(),
      commercialFiles,
      reelFile,
      assemblyReceipt: receiptFile,
    };
    await replaceJsonAtomic(files.state, {
      ...latest,
      updatedAt: new Date().toISOString(),
      waves,
    }, { label: "Estado da missão diária" });
  });
  return {
    status: "assembled",
    waveId,
    commercials: commercialFiles,
    reel: reelFile,
    receipt: receiptFile,
    driveCollection: wave.waveRoot,
  };
}

export async function markDailyCommercialAttention({ missionDir, waveId, reason } = {}) {
  const files = missionPaths(missionDir);
  return withMissionLock(files, async () => {
    const { state } = await loadMission(missionDir);
    const current = findWave(state, waveId);
    const waves = [...state.waves];
    waves[current.index] = {
      ...current.wave,
      status: "attention_required",
      attentionAt: new Date().toISOString(),
      attentionReason: requiredText(reason, "--reason").slice(0, 500),
    };
    await replaceJsonAtomic(files.state, {
      ...state,
      updatedAt: new Date().toISOString(),
      waves,
    }, { label: "Estado da missão diária" });
    return { status: "attention_required", wave: waves[current.index] };
  });
}

export async function archiveDailyCommercialWave({
  missionDir,
  waveId,
  coreRoot = process.cwd(),
  dryRun = true,
  confirmDriveWrite = false,
  confirmLocalMediaDelete = false,
  driveRunner,
} = {}) {
  const files = missionPaths(missionDir);
  const { config, state } = await loadMission(missionDir);
  const { wave } = findWave(state, waveId);
  if (wave.status !== "assembled") {
    throw new Error(`Onda em estado incompatível para arquivo remoto: ${wave.status}.`);
  }
  const delivery = await deliverCollectionToDrive({
    coreRoot,
    collection: wave.waveRoot,
    rootFolderId: config.delivery.rootFolderId,
    client: config.delivery.client,
    pieceName: wave.waveId,
    date: wave.productionDay,
    includeOriginals: true,
    cleanupLocalMedia: !dryRun,
    confirmLocalMediaDelete,
    dryRun,
    confirmDriveWrite,
    ...(driveRunner ? { driveRunner } : {}),
  });
  if (dryRun) return { status: "drive_planned", waveId, delivery };
  if (delivery.status !== "local_purged") {
    throw new Error("A entrega não concluiu a limpeza local verificada.");
  }
  await withMissionLock(files, async () => {
    const latest = await readJson(files.state);
    const current = findWave(latest, waveId);
    if (current.wave.status !== "assembled") throw new Error("O estado da onda mudou durante o arquivo remoto.");
    const waves = [...latest.waves];
    waves[current.index] = {
      ...current.wave,
      status: "local_purged",
      archivedAt: new Date().toISOString(),
      driveReceipt: delivery.receiptFile,
      remoteArchiveManifest: delivery.cleanup.archiveFile,
      cleanupReceipt: delivery.cleanup.cleanupReceiptFile,
      remoteRootFolderId: delivery.rootFolderId,
    };
    await replaceJsonAtomic(files.state, {
      ...latest,
      updatedAt: new Date().toISOString(),
      waves,
    }, { label: "Estado da missão diária" });
  });
  return { status: "local_purged", waveId, delivery };
}
