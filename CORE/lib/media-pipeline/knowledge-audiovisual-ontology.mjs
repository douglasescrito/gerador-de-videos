import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const AUDIOVISUAL_ONTOLOGY_SCHEMA =
  "mkt-videos/audiovisual-ontology@1";
export const AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE =
  "knowledge/audiovisual-ontology@1.json";
export const MAX_AUDIOVISUAL_ONTOLOGY_BYTES = 1024 * 1024;
export const MAX_AUDIOVISUAL_ONTOLOGY_JSON_DEPTH = 96;

export const AUDIOVISUAL_ONTOLOGY_REQUIRED_ENTITY_TYPES = Object.freeze({
  context: Object.freeze([
    "Client",
    "Brand",
    "Person",
    "Project",
    "Production",
    "Deliverable",
    "Brief",
    "Audience",
    "Channel",
    "Format",
    "Campaign",
  ]),
  "audiovisual-language": Object.freeze([
    "Sequence",
    "Scene",
    "Shot",
    "Beat",
    "Transition",
    "Track",
    "Layer",
    "MotionPrimitive",
    "MotionPattern",
    "MotionPrinciple",
    "VisualGrammar",
    "SoundGrammar",
    "NarrativeFunction",
  ]),
  "operational-knowledge": Object.freeze([
    "StyleSpec",
    "Recipe",
    "Provider",
    "Capability",
    "ToolAdapter",
    "RenderNode",
    "DeliveryProfile",
    "BrandKit",
    "Reference",
    "Artifact",
    "Receipt",
    "Decision",
    "Feedback",
    "Evaluation",
    "KnowledgeRelease",
  ]),
});

export const AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS = Object.freeze([
  "belongsTo",
  "commissionedBy",
  "represents",
  "targets",
  "usesBrandKit",
  "deliveredAs",
  "approvedBy",
  "supersedes",
  "derivedFrom",
]);

export const AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES = Object.freeze({
  fact: "when-verifiable",
  capability: "while-valid",
  "hard-constraint": "yes",
  preference: "no",
  heuristic: "no",
  observation: "no",
  hypothesis: "no",
  "anti-pattern": "guidance",
});

const DEFAULT_CORE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const FORBIDDEN_JSON_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const DANGEROUS_TEXT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

function normalizeJson(value, location = "$") {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${location} contém número não finito.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normalizeJson(entry, `${location}[${index}]`)
    );
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${location} deve conter somente valores JSON.`);
    }
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_JSON_KEYS.has(key)) {
        throw new Error(`${location}.${key} é uma chave JSON proibida.`);
      }
      normalized[key] = normalizeJson(value[key], `${location}.${key}`);
    }
    return normalized;
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalAudiovisualOntologyHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

function unchangedFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function assertPlainDirectory(target, label) {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} não existe.`);
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} não pode ser symlink ou junction.`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} deve ser um diretório real.`);
  }
  return await realpath(target);
}

async function resolveGovernedOntologyFile(coreRoot) {
  const requestedCore = path.resolve(String(coreRoot ?? DEFAULT_CORE_ROOT));
  const canonicalCore = await assertPlainDirectory(
    requestedCore,
    "CORE root",
  );
  const knowledgeDirectory = path.join(requestedCore, "knowledge");
  const canonicalKnowledge = await assertPlainDirectory(
    knowledgeDirectory,
    "CORE/knowledge",
  );
  if (!isInside(canonicalCore, canonicalKnowledge)) {
    throw new Error("CORE/knowledge escapou de CORE.");
  }
  const requestedFile = path.join(
    requestedCore,
    ...AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE.split("/"),
  );
  return {
    coreRoot: canonicalCore,
    knowledgeDirectory: canonicalKnowledge,
    file: requestedFile,
  };
}

async function readPlainOntologyFile(file, knowledgeDirectory) {
  const label = "Ontologia audiovisual";
  let before;
  try {
    before = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} não existe.`);
    throw error;
  }
  if (before.isSymbolicLink()) {
    throw new Error(`${label} não pode ser symlink ou junction.`);
  }
  if (!before.isFile()) {
    throw new Error(`${label} deve ser arquivo regular.`);
  }
  if (before.nlink > 1) {
    throw new Error(`${label} não pode ser hardlink.`);
  }
  if (before.size < 2 || before.size > MAX_AUDIOVISUAL_ONTOLOGY_BYTES) {
    throw new Error(
      `${label} deve ter entre 2 e ${MAX_AUDIOVISUAL_ONTOLOGY_BYTES} bytes.`,
    );
  }
  const canonicalFile = await realpath(file);
  if (!isInside(knowledgeDirectory, canonicalFile)) {
    throw new Error(`${label} escapou de CORE/knowledge.`);
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(file, flags);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.nlink > 1
      || !unchangedFile(before, opened)
    ) {
      throw new Error(`${label} mudou ou deixou de ser arquivo regular.`);
    }
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterPath = await lstat(file);
    const canonicalAfter = await realpath(file);
    if (
      !unchangedFile(opened, afterHandle)
      || !unchangedFile(opened, afterPath)
      || canonicalAfter !== canonicalFile
    ) {
      throw new Error(`${label} mudou durante a leitura.`);
    }
    return {
      bytes,
      fileSha256: sha256(bytes),
    };
  } finally {
    await handle.close();
  }
}

function assertNoDuplicateJsonKeys(source, label) {
  let offset = 0;
  const skipWhitespace = () => {
    while (offset < source.length && /\s/.test(source[offset])) offset += 1;
  };
  const readString = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === "\\") {
        offset += 2;
      } else if (character === "\"") {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      } else {
        offset += 1;
      }
    }
    throw new Error(`${label} não contém JSON válido.`);
  };
  const readValue = (depth = 0) => {
    if (depth > MAX_AUDIOVISUAL_ONTOLOGY_JSON_DEPTH) {
      throw new Error(
        `${label} excede nesting JSON de `
        + `${MAX_AUDIOVISUAL_ONTOLOGY_JSON_DEPTH}.`,
      );
    }
    skipWhitespace();
    const character = source[offset];
    if (character === "{") {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) {
          throw new Error(`${label} contém chave JSON duplicada.`);
        }
        keys.add(key);
        skipWhitespace();
        offset += 1;
        readValue(depth + 1);
        skipWhitespace();
        if (source[offset] === "}") {
          offset += 1;
          return;
        }
        offset += 1;
      }
      return;
    }
    if (character === "[") {
      offset += 1;
      skipWhitespace();
      if (source[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        readValue(depth + 1);
        skipWhitespace();
        if (source[offset] === "]") {
          offset += 1;
          return;
        }
        offset += 1;
      }
      return;
    }
    if (character === "\"") {
      readString();
      return;
    }
    while (
      offset < source.length
      && !/[\s,\]}]/.test(source[offset])
    ) {
      offset += 1;
    }
  };
  readValue();
  skipWhitespace();
  if (offset !== source.length) {
    throw new Error(`${label} não contém JSON válido.`);
  }
}

function parseOntology(bytes) {
  const label = "Ontologia audiovisual";
  let source;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(`${label} não contém UTF-8 válido.`);
  }
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error(`${label} não contém JSON válido.`);
  }
  assertNoDuplicateJsonKeys(source, label);
  return document;
}

function assertUniqueBy(values, keyFor, label) {
  const seen = new Set();
  values.forEach((value, index) => {
    const key = keyFor(value);
    if (seen.has(key)) {
      throw new Error(`${label} contém duplicata em [${index}]: ${key}.`);
    }
    seen.add(key);
  });
  return seen;
}

function assertSafeTextValues(value, location = "$") {
  if (typeof value === "string") {
    if (DANGEROUS_TEXT_CONTROL_PATTERN.test(value)) {
      throw new Error(`${location} contém controle Unicode proibido.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafeTextValues(entry, `${location}[${index}]`)
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertSafeTextValues(entry, `${location}.${key}`);
    }
  }
}

function assertRequiredVocabulary(document) {
  const entityIds = assertUniqueBy(
    document.entityTypes,
    (entity) => entity.id,
    "entityTypes",
  );
  const entityById = new Map(
    document.entityTypes.map((entity) => [entity.id, entity]),
  );
  const expectedEntityCount = Object.values(
    AUDIOVISUAL_ONTOLOGY_REQUIRED_ENTITY_TYPES,
  ).reduce((total, ids) => total + ids.length, 0);
  if (entityIds.size !== expectedEntityCount) {
    throw new Error(
      `audiovisual-ontology@1 exige exatamente ${expectedEntityCount} `
      + "tipos de entidade; extensões exigem nova versão.",
    );
  }
  for (const [domain, requiredIds] of Object.entries(
    AUDIOVISUAL_ONTOLOGY_REQUIRED_ENTITY_TYPES,
  )) {
    for (const id of requiredIds) {
      const entity = entityById.get(id);
      if (!entity) {
        throw new Error(`Ontologia não declara entidade obrigatória ${id}.`);
      }
      if (entity.domain !== domain) {
        throw new Error(
          `Entidade ${id} deve pertencer ao domínio ${domain}.`,
        );
      }
    }
  }
  if (
    entityById.get("Campaign")?.activationGate
    !== "future-explicit-policy"
  ) {
    throw new Error(
      "Campaign exige activationGate future-explicit-policy.",
    );
  }

  const relationIds = assertUniqueBy(
    document.relations,
    (relation) => relation.id,
    "relations",
  );
  if (
    relationIds.size
    !== AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS.length
  ) {
    throw new Error(
      "audiovisual-ontology@1 exige exatamente "
      + `${AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS.length} relações; `
      + "extensões exigem nova versão.",
    );
  }
  for (const id of AUDIOVISUAL_ONTOLOGY_REQUIRED_RELATIONS) {
    if (!relationIds.has(id)) {
      throw new Error(`Ontologia não declara relação obrigatória ${id}.`);
    }
  }
  for (const relation of document.relations) {
    for (const [role, references] of [
      ["domain", relation.domain],
      ["range", relation.range],
    ]) {
      for (const reference of references) {
        if (!entityIds.has(reference)) {
          throw new Error(
            `Relação ${relation.id}.${role} referencia entidade `
            + `desconhecida ${reference}.`,
          );
        }
      }
    }
  }
}

function assertEpistemicModalities(document) {
  const expected = AUDIOVISUAL_ONTOLOGY_EPISTEMIC_MODALITIES;
  const modalityIds = assertUniqueBy(
    document.epistemicModalities,
    (modality) => modality.id,
    "epistemicModalities",
  );
  const expectedIds = Object.keys(expected);
  if (
    modalityIds.size !== expectedIds.length
    || expectedIds.some((id) => !modalityIds.has(id))
  ) {
    throw new Error(
      "Modalidades epistêmicas devem coincidir exatamente com domain-pack@1.",
    );
  }
  for (const modality of document.epistemicModalities) {
    if (modality.obligation !== expected[modality.id]) {
      throw new Error(
        `Modalidade ${modality.id} exige obligation `
        + `${expected[modality.id]}.`,
      );
    }
  }
}

function assertChangelog(document) {
  const versions = assertUniqueBy(
    document.changelog,
    (entry) => entry.version,
    "changelog",
  );
  if (!versions.has(document.version)) {
    throw new Error(
      `changelog deve declarar a versão atual ${document.version}.`,
    );
  }
  let previous = 0;
  for (const entry of document.changelog) {
    if (entry.version <= previous || entry.version > document.version) {
      throw new Error(
        "changelog deve estar em ordem crescente e não exceder a versão.",
      );
    }
    previous = entry.version;
  }
}

export function assertAudiovisualOntologySemantics(document) {
  assertSafeTextValues(document);
  assertUniqueBy(document.authors, (author) => author.id, "authors");
  assertRequiredVocabulary(document);
  assertEpistemicModalities(document);
  assertChangelog(document);
}

export async function loadAudiovisualOntology({
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const governed = await resolveGovernedOntologyFile(coreRoot);
  const { bytes, fileSha256 } = await readPlainOntologyFile(
    governed.file,
    governed.knowledgeDirectory,
  );
  const document = parseOntology(bytes);
  assertKnowledgeContract(document, {
    schemaId: AUDIOVISUAL_ONTOLOGY_SCHEMA,
    label: "Ontologia audiovisual",
  });
  assertAudiovisualOntologySemantics(document);
  const result = {
    ref: `${document.id}@${document.version}`,
    file: AUDIOVISUAL_ONTOLOGY_RELATIVE_FILE,
    fileSha256,
    contentHash: canonicalAudiovisualOntologyHash(document),
    document,
  };
  return deepFreeze(result);
}
