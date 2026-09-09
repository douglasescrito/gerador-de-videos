import { operationFingerprint } from "./pipeline-operation.mjs";
import { resolveCaptionStyle } from "./captions.mjs";
import { resolveStyleSpec } from "./direction-presets.mjs";
import { assertFilmBrand, resolveQaPolicy } from "./studio-policies.mjs";
import { createExecutionGovernance } from "./studio-governance.mjs";
import {
  assertKnowledgeContextBinding,
  assertKnowledgeContextSnapshot,
  assertStudioBrief,
  assertStudioDecisionArtifactsForContext,
  buildKnowledgeContextBinding,
} from "./studio-context.mjs";
import { assertProductionContextBinding } from "./production-context.mjs";
import { assertCreativeDirectionDecision } from "./creative-direction.mjs";
import { localSfxAssets } from "./local-asset-use.mjs";
import { assertStyleCompositionBinding } from "./style-controls.mjs";
import { validatePostProduction } from "./film-post-production.mjs";
import { motionAssDocument } from "./motion-graphics.mjs";

export const FILM_SPEC_V2_SCHEMA = "mkt-videos/film-spec@2";
export const EXECUTION_PLAN_SCHEMA = "mkt-videos/execution-plan@1";
export const TIMELINE_SCHEMA = "mkt-videos/timeline@1";
export const FILM_COMPILER_VERSION = "film-compiler@2.6.0";
export const TEXT_RENDERING_MODES = Object.freeze(new Set(["none", "omni-native", "local-gc"]));

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function sceneRole(value = "spectacle") {
  const normalized = String(value);
  if (!new Set(["spectacle", "proof", "typography", "transition", "identity"]).has(normalized)) throw new Error(`Papel de cena inválido: ${normalized}.`);
  return normalized;
}

export function migrateFilmSpecV1(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("film-spec@1 inválido.");
  const scenes = (raw.scenes ?? []).map((scene, index) => ({
    id: String(scene.id ?? `scene-${index + 1}`),
    role: sceneRole(scene.role),
    objective: String(scene.objective ?? scene.prompt ?? ""),
    visualPrompt: text(scene.prompt, `scenes[${index}].prompt`),
    motionPrompt: String(scene.motionPrompt ?? scene.prompt),
    onScreenText: scene.onScreenText ?? null,
    textRendering: scene.onScreenText == null ? "none" : scene.textRendering ?? "omni-native",
    // A narração Omni também é produzida em blocos separados e mixada depois.
    // Os clipes visuais nunca devem sintetizar uma segunda voz.
    audioPolicy: raw.narration != null ? "external-narration-no-voice" : "provider-default",
    references: clone(scene.references ?? []),
    referenceAuthorizations: clone(scene.referenceAuthorizations ?? []),
    runtimeInputRoles: clone(scene.runtimeInputRoles ?? []),
    restrictions: clone(scene.restrictions ?? []),
    style: scene.style ?? raw.style ?? null,
    ...(scene.generationTask != null || scene.task != null ? { generationTask: scene.generationTask ?? scene.task } : {}),
    ...(scene.topology != null ? { topology: scene.topology } : {}),
    durationHint: scene.duration == null ? null : Number(scene.duration),
    image: { model: scene.imageModel ?? raw.imageModel ?? "gemini-3-pro-image", size: scene.imageSize ?? raw.imageSize ?? "2K" },
  }));
  if (!scenes.length) throw new Error("film-spec@1 exige scenes.");
  const fps = Number(raw.assembly?.fps ?? 24);
  return {
    schema: FILM_SPEC_V2_SCHEMA,
    name: String(raw.name ?? "filme"),
    source: { request: raw.source?.request ?? null, directionPreset: raw.style ?? null, effectiveDirection: raw.source?.effectiveDirection ?? null },
    creativeDirection: clone(raw.creativeDirection ?? null),
    narration: raw.narration == null ? { mode: "none", text: null, blocks: [] } : {
      mode: raw.narration.mode ?? "continuous",
      provider: raw.narration.provider ?? "omni",
      ...(raw.narration.speakerMode == null ? {} : { speakerMode: raw.narration.speakerMode }),
      text: String(raw.narration.text),
      blocks: clone(raw.narration.blocks ?? [{ id: "narration-1", text: String(raw.narration.text) }]),
      voice: raw.narration.voice ?? "Charon",
      documentUrl: raw.narration.documentUrl ?? null,
      newScene: raw.narration.newScene !== false,
      fallbackProvider: raw.narration.fallbackProvider ?? null,
      fallbackPolicy: raw.narration.fallbackPolicy ?? null,
      speakers: clone(raw.narration.speakers ?? null),
      readingDirection: raw.narration.readingDirection ?? null,
      model: raw.narration.model ?? null,
      fallbackModels: clone(raw.narration.fallbackModels ?? []),
      continuity: raw.narration.continuity ?? "single-master",
    },
    music: raw.music == null ? { mode: "none", intent: null, fit: "none", tailSeconds: 0 } : {
      mode: "generated",
      intent: raw.music.prompt ?? null,
      preset: raw.music.preset ?? null,
      backend: raw.music.backend ?? "flow-music",
      images: clone(raw.music.images ?? []),
      fit: raw.music.fit ?? "exact",
      durationSeconds: raw.music.durationSeconds == null ? null : Number(raw.music.durationSeconds),
      tailSeconds: Number(raw.music.tailSeconds ?? 0),
    },
    alignment: clone(raw.alignment ?? null),
    workflow: clone(raw.workflow ?? null),
    resources: clone(raw.resources ?? []),
    timeline: {
      fps: { numerator: Number.isInteger(fps) ? fps : 24, denominator: 1 },
      holdInFrames: Number(raw.timeline?.holdInFrames ?? 0),
      holdOutFrames: Number(raw.timeline?.holdOutFrames ?? 0),
      transition: raw.assembly?.transition ?? "cut",
      transitionFrames: Math.round(Number(raw.assembly?.transitionDuration ?? 0.5) * fps),
    },
    scenes,
    formats: { master: raw.aspect ?? "16:9", variants: clone(raw.formats?.variants ?? []) },
    brandKit: clone(raw.brandKit ?? null),
    captions: raw.captions == null ? { mode: "none" } : { mode: "burn-in", preset: raw.captions.style ?? "kinetic-word@1", granularity: raw.captions.granularity ?? "word", sidecars: clone(raw.captions.sidecars ?? []), wordsFile: raw.captions.wordsFile ?? null, scriptFile: raw.captions.scriptFile ?? null },
    qa: raw.qa === false ? { enabled: false } : { enabled: true, policy: raw.qa?.policy ?? null, semantic: Boolean(raw.qa?.semantic), semanticScenes: Boolean(raw.qa?.semanticScenes), semanticModel: raw.qa?.semanticModel ?? "gemini-3.5-flash", expectedText: raw.qa?.expectedText ?? null, gate: raw.qa?.gate ?? "block", blockingWarnings: clone(raw.qa?.blockingWarnings ?? null), direction: raw.qa?.direction ?? null, references: clone(raw.qa?.references ?? []) },
    reuse: { policy: raw.reuse?.policy ?? "off" },
    execution: {
      concurrency: clone(raw.execution?.concurrency ?? { draft: 3, video: 3, localCpu: 1 }),
      budget: clone(raw.budget ?? {}),
      providers: clone(raw.execution?.providers ?? {}),
      ...(raw.execution?.topology != null || raw.topology != null ? { topology: raw.execution?.topology ?? raw.topology } : {}),
    },
    finishing: { audio: clone(raw.audio ?? {}), assembly: clone(raw.assembly ?? {}), ending: clone(raw.ending ?? null), delivery: clone(raw.delivery ?? null) },
    compatibility: { sourceSchema: raw.schema ?? "mkt-videos/film-spec@1", legacyExecutorSpec: clone(raw) },
  };
}

function validateV2(spec) {
  if (spec?.schema !== FILM_SPEC_V2_SCHEMA) throw new Error(`Schema esperado: ${FILM_SPEC_V2_SCHEMA}.`);
  text(spec.name, "name");
  spec.source ??= { request: null, directionPreset: null, effectiveDirection: null };
  spec.creativeDirection = spec.creativeDirection == null ? null : assertCreativeDirectionDecision(spec.creativeDirection);
  spec.brief = spec.brief == null ? null : assertStudioBrief(spec.brief);
  if (spec.styleComposition != null) spec.styleComposition = assertStyleCompositionBinding(spec.styleComposition, { briefHash: spec.brief?.hash, scope: spec.source.scope ?? {}, shots: (spec.scenes ?? []).map((scene) => ({ shotId: scene.id, prompt: scene.visualPrompt })), style: resolveStyleSpec(spec.styleComposition.composition?.styleId, { allowConcept: true, allowDeprecated: true }) });
  if (spec.styleComposition != null && (spec.source.directionPreset != null || spec.scenes.some((scene) => scene.style != null || (scene.motionPrompt ?? scene.visualPrompt) !== scene.visualPrompt))) throw new Error("styleComposition exige prompts visuais e de movimento idênticos, sem segunda composição de estilo.");
  spec.knowledgeContext = spec.knowledgeContext == null ? null : assertKnowledgeContextSnapshot(spec.knowledgeContext);
  spec.decisionArtifacts = spec.decisionArtifacts == null
    ? null
    : assertStudioDecisionArtifactsForContext(spec.decisionArtifacts, {
        contextHash: spec.knowledgeContext?.hash ?? null,
      });
  if (spec.decisionArtifacts != null && spec.knowledgeContext == null) {
    throw new Error("decisionArtifacts exige knowledgeContext congelado.");
  }
  if (spec.brief?.knowledgeContextHash != null && spec.brief.knowledgeContextHash !== spec.knowledgeContext?.hash) {
    throw new Error("brief.knowledgeContextHash diverge do contexto congelado.");
  }
  if (spec.knowledgeContext != null) {
    const expectedBinding = buildKnowledgeContextBinding(spec.knowledgeContext, { briefHash: spec.brief?.hash ?? null });
    if (spec.knowledgeContextBinding == null) spec.knowledgeContextBinding = expectedBinding;
    else {
      assertKnowledgeContextBinding(spec.knowledgeContextBinding, {
        context: spec.knowledgeContext,
        briefHash: spec.brief?.hash ?? null,
      });
      if (operationFingerprint(spec.knowledgeContextBinding) !== operationFingerprint(expectedBinding)) {
        throw new Error("knowledgeContextBinding não corresponde ao contexto canônico.");
      }
    }
  } else if (spec.knowledgeContextBinding != null) {
    throw new Error("knowledgeContextBinding exige knowledgeContext congelado.");
  }
  spec.productionContextBinding = spec.productionContextBinding == null
    ? null
    : assertProductionContextBinding(spec.productionContextBinding);
  if (spec.productionContextBinding != null) {
    // O binding só referencia brief/knowledgeContextBinding/decisionArtifacts
    // por hash (evita ciclo de hash ao reembutir); a divergência aqui pega um
    // binding congelado que ficou preso a um brief ou contexto diferente do
    // que está de fato no spec agora.
    if (spec.productionContextBinding.briefHash !== (spec.brief?.hash ?? null)) {
      throw new Error("productionContextBinding.briefHash diverge do brief congelado.");
    }
    if (
      spec.productionContextBinding.knowledgeContextBindingHash
      !== (spec.knowledgeContextBinding?.hash ?? null)
    ) {
      throw new Error("productionContextBinding.knowledgeContextBindingHash diverge do knowledgeContextBinding congelado.");
    }
    if (
      spec.productionContextBinding.decisionArtifactsHash
      !== (spec.decisionArtifacts?.hash ?? null)
    ) {
      throw new Error("productionContextBinding.decisionArtifactsHash diverge do decisionArtifacts congelado.");
    }
  }
  spec.narration ??= { mode: "none", text: null, blocks: [] };
  spec.narration.blocks ??= [];
  spec.narration.provider ??= spec.narration.mode === "none" ? null : "omni";
  if (spec.narration.mode !== "none" && !new Set(["google-vids", "omni"]).has(spec.narration.provider)) {
    throw new Error(`narration.provider inválido: ${spec.narration.provider}.`);
  }
  if (spec.narration.provider === "omni" && spec.narration.blocks.length === 0) {
    throw new Error("Narração Omni exige ao menos um bloco para alinhamento local.");
  }
  if (spec.narration.provider === "google-vids") {
    if (!String(spec.narration.documentUrl ?? "").startsWith("https://docs.google.com/videos/d/")) throw new Error("Narração Google Vids exige documentUrl válido.");
    spec.narration.voice = text(spec.narration.voice ?? "Nyla", "narration.voice");
    if (spec.narration.blocks.length === 0) throw new Error("Narração Google Vids exige blocos para sincronismo por timestamps.");
    if (spec.narration.speakerMode === "multi-voice") {
      if (!Array.isArray(spec.narration.speakers) || spec.narration.speakers.length < 2) throw new Error("Narração multi-voz exige ao menos dois speakers.");
      const speakerIds = new Set(spec.narration.speakers.map((speaker, index) => text(speaker.id, `narration.speakers[${index}].id`)));
      if (speakerIds.size !== spec.narration.speakers.length) throw new Error("Narração multi-voz possui speaker duplicado.");
      for (const [index, block] of spec.narration.blocks.entries()) {
        if (!speakerIds.has(String(block.speakerId ?? ""))) throw new Error(`narration.blocks[${index}].speakerId não foi declarado.`);
      }
    }
  }
  const narrationBlockIds = new Set();
  for (const [index, block] of spec.narration.blocks.entries()) {
    block.id = text(block.id ?? `block-${index + 1}`, `narration.blocks[${index}].id`);
    block.text = text(block.text, `narration.blocks[${index}].text`);
    if (narrationBlockIds.has(block.id)) throw new Error(`Bloco de narração duplicado: ${block.id}.`);
    narrationBlockIds.add(block.id);
    if (block.seconds != null && (!Number.isFinite(Number(block.seconds)) || Number(block.seconds) <= 0 || Number(block.seconds) > 15)) {
      throw new Error(`narration.blocks[${index}].seconds deve ficar entre 0 e 15.`);
    }
    if (block.seconds != null) block.seconds = Number(block.seconds);
  }
  spec.music ??= { mode: "none", intent: null, fit: "none", tailSeconds: 0 };
  spec.timeline ??= { fps: { numerator: 24, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 };
  spec.formats ??= { master: "16:9", variants: [] };
  spec.formats.variants ??= [];
  spec.captions ??= { mode: "none" };
  spec.qa ??= { enabled: true, semantic: false, gate: "block" };
  spec.qa.assertions ??= [];
  if (!Array.isArray(spec.qa.assertions) || spec.qa.assertions.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error("qa.assertions deve ser uma lista de identificadores não vazios.");
  spec.reuse ??= { policy: "off" };
  spec.execution ??= { concurrency: { draft: 3, video: 3, localCpu: 1 }, budget: {}, providers: {} };
  spec.execution.concurrency ??= { draft: 3, video: 3, localCpu: 1 };
  spec.execution.budget ??= {};
  spec.finishing ??= { audio: {}, assembly: {}, ending: null, delivery: null };
  localSfxAssets(spec);
  if (spec.finishing.audio?.sceneAudioGainDb != null && (!Number.isFinite(spec.finishing.audio.sceneAudioGainDb) || spec.finishing.audio.sceneAudioGainDb < -96 || spec.finishing.audio.sceneAudioGainDb > 12)) throw new Error("sceneAudioGainDb deve ficar entre -96 e 12.");
  if (spec.finishing.audio?.sceneAudioGainDb != null && (spec.finishing.assembly?.transitions?.some((edge) => edge.transition !== "cut") || (!spec.finishing.assembly?.transitions && (spec.finishing.assembly?.transition ?? spec.timeline.transition) !== "cut"))) throw new Error("sceneAudioGainDb exige transições cut; o compositor atual não preserva áudio em xfade.");
  spec.finishing.ending ??= null;
  const planStyle = spec.source?.directionPreset == null
    ? null
    : resolveStyleSpec(spec.source.directionPreset, { allowConcept: true, allowDeprecated: true });
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error("film-spec@2 exige scenes.");
  const ids = new Set();
  for (const [index, scene] of spec.scenes.entries()) {
    scene.id = text(scene.id, `scenes[${index}].id`);
    if (ids.has(scene.id)) throw new Error(`Cena duplicada: ${scene.id}.`);
    ids.add(scene.id);
    scene.role = sceneRole(scene.role);
    text(scene.visualPrompt, `scenes[${index}].visualPrompt`);
    scene.motionPrompt ??= scene.visualPrompt;
    scene.onScreenText = scene.onScreenText == null ? null : text(scene.onScreenText, `scenes[${index}].onScreenText`);
    scene.textRendering ??= scene.onScreenText == null ? "none" : "omni-native";
    scene.textRendering = String(scene.textRendering).trim().toLowerCase();
    if (!TEXT_RENDERING_MODES.has(scene.textRendering)) throw new Error(`scenes[${index}].textRendering inválido: ${scene.textRendering}.`);
    if (scene.onScreenText == null && scene.textRendering !== "none") throw new Error(`scenes[${index}].textRendering exige onScreenText.`);
    if (scene.onScreenText != null && scene.textRendering === "none") throw new Error(`scenes[${index}].onScreenText exige textRendering omni-native ou local-gc.`);
    scene.references ??= [];
    scene.referenceAuthorizations ??= [];
    scene.runtimeInputRoles ??= [];
    scene.restrictions ??= [];
    scene.image ??= { model: "gemini-3-pro-image", size: "2K" };
    const sceneStyle = scene.style == null
      ? planStyle
      : resolveStyleSpec(scene.style, { allowConcept: true, allowDeprecated: true });
    scene.generationTask ??= sceneStyle?.generation?.defaultTask ?? "image_to_video";
    scene.generationTask = String(scene.generationTask).trim().toLowerCase().replaceAll("-", "_");
    if (!new Set(["text_to_video", "image_to_video", "reference_to_video", "edit"]).has(scene.generationTask)) {
      throw new Error(`scenes[${index}].generationTask inválida: ${scene.generationTask}.`);
    }
    if (scene.topology != null && !new Set(["independent", "chained"]).has(scene.topology)) {
      throw new Error(`scenes[${index}].topology inválida: ${scene.topology}.`);
    }
    if (scene.durationHint != null && (!Number.isFinite(Number(scene.durationHint)) || Number(scene.durationHint) <= 0)) throw new Error(`scenes[${index}].durationHint deve ser positivo.`);
  }
  const fps = spec.timeline?.fps;
  if (!Number.isInteger(fps?.numerator) || fps.numerator <= 0 || !Number.isInteger(fps?.denominator) || fps.denominator <= 0) throw new Error("timeline.fps exige numerator/denominator positivos.");
  if (!new Set(["16:9", "9:16"]).has(spec.formats?.master)) throw new Error("formats.master deve ser 16:9 ou 9:16.");
  spec.formats.variants = spec.formats.variants.map((value) => typeof value === "string" ? { format: value, strategy: "fit-pad", approved: false } : { strategy: "fit-pad", approved: false, ...clone(value) });
  const variantFormats = new Set();
  for (const variant of spec.formats.variants) {
    if (!new Set(["16:9", "9:16", "1:1"]).has(variant.format)) throw new Error(`Formato de variante inválido: ${variant.format}.`);
    if (variantFormats.has(variant.format)) throw new Error(`Formato de variante duplicado: ${variant.format}.`);
    variantFormats.add(variant.format);
    if (!new Set(["fit-pad", "center-crop"]).has(variant.strategy)) throw new Error(`Estratégia de variante inválida: ${variant.strategy}.`);
    if ((variant.format === "1:1" || variant.strategy === "center-crop") && variant.approved !== true) throw new Error(`Variante ${variant.format}/${variant.strategy} exige approved:true.`);
  }
  if (!new Set(["off", "prefer-approved", "require-approved"]).has(spec.reuse?.policy)) throw new Error("reuse.policy inválida.");
  if (spec.captions.mode !== "none") spec.captions.style = resolveCaptionStyle(spec.captions.preset ?? spec.captions.style ?? "kinetic-word@1");
  if (spec.qa.enabled) spec.qa.policy = resolveQaPolicy(spec.qa.policy ?? "strict@1");
  return spec;
}

export function normalizeFilmSpecV2(raw) {
  return validateV2(raw?.schema === FILM_SPEC_V2_SCHEMA ? clone(raw) : migrateFilmSpecV1(raw));
}

export function compileTimeline(spec) {
  const fps = spec.timeline.fps;
  let cursorFrames = Number(spec.timeline.holdInFrames ?? 0);
  const transitionEdges = Array.isArray(spec.timeline.edges) ? spec.timeline.edges : null;
  if (transitionEdges && transitionEdges.length !== Math.max(0, spec.scenes.length - 1)) throw new Error("timeline.edges deve cobrir exatamente os pares adjacentes de scenes.");
  const spans = spec.scenes.map((scene, index) => {
    const durationFrames = scene.durationHint == null ? null : Math.max(1, Math.round(Number(scene.durationHint) * fps.numerator / fps.denominator));
    const span = { sceneId: scene.id, order: index, startFrame: durationFrames == null ? null : cursorFrames, durationFrames, endFrame: durationFrames == null ? null : cursorFrames + durationFrames };
    if (durationFrames != null) {
      const overlap = index < spec.scenes.length - 1
        ? Number(transitionEdges?.[index]?.durationFrames ?? spec.timeline.transitionFrames ?? 0)
        : 0;
      cursorFrames = span.endFrame - overlap;
    }
    return span;
  });
  const locked = spans.every((span) => span.durationFrames != null);
  const timeline = {
    schema: TIMELINE_SCHEMA,
    timeBase: { numerator: fps.denominator, denominator: fps.numerator },
    fps: clone(fps),
    locked,
    durationFrames: locked ? cursorFrames + Number(spec.timeline.holdOutFrames ?? 0) : null,
    transition: transitionEdges
      ? { type: "per-edge", durationFrames: null, edges: clone(transitionEdges) }
      : { type: spec.timeline.transition ?? "cut", durationFrames: Number(spec.timeline.transitionFrames ?? 0) },
    tracks: [
      { id: "video", kind: "video", spans },
      { id: "voice", kind: "audio", source: spec.narration.mode === "none" ? null : "voice-master", startFrame: 0, durationFrames: null },
      { id: "music", kind: "audio", source: spec.music.mode === "none" ? null : "music-bed", startFrame: 0, durationFrames: null },
    ],
    markers: spec.narration.blocks.map((block, index) => ({ id: block.id ?? `block-${index + 1}`, kind: "narration-block", frame: null, text: block.text })),
  };
  return { ...timeline, fingerprint: operationFingerprint(timeline) };
}

function legacyFromV2(spec) {
  if (spec.compatibility?.legacyExecutorSpec) return clone(spec.compatibility.legacyExecutorSpec);
  return {
    name: spec.name,
    aspect: spec.formats.master,
    style: spec.source.directionPreset,
    scenes: spec.scenes.map((scene) => ({
      id: scene.id,
      prompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt ?? scene.visualPrompt,
      style: scene.style,
      references: clone(scene.references),
      referenceAuthorizations: clone(scene.referenceAuthorizations ?? []),
      runtimeInputRoles: clone(scene.runtimeInputRoles ?? []),
      generationTask: scene.generationTask,
      durationHint: scene.durationHint,
      onScreenText: scene.onScreenText,
      textRendering: scene.textRendering,
      audioPolicy: scene.audioPolicy,
      ...(scene.topology == null ? {} : { topology: scene.topology }),
      imageModel: scene.image?.model,
      imageSize: scene.image?.size,
    })),
    ...(spec.narration.mode === "none" ? {} : { narration: { provider: spec.narration.provider, speakerMode: spec.narration.speakerMode, text: spec.narration.text, voice: spec.narration.voice, blocks: clone(spec.narration.blocks), speakers: clone(spec.narration.speakers), readingDirection: spec.narration.readingDirection, model: spec.narration.model, fallbackModels: clone(spec.narration.fallbackModels), documentUrl: spec.narration.documentUrl, newScene: spec.narration.newScene, fallbackProvider: spec.narration.fallbackProvider, fallbackPolicy: spec.narration.fallbackPolicy } }),
    ...(spec.music.mode === "none" ? {} : { music: { prompt: spec.music.intent, preset: spec.music.preset, backend: spec.music.backend, images: clone(spec.music.images), fit: spec.music.fit, durationSeconds: spec.music.durationSeconds, tailSeconds: spec.music.tailSeconds } }),
    ...(spec.alignment == null ? {} : { alignment: clone(spec.alignment) }),
    ...(spec.workflow == null ? {} : { workflow: clone(spec.workflow) }),
    ...(spec.resources?.length ? { resources: clone(spec.resources) } : {}),
    assembly: clone(spec.finishing.assembly),
    ending: clone(spec.finishing.ending),
    ...(spec.finishing.postProduction ? { postProduction: clone(spec.finishing.postProduction) } : {}),
    audio: clone(spec.finishing.audio),
    captions: spec.captions.mode === "none" ? undefined : { wordsFile: spec.captions.wordsFile, scriptFile: spec.captions.scriptFile, style: spec.captions.preset },
    delivery: clone(spec.finishing.delivery),
    qa: spec.qa.enabled ? {
      semantic: spec.qa.semantic,
      semanticScenes: spec.qa.semanticScenes,
      semanticModel: spec.qa.semanticModel,
      expectedText: spec.qa.expectedText,
      gate: spec.qa.gate ?? "block",
      blockingWarnings: clone(spec.qa.blockingWarnings ?? Object.entries(spec.qa.policy?.rules ?? {}).filter(([, action]) => action === "block").map(([code]) => code)),
      direction: spec.qa.direction,
      references: clone(spec.qa.references),
    } : false,
    budget: clone(spec.execution.budget),
  };
}

function compileNodes(spec, timeline) {
  const nodes = [];
  const byId = new Map();
  function resourcesFor(kind, lane, semanticInputs) {
    if (["omni-video", "omni-narration", "keyframe", "qa-scene", "qa"].includes(kind) && lane !== "local-cpu") return [{ id: "provider:omni", weight: 1 }];
    if (kind === "tts") return [{ id: "provider:vids", weight: 1 }];
    if (kind === "music-generate") return [{ id: "provider:flow", weight: 1 }];
    if (kind === "media-probe") return [{ id: "io:probe-hash", weight: 1 }];
    if (kind === "narration-align" && (semanticInputs?.narration || semanticInputs?.blocks?.length)) return [{ id: "gpu:shared", weight: 1 }, { id: "gpu:whisper", weight: 1 }];
    if (["music-fit", "animatic", "html-motion", "motion-graphics", "assembly", "audio-mix", "master-audio-video", "captions", "post-production", "delivery", "variant"].includes(kind)) return [{ id: "cpu:ffmpeg", weight: 1 }];
    return [];
  }
  function add(id, kind, dependencies, costClass, lane, semanticInputs = {}) {
    for (const dependency of dependencies) if (!byId.has(dependency)) throw new Error(`Dependência desconhecida em ${id}: ${dependency}.`);
    const resources = resourcesFor(kind, lane, semanticInputs);
    const node = { id, kind, dependencies, costClass, lane, resources, fingerprint: operationFingerprint({ id, kind, resources, semanticInputs }) };
    nodes.push(node);
    byId.set(id, node);
    return id;
  }
  let voice = null;
  if (spec.narration.mode !== "none") {
    if (spec.narration.provider === "omni") {
      const narrationVideos = spec.narration.blocks.map((block, index) => add(
        `video:narration:${block.id ?? `block-${index + 1}`}`,
        "omni-narration",
        [],
        "paid",
        "video",
        { block, task: "text_to_video", format: spec.formats.master },
      ));
      voice = add("voice-master", "narration-align", narrationVideos, "local", "local-cpu", { narration: spec.narration, alignment: spec.alignment });
    } else if (spec.narration.speakerMode === "multi-voice") {
      const voices = spec.narration.blocks.map((block, index) => add(
        `voice:${block.id ?? `block-${index + 1}`}`,
        "tts",
        [],
        "paid",
        "tts",
        { block, speakers: spec.narration.speakers },
      ));
      voice = add("voice-master", "narration-align", voices, "local", "local-cpu", { narration: spec.narration, alignment: spec.alignment });
    } else {
      voice = add("voice-master", "tts", [], "paid", "tts", { narration: spec.narration });
    }
    add("voice-probe", "media-probe", [voice], "local", "local-cpu", {});
  }
  let music = null;
  if (spec.music.mode !== "none") {
    // A geração da trilha usa brief e duração-alvo já congelados. Ela não
    // consome o áudio da voz, portanto começa junto com a narração. Somente o
    // fit final espera o probe para casar a timeline exata.
    music = add("music-source", "music-generate", [], "paid", "music", { music: spec.music });
    add("music-fit", "music-fit", [music, ...(voice ? ["voice-probe"] : [])], "local", "local-cpu", { fit: spec.music.fit, tailSeconds: spec.music.tailSeconds });
  }
  const alignmentDependencies = voice ? ["voice-probe"] : [];
  add("alignment", "narration-align", alignmentDependencies, "local", "local-cpu", { blocks: spec.narration.blocks });
  add("timeline-lock", "timeline-lock", ["alignment", ...(music ? ["music-fit"] : [])], "local", "local-cpu", { timelineFingerprint: timeline.fingerprint });
  const keyframes = spec.scenes.map((scene) => {
    const deterministic = ["text_to_video", "reference_to_video"].includes(scene.generationTask);
    return add(`keyframe:${scene.id}`, deterministic ? "deterministic-card" : "keyframe", ["timeline-lock"], deterministic ? "local" : "paid", deterministic ? "local-cpu" : "draft", {
      scene: { id: scene.id, role: scene.role, objective: scene.objective, visualPrompt: scene.visualPrompt, onScreenText: scene.onScreenText, textRendering: scene.textRendering, references: scene.references, restrictions: scene.restrictions, style: scene.style, image: scene.image },
      brandKit: spec.brandKit,
    });
  });
  add("animatic", "animatic", [...keyframes, "timeline-lock"], "local", "local-cpu", { formats: spec.formats });
  const productionOnce = spec.workflow?.authorizationMode === "production-once" && spec.workflow?.humanReview === false;
  add("animatic-approval", productionOnce ? "workflow-authorization" : "human-approval", ["animatic"], "local", productionOnce ? "automation" : "human", { authorizationMode: productionOnce ? "production-once" : "human-review" });
  const videos = spec.scenes.map((scene) => add(`video:${scene.id}`, "omni-video", [`keyframe:${scene.id}`, "animatic-approval"], "paid", "video", { scene: { id: scene.id, motionPrompt: scene.motionPrompt, onScreenText: scene.onScreenText, textRendering: scene.textRendering, references: scene.references, task: scene.generationTask ?? "image_to_video" }, format: spec.formats.master }));
  const visualOutputs = spec.scenes.map((scene, index) => {
    if (scene.graphics?.renderer === "html-canvas@1") return add(`html-motion:${scene.id}`, "html-motion", [videos[index], "timeline-lock"], "local", "local-cpu", { text: scene.onScreenText, documentAssetId: scene.graphics.documentAssetId, renderer: scene.graphics.renderer, role: scene.role, format: spec.formats.master });
    if (scene.textRendering === "local-gc" && scene.onScreenText) motionAssDocument([{ text: scene.onScreenText, start: 0, end: 1 }], { aspect: spec.formats.master });
    return scene.textRendering !== "local-gc" ? videos[index] : add(`motion:${scene.id}`, "motion-graphics", [videos[index], "timeline-lock"], "local", "local-cpu", { text: scene.onScreenText, role: scene.role, format: spec.formats.master, brandKit: spec.brandKit });
  });
  const durationAttestations = visualOutputs.map((nodeId, index) => add(`clip-duration:${spec.scenes[index].id}`, "media-probe", [nodeId], "local", "local-cpu", { sceneId: spec.scenes[index].id, expectedFrames: timeline.tracks[0].spans[index].durationFrames }));
  const sceneOutputs = spec.qa.enabled ? durationAttestations.map((nodeId, index) => add(`qa-scene:${spec.scenes[index].id}`, "qa-scene", [nodeId], spec.qa.semanticScenes ? "semantic-paid" : "local", spec.qa.semanticScenes ? "qa" : "local-cpu", { policy: spec.qa.policy, expectedText: spec.scenes[index].onScreenText ?? null })) : durationAttestations;
  add("assembly", "assembly", [...sceneOutputs, "timeline-lock"], "local", "local-cpu", { transition: timeline.transition, ending: spec.finishing.ending, ...(spec.finishing.audio?.sceneAudioGainDb != null ? { preserveAudio: true } : {}) });
  const sfxAssets = localSfxAssets(spec);
  const sceneAudio = spec.finishing.audio?.sceneAudioGainDb != null;
  const audioMix = voice || music || spec.finishing.audio?.ambienceFile || sfxAssets.length || sceneAudio ? add("audio-mix", "audio-mix", [...(voice ? [voice] : []), ...(music ? ["music-fit"] : []), ...(sceneAudio ? ["assembly"] : [])], "local", "local-cpu", { audio: spec.finishing.audio, ...(sfxAssets.length ? { assets: sfxAssets } : {}) }) : null;
  const masterDependencies = ["assembly", ...(audioMix ? [audioMix] : []), ...(!audioMix && music ? ["music-fit"] : [])];
  add("master", "master-audio-video", masterDependencies, "local", "local-cpu", { audio: spec.finishing.audio });
  let previous = "master";
  if (spec.captions.mode !== "none") previous = add("captions", "captions", [previous, "alignment"], "local", "local-cpu", { captions: spec.captions, format: spec.formats.master });
  for (const operation of validatePostProduction(spec.finishing.postProduction, timeline.durationFrames)) {
    const assets = operation.assetId == null ? [] : spec.resources.filter(asset => asset.id === operation.assetId);
    if (operation.assetId != null && (assets.length !== 1 || assets[0].role !== "logo" || assets[0].mediaKind !== "image")) throw new Error("Pós-produção exige asset image/logo existente.");
    previous = add(`post:${operation.id}`, "post-production", [previous], "local", "local-cpu", { operation, assets, expectedFrames: timeline.durationFrames, timeBase: timeline.timeBase });
  }
  if (spec.qa.enabled) previous = add("qa-master", "qa", [previous], spec.qa.semantic ? "semantic-paid" : "local", spec.qa.semantic ? "qa" : "local-cpu", { qa: spec.qa });
  if (spec.finishing.delivery) previous = add("delivery", "delivery", [previous], "local", "local-cpu", { delivery: spec.finishing.delivery });
  for (const variant of spec.formats.variants) add(`variant:${variant.format.replace(":", "x")}`, "variant", [previous, "timeline-lock"], "local", "local-cpu", { ...variant, timelineFingerprint: timeline.fingerprint });
  return nodes;
}

export function compileFilmSpec(raw, { providerCapabilities } = {}) {
  const spec = normalizeFilmSpecV2(raw);
  const brandLint = assertFilmBrand(spec);
  const timeline = compileTimeline(spec);
  const nodes = compileNodes(spec, timeline);
  const plan = {
    schema: EXECUTION_PLAN_SCHEMA,
    compilerVersion: FILM_COMPILER_VERSION,
    spec,
    timeline,
    nodes,
    brief: clone(spec.brief),
    knowledgeContextBinding: clone(spec.knowledgeContextBinding),
    decisionArtifacts: clone(spec.decisionArtifacts),
    creativeDirection: clone(spec.creativeDirection),
    productionContextBinding: clone(spec.productionContextBinding),
    budget: clone(spec.execution.budget),
    concurrency: clone(spec.execution.concurrency),
    policies: { brandLint, qa: spec.qa.enabled ? clone(spec.qa.policy) : null, captions: spec.captions.mode === "none" ? null : clone(spec.captions.style) },
    compatibility: { legacyExecutorSpec: legacyFromV2(spec) },
  };
  plan.governance = createExecutionGovernance(plan, providerCapabilities ? { providerCapabilities } : {});
  plan.capabilitySnapshotHash = plan.governance.capabilitySnapshotHash;
  return { ...plan, fingerprint: operationFingerprint(plan) };
}

export function adaptExecutionPlanToLegacy(plan) {
  if (plan?.schema !== EXECUTION_PLAN_SCHEMA || !plan?.compatibility?.legacyExecutorSpec) throw new Error("execution-plan@1 incompatível com o executor legado.");
  const legacy = clone(plan.compatibility.legacyExecutorSpec);
  if (plan.timeline?.locked === true && plan.spec?.compatibility?.sourceSchema !== "mkt-videos/film-spec@1") {
    const spans = plan.timeline.tracks?.find((track) => track.id === "video")?.spans ?? [];
    legacy.assembly ??= {};
    legacy.assembly.sceneFrameTargets = spans.map((span) => ({ sceneId: span.sceneId, plannedFrames: span.durationFrames }));
    legacy.assembly.expectedMasterFrames = plan.timeline.durationFrames;
    legacy.assembly.planFingerprint = plan.fingerprint;
    if (legacy.qa !== false) {
      legacy.qa ??= {};
      legacy.qa.expectedDuration = plan.timeline.durationFrames * plan.timeline.timeBase.numerator / plan.timeline.timeBase.denominator;
      legacy.qa.expectedFrames = plan.timeline.durationFrames;
      legacy.qa.assertions = clone(plan.spec?.qa?.assertions ?? []);
    }
  }
  if (plan.spec?.brief != null) legacy.brief = clone(plan.spec.brief);
  if (plan.spec?.knowledgeContext != null) legacy.knowledgeContext = clone(plan.spec.knowledgeContext);
  if (plan.knowledgeContextBinding != null) legacy.knowledgeContextBinding = clone(plan.knowledgeContextBinding);
  if (plan.spec?.decisionArtifacts != null) legacy.decisionArtifacts = clone(plan.spec.decisionArtifacts);
  if (plan.spec?.creativeDirection != null) legacy.creativeDirection = clone(plan.spec.creativeDirection);
  if (plan.spec?.styleComposition != null) legacy.styleComposition = clone(plan.spec.styleComposition);
  if (plan.productionContextBinding != null) legacy.productionContextBinding = clone(plan.productionContextBinding);
  return legacy;
}
