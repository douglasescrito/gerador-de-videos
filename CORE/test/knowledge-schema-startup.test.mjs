import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("Receita Mestre exporta contratos sem AJV e valida todas as verticais sob demanda", async () => {
  const probe = `
    import assert from "node:assert/strict";
    import Module from "node:module";
    import { readFileSync } from "node:fs";
    let loads = 0;
    const load = Module._load;
    Module._load = function(request, ...args) {
      if (request === "ajv/dist/2020.js") loads++;
      return load.call(this, request, ...args);
    };
    const recipe = await import(${JSON.stringify(new URL("../lib/media-pipeline/master-recipe-v2.mjs", import.meta.url).href)});
    assert.equal(loads, 0);
    assert.ok(recipe.getMasterRecipeSchema());
    assert.ok(recipe.getMasterRecipeParameterCatalog().parameters.length > 100);
    assert.ok(recipe.getMasterRecipeRegistries());
    assert.equal(loads, 0);
    for (const name of ["golden-30s.receita-v2.json", "golden-30s.receita-v2.5b.json", "golden-30s.receita-v2.5c.json", "golden-180s.receita-v2.5d.json"]) {
      const source = readFileSync(new URL(name, ${JSON.stringify(new URL("../recipes/", import.meta.url).href)}), "utf8");
      recipe.parseMasterRecipe(source);
      const invalid = JSON.parse(source);
      invalid.format.master.width = -1;
      assert.throws(() => recipe.parseMasterRecipe(JSON.stringify(invalid)), /Receita Mestre inválida/);
      recipe.parseMasterRecipe(source);
    }
    assert.equal(loads, 1);
    console.log("lazy-master-proved");
  `;
  const result = await execute(process.execPath, ["--input-type=module", "-e", probe], { windowsHide: true });
  assert.equal(result.stdout.trim(), "lazy-master-proved");
});

test("registry adia schemas/AJV e prepara somente contratos usados, com referências, ciclos e recusas intactos", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-schema-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "lib/media-pipeline"), { recursive: true });
  await mkdir(path.join(root, "schemas"));
  await copyFile(new URL("../lib/media-pipeline/knowledge-schema-registry.mjs", import.meta.url), path.join(root, "lib/media-pipeline/registry.mjs"));
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const schemas = {
    root: { type: "object", additionalProperties: false, required: ["child"], properties: { child: { $ref: "mkt-videos/child@1" } } },
    child: { type: "object", additionalProperties: false, required: ["email"], properties: { email: { type: "string", format: "email" }, parent: { $ref: "mkt-videos/root@1" } } },
    broken: { $ref: "mkt-videos/absent@1" },
    unrelated: { type: "invalid-type" },
  };
  for (const [id, schema] of Object.entries(schemas)) await writeFile(path.join(root, "schemas", `knowledge-${id}.schema.json`), JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `mkt-videos/${id}@1`, ...schema }));
  const probe = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import Module, { syncBuiltinESMExports } from "node:module";
    let reads = 0, ajvLoads = 0;
    const registrations = [];
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...args) { if (String(file).endsWith(".schema.json") && String(file).includes("knowledge-")) reads++; return read.call(this, file, ...args); };
    syncBuiltinESMExports();
    const load = Module._load;
    Module._load = function(request, ...args) {
      const result = load.call(this, request, ...args);
      if (request === "ajv/dist/2020.js") {
        ajvLoads++;
        const add = result.default.prototype.addSchema;
        result.default.prototype.addSchema = function(schema, ...rest) {
          if (schema.$id?.startsWith("urn:mkt-videos-schema:")) registrations.push(schema.$id);
          return add.call(this, schema, ...rest);
        };
      }
      return result;
    };
    const registry = await import("./lib/media-pipeline/registry.mjs");
    assert.equal(reads, 0); assert.equal(ajvLoads, 0);
    assert.equal(registry.validateKnowledgeContract({}).valid, false);
    assert.equal(reads, 0);
    assert.equal(registry.listKnowledgeSchemas().length, 4);
    assert.equal(reads, 4); assert.equal(ajvLoads, 0);
    assert.equal(registry.validateKnowledgeContract({}, {schemaId:"mkt-videos/unknown@1"}).errors[0].keyword, "unknownSchema");
    assert.equal(ajvLoads, 0);
    const validate = value => registry.validateKnowledgeContract(value, {schemaId:"mkt-videos/root@1"});
    assert.equal(validate({child:{email:"fixture@example.invalid", parent:{child:{email:"nested@example.invalid"}}}}).valid, true);
    assert.equal(validate({child:{email:"invalid"}}).valid, false);
    assert.equal(validate({child:{email:"fixture@example.invalid", secret:"not-allowed"}}).valid, false);
    assert.equal(registrations.length, 2);
    assert.equal(reads, 4); assert.equal(ajvLoads, 1);
    assert.throws(() => registry.validateKnowledgeContract({}, {schemaId:"mkt-videos/broken@1"}), /resolve reference/);
    assert.throws(() => registry.validateKnowledgeContract({}, {schemaId:"mkt-videos/unrelated@1"}), /schema is invalid/);
    assert.equal(validate({child:{email:"still@example.invalid"}}).valid, true);
    console.log("lazy-contracts-proved");
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = await execute(process.execPath, ["--input-type=module", "-e", probe], { cwd: root, env, windowsHide: true });
  assert.equal(result.stdout.trim(), "lazy-contracts-proved");
});
