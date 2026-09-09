import { createHash } from "node:crypto";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";
import {
  REFERENCE_PROVENANCE_CANDIDATES,
  REFERENCE_RIGHT_KEYS,
  validateReferenceInventory,
} from "./knowledge-reference-inventory.mjs";

export const REFERENCE_COHORT_MANIFEST_SCHEMA =
  "mkt-videos/reference-cohort-manifest@1";
export const COHORT_RIGHTS_ATTESTATION_SCHEMA =
  "mkt-videos/cohort-rights-attestation@1";

const DECISION_STATES = new Set(["allowed", "denied", "unknown"]);
const SENSITIVE_DISABLED_RIGHTS = Object.freeze([
  "embedding",
  "training",
  "providerInput",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Documento de direitos contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error("Documento de direitos deve conter somente valores JSON.");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function requiredText(value, label, maxLength = 2000) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} é obrigatório.`);
  }
  return normalized;
}

function requiredIdentifier(value, label) {
  const normalized = requiredText(value, label, 200);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} é inválido.`);
  }
  return normalized;
}

function requiredHash(value, label) {
  const normalized = String(value ?? "").trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} deve ser SHA-256.`);
  }
  return normalized;
}

function normalizedIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} deve ser uma data válida.`);
  }
  return date.toISOString();
}

function uniqueIds(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new Error(`${label} deve ser uma lista${allowEmpty ? "" : " não vazia"}.`);
  }
  const normalized = values.map((value, index) =>
    requiredIdentifier(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contém IDs duplicados.`);
  }
  return normalized.sort(compareText);
}

function manifestBody(value) {
  const {
    id: _id,
    contentHash: _contentHash,
    ...body
  } = value;
  return body;
}

function attestationBody(value) {
  const {
    id: _id,
    contentHash: _contentHash,
    ...body
  } = value;
  return body;
}

function entryIdentity({
  rootScopeId,
  scopeId,
  owner,
  rootAlias,
  asset,
}) {
  return {
    rootScopeId,
    scopeId,
    owner,
    rootAlias,
    assetId: asset.id,
    revision: asset.revision,
    assetContentHash: asset.contentHash,
    logicalPath: asset.logicalPath,
    fileSha256: asset.fileSha256,
    bytes: asset.bytes,
    mediaType: asset.mediaType,
  };
}

function expectedEntryId(manifest, entry) {
  return `kce_${sha256Json({
    rootScopeId: manifest.rootScopeId,
    scopeId: manifest.scopeId,
    owner: manifest.owner,
    rootAlias: manifest.rootAlias,
    assetId: entry.assetId,
    revision: entry.revision,
    assetContentHash: entry.assetContentHash,
    logicalPath: entry.logicalPath,
    fileSha256: entry.fileSha256,
    bytes: entry.bytes,
    mediaType: entry.mediaType,
  }).slice(0, 32)}`;
}

function assertCanonicalEntrySet(entries) {
  const ordered = [...entries].sort((left, right) =>
    compareText(left.id, right.id));
  if (ordered.some((entry, index) => entry.id !== entries[index].id)) {
    throw new Error("entries deve permanecer em ordem canônica.");
  }
  const ids = new Set();
  const assetIds = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id) || assetIds.has(entry.assetId)) {
      throw new Error("Manifest contém entrada ou asset duplicado.");
    }
    ids.add(entry.id);
    assetIds.add(entry.assetId);
  }
}

export function validateReferenceCohortManifest(manifest) {
  assertKnowledgeContract(manifest, {
    schemaId: REFERENCE_COHORT_MANIFEST_SCHEMA,
    label: "Reference cohort manifest",
  });
  if (manifest.entryCount !== manifest.entries.length) {
    throw new Error("entryCount diverge de entries[].");
  }
  assertCanonicalEntrySet(manifest.entries);
  for (const entry of manifest.entries) {
    if (entry.id !== expectedEntryId(manifest, entry)) {
      throw new Error("Entry ID diverge do asset exato.");
    }
  }
  const expectedContentHash = sha256Json(manifestBody(manifest));
  if (manifest.contentHash !== expectedContentHash) {
    throw new Error("contentHash do manifest diverge do conteúdo canônico.");
  }
  if (manifest.id !== `kcm_${expectedContentHash.slice(0, 32)}`) {
    throw new Error("Manifest ID diverge do contentHash.");
  }
  return manifest;
}

export function createReferenceCohortManifest({
  inventory,
  assetIds,
  claimedProvenance = "unresolved",
  generatedAt = new Date(),
  generatedBy,
} = {}) {
  validateReferenceInventory(inventory);
  if (!REFERENCE_PROVENANCE_CANDIDATES.includes(claimedProvenance)) {
    throw new Error("claimedProvenance é inválida.");
  }
  const selectedIds = uniqueIds(assetIds, "assetIds");
  const assetById = new Map(
    inventory.assets.map((asset) => [asset.id, asset]),
  );
  const entries = selectedIds.map((assetId) => {
    const asset = assetById.get(assetId);
    if (!asset) {
      throw new Error("assetIds contém asset fora do inventário exato.");
    }
    const identity = entryIdentity({
      rootScopeId: inventory.rootScopeId,
      scopeId: inventory.scopeId,
      owner: inventory.owner,
      rootAlias: inventory.rootAlias,
      asset,
    });
    return {
      id: `kce_${sha256Json(identity).slice(0, 32)}`,
      assetId: asset.id,
      revision: asset.revision,
      assetContentHash: asset.contentHash,
      logicalPath: asset.logicalPath,
      fileSha256: asset.fileSha256,
      bytes: asset.bytes,
      mediaType: asset.mediaType,
    };
  }).sort((left, right) => compareText(left.id, right.id));
  const body = {
    schema: REFERENCE_COHORT_MANIFEST_SCHEMA,
    status: "candidate",
    providerFree: true,
    rootScopeId: inventory.rootScopeId,
    scopeId: inventory.scopeId,
    owner: structuredClone(inventory.owner),
    rootAlias: inventory.rootAlias,
    sourceInventoryFingerprint: inventory.fingerprint,
    claimedProvenance: {
      class: claimedProvenance,
      status: "unverified",
    },
    inventoryPolicy: {
      analysisPerformed: false,
      framesInspected: false,
      mediaProbed: false,
      providerCalls: 0,
    },
    entries,
    entryCount: entries.length,
    generatedAt: normalizedIso(generatedAt, "generatedAt"),
    generatedBy: requiredText(generatedBy, "generatedBy", 200),
  };
  const contentHash = sha256Json(body);
  return validateReferenceCohortManifest({
    ...body,
    id: `kcm_${contentHash.slice(0, 32)}`,
    contentHash,
  });
}

function normalizePermissions(permissions) {
  if (!permissions || typeof permissions !== "object"
      || Array.isArray(permissions)) {
    throw new Error("permissions deve ser um objeto.");
  }
  const keys = Object.keys(permissions);
  if (
    keys.length !== REFERENCE_RIGHT_KEYS.length
    || REFERENCE_RIGHT_KEYS.some((key) => !Object.hasOwn(permissions, key))
  ) {
    throw new Error("permissions deve declarar exatamente os oito direitos.");
  }
  const normalized = {};
  for (const key of REFERENCE_RIGHT_KEYS) {
    const state = String(permissions[key] ?? "");
    if (!DECISION_STATES.has(state)) {
      throw new Error(`permissions.${key} é inválido.`);
    }
    if (SENSITIVE_DISABLED_RIGHTS.includes(key) && state !== "denied") {
      throw new Error(
        `permissions.${key} deve permanecer denied nesta versão.`,
      );
    }
    normalized[key] = state;
  }
  return normalized;
}

function assertManifestPartition(manifest, included, excluded) {
  const manifestIds = manifest.entries.map(({ id }) => id).sort(compareText);
  const overlap = included.filter((id) => excluded.includes(id));
  if (overlap.length) {
    throw new Error("includedEntryIds e excludedEntryIds se sobrepõem.");
  }
  const partition = [...included, ...excluded].sort(compareText);
  if (
    partition.length !== manifestIds.length
    || partition.some((id, index) => id !== manifestIds[index])
  ) {
    throw new Error(
      "Inclusões e exclusões devem particionar exatamente o manifest.",
    );
  }
}

export function validateCohortRightsAttestation(attestation, {
  manifest = null,
} = {}) {
  assertKnowledgeContract(attestation, {
    schemaId: COHORT_RIGHTS_ATTESTATION_SCHEMA,
    label: "Cohort rights attestation",
  });
  const included = uniqueIds(
    attestation.includedEntryIds,
    "includedEntryIds",
  );
  const excluded = uniqueIds(
    attestation.excludedEntryIds,
    "excludedEntryIds",
    { allowEmpty: true },
  );
  normalizePermissions(attestation.permissions);
  if (
    attestation.expiresAt != null
    && Date.parse(attestation.expiresAt) <= Date.parse(attestation.validFrom)
  ) {
    throw new Error("expiresAt deve ser posterior a validFrom.");
  }
  if (manifest != null) {
    validateReferenceCohortManifest(manifest);
    if (
      attestation.manifest.id !== manifest.id
      || attestation.manifest.contentHash !== manifest.contentHash
      || attestation.manifest.rootScopeId !== manifest.rootScopeId
      || attestation.manifest.scopeId !== manifest.scopeId
      || attestation.manifest.entryCount !== manifest.entryCount
      || canonicalJson(attestation.owner) !== canonicalJson(manifest.owner)
    ) {
      throw new Error("Atestação diverge do manifest exato.");
    }
    assertManifestPartition(manifest, included, excluded);
  }
  const expectedContentHash = sha256Json(attestationBody(attestation));
  if (attestation.contentHash !== expectedContentHash) {
    throw new Error("contentHash da atestação diverge do conteúdo canônico.");
  }
  if (attestation.id !== `kca_${expectedContentHash.slice(0, 32)}`) {
    throw new Error("Attestation ID diverge do contentHash.");
  }
  return attestation;
}

export function createCohortRightsAttestation({
  manifest,
  includedEntryIds,
  excludedEntryIds = [],
  permissions,
  basis,
  validFrom,
  expiresAt = null,
  policyId,
  policyHash,
  approvedAt = new Date(),
  approvedBy,
  confirmHuman = false,
  expectedManifestHash,
} = {}) {
  validateReferenceCohortManifest(manifest);
  if (confirmHuman !== true) {
    throw new Error("Atestação exige confirmação humana explícita.");
  }
  if (
    requiredHash(expectedManifestHash, "expectedManifestHash")
    !== manifest.contentHash
  ) {
    throw new Error("expectedManifestHash diverge do manifest apresentado.");
  }
  const included = uniqueIds(includedEntryIds, "includedEntryIds");
  const excluded = uniqueIds(
    excludedEntryIds,
    "excludedEntryIds",
    { allowEmpty: true },
  );
  assertManifestPartition(manifest, included, excluded);
  const normalizedPermissions = normalizePermissions(permissions);
  const normalizedValidFrom = normalizedIso(validFrom, "validFrom");
  const normalizedExpiresAt = expiresAt == null
    ? null
    : normalizedIso(expiresAt, "expiresAt");
  if (
    normalizedExpiresAt != null
    && Date.parse(normalizedExpiresAt) <= Date.parse(normalizedValidFrom)
  ) {
    throw new Error("expiresAt deve ser posterior a validFrom.");
  }
  const body = {
    schema: COHORT_RIGHTS_ATTESTATION_SCHEMA,
    status: "attested",
    providerFree: true,
    manifest: {
      id: manifest.id,
      contentHash: manifest.contentHash,
      rootScopeId: manifest.rootScopeId,
      scopeId: manifest.scopeId,
      entryCount: manifest.entryCount,
    },
    owner: structuredClone(manifest.owner),
    includedEntryIds: included,
    excludedEntryIds: excluded,
    permissions: normalizedPermissions,
    basis: requiredText(basis, "basis"),
    validFrom: normalizedValidFrom,
    expiresAt: normalizedExpiresAt,
    policyId: requiredIdentifier(policyId, "policyId"),
    policyHash: requiredHash(policyHash, "policyHash"),
    approvedAt: normalizedIso(approvedAt, "approvedAt"),
    approvedBy: requiredText(approvedBy, "approvedBy", 200),
    humanConfirmed: true,
  };
  const contentHash = sha256Json(body);
  return validateCohortRightsAttestation({
    ...body,
    id: `kca_${contentHash.slice(0, 32)}`,
    contentHash,
  }, { manifest });
}

export function assertCohortApplicationSet({
  manifest,
  attestation,
  entryIds,
} = {}) {
  validateCohortRightsAttestation(attestation, { manifest });
  const requested = uniqueIds(entryIds, "entryIds");
  if (
    requested.length !== attestation.includedEntryIds.length
    || requested.some((id, index) =>
      id !== attestation.includedEntryIds[index])
  ) {
    throw new Error(
      "Aplicação exige igualdade exata com includedEntryIds.",
    );
  }
  return attestation.includedEntryIds.map((entryId) => {
    const entry = manifest.entries.find(({ id }) => id === entryId);
    return {
      entry: structuredClone(entry),
      permissions: structuredClone(attestation.permissions),
      manifestHash: manifest.contentHash,
      attestationHash: attestation.contentHash,
    };
  });
}
