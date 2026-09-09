import { resolveStyleSpec, isLiveSelectableStyleSpec } from "./direction-presets.mjs";
import { materializeStyleControls } from "./style-controls.mjs";
import { listRecipeStoryStructures } from "./recipe-story-structures.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

// Macros de entrada da Receita Mestre. O runtime recebe os valores expandidos,
// nunca resolve novamente um perfil nem toma sua seleção como autorização.
const sceneMix = { module: "ffmpeg-mix@1", voiceGainDb: 0, musicGainDb: -18, sfxGainDb: -9, sceneAudioGainDb: -10, ending: "clean-cut" };
const definitions = [
  { id: "motion-2d@1", name: "Motion 2D", style: "flat-2d@1", structure: "linear",
    components: { material: "solid-vector@1", typography: "kinetic-words@1", composition: "swiss-grid@1", camera: "orthographic@1", movement: "shape-morph@1", rhythm: "alternating@1", audio: "graphic-sfx@1" }, modules: { mix: sceneMix } },
  { id: "editorial@1", name: "Editorial", style: "soft-realism@1", structure: "linear",
    components: { material: "natural-texture@1", typography: "editorial-labels@1", composition: "swiss-grid@1", camera: "locked@1", movement: "sequential-reveal@1", rhythm: "measured@1", audio: "silent-clip@1" }, modules: {} },
  { id: "aquarela@1", name: "Aquarela", style: "aquarela-2d@1", structure: "revelacao",
    components: { material: "watercolor-grain@1", typography: "kinetic-words@1", composition: "single-focus@1", camera: "locked@1", movement: "sequential-reveal@1", rhythm: "measured@1", audio: "silent-clip@1" }, modules: {} },
  { id: "documental@1", name: "Documental", style: "documentario@1", structure: "documental",
    components: { material: "natural-texture@1", typography: "editorial-labels@1", composition: "single-focus@1", camera: "observational@1", movement: "match-action@1", rhythm: "measured@1", audio: "organic-sfx@1" }, modules: { mix: sceneMix } },
  { id: "produto@1", name: "Demonstração de produto", style: "soft-realism@1", structure: "produto",
    components: { material: "natural-texture@1", typography: "editorial-labels@1", composition: "single-focus@1", camera: "slow-push@1", movement: "match-action@1", rhythm: "stepwise@1", audio: "organic-sfx@1" }, modules: { mix: sceneMix } },
  { id: "educacional@1", name: "Educacional por etapas", style: "flat-2d@1", structure: "tutorial",
    components: { material: "solid-vector@1", typography: "kinetic-words@1", composition: "swiss-grid@1", camera: "orthographic@1", movement: "sequential-reveal@1", rhythm: "stepwise@1", audio: "graphic-sfx@1" }, modules: { mix: sceneMix } },
  { id: "hibrido@1", name: "Visual editorial com texto local", style: "soft-realism@1", structure: "linear", localText: true,
    components: { material: "natural-texture@1", typography: "none@1", composition: "single-focus@1", camera: "locked@1", movement: "sequential-reveal@1", rhythm: "measured@1", audio: "silent-clip@1" }, modules: {} },
];

function describe(definition) {
  const style = resolveStyleSpec(definition.style);
  materializeStyleControls(definition.components, { style });
  const body = { schema: "mkt-videos/recipe-profile@1", ...structuredClone(definition), localText: definition.localText === true,
    status: style.status, evidence: "instruction-only", authority: "none",
    storyFields: listRecipeStoryStructures().find((entry) => entry.id === definition.structure).fields,
    requiredInputs: ["studio-brief@1", "rootScopeId", "projectId", ...(definition.localText ? ["message, requiredText ou cta para texto local"] : [])],
    limitations: ["Perfil expande valores explícitos; não concede direitos nem comprova qualidade estética.", "Voz e trilha separadas exigem módulos com suas entradas fornecidas.",
      definition.localText ? "Texto local usa local-gc@1 sobre o clipe; não inclui HTML/Canvas nem sincronismo palavra a palavra." : "Texto em tela e SFX solicitados ao Omni precisam de verificação no artefato real."] };
  return { ...body, hash: operationFingerprint(body) };
}

export function listRecipeProfiles() { return definitions.map(describe); }

export function resolveRecipeProfile(id, { style, structure, components = null, modules = null } = {}) {
  const definition = definitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Perfil de receita desconhecido: ${id}. Consulte recipe profiles.`);
  const profile = describe(definition);
  if (!isLiveSelectableStyleSpec(resolveStyleSpec(profile.style))) throw new Error(`O estilo de ${id} não está disponível como piloto ou validado.`);
  if (style != null && style !== profile.style) throw new Error(`--style ${style} diverge de --profile ${id} (${profile.style}). Selecione outro perfil ou componha sem --profile.`);
  for (const [label, value] of [["components", components], ["modules", modules]]) {
    if (value != null && (typeof value !== "object" || Array.isArray(value))) throw new Error(`${label} deve ser objeto.`);
  }
  if (profile.localText && modules && Object.hasOwn(modules, "graphics")) throw new Error("O perfil híbrido materializa graphics a partir dos textos fornecidos; para gráficos próprios, componha sem --profile.");
  if (profile.localText && components?.typography && components.typography !== "none@1") throw new Error("O perfil híbrido exige typography=none@1 no Omni; o texto será renderizado localmente.");
  const selected = { style: profile.style, structure: structure ?? profile.structure,
    components: { ...profile.components, ...structuredClone(components ?? {}) },
    modules: { ...profile.modules, ...structuredClone(modules ?? {}) }, localText: profile.localText };
  return { ...selected, evidence: { profile, selected: structuredClone(selected),
    overrides: { structure: structure ?? null, components: structuredClone(components), modules: structuredClone(modules) } } };
}
