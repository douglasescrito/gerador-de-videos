import { operationFingerprint } from "./pipeline-operation.mjs";

// Componentes de direção do StyleSpec, não novos estilos, técnicas comprovadas
// ou renderers. Só compõem instruções quando explicitamente selecionados.
const controls = {
  material: [
    ["solid-vector@1", "Vetor sólido", "Use solid vector surfaces with crisp edges; no texture, gradients or simulated volume.", ["motion-graphics", "social"]],
    ["paper-cut@1", "Recorte de papel", "Use flat cut-paper layers with restrained paper grain and clean silhouettes; no volumetric 3D objects.", ["illustration", "motion-graphics"], ["render-check-flat@1"]],
    ["watercolor-grain@1", "Pigmento em papel", "Preserve watercolor pigment pooling and translucent washes on visible paper grain; do not replace paint with glossy 3D surfaces.", ["illustration"]],
    ["natural-texture@1", "Textura natural", "Preserve restrained natural surface texture and believable material response without glossy plastic skin.", ["documentary", "editorial", "cinematic"]],
  ],
  typography: [
    ["none@1", "Sem texto gráfico", "Do not introduce visible lettering, captions or graphic text."],
    ["editorial-labels@1", "Legendas editoriais", "Place only the supplied graphic text in a restrained editorial hierarchy; keep consistent alignment and generous margins.", ["documentary", "editorial", "motion-graphics", "social"]],
    ["kinetic-words@1", "Palavras cinéticas", "Reveal only the supplied silent graphic words with expressive 2D kinetic typography; preserve spelling and give each phrase readable screen time.", ["motion-graphics", "illustration", "social"]],
  ],
  composition: [
    ["single-focus@1", "Foco único", "Maintain one dominant subject and generous negative space; remove competing secondary focal points."],
    ["swiss-grid@1", "Grade editorial", "Compose on a disciplined modular Swiss grid with clear hierarchy, deliberate asymmetry and consistent gutters.", ["motion-graphics", "illustration", "editorial", "social"]],
    ["split-comparison@1", "Comparação lado a lado", "Give both compared subjects equivalent scale and space in a stable split composition; do not invent comparison facts."],
  ],
  camera: [
    ["locked@1", "Câmera fixa", "Keep the camera locked; movement belongs to the subjects or graphic elements, not to camera shake or zoom."],
    ["orthographic@1", "Vista ortográfica", "Maintain an orthographic frontal 2D view with no perspective orbit, dolly or simulated depth.", ["motion-graphics", "illustration"]],
    ["slow-push@1", "Aproximação lenta", "Use a restrained slow camera push that preserves the subject and readable framing.", ["cinematic", "editorial", "documentary"]],
    ["observational@1", "Observação documental", "Use restrained observational camera motion, motivated by the action, without dramatic orbit or artificial shake.", ["documentary"]],
  ],
  movement: [
    ["shape-morph@1", "Transformação de formas", "Transform simple 2D shapes through continuous silhouettes; keep visual identity and avoid arbitrary 3D spins.", ["motion-graphics", "illustration"]],
    ["sequential-reveal@1", "Revelação por etapas", "Reveal one supplied visual idea at a time in the declared order, preserving the previous state long enough to understand the change."],
    ["match-action@1", "Continuidade de ação", "Maintain the direction and physical logic of the supplied action; changes of framing must preserve that action.", ["cinematic", "editorial", "documentary"]],
  ],
  rhythm: [
    ["measured@1", "Ritmo contemplativo", "Use measured pacing with readable holds; keep the declared shot duration and finish by a clean cut, without fade-out."],
    ["alternating@1", "Contraste de ritmos", "Alternate concise visual changes with readable holds inside the declared duration; end by a clean cut without fade-out."],
    ["stepwise@1", "Ritmo didático", "Separate each demonstrated step with a readable stable state; do not accelerate away the information or change the declared duration."],
  ],
  audio: [
    ["silent-clip@1", "Clipe silencioso", "Request a silent generated clip: no sound effects, music, speech, singing or voices. Separate recipe audio modules remain separate."],
    ["graphic-sfx@1", "SFX gráficos", "Generated clip audio: graphic sound effects only, synchronized to visual changes, with crisp clicks and restrained whooshes. Zero speech, narration, singing or music."],
    ["organic-sfx@1", "SFX orgânicos", "Generated clip audio: restrained tactile foley for the depicted materials only. Zero speech, narration, singing or music."],
  ],
};

function compatible(entry, style) {
  // Presets de direção literal e preservação de logo não recebem complementos
  // genéricos que possam contradizer seu contrato específico.
  if (["react-audiovisual@1", "logo-fiel@1"].includes(style.id)) return false;
  return !entry[3] || entry[3].includes(style.family);
}

export function listStyleControls(style) {
  const fixedDirection = ["react-audiovisual@1", "logo-fiel@1"].includes(style.id);
  return {
    schema: "mkt-videos/style-controls@1", language: { styleId: style.id, family: style.family },
    evidence: "instruction-only", automaticSelection: false, availability: fixedDirection ? "unavailable" : "explicit-selection",
    dimensions: Object.fromEntries(Object.entries(controls).map(([dimension, entries]) => [dimension,
      entries.filter((entry) => compatible(entry, style)).map(([id, label, instruction, families, conflictsWith = []]) => ({ id, label, instruction, conflictsWith: [...conflictsWith], ...(families ? { families: [...families] } : {}) })),
    ])),
    limitations: [...(fixedDirection ? ["Este estilo exige preservar sua direção específica e não aceita componentes genéricos adicionais."] : []), "Compatibilidade declarada não comprova a qualidade da combinação no provedor.", "Tipografia e sincronia são instruções, não renderização determinística nem QA físico.", "A dimensão audio descreve somente o clipe gerado; voz, trilha e mix continuam exigindo módulos explícitos na receita."],
  };
}

export function materializeStyleControls(components, { style, techniques = [], onScreenText = [] }) {
  if (!components || typeof components !== "object" || Array.isArray(components)) throw new Error("composition deve ser um objeto de dimensão para ID versionado.");
  const catalog = listStyleControls(style);
  for (const key of Object.keys(components)) if (!Object.hasOwn(controls, key)) throw new Error(`Dimensão de composição desconhecida: ${key}.`);
  const selected = [];
  for (const dimension of Object.keys(controls)) {
    if (!Object.hasOwn(components, dimension)) continue;
    const id = components[dimension];
    const entry = catalog.dimensions[dimension].find((entry) => entry.id === id);
    if (!entry) throw new Error(`Composição ${dimension}=${String(id)} não é compatível com ${style.id}; consulte styles.`);
    const conflict = entry.conflictsWith.find((id) => techniques.some((technique) => (typeof technique === "string" ? technique : technique.id) === id));
    if (conflict) throw new Error(`Composição ${dimension}=${id} é incompatível com a técnica ${conflict}.`);
    if (dimension === "typography" && id === "none@1" && onScreenText.length) throw new Error("typography=none@1 conflita com texto gráfico obrigatório nesta cena.");
    selected.push({ dimension, id, instruction: entry.instruction });
  }
  if (!selected.length) throw new Error("composition exige ao menos uma dimensão explícita.");
  const body = { schema: "mkt-videos/style-composition@1", styleId: style.id, evidence: "instruction-only", selected, limitations: catalog.limitations };
  return { ...body, hash: operationFingerprint(body) };
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} possui campos ausentes ou desconhecidos.`);
}

// Valida a fotografia congelada, sem recompor direção a partir de um catálogo
// atual. Novos IDs usam novas versões; replay não escolhe estilo novamente.
function assertComposition(value) {
  exactKeys(value, ["schema", "styleId", "evidence", "selected", "limitations", "hash"], "styleComposition.composition");
  const { hash, ...body } = value;
  if (value.schema !== "mkt-videos/style-composition@1" || value.evidence !== "instruction-only" || typeof value.styleId !== "string" || !/@\d+$/.test(value.styleId) || hash !== operationFingerprint(body)) throw new Error("styleComposition possui schema, evidência ou hash inválido.");
  if (!Array.isArray(value.selected) || !value.selected.length || !Array.isArray(value.limitations) || value.limitations.some((item) => typeof item !== "string")) throw new Error("styleComposition possui seleções ou limitações inválidas.");
  const seen = new Set();
  for (const entry of value.selected) {
    exactKeys(entry, ["dimension", "id", "instruction"], "styleComposition.selected");
    if (!Object.hasOwn(controls, entry.dimension) || seen.has(entry.dimension) || typeof entry.id !== "string" || !/@\d+$/.test(entry.id) || typeof entry.instruction !== "string" || !entry.instruction.trim()) throw new Error("styleComposition possui dimensão repetida ou seleção inválida.");
    if (controls[entry.dimension].find((choice) => choice[0] === entry.id)?.[2] !== entry.instruction) throw new Error("styleComposition possui instrução divergente do componente versionado.");
    seen.add(entry.dimension);
  }
}

export function bindStyleComposition({ composition, briefHash, scope, shots }) {
  assertComposition(composition);
  const body = { schema: "mkt-videos/recipe-style-composition@1", authority: "none", composition,
    briefHash, rootScopeId: scope.rootScopeId, projectScopeId: scope.projectScopeId,
    prompts: shots.map(({ shotId, prompt }) => ({ shotId, hash: operationFingerprint(prompt) })) };
  return { ...body, hash: operationFingerprint(body) };
}

export function assertStyleCompositionBinding(value, { briefHash, scope, shots, style = null }) {
  exactKeys(value, ["schema", "authority", "composition", "briefHash", "rootScopeId", "projectScopeId", "prompts", "hash"], "styleComposition");
  assertComposition(value.composition);
  if (style) {
    if (style.id !== value.composition.styleId || value.composition.selected.some((component) => !compatible(controls[component.dimension].find((choice) => choice[0] === component.id), style))) throw new Error("styleComposition contém componente incompatível com o estilo versionado.");
  }
  if (value.schema !== "mkt-videos/recipe-style-composition@1" || value.authority !== "none" || !Array.isArray(value.prompts)) throw new Error("styleComposition não pode conceder autoridade.");
  for (const prompt of value.prompts) exactKeys(prompt, ["shotId", "hash"], "styleComposition.prompts");
  const expected = bindStyleComposition({ composition: value.composition, briefHash, scope, shots });
  if (operationFingerprint(expected) !== operationFingerprint(value)) throw new Error("styleComposition diverge dos prompts, brief, escopo ou hash congelados.");
  for (const shot of shots) for (const component of value.composition.selected) {
    if (!shot.prompt.includes(component.instruction)) throw new Error(`A cena ${shot.shotId} omite instrução congelada de ${component.dimension}.`);
  }
  return structuredClone(value);
}
