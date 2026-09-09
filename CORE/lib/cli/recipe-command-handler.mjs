import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertPathAvailable, writeJsonAtomic } from "../media-pipeline/pipeline-operation.mjs";
import { readRecipeInput, selectRecipeInput } from "./recipe-input.mjs";
import { createCliResultWriter } from "./result-output.mjs";

function required(value, label) { const normalized = String(value ?? "").trim(); if (!normalized) throw new Error(`${label} é obrigatório.`); return normalized; }
function bool(value, label, fallback = false) { if (value == null) return fallback; if (value === true || value === "true") return true; if (value === false || value === "false") return false; throw new Error(`${label} deve ser true ou false.`); }
function values(value) { return value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]; }

export async function handleRecipeCommand(options, { stdin = process.stdin, stdout = console.log } = {}) {
  const action = String(options.action ?? "validate").trim().toLowerCase();
  const writeResult = createCliResultWriter({ command: "recipe", action, format: options["output-format"], stdout });
  const inputSelection = selectRecipeInput(options);
  const inputFrom = () => readRecipeInput(inputSelection, stdin);
  if (options["asset-context"] != null && action !== "preflight") throw new Error("--asset-context pertence a recipe preflight; run/resume recebem o contexto de execução separadamente.");
  if (options["knowledge-context"] && !["suggest", "explain", "plan", "dispatch", "preflight"].includes(action)) throw new Error("--knowledge-context pertence a recipe suggest, explain, preflight, plan ou dispatch.");
  const contextInput = options["knowledge-context"] ? JSON.parse(await readFile(path.resolve(String(options["knowledge-context"])), "utf8")) : null;
  const knowledgeContext = contextInput?.context ?? contextInput;
  if (action === "profiles") {
    if (Object.keys(options).some((key) => !["action", "help", "output-format"].includes(key))) throw new Error("recipe profiles aceita somente --action, --output-format json e --help.");
    const { listRecipeProfiles } = await import("../media-pipeline/recipe-profiles.mjs");
    return void stdout(JSON.stringify({ schema: "mkt-videos/recipe-profiles@1", profiles: listRecipeProfiles(), providerCalls: 0 }, null, 2));
  }
  if (action === "structures") {
    if (Object.keys(options).some((key) => !["action", "help", "output-format"].includes(key))) throw new Error("recipe structures aceita somente --action, --output-format json e --help.");
    const { listRecipeStoryStructures } = await import("../media-pipeline/recipe-story-structures.mjs");
    return void stdout(JSON.stringify({ schema: "mkt-videos/recipe-structures@1", structures: listRecipeStoryStructures(), automaticSelection: "auto usa a intenção do brief e os campos fornecidos, sem inventar fatos.", providerCalls: 0 }, null, 2));
  }
  if (action === "suggest") {
    const { suggestMasterRecipeFromBrief } = await import("../media-pipeline/recipe-brief-suggestion.mjs");
    const input = await inputFrom();
    const techniques = options["techniques-file"] ? JSON.parse(await readFile(path.resolve(String(options["techniques-file"])), "utf8")) : [];
    if (!Array.isArray(techniques)) throw new Error("--techniques-file deve conter um array de seleções {id, values}.");
    const loadOptional = async (key, fallback) => options[key] ? JSON.parse(await readFile(path.resolve(String(options[key])), "utf8")) : fallback;
    const [story, modules, shotBindings, creativeDirection, components] = await Promise.all([
      loadOptional("story-file", {}), loadOptional("modules-file", null), loadOptional("shots-file", []), loadOptional("direction-file", null),
      loadOptional("composition-file", null),
    ]);
    const result = suggestMasterRecipeFromBrief({ brief: JSON.parse(input.bytes), rootScopeId: options["root-scope-id"], profile: options.profile, style: options.style, structure: options.structure, techniques, components, story, modules, shotBindings, creativeDirection, knowledgeContext });
    result.inputChannel = input.channel;
    if (options.out) {
      const out = path.resolve(String(options.out));
      const evidenceFile = `${out}.suggestion.json`;
      await Promise.all([assertPathAvailable(out, "Receita sugerida"), assertPathAvailable(evidenceFile, "Evidência da sugestão")]);
      await writeJsonAtomic(evidenceFile, result, { label: "Evidência da sugestão" });
      await writeJsonAtomic(out, result.recipe, { label: "Receita Mestre sugerida" });
      const { briefHash, suggestionHash, resolvedHash, planFingerprint, creativeDecisionHash, planSeed } = result.evidence;
      return void writeResult({ schema: result.schema, status: result.status, inputChannel: input.channel, out, evidenceFile, structure: result.evidence.structure, ...(result.evidence.profile ? { profile: result.evidence.profile } : {}), hashes: { briefHash, suggestionHash, resolvedHash, planFingerprint, creativeDecisionHash, planSeed }, readiness: result.readiness, limitations: result.limitations, providerCalls: 0 });
    }
    return void writeResult(result);
  }
  if (action === "inventory") { const roots = values(options.root); if (!roots.length) throw new Error("recipe inventory exige ao menos um --root."); const { inventoryRecipeDocuments } = await import("../media-pipeline/legacy-recipe-migration.mjs"); return void stdout(JSON.stringify(await inventoryRecipeDocuments({ roots }), null, 2)); }
  if (action === "upcast") { const input = await inputFrom(); const { upcastLegacyRecipeBytes } = await import("../media-pipeline/legacy-recipe-migration.mjs"); return void stdout(JSON.stringify(upcastLegacyRecipeBytes(input.bytes, { sourceName: options.file ?? input.channel, rootScopeId: options["root-scope-id"] ?? "client:legacy-import" }), null, 2)); }
  if (!new Set(["schema", "export", "validate", "resolve", "explain", "preflight", "diff", "dispatch", "plan"]).has(action)) throw new Error(`Ação de recipe desconhecida: ${action}.`);
  const { compileResolvedMasterRecipe, compileMasterRecipeProductions, createMasterRecipeDispatch, diffMasterRecipes, getMasterRecipeParameterCatalog, getMasterRecipeRegistries, getMasterRecipeSchema, parseMasterRecipe, preflightMasterRecipeBytes, preflightResolvedMasterRecipe, resolveMasterRecipe } = await import("../media-pipeline/master-recipe-v2.mjs");
  if (action === "schema") return void stdout(JSON.stringify(getMasterRecipeSchema(), null, 2));
  if (action === "export") {
    const format = String(options.format ?? "bundle").trim().toLowerCase();
    const exports = { schema: getMasterRecipeSchema(), catalog: getMasterRecipeParameterCatalog(), registries: getMasterRecipeRegistries() };
    if (format !== "bundle" && !Object.hasOwn(exports, format)) throw new Error("recipe export aceita --format schema|catalog|registries|bundle.");
    return void stdout(JSON.stringify(format === "bundle" ? { schema: "gerador-de-videos/recipe-contract-export@1", ...exports, providerCalls: 0 } : exports[format], null, 2));
  }
  const input = await inputFrom();
  const resolved = resolveMasterRecipe(parseMasterRecipe(input.bytes, { channel: input.channel }));
  let result;
  if (action === "dispatch") result = createMasterRecipeDispatch(resolved, { expectedResolvedHash: required(options["expected-resolved-hash"], "--expected-resolved-hash"), expectedPlanFingerprint: required(options["expected-plan-fingerprint"], "--expected-plan-fingerprint"), confirmHuman: bool(options["confirm-human"], "--confirm-human", false), knowledgeContext });
  else if (action === "diff") result = diffMasterRecipes(resolved, resolveMasterRecipe(parseMasterRecipe(await readFile(path.resolve(required(options.against, "--against"))), { channel: "against-file" })));
  else if (action === "validate") result = { schema: "gerador-de-videos/recipe-validation@1", valid: true, channel: input.channel, hashes: structuredClone(resolved.hashes), providerCalls: 0 };
  else if (action === "resolve") result = { ...resolved, providerCalls: 0 };
  else if (action === "explain") {
    const { explainRecipeExecution } = await import("../media-pipeline/recipe-plan-explanation.mjs");
    const preflight = preflightResolvedMasterRecipe(resolved);
    if (resolved.recipe.context?.knowledgeContextBinding && !knowledgeContext) { preflight.status = "blocked"; preflight.blockers.push({ code: "knowledge-context-required", message: "Forneça --knowledge-context materializado para explicar a execução vinculada." }); }
    const execution = preflight.status === "ready" ? explainRecipeExecution(compileResolvedMasterRecipe(resolved, { knowledgeContext }).executionPlan) : null;
    result = { schema: "gerador-de-videos/recipe-explanation@1", identity: structuredClone(resolved.recipe.identity), scope: structuredClone(resolved.recipe.scope), duration: { frames: resolved.recipe.program.durationFrames, seconds: resolved.derived.durationSeconds, fps: structuredClone(resolved.recipe.format.master.fps), shots: resolved.recipe.program.shots.length }, capabilityIntents: structuredClone(preflight.checks), assembly: structuredClone(resolved.recipe.assembly), resolutionTrace: structuredClone(resolved.resolutionTrace), hashes: structuredClone(resolved.hashes), blockers: structuredClone(preflight.blockers), execution, providerCalls: 0 };
  }
  else if (action === "preflight") {
    const { withLocalAssetRuntime } = await import("./local-asset-runtime.mjs");
    const { authorizeLocalAssets } = await withLocalAssetRuntime({}, options);
    result = await preflightMasterRecipeBytes(resolved, { workspaceRoot: path.resolve(String(options["workspace-root"] ?? "..")), authorizeLocalAssets });
    if (resolved.recipe.context?.knowledgeContextBinding && !knowledgeContext) { result.status = "blocked"; result.blockers.push({ code: "knowledge-context-required", message: "Forneça --knowledge-context materializado." }); }
    else if (knowledgeContext && result.status === "ready") compileResolvedMasterRecipe(resolved, { knowledgeContext });
  }
  else { if (!bool(options["dry-run"], "--dry-run", false)) throw new Error("recipe plan exige --dry-run true; esta fase é exclusivamente provider-free."); const compiled = compileResolvedMasterRecipe(resolved, { knowledgeContext }); const productionSet = resolved.vertical === "2.5D" ? compileMasterRecipeProductions(resolved, { knowledgeContext }) : null; result = { schema: "gerador-de-videos/recipe-plan@1", resolved, filmSpec: compiled.filmSpec, executionPlan: compiled.executionPlan, ...(productionSet ? { productionSet } : {}), providerCalls: 0 }; }
  if (options.out) { const out = path.resolve(String(options.out)); await writeJsonAtomic(out, result, { label: "Resultado da Receita Mestre" }); writeResult(options["output-format"] === "text" ? { ...result, out } : { schema: "gerador-de-videos/recipe-output@1", action, out, hashes: resolved.hashes, providerCalls: 0 }); }
  else writeResult(result);
}
