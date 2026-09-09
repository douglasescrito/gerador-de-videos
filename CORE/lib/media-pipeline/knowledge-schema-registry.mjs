import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const schemasRoot = fileURLToPath(
  new URL("../../schemas/", import.meta.url),
);
let schemas;
let schemasById;
function schemaIndex() {
  if (schemasById) return schemasById;
  const schemaFiles = readdirSync(schemasRoot)
    .filter((name) =>
      name === "scope-grant.schema.json"
      || name === "preference-rule.schema.json"
      || /^knowledge-.*[.]schema[.]json$/.test(name))
    .sort();
  const entries = schemaFiles.map((name) => {
    const file = path.join(schemasRoot, name);
    const schema = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof schema.$id !== "string"
      || !schema.$id.startsWith("mkt-videos/")
    ) {
      throw new Error(`Schema sem $id canônico: ${name}.`);
    }
    return { file, name, schema };
  });
  const index = new Map();
  for (const entry of entries) {
    if (index.has(entry.schema.$id)) throw new Error(`Schema duplicado: ${entry.schema.$id}.`);
    index.set(entry.schema.$id, entry);
  }
  schemas = entries;
  schemasById = index;
  return index;
}

function ajvSchemaId(schemaId) {
  return `urn:mkt-videos-schema:${encodeURIComponent(schemaId)}`;
}

function schemaForAjv(value) {
  if (Array.isArray(value)) return value.map(schemaForAjv);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (
        (key === "$id" || key === "$ref")
        && typeof entry === "string"
        && entry.startsWith("mkt-videos/")
      ) {
        return [key, ajvSchemaId(entry)];
      }
      return [key, schemaForAjv(entry)];
    }));
  }
  return value;
}

let ajv;
const registered = new Set();
function validatorFor(schemaId) {
  const index = schemaIndex();
  if (!index.has(schemaId)) return null;
  if (!ajv) {
    const Ajv2020 = require("ajv/dist/2020.js").default;
    const addFormats = require("ajv-formats").default;
    ajv = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      strict: true,
      validateFormats: true,
    });
    addFormats(ajv);
  }
  // Registrar somente o contrato solicitado e suas referências transitivas.
  // O Set de descoberta permite ciclos; o AJV continua responsável por validar
  // schemas, formatos e referências, inclusive referências ausentes.
  const pending = new Set();
  function collect(id) {
    if (registered.has(id) || pending.has(id)) return;
    const entry = index.get(id);
    if (!entry) return;
    pending.add(id);
    function walk(value) {
      if (!value || typeof value !== "object") return;
      if (typeof value.$ref === "string" && value.$ref.startsWith("mkt-videos/")) collect(value.$ref.split("#")[0]);
      for (const child of Object.values(value)) walk(child);
    }
    walk(entry.schema);
  }
  collect(schemaId);
  for (const id of pending) {
    ajv.addSchema(schemaForAjv(index.get(id).schema));
    registered.add(id);
  }
  return ajv.getSchema(ajvSchemaId(schemaId));
}

function normalizedErrors(errors = []) {
  return errors.map((error) => ({
    instancePath: error.instancePath || "/",
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "contrato inválido",
  }));
}

export function listKnowledgeSchemas() {
  schemaIndex();
  return schemas.map(({ name, schema }) => ({
    file: name,
    id: schema.$id,
  }));
}

export function validateKnowledgeContract(value, { schemaId = value?.schema } = {}) {
  const normalizedSchemaId = String(schemaId ?? "").trim();
  if (!normalizedSchemaId) {
    return {
      valid: false,
      schemaId: null,
      errors: [{
        instancePath: "/schema",
        schemaPath: null,
        keyword: "required",
        message: "schema canônico é obrigatório",
      }],
    };
  }
  const validate = validatorFor(normalizedSchemaId);
  if (!validate) {
    return {
      valid: false,
      schemaId: normalizedSchemaId,
      errors: [{
        instancePath: "/schema",
        schemaPath: null,
        keyword: "unknownSchema",
        message: "schema não registrado",
      }],
    };
  }
  const valid = Boolean(validate(value));
  return {
    valid,
    schemaId: normalizedSchemaId,
    errors: valid ? [] : normalizedErrors(validate.errors),
  };
}

export function assertKnowledgeContract(
  value,
  { schemaId = value?.schema, label = "Contrato de conhecimento" } = {},
) {
  const result = validateKnowledgeContract(value, { schemaId });
  if (!result.valid) {
    const summary = result.errors
      .slice(0, 8)
      .map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`${label} inválido (${result.schemaId ?? "sem schema"}): ${summary}.`);
  }
  return value;
}
