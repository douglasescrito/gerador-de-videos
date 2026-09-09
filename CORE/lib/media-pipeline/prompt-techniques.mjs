// Catálogo canônico de técnicas de prompt (ADR 0040).
//
// O catálogo de estilos responde como a peça se parece. Este responde como o
// prompt é montado — o conhecimento que custou cota para descobrir e que, até
// aqui, só existia em prosa nos manuais e na memória de quem produziu.
//
// Registro provider-free e versionado. Nada aqui consulta Knowledge Core, chama
// provedor ou avalia peça gerada.

import { ESTILOS, insertDe, transicaoDe } from "./documentary-direction.mjs";

export const TECHNIQUE_SPEC_SCHEMA = "mkt-videos/technique-spec@1";
export const PROCEDURE_SPEC_SCHEMA = "mkt-videos/procedure-spec@1";
const VALIDATION_LEVELS = new Set(["unvalidated", "observed-local", "controlled-pilot", "replicated"]);

const TECHNIQUE_STATUSES = new Set(["concept", "pilot", "proven", "deprecated"]);
const PLACEMENTS = new Set(["before-user", "after-user"]);
const SLOT_TYPES = new Set(["text", "number"]);
// Um valor de série vale para todos os clipes da mesma peça — figurino,
// identidade, fundo. Um valor de clipe muda a cada plano — estado final, lista
// de planos. A distinção existe para que uma série de doze planos peça o
// figurino uma vez e o estado final doze vezes, e não o contrário.
const SLOT_SCOPES = new Set(["series", "clip"]);
// Mesma sintaxe do motor de prompt-template-library: uma gramática só.
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

function requiredText(value, label, maxLength = 8_000) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  if (normalized.length > maxLength) throw new Error(`${label} excede ${maxLength} caracteres.`);
  return normalized;
}

function uniqueTextList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`);
  const normalized = value.map((entry, index) => requiredText(entry, `${label}[${index}]`, 200));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} possui itens repetidos.`);
  return Object.freeze(normalized);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeSlots(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${entryLabel} deve ser um objeto.`);
    }
    const name = requiredText(entry.name, `${entryLabel}.name`, 60);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`${entryLabel}.name deve ser snake_case.`);
    if (seen.has(name)) throw new Error(`${entryLabel}.name repetido: ${name}.`);
    seen.add(name);
    const type = entry.type ?? "text";
    if (!SLOT_TYPES.has(type)) throw new Error(`${entryLabel}.type inválido: ${type}.`);
    const scope = entry.scope ?? "series";
    if (!SLOT_SCOPES.has(scope)) throw new Error(`${entryLabel}.scope inválido: ${scope}.`);
    return {
      name,
      type,
      scope,
      label: requiredText(entry.label, `${entryLabel}.label`, 200),
      required: entry.required !== false,
      defaultValue: entry.defaultValue == null ? null : String(entry.defaultValue),
      hint: entry.hint == null ? null : requiredText(entry.hint, `${entryLabel}.hint`, 400),
    };
  });
}

function normalizeAppliesTo(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} deve ser um objeto.`);
  }
  return {
    styles: uniqueTextList(value.styles ?? [], `${label}.styles`),
    families: uniqueTextList(value.families ?? [], `${label}.families`),
    tasks: uniqueTextList(value.tasks ?? [], `${label}.tasks`),
  };
}

function normalizeEvidence(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} deve ser um objeto.`);
  }
  const receiptCount = Number(value.receiptCount ?? 0);
  if (!Number.isSafeInteger(receiptCount) || receiptCount < 0) {
    throw new Error(`${label}.receiptCount deve ser inteiro não negativo.`);
  }
  return {
    receiptCount,
    observedAt: value.observedAt == null && receiptCount === 0 && !(value.samples?.length) && value.humanVerdict == null
      ? null : requiredText(value.observedAt, `${label}.observedAt`, 40),
    // Caminhos relativos de recibos reais do acervo. São ponteiros de
    // observação: o catálogo não os copia nem os reinterpreta.
    samples: uniqueTextList(value.samples ?? [], `${label}.samples`),
    humanVerdict: value.humanVerdict == null ? null : requiredText(value.humanVerdict, `${label}.humanVerdict`, 40),
  };
}

function techniqueSpec(id, label, {
  problem,
  block,
  slots = [],
  placement,
  order,
  appliesTo,
  status,
  evidence,
  risks = [],
  validationLevel = "observed-local",
  studyRefs = [],
  conflictsWith = [],
} = {}) {
  const normalizedId = requiredText(id, "TechniqueSpec.id", 120);
  if (!VALIDATION_LEVELS.has(validationLevel)) throw new Error(`${normalizedId}.validationLevel inválido.`);
  if (!/@\d+$/.test(normalizedId)) throw new Error(`TechniqueSpec.id deve ser versionado: ${normalizedId}.`);
  const normalizedStatus = requiredText(status, `${normalizedId}.status`, 40);
  if (!TECHNIQUE_STATUSES.has(normalizedStatus)) {
    throw new Error(`${normalizedId}.status inválido: ${normalizedStatus}.`);
  }
  const normalizedPlacement = requiredText(placement, `${normalizedId}.placement`, 40);
  if (!PLACEMENTS.has(normalizedPlacement)) {
    throw new Error(`${normalizedId}.placement inválido: ${normalizedPlacement}.`);
  }
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new Error(`${normalizedId}.order deve ser inteiro não negativo.`);
  }
  const normalizedBlock = requiredText(block, `${normalizedId}.block`);
  const normalizedSlots = normalizeSlots(slots, `${normalizedId}.slots`);

  // Slot declarado sem uso, ou usado sem declaração, é erro de catálogo: os
  // dois lados falham fechado aqui e não na hora de gerar.
  const declared = new Set(normalizedSlots.map((slot) => slot.name));
  const used = new Set([...normalizedBlock.matchAll(PLACEHOLDER)].map((match) => match[1]));
  for (const name of used) {
    if (!declared.has(name)) throw new Error(`${normalizedId}.block usa slot não declarado: ${name}.`);
  }
  for (const name of declared) {
    if (!used.has(name)) throw new Error(`${normalizedId}.slots declara slot não usado: ${name}.`);
  }

  return deepFreeze({
    schema: TECHNIQUE_SPEC_SCHEMA,
    kind: "prompt",
    id: normalizedId,
    label: requiredText(label, `${normalizedId}.label`, 160),
    problem: requiredText(problem, `${normalizedId}.problem`, 400),
    block: normalizedBlock,
    slots: normalizedSlots,
    placement: normalizedPlacement,
    order,
    appliesTo: normalizeAppliesTo(appliesTo, `${normalizedId}.appliesTo`),
    status: normalizedStatus,
    evidence: normalizeEvidence(evidence, `${normalizedId}.evidence`),
    risks: uniqueTextList(risks, `${normalizedId}.risks`),
    validationLevel: "unvalidated",
    studyRefs: [],
    conflictsWith: uniqueTextList(conflictsWith, `${normalizedId}.conflictsWith`),
  });
}

export const PROMPT_TECHNIQUES = Object.freeze({
  ...Object.fromEntries([
    ["native-semantic-insert@1", "Insert nativo semântico", insertDe],
    ["native-semantic-band-insert@1", "Insert nativo semântico em faixa", ESTILOS.plantao.insert],
  ].map(([id, label, render]) => [id, techniqueSpec(id, label, {
    problem: "O texto da sonora precisa aparecer junto ao trecho literal falado, no espaço livre do quadro.",
    block: render("{{highlight}}", "right").replace(/\bright\b/g, "{{side}}").replace(/\bleft\b/g, "{{opposite_side}}"),
    slots: [
      { name: "highlight", scope: "clip", label: "Trecho literal da fala" },
      { name: "side", scope: "clip", label: "Lado do insert", defaultValue: "right" },
      { name: "opposite_side", scope: "clip", label: "Lado da pessoa", defaultValue: "left" },
    ],
    placement: "after-user", order: 32,
    appliesTo: { families: ["documentary", "editorial"], tasks: ["reference_to_video", "text_to_video"] },
    status: "pilot", validationLevel: "unvalidated",
    evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
    studyRefs: [],
    risks: ["A recusa da faixa em um contexto e sua aceitação em outro não isolam luminosidade como causa.", "O destaque deve ocorrer literalmente na fala; o quadro precisa reservar espaço para o insert."],
    conflictsWith: [id === "native-semantic-insert@1" ? "native-semantic-band-insert@1" : "native-semantic-insert@1"],
  })])),
  ...Object.fromEntries(["entrada", "saida"].map((part, index) => {
    const id = `gaze-${part === "entrada" ? "entry" : "exit"}@1`;
    return [id, techniqueSpec(id, `Continuidade de olhar: ${part}`, {
      problem: "O giro deve começar ou terminar em movimento para permitir uma emenda dirigida.",
      block: transicaoDe({ [part]: "{{movement}}" }),
      slots: [{ name: "movement", scope: "clip", label: "Direção e estado do movimento" }],
      placement: "after-user", order: 34 + index,
      appliesTo: { families: ["documentary", "editorial"], tasks: ["reference_to_video"] },
      status: "pilot", validationLevel: "unvalidated",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: ["Só constitui match cut se os planos forem adjacentes e a continuidade física for conferida. Artes entre eles produzem continuidade conceitual."],
      conflictsWith: part === "saida" ? ["clean-final-frame@1"] : [],
    })];
  })),
  "object-boundary-contract@1": techniqueSpec("object-boundary-contract@1", "Estado do objeto na fronteira entre clipes", {
    problem: "A posição e o tamanho de um objeto podem saltar na emenda entre clipes independentes.",
    block: "BOUNDARY STATE: in the first frame, {{object}} is already moving {{direction}}. Its centre is at {{x}} of the picture width and {{y}} of its height; its diameter is {{diameter}} of the picture height. Preserve its size and direction. No arrival animation, no pause, no duplicate object.",
    slots: [
      { name: "object", scope: "clip", label: "Objeto" }, { name: "direction", scope: "clip", label: "Direção" },
      ...["x", "y", "diameter"].map((name) => ({ name, type: "number", scope: "clip", label: name })),
    ],
    placement: "after-user", order: 36,
    appliesTo: { tasks: ["text_to_video", "image_to_video"] },
    status: "concept", validationLevel: "unvalidated",
    evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
    studyRefs: [],
    conflictsWith: ["clean-final-frame@1"],
    risks: ["Hipótese ainda não testada; comparar com encadeamento por frame é comparar estratégias, não apenas um fator."],
  }),
  "identity-wardrobe-lock@1": techniqueSpec(
    "identity-wardrobe-lock@1",
    "Trava de identidade e figurino",
    {
      problem:
        "Em séries com a mesma pessoa, o figurino e a idade derivam entre clipes e o personagem deixa de ser reconhecível.",
      block:
        "WARDROBE — IDENTICAL IN ALL {{clip_count}} CLIPS, AND DELIBERATELY SIMPLE SO IT NEVER DRIFTS: {{wardrobe}}. That is the whole costume — no jacket, no cardigan, no jumper, no extra shirt over it, no hat, no glasses, no visible brands, no logos, no lettering on any garment.\nIDENTITY — the same person in every clip: {{identity}}. Never a younger, slimmer or idealised version. The traits listed here are the most recognisable thing about the character and must be visible every time they are on screen.",
      slots: [
        { name: "clip_count", type: "number", label: "Quantidade de clipes da série", defaultValue: "12" },
        { name: "wardrobe", label: "Figurino exato, peça por peça", hint: "Descreva cor, tecido e corte. Simples demais é melhor que rico." },
        { name: "identity", label: "Traços que tornam a pessoa reconhecível", hint: "Idade aparente, barba, cabelo, porte. Diga o que não pode ser idealizado." },
      ],
      placement: "before-user",
      order: 10,
      appliesTo: {
        styles: [],
        families: ["cinematic", "editorial", "documentary", "illustration"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Sem enumerar as peças, o modelo acrescenta ou remove roupa entre clipes.",
        "Ação violenta sobre rosto real foi recusada pelo provedor; manter a direção fora de dano físico.",
      ],
    },
  ),
  "shot-list-in-clip@1": techniqueSpec(
    "shot-list-in-clip@1",
    "Lista de planos dentro do clipe",
    {
      problem:
        "Pedir uma cena de dez segundos entrega um plano só; a peça fica parada quando o que se queria era montagem.",
      block:
        "{{clip_label}}. Cut hard between these {{shot_count}} shots, in this exact order, inside the ten seconds:\n{{shots}}",
      slots: [
        { name: "clip_label", scope: "clip", label: "Rótulo do clipe", defaultValue: "CLIP 1", hint: "Ex.: CLIP 1 — IGNIÇÃO." },
        { name: "shot_count", type: "number", scope: "clip", label: "Quantidade de planos", defaultValue: "6", hint: "Entre 5 e 6 costuma caber em dez segundos." },
        {
          name: "shots",
          scope: "clip",
          label: "Um plano por linha",
          hint: "Escreva cada linha como \"SHOT k OF n — ENQUADRAMENTO: ação\". O enquadramento explícito é o que faz o corte acontecer.",
        },
      ],
      placement: "after-user",
      order: 20,
      appliesTo: {
        styles: [],
        families: ["cinematic", "editorial", "documentary", "motion-graphics", "illustration", "social"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Acima de seis planos em dez segundos a leitura começa a se perder.",
        "Detecção automática de cena do ffmpeg não mede corte interno; a conferência é visual.",
      ],
    },
  ),
  "render-check-flat@1": techniqueSpec(
    "render-check-flat@1",
    "Verificação de render flat (trava anti-3D)",
    {
      problem:
        "Qualquer vocabulário de cenário físico — parede, chão, mesa, horizonte — puxa o flat 2D para 3D com sombra e perspectiva.",
      block:
        "RENDER CHECK for the direction above: draw it strictly as flat vector shapes sitting on the flat {{background}} field. It is a diagram in motion, never a physical object inside a room: no wall, no floor, no ground plane, no table, no horizon, no set, no studio lighting, no shading, no perspective, no thickness, no volume. Any reference to a surface, a boundary or a stop is drawn as a thin flat line, never as a built environment.",
      slots: [
        {
          name: "background",
          label: "Fundo chapado",
          defaultValue: "graphite",
          hint: "Uma cor sólida, nomeada. Ex.: graphite, midnight navy.",
        },
      ],
      placement: "after-user",
      order: 30,
      appliesTo: {
        styles: ["flat-2d@1", "aquarela-2d@1", "react-audiovisual@1"],
        families: ["motion-graphics", "illustration"],
        tasks: ["text_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "O bloco precisa vir por clipe: aplicado uma vez numa série, os clipes seguintes voltam a derivar.",
      ],
    },
  ),
  "clean-final-frame@1": techniqueSpec(
    "clean-final-frame@1",
    "Estado final estável e sem fade",
    {
      problem:
        "Sem declarar o estado final, o clipe termina em movimento ou com fade e a emenda com o próximo lê como corte.",
      block:
        "End on {{end_state}}, clean stable final frame, no fade-out.",
      slots: [
        {
          name: "end_state",
          scope: "clip",
          label: "Estado exato do último frame",
          hint: "Descreva o que está em quadro e parado. É esse estado que o próximo clipe vai retomar.",
        },
      ],
      placement: "after-user",
      order: 40,
      appliesTo: {
        styles: [],
        families: ["motion-graphics", "illustration", "cinematic", "editorial", "documentary", "social", "produto", "brand"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Continuidade real entre clipes continua sendo trabalho do shot-chain@1; este bloco só prepara o frame.",
      ],
    },
  ),
  // Técnicas reutilizáveis; evidências privadas não acompanham a distribuição.
  "pose-chart-reference@1": techniqueSpec(
    "pose-chart-reference@1",
    "Cartela de poses como referência visual",
    {
      problem:
        "Descrever pose de mão em palavras não segura contagem de dedos: o modelo ignora a descrição e repete o gesto que já sabe fazer.",
      block:
        "THE SECOND REFERENCE IMAGE IS NOT A SCENE — IT IS A POSE CHART, and it is the specification for the hardest part of this shot. It holds {{panel_count}} photographs, read left to right, top row first, then bottom row: {{panel_order}}. Copy those poses exactly, in that order, as {{pose_use}}. Same shapes, same counts, same clear separation.\nNever film the chart itself — it is instruction only, never something the camera sees, never a photograph or a panel inside the scene.",
      slots: [
        { name: "panel_count", type: "number", label: "Quantidade de painéis da cartela", defaultValue: "6" },
        {
          name: "panel_order",
          label: "O que cada painel significa, na ordem de leitura",
          defaultValue: "the poses for SIX, SEVEN, EIGHT, NINE, TEN and TEN again",
          hint: "Diga a ordem em que os painéis devem ser lidos; é ela que vira a sequência do clipe.",
        },
        {
          name: "pose_use",
          scope: "clip",
          label: "Onde as poses entram na ação",
          defaultValue: "the shapes his hands make when he says \"seis\", \"sete\", \"oito\", \"nove\" and \"dez\"",
        },
      ],
      placement: "before-user",
      order: 12,
      appliesTo: {
        styles: [],
        families: ["cinematic", "documentary", "editorial", "social"],
        tasks: ["reference_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Cartela errada vira clipe errado: cada painel precisa ser conferido antes de virar referência.",
        "Sem a frase que proíbe filmar a cartela, o modelo pode colocar a imagem dentro da cena.",
        "Cartela montada a partir de recortes de clipes já pagos sai de graça e evita gerar uma nova.",
      ],
    },
  ),
  "known-gesture-count@1": techniqueSpec(
    "known-gesture-count@1",
    "Pose nomeada por gesto conhecido",
    {
      problem:
        "Acima de cinco dedos o modelo não renderiza quantidade abstrata: abre as duas mãos, trava em dez e a mão deixa de bater com a palavra falada.",
      block:
        "EVERY POSE BELOW IS NAMED AS A GESTURE EVERYONE ALREADY KNOWS. Build them from these familiar shapes, never from an abstract count of extended fingers:\n{{gesture_map}}\n{{plain_part}}",
      slots: [
        {
          name: "gesture_map",
          scope: "clip",
          label: "Um gesto famoso por linha",
          defaultValue:
            "\"seis\" = flat open palm facing camera, next to a THUMBS-UP — fist closed, thumb straight up.\n\"sete\" = flat open palm, next to a PEACE SIGN — the V of victory, index and middle up, thumb holding the other two down.\n\"oito\" = flat open palm, next to a THREE-FINGER SALUTE — index, middle and ring up, thumb pinning the little finger.\n\"nove\" = flat open palm, next to a FOUR-FINGER WAVE — four straight fingers up, thumb tucked flat across the palm.\n\"dez\" = a HIGH-TEN, both palms flat and wide open toward the camera.",
          hint: "Só serve gesto que tem nome popular. Gesto inventado volta a ser contagem abstrata e o modelo erra.",
        },
        {
          name: "plain_part",
          scope: "clip",
          label: "A parte fácil, contada do jeito comum",
          defaultValue: "The first five are the ordinary one-hand count: one finger, two, three, four, whole open hand.",
        },
      ],
      placement: "after-user",
      order: 22,
      appliesTo: {
        styles: [],
        families: ["cinematic", "documentary", "editorial", "social"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Nomear gesto em tom de aula puxa o modo tutorial e o modelo queima legenda na tela, mesmo com texto proibido.",
      ],
    },
  ),
  "hands-apart-framing@1": techniqueSpec(
    "hands-apart-framing@1",
    "Mãos separadas no quadro",
    {
      problem:
        "Duas mãos próximas viram um amontoado só: o modelo funde as duas e a quantidade de dedos fica ilegível.",
      block:
        "THE TWO HANDS ARE KEPT FAR APART, ON PURPOSE, SO THEY CAN NEVER BE CONFUSED WITH EACH OTHER: {{left_hand_place}} {{right_hand_place}} A wide empty gap between them for the whole clip — they never touch, never overlap, never cross the middle of the frame, never appear as one clump of fingers. Because each hand sits alone in its own part of the frame, the fingers of one can never be read as fingers of the other.",
      slots: [
        {
          name: "left_hand_place",
          scope: "clip",
          label: "Onde fica a mão da esquerda",
          defaultValue: "the open palm lives high on the left side of the frame, up near his ear;",
        },
        {
          name: "right_hand_place",
          scope: "clip",
          label: "Onde fica a mão da direita",
          defaultValue: "the counting hand lives low on the right side, down near his chest.",
        },
      ],
      placement: "after-user",
      order: 24,
      appliesTo: {
        styles: [],
        families: ["cinematic", "documentary", "editorial", "social"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Exige fundo limpo: com cenário carregado as mãos deixam de recortar contra o fundo e o ganho some.",
      ],
    },
  ),
  "folded-finger-count@1": techniqueSpec(
    "folded-finger-count@1",
    "Contagem pelo espaço negativo (dedos dobrados)",
    {
      problem:
        "Pedir dedos levantados erra acima de cinco; o modelo acerta melhor quando o alvo descrito é o que está fechado na palma.",
      block:
        "DESCRIBE EACH POSE BY WHAT IS FOLDED, NOT BY WHAT IS RAISED. On the counting hand, count the fingers curled down into the palm:\n{{folded_map}}\nThe folded fingers must be visibly folded — knuckles forward, fingertips pressed into the palm — so that the number of curled fingers is as easy to read as the number of raised ones.",
      slots: [
        {
          name: "folded_map",
          scope: "clip",
          label: "Quantos dedos estão dobrados em cada pose",
          defaultValue:
            "\"seis\": four fingers folded into the palm, one standing.\n\"sete\": three folded, two standing.\n\"oito\": two folded, three standing.\n\"nove\": one folded, four standing.\n\"dez\": nothing folded, all five open.",
        },
      ],
      placement: "after-user",
      order: 26,
      appliesTo: {
        styles: [],
        families: ["cinematic", "documentary", "editorial", "social"],
        tasks: ["text_to_video", "reference_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "A metade fácil continua contada por dedos levantados; misturar as duas leituras no mesmo número confunde.",
      ],
    },
  ),
  "vector-spec-layers@1": techniqueSpec(
    "vector-spec-layers@1",
    "Direção escrita como ficha de animação vetorial",
    {
      problem:
        "Descrever a cena em prosa deixa o modelo escolher o acabamento: ele acrescenta brilho, sombra, vinheta e movimento de câmera. Listar negativas limpa o acabamento mas encolhe o conteúdo, e a trava de render sozinha chega a apagar os elementos descritos.",
      block:
        "Read the direction below as a vector animation spec, not as a scene description. Camera: locked off, static for the whole shot. Canvas: a flat {{background}} field. Every element is a numbered layer with a stated behaviour — what it is, what it does, and in what order it does it. All fills are flat and solid. Finish: {{finish}}.",
      slots: [
        {
          name: "background",
          label: "Fundo chapado",
          defaultValue: "midnight navy",
          hint: "Uma cor sólida, nomeada. Ex.: midnight navy, graphite, warm off-white.",
        },
        {
          name: "finish",
          label: "Acabamento declarado",
          defaultValue: "paper grain overlay at six percent",
          hint: "O acabamento que você quer, dito em positivo — o modelo inventa um se ficar em silêncio.",
        },
      ],
      placement: "before-user",
      order: 14,
      appliesTo: {
        styles: ["flat-2d@1", "aquarela-2d@1", "react-audiovisual@1"],
        families: ["motion-graphics", "illustration"],
        tasks: ["text_to_video", "image_to_video"],
      },
      status: "pilot",
      evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
      risks: [
        "Medida em estudo controlado de quatro condições no Omni do Google Vids, não no Omni do AI Studio; o comportamento no provedor principal ainda não foi refeito.",
        "Substitui a prosa, não convive com ela: metade ficha e metade descrição de cena devolve o acabamento inventado.",
        "Sem declarar o acabamento no slot finish, o modelo escolhe um por conta.",
      ],
    },
  ),
});

// Procedimentos descrevem o método existente. Nunca são materializados como prompt.
export const PRODUCTION_PROCEDURES = deepFreeze(Object.fromEntries([
  ["exclusive-voices@1", "Duas vozes em janelas exclusivas", "audio", "proven", "serie:grade", ["sources", "windows", "overlapPolicy"], "O off e o som direto não podem disputar a mesma janela."],
  ["measured-two-pass-grid@1", "Grade medida em duas passadas", "planning", "proven", "serie:grade", ["measurements", "targetSeconds", "margins", "floors"], "A duração medida da fala governa a grade; mínimos inviáveis precisam ser reportados."],
  ["style-method-separation@1", "Estilo separado do método", "planning", "proven", "serie:prompts", ["styleRef", "invariants"], "Trocar estilo deve preservar as obrigações técnicas selecionadas."],
  ["act-music-crossfade@1", "Trilha por ato com cruzamento explícito", "audio", "pilot", "serie:montar", ["cues", "crossfadeSeconds", "fadeOutSeconds"], "Trilhas precisam cobrir os atos sem interromper o master antes do fim."],
  ["dual-voice-qa@1", "Verificação das vozes no master", "qa", "proven", "serie:qa", ["script", "windows", "transcription", "criteria"], "Contagem igual de palavras não comprova conteúdo, identidade de voz ou sincronismo."],
].map(([id, label, kind, status, operationRef, parameters, problem], index) => [id, {
  schema: PROCEDURE_SPEC_SCHEMA, id, label, kind, status: (status === "concept" || status === "deprecated" ? status : "pilot"), operationRef, problem,
  order: 100 + index, validationLevel: "unvalidated", studyRefs: [],
  parameters, conflictsWith: [],
  evidence: { receiptCount: 0, observedAt: null, samples: [], humanVerdict: null },
  risks: ["Registro de utilização do procedimento não constitui aprovação automática do resultado."],
}])));

export function listProductionTechniques() {
  return [...listPromptTechniques(), ...Object.values(PRODUCTION_PROCEDURES)];
}

export function resolveProductionTechnique(id) {
  const entry = PROMPT_TECHNIQUES[id] ?? PRODUCTION_PROCEDURES[id];
  if (!entry) throw new Error(`Técnica ou procedimento desconhecido: ${id}.`);
  return entry;
}

export function listPromptTechniques({ includeConcept = true } = {}) {
  return Object.values(PROMPT_TECHNIQUES)
    .filter((technique) => includeConcept || technique.status !== "concept")
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function resolvePromptTechnique(value, { allowConcept = false } = {}) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error("Técnica é obrigatória.");
  const technique = PROMPT_TECHNIQUES[id];
  if (!technique) {
    throw new Error(`Técnica desconhecida: ${id}. Use ${Object.keys(PROMPT_TECHNIQUES).join(", ")}.`);
  }
  if (technique.status === "deprecated") {
    throw new Error(`Técnica ${technique.id} está deprecated e não pode ser selecionada para nova geração.`);
  }
  if (technique.status === "concept" && !allowConcept) {
    throw new Error(`Técnica ${technique.id} é concept e não é selecionável para geração live.`);
  }
  return technique;
}

/**
 * Compatibilidade é declarada e conferida antes de qualquer chamada: técnica
 * fora do escopo do estilo ou da task falha fechado, com a incompatibilidade
 * nomeada, em vez de produzir uma peça errada e cara.
 */
export function assertTechniqueCompatibility(technique, { style = null, task = null } = {}) {
  const { styles, families, tasks } = technique.appliesTo;
  if (task && tasks.length > 0 && !tasks.includes(task)) {
    throw new Error(`Técnica ${technique.id} não se aplica à task ${task}.`);
  }
  if (!style) {
    if (styles.length > 0) {
      throw new Error(`Técnica ${technique.id} exige um dos estilos: ${styles.join(", ")}.`);
    }
    return technique;
  }
  if (styles.length > 0 && styles.includes(style.id)) return technique;
  if (styles.length === 0 && families.length > 0 && families.includes(style.family)) return technique;
  if (styles.length === 0 && families.length === 0) return technique;
  const esperado = styles.length > 0 ? `estilos ${styles.join(", ")}` : `famílias ${families.join(", ")}`;
  throw new Error(`Técnica ${technique.id} não se aplica ao estilo ${style.id}; espera ${esperado}.`);
}

function materializeSlot(slot, supplied, techniqueId) {
  const raw = supplied == null || supplied === "" ? slot.defaultValue : supplied;
  if (raw == null || String(raw).trim() === "") {
    if (slot.required) {
      throw new Error(`Técnica ${techniqueId} exige o valor de ${slot.name}.`);
    }
    return "";
  }
  const value = String(raw).trim();
  if (slot.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Técnica ${techniqueId}: ${slot.name} deve ser numérico.`);
    return String(parsed);
  }
  return value;
}

/**
 * Materializa as técnicas escolhidas em blocos ordenados de forma determinística
 * e devolve a projeção que vai para o recibo. Não monta o prompt final: quem faz
 * isso é `composeDirection`, para que exista um único ponto de composição.
 */
export function materializeTechniques(selections = [], { style = null, task = null, allowConcept = false } = {}) {
  if (!Array.isArray(selections)) throw new Error("techniques deve ser uma lista.");
  const selectedIds = new Set(selections.map((selection) => typeof selection === "string" ? selection : selection?.id));
  const seen = new Set();
  const materialized = selections.map((selection) => {
    const id = typeof selection === "string" ? selection : selection?.id;
    const values = (typeof selection === "string" ? null : selection?.values) ?? {};
    if (values && (typeof values !== "object" || Array.isArray(values))) {
      throw new Error("techniques[].values deve ser um objeto.");
    }
    const technique = resolvePromptTechnique(id, { allowConcept });
    for (const conflict of technique.conflictsWith ?? []) {
      if (selectedIds.has(conflict)) throw new Error(`Técnica ${id} é incompatível com ${conflict}.`);
    }
    if (seen.has(technique.id)) throw new Error(`Técnica repetida: ${technique.id}.`);
    seen.add(technique.id);
    assertTechniqueCompatibility(technique, { style, task });

    const declared = new Set(technique.slots.map((slot) => slot.name));
    for (const key of Object.keys(values)) {
      if (!declared.has(key)) throw new Error(`Técnica ${technique.id} não possui o slot ${key}.`);
    }
    const applied = {};
    for (const slot of technique.slots) {
      applied[slot.name] = materializeSlot(slot, values[slot.name], technique.id);
    }
    if (id === "native-semantic-insert@1" || id === "native-semantic-band-insert@1") {
      if (!["left", "right"].includes(applied.side)) throw new Error("side deve ser left ou right.");
      const opposite = applied.side === "right" ? "left" : "right";
      if (values.opposite_side != null && values.opposite_side !== opposite) throw new Error("O insert e a pessoa exigem lados opostos.");
      applied.opposite_side = opposite;
    }
    if (id === "object-boundary-contract@1") {
      for (const name of ["x", "y", "diameter"]) {
        if (Number(applied[name]) < 0 || Number(applied[name]) > 1 || (name === "diameter" && Number(applied[name]) === 0)) throw new Error(`${name} deve ser uma proporção válida do quadro.`);
      }
    }
    return {
      id: technique.id,
      placement: technique.placement,
      order: technique.order,
      values: applied,
      text: technique.block.replace(PLACEHOLDER, (_whole, name) => applied[name]),
    };
  });
  materialized.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return materialized;
}
