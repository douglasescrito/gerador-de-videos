// Plano-sequência encadeado: planejamento provider-free de uma cadeia de planos
// em que o ÚLTIMO FRAME de cada plano vira o PRIMEIRO FRAME do plano seguinte.
//
// A continuidade não é pedida no texto ("continue a cena anterior", que o modelo
// ignora): ela é imposta pela imagem, porque `image_to_video` obriga o provedor a
// partir daquele quadro exato. Este módulo só monta e valida o plano — quem gasta
// é o `generate` do CLI, uma chamada por elo, com recibo próprio.
//
// Receita e armadilhas: docs/guias/MANUAL-PLANO-SEQUENCIA.md

import path from "node:path";

export const SHOT_CHAIN_SCHEMA = "mkt-videos/shot-chain@1";

// `open` abre a cadeia (não há frame anterior); `chain` herda o último frame do
// vizinho; `brand` fecha com a arte oficial como referência generativa.
export const SHOT_ROLES = Object.freeze({
  open: Object.freeze({ task: "text_to_video", needsPreviousFrame: false, needsLogo: false }),
  chain: Object.freeze({ task: "image_to_video", needsPreviousFrame: true, needsLogo: false }),
  brand: Object.freeze({ task: "reference_to_video", needsPreviousFrame: false, needsLogo: true }),
});

export const SHOT_CHAIN_ASPECTS = Object.freeze(["16:9", "9:16"]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} deve ser texto não vazio.`);
  return value.trim();
}

// A bíblia visual inteira entra em TODO prompt. Encurtar porque "o modelo já sabe"
// é o caminho mais rápido para a cadeia derivar de estilo no quarto elo.
export function buildShotPrompt({ bible, action } = {}) {
  return `${requiredText(bible, "bible")}\n\n${requiredText(action, "action")}`;
}

export function validateShotChainSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Spec da cadeia deve ser um objeto JSON.");
  if (spec.schema !== undefined && spec.schema !== SHOT_CHAIN_SCHEMA) {
    throw new Error(`Spec da cadeia exige schema ${SHOT_CHAIN_SCHEMA}.`);
  }
  const bible = requiredText(spec.bible, "spec.bible");
  const aspect = spec.aspect ?? "16:9";
  if (!SHOT_CHAIN_ASPECTS.includes(aspect)) throw new Error(`spec.aspect inválido: ${String(aspect)}.`);
  const logo = spec.logo == null ? null : requiredText(spec.logo, "spec.logo");

  const shots = spec.shots;
  if (!Array.isArray(shots) || !shots.length) throw new Error("spec.shots deve conter ao menos um plano.");

  const seen = new Set();
  const normalized = shots.map((shot, index) => {
    const label = `spec.shots[${index}]`;
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) throw new Error(`${label} deve ser um objeto JSON.`);
    const id = requiredText(shot.id, `${label}.id`);
    if (!ID_PATTERN.test(id)) throw new Error(`${label}.id deve ser minúsculo, alfanumérico com hífen: ${id}.`);
    if (seen.has(id)) throw new Error(`${label}.id duplicado: ${id}.`);
    seen.add(id);

    const role = shot.role ?? (index === 0 ? "open" : "chain");
    if (!Object.hasOwn(SHOT_ROLES, role)) throw new Error(`${label}.role inválido: ${String(role)}.`);
    if (index === 0 && SHOT_ROLES[role].needsPreviousFrame) {
      throw new Error(`${label} abre a cadeia e não pode ter role "${role}": não existe frame anterior.`);
    }
    const shotLogo = shot.logo == null ? logo : requiredText(shot.logo, `${label}.logo`);
    if (SHOT_ROLES[role].needsLogo && !shotLogo) {
      throw new Error(`${label} tem role "${role}" e exige spec.logo ou ${label}.logo com a arte oficial.`);
    }
    return {
      id,
      index,
      role,
      beat: shot.beat == null ? null : requiredText(shot.beat, `${label}.beat`),
      action: requiredText(shot.action, `${label}.action`),
      aspect: shot.aspect ?? aspect,
      logo: shotLogo,
    };
  });

  for (const shot of normalized) {
    if (!SHOT_CHAIN_ASPECTS.includes(shot.aspect)) throw new Error(`spec.shots[${shot.index}].aspect inválido: ${String(shot.aspect)}.`);
  }
  return { schema: SHOT_CHAIN_SCHEMA, title: spec.title ?? null, bible, aspect, logo, shots: normalized };
}

// Traduz a spec em passos executáveis. Cada passo carrega o prompt final, o papel
// do input e o destino — o runner não decide nada, só executa.
export function planShotChain(spec, { outDir, framesDir } = {}) {
  const validated = validateShotChainSpec(spec);
  const root = path.resolve(requiredText(outDir, "outDir"));
  const frames = framesDir ? path.resolve(framesDir) : path.join(root, "frames");

  return {
    ...validated,
    outDir: root,
    framesDir: frames,
    steps: validated.shots.map((shot) => {
      const role = SHOT_ROLES[shot.role];
      const previous = role.needsPreviousFrame ? validated.shots[shot.index - 1] : null;
      return {
        id: shot.id,
        index: shot.index,
        beat: shot.beat,
        role: shot.role,
        task: role.task,
        aspect: shot.aspect,
        prompt: buildShotPrompt({ bible: validated.bible, action: shot.action }),
        previousShotId: previous ? previous.id : null,
        firstFrameFile: previous ? path.join(frames, `${previous.id}-final.png`) : null,
        referenceImage: role.needsLogo ? path.resolve(shot.logo) : null,
        outputFile: path.join(root, `${shot.id}.mp4`),
      };
    }),
  };
}

// Argumentos exatos do `generate` para um passo. Toda entrada externa (frame
// extraído ou logo) exige a confirmação humana literal recebida pelo chamador;
// este helper nunca cria ou presume consentimento.
export function shotChainGenerateArgs(step, { confirmProviderInput } = {}) {
  if (!step || typeof step !== "object") throw new Error("shotChainGenerateArgs exige um passo do plano.");
  const needsProviderInputConfirmation = Boolean(step.firstFrameFile || step.referenceImage);
  if (needsProviderInputConfirmation && confirmProviderInput !== "true") {
    throw new Error("Entrada de imagem no plano-sequência exige --confirm-provider-input true com o valor literal \"true\".");
  }
  const args = ["generate", "--prompt-file", "<prompt-file>", "--task", step.task, "--aspect", step.aspect, "--out", step.outputFile];
  if (step.firstFrameFile) args.splice(1, 0, "--first-frame", step.firstFrameFile, "--confirm-provider-input", confirmProviderInput);
  else if (step.referenceImage) args.splice(1, 0, "--image", step.referenceImage, "--confirm-provider-input", confirmProviderInput);
  return args;
}
