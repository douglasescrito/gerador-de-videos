import { buildCommercialJobs, validateSpec } from "./commercial.mjs";
import { compileFilmSpec, FILM_SPEC_V2_SCHEMA } from "./film-compiler.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { DEFAULT_COMMERCIAL_BRAND_KIT } from "./studio-policies.mjs";

export const COMMERCIAL_PROFILE_SCHEMA = "mkt-videos/commercial-profile@1";

export function commercialProfileToFilmSpec(commercialSpec, { logoImage = null, brandKit = DEFAULT_COMMERCIAL_BRAND_KIT } = {}) {
  const commercial = validateSpec(commercialSpec);
  const jobs = buildCommercialJobs(commercial, { logoImage });
  const fps = Number(commercial.assembly.fps ?? 30);
  const scenes = commercial.scenes.map((scene, index) => {
    const job = jobs[index];
    const identity = job.task === "reference_to_video";
    return {
      id: scene.id,
      role: identity ? "identity" : "typography",
      objective: scene.text,
      visualPrompt: job.prompt,
      motionPrompt: job.prompt,
      onScreenText: scene.text,
      references: structuredClone(job.images ?? []),
      restrictions: identity ? ["preserve-logo-exactly"] : ["exact-text"],
      style: null,
      generationTask: job.task,
      durationHint: Number(scene.span[1]) - Number(scene.span[0]) + (identity ? Number(commercial.assembly.holdTailSeconds ?? 0) : 0),
      image: { model: null, size: null },
      commercial: { sourceStyle: scene.style, sourceSpan: structuredClone(scene.span), settleOffset: scene.settleOffset ?? null },
    };
  });
  const profileBase = { schema: COMMERCIAL_PROFILE_SCHEMA, version: 1, commercial, logoImage, brandKit: { id: brandKit.id, version: brandKit.version, hash: brandKit.hash } };
  return {
    schema: FILM_SPEC_V2_SCHEMA,
    name: commercial.name,
    source: { request: null, directionPreset: null, effectiveDirection: "commercial-profile@1" },
    narration: { mode: "none", text: null, blocks: [] },
    music: { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    timeline: { fps: { numerator: fps, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 },
    scenes,
    formats: { master: commercial.aspect, variants: [] },
    brandKit: structuredClone(brandKit),
    captions: { mode: "none" },
    qa: { enabled: true, semantic: false, policy: "strict@1", gate: "block" },
    reuse: { policy: "off" },
    execution: { concurrency: { draft: 3, video: 3, localCpu: 1 }, budget: { image: 0, tts: 0, music: 0, omni: scenes.length, semanticQa: 0 }, providers: {} },
    finishing: { audio: {}, assembly: { transition: "cut", transitionDuration: 1 / fps, fps }, delivery: null },
    compatibility: { sourceSchema: commercial.schema, commercialJobs: jobs, commercialProfile: { ...profileBase, hash: operationFingerprint(profileBase) } },
  };
}

export function compileCommercialProfile(commercialSpec, options = {}) {
  const spec = commercialProfileToFilmSpec(commercialSpec, options);
  return { profile: spec.compatibility.commercialProfile, spec, executionPlan: compileFilmSpec(spec) };
}
