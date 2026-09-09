import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, parseMasterRecipe, resolveMasterRecipe } from "./master-recipe-v2.mjs";

export const LEGACY_RECIPE_REPORT_SCHEMA = "gerador-de-videos/legacy-recipe-report@1";
const AUTHORING_SCHEMAS = new Set([
  "gerador-de-videos/receita@1",
  "mkt-videos/production-spec@1",
  "mkt-videos/master-recipe@1",
  "mkt-videos/v18-recipe@1",
]);
const BUNDLE_SCHEMAS = new Set(["mkt-videos/recipe-variety@1", "mkt-videos/recipe-variety-filme@1"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const slug = (value, fallback) => String(value ?? fallback).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 64) || fallback;

function classification(schema, file) {
  const normalized = file.replaceAll("\\", "/");
  if (schema === "gerador-de-videos/receita@2") return "autoria-atual";
  if (AUTHORING_SCHEMAS.has(schema)) return "autoria-legada";
  if (BUNDLE_SCHEMAS.has(schema)) return "bundle-propostas";
  if (schema === "mkt-videos/recipe@2") return "assinatura-derivada";
  if (/motion|instruction-bank|guidance/iu.test(normalized)) return "banco-motion";
  if (/\/outputs\//u.test(normalized)) return "copia-output";
  return "documento-json";
}

function blocked({ schema, reason, contentHash }) {
  return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "legado-bloqueado", sourceSchema: schema ?? null, contentHash, reason, providerCalls: 0 };
}

export function upcastLegacyRecipeBytes(sourceBytes, { sourceName = "legacy.json", rootScopeId = "client:legacy-import" } = {}) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(String(sourceBytes), "utf8");
  const contentHash = sha256(bytes);
  let source;
  try {
    source = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: null, contentHash, reason: `JSON inválido: ${error.message}`, providerCalls: 0 };
  }
  const schema = source?.schema;
  if (schema === "gerador-de-videos/receita@2") {
    try {
      const resolved = resolveMasterRecipe(parseMasterRecipe(bytes, { channel: "legacy-reader" }));
      return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "upcast-equivalente", sourceSchema: schema, contentHash, originalUnchanged: true, recipe: resolved.recipe, resolvedHash: resolved.hashes.resolvedHash, providerCalls: 0 };
    } catch (error) {
      return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: schema, contentHash, reason: error.message, providerCalls: 0 };
    }
  }
  if (schema !== "gerador-de-videos/receita@1") return blocked({ schema, reason: BUNDLE_SCHEMAS.has(schema) ? "bundle possui papel próprio e exige seleção humana de um item" : "reader determinístico não implementado para este schema", contentHash });
  if (!Array.isArray(source.scenes) || !source.scenes.length) return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: schema, contentHash, reason: "receita@1 sem scenes", providerCalls: 0 };
  if (source.narration || source.voice || source.speakers || source.scenes.some((scene) => scene.narration || scene.voice || /narra[cç][aã]o/iu.test(String(scene.prompt ?? "")))) {
    return blocked({ schema, reason: "narração legada não possui equivalência provada; conversão silenciosa para Vids é proibida", contentHash });
  }
  if (source.kind === "lote") return blocked({ schema, reason: "lote legado exige matriz e política de falha explícitas", contentHash });
  const fps = Number(source.assembly?.fps ?? 24);
  if (!Number.isInteger(fps) || fps <= 0) return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: schema, contentHash, reason: "fps legado inválido", providerCalls: 0 };
  const shots = source.scenes.map((scene, index) => ({ id: slug(scene.id, `scene-${index + 1}`), durationFrames: Math.round(Number(scene.duration ?? 10) * fps) }));
  if (shots.some((shot) => !Number.isInteger(shot.durationFrames) || shot.durationFrames <= 0)) return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: schema, contentHash, reason: "duração de cena inválida", providerCalls: 0 };
  const recipe = {
    schema: "gerador-de-videos/receita@2",
    mode: "studio",
    kind: "peca",
    identity: { id: slug(source.id, slug(path.basename(sourceName, path.extname(sourceName)), "legacy")), revision: 1, name: String(source.label ?? source.id ?? sourceName).slice(0, 160) },
    scope: { rootScopeId, projectScopeId: slug(source.collection ?? source.id, "legacy-import") },
    format: { master: { width: source.aspect === "9:16" ? 1080 : 1920, height: source.aspect === "9:16" ? 1920 : 1080, fps: { numerator: fps, denominator: 1 } } },
    program: { durationPolicy: "fixed-frames", durationFrames: shots.reduce((sum, shot) => sum + shot.durationFrames, 0), shots },
    videoGeneration: { module: "omni-video@1", task: "text-to-video", shots: source.scenes.map((scene, index) => ({ shotId: shots[index].id, prompt: String(scene.prompt ?? "").trim() })) },
    assembly: { module: "ffmpeg-assembly@1", mode: "concat", transition: "cut@1" },
  };
  try {
    const resolved = resolveMasterRecipe(parseMasterRecipe(canonicalJson(recipe), { channel: "legacy-upcast" }));
    return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "upcast-equivalente", sourceSchema: schema, contentHash, originalUnchanged: true, recipe: resolved.recipe, resolvedHash: resolved.hashes.resolvedHash, providerCalls: 0 };
  } catch (error) {
    return { schema: LEGACY_RECIPE_REPORT_SCHEMA, status: "inválido", sourceSchema: schema, contentHash, reason: error.message, providerCalls: 0 };
  }
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) output.push(absolute);
  }
  return output;
}

export async function inventoryRecipeDocuments({ roots = [] } = {}) {
  const entries = [];
  for (const root of [...new Set(roots.map((value) => path.resolve(String(value))))]) {
    for (const file of await walk(root)) {
      const bytes = await readFile(file);
      let schema = null;
      let validJson = true;
      try { schema = JSON.parse(bytes.toString("utf8"))?.schema ?? null; } catch { validJson = false; }
      entries.push({ root, path: path.relative(root, file).replaceAll("\\", "/"), schema, role: validJson ? classification(schema, file) : "json-invalido", contentHash: sha256(bytes), bytes: bytes.length });
    }
  }
  entries.sort((left, right) => left.root.localeCompare(right.root) || left.path.localeCompare(right.path));
  return { schema: "gerador-de-videos/recipe-inventory@1", generatedFromFilesystem: true, count: entries.length, entries, inventoryHash: sha256(canonicalJson(entries)), providerCalls: 0 };
}

