import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const DOMAIN_PACK_SCHEMA = "mkt-videos/domain-pack@1";
export const DOMAIN_PACK_CATALOG_SCHEMA =
  "mkt-videos/domain-pack-catalog@1";
export const DOMAIN_PACKS_RELATIVE_DIRECTORY = "knowledge/domain-packs";
export const DOMAIN_PACK_INTERNAL_POLICY_FILES = Object.freeze({
  "urn:mkt-videos:governance:agents-md": "../AGENTS.md",
  "urn:mkt-videos:governance:brand-kit-contract":
    "schemas/brand-kit.schema.json",
  "urn:mkt-videos:governance:domain-pack-terms":
    "knowledge/DOMAIN-PACK-TERMS.md",
});

const DEFAULT_CORE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACK_FILE_PATTERN =
  /^([a-z][a-z0-9-]{0,95})@([1-9][0-9]*)[.]domain-pack[.]json$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_DOMAIN_PACKS = 64;
export const MAX_DOMAIN_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_DOMAIN_PACK_AGGREGATE_BYTES = 16 * 1024 * 1024;
export const MAX_DOMAIN_PACK_JSON_DEPTH = 128;
const FORBIDDEN_JSON_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const EDITORIAL_MODALITIES = new Set([
  "preference",
  "heuristic",
  "observation",
  "hypothesis",
  "anti-pattern",
]);
const POLICY_MODALITIES = new Set([
  "fact",
  "capability",
  "hard-constraint",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DANGEROUS_TEXT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

const COVERAGE_PROFILES = {
  "motion-foundations": [
    "composition",
    "visual-hierarchy",
    "contrast",
    "balance",
    "scale",
    "negative-space",
    "motion-typography",
    "color",
    "staging",
    "timing",
    "spacing",
    "easing",
    "anticipation",
    "overshoot",
    "follow-through",
    "overlap",
    "holds",
    "arcs",
    "trajectory",
    "camera",
    "depth",
    "parallax",
    "continuity",
    "match-cut",
    "transitions",
    "rhythm",
    "audiovisual-synchronization",
    "readability",
    "safe-areas",
  ],
  "commercial-storytelling": [
    "business-objective",
    "funnel-stage",
    "audience",
    "tension",
    "promise",
    "benefit",
    "proof",
    "reason-to-believe",
    "objection",
    "hook",
    "demonstration",
    "offer",
    "signature",
    "call-to-action",
    "brand",
    "channel",
    "duration",
    "mobile-behavior",
    "audience-language",
    "substantiated-claims",
  ],
  "documentary-practice": [
    "observational-mode",
    "expository-mode",
    "participatory-mode",
    "poetic-mode",
    "reflexive-mode",
    "performative-mode",
    "claims",
    "sources",
    "evidence",
    "certainty",
    "interview",
    "b-roll",
    "archive",
    "reconstruction",
    "point-of-view",
    "factual-continuity",
    "consent",
    "anonymization",
    "sensitivity",
    "generated-image-disclosure",
    "fact-interpretation-dramatization",
  ],
  "short-film-language": [
    "premise",
    "theme",
    "logline",
    "character",
    "desire",
    "need",
    "obstacle",
    "stakes",
    "arc",
    "beats",
    "scene-function",
    "turn",
    "climax",
    "resolution",
    "point-of-view",
    "geography",
    "continuity",
    "camera-language",
    "editing",
    "sound-design",
    "narrative-economy",
  ],
  "sound-and-music": [
    "voice",
    "performance-intent",
    "prosody",
    "intelligibility",
    "rhythm",
    "music",
    "theme",
    "texture",
    "dynamics",
    "silence",
    "sound-effects",
    "synchronization",
    "ducking",
    "loudness",
    "clean-cut",
    "no-default-fade",
    "accessibility",
    "provider-limitations",
  ],
  "brand-and-channel": [
    "identity",
    "logo",
    "typography",
    "color",
    "tone",
    "required-terms",
    "prohibited-terms",
    "platform",
    "aspect-ratio",
    "safe-area",
    "duration",
    "captions",
    "mobile-first",
    "accessibility",
    "delivery-variants",
  ],
  "hybrid-rendering": [
    "generative-rendering",
    "deterministic-rendering",
    "hybrid-combination",
    "alpha",
    "compositing",
    "exact-typography",
    "ui",
    "data-visualization",
    "assets",
    "frame-rate",
    "color-management",
    "cache",
    "determinism",
    "environment",
    "licenses",
    "provenance",
  ],
};

export const DOMAIN_PACK_REQUIRED_COVERAGE = Object.freeze(
  Object.fromEntries(
    Object.entries(COVERAGE_PROFILES).map(([id, tags]) => [
      id,
      Object.freeze([...tags]),
    ]),
  ),
);

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

export function canonicalDomainPackHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function packRef(id, version) {
  return `${id}@${version}`;
}

function comparePack(left, right) {
  return compareText(left.document.id, right.document.id)
    || left.document.version - right.document.version;
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

async function assertPlainDirectory(target, label) {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} não existe.`);
    }
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

async function resolveGovernedPackDirectory(coreRoot) {
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
  const packsDirectory = path.join(knowledgeDirectory, "domain-packs");
  const canonicalPacks = await assertPlainDirectory(
    packsDirectory,
    "CORE/knowledge/domain-packs",
  );
  if (
    !isInside(canonicalCore, canonicalKnowledge)
    || !isInside(canonicalKnowledge, canonicalPacks)
  ) {
    throw new Error("Diretório governado de domain packs escapou de CORE.");
  }
  return {
    coreRoot: canonicalCore,
    packsDirectory: canonicalPacks,
  };
}

function unchangedFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function readPlainPackFile(file, packsDirectory, label) {
  const before = await lstat(file);
  if (before.isSymbolicLink()) {
    throw new Error(`${label} não pode ser symlink ou junction.`);
  }
  if (!before.isFile()) {
    throw new Error(`${label} deve ser arquivo regular.`);
  }
  if (before.nlink > 1) {
    throw new Error(`${label} não pode ser hardlink.`);
  }
  if (before.size < 2 || before.size > MAX_DOMAIN_PACK_BYTES) {
    throw new Error(
      `${label} deve ter entre 2 e ${MAX_DOMAIN_PACK_BYTES} bytes.`,
    );
  }
  const canonicalFile = await realpath(file);
  if (!isInside(packsDirectory, canonicalFile)) {
    throw new Error(`${label} escapou do diretório governado.`);
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

function parsePack(bytes, label) {
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
    if (depth > MAX_DOMAIN_PACK_JSON_DEPTH) {
      throw new Error(
        `${label} excede nesting JSON de ${MAX_DOMAIN_PACK_JSON_DEPTH}.`,
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
      throw new Error(
        `${location} contém controle Unicode proibido.`,
      );
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

function assertReferences(values, available, label) {
  values.forEach((value) => {
    if (!available.has(value)) {
      throw new Error(`${label} referencia ID ausente: ${value}.`);
    }
  });
}

function assertSafeHttpsUri(uri, label) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`${label} deve ser URI HTTPS válida.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
  ) {
    throw new Error(
      `${label} deve ser HTTPS e não pode conter credenciais.`,
    );
  }
}

function assertSourceSemantics(source, label) {
  const internal = source.sourceKind === "internal-policy";
  if (internal) {
    if (
      !Object.hasOwn(DOMAIN_PACK_INTERNAL_POLICY_FILES, source.uri)
      || !source.uri.startsWith("urn:mkt-videos:governance:")
      || source.usageMode !== "normative-policy"
      || source.sourceTerms.status !== "not-applicable"
      || source.sourceTerms.licenseId !== null
      || source.sourceTerms.termsUri !== null
      || !HASH_PATTERN.test(source.sourceContentHash ?? "")
    ) {
      throw new Error(
        `${label} internal-policy exige URN permitida, hash da política, `
        + "uso normativo e termos não aplicáveis.",
      );
    }
    return;
  }
  if (
    !source.uri.startsWith("https://")
    || source.usageMode === "normative-policy"
    || source.sourceContentHash != null
  ) {
    throw new Error(
      `${label} externo exige HTTPS, não pode usar normative-policy nem `
      + "alegar hash de política interna.",
    );
  }
  assertSafeHttpsUri(source.uri, `${label}.uri`);
  const terms = source.sourceTerms;
  if (terms.status === "not-applicable") {
    throw new Error(
      `${label} externo não pode declarar termos não aplicáveis.`,
    );
  }
  if (
    ["known", "public-domain"].includes(terms.status)
    && (
      typeof terms.licenseId !== "string"
      || typeof terms.termsUri !== "string"
    )
  ) {
    throw new Error(
      `${label} com termos ${terms.status} exige licença e URI.`,
    );
  }
  if (terms.status === "unknown" && terms.licenseId !== null) {
    throw new Error(
      `${label} com termos desconhecidos não pode alegar licenseId.`,
    );
  }
  if (terms.termsUri !== null) {
    assertSafeHttpsUri(terms.termsUri, `${label}.sourceTerms.termsUri`);
  }
}

function assertPackLicenseSemantics(packLicense) {
  if (
    packLicense.type !== "custom"
    || packLicense.identifier !== "MKT-Videos-Proprietary-Knowledge@1"
    || packLicense.termsUri
      !== "urn:mkt-videos:governance:domain-pack-terms"
    || !HASH_PATTERN.test(packLicense.termsContentHash ?? "")
  ) {
    throw new Error(
      "packLicense custom exige termos proprietários internos atestados.",
    );
  }
}

function assertPrincipleBasis(principle, sourceById, label) {
  const sources = principle.sourceIds.map((id) => sourceById.get(id));
  if (principle.basis === "source-grounded") {
    if (
      sources.length === 0
      || sources.some((source) => source.sourceKind === "internal-policy")
    ) {
      throw new Error(
        `${label} source-grounded exige fonte externa explícita.`,
      );
    }
    return;
  }
  if (principle.basis === "internal-policy") {
    if (
      sources.length === 0
      || sources.some((source) => source.sourceKind !== "internal-policy")
      || !POLICY_MODALITIES.has(principle.modality)
    ) {
      throw new Error(
        `${label} internal-policy exige somente política interna e `
        + "modalidade normativa.",
      );
    }
    return;
  }
  if (!EDITORIAL_MODALITIES.has(principle.modality)) {
    throw new Error(
      `${label} editorial-synthesis não pode alegar modalidade normativa.`,
    );
  }
}

function assertDefinitionBasis(definition, sourceById, label) {
  const sources = definition.sourceIds.map((id) => sourceById.get(id));
  if (definition.basis === "source-grounded") {
    if (
      sources.length === 0
      || sources.some((source) => source.sourceKind === "internal-policy")
    ) {
      throw new Error(
        `${label} source-grounded exige fonte externa explícita.`,
      );
    }
    return;
  }
  if (definition.basis === "internal-policy") {
    if (
      sources.length === 0
      || sources.some((source) => source.sourceKind !== "internal-policy")
    ) {
      throw new Error(
        `${label} internal-policy exige somente política interna.`,
      );
    }
  }
}

function assertDomainPackSemantics(document, fileName) {
  const expectedFile =
    `${document.id}@${document.version}.domain-pack.json`;
  if (fileName !== expectedFile) {
    throw new Error(
      `${fileName} diverge da identidade ${document.id}@${document.version}.`,
    );
  }

  assertSafeTextValues(document);
  assertPackLicenseSemantics(document.packLicense);
  assertUniqueBy(document.authors, (entry) => entry.id, "authors");
  assertUniqueBy(document.reviewers, (entry) => entry.id, "reviewers");
  const sourceIds = assertUniqueBy(
    document.sources,
    (entry) => entry.id,
    "sources",
  );
  const sourceById = new Map(
    document.sources.map((source) => [source.id, source]),
  );
  document.sources.forEach((source, index) =>
    assertSourceSemantics(source, `sources[${index}]`)
  );
  assertUniqueBy(document.definitions, (entry) => entry.id, "definitions");
  const principleIds = assertUniqueBy(
    document.principles,
    (entry) => entry.id,
    "principles",
  );
  assertUniqueBy(document.exceptions, (entry) => entry.id, "exceptions");
  assertUniqueBy(document.antiPatterns, (entry) => entry.id, "antiPatterns");
  assertUniqueBy(
    document.abstractExamples,
    (entry) => entry.id,
    "abstractExamples",
  );
  assertUniqueBy(
    document.counterExamples,
    (entry) => entry.id,
    "counterExamples",
  );

  document.definitions.forEach((definition, index) => {
    assertReferences(
      definition.sourceIds,
      sourceIds,
      `definitions[${index}].sourceIds`,
    );
    assertDefinitionBasis(
      definition,
      sourceById,
      `definitions[${index}]`,
    );
  });
  document.principles.forEach((principle, index) => {
    assertReferences(
      principle.sourceIds,
      sourceIds,
      `principles[${index}].sourceIds`,
    );
    assertPrincipleBasis(
      principle,
      sourceById,
      `principles[${index}]`,
    );
    assertUniqueBy(
      principle.tests,
      (entry) => entry.id,
      `principles[${index}].tests`,
    );
  });
  for (
    const [property, entries] of [
      ["exceptions", document.exceptions],
      ["antiPatterns", document.antiPatterns],
      ["abstractExamples", document.abstractExamples],
      ["counterExamples", document.counterExamples],
    ]
  ) {
    entries.forEach((entry, index) => {
      assertReferences(
        entry.principleIds,
        principleIds,
        `${property}[${index}].principleIds`,
      );
      assertReferences(
        entry.sourceIds,
        sourceIds,
        `${property}[${index}].sourceIds`,
      );
    });
  }
  const referencedSourceIds = new Set([
    ...document.definitions.flatMap((entry) => entry.sourceIds),
    ...document.principles.flatMap((entry) => entry.sourceIds),
    ...document.exceptions.flatMap((entry) => entry.sourceIds),
    ...document.antiPatterns.flatMap((entry) => entry.sourceIds),
    ...document.abstractExamples.flatMap((entry) => entry.sourceIds),
    ...document.counterExamples.flatMap((entry) => entry.sourceIds),
  ]);
  const orphanedSources = [...sourceIds].filter(
    (sourceId) => !referencedSourceIds.has(sourceId),
  );
  if (orphanedSources.length > 0) {
    throw new Error(
      `Fontes sem referência inbound: ${orphanedSources.join(", ")}.`,
    );
  }

  const coverageTags = assertUniqueBy(
    document.coverageTags,
    (entry) => entry.tag,
    "coverageTags",
  );
  const coveredPrinciples = new Set();
  document.coverageTags.forEach((coverage, index) => {
    assertReferences(
      coverage.principleIds,
      principleIds,
      `coverageTags[${index}].principleIds`,
    );
    coverage.principleIds.forEach((id) => coveredPrinciples.add(id));
  });
  assertReferences(
    document.requiredCoverage,
    coverageTags,
    "requiredCoverage",
  );
  const governedMinimum = DOMAIN_PACK_REQUIRED_COVERAGE[document.id] ?? [];
  const declaredRequired = new Set(document.requiredCoverage);
  const missingMinimum = governedMinimum.filter(
    (tag) => !declaredRequired.has(tag),
  );
  if (missingMinimum.length > 0) {
    throw new Error(
      `requiredCoverage não cobre o mínimo governado de ${document.id}: `
      + `${missingMinimum.join(", ")}.`,
    );
  }
  const uncoveredPrinciples = [...principleIds].filter(
    (id) => !coveredPrinciples.has(id),
  );
  if (uncoveredPrinciples.length > 0) {
    throw new Error(
      `Princípios sem coverageTags: ${uncoveredPrinciples.join(", ")}.`,
    );
  }

  const selfRef = packRef(document.id, document.version);
  assertUniqueBy(
    document.dependencies,
    (dependency) => packRef(dependency.id, dependency.version),
    "dependencies",
  );
  if (
    document.dependencies.some((dependency) =>
      packRef(dependency.id, dependency.version) === selfRef
    )
  ) {
    throw new Error(`${selfRef} não pode depender de si mesmo.`);
  }

  assertUniqueBy(
    document.changelog,
    (entry) => String(entry.version),
    "changelog",
  );
  let previousVersion = 0;
  for (const change of document.changelog) {
    if (
      change.version <= previousVersion
      || change.version > document.version
    ) {
      throw new Error(
        "changelog deve estar em ordem crescente e não pode antecipar versão.",
      );
    }
    previousVersion = change.version;
  }
  if (
    document.changelog[document.changelog.length - 1].version
    !== document.version
  ) {
    throw new Error("changelog não registra a versão atual do pack.");
  }
}

async function loadPackFile(entry, packsDirectory) {
  if (
    entry.isSymbolicLink()
    || !entry.isFile()
    || !PACK_FILE_PATTERN.test(entry.name)
  ) {
    throw new Error(
      "CORE/knowledge/domain-packs aceita somente arquivos "
      + "<id>@<version>.domain-pack.json regulares.",
    );
  }
  const file = path.join(packsDirectory, entry.name);
  if (!isInside(packsDirectory, file)) {
    throw new Error("Nome de domain pack escapou do diretório governado.");
  }
  const { bytes, fileSha256 } = await readPlainPackFile(
    file,
    packsDirectory,
    `Domain pack ${entry.name}`,
  );
  const document = parsePack(bytes, `Domain pack ${entry.name}`);
  assertKnowledgeContract(document, {
    schemaId: DOMAIN_PACK_SCHEMA,
    label: `Domain pack ${entry.name}`,
  });
  assertDomainPackSemantics(document, entry.name);
  return {
    document,
    file: entry.name,
    fileSha256,
    contentHash: canonicalDomainPackHash(document),
  };
}

async function hashInternalPolicyFile(coreRoot, relativePath, label) {
  const file = path.resolve(coreRoot, relativePath);
  let before;
  try {
    before = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} não existe.`);
    }
    throw error;
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink > 1
    || before.size < 2
    || before.size > MAX_DOMAIN_PACK_BYTES
  ) {
    throw new Error(
      `${label} deve ser arquivo regular, direto e limitado.`,
    );
  }
  const canonicalFile = await realpath(file);
  const normalizedCanonicalFile = path.normalize(canonicalFile);
  const normalizedRequestedFile = path.normalize(file);
  const samePath = process.platform === "win32"
    ? normalizedCanonicalFile.toLowerCase()
      === normalizedRequestedFile.toLowerCase()
    : normalizedCanonicalFile === normalizedRequestedFile;
  if (!samePath) {
    throw new Error(`${label} não pode atravessar symlink ou junction.`);
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
    if (
      !unchangedFile(opened, afterHandle)
      || !unchangedFile(opened, afterPath)
    ) {
      throw new Error(`${label} mudou durante a leitura.`);
    }
    return sha256(bytes);
  } finally {
    await handle.close();
  }
}

async function assertInternalPolicyBindings(records, coreRoot) {
  const actualHashes = new Map();
  const actualHashFor = async (uri) => {
    let actualHash = actualHashes.get(uri);
    if (!actualHash) {
      actualHash = await hashInternalPolicyFile(
        coreRoot,
        DOMAIN_PACK_INTERNAL_POLICY_FILES[uri],
        `Política interna ${uri}`,
      );
      actualHashes.set(uri, actualHash);
    }
    return actualHash;
  };
  for (const record of records) {
    const license = record.document.packLicense;
    if (license.type === "custom") {
      const actualHash = await actualHashFor(license.termsUri);
      if (license.termsContentHash !== actualHash) {
        throw new Error(
          `${record.document.id}@${record.document.version} declara hash `
          + `divergente para ${license.termsUri}.`,
        );
      }
    }
    for (const source of record.document.sources) {
      if (source.sourceKind !== "internal-policy") continue;
      const actualHash = await actualHashFor(source.uri);
      if (source.sourceContentHash !== actualHash) {
        throw new Error(
          `${record.document.id}@${record.document.version}/${source.id} `
          + `declara hash divergente para ${source.uri}.`,
        );
      }
    }
  }
}

async function preflightPackEntries(entries, packsDirectory) {
  if (entries.length > MAX_DOMAIN_PACKS) {
    throw new Error(
      `Catálogo excede o limite de ${MAX_DOMAIN_PACKS} domain packs.`,
    );
  }
  let aggregateBytes = 0;
  const snapshot = [];
  for (const entry of entries) {
    if (
      entry.isSymbolicLink()
      || !entry.isFile()
      || !PACK_FILE_PATTERN.test(entry.name)
    ) {
      throw new Error(
        "CORE/knowledge/domain-packs aceita somente arquivos "
        + "<id>@<version>.domain-pack.json regulares.",
      );
    }
    const file = path.join(packsDirectory, entry.name);
    const metadata = await lstat(file);
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || metadata.nlink > 1
    ) {
      throw new Error(
        `Domain pack ${entry.name} deve ser regular e não pode ser symlink, `
        + "junction ou hardlink.",
      );
    }
    if (
      metadata.size < 2
      || metadata.size > MAX_DOMAIN_PACK_BYTES
    ) {
      throw new Error(
        `Domain pack ${entry.name} deve ter entre 2 e `
        + `${MAX_DOMAIN_PACK_BYTES} bytes.`,
      );
    }
    aggregateBytes += metadata.size;
    if (aggregateBytes > MAX_DOMAIN_PACK_AGGREGATE_BYTES) {
      throw new Error(
        "Catálogo excede o limite agregado de "
        + `${MAX_DOMAIN_PACK_AGGREGATE_BYTES} bytes.`,
      );
    }
    snapshot.push({
      name: entry.name,
      dev: metadata.dev,
      ino: metadata.ino,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
      nlink: metadata.nlink,
    });
  }
  return snapshot;
}

async function assertPackDirectoryUnchanged(packsDirectory, snapshot) {
  const entries = (await readdir(packsDirectory, { withFileTypes: true }))
    .sort((left, right) => compareText(left.name, right.name));
  if (
    entries.length !== snapshot.length
    || entries.some((entry, index) => entry.name !== snapshot[index].name)
  ) {
    throw new Error(
      "Diretório de domain packs mudou durante a leitura.",
    );
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const expected = snapshot[index];
    const metadata = await lstat(path.join(packsDirectory, entry.name));
    if (
      entry.isSymbolicLink()
      || !entry.isFile()
      || !unchangedFile(expected, metadata)
    ) {
      throw new Error(
        "Diretório de domain packs mudou durante a leitura.",
      );
    }
  }
}

function resolveDependencies(records) {
  const byRef = new Map();
  for (const record of records) {
    const ref = packRef(record.document.id, record.document.version);
    if (byRef.has(ref)) {
      throw new Error(`Domain pack duplicado: ${ref}.`);
    }
    byRef.set(ref, record);
  }
  for (const record of records) {
    const sourceRef = packRef(record.document.id, record.document.version);
    for (const dependency of record.document.dependencies) {
      const targetRef = packRef(dependency.id, dependency.version);
      const target = byRef.get(targetRef);
      if (!target) {
        throw new Error(
          `${sourceRef} depende de pack ausente: ${targetRef}.`,
        );
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const loadOrder = [];
  const visit = (ref, trail = []) => {
    if (visiting.has(ref)) {
      throw new Error(
        `Ciclo entre domain packs: ${[...trail, ref].join(" -> ")}.`,
      );
    }
    if (visited.has(ref)) return;
    visiting.add(ref);
    const record = byRef.get(ref);
    const dependencies = record.document.dependencies
      .map((dependency) => packRef(dependency.id, dependency.version))
      .sort(compareText);
    dependencies.forEach((dependency) =>
      visit(dependency, [...trail, ref])
    );
    visiting.delete(ref);
    visited.add(ref);
    loadOrder.push(ref);
  };
  [...byRef.keys()].sort(compareText).forEach((ref) => visit(ref));
  for (const record of records) {
    const sourceRef = packRef(record.document.id, record.document.version);
    for (const dependency of record.document.dependencies) {
      const targetRef = packRef(dependency.id, dependency.version);
      const target = byRef.get(targetRef);
      if (
        !HASH_PATTERN.test(dependency.contentHash)
        || dependency.contentHash !== target.contentHash
      ) {
        throw new Error(
          `${sourceRef} declara hash divergente para ${targetRef}.`,
        );
      }
    }
  }
  return loadOrder;
}

function sourceIdentityForConsistency(source) {
  return {
    title: source.title,
    uri: source.uri,
    publisher: source.publisher,
    accessedAt: source.accessedAt,
    version: source.version ?? null,
    publishedAt: source.publishedAt ?? null,
    sourceKind: source.sourceKind,
    usageMode: source.usageMode,
    sourceContentHash: source.sourceContentHash ?? null,
    sourceTerms: {
      status: source.sourceTerms.status,
      licenseId: source.sourceTerms.licenseId,
      termsUri: source.sourceTerms.termsUri,
    },
  };
}

function assertCrossPackSourceConsistency(records) {
  const sourceById = new Map();
  for (const record of records) {
    const ref = packRef(record.document.id, record.document.version);
    for (const source of record.document.sources) {
      const identity = canonicalJson(sourceIdentityForConsistency(source));
      const previous = sourceById.get(source.id);
      if (previous && previous.identity !== identity) {
        throw new Error(
          `Fonte ${source.id} diverge entre ${previous.ref} e ${ref}.`,
        );
      }
      if (!previous) sourceById.set(source.id, { identity, ref });
    }
  }
}

function createManifest(records, loadOrder) {
  const body = {
    schema: DOMAIN_PACK_CATALOG_SCHEMA,
    directory: DOMAIN_PACKS_RELATIVE_DIRECTORY,
    packCount: records.length,
    loadOrder,
    packs: records.map((record) => ({
      ref: packRef(record.document.id, record.document.version),
      id: record.document.id,
      version: record.document.version,
      status: record.document.status,
      file: record.file,
      fileSha256: record.fileSha256,
      contentHash: record.contentHash,
      coverageTags: record.document.coverageTags
        .map((coverage) => coverage.tag)
        .sort(compareText),
      dependencies: record.document.dependencies
        .map((dependency) => ({
          ref: packRef(dependency.id, dependency.version),
          contentHash: dependency.contentHash,
        }))
        .sort((left, right) => compareText(left.ref, right.ref)),
    })),
  };
  const manifest = {
    ...body,
    manifestHash: canonicalDomainPackHash(body),
  };
  assertKnowledgeContract(manifest, {
    schemaId: DOMAIN_PACK_CATALOG_SCHEMA,
    label: "Manifest de domain packs",
  });
  return manifest;
}

export async function loadDomainPackCatalog({
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const {
    coreRoot: canonicalCoreRoot,
    packsDirectory,
  } = await resolveGovernedPackDirectory(coreRoot);
  const entries = (await readdir(packsDirectory, { withFileTypes: true }))
    .sort((left, right) => compareText(left.name, right.name));
  const directorySnapshot = await preflightPackEntries(
    entries,
    packsDirectory,
  );
  const records = [];
  for (const entry of entries) {
    records.push(await loadPackFile(entry, packsDirectory));
  }
  await assertPackDirectoryUnchanged(packsDirectory, directorySnapshot);
  records.sort(comparePack);
  await assertInternalPolicyBindings(records, canonicalCoreRoot);
  assertCrossPackSourceConsistency(records);
  const loadOrder = resolveDependencies(records);
  const manifest = createManifest(records, loadOrder);
  return deepFreeze({
    manifest,
    packs: records.map((record) => ({
      ref: packRef(record.document.id, record.document.version),
      file: record.file,
      fileSha256: record.fileSha256,
      contentHash: record.contentHash,
      document: record.document,
    })),
  });
}
