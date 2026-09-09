export const RECIPE_REGISTRIES_SCHEMA = "gerador-de-videos/recipe-registries@1";

export const RECIPE_TRANSITIONS = Object.freeze({
  "cut@1": Object.freeze({ id: "cut@1", ffmpeg: "cut", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 0, maximumFrames: 0 } }),
  "fade@1": Object.freeze({ id: "fade@1", ffmpeg: "fade", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
  "dissolve@1": Object.freeze({ id: "dissolve@1", ffmpeg: "dissolve", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
  "wipe-left@1": Object.freeze({ id: "wipe-left@1", ffmpeg: "wipeleft", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
  "wipe-right@1": Object.freeze({ id: "wipe-right@1", ffmpeg: "wiperight", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
  "slide-left@1": Object.freeze({ id: "slide-left@1", ffmpeg: "slideleft", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
  "slide-right@1": Object.freeze({ id: "slide-right@1", ffmpeg: "slideright", capability: "ffmpeg-local:hybrid-compose", duration: { minimumFrames: 1 } }),
});

export const RECIPE_GRAPHICS_RENDERERS = Object.freeze({
  "none@1": Object.freeze({ id: "none@1", capability: null, consumer: "film-compiler:scene" }),
  "local-gc@1": Object.freeze({ id: "local-gc@1", capability: "ffmpeg-local:hybrid-compose", consumer: "motion-graphics" }),
  "html-canvas@1": Object.freeze({ id: "html-canvas@1", capability: "playwright-html-local:html-render", consumer: "html-motion-pilot" }),
});

export const RECIPE_POST_OPERATIONS = Object.freeze({
  "color-normalize@1": Object.freeze({ id: "color-normalize@1", capability: "ffmpeg-local:hybrid-compose", consumer: "post-production" }),
  "logo-overlay@1": Object.freeze({ id: "logo-overlay@1", capability: "ffmpeg-local:hybrid-compose", consumer: "post-production" }),
  "ending-hold@1": Object.freeze({ id: "ending-hold@1", capability: "ffmpeg-local:hybrid-compose", consumer: "post-production" }),
});

export const RECIPE_QA_POLICIES = Object.freeze({
  "strict@1": Object.freeze({ id: "strict@1", semantic: false, consumer: "qa", assertion: "technical-master-gate" }),
});

export const RECIPE_DELIVERY_TARGETS = Object.freeze({
  "local-output@1": Object.freeze({ id: "local-output@1", external: false, consumer: "delivery" }),
  "drive-daily@1": Object.freeze({ id: "drive-daily@1", external: true, consumer: "drive-deliver", confirmation: "confirm-drive-write" }),
});

export const RECIPE_VARIANT_FORMATS = Object.freeze(["16:9", "9:16", "1:1"]);

export function getRecipeRegistries() {
  return structuredClone({
    schema: RECIPE_REGISTRIES_SCHEMA,
    transitions: RECIPE_TRANSITIONS,
    graphicsRenderers: RECIPE_GRAPHICS_RENDERERS,
    postOperations: RECIPE_POST_OPERATIONS,
    qaPolicies: RECIPE_QA_POLICIES,
    deliveryTargets: RECIPE_DELIVERY_TARGETS,
    variantFormats: RECIPE_VARIANT_FORMATS,
  });
}

