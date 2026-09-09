import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MOTION_RECIPE_GUIDANCE_SCHEMA,
  orientarReceitasComBancoMotion,
  validarBancoInstrucoesMotion,
} from "../lib/media-pipeline/motion-instruction-bank.mjs";

function fixture() {
  const instruction = (id, family) => ({
    id,
    label: id,
    family,
    intent: `intenção ${id}`,
    directions: ["direção inédita"],
    beatMap10s: ["0.0-4.0 preparação", "4.0-8.0 transformação", "8.0-10.0 resolução"],
    sound: "som limpo",
    avoid: ["cópia reconhecível"],
  });
  const bank = {
    schema: "mkt-videos/motion-recipe-instruction-bank@1",
    status: "candidate",
    scope: "local-study-only",
    providerFree: true,
    runtimeInput: false,
    providerInput: false,
    source: {
      indexFingerprint: "index-sha",
      temporalStudyFingerprint: "study-sha",
      videoCount: 2,
      uniqueContentCount: 2,
      sampledFrameCount: 10,
    },
    usePolicy: {
      neverCarry: ["nomes", "marcas", "arquivos locais"],
      recipeRule: "uma principal e até duas de apoio",
      motionRule: "movimento dentro do plano",
      textRule: "texto curto",
      tenSecondRule: "preparação, transformação e resolução",
    },
    instructions: [instruction("primary@1", "type"), instruction("support@1", "grid")],
    combinationRecipes: [{ id: "combination@1", primary: "primary@1", support: ["support@1"] }],
  };
  const bankSha256 = createHash("sha256").update(JSON.stringify(bank)).digest("hex");
  const validation = {
    schema: "mkt-videos/motion-recipe-instruction-bank-validation@1",
    valid: true,
    providerFree: true,
    indexFingerprint: bank.source.indexFingerprint,
    temporalStudyFingerprint: bank.source.temporalStudyFingerprint,
    coverage: { instructions: 2, combinationRecipes: 1 },
    hashes: { instructionBankSha256: bankSha256 },
  };
  return { bank, validation, bankSha256 };
}

test("valida banco, attestation, hash e referências das combinações", () => {
  const validated = validarBancoInstrucoesMotion(fixture());
  assert.equal(validated.instructions.length, 2);
  assert.equal(validated.combinations.length, 1);
  assert.match(validated.bankSha256, /^[a-f0-9]{64}$/);
});

test("orientação é determinística, paralela à receita e sem autoridade de runtime", () => {
  const validatedBank = validarBancoInstrucoesMotion(fixture());
  const input = { validatedBank, recipeIds: ["receita-a", "receita-b"], seed: "referencias" };
  const first = orientarReceitasComBancoMotion(input);
  const second = orientarReceitasComBancoMotion(input);
  assert.deepEqual(first, second);
  assert.equal(first.schema, MOTION_RECIPE_GUIDANCE_SCHEMA);
  assert.deepEqual(first.assignments.map((item) => item.recipeId), ["receita-a", "receita-b"]);
  assert.equal(first.boundaries.providerCalls, 0);
  assert.equal(first.boundaries.recipeMutation, false);
  assert.equal(first.boundaries.runtimeInput, false);
  assert.equal(first.boundaries.providerInput, false);
  assert.equal(first.boundaries.plannerInfluence, "none");
  assert.equal(first.boundaries.effectivePromptMutation, false);
  assert.equal(first.boundaries.humanPromotionRequired, true);
  assert.equal(first.preferenceEvidence.influence, "suggestion-order-only");
});

test("likes de receitas priorizam combinações conhecidas sem alterar autoridade", () => {
  const data = fixture();
  data.bank.instructions.push({
    id: "other@1", label: "outra", family: "flow", intent: "outra intenção",
    directions: ["outra direção"], beatMap10s: ["0-10"], sound: "som", avoid: ["cópia"],
  });
  data.bank.combinationRecipes.push({ id: "preferred@1", primary: "other@1", support: ["support@1"] });
  data.validation.coverage.instructions = 3;
  data.validation.coverage.combinationRecipes = 2;
  data.bankSha256 = createHash("sha256").update(JSON.stringify(data.bank)).digest("hex");
  data.validation.hashes.instructionBankSha256 = data.bankSha256;
  const validatedBank = validarBancoInstrucoesMotion(data);
  const guidance = orientarReceitasComBancoMotion({
    validatedBank,
    recipeIds: ["receita-a"],
    seed: "qualquer",
    preferredCombinationIds: ["preferred@1", "desconhecida@1"],
  });
  assert.equal(guidance.assignments[0].combinationId, "preferred@1");
  assert.deepEqual(guidance.preferenceEvidence.preferredCombinationIds, ["preferred@1"]);
  assert.equal(guidance.boundaries.effectivePromptMutation, false);
});

test("falha fechado se banco e attestation divergirem", () => {
  const data = fixture();
  data.bank.runtimeInput = true;
  assert.throws(() => validarBancoInstrucoesMotion(data), /runtimeInput=false/);
});
