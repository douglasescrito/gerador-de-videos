import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const REFERENCE_INVENTORY_SCHEMA =
  "mkt-videos/reference-inventory@1";
export const MAX_REFERENCE_INVENTORY_ASSETS = 4096;
export const MAX_REFERENCE_INVENTORY_BYTES = 512 * 1024 * 1024 * 1024;

export const REFERENCE_RIGHT_KEYS = Object.freeze([
  "inventory",
  "localAnalysis",
  "textualIndexing",
  "embedding",
  "training",
  "providerInput",
  "publication",
  "reuse",
]);

export const REFERENCE_PROVENANCE_CANDIDATES = Object.freeze([
  "pipeline-output",
  "official-person-asset",
  "client-supplied",
  "licensed-stock",
  "third-party-reference",
  "unresolved",
]);

const MEDIA_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
});
const HASH_BUFFER_BYTES = 1024 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const ROOT_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

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
      throw new Error("Inventário contém número não finito.");
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
  throw new Error("Inventário deve conter somente valores JSON.");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function requiredIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} é inválido.`);
  }
  return normalized;
}

function requiredRootAlias(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!ROOT_ALIAS_PATTERN.test(normalized)) {
    throw new Error("rootAlias é inválido.");
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

function normalizedLogicalPath(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 1024
    || value !== value.normalize("NFC")
    || value.includes("\\")
    || value.includes(":")
    || FORBIDDEN_TEXT.test(value)
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value
  ) {
    throw new Error("Referência exige caminho lógico relativo e seguro.");
  }
  const segments = value.split("/");
  if (
    segments.some((segment) =>
      segment === ""
      || segment === "."
      || segment === ".."
      || segment.endsWith(".")
      || segment.endsWith(" "))
  ) {
    throw new Error("Referência exige caminho lógico relativo e seguro.");
  }
  return value;
}

function unknownRights() {
  return Object.freeze(Object.fromEntries(
    REFERENCE_RIGHT_KEYS.map((key) => [key, "unknown"]),
  ));
}

function comparisonPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(parent, candidate) {
  const relative = path.relative(
    comparisonPath(parent),
    comparisonPath(candidate),
  );
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Falha read-only ao inspecionar a biblioteca.");
  }
}

async function assertNoLinkedAncestor(target) {
  let cursor = path.resolve(target);
  while (true) {
    const metadata = await lstatOrNull(cursor);
    if (metadata?.isSymbolicLink()) {
      throw new Error("A raiz de referências não pode usar symlink ou junction.");
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function sameIdentity(left, right) {
  if (Number(left.ino) !== 0 || Number(right.ino) !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return (
    left.birthtimeMs === right.birthtimeMs
    && left.ctimeMs === right.ctimeMs
  );
}

function sameSnapshot(left, right) {
  return (
    sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  );
}

async function hashRegularFile(root, logicalPath) {
  const candidate = path.resolve(root, ...logicalPath.split("/"));
  if (!isWithin(root, candidate)) {
    throw new Error("Referência escapou da raiz governada.");
  }
  const before = await lstatOrNull(candidate);
  if (
    before == null
    || before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1
  ) {
    throw new Error("Referência deve ser arquivo regular sem links.");
  }
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number"
    ? fsConstants.O_NOFOLLOW
    : 0;
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("Referência não pode usar symlink ou junction.");
    }
    throw new Error("Referência não pôde ser aberta com segurança.");
  }
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || !sameSnapshot(before, opened)
    ) {
      throw new Error("Referência mudou durante a abertura read-only.");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;
    while (position < opened.size) {
      const length = Math.min(buffer.length, opened.size - position);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        position,
      );
      if (bytesRead === 0) {
        throw new Error("Referência terminou durante a leitura read-only.");
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const openedAfter = await handle.stat();
    const after = await lstatOrNull(candidate);
    if (
      after == null
      || after.isSymbolicLink()
      || after.nlink !== 1
      || !sameSnapshot(opened, openedAfter)
      || !sameSnapshot(opened, after)
    ) {
      throw new Error("Referência mudou durante a leitura read-only.");
    }
    return {
      fileSha256: digest.digest("hex"),
      bytes: opened.size,
    };
  } finally {
    await handle.close();
  }
}

export async function inspectReferenceAssetSnapshot({
  root,
  logicalPath,
} = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("root deve ser um caminho absoluto.");
  }
  const normalizedPath = normalizedLogicalPath(logicalPath);
  await assertNoLinkedAncestor(root);
  const rootMetadata = await lstatOrNull(root);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("root deve ser um diretório regular.");
  }
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    throw new Error("root não pôde ser resolvido com segurança.");
  }
  const snapshot = await hashRegularFile(canonicalRoot, normalizedPath);
  return Object.freeze({
    logicalPath: normalizedPath,
    fileSha256: snapshot.fileSha256,
    bytes: snapshot.bytes,
  });
}

function normalizeExtensions(extensions) {
  const values = extensions == null ? [".mp4"] : extensions;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("extensions exige uma lista não vazia.");
  }
  const normalized = new Set();
  for (const raw of values) {
    const extension = String(raw ?? "").trim().toLowerCase();
    const withDot = extension.startsWith(".") ? extension : `.${extension}`;
    if (!Object.hasOwn(MEDIA_TYPES, withDot)) {
      throw new Error("extensions contém tipo não suportado.");
    }
    normalized.add(withDot);
  }
  return normalized;
}

async function listCandidateFiles(root, extensions) {
  const files = [];
  async function visit(directory, prefix) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error("Biblioteca não pôde ser inventariada com segurança.");
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const logicalPath = normalizedLogicalPath(
        prefix ? `${prefix}/${entry.name}` : entry.name,
      );
      const absolute = path.join(directory, entry.name);
      const metadata = await lstatOrNull(absolute);
      if (metadata == null) {
        throw new Error("Filesystem mudou durante o inventário.");
      }
      if (metadata.isSymbolicLink()) {
        throw new Error("Biblioteca contém symlink ou junction.");
      }
      if (metadata.isDirectory()) {
        await visit(absolute, logicalPath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error("Biblioteca contém entrada não regular.");
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      if (metadata.nlink !== 1) {
        throw new Error("Biblioteca contém hardlink.");
      }
      files.push({
        logicalPath,
        mediaType: MEDIA_TYPES[extension],
        bytes: metadata.size,
      });
      if (files.length > MAX_REFERENCE_INVENTORY_ASSETS) {
        throw new Error("Biblioteca excede o limite de assets do inventário.");
      }
    }
  }
  await visit(root, "");
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes > MAX_REFERENCE_INVENTORY_BYTES) {
    throw new Error("Biblioteca excede o limite agregado do inventário.");
  }
  return files;
}

function assetLocationIdentity({
  rootScopeId,
  scopeId,
  rootAlias,
  logicalPath,
}) {
  return {
    rootScopeId,
    scopeId,
    rootAlias,
    logicalPath,
  };
}

function assetContentBody({
  id,
  rootScopeId,
  scopeId,
  owner,
  rootAlias,
  logicalPath,
  fileSha256,
  bytes,
  mediaType,
  provenanceCandidate,
  rights,
}) {
  return {
    id,
    revision: 1,
    rootScopeId,
    scopeId,
    owner,
    rootAlias,
    logicalPath,
    fileSha256,
    bytes,
    mediaType,
    provenanceCandidate,
    rights,
  };
}

function inventoryFingerprintBody(inventory) {
  return {
    schema: inventory.schema,
    status: inventory.status,
    providerFree: inventory.providerFree,
    readOnly: inventory.readOnly,
    rootScopeId: inventory.rootScopeId,
    scopeId: inventory.scopeId,
    owner: inventory.owner,
    rootAlias: inventory.rootAlias,
    assetCount: inventory.assetCount,
    rightsDefault: inventory.rightsDefault,
    analysis: inventory.analysis,
    assets: inventory.assets,
  };
}

export function canonicalReferenceInventoryHash(value) {
  return sha256Json(value);
}

export function validateReferenceInventory(inventory) {
  assertKnowledgeContract(inventory, {
    schemaId: REFERENCE_INVENTORY_SCHEMA,
    label: "Reference inventory",
  });
  if (inventory.assetCount !== inventory.assets.length) {
    throw new Error("assetCount diverge de assets[].");
  }
  const ordered = [...inventory.assets]
    .sort((left, right) => compareText(left.logicalPath, right.logicalPath));
  if (
    ordered.some((entry, index) =>
      entry.logicalPath !== inventory.assets[index].logicalPath)
  ) {
    throw new Error("assets deve permanecer em ordem canônica.");
  }
  const ids = new Set();
  const locations = new Set();
  for (const asset of inventory.assets) {
    const logicalPath = normalizedLogicalPath(asset.logicalPath);
    const expectedId = `kra_${sha256Json(assetLocationIdentity({
      rootScopeId: inventory.rootScopeId,
      scopeId: inventory.scopeId,
      rootAlias: inventory.rootAlias,
      logicalPath,
    })).slice(0, 32)}`;
    if (asset.id !== expectedId) {
      throw new Error("Asset ID diverge da localização governada.");
    }
    if (ids.has(asset.id) || locations.has(logicalPath)) {
      throw new Error("Inventário contém asset duplicado.");
    }
    ids.add(asset.id);
    locations.add(logicalPath);
    if (
      REFERENCE_RIGHT_KEYS.some((right) =>
        asset.rights[right] !== "unknown")
    ) {
      throw new Error("Proveniência não pode conceder direitos no inventário.");
    }
    const expectedContentHash = sha256Json(assetContentBody({
      ...asset,
      rootScopeId: inventory.rootScopeId,
      scopeId: inventory.scopeId,
      owner: inventory.owner,
      rootAlias: inventory.rootAlias,
    }));
    if (asset.contentHash !== expectedContentHash) {
      throw new Error("contentHash do asset diverge do conteúdo canônico.");
    }
  }
  if (
    inventory.fingerprint
    !== sha256Json(inventoryFingerprintBody(inventory))
  ) {
    throw new Error("fingerprint do inventário diverge do conteúdo canônico.");
  }
  return inventory;
}

export async function buildReferenceInventory({
  root,
  rootScopeId,
  scopeId,
  owner,
  rootAlias,
  extensions = null,
  provenanceCandidate = "unresolved",
  now = new Date(),
} = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("root deve ser um caminho absoluto.");
  }
  const normalizedRootScopeId = requiredIdentifier(
    rootScopeId,
    "rootScopeId",
  );
  const normalizedScopeId = requiredIdentifier(scopeId, "scopeId");
  const normalizedOwner = {
    type: String(owner?.type ?? "").trim(),
    id: requiredIdentifier(owner?.id, "owner.id"),
  };
  const normalizedRootAlias = requiredRootAlias(rootAlias);
  if (!REFERENCE_PROVENANCE_CANDIDATES.includes(provenanceCandidate)) {
    throw new Error("provenanceCandidate é inválido.");
  }
  await assertNoLinkedAncestor(root);
  const rootMetadata = await lstatOrNull(root);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("root deve ser um diretório regular.");
  }
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    throw new Error("root não pôde ser resolvido com segurança.");
  }
  const candidates = await listCandidateFiles(
    canonicalRoot,
    normalizeExtensions(extensions),
  );
  const rights = unknownRights();
  const assets = [];
  for (const candidate of candidates) {
    const snapshot = await hashRegularFile(
      canonicalRoot,
      candidate.logicalPath,
    );
    if (snapshot.bytes !== candidate.bytes) {
      throw new Error("Referência mudou depois do preflight.");
    }
    const id = `kra_${sha256Json(assetLocationIdentity({
      rootScopeId: normalizedRootScopeId,
      scopeId: normalizedScopeId,
      rootAlias: normalizedRootAlias,
      logicalPath: candidate.logicalPath,
    })).slice(0, 32)}`;
    const assetBody = assetContentBody({
      id,
      rootScopeId: normalizedRootScopeId,
      scopeId: normalizedScopeId,
      owner: normalizedOwner,
      rootAlias: normalizedRootAlias,
      logicalPath: candidate.logicalPath,
      fileSha256: snapshot.fileSha256,
      bytes: snapshot.bytes,
      mediaType: candidate.mediaType,
      provenanceCandidate,
      rights,
    });
    assets.push({
      id,
      revision: 1,
      logicalPath: candidate.logicalPath,
      fileSha256: snapshot.fileSha256,
      bytes: snapshot.bytes,
      mediaType: candidate.mediaType,
      provenanceCandidate,
      rights: { ...rights },
      contentHash: sha256Json(assetBody),
    });
  }
  assets.sort((left, right) =>
    compareText(left.logicalPath, right.logicalPath));
  const body = {
    schema: REFERENCE_INVENTORY_SCHEMA,
    status: "candidate",
    providerFree: true,
    readOnly: true,
    rootScopeId: normalizedRootScopeId,
    scopeId: normalizedScopeId,
    owner: normalizedOwner,
    rootAlias: normalizedRootAlias,
    generatedAt: normalizedIso(now, "now"),
    assetCount: assets.length,
    rightsDefault: "unknown",
    analysis: {
      contentInspected: false,
      probe: false,
      decode: false,
      frames: false,
      audio: false,
      ocr: false,
      providerCalls: 0,
    },
    assets,
  };
  const inventory = {
    ...body,
    fingerprint: sha256Json(inventoryFingerprintBody(body)),
  };
  return validateReferenceInventory(inventory);
}
