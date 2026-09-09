import { operationFingerprint } from "./pipeline-operation.mjs";
import {
  assertMotionIr,
  assertTimelineV2,
  motionIrToTimelineV2,
  timelineV1ToV2,
  TIMELINE_V1_SCHEMA,
  TIMELINE_V2_SCHEMA,
  MOTION_IR_SCHEMA,
} from "./timeline-ir.mjs";

export const TIMELINE_PREVIEW_SCHEMA = "mkt-videos/timeline-preview@1";

function finite(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} deve ser numérico.`);
  return number;
}

function safeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256 || /[\\/]/.test(normalized) || /(?:^|[.:])(cookie|token|secret|password)(?:$|[.:])/i.test(normalized)) throw new Error(`${label} contém path ou segredo.`);
  return normalized;
}

function seconds(frame, fps) {
  return frame == null ? null : Number((Number(frame) * fps.denominator / fps.numerator).toFixed(6));
}

function normalizedTimeline(value) {
  if (value?.schema === TIMELINE_V1_SCHEMA) return timelineV1ToV2(value);
  if (value?.schema === TIMELINE_V2_SCHEMA) return assertTimelineV2(value);
  if (value?.schema === MOTION_IR_SCHEMA) return motionIrToTimelineV2(assertMotionIr(value));
  throw new Error("Timeline preview exige timeline@1, timeline@2 ou motion-ir@1.");
}

export function buildTimelinePreview({ timeline, maxClips = 2_000 } = {}) {
  const source = normalizedTimeline(timeline);
  const fps = source.fps;
  const clips = source.tracks.flatMap((track) => track.clips.map((clip) => ({ trackId: track.id, kind: track.kind, clip })));
  if (!Number.isSafeInteger(Number(maxClips)) || Number(maxClips) < 1 || clips.length > Number(maxClips)) throw new Error("timeline preview excede o limite de clips.");
  const body = {
    schema: TIMELINE_PREVIEW_SCHEMA,
    providerFree: true,
    effect: "none",
    sourceSchema: timeline?.schema,
    sourceFingerprint: timeline?.fingerprint ?? null,
    fps,
    frameRange: source.frameRange,
    durationSeconds: seconds(source.frameRange.endFrameExclusive, fps),
    tracks: source.tracks.map((track) => ({
      id: safeId(track.id, "timelinePreview.track.id"),
      kind: safeId(track.kind, `timelinePreview.track.${track.id}.kind`),
      clipCount: track.clips.length,
      clips: track.clips.map((clip, index) => ({
        id: safeId(clip.id, `timelinePreview.track.${track.id}.clips[${index}].id`),
        sceneId: clip.sceneId == null ? null : safeId(clip.sceneId, `timelinePreview.track.${track.id}.sceneId`),
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        endFrameExclusive: clip.endFrameExclusive,
        startSeconds: seconds(clip.startFrame, fps),
        endSeconds: seconds(clip.endFrameExclusive, fps),
        sourcePresent: clip.source != null,
      })),
    })),
    markers: (Array.isArray(source.markers) ? source.markers : []).map((marker, index) => ({
      id: marker?.id == null ? `marker-${index + 1}` : safeId(marker.id, `timelinePreview.markers[${index}].id`),
      frame: finite(marker?.frame ?? marker?.startFrame, `timelinePreview.markers[${index}].frame`, { nullable: true }),
      label: marker?.label == null ? null : String(marker.label).slice(0, 160),
    })),
    assetCount: Array.isArray(source.assets) ? source.assets.length : 0,
  };
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertTimelinePreview(value) {
  if (!value || value.schema !== TIMELINE_PREVIEW_SCHEMA || value.providerFree !== true || value.effect !== "none") throw new Error("Timeline preview inválido.");
  const { fingerprint, ...body } = value;
  if (fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint da timeline preview divergente.");
  return true;
}

