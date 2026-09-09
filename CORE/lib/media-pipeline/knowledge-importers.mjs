import { createHash } from "node:crypto";
import {
  assertKnowledgeRecordEnvelope,
  createKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import { verifyReceipt } from "./receipt.mjs";

export const KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA =
  "mkt-videos/knowledge-import-candidate@1";
export const KNOWLEDGE_IMPORT_BATCH_SCHEMA =
  "mkt-videos/knowledge-import-batch@1";

const SOURCE_CONTRACTS = Object.freeze({
  "style-spec": Object.freeze({
    schema: "mkt-videos/style-spec@1",
    recordType: "assertion",
    modality: "heuristic",
    sourceType: "style-spec",
  }),
  "brand-kit": Object.freeze({
    schema: "mkt-videos/brand-kit@1",
    recordType: "assertion",
    modality: "hard-constraint",
    sourceType: "brand-kit",
  }),
  recipe: Object.freeze({
    schema: "mkt-videos/recipe@2",
    recordType: "evidence",
    modality: "observation",
    sourceType: "recipe",
  }),
  "reference-evidence-index": Object.freeze({
    schema: "mkt-videos/reference-evidence-index@1",
    recordType: "evidence",
    modality: "observation",
    sourceType: "reference-evidence-index",
  }),
  "receipt-metadata": Object.freeze({
    schema: "mkt-videos/receipt@1",
    recordType: "evidence",
    modality: "observation",
    sourceType: "receipt-metadata",
  }),
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "sesskey",
  "sessiontoken",
  "token",
]);
const PATH_KEYS = new Set([
  "absolutepath",
  "endpoint",
  "file",
  "filepath",
  "localpath",
  "path",
  "root",
  "url",
  "uri",
]);
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/i,
  /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|cookie|credential|password|secret|sesskey)\s*[:=]\s*["']?[^\s,;]{4,}/i,
  /(?:https?|wss):\/\/[^/\s:@]+:[^/\s@]+@/i,
  /[?&](?:access_token|api_key|key|signature|sig|token)=[^&#\s]+/i,
  /\b(?:cookie|set-cookie)\s*:/i,
]);
const RECIPE_IDENTIFIER_KEYS = new Map([
  ["attemptid", "attempt"],
  ["artifactid", "artifact"],
  ["interactionid", "interaction"],
  ["jobid", "job"],
  ["receiptid", "receipt"],
  ["requestid", "request"],
  ["runid", "run"],
]);
const TECHNICAL_KEYS = new Set([
  "aspect",
  "aspectratio",
  "audiocodec",
  "bitrate",
  "channels",
  "codec",
  "colorrange",
  "colorspace",
  "container",
  "duration",
  "durationms",
  "durationseconds",
  "end",
  "fit",
  "format",
  "fps",
  "framerate",
  "height",
  "loop",
  "model",
  "muted",
  "offset",
  "offsetms",
  "pixelformat",
  "preserveaudio",
  "quality",
  "resolution",
  "samplerate",
  "size",
  "start",
  "streams",
  "task",
  "timelinefingerprint",
  "timing",
  "video",
  "videocodec",
  "width",
]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizedKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} deve ser um objeto.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} deve conter somente valores JSON.`);
  }
  return value;
}

function requiredText(value, label, maximum = 640) {
  if (typeof value !== "string") throw new Error(`${label} deve ser texto.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} deve ter entre 1 e ${maximum} caracteres.`);
  }
  return normalized;
}

function identifier(value, label) {
  const normalized = requiredText(value, label, 200);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} contém caracteres inválidos.`);
  }
  return normalized;
}

function sha256Value(value, label) {
  const normalized = requiredText(value, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} deve ser SHA-256.`);
  return normalized;
}

function safeString(value, label) {
  const normalized = String(value);
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${label} contém material sensível proibido.`);
  }
  return normalized;
}

function normalizeJson(value, location = "$", {
  dropPathKeys = false,
  dropSensitiveKeys = false,
} = {}) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return safeString(value, location);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${location} contém número não finito.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJson(entry, `${location}[${index}]`, {
      dropPathKeys,
      dropSensitiveKeys,
    }));
  }
  if (value && typeof value === "object") {
    const input = plainObject(value, location);
    const entries = [];
    for (const key of Object.keys(input).sort(compareText)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error(`${location} contém chave proibida.`);
      }
      const normalized = normalizedKey(key);
      if (SENSITIVE_KEYS.has(normalized)) {
        if (dropSensitiveKeys) continue;
        throw new Error(`${location} contém campo sensível proibido.`);
      }
      if (dropPathKeys && PATH_KEYS.has(normalized)) continue;
      entries.push([key, normalizeJson(input[key], `${location}.${key}`, {
        dropPathKeys,
        dropSensitiveKeys,
      })]);
    }
    return Object.fromEntries(entries);
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value));
}

function normalizeHashMaterial(value, location = "$") {
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
      normalizeHashMaterial(entry, `${location}[${index}]`));
  }
  if (value && typeof value === "object") {
    const input = plainObject(value, location);
    return Object.fromEntries(Object.keys(input).sort(compareText).map((key) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error(`${location} contém chave proibida.`);
      }
      return [key, normalizeHashMaterial(input[key], `${location}.${key}`)];
    }));
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

export function computeKnowledgeImportSourceHash(source) {
  const normalized = normalizeHashMaterial(
    plainObject(source, "import source"),
    "$source",
  );
  return createHash("sha256")
    .update(JSON.stringify(normalized), "utf8")
    .digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function optionalText(value, label) {
  return value == null ? undefined : safeString(value, label);
}

function optionalJson(value, label, options) {
  return value == null ? undefined : normalizeJson(value, label, options);
}

function pseudonymousId(kind, value, namespace) {
  return `pid_${kind}_${sha256({
    kind,
    namespace: String(namespace),
    value: String(value),
  }).slice(0, 24)}`;
}

function technicalProjection(value, location = "$technical") {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry, index) => technicalProjection(entry, `${location}[${index}]`));
  }
  if (typeof value !== "object") return normalizeJson(value, location);
  const input = plainObject(value, location);
  const result = {};
  for (const key of Object.keys(input).sort(compareText)) {
    const normalized = normalizedKey(key);
    if (!TECHNICAL_KEYS.has(normalized)) continue;
    const projected = technicalProjection(input[key], `${location}.${key}`);
    if (projected !== undefined) result[key] = projected;
  }
  return result;
}

function collectPseudonymousRecipeIds(source, namespace) {
  const found = new Map();
  function visit(value, depth = 0) {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const input = plainObject(value, "recipe identifier metadata");
    for (const [key, entry] of Object.entries(input)) {
      const kind = RECIPE_IDENTIFIER_KEYS.get(normalizedKey(key));
      if (kind && (typeof entry === "string" || typeof entry === "number")) {
        const pseudonym = pseudonymousId(kind, entry, namespace);
        found.set(`${kind}\0${pseudonym}`, { kind, pseudonym });
      } else {
        visit(entry, depth + 1);
      }
    }
  }
  visit(source);
  return [...found.values()].sort((left, right) =>
    compareText(`${left.kind}\0${left.pseudonym}`, `${right.kind}\0${right.pseudonym}`));
}

function hashOnly(value) {
  if (typeof value === "string" && SHA256_PATTERN.test(value.toLowerCase())) {
    return value.toLowerCase();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value.hash ?? value.contentHash ?? value.fingerprint;
    if (typeof candidate === "string" && SHA256_PATTERN.test(candidate.toLowerCase())) {
      return candidate.toLowerCase();
    }
    if (
      candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && typeof candidate.value === "string"
      && SHA256_PATTERN.test(candidate.value.toLowerCase())
    ) {
      return candidate.value.toLowerCase();
    }
  }
  return undefined;
}

function sanitizeStyleSpec(source, { rootScopeId }) {
  const referenceEvidence = Array.isArray(source.referenceEvidence)
    ? source.referenceEvidence.map((entry, index) => {
      const value = plainObject(entry, `style.referenceEvidence[${index}]`);
      const evidenceHash = sha256Value(value.sha256, `style.referenceEvidence[${index}].sha256`);
      return compactObject([
        ["id", `reference_${evidenceHash.slice(0, 24)}`],
        ["sha256", evidenceHash],
        ["timeRanges", optionalJson(value.timeRanges, `style.referenceEvidence[${index}].timeRanges`)],
        ["usage", optionalText(value.usage, `style.referenceEvidence[${index}].usage`)],
        ["rightsStatus", optionalText(value.rightsStatus, `style.referenceEvidence[${index}].rightsStatus`)],
      ]);
    }).sort((left, right) => compareText(left.sha256, right.sha256))
    : undefined;
  const validation = source.validation == null
    ? undefined
    : compactObject([
      ["model", optionalText(source.validation.model, "style.validation.model")],
      ["checkedAt", optionalText(source.validation.checkedAt, "style.validation.checkedAt")],
      ["humanVerdict", optionalText(source.validation.humanVerdict, "style.validation.humanVerdict")],
      ["aspects", optionalJson(source.validation.aspects, "style.validation.aspects")],
      ["receiptIds", Array.isArray(source.validation.receiptIds)
        ? source.validation.receiptIds
          .map((id) => pseudonymousId("receipt", id, rootScopeId))
          .sort(compareText)
        : undefined],
    ]);
  return normalizeJson(compactObject([
    ["schema", source.schema],
    ["id", requiredText(source.id, "style.id", 200)],
    ["label", requiredText(source.label, "style.label", 500)],
    ["direction", requiredText(source.direction, "style.direction", 20_000)],
    ["aspect", source.aspect == null ? null : optionalText(source.aspect, "style.aspect")],
    ["tags", optionalJson(source.tags, "style.tags")],
    ["family", requiredText(source.family, "style.family", 200)],
    ["status", requiredText(source.status, "style.status", 80)],
    ["studioOnly", source.studioOnly],
    ["generation", optionalJson(source.generation, "style.generation", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    })],
    ["formats", optionalJson(source.formats, "style.formats", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    })],
    ["capabilities", optionalJson(source.capabilities, "style.capabilities", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    })],
    ["runtimeInputs", optionalJson(source.runtimeInputs, "style.runtimeInputs", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    })],
    ["referenceEvidence", referenceEvidence],
    ["validation", validation],
    ["risks", optionalJson(source.risks, "style.risks")],
    ["supersedes", source.supersedes == null ? undefined : optionalText(source.supersedes, "style.supersedes")],
    ["sanitization", {
      localReferencePathsRemoved: true,
      receiptIdentifiersPseudonymized: true,
    }],
  ]), "$style-payload", {
    dropPathKeys: true,
    dropSensitiveKeys: false,
  });
}

function sanitizeBrandKit(source) {
  const logos = Array.isArray(source.logos)
    ? source.logos.map((entry, index) => {
      const value = plainObject(entry, `brand.logos[${index}]`);
      return normalizeJson(compactObject([
        ["id", optionalText(value.id, `brand.logos[${index}].id`)],
        ["hash", hashOnly(value)],
        ["fidelity", optionalText(value.fidelity, `brand.logos[${index}].fidelity`)],
        ["requiredForRoles", optionalJson(value.requiredForRoles, `brand.logos[${index}].requiredForRoles`)],
      ]), `brand.logos[${index}]`, {
        dropPathKeys: true,
        dropSensitiveKeys: true,
      });
    })
    : [];
  return normalizeJson({
    schema: source.schema,
    id: requiredText(source.id, "brand.id", 200),
    version: Number(source.version),
    palette: optionalJson(source.palette, "brand.palette") ?? [],
    typography: optionalJson(source.typography, "brand.typography", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    }) ?? {},
    logos,
    requiredTerms: optionalJson(source.requiredTerms, "brand.requiredTerms", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    }) ?? [],
    forbiddenTerms: optionalJson(source.forbiddenTerms, "brand.forbiddenTerms", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    }) ?? [],
    maxOnScreenWords: Number(source.maxOnScreenWords),
    safeAreas: optionalJson(source.safeAreas, "brand.safeAreas", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    }) ?? {},
    captionStyle: optionalText(source.captionStyle, "brand.captionStyle") ?? null,
    motion: optionalJson(source.motion, "brand.motion", {
      dropPathKeys: true,
      dropSensitiveKeys: true,
    }) ?? {},
    sanitization: {
      assetPathsRemoved: true,
      sensitiveFieldsRemoved: true,
    },
  }, "$brand-payload", {
    dropPathKeys: true,
    dropSensitiveKeys: false,
  });
}

function sanitizeRecipe(source, { rootScopeId }) {
  const inputHashes = Array.isArray(source.inputHashes)
    ? [...new Set(source.inputHashes.map((value, index) =>
      sha256Value(value, `recipe.inputHashes[${index}]`)))].sort(compareText)
    : [];
  const brandKitHash = hashOnly(source.brandKit);
  const presetHash = hashOnly(source.preset);
  const technical = compactObject([
    ["operation", requiredText(source.operation, "recipe.operation", 200)],
    ["provider", requiredText(source.provider, "recipe.provider", 200)],
    ["model", optionalText(source.model, "recipe.model")],
    ["task", optionalText(source.task, "recipe.task")],
    ["aspect", optionalText(source.aspect, "recipe.aspect")],
    ["resolution", technicalProjection(source.resolution, "recipe.resolution")],
    ["timing", technicalProjection(source.timing, "recipe.timing")],
    ["parameters", technicalProjection(source.parameters, "recipe.parameters")],
    ["metadata", technicalProjection(source.metadata, "recipe.metadata")],
    ["inputHashes", inputHashes],
    ["presetHash", presetHash],
    ["brandKitHash", brandKitHash],
    ["captionStyle", optionalText(source.captionStyle, "recipe.captionStyle")],
    ["identifiers", collectPseudonymousRecipeIds(source, rootScopeId)],
  ]);
  return normalizeJson({
    schema: source.schema,
    technical,
    sanitization: {
      allowlist: "recipe-technical@1",
      privateTextRemoved: true,
      promptRemoved: true,
      identifiersPseudonymized: true,
      pathsRemoved: true,
    },
  }, "$recipe-payload", {
    dropPathKeys: true,
    dropSensitiveKeys: false,
  });
}

function sanitizeReferenceEvidenceIndex(source) {
  if (source?.policy?.providerInput !== "explicit-authorization-required") {
    throw new Error("Reference evidence deve exigir autorização explícita de provider-input.");
  }
  if (Number(source?.policy?.providerCalls ?? 0) !== 0) {
    throw new Error("Reference evidence importável deve ser provider-free.");
  }
  if (!Array.isArray(source.videos)) throw new Error("Reference evidence exige videos[].");
  if (Number(source.videoCount) !== source.videos.length) {
    throw new Error("Reference evidence possui videoCount divergente.");
  }
  const evidence = source.videos.map((entry, index) => {
    const value = plainObject(entry, `reference.videos[${index}]`);
    const contentHash = sha256Value(value.sha256, `reference.videos[${index}].sha256`);
    if (
      value.classification !== "inspiration-evidence"
      || value.usage !== "local-study-only"
      || value.providerInputPolicy !== "explicit-authorization-required"
    ) {
      throw new Error("Reference evidence viola a política local-study-only.");
    }
    return {
      id: `reference_${contentHash.slice(0, 24)}`,
      sha256: contentHash,
      classification: "inspiration-evidence",
      usage: "local-study-only",
      providerInputPolicy: "explicit-authorization-required",
      media: technicalProjection(value.media, `reference.videos[${index}].media`) ?? {},
    };
  }).sort((left, right) => compareText(left.sha256, right.sha256));
  return normalizeJson({
    schema: source.schema,
    fingerprint: sha256Value(source.fingerprint, "reference.fingerprint"),
    videoCount: evidence.length,
    evidence,
    inventory: {
      framesInspected: Boolean(source.policy.framesInspected),
      filesMoved: Boolean(source.policy.filesMoved),
      filesCopied: Boolean(source.policy.filesCopied),
      providerCalls: 0,
    },
    antiImitation: {
      providerInputAllowed: false,
      creatorIdentifiersRetained: false,
      localPathsRetained: false,
      allowedUse: "abstract-principles-only",
    },
  }, "$reference-payload", {
    dropPathKeys: true,
    dropSensitiveKeys: false,
  });
}

function sanitizeReceiptMetadata(source, { rootScopeId }) {
  const validation = verifyReceipt(source);
  if (!validation.valid) {
    throw new Error(
      `Receipt metadata exige recibo íntegro: ${validation.errors.join(" ")}`,
    );
  }
  const inputHashes = [...new Set(
    (Array.isArray(source.inputs) ? source.inputs : [])
      .map(hashOnly)
      .filter(Boolean),
  )].sort(compareText);
  const artifactHashes = [...new Set(
    (Array.isArray(source.artifacts) ? source.artifacts : [])
      .map(hashOnly)
      .filter(Boolean),
  )].sort(compareText);
  const probe = source.metadata?.probe
    ?? source.metadata?.after
    ?? source.metadata?.outputProbe
    ?? null;
  const technical = compactObject([
    ["operation", requiredText(source.operation, "receipt.operation", 200)],
    ["provider", requiredText(source.provider, "receipt.provider", 200)],
    ["model", optionalText(source.model, "receipt.model")],
    ["status", requiredText(source.status, "receipt.status", 80)],
    ["task", optionalText(source.parameters?.task, "receipt.parameters.task")],
    ["aspect", optionalText(
      source.parameters?.aspect,
      "receipt.parameters.aspect",
    )],
    ["parameters", technicalProjection(
      source.parameters,
      "receipt.parameters",
    )],
    ["probe", technicalProjection(probe, "receipt.probe")],
    ["timings", technicalProjection(source.timings, "receipt.timings")],
    ["inputHashes", inputHashes],
    ["artifactHashes", artifactHashes],
    ["receiptHash", sha256Value(
      source.hash.value,
      "receipt.hash.value",
    )],
    ["receiptId", pseudonymousId("receipt", source.id, rootScopeId)],
    ["startedAt", optionalText(source.startedAt, "receipt.startedAt")],
    ["completedAt", optionalText(source.completedAt, "receipt.completedAt")],
  ]);
  return normalizeJson({
    schema: source.schema,
    technical,
    sanitization: {
      allowlist: "receipt-archive-metadata@1",
      promptRemoved: true,
      providerResponseRemoved: true,
      privateMetadataRemoved: true,
      pathsRemoved: true,
      identifiersPseudonymized: true,
    },
  }, "$receipt-metadata-payload", {
    dropPathKeys: true,
    dropSensitiveKeys: false,
  });
}

function validateEmbeddedSourceHash(sourceKind, source) {
  if (sourceKind === "style-spec") return;
  if (sourceKind === "receipt-metadata") {
    const validation = verifyReceipt(source);
    if (!validation.valid) {
      throw new Error(
        `Receipt metadata exige recibo íntegro: ${validation.errors.join(" ")}`,
      );
    }
    return;
  }
  const embedded = sourceKind === "reference-evidence-index"
    ? source.fingerprint
    : source.hash;
  sha256Value(embedded, `${sourceKind}.embeddedHash`);
}

function buildCandidate(sourceKind, source, options, sanitize) {
  const contract = SOURCE_CONTRACTS[sourceKind];
  const input = plainObject(options, "import options");
  const sourceObject = plainObject(source, sourceKind);
  if (sourceObject.schema !== contract.schema) {
    throw new Error(`${sourceKind} exige schema ${contract.schema}.`);
  }
  if (!Object.hasOwn(input, "classification")) {
    throw new Error("classification explícita é obrigatória.");
  }
  if (!Object.hasOwn(input, "owner")) throw new Error("owner explícito é obrigatório.");
  if (!Object.hasOwn(input, "rights")) throw new Error("rights explícitos são obrigatórios.");
  const rightsInput = plainObject(input.rights, "rights");
  const sourceHash = computeKnowledgeImportSourceHash(sourceObject);
  validateEmbeddedSourceHash(sourceKind, sourceObject);
  if (
    input.sourceHash != null
    && sha256Value(input.sourceHash, "sourceHash") !== sourceHash
  ) {
    throw new Error(
      `${sourceKind} sourceHash diverge dos bytes canônicos da fonte.`,
    );
  }
  const sourceRef = requiredText(input.sourceRef, "sourceRef");
  const rootScopeId = identifier(input.rootScopeId, "rootScopeId");
  const scopeId = identifier(input.scopeId, "scopeId");
  const createdBy = requiredText(input.createdBy, "createdBy", 200);
  const referenceSource = sourceKind === "reference-evidence-index";
  if (referenceSource && rightsInput.providerInput === "allowed") {
    throw new Error("Reference evidence nunca pode autorizar provider-input.");
  }
  const rights = referenceSource
    ? { ...rightsInput, providerInput: "denied" }
    : { ...rightsInput };
  const envelope = createKnowledgeRecordEnvelope({
    classification: input.classification,
    owner: input.owner,
    provenance: [{
      sourceType: contract.sourceType,
      sourceRef,
      method: "read-only-import",
      observedAt: input.observedAt,
      contentHash: sourceHash,
    }],
    modality: contract.modality,
    evidenceIds: input.evidenceIds ?? [],
    retention: input.retention,
    rights,
    createdAt: input.createdAt,
    createdBy,
  }, {
    expectedActor: createdBy,
  });
  const material = {
    schema: KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA,
    status: "candidate",
    providerFree: true,
    readOnly: true,
    sourceKind,
    sourceSchema: contract.schema,
    sourceHash,
    sourceRef,
    rootScopeId,
    scopeId,
    recordType: contract.recordType,
    payload: sanitize(sourceObject, {
      rootScopeId,
      scopeId,
      owner: envelope.owner,
      sourceHash,
      sourceRef,
    }),
    envelope,
  };
  const contentHash = sha256(material);
  const candidate = {
    ...material,
    id: `kic_${contentHash.slice(0, 32)}`,
    contentHash,
  };
  return deepFreeze(assertKnowledgeImportCandidate(candidate));
}

function candidateMaterial(candidate) {
  const { id: _id, contentHash: _contentHash, ...material } = candidate;
  return material;
}

function batchMaterial(batch) {
  const { id: _id, contentHash: _contentHash, ...material } = batch;
  return material;
}

export function assertKnowledgeImportCandidate(candidate) {
  assertKnowledgeContract(candidate, {
    schemaId: KNOWLEDGE_IMPORT_CANDIDATE_SCHEMA,
    label: "Knowledge import candidate",
  });
  assertKnowledgeRecordEnvelope(candidate.envelope, {
    expectedActor: candidate.envelope.createdBy,
  });
  const contentHash = sha256(candidateMaterial(candidate));
  if (candidate.contentHash !== contentHash) {
    throw new Error("Knowledge import candidate possui contentHash inválido.");
  }
  if (candidate.id !== `kic_${contentHash.slice(0, 32)}`) {
    throw new Error("Knowledge import candidate possui ID não derivado do hash.");
  }
  if (candidate.status !== "candidate") {
    throw new Error("Knowledge import candidate não pode ser promovido automaticamente.");
  }
  if (candidate.sourceKind === "reference-evidence-index"
      && candidate.envelope.rights.providerInput !== "denied") {
    throw new Error("Reference evidence nunca pode autorizar provider-input.");
  }
  normalizeJson(candidate, "$candidate");
  return candidate;
}

export function assertKnowledgeImportBatch(batch) {
  assertKnowledgeContract(batch, {
    schemaId: KNOWLEDGE_IMPORT_BATCH_SCHEMA,
    label: "Knowledge import batch",
  });
  for (const candidate of batch.candidates) {
    assertKnowledgeImportCandidate(candidate);
    if (candidate.rootScopeId !== batch.rootScopeId) {
      throw new Error("Knowledge import batch atravessa rootScopeId.");
    }
  }
  const contentHash = sha256(batchMaterial(batch));
  if (batch.contentHash !== contentHash) {
    throw new Error("Knowledge import batch possui contentHash inválido.");
  }
  if (batch.id !== `kib_${contentHash.slice(0, 32)}`) {
    throw new Error("Knowledge import batch possui ID não derivado do hash.");
  }
  return batch;
}

export function createStyleSpecImportCandidate({ source, ...options } = {}) {
  return buildCandidate("style-spec", source, options, sanitizeStyleSpec);
}

export function createBrandKitImportCandidate({ source, ...options } = {}) {
  return buildCandidate("brand-kit", source, options, sanitizeBrandKit);
}

export function createRecipeImportCandidate({ source, ...options } = {}) {
  return buildCandidate("recipe", source, options, sanitizeRecipe);
}

export function createReferenceEvidenceImportCandidate({ source, ...options } = {}) {
  return buildCandidate(
    "reference-evidence-index",
    source,
    options,
    sanitizeReferenceEvidenceIndex,
  );
}

export function createReceiptMetadataImportCandidate({
  source,
  ...options
} = {}) {
  return buildCandidate(
    "receipt-metadata",
    source,
    options,
    sanitizeReceiptMetadata,
  );
}

function conflictRecord(type, key, candidates) {
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.id))].sort(compareText);
  const contentHashes = [...new Set(candidates.map((candidate) =>
    candidate.contentHash))].sort(compareText);
  if (candidateIds.length < 2 || contentHashes.length < 2) return null;
  return {
    type,
    keyHash: sha256({ type, key }),
    candidateIds,
    contentHashes,
  };
}

export function createKnowledgeImportBatch({ candidates } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("candidates deve conter ao menos um candidato.");
  }
  candidates.forEach(assertKnowledgeImportCandidate);
  const roots = [...new Set(candidates.map((candidate) => candidate.rootScopeId))];
  if (roots.length !== 1) {
    throw new Error("Knowledge import batch não pode atravessar rootScopeId.");
  }
  const occurrences = new Map();
  for (const candidate of candidates) {
    const existing = occurrences.get(candidate.contentHash);
    if (existing && canonicalJson(existing.candidate) !== canonicalJson(candidate)) {
      throw new Error("Colisão de contentHash entre candidatos divergentes.");
    }
    occurrences.set(candidate.contentHash, {
      candidate: existing?.candidate ?? candidate,
      count: (existing?.count ?? 0) + 1,
    });
  }
  const unique = [...occurrences.values()]
    .map(({ candidate }) => normalizeJson(candidate, "$candidate-clone"))
    .sort((left, right) =>
      compareText(`${left.id}\0${left.contentHash}`, `${right.id}\0${right.contentHash}`));
  const duplicates = [...occurrences.values()]
    .filter(({ count }) => count > 1)
    .map(({ candidate, count }) => ({
      candidateId: candidate.id,
      contentHash: candidate.contentHash,
      count,
    }))
    .sort((left, right) => compareText(left.contentHash, right.contentHash));

  const conflicts = [];
  const sameSource = new Map();
  const ownerScope = new Map();
  for (const candidate of unique) {
    const sourceKey = canonicalJson({
      rootScopeId: candidate.rootScopeId,
      scopeId: candidate.scopeId,
      sourceKind: candidate.sourceKind,
      sourceRef: candidate.sourceRef,
    });
    const sourceGroup = sameSource.get(sourceKey) ?? [];
    sourceGroup.push(candidate);
    sameSource.set(sourceKey, sourceGroup);

    const ownershipKey = canonicalJson({
      rootScopeId: candidate.rootScopeId,
      sourceKind: candidate.sourceKind,
      sourceRef: candidate.sourceRef,
      sourceHash: candidate.sourceHash,
    });
    const ownershipGroup = ownerScope.get(ownershipKey) ?? [];
    ownershipGroup.push(candidate);
    ownerScope.set(ownershipKey, ownershipGroup);
  }
  for (const [key, group] of sameSource) {
    const conflict = conflictRecord("same-source-divergent-content", key, group);
    if (conflict) conflicts.push(conflict);
  }
  for (const [key, group] of ownerScope) {
    const owners = new Set(group.map((candidate) =>
      canonicalJson({
        scopeId: candidate.scopeId,
        owner: candidate.envelope.owner,
      })));
    if (owners.size > 1) {
      const conflict = conflictRecord("owner-scope-conflict", key, group);
      if (conflict) conflicts.push(conflict);
    }
  }
  conflicts.sort((left, right) =>
    compareText(`${left.type}\0${left.keyHash}`, `${right.type}\0${right.keyHash}`));

  const material = {
    schema: KNOWLEDGE_IMPORT_BATCH_SCHEMA,
    rootScopeId: roots[0],
    status: "candidate",
    providerFree: true,
    readOnly: true,
    changed: false,
    inputCount: candidates.length,
    candidateCount: unique.length,
    duplicateCount: candidates.length - unique.length,
    conflictCount: conflicts.length,
    candidates: unique,
    duplicates,
    conflicts,
  };
  const contentHash = sha256(material);
  const batch = {
    ...material,
    id: `kib_${contentHash.slice(0, 32)}`,
    contentHash,
  };
  return deepFreeze(assertKnowledgeImportBatch(batch));
}
