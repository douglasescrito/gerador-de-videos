import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRecipeRegistries } from "../lib/media-pipeline/recipe-registries.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  a: path.join(root, "schemas", "receita-v2.schema.json"),
  b: path.join(root, "schemas", "receita-v2.5b.schema.json"),
  modules: path.join(root, "schemas", "recipe-modules-v2.5c.json"),
  modulesD: path.join(root, "schemas", "recipe-modules-v2.5d.json"),
  c: path.join(root, "schemas", "receita-v2.5c.schema.json"),
  d: path.join(root, "schemas", "receita-v2.5d.schema.json"),
  catalog: path.join(root, "schemas", "parameter-catalog-v1.json"),
  registries: path.join(root, "schemas", "recipe-registries-v1.json"),
};

const [schemaA, schemaB, modules, modulesD] = await Promise.all([files.a, files.b, files.modules, files.modulesD].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
const schemaC = structuredClone(schemaB);
schemaC.$id = "gerador-de-videos/receita@2/vertical-2.5C";
schemaC.title = "Receita Mestre 2.5C - pos-producao e entrega";
schemaC.properties.vertical = { const: "2.5C" };
schemaC.required.push(...modules.required);
Object.assign(schemaC.properties, modules.properties);
for (const value of modules.assetExtensions.mediaKind) schemaC.$defs.asset.properties.mediaKind.enum.push(value);
for (const value of modules.assetExtensions.role) schemaC.$defs.asset.properties.role.enum.push(value);
schemaC.$defs.asset.properties.mimeType.pattern = "^(image|video|audio|text)/";
const schemaD = structuredClone(schemaC);
schemaD.$id = "gerador-de-videos/receita@2/vertical-2.5D";
schemaD.title = "Receita Mestre 2.5D - filme lote e longa duracao";
schemaD.properties.vertical = { const: "2.5D" };
schemaD.properties.kind = { enum: ["peca", "filme", "lote"] };
schemaD.required.push(...modulesD.required);
Object.assign(schemaD.properties, modulesD.properties);

const moduleConsumer = Object.freeze({
  identity: "knowledge-core-identity", scope: "knowledge-core-scope", context: "film-compiler", format: "film-compiler", program: "timeline-lock",
  assets: "runtime-input-guard", cast: "scene-reference-binding", videoGeneration: "omni-video", narration: "google-vids",
  alignment: "whisper-alignment", music: "flow-music", sfx: "local-sfx", captions: "word-captions", mix: "master-audio-video",
  assembly: "film-assembly", transitions: "film-assembly", graphics: "motion-graphics", postProduction: "post-production",
  qa: "qa", delivery: "delivery", variants: "variant",
  executionPolicy: "execution-kernel", batch: "batch-child-planner", reuse: "approved-reuse",
});

function pointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function leaves(schema, pointer = "", rootSchema = schema) {
  if (schema?.$ref) {
    const target = schema.$ref.split("/").slice(1).reduce((value, token) => value?.[token.replaceAll("~1", "/").replaceAll("~0", "~")], rootSchema);
    return leaves(target, pointer, rootSchema);
  }
  if (schema?.properties) return Object.entries(schema.properties).flatMap(([key, value]) => leaves(value, `${pointer}/${pointerToken(key)}`, rootSchema));
  if (schema?.items) return leaves(schema.items, `${pointer}/*`, rootSchema);
  if (schema?.anyOf) return schema.anyOf.flatMap((entry) => leaves(entry, pointer, rootSchema));
  const top = pointer.split("/")[1] ?? "envelope";
  return [{
    pointer: pointer || "/",
    type: schema?.type ?? (schema?.const !== undefined ? typeof schema.const : null),
    ...(schema?.const !== undefined ? { constant: schema.const } : {}),
    ...(schema?.enum ? { enum: schema.enum } : {}),
    ...(schema?.minimum !== undefined ? { minimum: schema.minimum } : {}),
    ...(schema?.maximum !== undefined ? { maximum: schema.maximum } : {}),
    consumer: moduleConsumer[top] ?? "recipe-envelope",
    trace: "resolutionTrace@1",
    assertion: `${top}-contract@1`,
    receipt: `${moduleConsumer[top] ?? "recipe"}-receipt-or-plan-assertion@1`,
  }];
}

const byPointer = new Map();
for (const [vertical, schema] of [["2.5A", schemaA], ["2.5B", schemaB], ["2.5C", schemaC], ["2.5D", schemaD]]) {
  for (const entry of leaves(schema)) {
    const current = byPointer.get(entry.pointer);
    if (!current) byPointer.set(entry.pointer, { ...entry, verticals: [vertical] });
    else if (!current.verticals.includes(vertical)) current.verticals.push(vertical);
  }
}
const parameters = [...byPointer.values()].sort((left, right) => left.pointer.localeCompare(right.pointer));
const registries = getRecipeRegistries();
const catalog = {
  schema: "gerador-de-videos/parameter-catalog@1",
  recipeSchema: "gerador-de-videos/receita@2",
  generatedFrom: [schemaA.$id, schemaB.$id, schemaC.$id, schemaD.$id, registries.schema],
  parameters,
};

const outputs = [[files.c, schemaC], [files.d, schemaD], [files.catalog, catalog], [files.registries, registries]];
const check = process.argv.includes("--check");
for (const [file, value] of outputs) {
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const current = await readFile(file, "utf8").catch(() => null);
    if (current !== expected) throw new Error(`Contrato gerado fora de sincronia: ${file}`);
  } else {
    await writeFile(file, expected, "utf8");
  }
}
console.log(check ? "Contratos receita@2 sincronizados." : "Contratos receita@2 gerados.");
