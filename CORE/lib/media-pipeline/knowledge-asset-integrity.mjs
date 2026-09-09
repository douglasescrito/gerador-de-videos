import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_ASSET_LINK_SCHEMA =
  "mkt-videos/knowledge-asset-link@1";
export const KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA =
  "mkt-videos/knowledge-asset-link-payload@1";
export const KNOWLEDGE_ASSET_INTEGRITY_REPORT_SCHEMA =
  "mkt-videos/knowledge-asset-integrity-report@1";

const ROOT_KINDS = Object.freeze(["PESSOAS", "outputs", "test"]);
const ROOT_KIND_SET = new Set(ROOT_KINDS);
const LINK_KEYS = new Set([
  "schema",
  "id",
  "rootKind",
  "relativePath",
  "expectedSha256",
  "expectedBytes",
  "rightsStatus",
  "quarantineStatus",
]);
const ROOT_KEYS = new Set(["rootKind", "directory"]);
const HASH_BUFFER_BYTES = 1024 * 1024;

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
    if (!Number.isFinite(value)) throw new Error("Relatório contém número inválido.");
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
  throw new Error("Relatório deve conter somente valores JSON.");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contém campo não permitido.`);
  }
}

function rootKind(value, label) {
  if (typeof value !== "string" || !ROOT_KIND_SET.has(value)) {
    throw new Error(`${label} é inválido.`);
  }
  return value;
}

function normalizedRelativePath(value) {
  if (typeof value !== "string") {
    throw new Error("Asset link exige relativePath textual.");
  }
  if (
    value.length < 1
    || value.length > 1024
    || value !== value.normalize("NFC")
    || value.includes("\\")
    || value.includes(":")
    || /[\u0000-\u001f\u007f]/u.test(value)
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value
  ) {
    throw new Error("Asset link exige relativePath normalizado e seguro.");
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
    throw new Error("Asset link exige relativePath normalizado e seguro.");
  }
  return value;
}

export function assertKnowledgeAssetLinkPayload(payload) {
  const value = plainObject(payload, "KnowledgeAssetLink payload");
  assertKnowledgeContract(value, {
    schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    label: "KnowledgeAssetLink payload",
  });
  const normalized = {
    schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    rootKind: value.rootKind,
    relativePath: normalizedRelativePath(value.relativePath),
    expectedSha256: value.expectedSha256,
    expectedBytes: value.expectedBytes,
    mediaType: value.mediaType,
  };
  return deepFreeze(normalized);
}

export function knowledgeAssetLinkItemId({
  rootScopeId,
  rootKind,
  relativePath,
} = {}) {
  const normalizedRoot = String(rootScopeId ?? "").trim();
  if (!normalizedRoot) {
    throw new Error("Asset link exige rootScopeId.");
  }
  const normalizedPath = normalizedRelativePath(relativePath);
  if (!new Set(["outputs", "PESSOAS"]).has(rootKind)) {
    throw new Error("Asset link persistido exige rootKind outputs ou PESSOAS.");
  }
  return `kal_${sha256(canonicalJson({
    rootScopeId: normalizedRoot,
    rootKind,
    relativePath: normalizedPath,
  })).slice(0, 32)}`;
}

export function projectKnowledgeAssetLink(item, {
  at = new Date(),
} = {}) {
  assertKnowledgeContract(item, {
    schemaId: "mkt-videos/knowledge-item@1",
    label: "Knowledge item de asset link",
  });
  if (
    item.recordType !== "relation"
    || item.schemaId !== KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA
    || item.schemaVersion !== 1
  ) {
    throw new Error("Knowledge item não é um asset link canônico.");
  }
  const payload = assertKnowledgeAssetLinkPayload(item.payload);
  const expectedId = knowledgeAssetLinkItemId({
    rootScopeId: item.rootScopeId,
    rootKind: payload.rootKind,
    relativePath: payload.relativePath,
  });
  if (item.id !== expectedId) {
    throw new Error("ID do asset link diverge da localização governada.");
  }
  const observedAt = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("Data de projeção do asset link é inválida.");
  }
  const retentionExpiresAt = item.governance.retention.expiresAt;
  let rightsStatus = item.governance.rights.inventory;
  if (item.status === "revoked") rightsStatus = "revoked";
  else if (
    retentionExpiresAt != null
    && Date.parse(retentionExpiresAt) <= observedAt.getTime()
  ) {
    rightsStatus = "expired";
  } else if (item.status !== "active") {
    rightsStatus = "unknown";
  }
  return deepFreeze({
    schema: KNOWLEDGE_ASSET_LINK_SCHEMA,
    id: item.id,
    rootKind: payload.rootKind,
    relativePath: payload.relativePath,
    expectedSha256: payload.expectedSha256,
    expectedBytes: payload.expectedBytes,
    rightsStatus,
    quarantineStatus: item.status === "quarantined"
      ? "quarantined"
      : "clear",
  });
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
    throw new Error("Falha read-only ao inspecionar filesystem.");
  }
}

async function assertNoLinkedAncestor(target, label) {
  let cursor = path.resolve(target);
  while (true) {
    const metadata = await lstatOrNull(cursor);
    if (metadata?.isSymbolicLink()) {
      throw new Error(`${label} não pode usar symlink ou junction.`);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function normalizeRoots(
  allowedRoots,
  { missingRootsAsEmpty = false } = {},
) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error("allowedRoots exige uma allowlist explícita não vazia.");
  }
  const normalized = [];
  const kinds = new Set();
  for (const [index, raw] of allowedRoots.entries()) {
    const value = plainObject(raw, `allowedRoots[${index}]`);
    assertAllowedKeys(value, ROOT_KEYS, `allowedRoots[${index}]`);
    const kind = rootKind(value.rootKind, `allowedRoots[${index}].rootKind`);
    if (kinds.has(kind)) throw new Error("allowedRoots contém rootKind duplicado.");
    kinds.add(kind);
    if (typeof value.directory !== "string" || !path.isAbsolute(value.directory)) {
      throw new Error("Cada allowlist root exige directory absoluto.");
    }
    await assertNoLinkedAncestor(value.directory, "Allowlist root");
    const metadata = await lstatOrNull(value.directory);
    if (metadata == null && missingRootsAsEmpty) {
      normalized.push({
        rootKind: kind,
        directory: path.resolve(value.directory),
        exists: false,
      });
      continue;
    }
    if (!metadata?.isDirectory()) {
      throw new Error("Allowlist root deve existir e ser diretório.");
    }
    let canonical;
    try {
      canonical = await realpath(value.directory);
    } catch {
      throw new Error("Allowlist root não pôde ser resolvido com segurança.");
    }
    normalized.push({ rootKind: kind, directory: canonical, exists: true });
  }
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      if (
        isWithin(normalized[left].directory, normalized[right].directory)
        || isWithin(normalized[right].directory, normalized[left].directory)
      ) {
        throw new Error("Allowlist roots sobrepostos são ambíguos.");
      }
    }
  }
  return normalized.sort((left, right) =>
    compareText(left.rootKind, right.rootKind));
}

function normalizeLinks(links, allowedKinds) {
  if (!Array.isArray(links)) throw new Error("links deve ser um array.");
  const ids = new Set();
  const locations = new Set();
  return links.map((raw, index) => {
    const value = plainObject(raw, `links[${index}]`);
    assertAllowedKeys(value, LINK_KEYS, `links[${index}]`);
    assertKnowledgeContract(value, {
      schemaId: KNOWLEDGE_ASSET_LINK_SCHEMA,
      label: `KnowledgeAssetLink[${index}]`,
    });
    const normalized = {
      ...value,
      relativePath: normalizedRelativePath(value.relativePath),
    };
    if (!allowedKinds.has(normalized.rootKind)) {
      throw new Error("Asset link usa rootKind fora da allowlist.");
    }
    if (ids.has(normalized.id)) {
      throw new Error("Asset links contêm ID pseudônimo duplicado.");
    }
    ids.add(normalized.id);
    const location = `${normalized.rootKind}\u0000${normalized.relativePath}`;
    const locationKey = process.platform === "win32"
      ? location.toLowerCase()
      : location;
    if (locations.has(locationKey)) {
      throw new Error("Asset links contêm vínculo físico duplicado.");
    }
    locations.add(locationKey);
    return normalized;
  }).sort((left, right) =>
    compareText(left.id, right.id)
    || compareText(left.rootKind, right.rootKind)
    || compareText(left.relativePath, right.relativePath));
}

function relativeKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function scanRoot(directory) {
  const files = new Set();
  async function visit(current, prefix) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      throw new Error("Allowlist root não pôde ser inventariada com segurança.");
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(current, entry.name);
      const metadata = await lstatOrNull(candidate);
      if (metadata == null) {
        throw new Error("Filesystem mudou durante o inventário read-only.");
      }
      if (metadata.isSymbolicLink()) {
        throw new Error("Allowlist root contém symlink ou junction.");
      }
      if (metadata.isDirectory()) {
        await visit(candidate, relative);
      } else if (metadata.isFile()) {
        if (metadata.nlink > 1) {
          throw new Error("Allowlist root contém hardlink.");
        }
        files.add(relativeKey(relative.replaceAll("\\", "/")));
      } else {
        throw new Error("Allowlist root contém entrada não regular.");
      }
    }
  }
  await visit(directory, "");
  return files;
}

function sameIdentity(left, right) {
  if (
    Number(left.ino) !== 0
    || Number(right.ino) !== 0
  ) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.birthtimeMs === right.birthtimeMs;
}

async function hashAsset(directory, relativePath) {
  const candidate = path.resolve(
    directory,
    ...relativePath.split("/"),
  );
  if (!isWithin(directory, candidate)) {
    throw new Error("Asset link escapou da allowlist root.");
  }
  const before = await lstatOrNull(candidate);
  if (before == null) return null;
  if (before.isSymbolicLink()) {
    throw new Error("Asset link aponta para symlink ou junction.");
  }
  if (!before.isFile()) throw new Error("Asset link não aponta para arquivo regular.");
  if (before.nlink > 1) throw new Error("Asset link aponta para hardlink.");

  const noFollow = typeof fsConstants.O_NOFOLLOW === "number"
    ? fsConstants.O_NOFOLLOW
    : 0;
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP") {
      throw new Error("Asset link aponta para symlink ou junction.");
    }
    throw new Error("Asset link não pôde ser aberto com segurança.");
  }
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.nlink > 1
      || !sameIdentity(before, opened)
    ) {
      throw new Error("Asset mudou durante a abertura read-only.");
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
        throw new Error("Asset terminou durante a leitura read-only.");
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const openedAfter = await handle.stat();
    const after = await lstatOrNull(candidate);
    if (
      after == null
      || after.isSymbolicLink()
      || after.nlink > 1
      || !sameIdentity(opened, openedAfter)
      || !sameIdentity(opened, after)
      || openedAfter.size !== opened.size
      || openedAfter.mtimeMs !== opened.mtimeMs
      || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
    ) {
      throw new Error("Asset mudou durante a leitura read-only.");
    }
    return {
      bytes: opened.size,
      sha256: digest.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

function restrictedResult(link) {
  if (link.quarantineStatus === "quarantined") {
    return {
      linkId: link.id,
      rootKind: link.rootKind,
      status: "quarantined",
      reason: "asset-quarantined",
    };
  }
  if (link.rightsStatus !== "allowed") {
    return {
      linkId: link.id,
      rootKind: link.rootKind,
      status: "revoked",
      reason: `rights-${link.rightsStatus}`,
    };
  }
  return null;
}

async function classifyLink(link, directory) {
  const restricted = restrictedResult(link);
  if (restricted) return restricted;
  const actual = await hashAsset(directory, link.relativePath);
  if (actual == null) {
    return {
      linkId: link.id,
      rootKind: link.rootKind,
      status: "missing",
      reason: "asset-not-found",
    };
  }
  if (
    link.expectedBytes != null
    && actual.bytes !== link.expectedBytes
  ) {
    return {
      linkId: link.id,
      rootKind: link.rootKind,
      status: "missing",
      reason: "size-mismatch",
    };
  }
  if (actual.sha256 !== link.expectedSha256) {
    return {
      linkId: link.id,
      rootKind: link.rootKind,
      status: "missing",
      reason: "hash-mismatch",
    };
  }
  return {
    linkId: link.id,
    rootKind: link.rootKind,
    status: "resolved",
    reason: "hash-match",
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export async function verifyKnowledgeAssetIntegrity({
  links = [],
  allowedRoots,
  missingRootsAsEmpty = false,
} = {}) {
  const roots = await normalizeRoots(allowedRoots, {
    missingRootsAsEmpty,
  });
  const rootMap = new Map(roots.map((entry) => [entry.rootKind, entry]));
  const normalizedLinks = normalizeLinks(links, new Set(rootMap.keys()));
  const inventory = new Map();
  for (const root of roots) {
    inventory.set(
      root.rootKind,
      root.exists ? await scanRoot(root.directory) : new Set(),
    );
  }

  const results = [];
  for (const link of normalizedLinks) {
    const root = rootMap.get(link.rootKind);
    results.push(root.exists
      ? await classifyLink(link, root.directory)
      : {
          linkId: link.id,
          rootKind: link.rootKind,
          status: "missing",
          reason: "asset-not-found",
        });
  }

  const rootSummaries = roots.map((root) => {
    const linked = normalizedLinks.filter((entry) =>
      entry.rootKind === root.rootKind);
    const declaredKeys = new Set(linked.map((entry) =>
      relativeKey(entry.relativePath)));
    const files = inventory.get(root.rootKind);
    let presentLinkedCount = 0;
    for (const entry of declaredKeys) {
      if (files.has(entry)) presentLinkedCount += 1;
    }
    let extraCount = 0;
    for (const entry of files) {
      if (!declaredKeys.has(entry)) extraCount += 1;
    }
    return {
      rootKind: root.rootKind,
      linkedCount: linked.length,
      presentLinkedCount,
      scannedFileCount: files.size,
      extraCount,
    };
  });

  const counts = {
    total: results.length,
    resolved: results.filter((entry) => entry.status === "resolved").length,
    missing: results.filter((entry) => entry.status === "missing").length,
    revoked: results.filter((entry) => entry.status === "revoked").length,
    quarantined: results.filter((entry) =>
      entry.status === "quarantined").length,
    extra: rootSummaries.reduce((sum, entry) => sum + entry.extraCount, 0),
  };
  const body = {
    schema: KNOWLEDGE_ASSET_INTEGRITY_REPORT_SCHEMA,
    status:
      counts.resolved === counts.total && counts.extra === 0
        ? "match"
        : "asymmetric",
    providerFree: true,
    readOnly: true,
    reportOnly: true,
    repairPerformed: false,
    counts,
    roots: rootSummaries,
    results,
  };
  const report = {
    ...body,
    aggregateHash: sha256(canonicalJson(body)),
  };
  assertKnowledgeContract(report, {
    schemaId: KNOWLEDGE_ASSET_INTEGRITY_REPORT_SCHEMA,
    label: "KnowledgeAssetIntegrityReport",
  });
  return deepFreeze(report);
}

export async function verifyKnowledgeAssetIntegrityFromRepository({
  repository,
  grant,
  rootScopeId,
  allowedRoots,
  at = new Date(),
  missingRootsAsEmpty = false,
} = {}) {
  if (
    !repository
    || typeof repository.listKnowledgeAssetLinkItems !== "function"
  ) {
    throw new Error(
      "Integridade governada exige o KnowledgeStoreRepository canônico.",
    );
  }
  const items = repository.listKnowledgeAssetLinkItems({
    grant,
    rootScopeId,
  });
  const links = items.map((item) => projectKnowledgeAssetLink(item, { at }));
  return verifyKnowledgeAssetIntegrity({
    links,
    allowedRoots,
    missingRootsAsEmpty,
  });
}
