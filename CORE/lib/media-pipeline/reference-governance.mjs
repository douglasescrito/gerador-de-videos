import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { studioLocalPath } from '../studio-local-config.mjs';
import { probeMedia } from "./media-tools.mjs";

export const REFERENCE_INDEX_SCHEMA = "mkt-videos/reference-evidence-index@1";
export const PROVIDER_INPUT_AUTHORIZATION_SCHEMA = "mkt-videos/reference-provider-authorization@1";
export const DEFAULT_REFERENCE_ROOT = studioLocalPath('referenceRoot');
export const DEFAULT_REFERENCE_EXTENSIONS = Object.freeze([".mp4"]);

const DEFAULT_CLASSIFICATION = "inspiration-evidence";
const DEFAULT_USAGE = "local-study-only";
const PROVIDER_INPUT_POLICY = "explicit-authorization-required";

const REFERENCE_INDEX_KEYS = Object.freeze([
  "schema",
  "generatedAt",
  "root",
  "fingerprint",
  "policy",
  "videoCount",
  "videos",
]);
const REFERENCE_INDEX_POLICY_KEYS = Object.freeze([
  "defaultClassification",
  "defaultUsage",
  "providerInput",
  "framesInspected",
  "filesMoved",
  "filesCopied",
  "providerCalls",
]);
const REFERENCE_VIDEO_KEYS = Object.freeze([
  "path",
  "relativePath",
  "sha256",
  "sizeBytes",
  "modifiedAt",
  "media",
  "classification",
  "usage",
  "providerInputPolicy",
]);
const REFERENCE_MEDIA_KEYS = Object.freeze([
  "format",
  "durationSeconds",
  "declaredSizeBytes",
  "bitRate",
  "streams",
]);
const REFERENCE_STREAM_KEYS = Object.freeze([
  "index",
  "type",
  "codec",
  "width",
  "height",
  "frameRate",
  "pixelFormat",
  "colorRange",
  "colorSpace",
  "sampleRate",
  "channels",
]);
const PROVIDER_AUTHORIZATION_KEYS = Object.freeze([
  "schema",
  "issuedAt",
  "actor",
  "decision",
  "purpose",
  "scope",
  "role",
  "operation",
  "reference",
  "constraints",
  "note",
  "id",
]);
const PROVIDER_AUTHORIZATION_REFERENCE_KEYS = Object.freeze([
  "libraryRoot",
  "indexFingerprint",
  "path",
  "relativePath",
  "sha256",
]);
const PROVIDER_AUTHORIZATION_CONSTRAINT_KEYS = Object.freeze(["expiresAt"]);

function requiredText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field} é obrigatório.`);
  return normalized;
}

function normalizedIso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} deve ser uma data válida.`);
  return date.toISOString();
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function integerOrNull(value) {
  const normalized = numberOrNull(value);
  return normalized != null && Number.isInteger(normalized) ? normalized : null;
}

function normalizeRelativePath(value) {
  return String(value).split(path.sep).join("/");
}

function normalizeExtensions(extensions) {
  const values = extensions == null ? DEFAULT_REFERENCE_EXTENSIONS : extensions;
  if (!Array.isArray(values) || values.length === 0) throw new Error("extensions deve conter ao menos uma extensão.");
  return new Set(values.map((value) => {
    const extension = requiredText(value, "extension").toLowerCase();
    return extension.startsWith(".") ? extension : `.${extension}`;
  }));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertExactObject(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} deve ser um objeto.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field} deve ser um objeto simples.`);
  }
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unexpected = actual.filter((key) => !keys.includes(key));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `ausentes: ${missing.join(", ")}` : null,
      unexpected.length ? `inesperados: ${unexpected.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`${field} possui forma incompatível (${details}).`);
  }
  return value;
}

function assertExactText(value, field) {
  if (typeof value !== "string" || value !== value.trim() || !value) {
    throw new Error(`${field} deve ser texto não vazio e sem espaços externos.`);
  }
  return value;
}

function assertSha256(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} é inválido.`);
  }
  return value;
}

function assertNormalizedIso(value, field) {
  if (typeof value !== "string" || normalizedIso(value, field) !== value) {
    throw new Error(`${field} deve usar ISO-8601 normalizado.`);
  }
  return value;
}

function assertNumberOrNull(value, field, { integer = false, minimum = 0 } = {}) {
  if (value === null) return value;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum) {
    throw new Error(`${field} deve ser ${integer ? "inteiro " : ""}finito >= ${minimum} ou null.`);
  }
  return value;
}

function assertNullableText(value, field) {
  if (value === null) return value;
  return assertExactText(value, field);
}

function assertCanonicalAbsolutePath(value, field) {
  const text = assertExactText(value, field);
  if (!path.isAbsolute(text)) throw new Error(`${field} deve ser absoluto.`);
  if (path.resolve(text) !== text) throw new Error(`${field} deve estar normalizado.`);
  return text;
}

function assertRelativePathUnderRoot(root, absolutePath, relativePath, field) {
  const relative = assertExactText(relativePath, `${field}.relativePath`);
  if (normalizeRelativePath(relative) !== relative || path.posix.isAbsolute(relative)) {
    throw new Error(`${field}.relativePath deve ser relativo e normalizado com '/'.`);
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${field}.relativePath não pode escapar da raiz.`);
  }
  const absolute = assertCanonicalAbsolutePath(absolutePath, `${field}.path`);
  const expected = path.resolve(root, ...segments);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || path.isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || !samePath(expected, absolute)) {
    throw new Error(`${field}.path deve corresponder ao relativePath sob a raiz registrada.`);
  }
  return { absolute, relative };
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function listReferenceVideos(root, extensions) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

function normalizeProbe(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const normalizedStreams = streams.map((stream) => ({
    index: integerOrNull(stream?.index),
    type: stream?.codec_type == null ? null : String(stream.codec_type),
    codec: stream?.codec_name == null ? null : String(stream.codec_name),
    width: integerOrNull(stream?.width),
    height: integerOrNull(stream?.height),
    frameRate: stream?.r_frame_rate == null ? null : String(stream.r_frame_rate),
    pixelFormat: stream?.pix_fmt == null ? null : String(stream.pix_fmt),
    colorRange: stream?.color_range == null ? null : String(stream.color_range),
    colorSpace: stream?.color_space == null ? null : String(stream.color_space),
    sampleRate: integerOrNull(stream?.sample_rate),
    channels: integerOrNull(stream?.channels),
  }));
  return {
    format: probe?.format?.format_name == null ? null : String(probe.format.format_name),
    durationSeconds: numberOrNull(probe?.duration ?? probe?.format?.duration),
    declaredSizeBytes: integerOrNull(probe?.format?.size),
    bitRate: integerOrNull(probe?.format?.bit_rate),
    streams: normalizedStreams,
  };
}

function indexFingerprint(root, videos) {
  return sha256Text(stableStringify({
    root,
    videos: videos.map((video) => ({
      relativePath: video.relativePath,
      sha256: video.sha256,
      sizeBytes: video.sizeBytes,
      modifiedAt: video.modifiedAt,
      media: video.media,
    })),
  }));
}

export function validateReferenceIndex(index) {
  assertExactObject(index, REFERENCE_INDEX_KEYS, "index");
  if (index?.schema !== REFERENCE_INDEX_SCHEMA) throw new Error(`Índice de referências incompatível: ${index?.schema ?? "ausente"}.`);
  assertNormalizedIso(index.generatedAt, "index.generatedAt");
  const root = assertCanonicalAbsolutePath(index.root, "index.root");
  assertSha256(index.fingerprint, "index.fingerprint");
  assertExactObject(index.policy, REFERENCE_INDEX_POLICY_KEYS, "index.policy");
  const expectedPolicy = {
    defaultClassification: DEFAULT_CLASSIFICATION,
    defaultUsage: DEFAULT_USAGE,
    providerInput: PROVIDER_INPUT_POLICY,
    framesInspected: false,
    filesMoved: false,
    filesCopied: false,
    providerCalls: 0,
  };
  for (const [field, expected] of Object.entries(expectedPolicy)) {
    if (index.policy[field] !== expected) {
      throw new Error(`index.policy.${field} deve permanecer ${JSON.stringify(expected)}.`);
    }
  }
  if (!Number.isInteger(index.videoCount) || index.videoCount < 0) {
    throw new Error("index.videoCount deve ser um inteiro >= 0.");
  }
  if (!Array.isArray(index.videos)) throw new Error("O índice deve conter videos[].");
  if (index.videoCount !== index.videos.length) {
    throw new Error("index.videoCount deve corresponder a videos.length.");
  }
  const absolutePaths = new Set();
  const relativePaths = new Set();
  for (const [position, video] of index.videos.entries()) {
    const field = `videos[${position}]`;
    assertExactObject(video, REFERENCE_VIDEO_KEYS, field);
    const paths = assertRelativePathUnderRoot(root, video.path, video.relativePath, field);
    const absoluteKey = process.platform === "win32" ? paths.absolute.toLowerCase() : paths.absolute;
    if (absolutePaths.has(absoluteKey) || relativePaths.has(paths.relative)) {
      throw new Error(`${field} duplica um caminho já registrado.`);
    }
    absolutePaths.add(absoluteKey);
    relativePaths.add(paths.relative);
    assertSha256(video.sha256, `${field}.sha256`);
    assertNumberOrNull(video.sizeBytes, `${field}.sizeBytes`, { integer: true });
    if (video.sizeBytes === null) throw new Error(`${field}.sizeBytes não pode ser null.`);
    assertNormalizedIso(video.modifiedAt, `${field}.modifiedAt`);
    assertExactObject(video.media, REFERENCE_MEDIA_KEYS, `${field}.media`);
    assertNullableText(video.media.format, `${field}.media.format`);
    assertNumberOrNull(video.media.durationSeconds, `${field}.media.durationSeconds`);
    assertNumberOrNull(video.media.declaredSizeBytes, `${field}.media.declaredSizeBytes`, { integer: true });
    assertNumberOrNull(video.media.bitRate, `${field}.media.bitRate`, { integer: true });
    if (!Array.isArray(video.media.streams)) throw new Error(`${field}.media.streams deve ser um array.`);
    for (const [streamPosition, stream] of video.media.streams.entries()) {
      const streamField = `${field}.media.streams[${streamPosition}]`;
      assertExactObject(stream, REFERENCE_STREAM_KEYS, streamField);
      for (const key of ["index", "width", "height", "sampleRate", "channels"]) {
        assertNumberOrNull(stream[key], `${streamField}.${key}`, { integer: true });
      }
      for (const key of ["type", "codec", "frameRate", "pixelFormat", "colorRange", "colorSpace"]) {
        assertNullableText(stream[key], `${streamField}.${key}`);
      }
    }
    if (video?.classification !== DEFAULT_CLASSIFICATION || video?.usage !== DEFAULT_USAGE) {
      throw new Error(`videos[${position}] deve permanecer ${DEFAULT_CLASSIFICATION}/${DEFAULT_USAGE}.`);
    }
    if (video?.providerInputPolicy !== PROVIDER_INPUT_POLICY) {
      throw new Error(`videos[${position}] deve exigir autorização explícita para provider-input.`);
    }
  }
  const expectedFingerprint = indexFingerprint(root, index.videos);
  if (index.fingerprint !== expectedFingerprint) {
    throw new Error("index.fingerprint diverge do conteúdo atual do índice.");
  }
  return index;
}

export async function scanReferenceLibrary({
  root = DEFAULT_REFERENCE_ROOT,
  extensions = DEFAULT_REFERENCE_EXTENSIONS,
  probe = probeMedia,
  now = new Date(),
} = {}) {
  const absoluteRoot = path.resolve(requiredText(root, "root"));
  const rootStat = await stat(absoluteRoot);
  if (!rootStat.isDirectory()) throw new Error(`A raiz de referências não é um diretório: ${absoluteRoot}`);
  if (typeof probe !== "function") throw new Error("probe deve ser uma função provider-free.");

  const files = await listReferenceVideos(absoluteRoot, normalizeExtensions(extensions));
  const videos = [];
  for (const file of files) {
    const before = await stat(file);
    const sha256 = await sha256File(file);
    const media = normalizeProbe(await probe(file));
    const after = await stat(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error(`Referência alterada durante a indexação: ${file}`);
    }
    videos.push({
      path: path.resolve(file),
      relativePath: normalizeRelativePath(path.relative(absoluteRoot, file)),
      sha256,
      sizeBytes: after.size,
      modifiedAt: after.mtime.toISOString(),
      media,
      classification: DEFAULT_CLASSIFICATION,
      usage: DEFAULT_USAGE,
      providerInputPolicy: PROVIDER_INPUT_POLICY,
    });
  }

  const generatedAt = normalizedIso(now, "now");
  const index = {
    schema: REFERENCE_INDEX_SCHEMA,
    generatedAt,
    root: absoluteRoot,
    fingerprint: indexFingerprint(absoluteRoot, videos),
    policy: {
      defaultClassification: DEFAULT_CLASSIFICATION,
      defaultUsage: DEFAULT_USAGE,
      providerInput: PROVIDER_INPUT_POLICY,
      framesInspected: false,
      filesMoved: false,
      filesCopied: false,
      providerCalls: 0,
    },
    videoCount: videos.length,
    videos,
  };
  return validateReferenceIndex(index);
}

async function writeJsonExclusive(file, payload) {
  const absolute = path.resolve(requiredText(file, "out"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return absolute;
}

export async function writeReferenceIndex(file, index) {
  validateReferenceIndex(index);
  return writeJsonExclusive(file, index);
}

export async function readReferenceIndex(file) {
  const payload = JSON.parse(await readFile(path.resolve(requiredText(file, "index")), "utf8"));
  return validateReferenceIndex(payload);
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(String(left));
  const normalizedRight = path.resolve(String(right));
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function selectorFrom(reference) {
  if (reference && typeof reference === "object") return reference;
  const value = requiredText(reference, "reference");
  if (/^[a-f0-9]{64}$/i.test(value)) return { sha256: value.toLowerCase() };
  return path.isAbsolute(value) ? { path: value } : { relativePath: normalizeRelativePath(value) };
}

export function resolveReferenceEntry(index, reference) {
  validateReferenceIndex(index);
  const selector = selectorFrom(reference);
  const selectedSha = selector.sha256 == null ? null : String(selector.sha256).toLowerCase();
  const selectedRelative = selector.relativePath == null ? null : normalizeRelativePath(selector.relativePath);
  const matches = index.videos.filter((video) => {
    if (selectedSha && video.sha256 !== selectedSha) return false;
    if (selector.path != null && !samePath(video.path, selector.path)) return false;
    if (selectedRelative && video.relativePath !== selectedRelative) return false;
    return true;
  });
  if (matches.length === 0) throw new Error("Referência não encontrada no índice atual.");
  if (matches.length > 1) throw new Error("Referência ambígua; informe o caminho relativo ou absoluto.");
  return matches[0];
}

export function createProviderInputAuthorization({
  index,
  reference,
  actor,
  scope,
  role,
  operation,
  confirmed = false,
  issuedAt = new Date(),
  expiresAt = null,
  note = null,
} = {}) {
  if (confirmed !== true) throw new Error("A autorização de provider-input exige confirmação explícita.");
  const entry = resolveReferenceEntry(index, reference);
  const normalizedIssuedAt = normalizedIso(issuedAt, "issuedAt");
  const normalizedExpiresAt = expiresAt == null ? null : normalizedIso(expiresAt, "expiresAt");
  if (normalizedExpiresAt && Date.parse(normalizedExpiresAt) <= Date.parse(normalizedIssuedAt)) {
    throw new Error("expiresAt deve ser posterior a issuedAt.");
  }
  const body = {
    schema: PROVIDER_INPUT_AUTHORIZATION_SCHEMA,
    issuedAt: normalizedIssuedAt,
    actor: requiredText(actor, "actor"),
    decision: "explicit",
    purpose: "provider-input",
    scope: requiredText(scope, "scope"),
    role: requiredText(role, "role"),
    operation: requiredText(operation, "operation"),
    reference: {
      libraryRoot: index.root,
      indexFingerprint: index.fingerprint,
      path: entry.path,
      relativePath: entry.relativePath,
      sha256: entry.sha256,
    },
    constraints: {
      expiresAt: normalizedExpiresAt,
    },
    note: note == null ? null : requiredText(note, "note"),
  };
  const authorization = {
    ...body,
    id: `refauth_${sha256Text(stableStringify(body)).slice(0, 24)}`,
  };
  return validateProviderInputAuthorization(authorization);
}

export function validateProviderInputAuthorization(authorization) {
  assertExactObject(authorization, PROVIDER_AUTHORIZATION_KEYS, "authorization");
  if (authorization.schema !== PROVIDER_INPUT_AUTHORIZATION_SCHEMA) {
    throw new Error("Registro de autorização ausente ou incompatível.");
  }
  assertNormalizedIso(authorization.issuedAt, "authorization.issuedAt");
  assertExactText(authorization.actor, "authorization.actor");
  if (authorization.decision !== "explicit" || authorization.purpose !== "provider-input") {
    throw new Error("O registro não contém uma decisão explícita para provider-input.");
  }
  for (const field of ["scope", "role", "operation"]) {
    assertExactText(authorization[field], `authorization.${field}`);
  }
  assertExactObject(
    authorization.reference,
    PROVIDER_AUTHORIZATION_REFERENCE_KEYS,
    "authorization.reference",
  );
  const libraryRoot = assertCanonicalAbsolutePath(
    authorization.reference.libraryRoot,
    "authorization.reference.libraryRoot",
  );
  assertSha256(
    authorization.reference.indexFingerprint,
    "authorization.reference.indexFingerprint",
  );
  assertRelativePathUnderRoot(
    libraryRoot,
    authorization.reference.path,
    authorization.reference.relativePath,
    "authorization.reference",
  );
  assertSha256(authorization.reference.sha256, "authorization.reference.sha256");
  assertExactObject(
    authorization.constraints,
    PROVIDER_AUTHORIZATION_CONSTRAINT_KEYS,
    "authorization.constraints",
  );
  const expiresAt = authorization.constraints.expiresAt;
  if (expiresAt !== null) {
    assertNormalizedIso(expiresAt, "authorization.constraints.expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(authorization.issuedAt)) {
      throw new Error("authorization.constraints.expiresAt deve ser posterior a issuedAt.");
    }
  }
  if (authorization.note !== null) assertExactText(authorization.note, "authorization.note");
  const { id, ...body } = authorization;
  const expectedId = `refauth_${sha256Text(stableStringify(body)).slice(0, 24)}`;
  if (id !== expectedId) {
    throw new Error("authorization.id diverge do corpo atual do registro.");
  }
  return authorization;
}

export function assertProviderInputAuthorized({
  index,
  authorization,
  reference,
  scope = null,
  role = null,
  operation = null,
  now = new Date(),
} = {}) {
  validateProviderInputAuthorization(authorization);
  const entry = resolveReferenceEntry(index, reference);
  if (authorization.reference.indexFingerprint !== index.fingerprint) {
    throw new Error("A autorização não corresponde ao fingerprint atual do índice.");
  }
  if (!samePath(authorization.reference.libraryRoot, index.root)) {
    throw new Error("A autorização não corresponde à raiz atual da biblioteca.");
  }
  if (!samePath(authorization.reference.path, entry.path)
      || authorization.reference.relativePath !== entry.relativePath
      || authorization.reference.sha256 !== entry.sha256) {
    throw new Error("A autorização não corresponde ao caminho e SHA-256 atuais da referência.");
  }
  for (const [field, expected] of [["scope", scope], ["role", role], ["operation", operation]]) {
    if (expected != null && authorization?.[field] !== String(expected)) {
      throw new Error(`A autorização não cobre ${field}=${expected}.`);
    }
  }
  const checkedAt = Date.parse(normalizedIso(now, "now"));
  if (Date.parse(authorization.issuedAt) > checkedAt) {
    throw new Error("A autorização de provider-input ainda não entrou em validade.");
  }
  const expiresAt = authorization.constraints.expiresAt;
  if (expiresAt && Date.parse(expiresAt) <= checkedAt) {
    throw new Error("A autorização de provider-input expirou.");
  }
  return { authorization, reference: entry };
}

export async function writeProviderInputAuthorization(file, authorization) {
  validateProviderInputAuthorization(authorization);
  return writeJsonExclusive(file, authorization);
}

export async function readProviderInputAuthorization(file) {
  const payload = JSON.parse(await readFile(path.resolve(requiredText(file, "authorization")), "utf8"));
  return validateProviderInputAuthorization(payload);
}

export function deriveCreatorIdentifiers(index) {
  validateReferenceIndex(index);
  const identifiers = new Set();
  for (const video of index.videos) {
    const stem = path.parse(video.relativePath).name.replace(/\s+\(\d+\)$/u, "");
    const match = stem.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]{1,63})-\d{10,}$/u);
    if (match) identifiers.add(match[1]);
  }
  return [...identifiers].sort((left, right) => left.localeCompare(right));
}

function foldText(value) {
  return String(value).normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsIdentifier(prompt, identifier) {
  const foldedPrompt = foldText(prompt);
  const foldedIdentifier = foldText(identifier).trim();
  if (!foldedIdentifier) return false;
  const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(foldedIdentifier)}(?=$|[^\\p{L}\\p{N}_])`, "u");
  return expression.test(foldedPrompt);
}

const IMITATION_PHRASES = Object.freeze([
  { code: "imitation-phrase-en", expression: /\bin[\s-]+the[\s-]+style[\s-]+of\b/giu },
  { code: "imitation-phrase-pt", expression: /\bno[\s-]+estilo[\s-]+(?:de|do|da|dos|das)\b/giu },
  { code: "imitation-phrase-pt", expression: /\bao[\s-]+estilo[\s-]+(?:de|do|da|dos|das)\b/giu },
]);

export function lintPromptForImitation(prompt, { creatorNames = [], referenceIndex = null } = {}) {
  const value = requiredText(prompt, "prompt");
  const violations = [];
  for (const rule of IMITATION_PHRASES) {
    rule.expression.lastIndex = 0;
    for (const match of value.matchAll(rule.expression)) {
      violations.push({ code: rule.code, match: match[0], index: match.index });
    }
  }
  const handleExpression = /(^|[^\p{L}\p{N}._%+-])(@[A-Za-z0-9_]{2,30})\b/giu;
  for (const match of value.matchAll(handleExpression)) {
    violations.push({ code: "creator-handle", match: match[2], index: Number(match.index) + match[1].length });
  }
  const identifiers = new Set([
    ...creatorNames.map((name) => requiredText(name, "creatorName")),
    ...(referenceIndex ? deriveCreatorIdentifiers(referenceIndex) : []),
  ]);
  for (const identifier of identifiers) {
    if (containsIdentifier(value, identifier)) {
      violations.push({ code: "creator-name", match: identifier, index: null });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const violation of violations) {
    const key = `${violation.code}\0${foldText(violation.match)}\0${violation.index ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(violation);
    }
  }
  return {
    schema: "mkt-videos/anti-imitation-lint@1",
    valid: unique.length === 0,
    violations: unique,
  };
}

export function assertPromptIsNotImitative(prompt, options = {}) {
  const result = lintPromptForImitation(prompt, options);
  if (!result.valid) {
    const codes = [...new Set(result.violations.map((violation) => violation.code))].join(", ");
    throw new Error(`Prompt rejeitado pela política anti-imitação: ${codes}.`);
  }
  return result;
}
