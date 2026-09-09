// Banco local de instruções de motion derivado de referências.
//
// Este módulo é deliberadamente consultivo: valida o pacote candidato e monta
// orientações de planejamento ao lado das receitas. Ele nunca modifica prompt,
// receita, film-spec, execution-plan ou entrada de provedor. A promoção para o
// Knowledge Core continua sendo uma decisão humana governada.

export const MOTION_INSTRUCTION_BANK_SCHEMA = "mkt-videos/motion-recipe-instruction-bank@1";
export const MOTION_INSTRUCTION_BANK_VALIDATION_SCHEMA = "mkt-videos/motion-recipe-instruction-bank-validation@1";
export const MOTION_RECIPE_GUIDANCE_SCHEMA = "mkt-videos/motion-recipe-guidance@1";

const SHA256 = /^[a-f0-9]{64}$/;

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function requiredList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} deve ser uma lista não vazia.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Valida o banco e sua attestation local, incluindo o hash dos bytes lidos.
 * Falha fechado se o pacote deixar de ser candidato/provider-free ou tentar
 * se declarar entrada de runtime/provedor.
 */
export function validarBancoInstrucoesMotion({ bank, validation, bankSha256 } = {}) {
  if (!bank || typeof bank !== "object" || Array.isArray(bank)) throw new Error("Banco de motion inválido.");
  if (bank.schema !== MOTION_INSTRUCTION_BANK_SCHEMA) throw new Error(`Schema de banco de motion incompatível: ${bank.schema}.`);
  if (bank.status !== "candidate") throw new Error("O banco de motion só pode ser consultado enquanto status=candidate.");
  if (bank.scope !== "local-study-only") throw new Error("O banco de motion deve permanecer local-study-only.");
  if (bank.providerFree !== true || bank.runtimeInput !== false || bank.providerInput !== false) {
    throw new Error("O banco de motion deve ser provider-free, runtimeInput=false e providerInput=false.");
  }

  const normalizedHash = String(bankSha256 ?? "").toLowerCase();
  if (!SHA256.test(normalizedHash)) throw new Error("bankSha256 deve ser um SHA-256 hexadecimal.");
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) throw new Error("Validação do banco de motion ausente.");
  if (validation.schema !== MOTION_INSTRUCTION_BANK_VALIDATION_SCHEMA || validation.valid !== true || validation.providerFree !== true) {
    throw new Error("Attestation do banco de motion inválida ou não provider-free.");
  }
  if (String(validation.hashes?.instructionBankSha256 ?? "").toLowerCase() !== normalizedHash) {
    throw new Error("O hash do banco de motion diverge da attestation local.");
  }
  if (validation.indexFingerprint !== bank.source?.indexFingerprint
    || validation.temporalStudyFingerprint !== bank.source?.temporalStudyFingerprint) {
    throw new Error("As fingerprints da origem divergem entre banco e attestation.");
  }

  const neverCarry = requiredList(bank.usePolicy?.neverCarry, "usePolicy.neverCarry").map((item, index) => requiredText(item, `usePolicy.neverCarry[${index}]`));
  const instructions = requiredList(bank.instructions, "instructions");
  const byId = new Map();
  for (const [index, raw] of instructions.entries()) {
    const id = requiredText(raw?.id, `instructions[${index}].id`);
    if (byId.has(id)) throw new Error(`Instrução de motion duplicada: ${id}.`);
    const instruction = {
      id,
      label: requiredText(raw?.label, `instructions[${index}].label`),
      family: requiredText(raw?.family, `instructions[${index}].family`),
      intent: requiredText(raw?.intent, `instructions[${index}].intent`),
      directions: requiredList(raw?.directions, `instructions[${index}].directions`).map((item, itemIndex) => requiredText(item, `instructions[${index}].directions[${itemIndex}]`)),
      beatMap10s: requiredList(raw?.beatMap10s, `instructions[${index}].beatMap10s`).map((item, itemIndex) => requiredText(item, `instructions[${index}].beatMap10s[${itemIndex}]`)),
      sound: requiredText(raw?.sound, `instructions[${index}].sound`),
      avoid: requiredList(raw?.avoid, `instructions[${index}].avoid`).map((item, itemIndex) => requiredText(item, `instructions[${index}].avoid[${itemIndex}]`)),
    };
    byId.set(id, instruction);
  }

  const combinations = requiredList(bank.combinationRecipes, "combinationRecipes").map((raw, index) => {
    const id = requiredText(raw?.id, `combinationRecipes[${index}].id`);
    const primary = requiredText(raw?.primary, `combinationRecipes[${index}].primary`);
    const support = requiredList(raw?.support, `combinationRecipes[${index}].support`).map((item, supportIndex) => requiredText(item, `combinationRecipes[${index}].support[${supportIndex}]`));
    if (support.length > 2) throw new Error(`${id} excede o máximo de duas instruções de apoio.`);
    if (!byId.has(primary)) throw new Error(`${id} referencia instrução principal desconhecida: ${primary}.`);
    for (const supportId of support) {
      if (!byId.has(supportId)) throw new Error(`${id} referencia apoio desconhecido: ${supportId}.`);
      if (supportId === primary) throw new Error(`${id} repete a instrução principal como apoio.`);
    }
    if (new Set(support).size !== support.length) throw new Error(`${id} contém apoios duplicados.`);
    return { id, primary, support };
  });
  if (new Set(combinations.map((item) => item.id)).size !== combinations.length) throw new Error("Combinações de motion contêm IDs duplicados.");

  const coverage = validation.coverage ?? {};
  if (Number(coverage.instructions) !== instructions.length || Number(coverage.combinationRecipes) !== combinations.length) {
    throw new Error("A cobertura da attestation não corresponde ao conteúdo do banco.");
  }

  return {
    bank: clone(bank),
    validation: clone(validation),
    bankSha256: normalizedHash,
    instructions: [...byId.values()],
    instructionById: byId,
    combinations,
    neverCarry,
  };
}

/**
 * Produz uma orientação paralela e hash-bound para receitas já propostas.
 * `recipeIds` é a única ligação: nenhum campo da receita é alterado.
 */
export function orientarReceitasComBancoMotion({ validatedBank, recipeIds, seed = "estudio", preferredCombinationIds = [] } = {}) {
  if (!validatedBank?.instructionById || !Array.isArray(validatedBank?.combinations)) {
    throw new Error("Banco de motion ainda não foi validado.");
  }
  const ids = Array.isArray(recipeIds) ? recipeIds.map((id, index) => requiredText(id, `recipeIds[${index}]`)) : [];
  const knownCombinationIds = new Set(validatedBank.combinations.map((item) => item.id));
  const preferred = [...new Set((Array.isArray(preferredCombinationIds) ? preferredCombinationIds : [])
    .map((id) => String(id).trim())
    .filter((id) => knownCombinationIds.has(id)))];
  const priority = new Map(preferred.map((id, index) => [id, index]));
  const combinations = [...validatedBank.combinations]
    .sort((a, b) => {
      const aPriority = priority.has(a.id) ? priority.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bPriority = priority.has(b.id) ? priority.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aPriority - bPriority
        || hashString(`${seed}:${a.id}`) - hashString(`${seed}:${b.id}`)
        || a.id.localeCompare(b.id);
    });

  const assignments = ids.map((recipeId, index) => {
    const combination = combinations[index % combinations.length];
    const primary = validatedBank.instructionById.get(combination.primary);
    const support = combination.support.map((id) => validatedBank.instructionById.get(id));
    return {
      recipeId,
      combinationId: combination.id,
      primary: clone(primary),
      support: clone(support),
      rationale: "Combinação determinística para diversificar o planejamento; exige tema, texto, geometria, paleta e encadeamento inéditos.",
    };
  });

  return {
    schema: MOTION_RECIPE_GUIDANCE_SCHEMA,
    status: "candidate",
    authority: "none",
    seed: String(seed),
    source: {
      schema: validatedBank.bank.schema,
      sha256: validatedBank.bankSha256,
      status: validatedBank.bank.status,
      scope: validatedBank.bank.scope,
      indexFingerprint: validatedBank.bank.source.indexFingerprint,
      temporalStudyFingerprint: validatedBank.bank.source.temporalStudyFingerprint,
      videos: validatedBank.bank.source.videoCount,
      uniqueContents: validatedBank.bank.source.uniqueContentCount,
      sampledFrames: validatedBank.bank.source.sampledFrameCount,
    },
    boundaries: {
      providerFree: true,
      providerCalls: 0,
      recipeMutation: false,
      runtimeInput: false,
      providerInput: false,
      plannerInfluence: "none",
      effectivePromptMutation: false,
      humanPromotionRequired: true,
    },
    preferenceEvidence: {
      source: "append-only-recipe-likes",
      preferredCombinationIds: preferred,
      influence: "suggestion-order-only",
      automaticPromotion: false,
      providerCalls: 0,
    },
    usePolicy: {
      recipeRule: validatedBank.bank.usePolicy.recipeRule,
      motionRule: validatedBank.bank.usePolicy.motionRule,
      textRule: validatedBank.bank.usePolicy.textRule,
      tenSecondRule: validatedBank.bank.usePolicy.tenSecondRule,
      neverCarry: clone(validatedBank.neverCarry),
    },
    assignments,
  };
}
