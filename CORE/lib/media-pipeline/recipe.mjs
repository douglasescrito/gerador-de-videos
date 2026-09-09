import { operationFingerprint } from "./pipeline-operation.mjs";

export const RECIPE_SCHEMA = "mkt-videos/recipe@2";

const OPERATIONAL_KEYS = new Set([
  "timeout", "timeoutMs", "poll", "pollInterval", "pollIntervalMs", "output", "outputFile",
  "receipt", "receiptFile", "stateFile", "root", "path", "file", "endpoint", "attemptId",
]);

function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !OPERATIONAL_KEYS.has(key)).map((key) => [key, semantic(value[key])]));
  }
  return value ?? null;
}

export function createRecipeV2({ operation, provider, model = null, prompt = null, task = null, aspect = null, resolution = null, timing = null, parameters = {}, inputHashes = [], preset = null, brandKit = null, captionStyle = null, policies = null, briefHash = null, knowledgeContextHash = null } = {}) {
  if (!String(operation ?? "").trim()) throw new Error("recipe.operation é obrigatório.");
  if (!String(provider ?? "").trim()) throw new Error("recipe.provider é obrigatório.");
  const recipe = {
    schema: RECIPE_SCHEMA,
    operation: String(operation),
    provider: String(provider),
    model: model == null ? null : String(model),
    prompt: prompt == null ? null : String(prompt),
    task: task == null ? null : String(task),
    aspect: aspect == null ? null : String(aspect),
    resolution: semantic(resolution),
    timing: semantic(timing),
    parameters: semantic(parameters),
    inputHashes: [...inputHashes].map(String).sort(),
    preset: semantic(preset),
    brandKit: semantic(brandKit),
    captionStyle: semantic(captionStyle),
    policies: semantic(policies),
    ...(briefHash == null ? {} : { briefHash: String(briefHash) }),
    ...(knowledgeContextHash == null ? {} : { knowledgeContextHash: String(knowledgeContextHash) }),
  };
  return { ...recipe, hash: operationFingerprint(recipe) };
}

export function recipeFromReceipt(receipt) {
  const parameters = receipt?.parameters ?? {};
  const metadata = receipt?.metadata ?? {};
  return createRecipeV2({
    operation: receipt?.operation ?? receipt?.schema ?? "legacy-operation",
    provider: receipt?.provider ?? "legacy",
    model: receipt?.model ?? null,
    prompt: receipt?.prompt ?? null,
    task: parameters.task ?? null,
    aspect: parameters.aspectRatio ?? parameters.aspect ?? metadata.aspect ?? null,
    resolution: parameters.resolution ?? parameters.size ?? metadata.probe?.video ?? null,
    timing: parameters.timing ?? metadata.timeline ?? null,
    parameters,
    inputHashes: (receipt?.inputs ?? []).map((entry) => entry?.hash?.value).filter(Boolean),
    preset: parameters.preset ?? metadata.promptComposition?.directionPreset ?? null,
    brandKit: metadata.brandKit?.hash ?? metadata.brandKit ?? null,
    captionStyle: parameters.captionStyle ?? metadata.captionStyle ?? null,
    policies: metadata.policies ?? null,
    briefHash: metadata.briefHash ?? null,
    knowledgeContextHash: metadata.knowledgeContextHash ?? metadata.knowledgeContext?.contextHash ?? null,
  });
}

export function normalizeReusePolicy(value = "off") {
  const policy = String(value);
  if (!["off", "prefer-approved", "require-approved"].includes(policy)) throw new Error(`Política de reuso inválida: ${policy}.`);
  return policy;
}
