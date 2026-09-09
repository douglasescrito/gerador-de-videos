import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_SCHEMA = "mkt-videos/artifact@1";

const MIME_BY_EXTENSION = Object.freeze({
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".3gp": "video/3gpp",
  ".avi": "video/avi",
  ".flv": "video/x-flv",
  ".mov": "video/mov",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".wmv": "video/wmv",
});

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function isoTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida para o artefato.");
  return date.toISOString();
}

export function inferMimeType(file, fallback = "application/octet-stream") {
  return MIME_BY_EXTENSION[path.extname(String(file)).toLowerCase()] ?? fallback;
}

export function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(file) {
  const absolute = path.resolve(requiredText(file, "file"));
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolute);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * @param {{
 *   file: string,
 *   kind: string,
 *   role?: string|null,
 *   mimeType?: string|null,
 *   source?: Record<string, unknown>,
 *   metadata?: Record<string, unknown>,
 *   createdAt?: Date|string
 * }} options
 */
export async function createArtifactFromFile({
  file,
  kind,
  role = null,
  mimeType = null,
  source = {},
  metadata = {},
  createdAt = new Date(),
}) {
  const absolute = path.resolve(requiredText(file, "file"));
  const normalizedKind = requiredText(kind, "kind");
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`O artefato não é um arquivo: ${absolute}`);
  const digest = await sha256File(absolute);
  return {
    schema: ARTIFACT_SCHEMA,
    id: `sha256:${digest}`,
    kind: normalizedKind,
    role: role ? String(role) : normalizedKind,
    file: absolute,
    name: path.basename(absolute),
    mimeType: mimeType ?? inferMimeType(absolute),
    bytes: info.size,
    hash: { algorithm: "sha256", value: digest },
    createdAt: isoTimestamp(createdAt),
    source: structuredClone(source ?? {}),
    metadata: structuredClone(metadata ?? {}),
  };
}

export async function createArtifactFromKnownFile({
  file,
  kind,
  role = null,
  mimeType = null,
  bytes,
  digest,
  source = {},
  metadata = {},
  createdAt = new Date(),
} = {}) {
  const absolute = path.resolve(requiredText(file, "file"));
  const normalizedKind = requiredText(kind, "kind");
  const normalizedDigest = String(digest ?? "").trim().toLowerCase();
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("bytes deve ser um inteiro não negativo.");
  if (!/^[a-f0-9]{64}$/.test(normalizedDigest)) throw new Error("digest deve ser um SHA-256 hexadecimal válido.");

  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`O artefato não é um arquivo: ${absolute}`);
  if (info.size !== bytes) throw new Error(`Tamanho divergente após a gravação: esperado ${bytes}, encontrado ${info.size}.`);
  const actualDigest = await sha256File(absolute);
  if (actualDigest !== normalizedDigest) throw new Error(`Hash divergente após a gravação: esperado ${normalizedDigest}, encontrado ${actualDigest}.`);
  return {
    schema: ARTIFACT_SCHEMA,
    id: `sha256:${normalizedDigest}`,
    kind: normalizedKind,
    role: role ? String(role) : normalizedKind,
    file: absolute,
    name: path.basename(absolute),
    mimeType: mimeType ?? inferMimeType(absolute),
    bytes,
    hash: { algorithm: "sha256", value: normalizedDigest },
    createdAt: isoTimestamp(createdAt),
    source: structuredClone(source ?? {}),
    metadata: structuredClone(metadata ?? {}),
  };
}

export async function verifyArtifact(artifact) {
  const errors = [];
  if (!artifact || artifact.schema !== ARTIFACT_SCHEMA) errors.push("Contrato de artefato inválido.");
  if (!artifact?.file) errors.push("Artefato sem arquivo.");
  if (!artifact?.hash?.value || artifact.hash.algorithm !== "sha256") errors.push("Artefato sem hash SHA-256 válido.");
  if (artifact?.hash?.value && artifact.id !== `sha256:${artifact.hash.value}`) errors.push("Identificador do artefato divergente.");
  if (errors.length) return { valid: false, errors };

  try {
    const info = await stat(artifact.file);
    if (!info.isFile()) errors.push("O caminho do artefato não é um arquivo.");
    if (info.size !== artifact.bytes) errors.push(`Tamanho divergente: esperado ${artifact.bytes}, encontrado ${info.size}.`);
    const digest = await sha256File(artifact.file);
    if (digest !== artifact.hash.value) errors.push("Hash SHA-256 divergente.");
  } catch (error) {
    errors.push(`Não foi possível ler o artefato: ${error.message}`);
  }
  return { valid: errors.length === 0, errors };
}
