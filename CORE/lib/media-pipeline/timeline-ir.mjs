import { operationFingerprint } from "./pipeline-operation.mjs";

export const TIMELINE_V1_SCHEMA = "mkt-videos/timeline@1";
export const TIMELINE_V2_SCHEMA = "mkt-videos/timeline@2";
export const MOTION_IR_SCHEMA = "mkt-videos/motion-ir@1";
export const TIMELINE_SHADOW_SCHEMA = "mkt-videos/timeline-shadow@1";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function integer(value, label, { min = 0, nullable = false } = {}) {
  if (nullable && value == null) return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) {
    throw new Error(`${label} deve ser inteiro seguro${min > 0 ? ` >= ${min}` : ""}.`);
  }
  return normalized;
}

function rational(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} exige uma razão.`);
  }
  const numerator = integer(value.numerator, `${label}.numerator`, { min: 1 });
  const denominator = integer(value.denominator, `${label}.denominator`, { min: 1 });
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function requiredId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    throw new Error(`${label} é inválido.`);
  }
  if (/[\\/]|(?:^|[.:])(?:cookie|token|secret|password)(?:$|[.:])/i.test(normalized)) {
    throw new Error(`${label} não pode carregar path ou segredo.`);
  }
  return normalized;
}

function fingerprinted(body, label) {
  const fingerprint = operationFingerprint(body);
  return Object.freeze({ ...clone(body), fingerprint });
}

function assertFingerprint(value, label) {
  if (!value || typeof value !== "object" || typeof value.fingerprint !== "string") {
    throw new Error(`${label} exige fingerprint.`);
  }
  const body = clone(value);
  delete body.fingerprint;
  if (operationFingerprint(body) !== value.fingerprint) {
    throw new Error(`${label} diverge do fingerprint canônico.`);
  }
  return value;
}

function validateSpan(span, label) {
  if (!span || typeof span !== "object" || Array.isArray(span)) throw new Error(`${label} inválido.`);
  const sceneId = requiredId(span.sceneId, `${label}.sceneId`);
  const order = integer(span.order, `${label}.order`);
  const startFrame = integer(span.startFrame, `${label}.startFrame`, { nullable: true });
  const durationFrames = integer(span.durationFrames, `${label}.durationFrames`, { min: 1, nullable: true });
  const endFrame = integer(span.endFrame, `${label}.endFrame`, { nullable: true });
  if (durationFrames == null && endFrame != null) throw new Error(`${label} não pode ter endFrame sem duração.`);
  if (durationFrames != null && (startFrame == null || endFrame == null)) throw new Error(`${label} exige start/end quando possui duração.`);
  if (startFrame != null && durationFrames != null && endFrame !== startFrame + durationFrames) {
    throw new Error(`${label} viola endFrame = startFrame + durationFrames.`);
  }
  return { sceneId, order, startFrame, durationFrames, endFrame };
}

export function assertTimelineV1(value) {
  if (value?.schema !== TIMELINE_V1_SCHEMA) throw new Error(`Schema esperado: ${TIMELINE_V1_SCHEMA}.`);
  assertFingerprint(value, "timeline@1");
  const timeBase = rational(value.timeBase, "timeline.timeBase");
  const fps = rational(value.fps, "timeline.fps");
  if (!Array.isArray(value.tracks) || !Array.isArray(value.markers)) throw new Error("timeline@1 exige tracks e markers.");
  const trackIds = new Set();
  const tracks = value.tracks.map((track, trackIndex) => {
    const id = requiredId(track?.id, `timeline.tracks[${trackIndex}].id`);
    if (trackIds.has(id)) throw new Error(`Track duplicada: ${id}.`);
    trackIds.add(id);
    const rangeTrack = !Array.isArray(track.spans);
    if (rangeTrack && (track.startFrame == null || !("durationFrames" in track))) throw new Error(`Track ${id} exige spans ou range temporal.`);
    const spans = rangeTrack
      ? [{
        sceneId: id,
        order: 0,
        startFrame: track.startFrame,
        durationFrames: track.durationFrames,
        endFrame: track.durationFrames == null ? null : Number(track.startFrame) + Number(track.durationFrames),
      }]
      : track.spans;
    return {
      ...clone(track),
      id,
      sourceForm: rangeTrack ? "range" : "spans",
      spans: spans.map((span, index) => validateSpan(span, `timeline.tracks[${trackIndex}].spans[${index}]`)),
    };
  });
  const durationFrames = integer(value.durationFrames, "timeline.durationFrames", { nullable: true });
  const normalized = {
    ...clone(value),
    timeBase,
    fps,
    durationFrames,
    tracks,
  };
  return normalized;
}

function sourceId(track, clip, index) {
  const value = clip.source ?? track.source ?? null;
  return value == null ? null : requiredId(value, `clip[${index}].source`);
}

export function timelineV1ToV2(value, { sourceProvenance = null } = {}) {
  const source = assertTimelineV1(value);
  const tracks = source.tracks.map((track) => ({
    id: track.id,
    kind: requiredId(track.kind, `track ${track.id}.kind`),
    ...(track.source == null ? {} : { source: requiredId(track.source, `track ${track.id}.source`) }),
    metadata: { sourceForm: track.sourceForm, sourcePresent: Object.hasOwn(track, "source") },
    clips: track.spans.map((span, index) => ({
      id: `${track.id}:${span.sceneId}:${index}`,
      source: sourceId(track, span, index),
      sceneId: span.sceneId,
      order: span.order,
      startFrame: span.startFrame,
      durationFrames: span.durationFrames,
      endFrameExclusive: span.endFrame,
    })),
  }));
  const assets = [...new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.source).filter(Boolean)))]
    .sort()
    .map((id) => ({ id, kind: "logical-source" }));
  const body = {
    schema: TIMELINE_V2_SCHEMA,
    timeBase: clone(source.timeBase),
    fps: clone(source.fps),
    frameRange: { startFrame: 0, endFrameExclusive: source.durationFrames },
    locked: Boolean(source.locked),
    transition: clone(source.transition),
    assets,
    tracks,
    markers: clone(source.markers),
    metadata: {
      sourceSchema: TIMELINE_V1_SCHEMA,
      sourceFingerprint: source.fingerprint,
    },
    sourceProvenance: sourceProvenance == null ? null : clone(sourceProvenance),
  };
  return fingerprinted(body, "timeline@2");
}

function validateV2Clip(clip, trackId, index) {
  const label = `timeline@2 track ${trackId}.clips[${index}]`;
  const id = requiredId(clip?.id, `${label}.id`);
  const sceneId = clip.sceneId == null ? null : requiredId(clip.sceneId, `${label}.sceneId`);
  const order = clip.order == null ? null : integer(clip.order, `${label}.order`);
  const startFrame = integer(clip.startFrame, `${label}.startFrame`, { nullable: true });
  const durationFrames = integer(clip.durationFrames, `${label}.durationFrames`, { min: 1, nullable: true });
  const endFrameExclusive = integer(clip.endFrameExclusive, `${label}.endFrameExclusive`, { nullable: true });
  if (durationFrames == null && endFrameExclusive != null) throw new Error(`${label} não pode ter endFrameExclusive sem duração.`);
  if (durationFrames != null && (startFrame == null || endFrameExclusive == null)) throw new Error(`${label} exige start/end quando possui duração.`);
  if (startFrame != null && durationFrames != null && endFrameExclusive !== startFrame + durationFrames) throw new Error(`${label} possui range inconsistente.`);
  return {
    ...clone(clip),
    id,
    ...(clip.source == null ? { source: null } : { source: requiredId(clip.source, `${label}.source`) }),
    sceneId,
    order,
    startFrame,
    durationFrames,
    endFrameExclusive,
  };
}

export function assertTimelineV2(value) {
  if (value?.schema !== TIMELINE_V2_SCHEMA) throw new Error(`Schema esperado: ${TIMELINE_V2_SCHEMA}.`);
  assertFingerprint(value, "timeline@2");
  const timeBase = rational(value.timeBase, "timeline@2.timeBase");
  const fps = rational(value.fps, "timeline@2.fps");
  if (!value.frameRange || typeof value.frameRange !== "object") throw new Error("timeline@2 exige frameRange.");
  const startFrame = integer(value.frameRange.startFrame, "timeline@2.frameRange.startFrame");
  const endFrameExclusive = integer(value.frameRange.endFrameExclusive, "timeline@2.frameRange.endFrameExclusive", { nullable: true });
  if (endFrameExclusive != null && endFrameExclusive < startFrame) throw new Error("timeline@2.frameRange é inválido.");
  if (!Array.isArray(value.tracks) || !Array.isArray(value.assets) || !Array.isArray(value.markers)) throw new Error("timeline@2 exige assets, tracks e markers.");
  const trackIds = new Set();
  const tracks = value.tracks.map((track, trackIndex) => {
    const id = requiredId(track?.id, `timeline@2.tracks[${trackIndex}].id`);
    if (trackIds.has(id)) throw new Error(`Track timeline@2 duplicada: ${id}.`);
    trackIds.add(id);
    if (!Array.isArray(track.clips)) throw new Error(`Track timeline@2 ${id} exige clips.`);
    const clipIds = new Set();
    const clips = track.clips.map((clip, index) => {
      const normalized = validateV2Clip(clip, id, index);
      if (clipIds.has(normalized.id)) throw new Error(`Clip timeline@2 duplicado: ${normalized.id}.`);
      clipIds.add(normalized.id);
      return normalized;
    });
    return { ...clone(track), id, clips };
  });
  const normalized = { ...clone(value), timeBase, fps, frameRange: { startFrame, endFrameExclusive }, tracks };
  return normalized;
}

export function timelineV2ToV1(value) {
  const source = assertTimelineV2(value);
  const tracks = source.tracks.map((track) => {
    const clips = track.clips;
    if (track.metadata?.sourceForm === "range" && clips.length === 1) {
      const [clip] = clips;
      return {
        id: track.id,
        kind: track.kind,
        ...(track.metadata?.sourcePresent ? { source: track.source ?? null } : {}),
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
      };
    }
    return {
      id: track.id,
      kind: track.kind,
      ...(track.metadata?.sourcePresent ? { source: track.source ?? null } : {}),
      spans: clips.map((clip) => ({
        sceneId: clip.sceneId ?? clip.id,
        order: clip.order ?? 0,
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        endFrame: clip.endFrameExclusive,
      })),
    };
  });
  const body = {
    schema: TIMELINE_V1_SCHEMA,
    timeBase: clone(source.timeBase),
    fps: clone(source.fps),
    locked: Boolean(source.locked),
    durationFrames: source.frameRange.endFrameExclusive,
    transition: clone(source.transition),
    tracks,
    markers: clone(source.markers),
  };
  return fingerprinted(body, "timeline@1");
}

export function motionIrFromTimelineV2(value, { determinismClass = "frame-exact", seed = "timeline-seed@1" } = {}) {
  const source = assertTimelineV2(value);
  if (!new Set(["bit-exact", "frame-exact", "perceptual-stable", "non-deterministic"]).has(determinismClass)) throw new Error("Classe de determinismo inválida.");
  const body = {
    schema: MOTION_IR_SCHEMA,
    version: 1,
    timeBase: clone(source.timeBase),
    frameRate: clone(source.fps),
    frameRange: clone(source.frameRange),
    transition: clone(source.transition),
    assets: clone(source.assets),
    tracks: source.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      layers: [{ id: `layer:${track.id}`, clips: clone(track.clips) }],
    })),
    markers: clone(source.markers),
    metadata: clone(source.metadata ?? {}),
    sourceProvenance: clone(source.sourceProvenance ?? null),
    determinism: { class: determinismClass, seed: requiredId(seed, "motionIr.determinism.seed") },
  };
  return fingerprinted(body, "motion-ir@1");
}

export function assertMotionIr(value) {
  if (value?.schema !== MOTION_IR_SCHEMA || value.version !== 1) throw new Error("Motion IR incompatível.");
  if (!Array.isArray(value.tracks) || !value.frameRange || !value.determinism) throw new Error("Motion IR exige tracks, frameRange e determinism.");
  const trackIds = new Set();
  for (const [index, track] of value.tracks.entries()) {
    const id = requiredId(track?.id, `motionIr.tracks[${index}].id`);
    if (trackIds.has(id)) throw new Error(`Motion IR track duplicada: ${id}.`);
    trackIds.add(id);
    if (!Array.isArray(track.layers) || !track.layers.length) throw new Error(`Motion IR track ${id} exige layer.`);
    for (const [layerIndex, layer] of track.layers.entries()) {
      requiredId(layer?.id, `motionIr.tracks[${index}].layers[${layerIndex}].id`);
      if (!Array.isArray(layer.clips)) throw new Error(`Motion IR layer ${layerIndex} exige clips.`);
    }
  }
  return assertFingerprint(value, "motion-ir@1");
}

export function motionIrToTimelineV2(value) {
  const source = assertMotionIr(value);
  const body = {
    schema: TIMELINE_V2_SCHEMA,
    timeBase: clone(source.timeBase),
    fps: clone(source.frameRate),
    frameRange: clone(source.frameRange),
    locked: source.frameRange.endFrameExclusive != null,
    transition: clone(source.transition ?? { type: "cut", durationFrames: 0 }),
    assets: clone(source.assets ?? []),
    tracks: source.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      clips: track.layers.flatMap((layer) => clone(layer.clips)),
    })),
    markers: clone(source.markers ?? []),
    metadata: { ...clone(source.metadata ?? {}), motionIrFingerprint: source.fingerprint },
    sourceProvenance: clone(source.sourceProvenance ?? null),
  };
  return fingerprinted(body, "timeline@2");
}

export function buildTimelineShadow(timelineV1, options = {}) {
  const timelineV2 = timelineV1ToV2(timelineV1, options);
  const motionIr = motionIrFromTimelineV2(timelineV2, options);
  const roundTripV1 = timelineV2ToV1(timelineV2);
  return {
    schema: TIMELINE_SHADOW_SCHEMA,
    providerFree: true,
    effect: "none",
    sourceFingerprint: timelineV1.fingerprint,
    timelineV2,
    motionIr,
    roundTripV1,
    roundTripEquivalent: operationFingerprint(roundTripV1) === operationFingerprint(timelineV1),
  };
}
