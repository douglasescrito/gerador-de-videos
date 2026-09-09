import {
  assertStyleSpecEvidenceClaim,
  reconcileStyleSpecEvidence,
} from "./style-evidence-reconciliation.mjs";

import { materializeTechniques } from "./prompt-techniques.mjs";
import { listStyleControls, materializeStyleControls } from "./style-controls.mjs";
import { ESTILOS } from "./documentary-direction.mjs";

export const STYLE_SPEC_SCHEMA = "mkt-videos/style-spec@1";

// Compatibility alias for consumers that imported the old constant name.
// StyleSpec is now the only stored representation.
export const DIRECTION_PRESET_SCHEMA = STYLE_SPEC_SCHEMA;

const SELECTABLE_STATUSES = new Set(["pilot", "validated"]);
const STYLE_STATUSES = new Set(["concept", "pilot", "validated", "deprecated"]);
const CAPABILITY_LEVELS = new Set(["unsupported", "limited", "supported"]);
const TOPOLOGIES = new Set(["independent", "chained"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function optionalText(value, label) {
  if (value == null) return null;
  return requiredText(value, label);
}

function uniqueTextList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`);
  const normalized = value.map((item, index) => requiredText(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} não aceita itens duplicados.`);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normalizeGeneration(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  const allowedTasks = uniqueTextList(value.allowedTasks ?? [], `${label}.allowedTasks`);
  const allowedTopologies = uniqueTextList(value.allowedTopologies ?? ["independent"], `${label}.allowedTopologies`);
  if (!allowedTopologies.every((item) => TOPOLOGIES.has(item))) {
    throw new Error(`${label}.allowedTopologies aceita somente independent ou chained.`);
  }
  const defaultTask = optionalText(value.defaultTask, `${label}.defaultTask`);
  if (defaultTask && !allowedTasks.includes(defaultTask)) throw new Error(`${label}.defaultTask deve constar em allowedTasks.`);
  const defaultTopology = requiredText(value.defaultTopology ?? "independent", `${label}.defaultTopology`);
  if (!allowedTopologies.includes(defaultTopology)) throw new Error(`${label}.defaultTopology deve constar em allowedTopologies.`);
  return {
    allowedTasks,
    ...(defaultTask ? { defaultTask } : {}),
    allowedTopologies,
    defaultTopology,
    continuityRequired: Boolean(value.continuityRequired),
  };
}

function normalizeFormats(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  const allowedAspects = uniqueTextList(value.allowedAspects ?? [], `${label}.allowedAspects`);
  const typicalClipSeconds = value.typicalClipSeconds == null ? null : value.typicalClipSeconds;
  if (
    typicalClipSeconds != null
    && (
      !Array.isArray(typicalClipSeconds)
      || typicalClipSeconds.length !== 2
      || typicalClipSeconds.some((item) => !Number.isFinite(item) || item <= 0)
      || typicalClipSeconds[0] > typicalClipSeconds[1]
    )
  ) {
    throw new Error(`${label}.typicalClipSeconds deve ser [mínimo, máximo] positivo.`);
  }
  return {
    allowedAspects,
    ...(typicalClipSeconds ? { typicalClipSeconds: [...typicalClipSeconds] } : {}),
  };
}

function normalizeCapabilities(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  const normalized = {};
  for (const [key, level] of Object.entries(value)) {
    if (!CAPABILITY_LEVELS.has(level)) {
      throw new Error(`${label}.${key} aceita somente unsupported, limited ou supported.`);
    }
    normalized[key] = level;
  }
  return normalized;
}

function normalizeRuntimeInputs(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  const maxReferences = Number(value.maxReferences ?? 4);
  if (!Number.isInteger(maxReferences) || maxReferences < 0 || maxReferences > 4) {
    throw new Error(`${label}.maxReferences deve ser inteiro entre 0 e 4.`);
  }
  return {
    requiredRoles: uniqueTextList(value.requiredRoles ?? [], `${label}.requiredRoles`),
    maxReferences,
  };
}

function normalizeEvidence(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`);
  return value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${entryLabel} deve ser um objeto.`);
    return {
      file: requiredText(entry.file, `${entryLabel}.file`),
      sha256: requiredText(entry.sha256, `${entryLabel}.sha256`),
      timeRanges: uniqueTextList(entry.timeRanges ?? [], `${entryLabel}.timeRanges`),
      usage: requiredText(entry.usage ?? "local-study-only", `${entryLabel}.usage`),
      rightsStatus: requiredText(entry.rightsStatus, `${entryLabel}.rightsStatus`),
    };
  });
}

function normalizeValidation(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  const humanVerdict = value.humanVerdict ?? null;
  if (humanVerdict != null && !new Set(["accepted", "limited", "rejected"]).has(humanVerdict)) {
    throw new Error(`${label}.humanVerdict inválido.`);
  }
  return {
    model: optionalText(value.model, `${label}.model`),
    checkedAt: optionalText(value.checkedAt, `${label}.checkedAt`),
    receiptIds: uniqueTextList(value.receiptIds ?? [], `${label}.receiptIds`),
    aspects: uniqueTextList(value.aspects ?? [], `${label}.aspects`),
    humanVerdict,
    notes: uniqueTextList(value.notes ?? [], `${label}.notes`),
  };
}

function styleSpec(id, label, direction, {
  aspect = null,
  tags = [],
  family,
  status = null,
  studioOnly = true,
  generation = null,
  formats = null,
  capabilities = null,
  runtimeInputs = null,
  referenceEvidence = null,
  validation = null,
  risks = null,
  tradeoffs = null,
  supersedes = null,
} = {}) {
  const normalizedId = requiredText(id, "StyleSpec.id");
  if (!/@\d+$/.test(normalizedId)) throw new Error(`StyleSpec.id deve ser versionado: ${normalizedId}.`);
  const normalizedStatus = requiredText(status, `${normalizedId}.status`);
  if (!STYLE_STATUSES.has(normalizedStatus)) throw new Error(`${normalizedId}.status inválido: ${normalizedStatus}.`);

  const result = {
    schema: STYLE_SPEC_SCHEMA,
    id: normalizedId,
    label: requiredText(label, `${normalizedId}.label`),
    direction: requiredText(direction, `${normalizedId}.direction`),
    aspect: optionalText(aspect, `${normalizedId}.aspect`),
    tags: uniqueTextList(tags, `${normalizedId}.tags`),
    family: requiredText(family, `${normalizedId}.family`),
    status: normalizedStatus,
    studioOnly: Boolean(studioOnly),
  };
  if (generation) result.generation = normalizeGeneration(generation, `${normalizedId}.generation`);
  if (formats) result.formats = normalizeFormats(formats, `${normalizedId}.formats`);
  if (capabilities) result.capabilities = normalizeCapabilities(capabilities, `${normalizedId}.capabilities`);
  if (runtimeInputs) result.runtimeInputs = normalizeRuntimeInputs(runtimeInputs, `${normalizedId}.runtimeInputs`);
  if (referenceEvidence) result.referenceEvidence = normalizeEvidence(referenceEvidence, `${normalizedId}.referenceEvidence`);
  if (validation) result.validation = normalizeValidation(validation, `${normalizedId}.validation`);
  if (risks) result.risks = uniqueTextList(risks, `${normalizedId}.risks`);
  if (tradeoffs) result.tradeoffs = tradeoffs.map((rule) => ({
    condition: requiredText(rule.condition, "tradeoff.condition"),
    affectedCapability: requiredText(rule.affectedCapability, "tradeoff.affectedCapability"),
    limitation: requiredText(rule.limitation, "tradeoff.limitation"),
    evidenceLevel: requiredText(rule.evidenceLevel, "tradeoff.evidenceLevel"),
    automaticFallback: false,
  }));
  if (supersedes) result.supersedes = requiredText(supersedes, `${normalizedId}.supersedes`);
  assertStyleSpecEvidenceClaim(result);
  result.compositionControls = listStyleControls(result);
  return deepFreeze(result);
}

export const STYLE_SPECS = Object.freeze({
  // Only the three extracted and verified styles are registered here. Adding
  // another experimental block must not silently grant it pilot availability.
  ...Object.fromEntries(Object.entries(ESTILOS).filter(([key]) => ["documentario-sobrio", "suspensao", "plantao"].includes(key)).map(([key, style]) => [`${key}@1`, styleSpec(
    `${key}@1`, style.nome, `For interview scenes only:\n${style.lugar}\n\nFor abstract art scenes only (no person or room):\n${style.identidadeArte}`,
    {
      family: "documentary", status: "pilot", aspect: "16:9",
      tags: ["documentary", "native-typography", key],
      tradeoffs: [{
        condition: key === "plantao" ? "native-semantic-band-insert@1" : "native-semantic-insert@1",
        affectedCapability: "onScreenText",
        limitation: key === "plantao" ? "provider-refusal-observed-with-confounded-context" : "exact-timing-and-spelling-require-artifact-inspection",
        evidenceLevel: "observed-local",
      }],
      validation: { notes: ["Blocos extraídos de produções locais; igualdade de composição verificada, eficácia não promovida."] },
      risks: [
        "Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.",
        "Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato.",
        key === "plantao"
          ? "Faixa vermelha observada em contexto escuro; luminosidade não foi isolada como causa. Recusa não autoriza fallback automático."
          : key === "suspensao"
            ? "Espaço vazio e luz lateral servem à espera; não transformar tensão em lentidão obrigatória."
            : "Sobriedade serve à observação; não obriga todo tema a usar sala de aula.",
      ],
    },
  )])),
  "cinematic-3d@1": styleSpec(
    "cinematic-3d@1",
    "Cinematic 3D",
    "Premium cinematic 3D animation with physically plausible materials, controlled depth of field, deliberate composition, soft global illumination, restrained natural movement, stable geometry, coherent hands and faces, and clean cinematic camera work.",
    { family: "cinematic", status: "pilot", tags: ["3d", "cinematic", "premium"] },
  ),
  "soft-realism@1": styleSpec(
    "soft-realism@1",
    "Soft realism",
    "Soft-realism animated video with believable proportions, natural textures, gentle cinematic lighting, subtle facial and body movement, restrained camera motion, and a polished editorial finish without claiming photorealistic identity reproduction.",
    { family: "editorial", status: "pilot", tags: ["soft-realism", "people", "editorial"] },
  ),
  "documentario@1": styleSpec(
    "documentario@1",
    "Documentário",
    "Documentary-broadcast visual direction with observational camera language, grounded environments, practical lighting, readable action, natural pacing, restrained transitions, and credible ambient sound design.",
    { family: "documentary", status: "pilot", tags: ["documentary", "broadcast", "natural"] },
  ),
  "aquarela-2d@1": styleSpec(
    "aquarela-2d@1",
    "Aquarela 2D",
    "Expressive 2D watercolor animation on textured paper, translucent pigment layers, visible soft brush edges, elegant negative space, organic shape transitions, gentle parallax, restrained linework, and handcrafted frame-to-frame motion.",
    { family: "illustration", status: "pilot", tags: ["2d", "watercolor", "organic"] },
  ),
  "flat-2d@1": styleSpec(
    "flat-2d@1",
    "Flat 2D",
    "Clean premium flat 2D motion graphics with crisp vector shapes, disciplined spacing, strong visual hierarchy, limited color palette, smooth kinetic transitions, legible typography when requested, no photorealism, and no unnecessary visual clutter.",
    { family: "motion-graphics", status: "pilot", tags: ["2d", "flat", "motion-graphics"] },
  ),
  "react-audiovisual@1": styleSpec(
    "react-audiovisual@1",
    "React audiovisual",
    "Interpret the user direction as a literal modern React, JSX and CSS audiovisual specification. Preserve component hierarchy, layout intent, tokens, state changes, motion timing and event order. Favor clean contemporary interface motion, disciplined spacing, glass or flat surfaces only when declared, stable geometry and a coherent 10-second composition. When reference images are supplied, treat them only as offscreen generative guidance unless the user explicitly marks one as <FIRST_FRAME>: frame zero must already be the first authored motion state, never a flashed reference image, poster frame, preview frame or later composition, and a complete reference logo must not appear before its declared reveal. When narration or sound cues are declared in code or comments, speak only the exact requested Brazilian Portuguese line and bind restrained sound effects precisely to their named visual events; do not add music, captions, extra speech or unscripted interface elements unless explicitly requested. End on a clean stable hold with no automatic fade-out.",
    {
      family: "motion-graphics",
      status: "pilot",
      tags: [
        "react",
        "jsx",
        "css",
        "motion-graphics",
        "narration",
        "sound-design",
      ],
      formats: { allowedAspects: ["16:9", "9:16"] },
    },
  ),
  "vertical-social@1": styleSpec(
    "vertical-social@1",
    "Vertical social",
    "Mobile-first vertical social video direction with a clear central subject, safe margins for platform UI, immediate visual hook, bold readable composition, purposeful motion, fast but coherent pacing, and no essential content near the frame edges.",
    {
      family: "social",
      status: "pilot",
      aspect: "9:16",
      tags: ["vertical", "social", "mobile"],
      formats: { allowedAspects: ["9:16"] },
    },
  ),
  "logo-fiel@1": styleSpec(
    "logo-fiel@1",
    "Logo fiel",
    "Use the supplied logo artwork with absolute fidelity. Do not redraw, redesign, restyle, recolor, re-letter, rotate, stretch, crop, distort, add to, or remove from it. Preserve exact shapes, proportions, spacing, lettering, and colors; animate only its reveal, placement, light, or surrounding environment.",
    {
      family: "brand",
      status: "pilot",
      tags: ["logo", "brand", "fidelity"],
      capabilities: { logo: "supported" },
    },
  ),
  "produto/streaks-de-luz@1": styleSpec(
    "produto/streaks-de-luz@1",
    "Streaks de luz",
    "Abstract premium product motion built from original luminous streaks, controlled long-exposure trails, layered depth, restrained bloom, clean negative space, and deliberate directional flow. Keep the composition non-figurative and free of text, logos, people, recognizable interfaces, or imitated signature sequences.",
    {
      family: "produto",
      status: "concept",
      tags: ["abstract", "light-streaks", "product-motion"],
      generation: {
        allowedTasks: ["image_to_video"],
        defaultTask: "image_to_video",
        allowedTopologies: ["independent"],
        defaultTopology: "independent",
        continuityRequired: false,
      },
      formats: { allowedAspects: ["16:9", "9:16"] },
      capabilities: {
        onScreenText: "unsupported",
        logo: "unsupported",
        people: "unsupported",
        synchronizedAudio: "unsupported",
      },
      runtimeInputs: { requiredRoles: [], maxReferences: 0 },
      risks: [
        "Concept provider-free: ainda não há promessa de reprodução pelo Omni.",
        "Não usar nomes de criadores, handles ou pedidos de imitação no prompt efetivo.",
      ],
    },
  ),
  "duelo-de-ditados@1": styleSpec(
    "duelo-de-ditados@1",
    "Duelo de Ditados",
    "Original theatrical audiovisual language for proverb duels. Stage each saying as a compact visual argument: a centered tableau with one bold geometric action, elastic timing, and a deliberate pause before the counter-saying flips the meaning. Let the first voice enter with ceremonial certainty—measured framing, warm stage light, upright composition—then let the opposing voice cut across with mischievous lateral motion, cooler accent light, and an expressive reaction that contradicts the words. Reuse one physical motif across neighboring scenes so the collection feels continuous, but give each block its own visual gag. Keep people fictional and stylized rather than recognizable, preserve a clear center-safe area for local Portuguese kinetic typography, leave exact text and music timing to the deterministic Studio finishing stage, and include no logos, watermarks, or imitation of an existing artist or catalog preset.",
    {
      aspect: "16:9",
      family: "narrative-typography",
      status: "concept",
      tags: ["proverb-duel", "kinetic-typography", "comic-counterpoint", "expressive-cuts"],
      generation: {
        allowedTasks: ["text_to_video", "image_to_video"],
        defaultTask: "text_to_video",
        allowedTopologies: ["independent", "chained"],
        defaultTopology: "independent",
        continuityRequired: true,
      },
      formats: { allowedAspects: ["16:9"], typicalClipSeconds: [15, 25] },
      capabilities: {
        onScreenText: "limited",
        logo: "unsupported",
        people: "supported",
        synchronizedAudio: "limited",
      },
      runtimeInputs: { requiredRoles: [], maxReferences: 0 },
      risks: [
        "Estilo novo em concept: dry-run e inspeção permitidos; geração live exige autorização específica de piloto.",
        "Texto exato e sincronismo musical devem ser concluídos no acabamento Studio local.",
        "Não usar nomes de artistas, handles ou pedidos de imitação no prompt efetivo.",
      ],
    },
  ),
});

export function isLiveSelectableStyleSpec(value) {
  if (!value || value.schema !== STYLE_SPEC_SCHEMA || !SELECTABLE_STATUSES.has(value.status)) {
    return false;
  }
  try {
    return reconcileStyleSpecEvidence(value).availability === "available";
  } catch {
    return false;
  }
}

// Compatibility view: all pilot StyleSpecs remain selectable through --style.
export const DIRECTION_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(STYLE_SPECS).filter(([, value]) => isLiveSelectableStyleSpec(value)),
));

export function listStyleSpecs({ includeConcepts = true, includeDeprecated = true } = {}) {
  return Object.values(STYLE_SPECS)
    .filter((value) => includeConcepts || value.status !== "concept")
    .filter((value) => includeDeprecated || value.status !== "deprecated")
    .map((value) => structuredClone(value));
}

export function listDirectionPresets() {
  return Object.values(DIRECTION_PRESETS).map((value) => structuredClone(value));
}

function styleSpecCandidate(value) {
  const requested = String(value ?? "").trim();
  if (!requested) return null;
  return STYLE_SPECS[requested] ?? STYLE_SPECS[`${requested}@1`] ?? null;
}

export function resolveStyleSpec(value, { allowConcept = false, allowDeprecated = false } = {}) {
  const requested = String(value ?? "").trim();
  if (!requested) return null;
  const selected = styleSpecCandidate(requested);
  if (!selected) throw new Error(`Estilo desconhecido: ${requested}. Use ${Object.keys(DIRECTION_PRESETS).join(", ")}.`);
  if (selected.status === "concept" && !allowConcept) {
    throw new Error(`Estilo ${selected.id} está em status concept e não pode ser selecionado para geração live.`);
  }
  if (selected.status === "deprecated" && !allowDeprecated) {
    throw new Error(`Estilo ${selected.id} está deprecated e não pode ser selecionado para nova geração.`);
  }
  return selected;
}

export function resolveDirectionPreset(value, { allowConcept = false } = {}) {
  try {
    return resolveStyleSpec(value, { allowConcept });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Estilo desconhecido:")) {
      throw new Error(`Preset desconhecido: ${String(value ?? "").trim()}. Use ${Object.keys(DIRECTION_PRESETS).join(", ")}.`);
    }
    throw error;
  }
}

export function composeDirection({
  userPrompt,
  style = null,
  techniques = [],
  components = null,
  onScreenText = [],
  task = null,
  allowConcept = false,
} = {}) {
  const literal = String(userPrompt ?? "").trim();
  if (!literal) throw new Error("userPrompt é obrigatório.");
  const selected = resolveDirectionPreset(style, { allowConcept });
  const selectedTechniques = Array.isArray(techniques) ? techniques : [];
  if (!selected) {
    // Técnica é composição, e composição exige a mesma porta do estilo. Sem
    // estilo selecionado o prompt continua literal, como manda o contrato.
    if (selectedTechniques.length > 0 || components != null) {
      throw new Error("Técnicas de prompt exigem modo studio com um estilo selecionado.");
    }
    return {
      userPrompt: literal,
      directionPreset: null,
      techniques: [],
      effectivePrompt: literal,
      compositionAuthorized: false,
      suggestedAspect: null,
    };
  }

  const materialized = materializeTechniques(selectedTechniques, {
    style: selected,
    task,
    allowConcept,
  });
  const styleComposition = components == null ? null : materializeStyleControls(components, { style: selected, techniques: selectedTechniques, onScreenText });
  const before = materialized.filter((entry) => entry.placement === "before-user");
  const after = materialized.filter((entry) => entry.placement === "after-user");
  const sections = [
    selected.direction,
    ...(styleComposition ? styleComposition.selected.map((entry) => entry.instruction) : []),
    ...before.map((entry) => entry.text),
    `User direction, preserved literally:\n${literal}`,
    ...after.map((entry) => entry.text),
  ];

  return {
    userPrompt: literal,
    directionPreset: selected.id,
    ...(styleComposition ? { styleComposition } : {}),
    // Projeção mínima para o recibo: quem lê consegue reconstruir a montagem.
    techniques: materialized.map((entry) => ({ id: entry.id, values: entry.values })),
    effectivePrompt: sections.join("\n\n"),
    compositionAuthorized: true,
    suggestedAspect: selected.aspect,
  };
}
