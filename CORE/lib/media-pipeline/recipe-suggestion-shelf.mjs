import { readFile } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { descreverReceita } from "./recipe-validation.mjs";
import { discoverJsonFiles, PADRAO_RECEITA } from "./recipe-shelf.mjs";

export const RECIPE_SUGGESTION_SHELF_SCHEMA = "mkt-videos/recipe-suggestion-shelf@1";
export const RECIPE_SUGGESTION_IDENTITY_SCHEMA = "mkt-videos/recipe-suggestion-identity@1";

const BUNDLE_COLLECTIONS = new Map([
  ["mkt-videos/recipe-variety@1", "propostas"],
  ["mkt-videos/recipe-variety-filme@1", "receitas"],
  ["mkt-videos/recipe-diversity-plan@1", "propostas"],
]);

function validatedMotionAssignments(value, sourceFile) {
  if (value == null) return new Map();
  if (value?.schema !== "mkt-videos/motion-recipe-guidance@1"
    || value?.status !== "candidate"
    || value?.authority !== "none"
    || value?.boundaries?.providerFree !== true
    || value?.boundaries?.providerCalls !== 0
    || value?.boundaries?.recipeMutation !== false
    || value?.boundaries?.runtimeInput !== false
    || value?.boundaries?.providerInput !== false
    || value?.boundaries?.plannerInfluence !== "none"
    || value?.boundaries?.effectivePromptMutation !== false
    || value?.boundaries?.humanPromotionRequired !== true) {
    throw new Error(`${sourceFile}: motionGuidance não preserva os limites candidatos/provider-free.`);
  }
  const sourceHash = String(value?.source?.sha256 ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error(`${sourceFile}: motionGuidance não possui hash de origem válido.`);
  const assignments = new Map();
  for (const [index, raw] of (value.assignments ?? []).entries()) {
    const recipeId = String(raw?.recipeId ?? "").trim();
    const combinationId = String(raw?.combinationId ?? "").trim();
    const primaryId = String(raw?.primary?.id ?? "").trim();
    if (!recipeId || !combinationId || !primaryId) throw new Error(`${sourceFile}: motionGuidance.assignments[${index}] está incompleto.`);
    if (assignments.has(recipeId)) throw new Error(`${sourceFile}: orientação motion duplicada para ${recipeId}.`);
    const support = Array.isArray(raw.support) ? raw.support : [];
    if (support.length > 2 || support.some((item) => !String(item?.id ?? "").trim())) {
      throw new Error(`${sourceFile}: apoios inválidos para ${recipeId}.`);
    }
    assignments.set(recipeId, {
      combinationId,
      sourceHash,
      sourceStatus: value.status,
      primary: structuredClone(raw.primary),
      support: structuredClone(support),
      rationale: raw.rationale == null ? null : String(raw.rationale),
      usePolicy: structuredClone(value.usePolicy ?? null),
      boundaries: structuredClone(value.boundaries),
    });
  }
  return assignments;
}

function suggestionFromRecipe(source, { relativeFile, sourceType, guidance }) {
  const { recipe, ...description } = descreverReceita(source);
  // A identidade legada continua baseada na mesma receita normalizada. Novos
  // campos de apresentação/prontidão não podem invalidar likes existentes.
  const recipeHash = operationFingerprint({ schema: RECIPE_SUGGESTION_IDENTITY_SCHEMA, recipe });
  const motionCombinationId = guidance?.combinationId ?? null;
  const preferenceKey = operationFingerprint({ schema: RECIPE_SUGGESTION_IDENTITY_SCHEMA, recipeHash, motionCombinationId });
  const motionInstructionIds = guidance
    ? [guidance.primary.id, ...guidance.support.map((item) => item.id)]
    : [];
  return {
    preferenceKey,
    recipeHash,
    recipeId: description.id,
    ...description,
    sourceType,
    sourceFiles: [relativeFile],
    motionCombinationId,
    motionInstructionIds,
    motionGuidance: guidance ?? null,
    providerCalls: 0,
    generationTriggered: false,
  };
}

export async function readRecipeSuggestionShelf({ recipesDir } = {}) {
  const root = path.resolve(String(recipesDir));
  const suggestionsByKey = new Map();
  const errors = [];
  for (const file of await discoverJsonFiles(root)) {
    let document;
    let bytes;
    try {
      bytes = await readFile(file.absoluteFile);
      document = JSON.parse(bytes);
    } catch (error) {
      errors.push({ file: file.relativeFile, message: `JSON ilegível: ${error.message}` });
      continue;
    }

    let recipes = null;
    let sourceType = null;
    try {
      if (PADRAO_RECEITA.test(file.relativeFile)) {
        recipes = [document];
        sourceType = "recipe-file";
      } else if (BUNDLE_COLLECTIONS.has(document?.schema)) {
        const collectionKey = BUNDLE_COLLECTIONS.get(document.schema);
        recipes = Array.isArray(document[collectionKey]) ? document[collectionKey] : [];
        sourceType = "suggestion-bundle";
      } else {
        continue;
      }
      const guidanceByRecipe = validatedMotionAssignments(document.motionGuidance, file.relativeFile);
      for (const rawRecipe of recipes) {
        try {
          // Os pacotes atuais são de receita@1; a Mestre exige seus bytes
          // originais para que chaves duplicadas não sumam na desserialização.
          if (sourceType === "suggestion-bundle" && rawRecipe?.schema !== "gerador-de-videos/receita@1") throw new Error("Pacote de sugestões aceita receita@1; use arquivo individual para outros formatos.");
          const suggestion = suggestionFromRecipe(sourceType === "recipe-file" ? bytes : rawRecipe, {
            relativeFile: file.relativeFile,
            sourceType,
            guidance: guidanceByRecipe.get(String(rawRecipe?.id ?? rawRecipe?.identity?.id ?? "")) ?? null,
          });
          const existing = suggestionsByKey.get(suggestion.preferenceKey);
          if (existing) existing.sourceFiles = [...new Set([...existing.sourceFiles, ...suggestion.sourceFiles])].sort();
          else suggestionsByKey.set(suggestion.preferenceKey, suggestion);
        } catch (error) {
          errors.push({ file: file.relativeFile, recipeId: rawRecipe?.id ?? rawRecipe?.identity?.id ?? null, message: error.message });
        }
      }
    } catch (error) {
      errors.push({ file: file.relativeFile, message: error.message });
    }
  }

  const suggestions = [...suggestionsByKey.values()].sort((a, b) =>
    Number(Boolean(b.motionGuidance)) - Number(Boolean(a.motionGuidance))
    || a.label.localeCompare(b.label, "pt-BR"));
  return {
    schema: RECIPE_SUGGESTION_SHELF_SCHEMA,
    root,
    count: suggestions.length,
    suggestions,
    errors,
    boundaries: { providerCalls: 0, generationTriggered: false, executionAvailable: false },
  };
}
