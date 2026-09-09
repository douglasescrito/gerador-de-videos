import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWLEDGE_STORE_SCHEMA,
  checkKnowledgeStoreIntegrity,
  createKnowledgeStoreRepository,
  resolveKnowledgeStorePath,
} from "./knowledge-store.mjs";
import {
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  projectKnowledgeAssetLink,
  verifyKnowledgeAssetIntegrityFromRepository,
} from "./knowledge-asset-integrity.mjs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import {
  assertPathAvailable,
  commitTemporaryFile,
} from "./pipeline-operation.mjs";

export const KNOWLEDGE_BACKUP_MANIFEST_V1_SCHEMA =
  "mkt-videos/knowledge-backup-manifest@1";
export const KNOWLEDGE_BACKUP_MANIFEST_SCHEMA =
  "mkt-videos/knowledge-backup-manifest@2";
export const KNOWLEDGE_BACKUP_BUNDLE_SCHEMA =
  "mkt-videos/knowledge-backup-bundle@1";
export const KNOWLEDGE_RESTORE_REPORT_SCHEMA =
  "mkt-videos/knowledge-restore-report@2";
export const KNOWLEDGE_RESTORE_REPORT_V1_SCHEMA =
  "mkt-videos/knowledge-restore-report@1";

const DEFAULT_CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const BACKUP_EXTENSION = ".mkvbackup";
const BUNDLE_MAGIC = Buffer.from("MKVKB001", "ascii");
const BUNDLE_HEADER_BYTES = BUNDLE_MAGIC.length + 4;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const COPY_BUFFER_BYTES = 1024 * 1024;
const CLASSIFICATIONS = new Set([
  "internal",
  "confidential",
  "restricted",
]);
const CLASSIFICATION_RANK = Object.freeze({
  internal: 1,
  confidential: 2,
  restricted: 3,
});
const SUPPORTED_BACKUP_MANIFEST_SCHEMAS = new Set([
  KNOWLEDGE_BACKUP_MANIFEST_V1_SCHEMA,
  KNOWLEDGE_BACKUP_MANIFEST_SCHEMA,
]);
const ASSET_OBSERVATION_REASONS = Object.freeze({
  resolved: new Set(["hash-match"]),
  missing: new Set([
    "asset-not-found",
    "hash-mismatch",
    "size-mismatch",
  ]),
  revoked: new Set([
    "rights-denied",
    "rights-unknown",
    "rights-revoked",
    "rights-expired",
  ]),
  quarantined: new Set(["asset-quarantined"]),
});

function normalizeForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(
    normalizeForComparison(parent),
    normalizeForComparison(candidate),
  );
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function canonicalize(value, location = "$") {
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
      canonicalize(entry, `${location}[${index}]`));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${location} deve conter somente valores JSON.`);
    }
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        canonicalize(value[key], `${location}.${key}`),
      ]),
    );
  }
  throw new Error(`${location} deve conter somente valores JSON.`);
}

function canonicalJson(value, { pretty = false } = {}) {
  const serialized = JSON.stringify(
    canonicalize(value),
    null,
    pretty ? 2 : 0,
  );
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_MANIFEST_BYTES) {
    throw new Error(
      `Manifest excede o limite de ${MAX_MANIFEST_BYTES} bytes.`,
    );
  }
  return pretty ? `${serialized}\n` : serialized;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(value, label, maximum = 1000) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} deve ter entre 1 e ${maximum} caracteres.`);
  }
  return normalized;
}

function normalizedTime(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} é inválido.`);
  }
  return date.toISOString();
}

function operationTime(clock, label) {
  if (typeof clock !== "function") {
    throw new Error(`${label} deve ser uma função.`);
  }
  return normalizedTime(clock(), label);
}

function classificationRecord(level) {
  const normalized = requiredText(level, "classification", 80);
  if (!CLASSIFICATIONS.has(normalized)) {
    throw new Error(
      `Classificação inválida: ${normalized}.`,
    );
  }
  return {
    level: normalized,
    containsPrivateData: true,
    secretMaterial: "prohibited",
  };
}

function assertClassificationCoversStore(classification, floor) {
  const requested = classificationRecord(classification).level;
  const required = requiredText(floor, "classificationFloor", 80);
  if (
    !(required in CLASSIFICATION_RANK)
    || CLASSIFICATION_RANK[requested] < CLASSIFICATION_RANK[required]
  ) {
    throw new Error(
      `Classificação do backup não pode ser inferior ao store: ${required}.`,
    );
  }
  return requested;
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSymbolicLinks(target, label) {
  let cursor = path.resolve(target);
  while (true) {
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) {
        throw new Error(`${label} não pode usar link simbólico ou junction.`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function realPathThroughExistingAncestor(target) {
  const missing = [];
  let cursor = path.resolve(target);
  while (true) {
    try {
      const resolved = await realpath(cursor);
      return path.resolve(resolved, ...missing);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(cursor, ...missing);
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function findWorkspaceRoot(coreRoot) {
  const resolvedCore = await realPathThroughExistingAncestor(coreRoot);
  let cursor = resolvedCore;
  while (true) {
    if (await pathExists(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(resolvedCore, "..");
    cursor = parent;
  }
}

async function resolvePrivateBackupPath(
  value,
  {
    coreRoot = DEFAULT_CORE_ROOT,
    mustExist = false,
    label = "Backup",
  } = {},
) {
  const requested = path.resolve(requiredText(value, label));
  if (path.extname(requested).toLowerCase() !== BACKUP_EXTENSION) {
    throw new Error(`${label} exige extensão ${BACKUP_EXTENSION}.`);
  }
  await assertNoSymbolicLinks(requested, label);
  const resolved = await realPathThroughExistingAncestor(requested);
  const workspace = await findWorkspaceRoot(coreRoot);
  if (isPathWithin(workspace, resolved)) {
    throw new Error(`${label} privado não pode ficar dentro do workspace.`);
  }
  const exists = await pathExists(resolved);
  if (mustExist && !exists) throw new Error(`${label} não existe.`);
  if (exists) {
    const metadata = await lstat(resolved);
    if (!metadata.isFile()) throw new Error(`${label} deve ser um arquivo.`);
    if (metadata.nlink > 1) throw new Error(`${label} não pode ser hardlink.`);
  }
  return resolved;
}

function sameFileIdentity(left, right) {
  const leftIdentity = `${left.dev}:${left.ino}`;
  const rightIdentity = `${right.dev}:${right.ino}`;
  if (left.ino !== 0 || right.ino !== 0) {
    return leftIdentity === rightIdentity;
  }
  return left.size === right.size
    && left.birthtimeMs === right.birthtimeMs;
}

async function inspectAndHashFile(file, label) {
  const absolute = path.resolve(file);
  await assertNoSymbolicLinks(absolute, label);
  const pathBefore = await lstat(absolute);
  if (!pathBefore.isFile()) throw new Error(`${label} deve ser um arquivo.`);
  if (pathBefore.nlink > 1) throw new Error(`${label} não pode ser hardlink.`);
  const handle = await open(absolute, "r");
  try {
    const opened = await handle.stat();
    if (!sameFileIdentity(pathBefore, opened)) {
      throw new Error(`${label} mudou durante a abertura.`);
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    while (position < opened.size) {
      const length = Math.min(buffer.length, opened.size - position);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        position,
      );
      if (bytesRead === 0) throw new Error(`${label} terminou prematuramente.`);
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const openedAfter = await handle.stat();
    const pathAfter = await lstat(absolute);
    if (
      !sameFileIdentity(opened, openedAfter)
      || !sameFileIdentity(opened, pathAfter)
      || openedAfter.size !== opened.size
      || openedAfter.mtimeMs !== opened.mtimeMs
      || pathAfter.nlink > 1
    ) {
      throw new Error(`${label} mudou durante a leitura.`);
    }
    return {
      bytes: opened.size,
      sha256: digest.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

function assertSnapshotAdapter(adapter) {
  if (
    !adapter
    || typeof adapter.createConsistentSnapshot !== "function"
    || typeof adapter.inspectSnapshot !== "function"
  ) {
    throw new Error(
      "Backup/restore exige snapshotAdapter com "
      + "createConsistentSnapshot e inspectSnapshot.",
    );
  }
  return adapter;
}

function assertScopedOperationGrant(
  grant,
  permission,
  { requireRead = false } = {},
) {
  if (
    !grant
    || !Array.isArray(grant.permissions)
    || !grant.permissions.includes("integrity")
    || !grant.permissions.includes(permission)
    || (requireRead && !grant.permissions.includes("read"))
  ) {
    const required = requireRead
      ? `read, integrity e ${permission}`
      : `integrity e ${permission}`;
    throw new Error(
      `A operação exige ScopeGrant com permissões ${required}.`,
    );
  }
  return grant;
}

function normalizedSnapshotMetadata(value) {
  const applicationId = Number(value?.applicationId);
  const userVersion = Number(value?.userVersion);
  if (
    !Number.isInteger(applicationId)
    || applicationId < 1
    || !Number.isInteger(userVersion)
    || userVersion < 1
  ) {
    throw new Error(
      "snapshotAdapter retornou applicationId/userVersion inválidos.",
    );
  }
  return { applicationId, userVersion };
}

function globalIntegrityProof(report) {
  return {
    schema: report.schema,
    storeSchema: report.storeSchema,
    initialized: report.initialized,
    ok: report.ok,
    userVersion: report.userVersion,
    sqlite: report.sqlite,
    foreignKeys: report.foreignKeys,
    migrations: report.migrations,
    appendOnlyTriggers: report.appendOnlyTriggers,
    ledgerSummary: report.ledgerSummary,
    grantEvidence: report.grantEvidence,
    classificationFloor: report.classificationFloor,
    issues: report.issues,
  };
}

function scopedIntegrityProof(report) {
  return {
    schema: report.schema,
    storeSchema: report.storeSchema,
    ok: report.ok,
    sqlite: report.sqlite,
    ledgerHead: report.ledgerHead,
    migrations: report.migrations,
    issues: report.issues,
  };
}

function normalizeRelativeAssetPath(value) {
  const raw = requiredText(value, "asset path", 2000).replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(raw)
    || path.win32.isAbsolute(raw)
    || /^[A-Za-z]:/.test(raw)
  ) {
    throw new Error(`Asset exige caminho relativo seguro: ${raw}.`);
  }
  const segments = raw.split("/");
  if (
    segments.some((segment) =>
      segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Asset contém traversal ou segmento vazio: ${raw}.`);
  }
  return segments.join("/");
}

async function resolveAssetRoot(rootDirectory) {
  const requested = path.resolve(requiredText(
    rootDirectory,
    "assetInventory.rootDirectory",
  ));
  await assertNoSymbolicLinks(requested, "Raiz de assets");
  const resolved = await realpath(requested);
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory()) {
    throw new Error("assetInventory.rootDirectory deve ser um diretório.");
  }
  return resolved;
}

async function inspectAsset(root, relativePath) {
  const normalized = normalizeRelativeAssetPath(relativePath);
  const candidate = path.resolve(root, ...normalized.split("/"));
  if (!isPathWithin(root, candidate)) {
    throw new Error(`Asset escapou da raiz declarada: ${normalized}.`);
  }
  const metadata = await inspectAndHashFile(candidate, `Asset ${normalized}`);
  return {
    path: normalized,
    sha256: metadata.sha256,
    size: metadata.bytes,
  };
}

function sortAssetEntries(entries) {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function createAssetInventory(assetInventory) {
  if (assetInventory == null) {
    return {
      mode: "not-included",
      count: 0,
      aggregateSha256: null,
      entries: [],
    };
  }
  if (!Array.isArray(assetInventory.relativePaths)) {
    throw new Error("assetInventory.relativePaths deve ser um array.");
  }
  const normalizedPaths = assetInventory.relativePaths.map(
    normalizeRelativeAssetPath,
  );
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new Error("assetInventory contém caminhos duplicados.");
  }
  const root = await resolveAssetRoot(assetInventory.rootDirectory);
  const entries = sortAssetEntries(
    await Promise.all(normalizedPaths.map((entry) =>
      inspectAsset(root, entry))),
  );
  return {
    mode: "inventory-only",
    count: entries.length,
    aggregateSha256: sha256(canonicalJson(entries)),
    entries,
  };
}

function missingAssetReport(entries) {
  return {
    status: "asymmetric",
    missing: entries.map((entry) => entry.path),
    divergent: [],
    unsafe: [],
  };
}

async function compareAssetInventory(manifestAssets, assetRootDirectory) {
  if (manifestAssets.mode === "not-included") {
    return {
      status: "not-declared",
      missing: [],
      divergent: [],
      unsafe: [],
    };
  }
  if (assetRootDirectory == null) {
    return missingAssetReport(manifestAssets.entries);
  }
  let root;
  try {
    root = await resolveAssetRoot(assetRootDirectory);
  } catch {
    return {
      status: "asymmetric",
      missing: [],
      divergent: [],
      unsafe: manifestAssets.entries.map((entry) => ({
        path: entry.path,
        reason: "asset-root-unavailable",
      })),
    };
  }
  const missing = [];
  const divergent = [];
  const unsafe = [];
  for (const expected of manifestAssets.entries) {
    try {
      const actual = await inspectAsset(root, expected.path);
      if (
        actual.sha256 !== expected.sha256
        || actual.size !== expected.size
      ) {
        divergent.push({
          path: expected.path,
          expectedSha256: expected.sha256,
          actualSha256: actual.sha256,
          expectedSize: expected.size,
          actualSize: actual.size,
        });
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push(expected.path);
      } else {
        unsafe.push({
          path: expected.path,
          reason: String(error?.message ?? "").includes("link")
            || String(error?.message ?? "").includes("traversal")
            ? "unsafe-path"
            : "unreadable",
        });
      }
    }
  }
  return {
    status:
      missing.length === 0 && divergent.length === 0 && unsafe.length === 0
        ? "match"
        : "asymmetric",
    missing,
    divergent,
    unsafe,
  };
}

async function writeAll(handle, buffer, startPosition) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      startPosition + offset,
    );
    if (bytesWritten === 0) throw new Error("Falha ao gravar bundle de backup.");
    offset += bytesWritten;
  }
  return startPosition + buffer.length;
}

async function copyWholeFile(sourceFile, destinationHandle, startPosition) {
  const source = await open(sourceFile, "r");
  try {
    const metadata = await source.stat();
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let sourcePosition = 0;
    let destinationPosition = startPosition;
    while (sourcePosition < metadata.size) {
      const length = Math.min(
        buffer.length,
        metadata.size - sourcePosition,
      );
      const { bytesRead } = await source.read(
        buffer,
        0,
        length,
        sourcePosition,
      );
      if (bytesRead === 0) {
        throw new Error("Snapshot SQLite terminou prematuramente.");
      }
      destinationPosition = await writeAll(
        destinationHandle,
        buffer.subarray(0, bytesRead),
        destinationPosition,
      );
      sourcePosition += bytesRead;
    }
    return destinationPosition;
  } finally {
    await source.close();
  }
}

async function writeBundle(file, serializedManifest, snapshotFile) {
  const manifestBytes = Buffer.from(serializedManifest, "utf8");
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error("Manifest excede o limite do bundle.");
  }
  const header = Buffer.alloc(BUNDLE_HEADER_BYTES);
  BUNDLE_MAGIC.copy(header, 0);
  header.writeUInt32BE(manifestBytes.length, BUNDLE_MAGIC.length);
  const handle = await open(file, "wx", 0o600);
  try {
    let position = await writeAll(handle, header, 0);
    position = await writeAll(handle, manifestBytes, position);
    await copyWholeFile(snapshotFile, handle, position);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readExact(handle, length, position, label) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error(`${label} terminou prematuramente.`);
    offset += bytesRead;
  }
  return buffer;
}

function assertManifest(manifest) {
  if (!SUPPORTED_BACKUP_MANIFEST_SCHEMAS.has(manifest?.schema)) {
    throw new Error(
      `Schema de manifest de backup não suportado: ${manifest?.schema ?? "ausente"}.`,
    );
  }
  assertKnowledgeContract(manifest, {
    schemaId: manifest.schema,
    label: "Manifest de backup",
  });
  const body = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "manifestHash"),
  );
  if (manifest.manifestHash !== sha256(canonicalJson(body))) {
    throw new Error("Manifest de backup adulterado.");
  }
  if (
    manifest.assets.mode === "not-included"
    && (
      manifest.assets.count !== 0
      || manifest.assets.entries.length !== 0
      || manifest.assets.aggregateSha256 !== null
    )
  ) {
    throw new Error("Manifest possui inventário de assets inconsistente.");
  }
  if (
    manifest.assets.mode === "inventory-only"
    && (
      manifest.assets.count !== manifest.assets.entries.length
      || manifest.assets.aggregateSha256
        !== sha256(canonicalJson(manifest.assets.entries))
    )
  ) {
    throw new Error("Checksum do inventário de assets diverge.");
  }
  if (manifest.schema === KNOWLEDGE_BACKUP_MANIFEST_SCHEMA) {
    for (const entry of manifest.assets.entries) {
      if (
        !ASSET_OBSERVATION_REASONS[
          entry.observedStatus
        ]?.has(entry.observedReason)
      ) {
        throw new Error(
          "Inventário governado contém observação de asset incoerente.",
        );
      }
    }
    if (
      manifest.assets.mode === "governed-inventory"
      && (
        manifest.assets.count !== manifest.assets.entries.length
        || manifest.assets.aggregateSha256
          !== sha256(canonicalJson(manifest.assets.entries))
        || manifest.assets.status
          !== (
            manifest.assets.entries.some((entry) =>
              entry.observedStatus !== "resolved")
              ? "asymmetric"
              : "match"
          )
      )
    ) {
      throw new Error("Inventário governado de assets é inconsistente.");
    }
    const activeValues = [
      manifest.scopeAttestation?.activeActivationId ?? null,
      manifest.scopeAttestation?.activeActivationHash ?? null,
      manifest.scopeAttestation?.activeReleaseId ?? null,
      manifest.scopeAttestation?.activeReleaseHash ?? null,
    ];
    const populated = activeValues.filter((value) => value != null).length;
    if (populated !== 0 && populated !== activeValues.length) {
      throw new Error(
        "Attestation da release ativa deve ser integralmente nula ou preenchida.",
      );
    }
  }
  return manifest;
}

async function readBundleDescriptor(backupFile, coreRoot) {
  const resolved = await resolvePrivateBackupPath(backupFile, {
    coreRoot,
    mustExist: true,
    label: "Backup",
  });
  const archive = await inspectAndHashFile(resolved, "Backup");
  const handle = await open(resolved, "r");
  try {
    if (archive.bytes < BUNDLE_HEADER_BYTES) {
      throw new Error("Bundle de backup é menor que o header.");
    }
    const header = await readExact(
      handle,
      BUNDLE_HEADER_BYTES,
      0,
      "Header do backup",
    );
    if (!header.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) {
      throw new Error("Magic do bundle de backup é inválido.");
    }
    const manifestLength = header.readUInt32BE(BUNDLE_MAGIC.length);
    if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) {
      throw new Error("Tamanho do manifest no bundle é inválido.");
    }
    const manifestBuffer = await readExact(
      handle,
      manifestLength,
      BUNDLE_HEADER_BYTES,
      "Manifest do backup",
    );
    let manifest;
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf8"));
    } catch {
      throw new Error("Manifest JSON do backup é inválido.");
    }
    assertManifest(manifest);
    const snapshotOffset = BUNDLE_HEADER_BYTES + manifestLength;
    const expectedBytes = snapshotOffset + manifest.store.snapshotBytes;
    if (expectedBytes !== archive.bytes) {
      throw new Error("Tamanho do snapshot diverge do bundle.");
    }
    return {
      backupFile: resolved,
      archive,
      manifest,
      snapshotOffset,
    };
  } finally {
    await handle.close();
  }
}

async function extractSnapshot(
  archiveFile,
  destinationFile,
  snapshotOffset,
  snapshotBytes,
) {
  const source = await open(archiveFile, "r");
  const destination = await open(destinationFile, "wx", 0o600);
  const digest = createHash("sha256");
  try {
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let copied = 0;
    while (copied < snapshotBytes) {
      const length = Math.min(buffer.length, snapshotBytes - copied);
      const { bytesRead } = await source.read(
        buffer,
        0,
        length,
        snapshotOffset + copied,
      );
      if (bytesRead === 0) {
        throw new Error("Snapshot no bundle terminou prematuramente.");
      }
      const chunk = buffer.subarray(0, bytesRead);
      await writeAll(destination, chunk, copied);
      digest.update(chunk);
      copied += bytesRead;
    }
    await destination.sync();
    return {
      bytes: copied,
      sha256: digest.digest("hex"),
    };
  } finally {
    await Promise.allSettled([source.close(), destination.close()]);
  }
}

function temporarySibling(target, marker, extension) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.${marker}${extension}`,
  );
}

async function cleanupSqliteTemporary(file) {
  await Promise.allSettled([
    rm(file, { force: true }),
    rm(`${file}-wal`, { force: true }),
    rm(`${file}-shm`, { force: true }),
  ]);
}

function governedAssetRoots(coreRoot) {
  return [
    {
      rootKind: "outputs",
      directory: path.join(coreRoot, "outputs"),
    },
    {
      rootKind: "PESSOAS",
      directory: path.join(coreRoot, "..", "PESSOAS"),
    },
  ];
}

function emptyAssetCounts() {
  return {
    total: 0,
    resolved: 0,
    missing: 0,
    revoked: 0,
    quarantined: 0,
    extra: 0,
  };
}

function governedEntryDatabaseProjection(entry) {
  return {
    linkId: entry.linkId,
    revision: entry.revision,
    itemContentHash: entry.itemContentHash,
    governanceHash: entry.governanceHash,
    itemStatus: entry.itemStatus,
    rootKind: entry.rootKind,
    relativePath: entry.relativePath,
    mediaType: entry.mediaType,
    expectedSha256: entry.expectedSha256,
    expectedBytes: entry.expectedBytes,
  };
}

async function governedAssetInventory({
  dbFile,
  rootScopeId,
  grant,
  coreRoot,
  at,
}) {
  if (rootScopeId == null) {
    return {
      manifest: {
        mode: "not-included",
        count: 0,
        aggregateSha256: null,
        entries: [],
      },
      report: {
        mode: "not-included",
        status: "not-declared",
        counts: emptyAssetCounts(),
        results: [],
      },
    };
  }
  const repository = createKnowledgeStoreRepository({
    dbFile,
    coreRoot,
    clock: () => new Date(at),
  });
  const items = repository.listKnowledgeAssetLinkItems({
    grant,
    rootScopeId,
  });
  const links = items.map((item) => projectKnowledgeAssetLink(item, {
    at,
  }));
  const integrity = await verifyKnowledgeAssetIntegrityFromRepository({
    repository,
    grant,
    rootScopeId,
    allowedRoots: governedAssetRoots(coreRoot),
    at,
    missingRootsAsEmpty: true,
  });
  const resultById = new Map(
    integrity.results.map((entry) => [entry.linkId, entry]),
  );
  const entries = items.map((item, index) => {
    const link = links[index];
    const observed = resultById.get(item.id);
    if (!observed) {
      throw new Error("Relatório de assets omitiu vínculo governado.");
    }
    return {
      linkId: item.id,
      revision: item.revision,
      itemContentHash: item.contentHash,
      governanceHash: item.governance.hash,
      itemStatus: item.status,
      rootKind: link.rootKind,
      relativePath: link.relativePath,
      mediaType: item.payload.mediaType,
      expectedSha256: link.expectedSha256,
      expectedBytes: link.expectedBytes,
      rightsStatus: link.rightsStatus,
      quarantineStatus: link.quarantineStatus,
      observedStatus: observed.status,
      observedReason: observed.reason,
    };
  }).sort((left, right) =>
    left.linkId < right.linkId ? -1 : left.linkId > right.linkId ? 1 : 0);
  const status = entries.some((entry) => entry.observedStatus !== "resolved")
    ? "asymmetric"
    : "match";
  return {
    manifest: {
      mode: "governed-inventory",
      sourceSchema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
      status,
      count: entries.length,
      aggregateSha256: sha256(canonicalJson(entries)),
      integrityReportHash: integrity.aggregateHash,
      entries,
    },
    report: {
      mode: "governed-inventory",
      status,
      counts: integrity.counts,
      results: integrity.results,
    },
  };
}

async function scopedAttestation({
  dbFile,
  rootScopeId,
  grant,
  coreRoot,
  at,
  includeActiveState = true,
}) {
  if (rootScopeId == null) return null;
  const normalizedRoot = requiredText(rootScopeId, "rootScopeId", 200);
  if (!grant) {
    throw new Error(
      "Backup com rootScopeId exige ScopeGrant com permissão integrity.",
    );
  }
  const repository = createKnowledgeStoreRepository({
    dbFile,
    coreRoot,
    clock: () => new Date(at),
  });
  const report = repository.checkIntegrity({
    grant,
    rootScopeId: normalizedRoot,
  });
  if (!report.ok) {
    throw new Error("Root scope falhou na verificação de integridade.");
  }
  const base = {
    rootScopeHash: sha256(normalizedRoot),
    ledgerHead: report.ledgerHead,
    integritySha256: sha256(canonicalJson(scopedIntegrityProof(report))),
  };
  if (!includeActiveState) return base;
  const active = repository.getActiveRelease({
    grant,
    rootScopeId: normalizedRoot,
  });
  return {
    ...base,
    activeActivationId: active?.activation.id ?? null,
    activeActivationHash: active?.activation.hash ?? null,
    activeReleaseId: active?.release.id ?? null,
    activeReleaseHash: active?.release.hash ?? null,
  };
}

function createManifest({
  createdAt,
  classification,
  globalReport,
  snapshotMetadata,
  snapshotFile,
  scopeAttestation,
  assets,
}) {
  const globalProof = globalIntegrityProof(globalReport);
  const body = {
    schema: KNOWLEDGE_BACKUP_MANIFEST_SCHEMA,
    bundleSchema: KNOWLEDGE_BACKUP_BUNDLE_SCHEMA,
    createdAt,
    classification: classificationRecord(classification),
    providerFree: true,
    store: {
      schema: KNOWLEDGE_STORE_SCHEMA,
      userVersion: globalReport.userVersion,
      applicationId: snapshotMetadata.applicationId,
      snapshotBytes: snapshotFile.bytes,
      snapshotSha256: snapshotFile.sha256,
      integritySha256: sha256(canonicalJson(globalProof)),
    },
    ledger: globalReport.ledgerSummary,
    scopeAttestation,
    assets,
  };
  return assertManifest({
    ...body,
    manifestHash: sha256(canonicalJson(body)),
  });
}

export async function readKnowledgeBackupManifest({
  backupFile,
  coreRoot = DEFAULT_CORE_ROOT,
} = {}) {
  const descriptor = await readBundleDescriptor(backupFile, coreRoot);
  return {
    manifest: descriptor.manifest,
    archiveBytes: descriptor.archive.bytes,
    archiveSha256: descriptor.archive.sha256,
  };
}

export async function createKnowledgeBackup({
  sourceDbFile,
  backupFile,
  classification,
  rootScopeId = null,
  grant = null,
  assetInventory = null,
  snapshotAdapter,
  coreRoot = DEFAULT_CORE_ROOT,
  clock = () => new Date(),
} = {}) {
  const adapter = assertSnapshotAdapter(snapshotAdapter);
  const createdAt = operationTime(clock, "clock");
  const source = resolveKnowledgeStorePath({
    dbFile: sourceDbFile,
    coreRoot,
  });
  const target = await resolvePrivateBackupPath(backupFile, {
    coreRoot,
    label: "Destino do backup",
  });
  await assertPathAvailable(target, "Destino do backup");
  classificationRecord(classification);
  if (assetInventory != null) {
    throw new Error(
      "assetInventory manual foi substituído pelo inventário governado do repository.",
    );
  }

  const sourceIntegrity = checkKnowledgeStoreIntegrity({
    dbFile: source,
    coreRoot,
  });
  if (!sourceIntegrity.ok || !sourceIntegrity.initialized) {
    throw new Error(
      "Knowledge Store de origem não está inicializado e íntegro.",
    );
  }
  const effectiveClassification = assertClassificationCoversStore(
    classification,
    sourceIntegrity.classificationFloor,
  );
  const rootCount = sourceIntegrity.ledgerSummary.rootCount;
  if (rootCount > 1) {
    throw new Error(
      "Backup público de store com múltiplos roots permanece bloqueado: "
      + "um grant de cliente não autoriza snapshot global.",
    );
  }
  if (rootCount === 1) {
    if (rootScopeId == null) {
      throw new Error(
        "Backup de store com dados exige rootScopeId explicitamente atestado.",
      );
    }
    assertScopedOperationGrant(grant, "backup", { requireRead: true });
  } else if (rootScopeId != null || grant != null) {
    throw new Error(
      "Backup de store vazio não aceita attestation de root inexistente.",
    );
  }
  await scopedAttestation({
    dbFile: source,
    rootScopeId,
    grant,
    coreRoot,
    at: createdAt,
    includeActiveState: true,
  });

  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await assertNoSymbolicLinks(path.dirname(target), "Diretório de backup");
  const snapshotTemporary = temporarySibling(target, "snapshot", ".sqlite");
  const bundleTemporary = temporarySibling(target, "bundle", BACKUP_EXTENSION);
  try {
    resolveKnowledgeStorePath({
      dbFile: snapshotTemporary,
      coreRoot,
    });
    await adapter.createConsistentSnapshot({
      sourceFile: source,
      destinationFile: snapshotTemporary,
    });
    const snapshotFile = await inspectAndHashFile(
      snapshotTemporary,
      "Snapshot SQLite",
    );
    const snapshotMetadata = normalizedSnapshotMetadata(
      await adapter.inspectSnapshot({ snapshotFile: snapshotTemporary }),
    );
    const globalReport = checkKnowledgeStoreIntegrity({
      dbFile: snapshotTemporary,
      coreRoot,
    });
    if (!globalReport.ok || !globalReport.initialized) {
      throw new Error("Snapshot SQLite falhou na verificação de integridade.");
    }
    const snapshotRootCount = globalReport.ledgerSummary.rootCount;
    if (snapshotRootCount > 1) {
      throw new Error(
        "Snapshot de backup contém múltiplos roots; bundle público bloqueado.",
      );
    }
    if (snapshotRootCount !== rootCount) {
      throw new Error(
        "Quantidade de roots mudou entre o pré-voo e o snapshot; "
        + "bundle bloqueado.",
      );
    }
    assertClassificationCoversStore(
      effectiveClassification,
      globalReport.classificationFloor,
    );
    if (snapshotMetadata.userVersion !== globalReport.userVersion) {
      throw new Error(
        "user_version do adapter diverge do relatório de integridade.",
      );
    }
    const scopeAttestation = await scopedAttestation({
      dbFile: snapshotTemporary,
      rootScopeId,
      grant,
      coreRoot,
      at: createdAt,
      includeActiveState: true,
    });
    const { manifest: assets } = await governedAssetInventory({
      dbFile: snapshotTemporary,
      rootScopeId,
      grant,
      coreRoot,
      at: createdAt,
    });
    const manifest = createManifest({
      createdAt,
      classification: effectiveClassification,
      globalReport,
      snapshotMetadata,
      snapshotFile,
      scopeAttestation,
      assets,
    });
    const serializedManifest = canonicalJson(manifest);
    await writeBundle(
      bundleTemporary,
      serializedManifest,
      snapshotTemporary,
    );
    const archive = await inspectAndHashFile(
      bundleTemporary,
      "Bundle de backup",
    );
    await commitTemporaryFile(bundleTemporary, target, {
      label: "Bundle de backup",
    });
    return {
      backupFile: target,
      archiveBytes: archive.bytes,
      archiveSha256: archive.sha256,
      manifest,
    };
  } finally {
    await Promise.allSettled([
      cleanupSqliteTemporary(snapshotTemporary),
      rm(bundleTemporary, { force: true }),
    ]);
  }
}

function assertManifestMatchesSnapshot({
  manifest,
  extracted,
  metadata,
  globalReport,
}) {
  if (
    extracted.bytes !== manifest.store.snapshotBytes
    || extracted.sha256 !== manifest.store.snapshotSha256
  ) {
    throw new Error("Checksum do snapshot SQLite diverge do manifest.");
  }
  if (
    metadata.applicationId !== manifest.store.applicationId
    || metadata.userVersion !== manifest.store.userVersion
    || globalReport.userVersion !== manifest.store.userVersion
  ) {
    throw new Error("Identidade SQLite diverge do manifest.");
  }
  const integritySha256 = sha256(
    canonicalJson(globalIntegrityProof(globalReport)),
  );
  if (integritySha256 !== manifest.store.integritySha256) {
    throw new Error("Fingerprint de integridade diverge do manifest.");
  }
  assertClassificationCoversStore(
    manifest.classification.level,
    globalReport.classificationFloor,
  );
  if (
    canonicalJson(globalReport.ledgerSummary)
    !== canonicalJson(manifest.ledger)
  ) {
    throw new Error("Resumo do ledger diverge do manifest.");
  }
  return integritySha256;
}

async function verifyRestoredScope({
  manifest,
  dbFile,
  rootScopeId,
  grant,
  coreRoot,
  at,
}) {
  if (manifest.scopeAttestation == null) {
    if (rootScopeId != null || grant != null) {
      throw new Error(
        "O backup não contém attestation de root scope.",
      );
    }
    return false;
  }
  const normalizedRoot = requiredText(rootScopeId, "rootScopeId", 200);
  if (!grant) {
    throw new Error(
      "Restore de backup com root scope exige o ScopeGrant correspondente.",
    );
  }
  const includeActiveState =
    manifest.schema === KNOWLEDGE_BACKUP_MANIFEST_SCHEMA;
  if (sha256(normalizedRoot) !== manifest.scopeAttestation.rootScopeHash) {
    throw new Error("rootScopeId diverge do attestation do backup.");
  }
  const actual = await scopedAttestation({
    dbFile,
    rootScopeId: normalizedRoot,
    grant,
    coreRoot,
    at,
    includeActiveState,
  });
  if (
    actual.ledgerHead !== manifest.scopeAttestation.ledgerHead
    || actual.integritySha256 !== manifest.scopeAttestation.integritySha256
  ) {
    throw new Error("Attestation do root scope diverge após restore.");
  }
  if (
    includeActiveState
    && (
      actual.activeActivationId
        !== manifest.scopeAttestation.activeActivationId
      || actual.activeActivationHash
        !== manifest.scopeAttestation.activeActivationHash
      || actual.activeReleaseId
        !== manifest.scopeAttestation.activeReleaseId
      || actual.activeReleaseHash
        !== manifest.scopeAttestation.activeReleaseHash
    )
  ) {
    throw new Error("Attestation da release ativa diverge após restore.");
  }
  return true;
}

async function verifyGovernedAssetsAfterRestore({
  manifest,
  dbFile,
  rootScopeId,
  grant,
  coreRoot,
  at,
}) {
  const derived = await governedAssetInventory({
    dbFile,
    rootScopeId,
    grant,
    coreRoot,
    at,
  });
  if (manifest.assets.mode === "not-included") {
    if (derived.manifest.mode !== "not-included") {
      throw new Error(
        "Manifest omite inventário governado presente no snapshot.",
      );
    }
    return derived.report;
  }
  if (
    manifest.assets.mode !== "governed-inventory"
    || derived.manifest.mode !== "governed-inventory"
  ) {
    throw new Error("Modo do inventário governado diverge do snapshot.");
  }
  const expectedProjection = manifest.assets.entries.map(
    governedEntryDatabaseProjection,
  );
  const actualProjection = derived.manifest.entries.map(
    governedEntryDatabaseProjection,
  );
  if (
    manifest.assets.sourceSchema !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
    || canonicalJson(expectedProjection) !== canonicalJson(actualProjection)
  ) {
    throw new Error(
      "Inventário governado do manifest diverge dos links do snapshot.",
    );
  }
  return derived.report;
}

export async function restoreKnowledgeBackup({
  backupFile,
  destinationDbFile,
  rootScopeId = null,
  grant = null,
  assetRootDirectory = null,
  snapshotAdapter,
  coreRoot = DEFAULT_CORE_ROOT,
  clock = () => new Date(),
} = {}) {
  const adapter = assertSnapshotAdapter(snapshotAdapter);
  const restoredAt = operationTime(clock, "clock");
  const descriptor = await readBundleDescriptor(backupFile, coreRoot);
  const governedManifest =
    descriptor.manifest.schema === KNOWLEDGE_BACKUP_MANIFEST_SCHEMA;
  if (governedManifest && assetRootDirectory != null) {
    throw new Error(
      "--asset-root pertence somente a backups históricos manifest@1.",
    );
  }
  if (
    descriptor.manifest.scopeAttestation != null
    && (rootScopeId == null || grant == null)
  ) {
    throw new Error(
      "Restore deste backup exige rootScopeId e ScopeGrant.",
    );
  }
  if (descriptor.manifest.scopeAttestation != null) {
    assertScopedOperationGrant(grant, "restore", {
      requireRead:
        descriptor.manifest.schema === KNOWLEDGE_BACKUP_MANIFEST_SCHEMA,
    });
  }
  const destination = resolveKnowledgeStorePath({
    dbFile: destinationDbFile,
    coreRoot,
  });
  await assertPathAvailable(destination, "Destino do restore");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await assertNoSymbolicLinks(path.dirname(destination), "Diretório de restore");
  const temporary = temporarySibling(destination, "restore", ".sqlite");
  try {
    resolveKnowledgeStorePath({ dbFile: temporary, coreRoot });
    const extracted = await extractSnapshot(
      descriptor.backupFile,
      temporary,
      descriptor.snapshotOffset,
      descriptor.manifest.store.snapshotBytes,
    );
    if (
      extracted.bytes !== descriptor.manifest.store.snapshotBytes
      || extracted.sha256 !== descriptor.manifest.store.snapshotSha256
    ) {
      throw new Error("Checksum do snapshot SQLite diverge do manifest.");
    }
    const metadata = normalizedSnapshotMetadata(
      await adapter.inspectSnapshot({ snapshotFile: temporary }),
    );
    const globalReport = checkKnowledgeStoreIntegrity({
      dbFile: temporary,
      coreRoot,
    });
    if (!globalReport.ok || !globalReport.initialized) {
      throw new Error("Snapshot restaurado falhou na integridade do store.");
    }
    const integritySha256 = assertManifestMatchesSnapshot({
      manifest: descriptor.manifest,
      extracted,
      metadata,
      globalReport,
    });
    const scopeAttestationVerified = await verifyRestoredScope({
      manifest: descriptor.manifest,
      dbFile: temporary,
      rootScopeId,
      grant,
      coreRoot,
      at: restoredAt,
    });
    const assets = governedManifest
      ? await verifyGovernedAssetsAfterRestore({
          manifest: descriptor.manifest,
          dbFile: temporary,
          rootScopeId,
          grant,
          coreRoot,
          at: restoredAt,
        })
      : await compareAssetInventory(
          descriptor.manifest.assets,
          assetRootDirectory,
        );
    const reportBody = {
      restoredAt,
      status: assets.status === "asymmetric"
        ? "restored-asymmetric"
        : "restored",
      providerFree: true,
      changed: true,
      database: {
        schema: KNOWLEDGE_STORE_SCHEMA,
        userVersion: metadata.userVersion,
        applicationId: metadata.applicationId,
        bytes: extracted.bytes,
        sha256: extracted.sha256,
        integritySha256,
      },
      scopeAttestationVerified,
      assets,
      reportOnlyAssets: true,
      repairPerformed: false,
      manifestHash: descriptor.manifest.manifestHash,
    };
    const report = governedManifest
      ? {
          schema: KNOWLEDGE_RESTORE_REPORT_SCHEMA,
          sourceManifestSchema: descriptor.manifest.schema,
          ...reportBody,
        }
      : {
          schema: KNOWLEDGE_RESTORE_REPORT_V1_SCHEMA,
          ...reportBody,
        };
    assertKnowledgeContract(report, {
      schemaId: report.schema,
      label: "Relatório de restore",
    });
    await commitTemporaryFile(temporary, destination, {
      label: "Knowledge Store restaurado",
    });
    return report;
  } finally {
    await cleanupSqliteTemporary(temporary);
  }
}
