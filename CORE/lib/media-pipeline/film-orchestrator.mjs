import { access, mkdir, readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { GEMINI_IMAGE_ASPECT_RATIOS, GEMINI_IMAGE_MODELS, GEMINI_IMAGE_SIZES } from "./gemini-image.mjs";
import { approveDraft, draftScenes, animateDraft, qaDraftScenes, readDraftState, reconcileDraftScene, validateDraftSpec, authorizeDraftHumanReplacements } from "./draft-workflow.mjs";
import { MUSIC_BACKENDS, resolveMusicPrompt } from "./flow-music.mjs";
import { buildFilmGraph, runProductionGraph } from "./pipeline-graph.mjs";
import { runProductionPool } from "./production-pool.mjs";
import { withProductionLock } from "./production-lock.mjs";
import { alignNarrationBlocks } from "./narration-align.mjs";
import { WHISPER_BACKENDS } from "./whisper-backends.mjs";
import { FILM_TRANSITIONS, assembleFilm } from "./film-assembly.mjs";
import { audioMixRecipe, mixAudio, muxMasterAudio, resolveLoudnessProfile } from "./audio-mix.mjs";
import { localSfxAssets, localPostProductionAssets, localHtmlAssets } from "./local-asset-use.mjs";
import { applyFilmPostOperation, validatePostProduction } from "./film-post-production.mjs";
import { assertStyleCompositionBinding } from "./style-controls.mjs";
import { renderWordCaptions, resolveCaptionStyle } from "./captions.mjs";
import { finishVideo, finishVideoRecipe, resolveDeliveryProfile } from "./delivery-profile.mjs";
import { evaluateQaGate, runQa } from "./qa.mjs";
import { probeMedia } from "./media-tools.mjs";
import { resolveGoogleVidsVoice } from "./google-vids-voices.mjs";
import { compilarReceita } from "./recipe-compiler.mjs";
import { fitMusicToDuration, musicFitRecipe, probeTiming } from "./audio-first.mjs";
import { renderMotionGraphics, motionGraphicsRecipe, motionAssDocument } from "./motion-graphics.mjs";
import { createVideoVariant } from "./variants.mjs";
import { verifyArtifact } from "./artifact.mjs";
import { operationFingerprint, pathExists, readVerifiedReceipt, replaceJsonAtomic, writeJsonAtomic } from "./pipeline-operation.mjs";
import { assertExecutionPlanIntegrity } from "./studio-governance.mjs";
import { loadEffectiveProviderCapabilities } from "./provider-registry.mjs";
import { createExecutionKernel } from "./execution-kernel.mjs";
import { buildExecutionRightsDecision, claimNodeReconciliation, materializeExecutionSnapshot, recordExecutionNodeApproval, recordNodeCompletion, recordNodeFailure, prepareHumanRetryAuthorization, registerHumanRetryAuthorization } from "./execution-journal.mjs";
import { evaluateRuntimeAdmission, unresolvedExecutionDependencies } from "./runtime-admission.mjs";
import {
  assertKnowledgeContextBinding,
  assertKnowledgeContextSnapshot,
  assertStudioBrief,
  studioReceiptContextMetadata,
} from "./studio-context.mjs";

export const FILM_SPEC_SCHEMA = "mkt-videos/film-spec@1";
export const FILM_PLAN_SCHEMA = "mkt-videos/film-plan@1";
export const FILM_STATE_SCHEMA = "mkt-videos/film-state@1";

export function executionTimelineDurationSeconds(executionPlan) {
  const timeline = executionPlan?.timeline;
  const durationFrames = Number(timeline?.durationFrames);
  const numerator = Number(timeline?.timeBase?.numerator);
  const denominator = Number(timeline?.timeBase?.denominator);
  if (timeline?.locked !== true || !Number.isFinite(durationFrames) || durationFrames <= 0 || !Number.isFinite(numerator) || numerator <= 0 || !Number.isFinite(denominator) || denominator <= 0) return null;
  return durationFrames * numerator / denominator;
}

const PROVIDER_STAGES = new Set(["draft", "tts", "music", "video"]);
const stateSaveQueues = new WeakMap();

function slug(value, fallback = "filme") {
  const normalized = String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.slice(0, 64) || fallback;
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function resolveOptional(baseDirectory, value) {
  return value == null || String(value).trim() === "" ? null : path.resolve(baseDirectory, String(value));
}

function receiptId(receipt) {
  return receipt?.id ? String(receipt.id) : null;
}

async function receiptIdFromFile(file) {
  if (!file || !(await pathExists(file))) return null;
  return receiptId(await readVerifiedReceipt(file));
}

function positiveInteger(value, fallback, label) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} deve ser inteiro não negativo.`);
  return number;
}

function assertNarrationFitsTimeline(probe, executionPlan) {
  const duration = executionTimelineDurationSeconds(executionPlan);
  if (Number.isFinite(duration) && Number(probe?.duration) > duration + 0.05) throw new Error(`Narração (${Number(probe.duration).toFixed(3)} s) excede a timeline fixa (${duration.toFixed(3)} s); WAV original preservado, sem truncamento.`);
}

export function validateFilmSpec(raw, { specFile = null, outputsRoot = null, allowConceptStyle = false, executionPlan = null } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("filme.json inválido.");
  const baseDirectory = specFile ? path.dirname(path.resolve(specFile)) : process.cwd();
  const name = slug(raw.name ?? "filme", "filme");
  const brief = raw.brief == null ? null : assertStudioBrief(raw.brief);
  const knowledgeContext = raw.knowledgeContext == null ? null : assertKnowledgeContextSnapshot(raw.knowledgeContext);
  const knowledgeContextBinding = raw.knowledgeContextBinding == null ? null : assertKnowledgeContextBinding(raw.knowledgeContextBinding, { context: knowledgeContext, briefHash: brief?.hash ?? null });
  if (knowledgeContext != null && knowledgeContextBinding == null) throw new Error("Studio exige knowledgeContextBinding junto ao contexto congelado.");
  if (brief?.knowledgeContextHash != null && knowledgeContext?.hash !== brief.knowledgeContextHash) throw new Error("brief.knowledgeContextHash diverge do contexto congelado.");
  const aspect = String(raw.aspect ?? "16:9");
  if (!new Set(["16:9", "9:16"]).has(aspect)) throw new Error(`Aspecto inválido: ${aspect}.`);
  for (const scene of executionPlan?.spec?.scenes ?? []) {
    if (scene.textRendering === "local-gc" && scene.graphics?.renderer !== "html-canvas@1" && scene.onScreenText) motionAssDocument([{ text: scene.onScreenText, start: 0, end: 1 }], { aspect });
  }
  const root = path.resolve(outputsRoot ?? raw.outRoot ?? path.join(process.cwd(), "outputs"), name);
  const draft = validateDraftSpec({
    name,
    aspect,
    style: raw.style ?? null,
    imageModel: raw.imageModel ?? "gemini-3-pro-image",
    imageSize: raw.imageSize ?? "2K",
    scenes: raw.scenes,
    outRoot: path.dirname(root),
  }, { specFile, outputsRoot: path.dirname(root), allowConceptStyle });
  draft.root = root;
  if (raw.styleComposition != null || executionPlan?.spec?.styleComposition != null) {
    if (!executionPlan || operationFingerprint(raw.styleComposition ?? null) !== operationFingerprint(executionPlan.spec.styleComposition ?? null)) throw new Error("styleComposition exige vínculo idêntico ao plano canônico.");
    assertStyleCompositionBinding(raw.styleComposition, { briefHash: brief?.hash, scope: executionPlan.spec.source.scope ?? {}, shots: raw.scenes.map((scene) => ({ shotId: scene.id, prompt: scene.prompt })) });
    if (raw.style != null || raw.scenes.some((scene) => scene.style != null || (scene.motionPrompt ?? scene.prompt) !== scene.prompt)) throw new Error("styleComposition exige prompts visuais e de movimento idênticos, sem segunda composição de estilo.");
  }

  const narration = raw.narration == null ? null : {
    provider: String(raw.narration.provider ?? "omni"),
    ...(raw.narration.speakerMode == null ? {} : { speakerMode: raw.narration.speakerMode === "one-voice" ? "single-voice" : String(raw.narration.speakerMode) }),
    text: requiredText(raw.narration.text, "narration.text"),
    voice: String(raw.narration.voice ?? "voz masculina brasileira"),
    documentUrl: raw.narration.documentUrl == null ? null : String(raw.narration.documentUrl),
    newScene: raw.narration.newScene !== false,
    fallbackProvider: raw.narration.fallbackProvider == null ? null : String(raw.narration.fallbackProvider),
    fallbackPolicy: raw.narration.fallbackPolicy == null ? null : String(raw.narration.fallbackPolicy),
    blocks: Array.isArray(raw.narration.blocks)
      ? raw.narration.blocks.map((block, index) => ({
          id: String(block?.id ?? `bloco-${index + 1}`),
          text: requiredText(block?.text, `narration.blocks[${index}].text`),
          ...(block?.speakerId == null ? {} : { speakerId: String(block.speakerId) }),
          ...(block?.direction == null ? {} : { direction: String(block.direction) }),
          ...(block?.voice == null ? {} : { voice: String(block.voice) }),
          ...(block?.seconds == null ? {} : { seconds: Number(block.seconds) }),
        }))
      : [],
    speakers: raw.narration.speakers ?? null,
    readingDirection: raw.narration.readingDirection == null ? null : String(raw.narration.readingDirection),
    model: raw.narration.model == null ? undefined : String(raw.narration.model),
    fallbackModels: Array.isArray(raw.narration.fallbackModels) ? raw.narration.fallbackModels.map(String) : [],
  };
  if (narration) {
    if (!new Set(["google-vids", "omni"]).has(narration.provider)) throw new Error(`narration.provider desconhecido: ${narration.provider}.`);
    if (narration.speakerMode != null && !["single-voice", "multi-voice"].includes(narration.speakerMode)) {
      throw new Error(`narration.speakerMode inválido: ${narration.speakerMode}.`);
    }
    if (narration.speakerMode === "multi-voice") {
      if (narration.provider !== "google-vids") throw new Error("Narração multi-voz exige Google Vids.");
      if (!Array.isArray(narration.speakers) || narration.speakers.length < 2) throw new Error("Narração multi-voz exige ao menos dois speakers.");
      const speakerIds = new Set();
      for (const [index, speaker] of narration.speakers.entries()) {
        const id = requiredText(speaker?.id, `narration.speakers[${index}].id`);
        requiredText(speaker?.voice, `narration.speakers[${index}].voice`);
        if (id !== speaker.id || speakerIds.has(id)) throw new Error("Narração multi-voz possui speaker inválido ou duplicado.");
        speakerIds.add(id);
      }
      if (!narration.blocks.length) throw new Error("Narração multi-voz exige blocos.");
      const blockIds = new Set();
      for (const [index, block] of narration.blocks.entries()) {
        if (!speakerIds.has(block.speakerId)) throw new Error(`narration.blocks[${index}].speakerId não foi declarado.`);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(block.id) || blockIds.has(block.id)) throw new Error(`Bloco multi-voz inválido ou duplicado: ${block.id}.`);
        blockIds.add(block.id);
      }
    }
    if (narration.provider === "omni") {
      if (narration.blocks.length === 0) throw new Error("Narração Omni exige narration.blocks para alinhamento local por Whisper.");
      if (narration.speakers != null) throw new Error("Narração Omni não aceita narration.speakers; descreva a voz em narration.voice ou por bloco.");
    }
  }
  const alignment = raw.alignment == null ? null : structuredClone(raw.alignment);
  if (alignment?.backend != null && !WHISPER_BACKENDS.includes(alignment.backend)) throw new Error(`Backend de alinhamento não suportado: ${alignment.backend}.`);
  if (executionPlan && operationFingerprint(alignment) !== operationFingerprint(executionPlan.spec.alignment ?? null)) throw new Error("alignment diverge do plano canônico congelado.");
  const music = raw.music == null ? null : {
    prompt: raw.music.prompt == null ? null : String(raw.music.prompt),
    preset: raw.music.preset == null ? null : String(raw.music.preset),
    backend: String(raw.music.backend ?? "flow-music"),
    images: (raw.music.images ?? []).map((value) => path.resolve(baseDirectory, String(value))),
    durationSeconds: Number(raw.music.durationSeconds ?? raw.music.duration ?? 30),
  };
  if (music) {
    const selected = MUSIC_BACKENDS[music.backend];
    if (!selected) throw new Error(`Backend musical desconhecido: ${music.backend}.`);
    // A capacidade deve ter adapter cookie-only no registro vigente.
    if (!selected.playwrightOperational) {
      throw new Error(`Este projeto é cookie-only: ${music.backend} não tem adapter de sessão autenticada.`);
    }
    if (music.images.length) throw new Error("Backend musical cookie-only não aceita music.images.");
    if (!Number.isFinite(music.durationSeconds) || music.durationSeconds < 5 || music.durationSeconds > 120) throw new Error("music.durationSeconds deve ficar entre 5 e 120.");
    resolveMusicPrompt(music);
  }
  const captions = raw.captions == null ? null : {
    wordsFile: resolveOptional(baseDirectory, raw.captions.wordsFile),
    scriptFile: resolveOptional(baseDirectory, raw.captions.scriptFile),
    style: String(raw.captions.style ?? "kinetic-word@1"),
    sidecars: (raw.captions.sidecars ?? []).map(String),
  };
  if (captions && !captions.wordsFile && !narration) throw new Error("captions.wordsFile é obrigatório quando não há narração alinhada no próprio filme.");
  if (captions) resolveCaptionStyle(captions.style);
  const delivery = raw.delivery == null ? null : {
    profile: String(raw.delivery.profile ?? "web-1080p"),
    lut: resolveOptional(baseDirectory, raw.delivery.lut),
  };
  if (delivery) resolveDeliveryProfile(delivery.profile);
  if (raw.qa?.blockingWarnings != null && !Array.isArray(raw.qa.blockingWarnings)) throw new Error("qa.blockingWarnings deve ser uma lista de códigos.");
  if (raw.qa?.sceneBlockingWarnings != null && !Array.isArray(raw.qa.sceneBlockingWarnings)) throw new Error("qa.sceneBlockingWarnings deve ser uma lista de códigos.");
  const qa = raw.qa === false ? null : {
    expectedText: raw.qa?.expectedText == null ? null : String(raw.qa.expectedText),
    expectedDuration: raw.qa?.expectedDuration == null ? null : Number(raw.qa.expectedDuration),
    expectedFrames: raw.qa?.expectedFrames == null ? null : Number(raw.qa.expectedFrames),
    assertions: raw.qa?.assertions == null ? [] : raw.qa.assertions.map(String),
    semantic: Boolean(raw.qa?.semantic),
    semanticModel: String(raw.qa?.semanticModel ?? "gemini-3.5-flash"),
    direction: raw.qa?.direction == null ? null : String(raw.qa.direction),
    references: (raw.qa?.references ?? []).map((value) => path.resolve(baseDirectory, String(value))),
    gate: String(raw.qa?.gate ?? "block"),
    blockingWarnings: raw.qa?.blockingWarnings == null ? null : raw.qa.blockingWarnings.map(String),
    sceneGate: String(raw.qa?.sceneGate ?? "block"),
    sceneBlockingWarnings: raw.qa?.sceneBlockingWarnings == null ? null : raw.qa.sceneBlockingWarnings.map(String),
    semanticScenes: Boolean(raw.qa?.semanticScenes),
  };
  if (qa?.expectedDuration != null && (!Number.isFinite(qa.expectedDuration) || qa.expectedDuration <= 0)) throw new Error("qa.expectedDuration deve ser positivo.");
  if (qa?.expectedFrames != null && (!Number.isSafeInteger(qa.expectedFrames) || qa.expectedFrames <= 0)) throw new Error("qa.expectedFrames deve ser inteiro positivo.");
  if (qa && !new Set(["block", "warn"]).has(qa.gate)) throw new Error("qa.gate deve ser block ou warn.");
  if (qa && !new Set(["block", "warn"]).has(qa.sceneGate)) throw new Error("qa.sceneGate deve ser block ou warn.");
  if (qa?.semantic || qa?.semanticScenes) throw new Error("QA semântico não possui adapter cookie-only verificável neste projeto; use QA técnico local.");
  const ambienceFile = resolveOptional(baseDirectory, raw.audio?.ambienceFile);
  if (raw.audio?.sceneAudioGainDb != null && (!Number.isFinite(raw.audio.sceneAudioGainDb) || raw.audio.sceneAudioGainDb < -96 || raw.audio.sceneAudioGainDb > 12)) throw new Error("sceneAudioGainDb deve ficar entre -96 e 12.");
  const canonicalAudio = executionPlan?.spec?.finishing?.audio;
  const canonicalPost = executionPlan?.spec?.finishing?.postProduction ?? null;
  if (raw.postProduction != null || canonicalPost?.operations?.length) {
    if (!executionPlan || operationFingerprint(raw.postProduction ?? null) !== operationFingerprint(canonicalPost)) throw new Error("Pós-produção exige lista idêntica ao plano canônico.");
    validatePostProduction(raw.postProduction, executionPlan.timeline.durationFrames);
  }
  if (executionPlan && (raw.audio?.sceneAudioGainDb ?? null) !== (canonicalAudio?.sceneAudioGainDb ?? null)) throw new Error("sceneAudioGainDb diverge do plano canônico congelado.");
  if (raw.audio?.sfx?.cues?.length || canonicalAudio?.sfx?.cues?.length) {
    if (!executionPlan || operationFingerprint(raw.audio?.sfx ?? null) !== operationFingerprint(canonicalAudio?.sfx ?? null) || raw.audio?.sfxGainDb !== canonicalAudio?.sfxGainDb) throw new Error("SFX exige declaração e ganho idênticos ao plano canônico; use compile/plan de receita@2.");
    localSfxAssets(executionPlan.spec);
  }
  const audioNumbers = ["voiceGain", "musicGain", "ambienceGain", "duckingThreshold", "duckingRatio", "fadeIn", "fadeOut"];
  for (const key of audioNumbers) {
    const value = Number(raw.audio?.[key] ?? ({ voiceGain: 1, musicGain: 0.45, ambienceGain: 0.2, duckingThreshold: 0.08, duckingRatio: 8, fadeIn: 0.25, fadeOut: 0 })[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`audio.${key} deve ser número não negativo.`);
  }
  for (const key of ["voiceGainDb", "musicGainDb", "sfxGainDb"]) {
    if (raw.audio?.[key] != null && (!Number.isFinite(Number(raw.audio[key])) || !Number.isFinite(10 ** (Number(raw.audio[key]) / 20)))) throw new Error(`audio.${key} deve representar ganho finito em dB.`);
  }
  resolveLoudnessProfile(raw.audio?.loudness ?? "platform");
  const transition = String(raw.assembly?.transition ?? "cut");
  const transitionDuration = Number(raw.assembly?.transitionDuration ?? 0.5);
  const transitions = raw.assembly?.transitions == null ? null : raw.assembly.transitions.map((edge, index) => ({
    transition: String(edge?.transition ?? ""),
    duration: Number(edge?.duration ?? edge?.transitionDuration ?? 0),
    fromSceneId: edge?.fromSceneId == null ? null : String(edge.fromSceneId),
    toSceneId: edge?.toSceneId == null ? null : String(edge.toSceneId),
    index,
  }));
  const fps = Number(raw.assembly?.fps ?? 24);
  const sceneFrameTargets = raw.assembly?.sceneFrameTargets == null ? null : raw.assembly.sceneFrameTargets.map((entry) => ({ sceneId: String(entry.sceneId), plannedFrames: Number(entry.plannedFrames) }));
  const expectedMasterFrames = raw.assembly?.expectedMasterFrames == null ? null : Number(raw.assembly.expectedMasterFrames);
  const planFingerprint = raw.assembly?.planFingerprint == null ? null : String(raw.assembly.planFingerprint);
  if (!FILM_TRANSITIONS.has(transition)) throw new Error(`Transição inválida: ${transition}.`);
  if (!Number.isFinite(transitionDuration) || transitionDuration <= 0) throw new Error("assembly.transitionDuration deve ser positivo.");
  if (transitions && transitions.length !== Math.max(0, draft.scenes.length - 1)) throw new Error("assembly.transitions deve cobrir exatamente os edges adjacentes.");
  for (const [index, edge] of (transitions ?? []).entries()) {
    if (!FILM_TRANSITIONS.has(edge.transition)) throw new Error(`Transição inválida no edge ${index}: ${edge.transition}.`);
    if (edge.transition === "cut" && edge.duration !== 0) throw new Error(`Transição cut no edge ${index} exige duração zero.`);
    if (edge.transition !== "cut" && (!Number.isFinite(edge.duration) || edge.duration <= 0)) throw new Error(`Transição ${edge.transition} no edge ${index} exige duração positiva.`);
    if (edge.fromSceneId != null && edge.fromSceneId !== draft.scenes[index].id) throw new Error(`assembly.transitions[${index}].fromSceneId diverge da ordem das cenas.`);
    if (edge.toSceneId != null && edge.toSceneId !== draft.scenes[index + 1].id) throw new Error(`assembly.transitions[${index}].toSceneId diverge da ordem das cenas.`);
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("assembly.fps deve ser positivo.");
  if (sceneFrameTargets) {
    if (sceneFrameTargets.length !== draft.scenes.length) throw new Error("assembly.sceneFrameTargets deve cobrir todas as cenas.");
    for (const [index, target] of sceneFrameTargets.entries()) {
      if (target.sceneId !== draft.scenes[index].id || !Number.isSafeInteger(target.plannedFrames) || target.plannedFrames <= 0) throw new Error(`assembly.sceneFrameTargets[${index}] inválido.`);
    }
  }
  if (expectedMasterFrames != null && (!Number.isSafeInteger(expectedMasterFrames) || expectedMasterFrames <= 0)) throw new Error("assembly.expectedMasterFrames deve ser inteiro positivo.");
  if (planFingerprint != null && !/^[a-f0-9]{64}$/.test(planFingerprint)) throw new Error("assembly.planFingerprint inválido.");
  for (const scene of draft.scenes) {
    if (!GEMINI_IMAGE_MODELS.has(scene.imageModel)) throw new Error(`Modelo de imagem não permitido em ${scene.id}: ${scene.imageModel}.`);
    if (!GEMINI_IMAGE_SIZES.has(scene.imageSize)) throw new Error(`Tamanho de imagem inválido em ${scene.id}: ${scene.imageSize}.`);
    if (!GEMINI_IMAGE_ASPECT_RATIOS.has(scene.aspect)) throw new Error(`Aspecto de keyframe inválido em ${scene.id}: ${scene.aspect}.`);
  }
  const calls = {
    image: draft.scenes.filter((scene) => !["text_to_video", "reference_to_video", "edit"].includes(scene.generationTask)).length,
    tts: narration?.provider === "google-vids" ? (narration.speakerMode === "multi-voice" ? narration.blocks.length : 1) : 0,
    music: music ? 1 : 0,
    omni: draft.scenes.length + (narration?.provider === "omni" ? narration.blocks.length : 0),
    semanticQa: (qa?.semantic ? 1 : 0) + (qa?.semanticScenes ? draft.scenes.length : 0),
  };
  const budget = {
    image: positiveInteger(raw.budget?.image, calls.image, "budget.image"),
    tts: positiveInteger(raw.budget?.tts, calls.tts, "budget.tts"),
    music: positiveInteger(raw.budget?.music, calls.music, "budget.music"),
    omni: positiveInteger(raw.budget?.omni, calls.omni, "budget.omni"),
    semanticQa: positiveInteger(raw.budget?.semanticQa, calls.semanticQa, "budget.semanticQa"),
  };
  for (const [provider, count] of Object.entries(calls)) {
    if (count > budget[provider]) throw new Error(`O plano exige ${count} chamada(s) ${provider}, acima do orçamento ${budget[provider]}.`);
  }
  return {
    schema: FILM_SPEC_SCHEMA,
    name,
    mode: "studio",
    aspect,
    root,
    draft,
    brief,
    knowledgeContext,
    knowledgeContextBinding,
    decisionArtifacts: raw.decisionArtifacts ?? null,
    ...(raw.styleComposition ? { styleComposition: structuredClone(raw.styleComposition) } : {}),
    workflow: raw.workflow ?? null,
    narration,
    ...(alignment == null ? {} : { alignment }),
    music,
    audio: {
      ambienceFile,
      ...(raw.audio?.sceneAudioGainDb != null ? { sceneAudioGainDb: raw.audio.sceneAudioGainDb } : {}),
      ...(raw.audio?.sfx?.cues?.length ? { sfx: structuredClone(raw.audio.sfx), sfxGainDb: raw.audio.sfxGainDb } : {}),
      loudness: raw.audio?.loudness ?? "platform",
      voiceGain: raw.audio?.voiceGain ?? (raw.audio?.voiceGainDb == null ? 1 : 10 ** (Number(raw.audio.voiceGainDb) / 20)),
      musicGain: raw.audio?.musicGain ?? (raw.audio?.musicGainDb == null ? 0.45 : 10 ** (Number(raw.audio.musicGainDb) / 20)),
      ambienceGain: raw.audio?.ambienceGain ?? 0.2,
      duckingThreshold: raw.audio?.duckingThreshold ?? 0.08,
      duckingRatio: raw.audio?.duckingRatio ?? 8,
      fadeIn: raw.audio?.fadeIn ?? 0.25,
      fadeOut: raw.audio?.fadeOut ?? 0,
    },
    assembly: { transition, transitionDuration, transitions, fps, sceneFrameTargets, expectedMasterFrames, planFingerprint },
    ...(raw.postProduction == null ? {} : { postProduction: structuredClone(raw.postProduction) }),
    captions,
    delivery,
    qa,
    calls,
    budget,
  };
}

function stage(status = "planned", extras = {}) {
  return { status, attempts: 0, startedAt: null, completedAt: null, outputFile: null, receiptFile: null, receiptId: null, error: null, ...extras };
}

function outputPaths(spec) {
  const videos = path.join(spec.root, "videos-unidos");
  const audio = path.join(spec.root, "audio");
  const metadata = path.join(spec.root, "metadados");
  const receipts = path.join(spec.root, "receitas");
  return {
    planFile: path.join(metadata, "film-plan.json"),
    stateFile: path.join(metadata, "film-state.json"),
    draftFile: path.join(metadata, "draft.json"),
    voiceFile: path.join(audio, "voice.wav"),
    musicFile: path.join(audio, "music.wav"),
    musicBedFile: path.join(audio, "music-bed.wav"),
    audioMasterFile: path.join(audio, "master.wav"),
    assembledFile: path.join(videos, `${spec.name}-assembled.mp4`),
    masteredFile: path.join(videos, `${spec.name}-mastered.mp4`),
    captionedFile: path.join(videos, `${spec.name}-captioned.mp4`),
    deliveryFile: path.join(videos, `${spec.name}-final.mp4`),
    qaFile: path.join(metadata, "qa.json"),
    receipts,
  };
}

function receiptContextMetadata(spec) {
  return { ...studioReceiptContextMetadata({
    brief: spec.brief,
    knowledgeContext: spec.knowledgeContext,
    binding: spec.knowledgeContextBinding,
  }), ...(spec.styleComposition ? { styleCompositionHash: spec.styleComposition.hash, styleComponentSelections: spec.styleComposition.composition.selected.map(({ dimension, id }) => ({ dimension, id })) } : {}) };
}

function stageDefinitions(spec, files, { hasVariants = false } = {}) {
  const hasAudio = Boolean(spec.narration || spec.music || spec.audio.ambienceFile || spec.audio.sfx?.cues.length || spec.audio.sceneAudioGainDb != null);
  return {
    draft: stage("planned", { outputFile: files.draftFile, paid: true, calls: spec.calls.image, aggregate: true }),
    tts: stage(spec.narration ? "planned" : "skipped", { outputFile: spec.narration ? files.voiceFile : null, paid: Boolean(spec.narration), calls: spec.calls.tts }),
    music: stage(spec.music ? "planned" : "skipped", { outputFile: spec.music ? files.musicFile : null, paid: Boolean(spec.music), calls: spec.calls.music }),
    musicFit: stage(spec.music ? "blocked" : "skipped", { outputFile: spec.music ? files.musicBedFile : null, paid: false, blockedBy: "tts+music" }),
    video: stage("blocked", { outputFile: files.draftFile, paid: true, calls: spec.calls.omni, blockedBy: "human_approval", aggregate: true }),
    sceneQa: stage(spec.qa ? "blocked" : "skipped", { outputFile: spec.qa ? files.draftFile : null, paid: Boolean(spec.qa?.semanticScenes), calls: spec.qa?.semanticScenes ? spec.draft.scenes.length : 0, aggregate: true, blockedBy: "video" }),
    assembly: stage("blocked", { outputFile: files.assembledFile, paid: false, blockedBy: spec.qa ? "sceneQa" : "video" }),
    audioMix: stage(hasAudio ? "blocked" : "skipped", { outputFile: hasAudio ? files.audioMasterFile : null, paid: false, blockedBy: [spec.narration && "tts", spec.music && "musicFit", spec.audio.sceneAudioGainDb != null && "assembly"].filter(Boolean).join("+") }),
    audioMux: stage(hasAudio ? "blocked" : "skipped", { outputFile: hasAudio ? files.masteredFile : null, paid: false, blockedBy: "assembly+audioMix" }),
    captions: stage(spec.captions ? "blocked" : "skipped", { outputFile: spec.captions ? files.captionedFile : null, paid: false, blockedBy: "video-master" }),
    qa: stage(spec.qa ? "blocked" : "skipped", { outputFile: spec.qa ? files.qaFile : null, paid: Boolean(spec.qa?.semantic), calls: spec.qa?.semantic ? 1 : 0, blockedBy: "video-master" }),
    delivery: stage(spec.delivery ? "blocked" : "skipped", { outputFile: spec.delivery ? files.deliveryFile : null, paid: false, blockedBy: "qa" }),
    variants: stage(hasVariants ? "blocked" : "skipped", { outputFile: null, paid: false, blockedBy: "delivery", aggregate: true }),
  };
}

export function createFilmPlan(spec, { executionPlan = null } = {}) {
  const files = outputPaths(spec);
  const canonicalFingerprint = executionPlan?.schema === "mkt-videos/execution-plan@1"
    ? executionPlan.fingerprint
    : null;
  const fingerprint = operationFingerprint(canonicalFingerprint ? { spec, canonicalFingerprint } : { spec });
  const stages = stageDefinitions(spec, files, { hasVariants: Boolean(executionPlan?.nodes?.some((node) => node.kind === "variant")) });
  const contextMetadata = receiptContextMetadata(spec);
  for (const [name, entry] of Object.entries(stages)) entry.fingerprint = operationFingerprint({ film: fingerprint, stage: name });
  return {
    schema: FILM_PLAN_SCHEMA,
    id: `film:${fingerprint.slice(0, 24)}`,
    fingerprint,
    createdAt: new Date().toISOString(),
    spec,
    files,
    paidCalls: [
      { stage: "draft", provider: "gemini-image", count: spec.calls.image, approval: "run" },
      ...(spec.calls.tts ? [{ stage: "tts", provider: "gemini-tts", count: 1, approval: "run" }] : []),
      ...(spec.calls.music ? [{ stage: "music", provider: "lyria", count: 1, approval: "run" }] : []),
      { stage: "video", provider: "gemini-omni", count: spec.calls.omni, approval: "approve + resume" },
      ...(spec.qa?.semanticScenes ? [{ stage: "sceneQa", provider: "gemini-vision", count: spec.draft.scenes.length, approval: "resume" }] : []),
      ...(spec.qa?.semantic ? [{ stage: "qa", provider: "gemini-vision", count: 1, approval: "resume" }] : []),
    ],
    budget: spec.budget,
    ...(contextMetadata.briefHash ? { briefHash: contextMetadata.briefHash } : {}),
    ...(contextMetadata.knowledgeContext ? { knowledgeContext: structuredClone(contextMetadata.knowledgeContext) } : {}),
    ...(spec.knowledgeContextBinding ? { knowledgeContextBinding: structuredClone(spec.knowledgeContextBinding) } : {}),
    ...(spec.decisionArtifacts ? { decisionArtifacts: structuredClone(spec.decisionArtifacts) } : {}),
    stages,
    ...(executionPlan ? {
      planner: "canonical",
      ...(executionPlan.compilerVersion ? { compilerVersion: executionPlan.compilerVersion } : {}),
      ...(executionPlan.capabilitySnapshotHash ? { capabilitySnapshotHash: executionPlan.capabilitySnapshotHash } : {}),
      executionPlan: structuredClone(executionPlan),
      governance: structuredClone(executionPlan.governance ?? null),
    } : {
      planner: "legacy",
    }),
  };
}

export function createFilmState(plan) {
  const now = new Date().toISOString();
  return {
    schema: FILM_STATE_SCHEMA,
    id: plan.id,
    planFingerprint: plan.fingerprint,
    ...(plan.briefHash ? { briefHash: plan.briefHash } : {}),
    ...(plan.knowledgeContextBinding ? { knowledgeContextBinding: structuredClone(plan.knowledgeContextBinding) } : {}),
    status: "planned",
    createdAt: now,
    updatedAt: now,
    planFile: plan.files.planFile,
    stateFile: plan.files.stateFile,
    ...(plan.executionPlan ? { executionJournalFile: path.join(path.dirname(plan.files.stateFile), "execution-journal.sqlite") } : {}),
    draftFile: plan.files.draftFile,
    finalFile: null,
    stages: structuredClone(plan.stages),
    history: [{ at: now, event: "planned" }],
  };
}

async function saveState(state, { initial = false } = {}) {
  const previous = stateSaveQueues.get(state) ?? Promise.resolve();
  const next = previous.then(async () => {
    state.updatedAt = new Date().toISOString();
    if (state.executionJournalFile && await pathExists(state.executionJournalFile)) {
      const journal = materializeExecutionSnapshot({ dbFile: state.executionJournalFile });
      state.journalProjection = {
        schema: journal.schema,
        planFingerprint: journal.planFingerprint,
        status: journal.status,
        lastEvent: journal.lastEvent,
        nodes: Object.fromEntries(Object.entries(journal.nodes).map(([id, node]) => [id, {
          status: node.status,
          attempts: node.attempts,
          output: node.output,
          receipt: node.receipt,
        }])),
      };
    }
    const snapshot = structuredClone(state);
    if (initial) await writeJsonAtomic(state.stateFile, snapshot, { label: "Estado do filme" });
    else await replaceJsonAtomic(state.stateFile, snapshot, { label: "Estado do filme" });
  });
  stateSaveQueues.set(state, next.catch(() => {}));
  await next;
}

function event(state, name, details = {}) {
  state.history.push({ at: new Date().toISOString(), event: name, ...details });
}

function refreshFilmStatus(state) {
  const statuses = Object.values(state.stages).map((value) => value.status);
  if (state.stages.qa?.gate?.status === "blocked" || state.stages.sceneQa?.gate?.status === "blocked" || statuses.some((value) => ["ambiguous", "attention_required", "failed"].includes(value))) state.status = "attention_required";
  else if (statuses.some((value) => value === "running")) state.status = "running";
  else if (state.stages.video.status === "awaiting_approval") state.status = "awaiting_approval";
  else if (statuses.every((value) => ["completed", "skipped"].includes(value))) state.status = "delivered";
  else state.status = "ready";
}

async function validateFilmInputs(spec) {
  const files = [
    ...spec.draft.scenes.flatMap((scene) => scene.references),
    ...(spec.music?.images ?? []),
    spec.audio.ambienceFile,
    spec.captions?.wordsFile,
    spec.captions?.scriptFile,
    spec.delivery?.lut,
    ...(spec.qa?.references ?? []),
  ].filter(Boolean);
  for (const file of [...new Set(files.map((value) => path.resolve(String(value))))]) {
    try {
      await access(file);
    } catch (error) {
      throw new Error(`Entrada do filme não encontrada: ${file}`, { cause: error });
    }
  }
}

/**
 * Valida o spec, cria o plano e o estado inicial do filme (provider-free).
 * @param {{ spec?: object, specFile?: string | null, outputsRoot?: string | null, dryRun?: boolean, executionPlan?: object | null }} options
 * @returns {Promise<{ plan: object, state: { stateFile: string, root: string, status: string, stages: object, paidCalls: object }, dryRun: boolean }>}
 */
export async function planFilm({ spec, specFile = null, outputsRoot = null, dryRun = false, executionPlan = null } = {}) {
  const allowConceptStyle = executionPlan?.governance?.style?.status === "concept";
  const normalized = validateFilmSpec(spec, { specFile, outputsRoot, allowConceptStyle, executionPlan });
  await validateFilmInputs(normalized);
  const plan = createFilmPlan(normalized, { executionPlan });
  const state = createFilmState(plan);
  if (!dryRun) {
    await Promise.all(["metadados", "receitas", "audio", "videos-unidos", "videos-soltos", "keyframes"].map((directory) => mkdir(path.join(normalized.root, directory), { recursive: true })));
    await writeJsonAtomic(plan.files.planFile, plan, { label: "Plano do filme" });
    await saveState(state, { initial: true });
  }
  return { plan, state, dryRun };
}

export async function readFilmPlan(file, { providerCapabilities = null, now = new Date() } = {}) {
  const absolute = path.resolve(String(file));
  const value = JSON.parse(await readFile(absolute, "utf8"));
  if (value?.schema !== FILM_PLAN_SCHEMA || !value?.spec || !value?.files) throw new Error(`Plano de filme inválido: ${absolute}`);
  const canonicalFingerprint = value.executionPlan?.schema === "mkt-videos/execution-plan@1"
    ? value.executionPlan.fingerprint
    : null;
  const expectedFingerprint = operationFingerprint(canonicalFingerprint
    ? { spec: value.spec, canonicalFingerprint }
    : { spec: value.spec });
  if (value.fingerprint !== expectedFingerprint) {
    throw new Error(`Plano de filme adulterado: fingerprint canônico divergente em ${absolute}.`);
  }
  if (value.executionPlan) {
    assertExecutionPlanIntegrity(value.executionPlan, { now, providerCapabilities: providerCapabilities ?? await loadEffectiveProviderCapabilities({ now }) });
    if (operationFingerprint(value.governance ?? null) !== operationFingerprint(value.executionPlan.governance ?? null)) {
      throw new Error(`Plano de filme adulterado: cópia de governance divergente em ${absolute}.`);
    }
  }
  const planBrief = value.spec.brief == null ? null : assertStudioBrief(value.spec.brief);
  const planContext = value.spec.knowledgeContext == null ? null : assertKnowledgeContextSnapshot(value.spec.knowledgeContext);
  if (planContext != null) {
    const binding = assertKnowledgeContextBinding(value.spec.knowledgeContextBinding ?? value.knowledgeContextBinding, { context: planContext, briefHash: planBrief?.hash ?? null });
    if (value.knowledgeContextBinding && operationFingerprint(value.knowledgeContextBinding) !== operationFingerprint(binding)) throw new Error(`Plano de filme adulterado: binding de contexto divergente em ${absolute}.`);
  } else if (value.knowledgeContextBinding != null) {
    throw new Error(`Plano de filme adulterado: binding sem contexto em ${absolute}.`);
  }
  if (value.briefHash != null && value.briefHash !== planBrief?.hash) throw new Error(`Plano de filme adulterado: briefHash divergente em ${absolute}.`);
  return value;
}

export async function readFilmState(file) {
  const absolute = path.resolve(String(file));
  const value = JSON.parse(await readFile(absolute, "utf8"));
  if (value?.schema !== FILM_STATE_SCHEMA || !value?.stages) throw new Error(`Estado de filme inválido: ${absolute}`);
  return value;
}

async function loadContext(stateFile) {
  const state = await readFilmState(stateFile);
  const plan = await readFilmPlan(state.planFile);
  if (plan.fingerprint !== state.planFingerprint) throw new Error("Estado e plano do filme têm fingerprints diferentes.");
  if (plan.knowledgeContextBinding && operationFingerprint(plan.knowledgeContextBinding) !== operationFingerprint(state.knowledgeContextBinding ?? null)) {
    throw new Error("Estado e plano do filme têm bindings de knowledge-context diferentes.");
  }
  const files = { ...outputPaths(plan.spec), ...plan.files };
  const definitions = stageDefinitions(plan.spec, files);
  for (const [name, definition] of Object.entries(definitions)) {
    if (!state.stages[name]) state.stages[name] = { ...definition, fingerprint: operationFingerprint({ film: plan.fingerprint, stage: name }) };
  }
  return { state, plan, spec: plan.spec, files };
}

async function verifyCompletedStage(entry) {
  if (entry.status !== "completed") return false;
  if (!entry.outputFile || !(await pathExists(entry.outputFile))) throw new Error(`Etapa concluída perdeu o artefato: ${entry.outputFile ?? "sem caminho"}.`);
  if (entry.receiptFile) {
    const receipt = await readVerifiedReceipt(entry.receiptFile);
    if (entry.receiptId && receipt.id !== entry.receiptId) throw new Error(`Recibo divergente na etapa: ${entry.receiptFile}.`);
    for (const artifact of receipt.artifacts ?? []) {
      const validation = await verifyArtifact(artifact);
      if (!validation.valid) throw new Error(`Artefato divergente em ${entry.receiptFile}: ${validation.errors.join(" ")}`);
    }
  }
  return true;
}

async function recoverOrRejectStage(state, name) {
  const entry = state.stages[name];
  if (["skipped", "blocked", "awaiting_approval"].includes(entry.status)) return false;
  if (entry.status === "completed") return verifyCompletedStage(entry);
  if (["running", "ambiguous"].includes(entry.status)) {
    entry.status = "ambiguous";
    entry.error = "A execução anterior pode ter enviado uma chamada; repetição automática bloqueada.";
    event(state, "stage_ambiguous", { stage: name });
    refreshFilmStatus(state);
    await saveState(state);
    // Dizer "reconcilie" sem dizer como deixava a pessoa sozinha justamente no
    // pior momento. O comando sai pronto, com o state file preenchido.
    const comando = name === "video"
      ? `npm run video -- reconcile --state "${state.stateFile}" --scene <id-da-cena>`
      : `npm run video -- status --state "${state.stateFile}"`;
    throw new Error(`Etapa ${name} está ambígua. Reconcilie o provedor e o recibo antes de retomar; nenhum segundo POST foi feito.\nPróximo passo: ${comando}`);
  }
  if (entry.aggregate) return false;
  const hasOutput = entry.outputFile && await pathExists(entry.outputFile);
  const hasReceipt = entry.receiptFile && await pathExists(entry.receiptFile);
  if (hasOutput || hasReceipt) {
    if (!(hasOutput && hasReceipt)) {
      entry.status = "attention_required";
      entry.error = "Saída parcial encontrada; artefato e recibo não formam um par válido.";
      refreshFilmStatus(state);
      await saveState(state);
      throw new Error(`Etapa ${name} tem saída parcial; repetição automática bloqueada.`);
    }
    const receipt = await readVerifiedReceipt(entry.receiptFile);
    for (const artifact of receipt.artifacts ?? []) {
      const validation = await verifyArtifact(artifact);
      if (!validation.valid) throw new Error(`Artefato divergente em ${entry.receiptFile}: ${validation.errors.join(" ")}`);
    }
    entry.status = "completed";
    entry.receiptId = receipt.id;
    entry.completedAt = receipt.completedAt ?? new Date().toISOString();
    event(state, "stage_recovered", { stage: name, receipt: entry.receiptFile });
    refreshFilmStatus(state);
    await saveState(state);
    return true;
  }
  return false;
}

async function executeStage({ state, name, run }) {
  if (await recoverOrRejectStage(state, name)) return state.stages[name];
  const entry = state.stages[name];
  const paid = Boolean(entry.paid);
  entry.status = "running";
  entry.attempts += 1;
  entry.startedAt = new Date().toISOString();
  entry.error = null;
  event(state, "stage_started", { stage: name, attempt: entry.attempts });
  refreshFilmStatus(state);
  await saveState(state);
  try {
    const result = await run();
    entry.outputFile = result.file ?? result.outputFile ?? entry.outputFile;
    entry.receiptFile = result.receiptFile ?? null;
    entry.receiptId = receiptId(result.receipt) ?? await receiptIdFromFile(entry.receiptFile);
    entry.status = "completed";
    entry.completedAt = new Date().toISOString();
    event(state, "stage_completed", { stage: name, receipt: entry.receiptFile });
    refreshFilmStatus(state);
    await saveState(state);
    return entry;
  } catch (error) {
    entry.status = paid ? "ambiguous" : "failed";
    entry.error = error?.message ?? String(error);
    event(state, paid ? "stage_ambiguous" : "stage_failed", { stage: name, error: entry.error });
    refreshFilmStatus(state);
    await saveState(state);
    throw error;
  }
}

function parentIds(state, names) {
  return names.map((name) => state.stages[name]?.receiptId).filter(Boolean);
}

function cookieOperationRequired(name) {
  return async () => { throw new Error(`${name} exige operação cookie-only injetada pelo CLI.`); };
}

function defaultOperations() {
  return {
    imageAdapter: { generate: cookieOperationRequired("draft") },
    videoAdapter: { generate: cookieOperationRequired("animação"), reconcile: cookieOperationRequired("reconciliação") },
    draftScenes,
    animateDraft,
    qaDraftScenes,
    generateTts: cookieOperationRequired("TTS"),
    generateMusic: cookieOperationRequired("Lyria"),
    alignNarrationBlocks,
    assembleFilm,
    mixAudio,
    muxMasterAudio,
    renderWordCaptions,
    finishVideo,
    runQa,
    probeMedia,
    probeTiming,
    fitMusicToDuration,
    renderMotionGraphics,
    renderHtmlMotion: async (options) => (await import("./html-motion-pilot.mjs")).renderHtmlMotionPilot(options),
    createVideoVariant,
    applyFilmPostOperation,
  };
}

function combineProviderHandleCallbacks(kernelCallback, operationCallback) {
  return async (handle) => {
    await kernelCallback(handle);
    if (typeof operationCallback === "function") {
      await operationCallback(handle);
    }
  };
}

async function executeCanonicalLocalNode({
  kernel,
  executionPlan,
  nodeId,
  execute,
  reuse = null,
} = {}) {
  if (
    !kernel
    || !executionPlan?.nodes?.some((node) => node.id === nodeId)
  ) {
    return null;
  }
  return kernel.executeLocalNode({ nodeId, execute, reuse });
}

function localArtifactReuse({ plan, operations, options, recipeFor, artifactRole }) {
  const policy = plan.executionPlan?.spec?.reuse?.policy ?? "off";
  const rootScopeId = plan.executionPlan?.spec?.source?.scope?.rootScopeId ?? null;
  const request = async () => {
    const recipe = await recipeFor(options);
    return { policy, rootScopeId, recipe, consumer: recipe.parameters.consumer, artifactRole, outputFile: options.outputFile, receiptFile: options.receiptFile };
  };
  return {
    async try() {
      if (policy === "off") return { hit: false };
      if (typeof operations.reuseApprovedArtifact !== "function") {
        if (policy === "require-approved") throw new Error(`Reuso obrigatório de ${artifactRole} exige asset-context.reuse.`);
        return { hit: false, reason: "reuse_context_missing" };
      }
      const target = await request();
      return operations.reuseApprovedArtifact({ ...target, executionConsumer: target.consumer });
    },
    async validate(receipt) {
      if (typeof operations.reuseApprovedArtifact?.validate !== "function") throw new Error(`Retomada de ${artifactRole} reutilizado exige asset-context.reuse.`);
      return operations.reuseApprovedArtifact.validate({ ...await request(), receipt });
    },
  };
}

async function executeCanonicalLocalOrDirect(options) {
  return options.kernel
    ? executeCanonicalLocalNode(options)
    : options.execute();
}

function canonicalExecutionOperations({
  plan,
  files,
  operations,
  confirmFingerprint,
  allowConceptPilot,
  authorizationSource,
  authorizationActor,
  resourceBroker = null,
} = {}) {
  if (plan.executionPlan?.schema !== "mkt-videos/execution-plan@1") {
    return { operations, kernel: null, journalFile: null };
  }
  const journalFile = path.join(
    path.dirname(files.stateFile),
    "execution-journal.sqlite",
  );
  const plannedNodes = new Map(plan.executionPlan.nodes.map((node) => [node.id, node]));
  const admissionProvider = async ({ node, phase = "submit", attemptId = null, fileId = null }) => {
    const paidCall = plan.executionPlan.governance?.paidCalls?.find((entry) => entry.nodeIds?.includes(node.id)) ?? null;
    if (!paidCall) return { schema: "mkt-videos/runtime-admission@1", status: "ready", blockers: [], evaluatedAt: new Date().toISOString(), checks: { localNode: true } };
    const capability = plan.executionPlan.governance?.capabilities?.find((entry) => entry.provider === paidCall.provider) ?? null;
    const snapshot = materializeExecutionSnapshot({ dbFile: journalFile });
    let rights = null;
    try {
      const decision = buildExecutionRightsDecision({ dbFile: journalFile, nodeId: node.id });
      rights = { id: decision.decisionHash, status: "allowed", revoked: false };
    } catch {
      rights = { id: null, status: "denied", revoked: false };
    }
    const disk = await statfs(path.dirname(files.stateFile));
    const requiredBytes = ["video", "draft"].includes(paidCall.stage) ? 512 * 1024 * 1024 : 128 * 1024 * 1024;
    return evaluateRuntimeAdmission({
      capability: capability == null ? null : {
        id: capability.provider,
        status: capability.status,
        proof: { valid: Boolean(capability.evidence) && capability.freshness?.status === "valid", hash: plan.executionPlan.capabilitySnapshotHash },
        expiresAt: capability.freshness?.expiresAt ?? null,
      },
      rights,
      freeBytes: Number(disk.bavail) * Number(disk.bsize),
      requiredBytes,
      circuit: { status: "closed" },
      // Coletar o handle da própria tentativa não é uma nova submissão.
      // Outro handle, outra tentativa ou ancestral ambíguo continuam bloqueados.
      pendingAmbiguous: unresolvedExecutionDependencies({ nodeId: node.id, nodes: plannedNodes, snapshot }).some((id) => !(id === node.id && ((phase === "collect" && attemptId && fileId && snapshot.nodes[id]?.attemptId === attemptId && snapshot.nodes[id]?.providerHandle?.fileId === fileId) || snapshot.nodes[id]?.humanRetryAuthorization?.status === "issued"))),
    });
  };
  const kernel = createExecutionKernel({
    dbFile: journalFile,
    plan: plan.executionPlan,
    confirmFingerprint,
    allowConceptPilot,
    source: authorizationSource,
    actor: authorizationActor,
    resourceBroker,
    admissionProvider,
    validateReusedArtifact: async (receipt) => {
      if (typeof operations.reuseApprovedArtifact?.validate !== "function") throw new Error("Consumo de artefato reutilizado exige asset-context.reuse vigente.");
      const binding = receipt.metadata?.approvedReuse?.binding;
      return operations.reuseApprovedArtifact.validate({ rootScopeId: plan.executionPlan.spec.source?.scope?.rootScopeId, recipe: { hash: binding?.recipeHash }, consumer: binding?.consumer, artifactRole: binding?.artifactRole, receipt });
    },
  });
  const wrapped = { ...operations };
  const imageAdapter = operations.imageAdapter;
  const videoAdapter = operations.videoAdapter;
  if (imageAdapter?.generate) {
    wrapped.imageAdapter = {
      ...imageAdapter,
      generate: (options) => {
        const sceneId = requiredText(
          options?.metadata?.sceneId,
          "metadata.sceneId",
        );
        return kernel.executePaidNode({
          nodeId: `keyframe:${sceneId}`,
          inputFiles: options.images ?? [],
          ...(options.attemptId ? { attemptId: options.attemptId } : {}),
          execute: ({
            attemptId,
            executionEffectAuthorization,
            onProviderHandle,
          }) =>
            imageAdapter.generate({
              ...options,
              attemptId,
              executionEffectAuthorization,
              onProviderHandle: combineProviderHandleCallbacks(
                onProviderHandle,
                options.onProviderHandle,
              ),
              metadata: {
                ...(options.metadata ?? {}),
                executionKernel: "required",
                executionNodeId: `keyframe:${sceneId}`,
              },
            }),
        });
      },
    };
  }
  if (videoAdapter?.generate) {
    const phased = Boolean(resourceBroker && ["submit", "observe", "collect"].every((name) => typeof videoAdapter[name] === "function"));
    wrapped.videoAdapter = {
      ...videoAdapter,
      canResumePhases: phased,
      canResumeAttempt: (attemptId) => phased && Boolean(resourceBroker.readRemoteOperation(`omni:${attemptId}`)?.handle?.fileId),
      generate: (options) => {
        const sceneId = requiredText(
          options?.metadata?.sceneId,
          "metadata.sceneId",
        );
        const resumePhase = options.resumePhase === true || (phased && options.resumePhase === "auto" && Boolean(materializeExecutionSnapshot({ dbFile: journalFile }).nodes[`video:${sceneId}`]?.attemptId));
        return kernel.executePaidNode({
          nodeId: `video:${sceneId}`,
          inputFiles: [...(options.images ?? []), ...(options.referenceVideo ? [options.referenceVideo] : [])],
          receiptFiles: options.executionInputReceipts ?? [],
          ...(options.attemptId ? { attemptId: options.attemptId } : {}),
          ...(phased ? {
            phasedVideo: { adapter: videoAdapter, reconcile: resumePhase, options: { ...options, metadata: { ...(options.metadata ?? {}), executionKernel: "required", executionNodeId: `video:${sceneId}` } } },
          } : {}),
          execute: ({
            attemptId,
            executionEffectAuthorization,
            onProviderHandle,
          }) =>
            videoAdapter.generate({
              ...options,
              attemptId,
              executionEffectAuthorization,
              onProviderHandle: combineProviderHandleCallbacks(
                onProviderHandle,
                options.onProviderHandle,
              ),
              metadata: {
                ...(options.metadata ?? {}),
                executionKernel: "required",
                executionNodeId: `video:${sceneId}`,
              },
            }),
        });
      },
    };
    if (phased) wrapped.videoAdapter.reconcile = async (options) => ({ ...await wrapped.videoAdapter.generate({ ...options, resumePhase: true }), classification: "ready", zeroPost: true });
  }
  if (typeof operations.generateTts === "function") {
    wrapped.generateTts = (options) => {
      const nodeId = options.executionNodeId ?? "voice-master";
      const targetNode = plan.executionPlan?.nodes?.find((node) => node.id === nodeId);
      if (targetNode && targetNode.costClass !== "paid") {
        return operations.generateTts(options);
      }
      return kernel.executePaidNode({
        nodeId,
        execute: ({
          attemptId,
          executionEffectAuthorization,
          onProviderHandle,
        }) =>
          operations.generateTts({
            ...options,
            attemptId,
            executionKernel: "required",
            executionEffectAuthorization,
            onProviderHandle,
          }),
      });
    };
  }
  if (typeof operations.generateMusic === "function") {
    wrapped.generateMusic = (options) =>
      kernel.executePaidNode({
        nodeId: "music-source",
        execute: ({
          attemptId,
          executionEffectAuthorization,
          onProviderHandle,
        }) =>
          operations.generateMusic({
            ...options,
            attemptId,
            executionKernel: "required",
            executionEffectAuthorization,
            onProviderHandle,
          }),
      });
  }
  return { operations: wrapped, kernel, journalFile };
}

function approvedDraftTarget(draft) {
  const scenes = (draft.scenes ?? []).map((scene) => ({
    id: scene.id,
    approvedAt: scene.approvedAt ?? null,
    keyframeReceipt: scene.keyframeReceipt ?? null,
  }));
  if (
    scenes.length === 0
    || scenes.some((scene) => !scene.approvedAt || !scene.keyframeReceipt)
  ) {
    throw new Error(
      "Aprovação governada exige approvedAt e recibo de keyframe em todas as cenas.",
    );
  }
  return {
    targetHash: operationFingerprint({
      schema: "mkt-videos/draft-approval-target@1",
      draftId: draft.id,
      scenes,
    }),
    approvedAt: new Date(
      Math.max(...scenes.map((scene) => Date.parse(scene.approvedAt))),
    ),
  };
}

/**
 * Executa as etapas pagas (keyframes + draft) e pausa para aprovação humana.
 * @param {{ stateFile: string, confirmFingerprint?: unknown, allowConceptPilot?: boolean, authorizationSource?: string, authorizationActor?: string, endpoint?: string | null, operations?: object }} options
 * @returns {Promise<{ state: { stateFile: string }, plan: object, spec: object, files: object }>}
 */
async function withFilmOperationLock(options, execute) {
  const { spec } = await loadContext(options.stateFile);
  return withProductionLock(spec.root, { label: spec.name }, () => execute(options));
}

export async function runFilm(options = {}) {
  return withFilmOperationLock(options, runFilmUnlocked);
}

async function authorizeFilmPostAssets({ plan }, operations) {
  const assets = localPostProductionAssets(plan.executionPlan?.spec);
  if (!assets.length) return [];
  if (typeof operations.authorizeLocalAssets !== "function") throw new Error("Logo exige --asset-context antes de gerar mídia.");
  const authorized = await operations.authorizeLocalAssets({ rootScopeId: plan.executionPlan.spec.source.scope.rootScopeId, assets });
  for (const asset of assets) if (authorized.filter(entry => entry.assetId === asset.id && entry.file && entry.evidence?.itemHash).length !== 1) throw new Error("Logo sem autorização local vigente.");
  return authorized;
}

async function authorizeFilmSfx({ plan, spec }, operations) {
  await authorizeFilmPostAssets({ plan }, operations);
  await authorizeFilmHtmlAssets({ plan }, operations);
  const reusePolicy = plan.executionPlan?.spec?.reuse?.policy ?? "off";
  if (reusePolicy === "require-approved" && plan.executionPlan.nodes.some((node) => node.id.startsWith("motion:") || node.id === "music-fit" || node.id === "audio-mix" || node.id === "delivery") && typeof operations.reuseApprovedArtifact !== "function") throw new Error("Reuso obrigatório de artefato local exige asset-context.reuse antes de gerar mídia.");
  if (reusePolicy !== "off" && operations.reuseApprovedArtifact?.rootScopeId != null && operations.reuseApprovedArtifact.rootScopeId !== plan.executionPlan.spec.source?.scope?.rootScopeId) throw new Error("Contexto de reuso diverge do root da produção.");
  if (!spec.audio.sfx?.cues.length) return [];
  const assets = localSfxAssets(plan.executionPlan?.spec);
  if (!assets.length || executionTimelineDurationSeconds(plan.executionPlan) == null) throw new Error("SFX exige assets e duração congelados no plano canônico.");
  const timeline = plan.executionPlan.timeline;
  if (spec.audio.sfx.cues.some((cue) => cue.atFrame >= timeline.durationFrames)) throw new Error("Cue SFX fora da timeline congelada.");
  if (typeof operations.authorizeLocalAssets !== "function") throw new Error("SFX exige --asset-context com o root e aliases dos assets governados; nenhum provider foi autorizado por essa ausência.");
  const authorized = await operations.authorizeLocalAssets({ rootScopeId: plan.executionPlan.spec.source.scope.rootScopeId, assets });
  return spec.audio.sfx.cues.map((cue) => {
    const entry = authorized.find((asset) => asset.assetId === cue.assetId);
    if (!entry?.file || !entry.evidence) throw new Error("Autorização local não resolveu o asset SFX.");
    return { file: entry.file, role: "sfx", cueId: cue.id, assetId: cue.assetId,
      atSeconds: cue.atFrame * timeline.timeBase.numerator / timeline.timeBase.denominator,
      gainDb: cue.gainDb + spec.audio.sfxGainDb, authorization: entry.evidence };
  });
}

async function authorizeFilmHtmlAssets({ plan }, operations) {
  const assets = localHtmlAssets(plan.executionPlan?.spec);
  if (!assets.length) return [];
  if (typeof operations.authorizeLocalAssets !== "function") throw new Error("HTML exige --asset-context antes de gerar mídia.");
  const authorized = await operations.authorizeLocalAssets({ rootScopeId: plan.executionPlan.spec.source.scope.rootScopeId, assets });
  for (const asset of assets) if (authorized.filter(entry => entry.assetId === asset.id && entry.file && entry.evidence?.itemHash).length !== 1) throw new Error("HTML sem autorização local vigente.");
  return authorized;
}

// Read-only intake for CLI callers, before loading provider sessions. Runtime
// repeats the same validation under its production lock immediately before use.
export async function preflightFilmLocalAssets({ stateFile, operations = {} } = {}) {
  const context = await loadContext(stateFile);
  if (context.state.status !== "delivered") await authorizeFilmSfx(context, operations);
}

async function runFilmUnlocked({
  stateFile,
  confirmFingerprint = null,
  allowConceptPilot = false,
  authorizationSource = "cli",
  authorizationActor = "local-human",
  endpoint,
  operations = {},
  resourceBroker = null,
} = {}) {
  const context = await loadContext(stateFile);
  const { state, plan, spec, files } = context;
  if (spec.music && !spec.narration && executionTimelineDurationSeconds(plan.executionPlan) == null) throw new Error("Trilha sem narração exige uma timeline canônica com duração congelada antes da geração; use compile/plan com duração por cena.");
  const selectedOperations = { ...defaultOperations(), ...operations };
  await authorizeFilmSfx(context, selectedOperations);
  const canonical = canonicalExecutionOperations({
    plan,
    files,
    operations: selectedOperations,
    confirmFingerprint,
    allowConceptPilot,
    authorizationSource,
    authorizationActor,
    resourceBroker,
  });
  const op = canonical.operations;
  const receiptMetadata = receiptContextMetadata(spec);
  for (const [name, entry] of Object.entries(state.stages)) {
    if (name === "tts" && spec.narration?.provider === "omni" && op.videoAdapter.canResumePhases && ["running", "ambiguous", "attention_required"].includes(entry.status)) {
      // A fachada reinicia a coordenação, não os efeitos: cada bloco será
      // conferido ou reconciliado pelo nó e tentativa originais no kernel.
      entry.status = "planned";
      event(state, "stage_reconciliation_planned", { stage: name, authority: "execution-journal" });
      await saveState(state);
      continue;
    }
    if (["running", "ambiguous", "attention_required"].includes(entry.status)) await recoverOrRejectStage(state, name);
  }
  const workByStage = {
    "tts": async () => {
      if (spec.narration?.provider === "google-vids" && spec.narration.speakerMode === "multi-voice" && state.stages.tts.status !== "completed") {
        state.stages.tts.receiptFile = path.join(files.receipts, "narration-align.receipt.json");
        let aligned = null;
        await executeStage({
          state,
          name: "tts",
          run: async () => {
            const voiceBySpeaker = new Map((spec.narration.speakers ?? []).map((speaker) => [speaker.id, speaker.voice]));
            const generatedBlocks = [];
            for (const block of spec.narration.blocks) {
              const outputFile = path.join(spec.root, "audio", `narration-${block.id}.wav`);
              const generated = await op.generateTts({
                ...spec.narration,
                text: block.text,
                voice: voiceBySpeaker.get(block.speakerId) ?? block.voice ?? spec.narration.voice,
                outputFile,
                receiptFile: `${outputFile}.receipt.json`,
                executionNodeId: `voice:${block.id}`,
                metadata: { ...receiptMetadata, narrationBlockId: block.id, speakerId: block.speakerId ?? null },
              });
              const receipt = await readVerifiedReceipt(generated.receiptFile);
              generatedBlocks.push({ ...block, file: generated.file, receiptId: receipt.id });
            }
            aligned = await op.alignNarrationBlocks({
              blocks: generatedBlocks,
              masterFile: files.voiceFile,
              wordsFile: path.join(path.dirname(files.voiceFile), "palavras-master.json"),
              spansFile: path.join(path.dirname(files.voiceFile), "spans.json"),
              receiptFile: state.stages.tts.receiptFile,
              parentReceipts: generatedBlocks.map((block) => block.receiptId),
            });
            return { ...aligned, file: aligned.masterFile ?? aligned.file ?? files.voiceFile, receiptFile: aligned.receiptFile ?? state.stages.tts.receiptFile };
          },
        });
        state.stages.tts.alignment = { status: aligned?.status ?? "pass", wordsFile: aligned?.wordsFile ?? null, spansFile: aligned?.spansFile ?? null, receiptFile: aligned?.receiptFile ?? state.stages.tts.receiptFile };
        await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "voice-master", execute: async () => ({ file: files.voiceFile, receiptFile: state.stages.tts.receiptFile }) });
      } else if (spec.narration?.provider === "omni" && state.stages.tts.status !== "completed") {
        state.stages.tts.receiptFile = path.join(files.receipts, "narration-align.receipt.json");
        let aligned = null;
        await executeStage({
          state,
          name: "tts",
          run: async () => {
            const pool = await runProductionPool({ parallel: 3, haltAfterConsecutiveFailures: 3, jobs: spec.narration.blocks.map((block) => ({ id: block.id, run: async ({ waitWithoutWorker }) => {
              const outputFile = path.join(spec.root, "audio", `narration-${block.id}.mp4`);
              const generated = await op.videoAdapter.generate({
                waitWithoutWorker,
                resumePhase: "auto",
                prompt: `Narração em português brasileiro, voz ${block.voice ?? spec.narration.voice}. Fale literalmente: ${block.text}`,
                outputFile,
                images: [],
                inputRoles: [],
                executionInputReceipts: [],
                task: "text_to_video",
                aspectRatio: spec.aspect,
                durationSeconds: block.seconds ?? null,
                metadata: { ...receiptMetadata, mode: "studio", sceneId: `narration:${block.id}`, narrationBlockId: block.id },
              });
              const receipt = await readVerifiedReceipt(generated.receiptFile);
              return { ...block, file: generated.file, receiptId: receipt.id };
            } })) });
            if (pool.fulfilled !== spec.narration.blocks.length) {
              const failed = pool.results.find((entry) => entry.status !== "fulfilled");
              throw failed.cause ?? new Error(`Narração ${failed.id} não concluída: ${failed.error ?? failed.reason}`);
            }
            const generatedBlocks = pool.results.map((entry) => entry.value);
            aligned = await op.alignNarrationBlocks({
              blocks: generatedBlocks,
              masterFile: files.voiceFile,
              wordsFile: path.join(path.dirname(files.voiceFile), "palavras-master.json"),
              spansFile: path.join(path.dirname(files.voiceFile), "spans.json"),
              receiptFile: state.stages.tts.receiptFile,
              parentReceipts: generatedBlocks.map((block) => block.receiptId).filter(Boolean),
            });
            return { ...aligned, file: aligned.masterFile ?? aligned.file ?? files.voiceFile, receiptFile: aligned.receiptFile ?? state.stages.tts.receiptFile };
          },
        });
        state.stages.tts.alignment = { status: aligned?.status ?? "pass", wordsFile: aligned?.wordsFile ?? null, spansFile: aligned?.spansFile ?? null, receiptFile: aligned?.receiptFile ?? state.stages.tts.receiptFile };
        await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "voice-master", execute: async () => ({ file: files.voiceFile, receiptFile: state.stages.tts.receiptFile }) });
      } else if (spec.narration && state.stages.tts.status !== "completed") {
        state.stages.tts.receiptFile = `${files.voiceFile}.receipt.json`;
        await executeStage({
          state,
          name: "tts",
          run: () => op.generateTts({ ...spec.narration, outputFile: files.voiceFile, receiptFile: state.stages.tts.receiptFile, metadata: receiptMetadata }),
        });
      }
    },
    "voice-probe": async () => {
      if (spec.narration) {
        const voiceProbe = await op.probeMedia(files.voiceFile);
        if (!voiceProbe.audio || !Number.isFinite(Number(voiceProbe.duration)) || Number(voiceProbe.duration) <= 0) throw new Error("A voz mestre não possui duração de áudio válida.");
        state.stages.tts.probe = voiceProbe;
        event(state, "voice_master_probed", { duration: voiceProbe.duration });
        await saveState(state);
        assertNarrationFitsTimeline(voiceProbe, plan.executionPlan);
        await executeCanonicalLocalNode({
          kernel: canonical.kernel,
          executionPlan: plan.executionPlan,
          nodeId: "voice-probe",
          execute: async () => ({ probe: voiceProbe }),
        });
      }
    },
    "music": async () => {
      if (spec.music && state.stages.music.status !== "completed") {
        state.stages.music.receiptFile = `${files.musicFile}.receipt.json`;
        await executeStage({
          state,
          name: "music",
          run: () => op.generateMusic({ ...spec.music, outputFile: files.musicFile, receiptFile: state.stages.music.receiptFile, metadata: receiptMetadata }),
        });
      }
    },
    "musicFit": async () => {
      if (spec.music) {
        const timelineDuration = executionTimelineDurationSeconds(plan.executionPlan);
        const musicTargetDuration = timelineDuration ?? Number(state.stages.tts.probe?.duration);
        if (!Number.isFinite(musicTargetDuration) || musicTargetDuration <= 0) throw new Error("Não foi possível derivar a duração da timeline para musicFit.");
        const fitOptions = { sourceFile: files.musicFile, targetDuration: musicTargetDuration, outputFile: files.musicBedFile, receiptFile: path.join(files.receipts, "music-fit.receipt.json"), parentReceipts: parentIds(state, ["tts", "music"]), metadata: { ...receiptMetadata, targetSource: timelineDuration == null ? "voice-probe-fallback" : "locked-execution-timeline" } };
        const reuse = localArtifactReuse({ plan, operations: op, options: fitOptions, recipeFor: musicFitRecipe, artifactRole: "music-bed" });
        state.stages.musicFit.status = state.stages.musicFit.status === "blocked" ? "planned" : state.stages.musicFit.status;
        await executeStage({
          state,
          name: "musicFit",
          paid: false,
          run: () => executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "music-fit", reuse, execute: () => op.fitMusicToDuration(fitOptions) }),
        });
        await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "music-fit", reuse, execute: async () => ({ file: files.musicBedFile, receiptFile: state.stages.musicFit.receiptFile }) });
      }
    },
    "alignment": async () => {
      if (spec.narration && !state.stages.tts.alignment) {
        const alignmentDir = path.dirname(files.voiceFile);
        const alignment = await op.alignNarrationBlocks({
          // Google Vids single-voice produces one continuous WAV, even when
          // the approved script has several editorial blocks.
          blocks: [{ id: spec.narration.blocks.length === 1 ? spec.narration.blocks[0].id : "google-vids-master", text: spec.narration.text, audioFile: files.voiceFile }],
          outDir: alignmentDir,
          masterFile: files.voiceFile,
          preserveSingleAudioMaster: true,
          whisperBackend: spec.alignment?.backend,
          language: spec.alignment?.language,
          wordsFile: path.join(alignmentDir, "palavras-master.json"),
          spansFile: path.join(alignmentDir, "spans.json"),
          receiptFile: path.join(files.receipts, "narration-align.receipt.json"),
          parentReceipts: parentIds(state, ["tts"]),
        });
        state.stages.tts.alignment = {
          status: alignment.status ?? "pass",
          wordsFile: alignment.wordsFile ?? null,
          spansFile: alignment.spansFile ?? null,
          receiptFile: alignment.receiptFile ?? null,
        };
        event(state, "narration_aligned", { blocks: spec.narration.blocks.length || 1, status: state.stages.tts.alignment.status });
        await saveState(state);
      }
      if (state.stages.tts.alignment?.status === "blocked") throw new Error("Alinhamento da narração bloqueado; WAV original preservado para revisão.");
      await executeCanonicalLocalNode({
        kernel: canonical.kernel,
        executionPlan: plan.executionPlan,
        nodeId: "alignment",
        execute: async () => ({ timelineFingerprint: plan.executionPlan.timeline.fingerprint }),
      });
    },
    "timeline-lock": async () => {
      await executeCanonicalLocalNode({
        kernel: canonical.kernel,
        executionPlan: plan.executionPlan,
        nodeId: "timeline-lock",
        execute: async () => ({ timelineFingerprint: plan.executionPlan.timeline.fingerprint }),
      });
    },
    "draft": async () => {
      if (state.stages.draft.status !== "completed") {
        await executeStage({
          state,
          name: "draft",
          run: async () => {
            const draft = await op.draftScenes({ spec: { ...spec.draft, outRoot: path.dirname(spec.root) }, stateFile: files.draftFile, imageAdapter: op.imageAdapter, receiptMetadata });
            return { file: files.draftFile, receiptFile: null, draft };
          },
        });
      }
    },
    "animatic": async () => {
      const draft = await readDraftState(files.draftFile);
      for (const scene of draft.scenes) {
        const keyframeNode = plan.executionPlan?.nodes?.find(
          (node) => node.id === `keyframe:${scene.id}`,
        );
        if (keyframeNode?.costClass === "local") {
          await executeCanonicalLocalNode({
            kernel: canonical.kernel,
            executionPlan: plan.executionPlan,
            nodeId: keyframeNode.id,
            execute: async () => ({ file: scene.keyframeFile, receiptFile: scene.keyframeReceipt }),
          });
        }
      }
      await executeCanonicalLocalNode({
        kernel: canonical.kernel,
        executionPlan: plan.executionPlan,
        nodeId: "animatic",
        execute: async () => ({ file: files.draftFile }),
      });
    },
  };
  // O scheduler libera apenas dependências concluídas. As operações continuam
  // atravessando o mesmo kernel e journal, inclusive na retomada.
  const graph = buildFilmGraph(spec, { executionPlan: plan.executionPlan });
  let graphError = null;
  const graphRun = await runProductionGraph({
    graph,
    execute: async (node) => {
      try { return await workByStage[node.id](); }
      catch (error) { graphError ??= error; throw error; }
    },
  });
  event(state, "run_graph_settled", {
    status: graphRun.status,
    completed: graphRun.completed,
    failed: graphRun.failed,
    blocked: graphRun.blocked,
  });
  await saveState(state);
  // O erro só sobe depois que os irmãos já iniciados encerraram e gravaram
  // seus resultados. Assim uma falha não abandona trabalho em andamento.
  if (graphError) throw graphError;
  if (graphRun.status !== "completed") throw new Error(`Grafo do filme não concluiu: ${graphRun.status}.`);
  const draft = await readDraftState(files.draftFile);
  state.stages.draft.status = "completed";
  state.stages.video.status = draft.status === "delivered" ? "completed" : "awaiting_approval";
  state.stages.video.blockedBy = draft.status === "delivered" ? null : "human_approval";
  event(state, "human_approval_required", { draftFile: files.draftFile });
  refreshFilmStatus(state);
  await saveState(state);
  return context;
}

async function currentVideoInput(state, files) {
  if (state.stages.captions.status === "completed") return files.captionedFile;
  if (state.stages.audioMux.status === "completed") return files.masteredFile;
  return files.assembledFile;
}

/**
 * Retoma o filme aprovado: anima, monta e entrega os artefatos finais.
 * @param {{ stateFile: string, confirmFingerprint?: unknown, allowConceptPilot?: boolean, authorizationSource?: string, authorizationActor?: string, endpoint?: string | null, operations?: object }} options
 * @returns {Promise<{ state: { stateFile: string }, plan: object, spec: object, files: object }>}
 */
export async function resumeFilm(options = {}) {
  return withFilmOperationLock(options, resumeFilmUnlocked);
}

// Human replacement is a separate recorded decision, never evidence that the
// earlier provider call failed or did not occur. The frozen plan stays intact.
async function applyFilmHumanRetry(context, decision, confirmHuman, resourceBroker) {
  if (!decision) return;
  if (confirmHuman !== true) throw new Error("Substituição humana exige --confirm-human true.");
  const { plan, state, files } = context;
  if (!plan.executionPlan || typeof resourceBroker?.authorizeRemoteReplacement !== "function") throw new Error("Substituição humana exige plano canônico e broker compatível.");
  const dbFile = path.join(path.dirname(files.stateFile), "execution-journal.sqlite");
  const prepared = prepareHumanRetryAuthorization({ dbFile, plan: plan.executionPlan, decision, confirmHuman });
  const normalized = prepared.decision;
  const draft = await readDraftState(files.draftFile);
  const draftAlreadyApplied = draft.humanReplacementDecisions?.some((entry) => entry.decisionId === normalized.decisionId) === true;
  const productionId = plan.executionPlan.spec.productionContextBinding?.productionId ?? plan.executionPlan.spec.name ?? "production";
  const clientId = plan.executionPlan.spec.productionContextBinding?.rootScopeId ?? "local";
  const remotes = normalized.attempts.map(({ nodeId, attemptId }) => {
    if (!nodeId.startsWith("video:")) throw new Error("A retomada humana aceita somente cenas de vídeo.");
    const scene = draft.scenes.find((entry) => `video:${entry.id}` === nodeId);
    const remote = resourceBroker.readRemoteOperation(`omni:${attemptId}`);
    if (!scene || !remote || remote.attemptId !== attemptId || remote.productionId !== productionId || remote.clientId !== clientId) throw new Error(`Reserva remota divergente para ${nodeId}.`);
    if (remote.state !== "submitting" || remote.handle || remote.terminalProof) throw new Error(`Reserva ${nodeId} possui estado conhecido; reconcilie o resultado.`);
    if (!draftAlreadyApplied && (scene.status !== "ambiguous" || scene.attemptId !== attemptId)) throw new Error(`Draft diverge da tentativa ambígua ${nodeId}.`);
    return { nodeId, attemptId, sceneId: scene.id, remote };
  });
  // Six scenes may have acquired a draft nonce before the old run stopped,
  // without ever reaching the journal/provider. Bind their exact old nonces.
  const unsubmitted = decision.unsubmittedScenes ?? [];
  if (!Array.isArray(unsubmitted)) throw new Error("unsubmittedScenes deve ser uma lista.");
  if (!draftAlreadyApplied) {
    for (const { sceneId, attemptId } of unsubmitted) {
      const node = prepared.snapshot.nodes[`video:${sceneId}`];
      const scene = draft.scenes.find((entry) => entry.id === sceneId);
      if (!scene || scene.status !== "generating" || scene.attemptId !== attemptId || node?.attemptId || Number(node?.attempts ?? 0) !== 0 || resourceBroker.readRemoteOperation(`omni:${attemptId}`)) throw new Error(`Cena ${sceneId} não comprova ausência de submissão.`);
    }
    for (const { sceneId } of [...remotes, ...unsubmitted]) {
      const scene = draft.scenes.find((entry) => entry.id === sceneId);
      if (scene.providerHandle || scene.fileId || scene.interactionId || await pathExists(scene.videoFile) || await pathExists(scene.videoReceipt)) throw new Error(`Cena ${sceneId} exige reconciliação do resultado já existente.`);
    }
  }
  const administrativeReleases = remotes.map(({ remote }) => resourceBroker.authorizeRemoteReplacement({
    operationId: remote.operationId, attemptId: remote.attemptId,
    productionId, clientId, requestFingerprint: remote.requestFingerprint,
    decisionId: normalized.decisionId, actor: normalized.actor, reason: normalized.reason,
    confirmHuman: true, acknowledgeUnknownEffect: true,
  }));
  registerHumanRetryAuthorization({ dbFile, plan: plan.executionPlan, decision, confirmHuman, administrativeReleases });
  await authorizeDraftHumanReplacements({
    draftFile: files.draftFile, decisionId: normalized.decisionId,
    replacements: remotes.map(({ sceneId, attemptId }) => ({ sceneId, attemptId })),
    unsubmittedSceneIds: unsubmitted.map((entry) => entry.sceneId),
    expectedUnsubmittedAttemptIds: Object.fromEntries(unsubmitted.map((entry) => [entry.sceneId, entry.attemptId])),
  });
  if (!state.history.some((entry) => entry.event === "human_retry_authorized" && entry.decisionId === normalized.decisionId)) {
    event(state, "human_retry_authorized", { decisionId: normalized.decisionId, decisionHash: prepared.decisionHash, scenes: remotes.map((entry) => entry.sceneId), oldEffects: "unknown", administrativeReleaseHashes: administrativeReleases.map((entry) => entry.hash) });
    state.stages.video.status = "planned";
    state.stages.video.error = null;
    state.stages.video.blockedBy = null;
    refreshFilmStatus(state);
    await saveState(state);
  }
}

async function resumeFilmUnlocked({
  stateFile,
  confirmFingerprint = null,
  allowConceptPilot = false,
  authorizationSource = "cli",
  authorizationActor = "local-human",
  endpoint,
  operations = {},
  resourceBroker = null,
  humanRetryDecision = null,
  confirmHumanRetry = false,
} = {}) {
  let context = await loadContext(stateFile);
  await applyFilmHumanRetry(context, humanRetryDecision, confirmHumanRetry, resourceBroker);
  if (context.state.status !== "delivered") await authorizeFilmSfx(context, operations);
  if (resourceBroker && context.spec.narration?.provider === "omni" && context.state.stages.tts.status !== "completed" &&
      ["generate", "submit", "observe", "collect"].every((name) => typeof operations.videoAdapter?.[name] === "function")) {
    await runFilmUnlocked({ stateFile, confirmFingerprint, allowConceptPilot, authorizationSource, authorizationActor, endpoint, operations, resourceBroker });
    context = await loadContext(stateFile);
  }
  const { state, plan, spec, files } = context;
  if (state.status !== "delivered") {
    assertNarrationFitsTimeline(state.stages.tts.probe, plan.executionPlan);
    if (state.stages.tts.alignment?.status === "blocked") throw new Error("Alinhamento da narração bloqueado; WAV original preservado para revisão.");
  }
  const selectedOperations = { ...defaultOperations(), ...operations };
  const canonical = canonicalExecutionOperations({
    plan,
    files,
    operations: selectedOperations,
    confirmFingerprint,
    allowConceptPilot,
    authorizationSource,
    authorizationActor,
    resourceBroker,
  });
  const op = canonical.operations;
  const receiptMetadata = receiptContextMetadata(spec);
  if (state.status === "delivered") return context;
  const variantNodes = plan.executionPlan?.nodes?.filter((node) => node.kind === "variant") ?? [];
  state.stages.variants ??= stage(variantNodes.length ? "blocked" : "skipped", { outputFile: null, paid: false, blockedBy: "delivery", aggregate: true });
  const completedVariantNodes = new Set(Object.entries(state.journalProjection?.nodes ?? {}).filter(([, node]) => node.status === "completed").map(([id]) => id));
  if (state.status === "delivered" && variantNodes.every((node) => completedVariantNodes.has(node.id))) return context;
  for (const [name, entry] of Object.entries(state.stages)) {
    if (name === "video" && op.videoAdapter.canResumePhases) continue;
    if (["running", "ambiguous", "attention_required"].includes(entry.status)) await recoverOrRejectStage(state, name);
  }
  let draft = await readDraftState(files.draftFile);
  if (draft.status === "awaiting_approval") {
    if (spec.workflow?.authorizationMode !== "production-once") {
      throw new Error(`O filme aguarda aprovação humana. Execute approve --draft "${files.draftFile}" antes de resume.`);
    }
    event(state, "production_once_auto_approved", { draftFile: files.draftFile });
    await saveState(state);
    await approveDraft({ draftFile: files.draftFile });
    draft = await readDraftState(files.draftFile);
  }
  if (canonical.journalFile && draft.status !== "delivered") {
    const approval = approvedDraftTarget(draft);
    const workflowAuthorization = spec.workflow?.authorizationMode === "production-once" && spec.workflow?.humanReview === false;
    recordExecutionNodeApproval({
      dbFile: canonical.journalFile,
      nodeId: "animatic-approval",
      targetHash: approval.targetHash,
      actor: authorizationActor,
      actorKind: workflowAuthorization ? "automation" : "human",
      source: workflowAuthorization ? "workflow-production-once" : "approve-command",
      approvedAt: approval.approvedAt,
    });
  }
  if (draft.status !== "delivered") {
    state.stages.video.status = "planned";
    await executeStage({
      state,
      name: "video",
      run: async () => {
        const animated = await op.animateDraft({ draftFile: files.draftFile, videoAdapter: op.videoAdapter, budget: spec.budget.omni, receiptMetadata, ...(humanRetryDecision ? { parallel: 1 } : {}) });
        return { file: files.draftFile, receiptFile: null, draft: animated };
      },
    });
  } else {
    state.stages.video.status = "completed";
    state.stages.video.completedAt ??= new Date().toISOString();
    await saveState(state);
  }
  const deliveredDraft = await readDraftState(files.draftFile);
  const sceneReceiptIds = [];
  for (const scene of deliveredDraft.scenes) {
    const receipt = await readVerifiedReceipt(scene.videoReceipt);
    for (const artifact of receipt.artifacts ?? []) {
      const validation = await verifyArtifact(artifact);
      if (!validation.valid) throw new Error(`Cena ${scene.id} diverge do recibo: ${validation.errors.join(" ")}`);
    }
    if (receipt.id) sceneReceiptIds.push(receipt.id);
  }
  const assemblySceneFiles = [];
  for (const scene of deliveredDraft.scenes) {
    let visualFile = scene.videoFile;
    const graphics = plan.executionPlan?.spec?.scenes.find(entry => entry.id === scene.id)?.graphics;
    if (graphics?.renderer === "html-canvas@1") {
      const entries = await authorizeFilmHtmlAssets({ plan }, op);
      const document = entries.find(entry => entry.assetId === graphics.documentAssetId);
      const outputFile = path.join(spec.root, "videos-soltos", `${scene.id}-html.mp4`);
      const videoReceipt = await readVerifiedReceipt(scene.videoReceipt);
      const media = await op.probeMedia(scene.videoFile);
      const frames = spec.assembly.sceneFrameTargets?.find(entry => entry.sceneId === scene.id)?.plannedFrames;
      const html = await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: `html-motion:${scene.id}`,
        execute: () => op.renderHtmlMotion({ documentFile: document.file, videoFile: scene.videoFile, onScreenText: scene.expectedText ?? "", outputFile, receiptFile: `${outputFile}.receipt.json`, recoverExisting: true,
          scene: { id: scene.id, width: media.video.width, height: media.video.height, fps: spec.assembly.fps, durationSeconds: frames ? frames / spec.assembly.fps : scene.expectedDuration, aspect: spec.aspect },
          metadataDirectory: path.join(spec.root, "metadados", "html", scene.id), parentReceipts: [videoReceipt.id], metadata: { ...receiptMetadata, documentAuthorization: document.evidence },
          beforeRender: async () => {
            const refreshed = (await authorizeFilmHtmlAssets({ plan }, op)).find(entry => entry.assetId === graphics.documentAssetId);
            if (refreshed.file !== document.file || refreshed.evidence.itemHash !== document.evidence.itemHash) throw new Error("Documento HTML mudou durante a execução.");
          },
        }) });
      visualFile = html?.file ?? outputFile;
      if (html?.receipt?.id) sceneReceiptIds.push(html.receipt.id);
    } else if (scene.textRendering === "local-gc" && scene.expectedText) {
      const outputFile = path.join(spec.root, "videos-soltos", `${scene.id}-motion.mp4`);
      const videoReceipt = scene.videoReceipt ? await readVerifiedReceipt(scene.videoReceipt) : null;
      const motionOptions = {
        videoFile: scene.videoFile,
        cards: [{ text: scene.expectedText, start: 0, end: scene.expectedDuration ?? Math.max(1, Number(spec.assembly.sceneFrameTargets?.find((entry) => entry.sceneId === scene.id)?.plannedFrames ?? spec.assembly.fps) / spec.assembly.fps), position: "lower" }],
        outputFile, receiptFile: `${outputFile}.receipt.json`, aspect: spec.aspect,
        timelineFingerprint: plan.executionPlan?.timeline?.fingerprint ?? null,
        parentReceipts: videoReceipt?.id ? [videoReceipt.id] : [], metadata: receiptMetadata,
      };
      const motion = await executeCanonicalLocalNode({
        kernel: canonical.kernel,
        executionPlan: plan.executionPlan,
        nodeId: `motion:${scene.id}`,
        reuse: localArtifactReuse({ plan, operations: op, options: motionOptions, recipeFor: motionGraphicsRecipe, artifactRole: "motion-master" }),
        execute: () => op.renderMotionGraphics(motionOptions),
      });
      visualFile = motion?.file ?? outputFile;
      if (motion?.receipt?.id) sceneReceiptIds.push(motion.receipt.id);
    }
    const frameTarget = spec.assembly.sceneFrameTargets?.find((entry) => entry.sceneId === scene.id) ?? null;
    await executeCanonicalLocalNode({
      kernel: canonical.kernel,
      executionPlan: plan.executionPlan,
      nodeId: `clip-duration:${scene.id}`,
      execute: async () => frameTarget == null ? ({ file: visualFile }) : ({ file: visualFile, timing: await op.probeTiming({ mediaFile: visualFile, expectedFrames: frameTarget.plannedFrames }) }),
    });
    assemblySceneFiles.push(visualFile);
  }
  if (spec.qa) {
    state.stages.sceneQa.status = state.stages.sceneQa.status === "blocked" ? "planned" : state.stages.sceneQa.status;
    await executeStage({
      state,
      name: "sceneQa",
      paid: Boolean(spec.qa.semanticScenes),
      run: async () => {
        const localQaNodes = plan.executionPlan?.nodes?.filter((node) => node.kind === "qa-scene" && node.costClass === "local") ?? [];
        const runSceneQa = async () => {
        const checked = await op.qaDraftScenes({ draftFile: files.draftFile, qa: spec.qa, runQa: op.runQa, throwOnBlocked: false, receiptMetadata });
        return { file: files.draftFile, receiptFile: null, draft: checked };
        };
        const result = localQaNodes.length
          ? await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: localQaNodes[0].id, execute: runSceneQa })
          : await runSceneQa();
        for (const node of localQaNodes.slice(1)) {
          await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: node.id, execute: async () => ({ file: files.draftFile }) });
        }
        return result;
      },
    });
    const checkedDraft = await readDraftState(files.draftFile);
    state.stages.sceneQa.gate = checkedDraft.sceneQaSummary ?? { status: "passed", checkedScenes: checkedDraft.scenes.length, blocked: [] };
    event(state, "scene_qa_gate_evaluated", { status: state.stages.sceneQa.gate.status, blockedScenes: state.stages.sceneQa.gate.blocked?.map((entry) => entry.scene) ?? [] });
    refreshFilmStatus(state);
    await saveState(state);
    if (state.stages.sceneQa.gate.status === "blocked") {
      throw new Error(`QA de cenas bloqueou a montagem: ${state.stages.sceneQa.gate.blocked.map((entry) => entry.scene).join(", ")}.`);
    }
  }
  const hasAudio = Boolean(spec.narration || spec.music || spec.audio.ambienceFile || spec.audio.sfx?.cues.length || spec.audio.sceneAudioGainDb != null);
  const separateMix = hasAudio && (!plan.executionPlan || plan.executionPlan.nodes.some((node) => node.id === "audio-mix"));
  const mixStage = async ({ ownNode = false } = {}) => {
    await authorizeFilmSfx(context, selectedOperations);
    state.stages.audioMix.status = state.stages.audioMix.status === "blocked" ? "planned" : state.stages.audioMix.status;
    const sfxInputs = await authorizeFilmSfx(context, selectedOperations);
    if (spec.audio.sceneAudioGainDb != null) sfxInputs.push({ file: files.assembledFile, role: "scene-audio", atSeconds: 0, gainDb: spec.audio.sceneAudioGainDb });
    const mixOptions = { voiceFile: spec.narration ? files.voiceFile : null, musicFile: spec.music ? files.musicBedFile : null, ambienceFile: spec.audio.ambienceFile, outputFile: files.audioMasterFile, receiptFile: path.join(files.receipts, "audio-mix.receipt.json"), ...spec.audio,
        ...(sfxInputs.length ? { sfxInputs, durationSeconds: executionTimelineDurationSeconds(plan.executionPlan), beforeMix: async () => {
          const refreshed = await authorizeFilmSfx(context, selectedOperations);
          if (refreshed.some((cue, index) => cue.file !== sfxInputs[index].file)) throw new Error("Caminho do asset mudou durante a mixagem.");
          refreshed.forEach((cue, index) => { sfxInputs[index].authorization = cue.authorization; });
        } } : {}),
        parentReceipts: parentIds(state, ["tts", spec.music ? "musicFit" : "music", ...(spec.audio.sceneAudioGainDb != null ? ["assembly"] : [])]), metadata: receiptMetadata };
    const reuse = localArtifactReuse({ plan, operations: op, options: mixOptions, recipeFor: audioMixRecipe, artifactRole: "audio-master" });
    const result = await executeStage({ state, name: "audioMix", paid: false, run: () => ownNode
      ? executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "audio-mix", reuse, execute: () => op.mixAudio(mixOptions) })
      : op.mixAudio(mixOptions) });
    if (ownNode) await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "audio-mix", reuse, execute: async () => ({ file: files.audioMasterFile, receiptFile: state.stages.audioMix.receiptFile }) });
    return result;
  };
  const workByStage = {
    assembly: async () => {
      state.stages.assembly.status = state.stages.assembly.status === "blocked" ? "planned" : state.stages.assembly.status;
      await executeStage({
        state,
        name: "assembly",
        paid: false,
        run: () => {
          const assemble = () => op.assembleFilm({
            sceneFiles: assemblySceneFiles,
            outputFile: files.assembledFile,
            receiptFile: path.join(files.receipts, "assembly.receipt.json"),
            ...spec.assembly,
            preserveAudio: spec.audio.sceneAudioGainDb != null,
            aspect: spec.aspect,
            parentReceipts: sceneReceiptIds,
            metadata: receiptMetadata,
            attestationDir: path.join(spec.root, "metadados", "clip-duration-attestations"),
          });
          return executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "assembly", execute: assemble });
        },
      });
    },
    audioMix: () => mixStage({ ownNode: true }),
    audioMux: async () => {
      if (hasAudio) {
        const buildMaster = async () => {
          await authorizeFilmSfx(context, selectedOperations);
          // Planos históricos mantêm a mixagem dentro do nó master congelado.
          if (!separateMix) await mixStage();
          state.stages.audioMux.status = state.stages.audioMux.status === "blocked" ? "planned" : state.stages.audioMux.status;
          await executeStage({ state, name: "audioMux", paid: false, run: () => op.muxMasterAudio({ videoFile: files.assembledFile, audioFile: files.audioMasterFile, outputFile: files.masteredFile, receiptFile: path.join(files.receipts, "audio-mux.receipt.json"), parentReceipts: parentIds(state, ["assembly", "audioMix"]), metadata: receiptMetadata }) });
          return { file: files.masteredFile, receiptFile: state.stages.audioMux.receiptFile };
        };
        await executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "master", execute: buildMaster });
      } else {
        await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "master", execute: async () => ({ file: files.assembledFile, receiptFile: state.stages.assembly.receiptFile }) });
      }
    },
  };
  let graphError = null;
  const graphRun = await runProductionGraph({
    graph: buildFilmGraph(spec, { phase: "resume", executionPlan: plan.executionPlan }),
    execute: async (node) => {
      try { return await workByStage[node.id](); }
      catch (error) { graphError ??= error; throw error; }
    },
  });
  event(state, "resume_graph_settled", { status: graphRun.status, completed: graphRun.completed, failed: graphRun.failed, blocked: graphRun.blocked });
  await saveState(state);
  if (graphError) throw graphError;
  if (graphRun.status !== "completed") throw new Error(`Grafo da retomada não concluiu: ${graphRun.status}.`);
  if (spec.captions) {
    const captionWordsFile = spec.captions.wordsFile ?? state.stages.tts.alignment?.wordsFile;
    if (!captionWordsFile) throw new Error("Legendas exigem wordsFile explícito ou resultado materializado do alinhamento da narração.");
    state.stages.captions.status = state.stages.captions.status === "blocked" ? "planned" : state.stages.captions.status;
    await executeStage({
      state,
      name: "captions",
      paid: false,
      run: () => executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "captions", execute: () => op.renderWordCaptions({
        videoFile: hasAudio ? files.masteredFile : files.assembledFile,
        wordsFile: captionWordsFile,
        scriptFile: spec.captions.scriptFile,
        outputFile: files.captionedFile,
        assFile: path.join(spec.root, "metadados", "captions.ass"),
        receiptFile: path.join(files.receipts, "captions.receipt.json"),
        parentReceipts: parentIds(state, [hasAudio ? "audioMux" : "assembly"]),
        aspect: spec.aspect,
        metadata: receiptMetadata,
      }) }),
    });
  }
  let masterInput = await currentVideoInput(state, files);
  const postOperations = validatePostProduction(spec.postProduction, plan.executionPlan?.timeline.durationFrames);
  if (postOperations.length) {
    state.stages.postProduction ??= stage("planned", { paid: false, aggregate: true });
    await executeStage({ state, name: "postProduction", run: async () => {
      let current = { file: masterInput, receiptFile: state.stages[spec.captions ? "captions" : hasAudio ? "audioMux" : "assembly"].receiptFile };
      state.postProduction ??= [];
      for (const [index, operation] of postOperations.entries()) {
        const nodeId = `post:${operation.id}`;
        const authorized = await authorizeFilmPostAssets(context, selectedOperations);
        const logo = authorized.find(entry => entry.assetId === operation.assetId) ?? null;
        const suffix = String(index + 1).padStart(3, "0");
        const parents = current.receiptFile ? [await receiptIdFromFile(current.receiptFile)].filter(Boolean) : [];
        const result = await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId,
          execute: () => op.applyFilmPostOperation({ inputFile: current.file, operation, logoFile: logo?.file ?? null, recoverExisting: true,
            expectedFrames: plan.executionPlan.timeline.durationFrames, fps: spec.assembly.fps,
            outputFile: path.join(spec.root, "videos-unidos", `post-${suffix}.mp4`), receiptFile: path.join(files.receipts, `post-${suffix}.receipt.json`),
            parentReceipts: parents, metadata: receiptMetadata, authorize: async () => {
              const fresh = (await authorizeFilmPostAssets(context, selectedOperations)).find(entry => entry.assetId === operation.assetId) ?? null;
              if (logo && fresh?.file !== logo.file) throw new Error("Caminho do logo mudou durante o uso.");
              return fresh?.evidence ?? null;
            } }) });
        if (!result?.file || !result.receiptFile) throw new Error(`Pós-produção sem resultado material: ${operation.id}.`);
        current = result;
        state.postProduction[index] = { id: operation.id, nodeId, file: result.file, receiptFile: result.receiptFile };
        await saveState(state);
      }
      return current;
    } });
    masterInput = state.stages.postProduction.outputFile;
    await authorizeFilmPostAssets(context, selectedOperations);
  }
  if (spec.qa) {
    state.stages.qa.status = state.stages.qa.status === "blocked" ? "planned" : state.stages.qa.status;
    const qaSourceStage = postOperations.length ? "postProduction" : spec.captions ? "captions" : hasAudio ? "audioMux" : "assembly";
    let qaResult = null;
    const expectedDurationSource = spec.qa.expectedDuration == null ? "assembled-probe" : "spec";
    const expectedDuration = spec.qa.expectedDuration ?? Number((await op.probeMedia(files.assembledFile)).duration);
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) throw new Error("Não foi possível derivar a duração esperada para o QA.");
    await executeStage({
      state,
      name: "qa",
      paid: Boolean(spec.qa.semantic),
      run: async () => executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "qa-master", execute: async () => {
        qaResult = await op.runQa({
        videoFile: masterInput,
        outputFile: files.qaFile,
        receiptFile: path.join(files.receipts, "qa.receipt.json"),
        ...spec.qa,
        // A lista explícita de requisitos pode descrever um master sem áudio.
        // Áudio planejado continua obrigatório mesmo sem a asserção redundante;
        // documentos anteriores sem requisitos conservam o gate histórico.
        requireAudio: hasAudio || !spec.qa.assertions.length || spec.qa.assertions.includes("audio-stream"),
        expectedDuration,
        sourceReceipts: state.stages[qaSourceStage].receiptFile ? [state.stages[qaSourceStage].receiptFile] : [],
        expectedParts: spec.draft.scenes.length,
        actualParts: deliveredDraft.scenes.length,
        parentReceipts: parentIds(state, [qaSourceStage]),
        metadata: receiptMetadata,
        });
        return qaResult;
      } }),
    });
    if (!qaResult) qaResult = { report: JSON.parse(await readFile(files.qaFile, "utf8")) };
    const reportFingerprint = operationFingerprint({ report: qaResult.report });
    const gateEvaluation = evaluateQaGate(qaResult.report, { mode: spec.qa.gate, blockingWarnings: spec.qa.blockingWarnings });
    const activeOverride = state.stages.qa.override?.reportFingerprint === reportFingerprint ? state.stages.qa.override : null;
    state.stages.qa.gate = {
      ...gateEvaluation,
      ...(gateEvaluation.status === "blocked" && activeOverride ? { status: "overridden", override: activeOverride } : {}),
      reportFingerprint,
      expectedDuration,
      expectedDurationSource,
    };
    event(state, "qa_gate_evaluated", { status: state.stages.qa.gate.status, blockingWarnings: state.stages.qa.gate.blockingWarnings });
    refreshFilmStatus(state);
    await saveState(state);
    if (state.stages.qa.gate.status === "blocked") {
      throw new Error(`QA bloqueou a entrega: ${state.stages.qa.gate.blockingWarnings.join(", ")}. Corrija os achados ou registre um override humano antes do delivery.`);
    }
  }
  if (spec.delivery) {
    await authorizeFilmPostAssets(context, selectedOperations);
    state.stages.delivery.status = state.stages.delivery.status === "blocked" ? "planned" : state.stages.delivery.status;
    const deliveryOptions = { inputFile: masterInput, outputFile: files.deliveryFile, receiptFile: path.join(files.receipts, "delivery.receipt.json"),
      profile: spec.delivery.profile, lut: spec.delivery.lut,
      parentReceipts: parentIds(state, [spec.qa ? "qa" : postOperations.length ? "postProduction" : spec.captions ? "captions" : hasAudio ? "audioMux" : "assembly"]), metadata: receiptMetadata };
    const reuse = localArtifactReuse({ plan, operations: op, options: deliveryOptions, recipeFor: finishVideoRecipe, artifactRole: "delivery-video" });
    await executeStage({
      state,
      name: "delivery",
      paid: false,
      run: () => executeCanonicalLocalOrDirect({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "delivery", reuse, execute: () => op.finishVideo(deliveryOptions) }),
    });
    await executeCanonicalLocalNode({ kernel: canonical.kernel, executionPlan: plan.executionPlan, nodeId: "delivery", reuse,
      execute: async () => ({ file: files.deliveryFile, receiptFile: state.stages.delivery.receiptFile }) });
  }
  state.finalFile = spec.delivery ? files.deliveryFile : masterInput;
  if (spec.assembly.expectedMasterFrames != null) {
    const timingFile = path.join(spec.root, "metadados", "master-duration-attestation.json");
    const timing = await op.probeTiming({ mediaFile: state.finalFile, expectedFrames: spec.assembly.expectedMasterFrames, outputFile: timingFile });
    const video = timing.streams.find((stream) => stream.codec_type === "video");
    if (timing.status !== "pass" || Number(video?.decodedFrames) !== spec.assembly.expectedMasterFrames) throw new Error(`Master físico diverge da timeline: esperado ${spec.assembly.expectedMasterFrames} frames, obtido ${video?.decodedFrames ?? "desconhecido"}.`);
    state.physicalAttestation = { file: timingFile, expectedFrames: spec.assembly.expectedMasterFrames, measuredFrames: Number(video.decodedFrames), status: "pass" };
  }
  const variants = plan.executionPlan?.spec?.formats?.variants ?? [];
  if (variantNodes.length !== variants.length) throw new Error("Plano canônico diverge do inventário de variantes.");
  if (variants.length) {
    state.stages.variants.status = state.stages.variants.status === "blocked" ? "planned" : state.stages.variants.status;
    await executeStage({ state, name: "variants", paid: false, run: async () => {
      state.variants ??= [];
      for (const variant of variants) {
        const nodeId = `variant:${variant.format.replace(":", "x")}`;
        const outputFile = path.join(spec.root, "videos-unidos", `variant-${variant.format.replace(":", "x")}.mp4`);
        const receiptFile = path.join(files.receipts, `variant-${variant.format.replace(":", "x")}.receipt.json`);
        const result = await executeCanonicalLocalNode({
          kernel: canonical.kernel,
          executionPlan: plan.executionPlan,
          nodeId,
          execute: () => op.createVideoVariant({
            inputFile: state.finalFile,
            outputFile,
            receiptFile,
            format: variant.format,
            strategy: variant.strategy,
            cropApproved: variant.approved === true,
            timelineFingerprint: plan.executionPlan.timeline.fingerprint,
            parentReceipts: parentIds(state, [spec.delivery ? "delivery" : spec.qa ? "qa" : spec.captions ? "captions" : hasAudio ? "audioMux" : "assembly"]),
          }),
        });
        const projection = { nodeId, format: variant.format, strategy: variant.strategy, file: result?.file ?? outputFile, receiptFile: result?.receiptFile ?? receiptFile };
        const existing = state.variants.findIndex((entry) => entry.nodeId === nodeId);
        if (existing >= 0) state.variants[existing] = projection;
        else state.variants.push(projection);
      }
      return { variants: structuredClone(state.variants) };
    }});
  }
  refreshFilmStatus(state);
  await saveState(state);
  return context;
}

export async function statusFilm({ stateFile } = {}) {
  const { state, plan } = await loadContext(stateFile);
  const draft = await pathExists(state.draftFile) ? await readDraftState(state.draftFile) : null;
  return {
    schema: "mkt-videos/film-status@1",
    id: state.id,
    status: state.status,
    finalFile: state.finalFile,
    updatedAt: state.updatedAt,
    paidCalls: plan.paidCalls,
    draft: draft ? { status: draft.status, scenes: draft.scenes.map((scene) => ({ id: scene.id, status: scene.status, keyframeFile: scene.keyframeFile, videoFile: scene.videoFile })) } : null,
    stages: state.stages,
  };
}

export async function reconcileFilmVideo(options = {}) {
  return withFilmOperationLock(options, reconcileFilmVideoUnlocked);
}

async function reconcileFilmVideoUnlocked({ stateFile, sceneId, endpoint, timeoutMs = 120_000, operations = {}, resourceBroker = null } = {}) {
  const context = await loadContext(stateFile);
  const { state, files, spec, plan } = context;
  const op = { ...defaultOperations(), ...operations };
  const normalizedSceneId = requiredText(sceneId, "sceneId");
  const nodeId = `video:${normalizedSceneId}`;
  const journalFile = plan.executionPlan ? path.join(path.dirname(files.stateFile), "execution-journal.sqlite") : null;
  const current = journalFile ? materializeExecutionSnapshot({ dbFile: journalFile }).nodes[nodeId] : null;
  const hasRemote = Boolean(current?.attemptId && resourceBroker?.readRemoteOperation(`omni:${current.attemptId}`));
  const phased = hasRemote && ["submit", "observe", "collect"].every((name) => typeof op.videoAdapter?.[name] === "function");
  if (hasRemote && !phased) throw new Error("A tentativa usa fases remotas; o adapter atual precisa expor observe e collect para reconciliá-la.");
  const selected = phased ? canonicalExecutionOperations({ plan, files, operations: op, resourceBroker }).operations : op;
  const claim = journalFile && !phased ? claimNodeReconciliation({ dbFile: journalFile, nodeId }) : null;
  let reconciled;
  try {
    reconciled = await reconcileDraftScene({ draftFile: files.draftFile, sceneId: normalizedSceneId, videoAdapter: selected.videoAdapter, timeoutMs, receiptMetadata: receiptContextMetadata(spec) });
    if (claim && reconciled.scene.status === "delivered") {
      const scene = reconciled.state.scenes.find((entry) => entry.id === normalizedSceneId);
      const receipt = await readVerifiedReceipt(scene.videoReceipt);
      recordNodeCompletion({
        dbFile: journalFile,
        nodeId,
        attemptId: claim.attemptId,
        output: scene.videoFile,
        receipt: scene.videoReceipt,
        artifacts: (receipt.artifacts ?? []).map((artifact) => ({
          sha256: artifact.hash.value,
          bytes: artifact.bytes,
          mimeType: artifact.mimeType,
          receiptId: receipt.id,
          receiptSha256: receipt.hash.value,
        })),
        reconciled: true,
      });
    }
  } catch (error) {
    if (journalFile && claim) {
      recordNodeFailure({ dbFile: journalFile, nodeId, attemptId: claim.attemptId, error, status: "attention_required" });
    }
    throw error;
  }
  const delivered = reconciled.state.status === "delivered";
  state.stages.video.status = delivered ? "completed" : "attention_required";
  state.stages.video.blockedBy = delivered ? null : "omni_reconcile";
  state.stages.video.error = delivered ? null : `Cena ${sceneId}: ${reconciled.result.classification}.`;
  if (delivered) state.stages.video.completedAt ??= new Date().toISOString();
  event(state, "video_reconciled", { scene: String(sceneId), classification: reconciled.result.classification, zeroPost: true });
  refreshFilmStatus(state);
  await saveState(state);
  return { ...context, reconciliation: reconciled.result };
}

export async function overrideFilmQa({ stateFile, author, justification } = {}) {
  const context = await loadContext(stateFile);
  const { state, files } = context;
  const normalizedAuthor = requiredText(author, "author");
  const normalizedJustification = requiredText(justification, "justification");
  if (state.stages.qa?.status !== "completed" || state.stages.qa?.gate?.status !== "blocked") throw new Error("O filme não possui gate QA bloqueado elegível para override.");
  const report = JSON.parse(await readFile(files.qaFile, "utf8"));
  const reportFingerprint = operationFingerprint({ report });
  if (state.stages.qa.gate.reportFingerprint !== reportFingerprint) throw new Error("O relatório QA mudou; reavalie o gate antes do override.");
  const override = {
    schema: "mkt-videos/qa-override@1",
    author: normalizedAuthor,
    justification: normalizedJustification,
    acceptedWarnings: [...state.stages.qa.gate.blockingWarnings],
    reportFingerprint,
    acceptedAt: new Date().toISOString(),
  };
  state.stages.qa.override = override;
  state.stages.qa.gate = { ...state.stages.qa.gate, status: "overridden", override };
  event(state, "qa_gate_overridden", { author: normalizedAuthor, reportFingerprint, acceptedWarnings: override.acceptedWarnings });
  refreshFilmStatus(state);
  await saveState(state);
  return { ...context, override };
}

export async function loadFilmSpec(file, { knowledgeContext = null } = {}) {
  const absolute = path.resolve(String(file));
  await access(absolute);
  const source = await readFile(absolute, "utf8");
  const parsed = JSON.parse(source);
  if (parsed?.schema === "gerador-de-videos/receita@2") {
    const { parseMasterRecipe, resolveMasterRecipe, compileResolvedMasterRecipe } = await import("./master-recipe-v2.mjs");
    const resolved = resolveMasterRecipe(parseMasterRecipe(source, { channel: "file" }));
    if (resolved.recipe.kind === "lote") throw new Error("Receita Mestre de lote exige dispatch por produção; plan/run não podem descartar as linhas do lote.");
    return compileResolvedMasterRecipe(resolved, { knowledgeContext }).filmSpec;
  }
  if (parsed?.schema === "gerador-de-videos/receita@1") {
    const compiled = compilarReceita(parsed);
    if (compiled.motor === "filme") return compiled.filmSpec;
    throw new Error(`A receita ${parsed.id} é do tipo ${compiled.motor}, não filme.`);
  }
  return parsed;
}
