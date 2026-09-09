import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { compileFilmSpec } from "./film-compiler.mjs";
import { validatePostProduction } from "./film-post-production.mjs";
import { assertKnowledgeContextBinding, assertKnowledgeContextSnapshot, assertStudioBrief, buildKnowledgeContextBinding } from "./studio-context.mjs";
import { assertCreativeDirectionDecision } from "./creative-direction.mjs";
import { assertStyleCompositionBinding, bindStyleComposition } from "./style-controls.mjs";
import { resolveStyleSpec } from "./direction-presets.mjs";
import { PROVIDER_CAPABILITIES, resolveCapabilityIntent } from "./provider-registry.mjs";
import {
  RECIPE_DELIVERY_TARGETS,
  RECIPE_GRAPHICS_RENDERERS,
  RECIPE_POST_OPERATIONS,
  RECIPE_TRANSITIONS,
  getRecipeRegistries,
} from "./recipe-registries.mjs";

export const MASTER_RECIPE_SCHEMA = "gerador-de-videos/receita@2";
export const RESOLVED_MASTER_RECIPE_SCHEMA = "gerador-de-videos/receita-resolvida@2";
export const MASTER_RECIPE_COMPILER = "master-recipe-compiler@2.5A.0";
export const MASTER_RECIPE_2_5B_COMPILER = "master-recipe-compiler@2.5B.0";
export const MASTER_RECIPE_2_5C_COMPILER = "master-recipe-compiler@2.5C.0";
export const MASTER_RECIPE_2_5D_COMPILER = "master-recipe-compiler@2.5D.0";

const schemaFile = fileURLToPath(new URL("../../schemas/receita-v2.schema.json", import.meta.url));
const schema2_5BFile = fileURLToPath(new URL("../../schemas/receita-v2.5b.schema.json", import.meta.url));
const schema2_5CFile = fileURLToPath(new URL("../../schemas/receita-v2.5c.schema.json", import.meta.url));
const schema2_5DFile = fileURLToPath(new URL("../../schemas/receita-v2.5d.schema.json", import.meta.url));
const parameterCatalogFile = fileURLToPath(new URL("../../schemas/parameter-catalog-v1.json", import.meta.url));
const publicSchema = JSON.parse(readFileSync(schemaFile, "utf8"));
const schema2_5B = JSON.parse(readFileSync(schema2_5BFile, "utf8"));
const schema2_5C = JSON.parse(readFileSync(schema2_5CFile, "utf8"));
const schema2_5D = JSON.parse(readFileSync(schema2_5DFile, "utf8"));
const parameterCatalog = JSON.parse(readFileSync(parameterCatalogFile, "utf8"));
const require = createRequire(import.meta.url);
let ajv;
const validators = new Map();
function validatorFor(value) {
  if (!ajv) {
    const Ajv2020 = require("ajv/dist/2020.js").default;
    ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true, allowUnionTypes: true });
  }
  const schema = value?.vertical === "2.5D" ? schema2_5D : value?.vertical === "2.5C" ? schema2_5C : value?.vertical === "2.5B" ? schema2_5B : publicSchema;
  if (!validators.has(schema)) validators.set(schema, ajv.compile(schema));
  return validators.get(schema);
}
const VERTICAL_2_5A_SCHEMA_BUNDLE_HASH = "f57fd1b93bb55ae3e7fc81f23115bf0099bb38620b4bbb6879b8392f41c44433";
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function rejectDuplicateKeys(source) {
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  };
  const scanString = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor++] === "\"") return JSON.parse(source.slice(start, cursor));
    }
    throw new Error("JSON contém string sem fechamento.");
  };
  const scanValue = () => {
    skipWhitespace();
    if (source[cursor] === "{") return scanObject();
    if (source[cursor] === "[") return scanArray();
    if (source[cursor] === "\"") return void scanString();
    while (cursor < source.length && !/[\s,}\]]/u.test(source[cursor])) cursor += 1;
  };
  const scanArray = () => {
    cursor += 1;
    skipWhitespace();
    if (source[cursor] === "]") return void (cursor += 1);
    while (cursor < source.length) {
      scanValue();
      skipWhitespace();
      if (source[cursor] === "]") return void (cursor += 1);
      cursor += 1;
    }
  };
  const scanObject = () => {
    cursor += 1;
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") return void (cursor += 1);
    while (cursor < source.length) {
      skipWhitespace();
      const key = scanString();
      if (keys.has(key)) throw new Error(`JSON contém chave duplicada: ${key}.`);
      keys.add(key);
      skipWhitespace();
      cursor += 1;
      scanValue();
      skipWhitespace();
      if (source[cursor] === "}") return void (cursor += 1);
      cursor += 1;
    }
  };
  scanValue();
}

function schemaErrors(validator) {
  return (validator.errors ?? []).map((error) => ({
    instancePath: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "contrato inválido",
  }));
}

function semanticErrors(recipe) {
  const errors = [];
  if (recipe.context) {
    try {
      const brief = assertStudioBrief(recipe.context.brief);
      if (brief.projectId !== recipe.scope.projectScopeId || (brief.clientId != null && ![recipe.scope.rootScopeId, recipe.scope.rootScopeId.replace(/^client:/, "")].includes(brief.clientId))) throw new Error("brief atravessa root ou projeto da receita.");
      const binding = recipe.context.knowledgeContextBinding;
      if (brief.knowledgeContextHash && !binding) throw new Error("Contexto privado exige knowledgeContextBinding na receita e --knowledge-context materializado para compilar.");
      if (binding) {
        assertKnowledgeContextBinding(binding, { briefHash: brief.hash });
        const fields = ["schema", "rootScopeId", "releaseId", "releaseHash", "requestHash", "contextId", "contextHash", "retrievalTraceId", "rankerVersion", "briefHash", "authority", "plannerInfluence", "hash"];
        if (Object.keys(binding).some((key) => !fields.includes(key))) throw new Error("O binding da receita aceita somente a projeção mínima, sem payload privado.");
        if (binding.rootScopeId !== recipe.scope.rootScopeId || (brief.knowledgeContextHash && brief.knowledgeContextHash !== binding.contextHash)) throw new Error("Binding de contexto diverge do root ou do brief da receita.");
      }
      const direction = recipe.context.creativeDirection && assertCreativeDirectionDecision(recipe.context.creativeDirection);
      if (direction && (direction.envelope.rootScopeId !== recipe.scope.rootScopeId || direction.envelope.projectScopeId !== recipe.scope.projectScopeId)) throw new Error("Direção criativa atravessa root ou projeto da receita.");
      if (recipe.context.styleComposition) assertStyleCompositionBinding(recipe.context.styleComposition, { briefHash: brief.hash, scope: recipe.scope, shots: recipe.videoGeneration.shots, style: resolveStyleSpec(recipe.context.styleComposition.composition?.styleId, { allowConcept: true, allowDeprecated: true }) });
    } catch (error) {
      errors.push({ instancePath: "/context", keyword: "frozenContext", message: error.message });
    }
  }
  if (recipe.narration?.speakerMode === "multi-voice") {
    const speakerIds = new Set((recipe.narration.speakers ?? []).map((speaker) => speaker.id));
    if (speakerIds.size !== (recipe.narration.speakers ?? []).length) errors.push({ instancePath: "/narration/speakers", keyword: "uniqueSpeakerId", message: "contém IDs duplicados" });
    for (const [index, block] of recipe.narration.blocks.entries()) {
      if (!speakerIds.has(block.speakerId)) errors.push({ instancePath: `/narration/blocks/${index}/speakerId`, keyword: "knownSpeaker", message: "não pertence a narration.speakers" });
    }
  }
  const { width, height } = recipe.format.master;
  if (width * 9 !== height * 16 && width * 16 !== height * 9) {
    errors.push({ instancePath: "/format/master", keyword: "aspect", message: "deve representar exatamente 16:9 ou 9:16 no vertical 2.5A" });
  }
  const programIds = recipe.program.shots.map((shot) => shot.id);
  if (new Set(programIds).size !== programIds.length) {
    errors.push({ instancePath: "/program/shots", keyword: "uniqueShotId", message: "contém IDs duplicados" });
  }
  const generationIds = recipe.videoGeneration.shots.map((shot) => shot.shotId);
  if (new Set(generationIds).size !== generationIds.length) {
    errors.push({ instancePath: "/videoGeneration/shots", keyword: "uniqueShotId", message: "contém shotId duplicado" });
  }
  const missingGeneration = programIds.filter((id) => !generationIds.includes(id));
  const unknownGeneration = generationIds.filter((id) => !programIds.includes(id));
  if (missingGeneration.length || unknownGeneration.length) {
    errors.push({ instancePath: "/videoGeneration/shots", keyword: "shotCoverage", message: `deve corresponder exatamente ao programa; ausentes=${missingGeneration.join(",") || "nenhum"}; desconhecidos=${unknownGeneration.join(",") || "nenhum"}` });
  }
  const shotFrames = recipe.program.shots.reduce((total, shot) => total + shot.durationFrames, 0);
  const transitionOverlapFrames = ["2.5C", "2.5D"].includes(recipe.vertical)
    ? recipe.transitions.edges.reduce((total, edge) => total + edge.durationFrames, 0)
    : 0;
  const durationFrames = shotFrames - transitionOverlapFrames;
  if (durationFrames !== recipe.program.durationFrames) {
    errors.push({ instancePath: "/program/durationFrames", keyword: "shotSum", message: `deve ser igual à soma dos shots (${durationFrames})` });
  }
  if (["2.5B", "2.5C", "2.5D"].includes(recipe.vertical)) {
    if (Boolean(recipe.narration) !== Boolean(recipe.alignment)) errors.push({ instancePath: "/alignment", keyword: "audioDependency", message: "narração exige alignment explícito; sem narração, alignment deve ser null" });
    if (recipe.captions?.mode === "word" && !recipe.narration) errors.push({ instancePath: "/captions", keyword: "audioDependency", message: "legendas por palavra exigem narração e alinhamento" });
    const hasAudio = Boolean(recipe.narration || recipe.music || recipe.sfx.cues.length || recipe.mix?.sceneAudioGainDb != null);
    if (hasAudio !== Boolean(recipe.mix)) errors.push({ instancePath: "/mix", keyword: "audioDependency", message: "áudio ativo exige mix explícito; sem áudio, mix deve ser null" });
    const assets = new Map(recipe.assets.map((asset) => [asset.id, asset]));
    if (assets.size !== recipe.assets.length) errors.push({ instancePath: "/assets", keyword: "uniqueAssetId", message: "contém IDs duplicados" });
    const cast = new Map(recipe.cast.people.map((person) => [person.id, person]));
    if (cast.size !== recipe.cast.people.length) errors.push({ instancePath: "/cast/people", keyword: "uniqueCastId", message: "contém IDs duplicados" });
    for (const [index, person] of recipe.cast.people.entries()) {
      const asset = assets.get(person.assetId);
      if (!asset) errors.push({ instancePath: `/cast/people/${index}/assetId`, keyword: "assetExists", message: "não aponta para asset existente" });
      
    }
    for (const [index, shot] of recipe.videoGeneration.shots.entries()) {
      const inputs = shot.inputAssetIds.map((id) => assets.get(id));
      if (inputs.some((asset) => !asset)) errors.push({ instancePath: `/videoGeneration/shots/${index}/inputAssetIds`, keyword: "assetExists", message: "contém asset inexistente" });
      if ((shot.castIds ?? []).some((id) => !cast.has(id))) errors.push({ instancePath: `/videoGeneration/shots/${index}/castIds`, keyword: "castExists", message: "contém pessoa inexistente" });
      if (shot.task === "text-to-video" && shot.inputAssetIds.length) errors.push({ instancePath: `/videoGeneration/shots/${index}`, keyword: "taskInputs", message: "text-to-video não aceita referências" });
      
      if (shot.task === "image-to-video" && (inputs.length < 1 || inputs.length > 2 || inputs.some((asset) => asset?.mediaKind !== "image") || inputs[0]?.role !== "first-frame")) {
        errors.push({ instancePath: `/videoGeneration/shots/${index}`, keyword: "firstFrame", message: "image-to-video exige uma ou duas imagens e a primeira com role first-frame" });
      }
      if (shot.task === "reference-to-video" && (!inputs.length || inputs.some((asset) => asset?.mediaKind !== "image" || !["reference-image", "person-reference"].includes(asset.role)))) {
        errors.push({ instancePath: `/videoGeneration/shots/${index}`, keyword: "referenceInputs", message: "reference-to-video exige imagens com role de referência" });
      }
      if (shot.task === "edit-video" && (inputs.length !== 1 || inputs[0]?.mediaKind !== "video" || inputs[0]?.role !== "reference-video")) {
        errors.push({ instancePath: `/videoGeneration/shots/${index}`, keyword: "editInput", message: "edit-video exige exatamente um vídeo com role reference-video" });
      }
      for (const castId of shot.castIds ?? []) {
        const person = cast.get(castId);
        if (person && !shot.inputAssetIds.includes(person.assetId)) errors.push({ instancePath: `/videoGeneration/shots/${index}/castIds`, keyword: "castBinding", message: `${castId} exige seu asset oficial em inputAssetIds` });
      }
    }
    const cueIds = recipe.sfx.cues.map((cue) => cue.id);
    if (new Set(cueIds).size !== cueIds.length) errors.push({ instancePath: "/sfx/cues", keyword: "uniqueCueId", message: "contém IDs duplicados" });
    for (const [index, cue] of recipe.sfx.cues.entries()) {
      const asset = assets.get(cue.assetId);
      if (!asset || asset.mediaKind !== "audio" || asset.role !== "sfx") errors.push({ instancePath: `/sfx/cues/${index}/assetId`, keyword: "sfxAsset", message: "exige asset de áudio com role sfx" });
      if (cue.atFrame >= recipe.program.durationFrames) errors.push({ instancePath: `/sfx/cues/${index}/atFrame`, keyword: "timelineBounds", message: "deve estar dentro da timeline" });
    }
  }
  if (["2.5C", "2.5D"].includes(recipe.vertical)) {
    const assets = new Map(recipe.assets.map((asset) => [asset.id, asset]));
    const expectedEdges = recipe.program.shots.slice(0, -1).map((shot, index) => ({ fromShotId: shot.id, toShotId: recipe.program.shots[index + 1].id }));
    if (recipe.transitions.edges.length !== expectedEdges.length) errors.push({ instancePath: "/transitions/edges", keyword: "edgeCoverage", message: "deve cobrir exatamente todos os pares adjacentes" });
    for (const [index, edge] of recipe.transitions.edges.entries()) {
      const expected = expectedEdges[index];
      if (!expected || edge.fromShotId !== expected.fromShotId || edge.toShotId !== expected.toShotId) errors.push({ instancePath: `/transitions/edges/${index}`, keyword: "edgeOrder", message: "não corresponde ao par adjacente do programa" });
      const registry = RECIPE_TRANSITIONS[edge.transition];
      if (!registry) errors.push({ instancePath: `/transitions/edges/${index}/transition`, keyword: "registry", message: "transição sem consumidor comprovado" });
      else if (edge.durationFrames < registry.duration.minimumFrames || (registry.duration.maximumFrames != null && edge.durationFrames > registry.duration.maximumFrames)) errors.push({ instancePath: `/transitions/edges/${index}/durationFrames`, keyword: "transitionDuration", message: "duração incompatível com a transição" });
      const from = recipe.program.shots[index]?.durationFrames ?? 0;
      const to = recipe.program.shots[index + 1]?.durationFrames ?? 0;
      if (edge.durationFrames >= Math.min(from, to) && edge.durationFrames > 0) errors.push({ instancePath: `/transitions/edges/${index}/durationFrames`, keyword: "transitionBounds", message: "deve ser menor que as duas cenas" });
    }
    const graphicShotIds = new Set();
    for (const [index, graphic] of recipe.graphics.scenes.entries()) {
      if (graphicShotIds.has(graphic.shotId)) errors.push({ instancePath: `/graphics/scenes/${index}/shotId`, keyword: "uniqueShotId", message: "gráfico duplicado para a cena" });
      graphicShotIds.add(graphic.shotId);
      if (!recipe.program.shots.some((shot) => shot.id === graphic.shotId)) errors.push({ instancePath: `/graphics/scenes/${index}/shotId`, keyword: "shotExists", message: "cena inexistente" });
      const renderer = RECIPE_GRAPHICS_RENDERERS[graphic.renderer];
      if (!renderer) errors.push({ instancePath: `/graphics/scenes/${index}/renderer`, keyword: "registry", message: "renderer sem consumidor comprovado" });
      const document = graphic.documentAssetId == null ? null : assets.get(graphic.documentAssetId);
      if (graphic.renderer === "html-canvas@1" && (!document || document.mediaKind !== "document" || document.role !== "graphics-document")) errors.push({ instancePath: `/graphics/scenes/${index}/documentAssetId`, keyword: "htmlDocument", message: "HTML/Canvas exige asset document/graphics-document" });
      if (graphic.renderer !== "html-canvas@1" && graphic.documentAssetId !== null) errors.push({ instancePath: `/graphics/scenes/${index}/documentAssetId`, keyword: "rendererDocument", message: "documentAssetId só é aceito para html-canvas@1" });
    }
    try { validatePostProduction(recipe.postProduction, recipe.program.durationFrames); }
    catch (error) { errors.push({ instancePath: "/postProduction", keyword: "postOperation", message: error.message }); }
    const operationIds = new Set();
    for (const [index, operation] of recipe.postProduction.operations.entries()) {
      if (operationIds.has(operation.id)) errors.push({ instancePath: `/postProduction/operations/${index}/id`, keyword: "uniqueOperationId", message: "operação duplicada" });
      operationIds.add(operation.id);
      if (!RECIPE_POST_OPERATIONS[operation.operation]) errors.push({ instancePath: `/postProduction/operations/${index}/operation`, keyword: "registry", message: "operação sem consumidor comprovado" });
      const asset = operation.assetId == null ? null : assets.get(operation.assetId);
      if (operation.operation === "logo-overlay@1" && (!asset || asset.mediaKind !== "image" || asset.role !== "logo")) errors.push({ instancePath: `/postProduction/operations/${index}/assetId`, keyword: "logoAsset", message: "logo-overlay exige asset image/logo" });
      if (operation.operation === "ending-hold@1" && !(operation.durationFrames > 0)) errors.push({ instancePath: `/postProduction/operations/${index}/durationFrames`, keyword: "endingDuration", message: "ending-hold exige duração positiva" });
    }
    const variantFormats = recipe.variants.items.map((variant) => variant.format);
    if (new Set(variantFormats).size !== variantFormats.length) errors.push({ instancePath: "/variants/items", keyword: "uniqueFormat", message: "formato de variante duplicado" });
    for (const [index, variant] of recipe.variants.items.entries()) {
      if ((variant.format === "1:1" || variant.strategy === "center-crop") && variant.approved !== true) errors.push({ instancePath: `/variants/items/${index}/approved`, keyword: "editorialApproval", message: "crop ou formato quadrado exige approved true" });
    }
    if (!RECIPE_DELIVERY_TARGETS[recipe.delivery.target]) errors.push({ instancePath: "/delivery/target", keyword: "registry", message: "destino sem consumidor comprovado" });
    if (recipe.delivery.target === "drive-daily@1" && recipe.delivery.externalDecision == null) errors.push({ instancePath: "/delivery/externalDecision", keyword: "externalDecision", message: "Drive exige decisão externa vinculada" });
    if (recipe.delivery.target === "local-output@1" && recipe.delivery.externalDecision != null) errors.push({ instancePath: "/delivery/externalDecision", keyword: "externalDecision", message: "destino local não aceita confirmação externa" });
  }
  if (recipe.vertical === "2.5D") {
    for (const [index, shot] of recipe.program.shots.entries()) {
      if (shot.durationFrames > recipe.executionPolicy.maxClipFrames) errors.push({ instancePath: `/program/shots/${index}/durationFrames`, keyword: "capabilityClipLimit", message: `ultrapassa maxClipFrames ${recipe.executionPolicy.maxClipFrames}` });
    }
    if (recipe.executionPolicy.failurePolicy === "fail-fast" && recipe.executionPolicy.partialSuccess !== "deny") errors.push({ instancePath: "/executionPolicy/partialSuccess", keyword: "failurePolicy", message: "fail-fast exige partialSuccess deny" });
    if (recipe.executionPolicy.failurePolicy === "continue" && recipe.executionPolicy.partialSuccess !== "allow") errors.push({ instancePath: "/executionPolicy/partialSuccess", keyword: "failurePolicy", message: "continue exige partialSuccess allow" });
    if (recipe.kind === "lote" && recipe.batch == null) errors.push({ instancePath: "/batch", keyword: "batchRequired", message: "kind lote exige batch explícito" });
    if (recipe.kind !== "lote" && recipe.batch !== null) errors.push({ instancePath: "/batch", keyword: "batchForbidden", message: "batch só é aceito com kind lote" });
    if (recipe.batch) {
      if (recipe.batch.rows.length > recipe.executionPolicy.maxChildren) errors.push({ instancePath: "/batch/rows", keyword: "maxChildren", message: "ultrapassa executionPolicy.maxChildren" });
      const rowIds = recipe.batch.rows.map((row) => row.id);
      if (new Set(rowIds).size !== rowIds.length) errors.push({ instancePath: "/batch/rows", keyword: "uniqueRowId", message: "contém IDs duplicados" });
      for (const [rowIndex, row] of recipe.batch.rows.entries()) {
        const shotIds = row.promptOverrides.map((override) => override.shotId);
        if (new Set(shotIds).size !== shotIds.length) errors.push({ instancePath: `/batch/rows/${rowIndex}/promptOverrides`, keyword: "uniqueShotId", message: "contém override duplicado" });
        for (const [overrideIndex, override] of row.promptOverrides.entries()) if (!recipe.program.shots.some((shot) => shot.id === override.shotId)) errors.push({ instancePath: `/batch/rows/${rowIndex}/promptOverrides/${overrideIndex}/shotId`, keyword: "shotExists", message: "cena inexistente" });
      }
    }
  }
  return errors;
}

export function getMasterRecipeSchema() {
  return {
    schema: "gerador-de-videos/receita-schema-bundle@1",
    recipeSchema: MASTER_RECIPE_SCHEMA,
    verticals: [
      { id: "2.5A", schema: structuredClone(publicSchema) },
      { id: "2.5B", schema: structuredClone(schema2_5B) },
      { id: "2.5C", schema: structuredClone(schema2_5C) },
      { id: "2.5D", schema: structuredClone(schema2_5D) },
    ],
  };
}

export function getMasterRecipeParameterCatalog() {
  return structuredClone(parameterCatalog);
}

export function getMasterRecipeRegistries() {
  return getRecipeRegistries();
}

export function diffMasterRecipes(leftResolved, rightResolved) {
  const changes = [];
  const walk = (left, right, pointer = "") => {
    if (canonicalJson(left) === canonicalJson(right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) walk(left[index], right[index], `${pointer}/${index}`);
      return;
    }
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) walk(left[key], right[key], `${pointer}/${pointerToken(key)}`);
      return;
    }
    changes.push({ pointer: pointer || "/", before: left === undefined ? null : structuredClone(left), after: right === undefined ? null : structuredClone(right) });
  };
  walk(leftResolved.recipe, rightResolved.recipe);
  return {
    schema: "gerador-de-videos/recipe-diff@1",
    beforeHash: leftResolved.hashes.normalizedHash,
    afterHash: rightResolved.hashes.normalizedHash,
    equivalent: changes.length === 0,
    changes,
    providerCalls: 0,
  };
}

export function parseMasterRecipe(sourceBytes, { channel = "memory" } = {}) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(String(sourceBytes), "utf8");
  const source = bytes.toString("utf8");
  let value;
  try {
    rejectDuplicateKeys(source);
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Receita Mestre inválida no canal ${channel}: ${error.message}`);
  }
  const validator = validatorFor(value);
  const validSchema = validator(value);
  const errors = validSchema ? semanticErrors(value) : schemaErrors(validator);
  if (errors.length) {
    const summary = errors.slice(0, 12).map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`Receita Mestre inválida: ${summary}.`);
  }
  const canonicalDocument = canonicalJson(value);
  return {
    recipe: structuredClone(value),
    channel,
    sourceBytesHash: sha256(bytes),
    canonicalDocumentHash: sha256(canonicalDocument),
    canonicalDocument,
  };
}

function pointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function traceLeaves(value, pointer = "") {
  if (Array.isArray(value)) return value.flatMap((entry, index) => traceLeaves(entry, `${pointer}/${index}`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => traceLeaves(entry, `${pointer}/${pointerToken(key)}`));
  }
  return [{ pointer: pointer || "/", value: structuredClone(value), origin: "explicit", sourcePointer: pointer || "/" }];
}

export function resolveMasterRecipe(parsed) {
  const recipe = structuredClone(parsed.recipe);
  const fps = recipe.format.master.fps;
  const aspect = recipe.format.master.width > recipe.format.master.height ? "16:9" : "9:16";
  const durationSeconds = recipe.program.durationFrames * fps.denominator / fps.numerator;
  const normalizedHash = sha256(canonicalJson(recipe));
  // O hash do lock cobre somente os módulos ativos e congelados. Quando um
  // vertical posterior adicionar propriedades opcionais ao envelope público,
  // uma receita 2.5A continua produzindo o mesmo lock e plan fingerprint.
  const vertical = recipe.vertical === "2.5D" ? "2.5D" : recipe.vertical === "2.5C" ? "2.5C" : recipe.vertical === "2.5B" ? "2.5B" : "2.5A";
  const compiler = vertical === "2.5D" ? MASTER_RECIPE_2_5D_COMPILER : vertical === "2.5C" ? MASTER_RECIPE_2_5C_COMPILER : vertical === "2.5B" ? MASTER_RECIPE_2_5B_COMPILER : MASTER_RECIPE_COMPILER;
  // Receitas anteriores à extensão de contexto mantêm seu lock. Quando o
  // contexto existe, o contrato ampliado também participa do hash do bundle.
  const schemaForBinding = (schema) => {
    const legacy = structuredClone(schema);
    if (!Object.hasOwn(recipe, "reuse")) delete legacy.properties.reuse;
    if (!recipe.context?.styleComposition && legacy.properties.context?.properties) delete legacy.properties.context.properties.styleComposition;
    if (!Object.hasOwn(recipe.mix ?? {}, "sceneAudioGainDb") && legacy.properties.mix?.properties) delete legacy.properties.mix.properties.sceneAudioGainDb;
    // Só contratos que desativam módulos usam a extensão nullable no lock.
    for (const key of ["narration", "alignment", "music", "captions", "mix"]) {
      if (legacy.properties[key] && recipe[key] !== null) legacy.properties[key].type = "object";
    }
    if (recipe.context?.knowledgeContextBinding) return legacy;
    if (recipe.context) delete legacy.properties.context.properties.knowledgeContextBinding;
    else delete legacy.properties.context;
    return legacy;
  };
  const schemaBundleHash = vertical === "2.5D"
    ? sha256(canonicalJson({ compiler, schema: schemaForBinding(schema2_5D), registries: getRecipeRegistries() }))
    : vertical === "2.5C"
    ? sha256(canonicalJson({ compiler, schema: schemaForBinding(schema2_5C), registries: getRecipeRegistries() }))
    : vertical === "2.5B"
      ? sha256(canonicalJson({ compiler, schema: schemaForBinding(schema2_5B) }))
      : recipe.context || recipe.reuse ? sha256(canonicalJson({ compiler, schema: schemaForBinding(publicSchema) })) : VERTICAL_2_5A_SCHEMA_BUNDLE_HASH;
  const resolutionTrace = traceLeaves(recipe);
  resolutionTrace.push(
    { pointer: "/format/master/aspect", value: aspect, origin: "derived", sourcePointer: "/format/master", rule: "exact-canvas-aspect@1" },
    { pointer: "/program/durationSeconds", value: durationSeconds, origin: "derived", sourcePointer: "/program/durationFrames", rule: "frames-to-seconds@1" },
  );
  const body = {
    schema: RESOLVED_MASTER_RECIPE_SCHEMA,
    compiler,
    ...(vertical !== "2.5A" ? { vertical } : {}),
    schemaBundleHash,
    recipe,
    derived: { aspect, durationSeconds },
    resolutionTrace,
  };
  return {
    ...body,
    hashes: {
      sourceBytesHash: parsed.sourceBytesHash,
      canonicalDocumentHash: parsed.canonicalDocumentHash,
      normalizedHash,
      resolvedHash: sha256(canonicalJson(body)),
    },
  };
}

export function compileResolvedMasterRecipe(resolved, { capabilities = PROVIDER_CAPABILITIES, knowledgeContext = null } = {}) {
  if (resolved?.schema !== RESOLVED_MASTER_RECIPE_SCHEMA) throw new Error(`Schema esperado: ${RESOLVED_MASTER_RECIPE_SCHEMA}.`);
  const recipe = resolved.recipe;
  const binding = recipe.context?.knowledgeContextBinding;
  if (binding) {
    if (!knowledgeContext) throw new Error("Receita vinculada exige --knowledge-context materializado; nenhum retrieval será executado.");
    knowledgeContext = assertKnowledgeContextSnapshot(knowledgeContext);
    const expected = buildKnowledgeContextBinding(knowledgeContext, { briefHash: recipe.context.brief.hash });
    assertKnowledgeContextBinding(binding, { context: knowledgeContext, briefHash: recipe.context.brief.hash });
    if (canonicalJson(binding) !== canonicalJson(expected) || knowledgeContext.rootScopeId !== recipe.scope.rootScopeId) throw new Error("Contexto materializado diverge do binding e do root congelados na receita.");
  } else if (knowledgeContext) throw new Error("Receita sem binding não aceita contexto adicional; vincule-o na sugestão antes de compilar.");
  const extended = ["2.5B", "2.5C", "2.5D"].includes(resolved.vertical);
  const postProduction = ["2.5C", "2.5D"].includes(resolved.vertical);
  if (extended) {
    const preflight = preflightResolvedMasterRecipe(resolved, { capabilities });
    if (preflight.status !== "ready") throw new Error(`Receita Mestre bloqueada no preflight: ${preflight.blockers.map((item) => item.code).join(", ")}.`);
  }
  const generations = new Map(recipe.videoGeneration.shots.map((shot) => [shot.shotId, shot]));
  const assets = new Map((recipe.assets ?? []).map((asset) => [asset.id, asset]));
  const graphics = new Map((recipe.graphics?.scenes ?? []).map((graphic) => [graphic.shotId, graphic]));
  const fps = recipe.format.master.fps;
  const capabilityBindings = Object.fromEntries(requiredCapabilities(recipe).map(({ intent, operation, capabilityId }) => [
    intent,
    resolveCapabilityIntent(capabilities, { intent, operation, capabilityId }).capability,
  ]));
  const humanReview = recipe.workflow?.humanReview ?? false;
  const filmSpec = {
    schema: "mkt-videos/film-spec@2",
    name: recipe.identity.name,
    ...(recipe.context ? {
      brief: structuredClone(recipe.context.brief),
      ...(binding ? { knowledgeContext: structuredClone(knowledgeContext), knowledgeContextBinding: structuredClone(binding) } : {}),
      ...(recipe.context.creativeDirection ? { creativeDirection: structuredClone(recipe.context.creativeDirection) } : {}),
      ...(recipe.context.styleComposition ? { styleComposition: structuredClone(recipe.context.styleComposition) } : {}),
    } : {}),
    source: {
      // `text` carrega o pedido humano literal até o plano e, por ele, ao
      // manifesto. É a evidência de intenção da Fase 9: o `user_prompt` do
      // acervo já é prompt composto, não o que a pessoa pediu.
      request: { recipeId: recipe.identity.id, recipeRevision: recipe.identity.revision, resolvedHash: resolved.hashes.resolvedHash, text: recipe.identity.request ?? null },
      scope: structuredClone(recipe.scope),
      directionPreset: null,
      effectiveDirection: null,
      recipeCompiler: { id: resolved.compiler, schemaBundleHash: resolved.schemaBundleHash },
      capabilityIntents: requiredCapabilities(recipe).map(({ intent, operation }) => ({ intent, operation, capabilityId: capabilityBindings[intent]?.id ?? null })),
    },
    narration: extended && recipe.narration ? {
      mode: "tts",
      provider: capabilityBindings[recipe.narration.speakerMode === "multi-voice" ? "narration.generate.segmented-multi-voice" : "narration.generate.single-voice"]?.adapterProvider ?? capabilityBindings[recipe.narration.speakerMode === "multi-voice" ? "narration.generate.segmented-multi-voice" : "narration.generate.single-voice"]?.id,
      speakerMode: recipe.narration.speakerMode, voice: recipe.narration.voice, speakers: structuredClone(recipe.narration.speakers ?? null), documentUrl: recipe.narration.documentUrl,
      newScene: true, text: recipe.narration.blocks.map((block) => block.text).join("\n"), blocks: structuredClone(recipe.narration.blocks),
    } : { mode: "none", provider: null, text: null, blocks: [] },
    music: extended && recipe.music ? {
      mode: "generate", intent: recipe.music.intent, backend: capabilityBindings["music.generate.timeline"]?.adapterProvider ?? capabilityBindings["music.generate.timeline"]?.id, fit: "timeline", tailSeconds: 0,
      // Flow gera no máximo 120 s por submissão. Filmes mais longos preservam
      // o original do provedor e estendem a cama localmente até a timeline.
      durationSeconds: Math.min(120, recipe.program.durationFrames * fps.denominator / fps.numerator),
    } : { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    workflow: {
      authorizationMode: humanReview ? "per-invocation" : "production-once",
      humanReview,
      completionMode: humanReview ? "pause-for-review" : "complete",
      automaticCorrections: true,
      maxAttempts: 3,
    },
    timeline: {
      fps: structuredClone(fps), holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0,
      ...(postProduction ? { edges: recipe.transitions.edges.map((edge) => ({ fromSceneId: edge.fromShotId, toSceneId: edge.toShotId, transition: RECIPE_TRANSITIONS[edge.transition].ffmpeg, transitionId: edge.transition, durationFrames: edge.durationFrames })) } : {}),
    },
    scenes: recipe.program.shots.map((shot) => {
      const graphic = graphics.get(shot.id);
      return ({
      id: shot.id,
      role: "spectacle",
      objective: generations.get(shot.id).prompt,
      visualPrompt: generations.get(shot.id).prompt,
      motionPrompt: generations.get(shot.id).prompt,
      onScreenText: graphic?.text ?? null,
      textRendering: graphic && graphic.renderer !== "none@1" ? "local-gc" : "none",
      ...(graphic ? { graphics: { renderer: graphic.renderer, documentAssetId: graphic.documentAssetId } } : {}),
      audioPolicy: "provider-default",
      references: (generations.get(shot.id).inputAssetIds ?? []).map((id) => {
        const asset = assets.get(id);
        return { assetId: id, role: asset.role, source: structuredClone(asset.source), sha256: asset.sha256, bytes: asset.bytes, mimeType: asset.mimeType };
      }),
      referenceAuthorizations: (generations.get(shot.id).inputAssetIds ?? []).map((id) => ({ assetId: id, ...structuredClone(assets.get(id).authorization), rights: structuredClone(assets.get(id).rights) })),
      runtimeInputRoles: (generations.get(shot.id).inputAssetIds ?? []).map((id) => assets.get(id).role),
      restrictions: [],
      style: null,
      generationTask: ({ "text-to-video": "text_to_video", "image-to-video": "image_to_video", "reference-to-video": "reference_to_video", "edit-video": "edit" })[generations.get(shot.id).task ?? recipe.videoGeneration.task],
      durationHint: shot.durationFrames * fps.denominator / fps.numerator,
      image: { model: "gemini-3-pro-image", size: "2K" },
    }); }),
    formats: { master: resolved.derived.aspect, variants: postProduction ? structuredClone(recipe.variants.items) : [] },
    brandKit: null,
    captions: extended && recipe.captions ? { mode: recipe.captions.mode, preset: "kinetic-word@1", source: "whisper" } : { mode: "none" },
    qa: postProduction ? { enabled: recipe.qa.technical, policy: recipe.qa.policy, semantic: recipe.qa.semantic, semanticScenes: false, assertions: structuredClone(recipe.qa.assertions) } : { enabled: false },
    reuse: structuredClone(recipe.reuse ?? { policy: "off" }),
    execution: { concurrency: { draft: 3, video: 3, localCpu: 1 }, budget: {}, providers: {} },
    finishing: {
      audio: extended && recipe.mix ? { module: recipe.mix.module, voiceGainDb: recipe.mix.voiceGainDb, musicGainDb: recipe.mix.musicGainDb, sfxGainDb: recipe.mix.sfxGainDb, ending: recipe.mix.ending, sfx: structuredClone(recipe.sfx), ...(Object.hasOwn(recipe.mix, "sceneAudioGainDb") ? { sceneAudioGainDb: recipe.mix.sceneAudioGainDb } : {}) } : {},
      assembly: {
        module: recipe.assembly.module, mode: recipe.assembly.mode, transition: RECIPE_TRANSITIONS[recipe.assembly.transition].ffmpeg, transitionId: recipe.assembly.transition, fps: fps.numerator / fps.denominator,
        ...(postProduction ? { transitions: recipe.transitions.edges.map((edge) => ({ fromSceneId: edge.fromShotId, toSceneId: edge.toShotId, transition: RECIPE_TRANSITIONS[edge.transition].ffmpeg, transitionId: edge.transition, duration: edge.durationFrames * fps.denominator / fps.numerator, durationFrames: edge.durationFrames })) } : {}),
      },
      ending: postProduction ? structuredClone(recipe.postProduction.operations.find((operation) => operation.operation === "ending-hold@1") ?? null) : null,
      delivery: postProduction ? structuredClone(recipe.delivery) : null,
      ...(postProduction ? { postProduction: structuredClone(recipe.postProduction) } : {}),
    },
    compatibility: { sourceSchema: MASTER_RECIPE_SCHEMA },
  };
  if (extended) {
    if (recipe.alignment) filmSpec.alignment = { module: recipe.alignment.module, backend: recipe.alignment.backend, language: recipe.alignment.language, timing: structuredClone(recipe.alignment.timing) };
    filmSpec.resources = recipe.assets.map((asset) => ({ id: asset.id, mediaKind: asset.mediaKind, role: asset.role, source: structuredClone(asset.source), bytes: asset.bytes, sha256: asset.sha256, mimeType: asset.mimeType, rights: structuredClone(asset.rights), authorization: structuredClone(asset.authorization) }));
  }
  const executionPlan = compileFilmSpec(filmSpec);
  if (!executionPlan.timeline.locked || executionPlan.timeline.durationFrames !== recipe.program.durationFrames) {
    throw new Error("O plano compilado divergiu da duração fixa em frames da Receita Mestre.");
  }
  return { filmSpec: executionPlan.spec, executionPlan };
}

export function compileMasterRecipeProductions(resolved, options = {}) {
  const base = compileResolvedMasterRecipe(resolved, options);
  if (resolved.vertical !== "2.5D" || resolved.recipe.kind !== "lote") {
    return {
      schema: "gerador-de-videos/recipe-production-set@1",
      rootScopeId: resolved.recipe.scope.rootScopeId,
      failurePolicy: resolved.recipe.executionPolicy?.failurePolicy ?? "fail-fast",
      partialSuccess: resolved.recipe.executionPolicy?.partialSuccess ?? "deny",
      productions: [{ id: resolved.recipe.identity.id, lockHash: resolved.hashes.resolvedHash, planFingerprint: base.executionPlan.fingerprint, filmSpec: base.filmSpec, executionPlan: base.executionPlan }],
      providerCalls: 0,
    };
  }
  const productions = resolved.recipe.batch.rows.map((row) => {
    const overrides = new Map(row.promptOverrides.map((override) => [override.shotId, override.prompt]));
    const filmSpec = structuredClone(base.filmSpec);
    filmSpec.name = row.name;
    filmSpec.source.request = { ...filmSpec.source.request, batchRowId: row.id };
    filmSpec.scenes = filmSpec.scenes.map((scene) => overrides.has(scene.id)
      ? { ...scene, objective: overrides.get(scene.id), visualPrompt: overrides.get(scene.id), motionPrompt: overrides.get(scene.id) }
      : scene);
    if (filmSpec.styleComposition) filmSpec.styleComposition = bindStyleComposition({ composition: filmSpec.styleComposition.composition, briefHash: filmSpec.brief.hash, scope: filmSpec.source.scope, shots: filmSpec.scenes.map((scene) => ({ shotId: scene.id, prompt: scene.visualPrompt })) });
    const executionPlan = compileFilmSpec(filmSpec);
    const lockBody = { rootScopeId: resolved.recipe.scope.rootScopeId, recipeHash: resolved.hashes.resolvedHash, row };
    const lockHash = sha256(canonicalJson(lockBody));
    return {
      id: `${resolved.recipe.identity.id}:${row.id}`,
      rowId: row.id,
      rootScopeId: resolved.recipe.scope.rootScopeId,
      lockHash,
      planFingerprint: executionPlan.fingerprint,
      journalId: `journal:${lockHash.slice(0, 32)}`,
      filmSpec: executionPlan.spec,
      executionPlan,
    };
  });
  return {
    schema: "gerador-de-videos/recipe-production-set@1",
    rootScopeId: resolved.recipe.scope.rootScopeId,
    failurePolicy: resolved.recipe.executionPolicy.failurePolicy,
    partialSuccess: resolved.recipe.executionPolicy.partialSuccess,
    productions,
    providerCalls: 0,
  };
}

export function createMasterRecipeDispatch(resolved, { expectedResolvedHash = null, expectedPlanFingerprint = null, confirmHuman = false, knowledgeContext = null } = {}) {
  if (confirmHuman !== true) throw new Error("Despacho da Receita Mestre exige confirmação humana explícita.");
  if (expectedResolvedHash !== resolved.hashes.resolvedHash) throw new Error("expectedResolvedHash diverge da receita resolvida.");
  const preflight = preflightResolvedMasterRecipe(resolved);
  if (preflight.status !== "ready") throw new Error(`Despacho bloqueado no preflight: ${preflight.blockers.map((blocker) => blocker.code).join(", ")}.`);
  const productionSet = compileMasterRecipeProductions(resolved, { knowledgeContext });
  const fingerprints = productionSet.productions.map((production) => production.planFingerprint);
  if (!fingerprints.includes(expectedPlanFingerprint)) throw new Error("expectedPlanFingerprint não pertence ao conjunto de produção.");
  return {
    schema: "gerador-de-videos/recipe-dispatch@1",
    status: "accepted-by-application-service",
    resolvedHash: resolved.hashes.resolvedHash,
    expectedPlanFingerprint,
    productionSet,
    preflight,
    executionBoundary: "cli-execution-kernel",
    providerCalls: 0,
  };
}

function requiredCapabilities(recipe) {
  if (!["2.5B", "2.5C", "2.5D"].includes(recipe.vertical)) return [];
  const required = new Map();
  const add = (intent, operation, capabilityId = null) => required.set(`${intent}:${operation}:${capabilityId ?? ""}`, { intent, operation, capabilityId });
  for (const shot of recipe.videoGeneration.shots) {
    const operation = ({ "text-to-video": "text-to-video", "image-to-video": "image-to-video", "reference-to-video": "reference-to-video", "edit-video": "edit" })[shot.task];
    const intent = ({ "text-to-video": "video.generate.text", "image-to-video": "video.generate.image", "reference-to-video": "video.generate.reference", "edit-video": "video.edit" })[shot.task];
    if (operation && intent) add(intent, operation);
  }
  if (recipe.narration) add(recipe.narration.speakerMode === "multi-voice" ? "narration.generate.segmented-multi-voice" : "narration.generate.single-voice", recipe.narration.speakerMode === "multi-voice" ? "segmented-text-to-speech" : "text-to-speech");
  if (recipe.music) add("music.generate.timeline", "music-generate");
  add("media.compose.local", "hybrid-compose");
  if (["2.5C", "2.5D"].includes(recipe.vertical) && recipe.graphics.scenes.some((graphic) => graphic.renderer === "html-canvas@1")) {
    const [capabilityId, operation] = RECIPE_GRAPHICS_RENDERERS["html-canvas@1"].capability.split(":");
    add("graphics.render.html", operation, capabilityId);
  }
  return [...required.values()];
}

export function preflightResolvedMasterRecipe(resolved, { capabilities = PROVIDER_CAPABILITIES } = {}) {
  const recipe = resolved.recipe;
  const blockers = [];
  if (!["2.5B", "2.5C", "2.5D"].includes(resolved.vertical)) return { schema: "gerador-de-videos/recipe-preflight@1", status: "ready", vertical: resolved.vertical, blockers, checks: [], providerCalls: 0 };
  if (recipe.mix?.sceneAudioGainDb != null && (recipe.transitions?.edges ? recipe.transitions.edges.some((edge) => RECIPE_TRANSITIONS[edge.transition].ffmpeg !== "cut") : RECIPE_TRANSITIONS[recipe.assembly.transition].ffmpeg !== "cut")) blockers.push({ code: "scene-audio-transition-unsupported", pointer: "/mix/sceneAudioGainDb", message: "Inclusão de áudio das cenas exige cortes; xfade com áudio ainda não tem consumidor." });
  for (const cue of recipe.sfx.cues) {
    const asset = recipe.assets.find((entry) => entry.id === cue.assetId);
    if (asset?.source.kind !== "knowledge-core" || asset?.authorization.mode !== "scope-grant") blockers.push({ code: "local-sfx-authorization-required", pointer: "/sfx/cues", assetId: cue.assetId, message: "SFX exige asset knowledge-core e binding scope-grant; run/resume revalidam direitos e bytes com --asset-context." });
  }
  const providerAssetIds = new Set(recipe.videoGeneration.shots.flatMap((shot) => shot.inputAssetIds));
  for (const [index, asset] of recipe.assets.entries()) {
    if (providerAssetIds.has(asset.id) && asset.rights.providerInput !== "allowed") blockers.push({ code: "provider-input-rights-not-allowed", pointer: `/assets/${index}/rights/providerInput`, assetId: asset.id });
    if (!providerAssetIds.has(asset.id) && asset.rights.reuse !== "allowed") blockers.push({ code: "local-reuse-rights-not-allowed", pointer: `/assets/${index}/rights/reuse`, assetId: asset.id });
    if (!asset.authorization?.bindingHash) blockers.push({ code: "authorization-binding-missing", pointer: `/assets/${index}/authorization`, assetId: asset.id });
  }
  for (const [index, shot] of recipe.videoGeneration.shots.entries()) {
    if (shot.task === "end-frame") blockers.push({ code: "capability-end-frame-unproved", pointer: `/videoGeneration/shots/${index}/task` });
  }
  if (["2.5C", "2.5D"].includes(resolved.vertical) && recipe.qa.semantic) blockers.push({ code: "capability-semantic-qa-unproved", pointer: "/qa/semantic" });
  // Fase 9/E0: a proveniência do pedido é medida, nunca bloqueante. Tornar
  // obrigatório quebraria toda receita existente; virar bloqueador é decisão
  // humana separada, com o número de cobertura na mão.
  const pedidoLiteral = String(recipe.identity?.request ?? "").trim();
  const checks = [{
    kind: "request-provenance",
    status: pedidoLiteral ? "ready" : "missing",
    hasRequestText: Boolean(pedidoLiteral),
    requestChars: pedidoLiteral.length,
  }, ...requiredCapabilities(recipe).map(({ intent, operation, capabilityId }) => {
    const resolution = resolveCapabilityIntent(capabilities, { intent, operation, capabilityId });
    if (resolution.status !== "ready") blockers.push({ code: intent === "narration.generate.segmented-multi-voice" ? "capability-multi-voice-unproved" : "capability-not-ready", intent, operation });
    return { kind: "capability-intent", intent, operation, status: resolution.status, capabilityId: resolution.capability?.id ?? null, provider: resolution.capability?.adapterProvider ?? resolution.capability?.id ?? null, evidence: resolution.capability?.evidence ?? resolution.candidates[0]?.evidence ?? null };
  })];
  return { schema: "gerador-de-videos/recipe-preflight@1", status: blockers.length ? "blocked" : "ready", vertical: resolved.vertical, blockers, checks, providerCalls: 0 };
}

export async function preflightMasterRecipeBytes(resolved, { workspaceRoot = path.resolve(".."), capabilities = PROVIDER_CAPABILITIES, authorizeLocalAssets = null } = {}) {
  const report = preflightResolvedMasterRecipe(resolved, { capabilities });
  if (!["2.5B", "2.5C", "2.5D"].includes(resolved.vertical)) return report;
  const blockers = [...report.blockers];
  const checks = [...report.checks];
  for (const [index, asset] of resolved.recipe.assets.entries()) {
    const usedLogo = asset.role === "logo" && resolved.recipe.postProduction?.operations.some(op => op.operation === "logo-overlay@1" && op.assetId === asset.id);
    const usedHtml = asset.role === "graphics-document" && resolved.recipe.graphics?.scenes.some(graphic => graphic.renderer === "html-canvas@1" && graphic.documentAssetId === asset.id);
    if (usedHtml && (asset.source.kind !== "knowledge-core" || asset.mimeType !== "text/html")) {
      blockers.push({ code: "local-html-authorization-required", pointer: `/assets/${index}`, assetId: asset.id, message: "HTML exige documento text/html governado e --asset-context com direitos e bytes vigentes." });
      continue;
    }
    if (usedLogo && asset.source.kind !== "knowledge-core") {
      blockers.push({ code: "local-post-authorization-required", pointer: `/assets/${index}`, assetId: asset.id, message: "Logo exige asset knowledge-core e --asset-context com direitos e bytes vigentes." });
      continue;
    }
    if (asset.source.kind === "knowledge-core") {
      const usedSfx = asset.role === "sfx" && resolved.recipe.sfx.cues.some(cue => cue.assetId === asset.id);
      if ((!usedSfx && !usedLogo && !usedHtml) || typeof authorizeLocalAssets !== "function") {
        blockers.push({ code: "governed-asset-context-required", pointer: `/assets/${index}`, assetId: asset.id, message: "SFX, logo e HTML governados exigem --asset-context para conferir direitos e bytes; outros papéis exigem seu consumidor governado." });
      } else {
        try {
          const [entry] = await authorizeLocalAssets({ rootScopeId: resolved.recipe.scope.rootScopeId, assets: [asset] });
          if (!entry?.evidence) throw new Error("Asset sem evidência de autorização.");
          checks.push({ kind: "asset-bytes-rights", assetId: asset.id, status: "ready", evidence: entry.evidence });
        } catch (error) {
          blockers.push({ code: "governed-asset-blocked", pointer: `/assets/${index}`, assetId: asset.id, message: error.message });
        }
      }
      continue;
    }
    const sourcePath = path.resolve(workspaceRoot, asset.source.locator);
    try {
      const metadata = await stat(sourcePath);
      const body = await readFile(sourcePath);
      const actualHash = sha256(body);
      const ready = metadata.isFile() && metadata.size === asset.bytes && actualHash === asset.sha256;
      if (!ready) blockers.push({ code: "asset-bytes-diverged", pointer: `/assets/${index}`, assetId: asset.id });
      checks.push({ kind: "asset-bytes", assetId: asset.id, status: ready ? "ready" : "blocked", declaredBytes: asset.bytes, actualBytes: metadata.size, declaredSha256: asset.sha256, actualSha256: actualHash });
    } catch {
      blockers.push({ code: "asset-unreadable", pointer: `/assets/${index}`, assetId: asset.id });
      checks.push({ kind: "asset-bytes", assetId: asset.id, status: "blocked" });
    }
  }
  return { ...report, status: blockers.length ? "blocked" : "ready", blockers, checks, providerCalls: 0 };
}

export function inspectMasterRecipe(sourceBytes, options = {}) {
  const parsed = parseMasterRecipe(sourceBytes, options);
  const resolved = resolveMasterRecipe(parsed);
  return { parsed, resolved, ...compileResolvedMasterRecipe(resolved, options), providerCalls: 0 };
}
