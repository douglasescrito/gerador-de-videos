import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { assertKnowledgeContract } from "./knowledge-schema-registry.mjs";
import {
  CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS,
  KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS,
} from "./knowledge-record-contracts.mjs";

export const KNOWLEDGE_REPLAY_REPORT_SCHEMA =
  "mkt-videos/knowledge-replay-report@2";
export const KNOWLEDGE_REPLAY_REPORT_V1_SCHEMA =
  "mkt-videos/knowledge-replay-report@1";
export const KNOWLEDGE_REPLAY_REGISTRY_SCHEMA =
  "mkt-videos/knowledge-schema-replay-registry@1";
export const KNOWLEDGE_REPLAY_AUTHORIZATION_SCHEMA =
  "mkt-videos/knowledge-replay-authorization@1";

const KNOWLEDGE_EXPORT_V1_SCHEMA = "mkt-videos/knowledge-export@1";
const KNOWLEDGE_EXPORT_SCHEMA = "mkt-videos/knowledge-export@2";
const KNOWLEDGE_ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
const KNOWLEDGE_RELEASE_SCHEMA = "mkt-videos/knowledge-release@1";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SCHEMA_ID_PATTERN =
  /^mkt-videos\/[A-Za-z0-9._/-]+@([1-9][0-9]*)$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const REPLAY_EXECUTION_TIMEOUT_MS = 250;
const issuedReplayRegistries = new WeakSet();
const issuedReplayAuthorizations = new WeakSet();
const consumedReplayAuthorizations = new WeakSet();
const SUPPORTED_KNOWLEDGE_EXPORT_SCHEMAS = new Set([
  KNOWLEDGE_EXPORT_V1_SCHEMA,
  KNOWLEDGE_EXPORT_SCHEMA,
]);

function normalizeJson(value, location = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`${location}.${key} é uma chave proibida.`);
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
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function canonicalHash(value) {
  return sha256(canonicalJson(value));
}

function cloneJson(value) {
  return JSON.parse(canonicalJson(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(`${label} deve ter entre 1 e 200 caracteres.`);
  }
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${label} deve ser um inteiro positivo.`);
  }
  return normalized;
}

function schemaIdentity(schemaId, schemaVersion, label) {
  const normalizedId = requiredText(schemaId, `${label}.schemaId`);
  const normalizedVersion = positiveInteger(
    schemaVersion,
    `${label}.schemaVersion`,
  );
  const match = normalizedId.match(SCHEMA_ID_PATTERN);
  if (!match || Number(match[1]) !== normalizedVersion) {
    throw new Error(
      `${label} deve declarar schemaId canônico coerente com schemaVersion.`,
    );
  }
  return {
    schemaId: normalizedId,
    schemaVersion: normalizedVersion,
  };
}

function schemaKey(schemaId, schemaVersion) {
  return `${schemaId}\u0000${schemaVersion}`;
}

function functionSource(implementation, label) {
  if (typeof implementation !== "function") {
    throw new Error(`${label} deve ser uma função síncrona pura.`);
  }
  if (
    implementation.constructor?.name === "AsyncFunction"
    || implementation.constructor?.name === "GeneratorFunction"
    || implementation.constructor?.name === "AsyncGeneratorFunction"
  ) {
    throw new Error(`${label} deve ser síncrona e não geradora.`);
  }
  const source = Function.prototype.toString.call(implementation)
    .replaceAll("\r\n", "\n");
  if (source.includes("[native code]")) {
    throw new Error(`${label} não pode usar implementação nativa ou vinculada.`);
  }
  return source;
}

function sandboxFunctionExpression(source, label) {
  const normalized = String(source).trim();
  if (
    /^(?:async\s+)?function\b/.test(normalized)
    || /^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(normalized)
  ) {
    return `(${normalized})`;
  }
  const method = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(normalized);
  if (!method) {
    throw new Error(`${label} não possui uma forma executável confiável.`);
  }
  return `({${normalized}}).${method[1]}`;
}

function normalizeReader(definition, index = 0) {
  const id = requiredText(definition?.id, `readers[${index}].id`);
  const implementationVersion = positiveInteger(
    definition?.implementationVersion,
    `readers[${index}].implementationVersion`,
  );
  const identity = schemaIdentity(
    definition?.schemaId,
    definition?.schemaVersion,
    `readers[${index}]`,
  );
  const read = definition?.read;
  const implementationSource = functionSource(
    read,
    `readers[${index}].read`,
  );
  const hash = canonicalHash({
    kind: "reader",
    id,
    implementationVersion,
    ...identity,
    implementationSource,
  });
  return Object.freeze({
    kind: "reader",
    id,
    implementationVersion,
    ...identity,
    hash,
    read,
  });
}

function normalizeUpcaster(definition, index = 0) {
  const id = requiredText(definition?.id, `upcasters[${index}].id`);
  const implementationVersion = positiveInteger(
    definition?.implementationVersion,
    `upcasters[${index}].implementationVersion`,
  );
  const from = schemaIdentity(
    definition?.fromSchemaId,
    definition?.fromSchemaVersion,
    `upcasters[${index}].from`,
  );
  const to = schemaIdentity(
    definition?.toSchemaId,
    definition?.toSchemaVersion,
    `upcasters[${index}].to`,
  );
  if (
    from.schemaId === to.schemaId
    && from.schemaVersion === to.schemaVersion
  ) {
    throw new Error(`upcasters[${index}] deve avançar para outro schema.`);
  }
  const upcast = definition?.upcast;
  const implementationSource = functionSource(
    upcast,
    `upcasters[${index}].upcast`,
  );
  const hash = canonicalHash({
    kind: "upcaster",
    id,
    implementationVersion,
    fromSchemaId: from.schemaId,
    fromSchemaVersion: from.schemaVersion,
    toSchemaId: to.schemaId,
    toSchemaVersion: to.schemaVersion,
    implementationSource,
  });
  return Object.freeze({
    kind: "upcaster",
    id,
    implementationVersion,
    fromSchemaId: from.schemaId,
    fromSchemaVersion: from.schemaVersion,
    toSchemaId: to.schemaId,
    toSchemaVersion: to.schemaVersion,
    hash,
    upcast,
  });
}

function registryDescriptor(readers, upcasters) {
  return {
    schema: KNOWLEDGE_REPLAY_REGISTRY_SCHEMA,
    readers: readers.map((reader) => ({
      id: reader.id,
      implementationVersion: reader.implementationVersion,
      schemaId: reader.schemaId,
      schemaVersion: reader.schemaVersion,
      hash: reader.hash,
    })),
    upcasters: upcasters.map((upcaster) => ({
      id: upcaster.id,
      implementationVersion: upcaster.implementationVersion,
      fromSchemaId: upcaster.fromSchemaId,
      fromSchemaVersion: upcaster.fromSchemaVersion,
      toSchemaId: upcaster.toSchemaId,
      toSchemaVersion: upcaster.toSchemaVersion,
      hash: upcaster.hash,
    })),
  };
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function readerComparator(left, right) {
  return compareText(left.schemaId, right.schemaId)
    || left.schemaVersion - right.schemaVersion
    || compareText(left.id, right.id)
    || left.implementationVersion - right.implementationVersion;
}

function upcasterComparator(left, right) {
  return compareText(left.fromSchemaId, right.fromSchemaId)
    || left.fromSchemaVersion - right.fromSchemaVersion
    || compareText(left.toSchemaId, right.toSchemaId)
    || left.toSchemaVersion - right.toSchemaVersion
    || compareText(left.id, right.id)
    || left.implementationVersion - right.implementationVersion;
}

export function createKnowledgeSchemaReplayRegistry({
  readers = [],
  upcasters = [],
} = {}) {
  if (!Array.isArray(readers) || !Array.isArray(upcasters)) {
    throw new Error("Registry de replay exige arrays de readers e upcasters.");
  }
  const normalizedReaders = readers.map(normalizeReader).sort(readerComparator);
  const normalizedUpcasters = upcasters
    .map(normalizeUpcaster)
    .sort(upcasterComparator);

  const readerKeys = new Set();
  const readerImplementations = new Set();
  for (const reader of normalizedReaders) {
    const key = schemaKey(reader.schemaId, reader.schemaVersion);
    if (readerKeys.has(key)) {
      throw new Error(`Reader duplicado para ${reader.schemaId}.`);
    }
    readerKeys.add(key);
    const implementationKey = `${reader.id}\u0000${reader.implementationVersion}`;
    if (readerImplementations.has(implementationKey)) {
      throw new Error(`Versão de reader duplicada: ${reader.id}.`);
    }
    readerImplementations.add(implementationKey);
  }

  const upcasterEdges = new Set();
  const upcasterImplementations = new Set();
  for (const upcaster of normalizedUpcasters) {
    const edge = [
      schemaKey(upcaster.fromSchemaId, upcaster.fromSchemaVersion),
      schemaKey(upcaster.toSchemaId, upcaster.toSchemaVersion),
    ].join("\u0001");
    if (upcasterEdges.has(edge)) {
      throw new Error(
        `Upcaster duplicado entre ${upcaster.fromSchemaId} e ${upcaster.toSchemaId}.`,
      );
    }
    upcasterEdges.add(edge);
    const implementationKey =
      `${upcaster.id}\u0000${upcaster.implementationVersion}`;
    if (upcasterImplementations.has(implementationKey)) {
      throw new Error(`Versão de upcaster duplicada: ${upcaster.id}.`);
    }
    upcasterImplementations.add(implementationKey);
  }

  const descriptor = registryDescriptor(
    normalizedReaders,
    normalizedUpcasters,
  );
  const registry = Object.freeze({
    schema: KNOWLEDGE_REPLAY_REGISTRY_SCHEMA,
    readers: Object.freeze(normalizedReaders),
    upcasters: Object.freeze(normalizedUpcasters),
    hash: canonicalHash(descriptor),
  });
  issuedReplayRegistries.add(registry);
  return registry;
}

function assertReplayRegistry(registry) {
  if (
    !issuedReplayRegistries.has(registry)
    ||
    registry?.schema !== KNOWLEDGE_REPLAY_REGISTRY_SCHEMA
    || !Array.isArray(registry?.readers)
    || !Array.isArray(registry?.upcasters)
    || !HASH_PATTERN.test(String(registry?.hash ?? ""))
  ) {
    throw new Error(
      "Registry de replay inválido ou não emitido pelo runtime confiável.",
    );
  }
  const descriptor = registryDescriptor(registry.readers, registry.upcasters);
  if (canonicalHash(descriptor) !== registry.hash) {
    throw new Error("Registry de replay adulterado.");
  }
  return registry;
}

export function registerKnowledgeSchemaReader(registry, reader) {
  const current = assertReplayRegistry(registry);
  return createKnowledgeSchemaReplayRegistry({
    readers: [...current.readers, reader],
    upcasters: current.upcasters,
  });
}

export function registerKnowledgeSchemaUpcaster(registry, upcaster) {
  const current = assertReplayRegistry(registry);
  return createKnowledgeSchemaReplayRegistry({
    readers: current.readers,
    upcasters: [...current.upcasters, upcaster],
  });
}

function readCurrentKnowledgePayload(payload) {
  return payload;
}

export function createBuiltinKnowledgeSchemaReplayRegistry() {
  const contracts = [
    ...CANONICAL_KNOWLEDGE_PAYLOAD_CONTRACTS,
    ...KNOWLEDGE_SPECIALIZED_ITEM_PAYLOAD_CONTRACTS,
  ];
  return createKnowledgeSchemaReplayRegistry({
    readers: contracts.map((contract) => ({
      id: `builtin:${contract.schemaId}`,
      implementationVersion: 1,
      schemaId: contract.schemaId,
      schemaVersion: contract.schemaVersion,
      read: readCurrentKnowledgePayload,
    })),
    upcasters: [],
  });
}

function runDeterministically(implementationSource, input, label) {
  const inputBytes = canonicalJson(input);
  const outputs = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const isolatedInput = deepFreeze(JSON.parse(inputBytes));
    let outputBytes;
    try {
      const expression = sandboxFunctionExpression(
        implementationSource,
        label,
      );
      outputBytes = runInNewContext(
        `"use strict"; JSON.stringify((${expression})(input));`,
        { input: isolatedInput },
        {
          timeout: REPLAY_EXECUTION_TIMEOUT_MS,
          contextCodeGeneration: {
            strings: false,
            wasm: false,
          },
        },
      );
    } catch {
      throw new Error(
        `${label} falhou no ambiente isolado de replay confiável.`,
      );
    }
    if (typeof outputBytes !== "string") {
      throw new Error(`${label} retornou resultado não serializável.`);
    }
    outputs.push(canonicalJson(JSON.parse(outputBytes)));
    if (canonicalJson(isolatedInput) !== inputBytes) {
      throw new Error(`${label} tentou alterar a entrada imutável.`);
    }
  }
  if (new Set(outputs).size !== 1) {
    throw new Error(`${label} é não determinístico; replay bloqueado.`);
  }
  return JSON.parse(outputs[0]);
}

function normalizedDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} é inválido.`);
  return date.toISOString();
}

function replayMemberRefHash(release, member) {
  return canonicalHash({
    releaseHash: release.hash,
    id: member.id,
    revision: member.revision,
    contentHash: member.contentHash,
  });
}

function assertRetentionActive(item, checkedAt, label) {
  const expiresAt = item?.governance?.retention?.expiresAt;
  if (expiresAt != null && Date.parse(expiresAt) <= Date.parse(checkedAt)) {
    throw new Error(`${label} possui retenção expirada.`);
  }
}

function assertLocalReplayEligibility(item, checkedAt, label) {
  if (item?.status !== "active") {
    throw new Error(`${label} não está active; replay bloqueado.`);
  }
  if (item?.governance?.rights?.localAnalysis !== "allowed") {
    throw new Error(
      `${label} não autoriza localAnalysis; replay bloqueado.`,
    );
  }
  if (!HASH_PATTERN.test(String(item?.governance?.hash ?? ""))) {
    throw new Error(`${label} não possui governance hash válido.`);
  }
  assertRetentionActive(item, checkedAt, label);
}

export function issueKnowledgeReplayAuthorization({
  rootScopeId,
  release,
  releaseItems,
  currentItems,
  checkedAt,
  expiresAt,
} = {}) {
  const normalizedRoot = requiredText(rootScopeId, "rootScopeId");
  assertKnowledgeContract(release, {
    schemaId: KNOWLEDGE_RELEASE_SCHEMA,
    label: "Release para autorização de replay",
  });
  assertHash(
    bodyWithoutHash(release, "hash"),
    release.hash,
    "Release para autorização de replay",
  );
  if (release.rootScopeId !== normalizedRoot) {
    throw new Error("Release não pertence ao root da autorização de replay.");
  }
  if (
    !Array.isArray(releaseItems)
    || !Array.isArray(currentItems)
    || releaseItems.length !== release.members.length
    || currentItems.length !== release.members.length
  ) {
    throw new Error(
      "Autorização de replay exige revisões da release e heads atuais exatos.",
    );
  }
  const normalizedCheckedAt = normalizedDate(checkedAt, "checkedAt");
  const normalizedExpiresAt = normalizedDate(expiresAt, "expiresAt");
  const ttlMs =
    Date.parse(normalizedExpiresAt) - Date.parse(normalizedCheckedAt);
  if (ttlMs <= 0 || ttlMs > MAX_AUTHORIZATION_TTL_MS) {
    throw new Error(
      `Autorização de replay deve expirar em até ${MAX_AUTHORIZATION_TTL_MS}ms.`,
    );
  }
  const members = release.members.map((member, ordinal) => {
    const releaseItem = releaseItems[ordinal];
    const currentItem = currentItems[ordinal];
    if (
      releaseItem?.id !== member.id
      || releaseItem?.revision !== member.revision
      || releaseItem?.contentHash !== member.contentHash
      || currentItem?.id !== member.id
      || currentItem?.rootScopeId !== normalizedRoot
    ) {
      throw new Error(
        "Autorização de replay diverge dos membros ou heads do root.",
      );
    }
    assertLocalReplayEligibility(
      releaseItem,
      normalizedCheckedAt,
      `Release member ${ordinal}`,
    );
    assertLocalReplayEligibility(
      currentItem,
      normalizedCheckedAt,
      `Current head ${ordinal}`,
    );
    return {
      ordinal,
      memberRefHash: replayMemberRefHash(release, member),
      currentHeadHash: canonicalHash({
        contentHash: currentItem.contentHash,
        governanceHash: currentItem.governance.hash,
        revision: currentItem.revision,
      }),
      localAnalysis: "allowed",
      retention: "active",
      revocation: "clear",
    };
  });
  const rightsHeadHash = canonicalHash(members);
  const body = {
    schema: KNOWLEDGE_REPLAY_AUTHORIZATION_SCHEMA,
    rootScopeHash: sha256(normalizedRoot),
    releaseHash: release.hash,
    checkedAt: normalizedCheckedAt,
    expiresAt: normalizedExpiresAt,
    rightsHeadHash,
    members,
  };
  const authorization = deepFreeze({
    ...body,
    hash: canonicalHash(body),
  });
  assertKnowledgeContract(authorization, {
    schemaId: KNOWLEDGE_REPLAY_AUTHORIZATION_SCHEMA,
    label: "Autorização de replay",
  });
  issuedReplayAuthorizations.add(authorization);
  return authorization;
}

function assertReplayAuthorization({
  authorization,
  knowledgeExport,
  release,
  clock,
}) {
  if (!issuedReplayAuthorizations.has(authorization)) {
    throw new Error(
      "Replay exige autorização vigente emitida pelo runtime do Knowledge Store.",
    );
  }
  if (consumedReplayAuthorizations.has(authorization)) {
    throw new Error("Autorização de replay já foi consumida.");
  }
  assertKnowledgeContract(authorization, {
    schemaId: KNOWLEDGE_REPLAY_AUTHORIZATION_SCHEMA,
    label: "Autorização de replay",
  });
  const body = bodyWithoutHash(authorization, "hash");
  if (canonicalHash(body) !== authorization.hash) {
    throw new Error("Autorização de replay adulterada.");
  }
  const now = normalizedDate(
    typeof clock === "function" ? clock() : new Date(),
    "clock",
  );
  if (
    Date.parse(now) < Date.parse(authorization.checkedAt)
    || Date.parse(now) >= Date.parse(authorization.expiresAt)
  ) {
    throw new Error("Autorização de replay ainda não é válida ou expirou.");
  }
  if (
    authorization.rootScopeHash !== sha256(knowledgeExport.rootScopeId)
    || authorization.releaseHash !== release.hash
    || authorization.members.length !== release.members.length
    || authorization.rightsHeadHash
      !== canonicalHash(authorization.members)
  ) {
    throw new Error(
      "Autorização de replay diverge do root, release ou rights head.",
    );
  }
  release.members.forEach((member, ordinal) => {
    const decision = authorization.members[ordinal];
    if (
      decision.ordinal !== ordinal
      || decision.memberRefHash !== replayMemberRefHash(release, member)
      || decision.localAnalysis !== "allowed"
      || decision.retention !== "active"
      || decision.revocation !== "clear"
    ) {
      throw new Error(
        "Autorização de replay diverge de um membro da release.",
      );
    }
  });
  consumedReplayAuthorizations.add(authorization);
  return authorization;
}

function bodyWithoutHash(value, hashField) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== hashField),
  );
}

function assertHash(value, expected, label) {
  if (!HASH_PATTERN.test(String(expected ?? ""))) {
    throw new Error(`${label} não possui hash canônico.`);
  }
  if (canonicalHash(value) !== expected) {
    throw new Error(`${label} adulterado; hash divergente.`);
  }
}

function validateExport(knowledgeExport) {
  if (!SUPPORTED_KNOWLEDGE_EXPORT_SCHEMAS.has(knowledgeExport?.schema)) {
    throw new Error(
      `Schema de Knowledge export não suportado: ${knowledgeExport?.schema ?? "ausente"}.`,
    );
  }
  assertKnowledgeContract(knowledgeExport, {
    schemaId: knowledgeExport.schema,
    label: "Knowledge export para replay",
  });
  assertHash(
    bodyWithoutHash(knowledgeExport, "hash"),
    knowledgeExport.hash,
    "Knowledge export",
  );
}

function selectRelease(knowledgeExport, { releaseId = null, releaseHash = null }) {
  const normalizedReleaseId = releaseId == null
    ? knowledgeExport.kind === "release"
      ? knowledgeExport.releaseId
      : null
    : String(releaseId);
  const normalizedReleaseHash = releaseHash == null
    ? null
    : String(releaseHash);
  if (!normalizedReleaseId && !normalizedReleaseHash) {
    throw new Error("Replay exige seleção explícita de release imutável.");
  }
  const candidates = knowledgeExport.releases.filter((release) =>
    (normalizedReleaseId == null || release.id === normalizedReleaseId)
    && (normalizedReleaseHash == null || release.hash === normalizedReleaseHash)
  );
  if (candidates.length !== 1) {
    throw new Error("Release de replay ausente ou ambígua no export autorizado.");
  }
  const release = candidates[0];
  assertKnowledgeContract(release, {
    schemaId: KNOWLEDGE_RELEASE_SCHEMA,
    label: "Knowledge release para replay",
  });
  assertHash(
    bodyWithoutHash(release, "hash"),
    release.hash,
    "Knowledge release",
  );
  if (release.rootScopeId !== knowledgeExport.rootScopeId) {
    throw new Error("Release não pertence ao root scope do export.");
  }
  if (
    knowledgeExport.kind === "release"
    && (
      knowledgeExport.releaseId !== release.id
      || knowledgeExport.releases.length !== 1
    )
  ) {
    throw new Error("Export de release não congela uma única release exata.");
  }
  return release;
}

function exactReleaseItems(knowledgeExport, release) {
  const seen = new Set();
  return release.members.map((member) => {
    if (seen.has(member.id)) {
      throw new Error("Release possui mais de uma revisão do mesmo item.");
    }
    seen.add(member.id);
    const matches = knowledgeExport.items.filter((item) =>
      item.id === member.id && item.revision === member.revision
    );
    if (matches.length !== 1) {
      throw new Error("Release não resolve uma revisão exata e única.");
    }
    const item = matches[0];
    assertKnowledgeContract(item, {
      schemaId: KNOWLEDGE_ITEM_SCHEMA,
      label: "Knowledge item para replay",
    });
    assertHash(
      bodyWithoutHash(item, "contentHash"),
      item.contentHash,
      "Knowledge item",
    );
    if (
      item.rootScopeId !== knowledgeExport.rootScopeId
      || item.recordType !== member.recordType
      || item.schemaId !== member.schemaId
      || item.schemaVersion !== member.schemaVersion
      || item.contentHash !== member.contentHash
    ) {
      throw new Error("Membro da release diverge da revisão congelada.");
    }
    return item;
  });
}

function resolveReplayPath(registry, source) {
  const readersBySchema = new Map(
    registry.readers.map((reader) => [
      schemaKey(reader.schemaId, reader.schemaVersion),
      reader,
    ]),
  );
  const sourceKey = schemaKey(source.schemaId, source.schemaVersion);
  const sourceReader = readersBySchema.get(sourceKey);
  if (!sourceReader) {
    throw new Error(
      `Schema/version de replay desconhecido: ${source.schemaId}.`,
    );
  }
  const path = [];
  const visited = new Set([sourceKey]);
  let currentKey = sourceKey;
  while (true) {
    const outgoing = registry.upcasters.filter((upcaster) =>
      schemaKey(upcaster.fromSchemaId, upcaster.fromSchemaVersion) === currentKey
    );
    if (outgoing.length === 0) break;
    if (outgoing.length !== 1) {
      throw new Error("Cadeia de upcast ambígua; replay bloqueado.");
    }
    const upcaster = outgoing[0];
    const nextKey = schemaKey(
      upcaster.toSchemaId,
      upcaster.toSchemaVersion,
    );
    if (visited.has(nextKey)) {
      throw new Error("Ciclo no registry de upcasters; replay bloqueado.");
    }
    const reader = readersBySchema.get(nextKey);
    if (!reader) {
      throw new Error(
        `Upcaster aponta para schema/version sem reader: ${upcaster.toSchemaId}.`,
      );
    }
    visited.add(nextKey);
    path.push({ upcaster, reader });
    currentKey = nextKey;
  }
  return { sourceReader, path };
}

function replayMember(registry, release, member, item, ordinal) {
  const source = schemaIdentity(
    item.schemaId,
    item.schemaVersion,
    "Knowledge item",
  );
  const { sourceReader, path } = resolveReplayPath(registry, source);
  const originalHash = canonicalHash(item.payload);
  let projected = runDeterministically(
    functionSource(sourceReader.read, `Reader ${sourceReader.hash}`),
    cloneJson(item.payload),
    `Reader ${sourceReader.hash}`,
  );
  const readerHashes = [sourceReader.hash];
  const upcasterHashes = [];
  let target = source;
  for (const { upcaster, reader } of path) {
    projected = runDeterministically(
      functionSource(upcaster.upcast, `Upcaster ${upcaster.hash}`),
      projected,
      `Upcaster ${upcaster.hash}`,
    );
    upcasterHashes.push(upcaster.hash);
    projected = runDeterministically(
      functionSource(reader.read, `Reader ${reader.hash}`),
      projected,
      `Reader ${reader.hash}`,
    );
    readerHashes.push(reader.hash);
    target = {
      schemaId: reader.schemaId,
      schemaVersion: reader.schemaVersion,
    };
  }
  return {
    ordinal,
    memberRefHash: canonicalHash({
      releaseHash: release.hash,
      id: member.id,
      revision: member.revision,
      contentHash: member.contentHash,
    }),
    itemContentHash: item.contentHash,
    sourceSchemaId: source.schemaId,
    sourceSchemaVersion: source.schemaVersion,
    targetSchemaId: target.schemaId,
    targetSchemaVersion: target.schemaVersion,
    originalHash,
    projectedHash: canonicalHash(projected),
    readerHashes,
    upcasterHashes,
  };
}

export function replayAuthorizedKnowledgeExport({
  knowledgeExport,
  registry,
  authorization,
  releaseId = null,
  releaseHash = null,
  clock = () => new Date(),
} = {}) {
  validateExport(knowledgeExport);
  const verifiedRegistry = assertReplayRegistry(registry);
  const release = selectRelease(knowledgeExport, { releaseId, releaseHash });
  const items = exactReleaseItems(knowledgeExport, release);
  const verifiedAuthorization = assertReplayAuthorization({
    authorization,
    knowledgeExport,
    release,
    clock,
  });
  items.forEach((item, ordinal) =>
    assertLocalReplayEligibility(
      item,
      verifiedAuthorization.checkedAt,
      `Release member ${ordinal}`,
    ));
  const members = release.members.map((member, ordinal) =>
    replayMember(verifiedRegistry, release, member, items[ordinal], ordinal)
  );
  const body = {
    schema: KNOWLEDGE_REPLAY_REPORT_SCHEMA,
    sourceExportSchema: knowledgeExport.schema,
    sourceExportHash: knowledgeExport.hash,
    releaseHash: release.hash,
    registryHash: verifiedRegistry.hash,
    authorizationHash: verifiedAuthorization.hash,
    rightsHeadHash: verifiedAuthorization.rightsHeadHash,
    memberCount: members.length,
    members,
  };
  const report = {
    ...body,
    hash: canonicalHash(body),
  };
  assertKnowledgeContract(report, {
    schemaId: KNOWLEDGE_REPLAY_REPORT_SCHEMA,
    label: "Knowledge replay report",
  });
  return deepFreeze(report);
}
