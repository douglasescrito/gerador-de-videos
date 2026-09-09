import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export const RECEIPT_SCHEMA = "mkt-videos/receipt@1";

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function isoTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida para o recibo.");
  return date.toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digestReceiptBody(body) {
  return createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
}

/**
 * Monta um recibo já assinado por hash.
 *
 * A assinatura vai em JSDoc porque `app/server.ts` é TypeScript e importa este
 * módulo `.mjs`: sem isto, o `tsc` infere o parâmetro só a partir dos defaults e
 * reprova `operation` e `provider`, que são justamente os obrigatórios.
 *
 * @param {object} args
 * @param {string} args.operation
 * @param {string} args.provider
 * @param {string|null} [args.model]
 * @param {string} [args.status]
 * @param {string|null} [args.prompt]
 * @param {Record<string, unknown>} [args.parameters]
 * @param {unknown[]} [args.inputs]
 * @param {unknown[]} [args.artifacts]
 * @param {Record<string, unknown>} [args.providerResponse]
 * @param {unknown} [args.cost]
 * @param {Record<string, unknown>} [args.metadata]
 * @param {unknown} [args.timings]
 * @param {Date|string} [args.startedAt]
 * @param {Date|string} [args.completedAt]
 */
export function createReceipt({
  operation,
  provider,
  model = null,
  status = "completed",
  prompt = null,
  parameters = {},
  inputs = [],
  artifacts = [],
  providerResponse = {},
  cost = null,
  metadata = {},
  timings = null,
  startedAt = new Date(),
  completedAt = new Date(),
} = {}) {
  const body = {
    schema: RECEIPT_SCHEMA,
    operation: requiredText(operation, "operation"),
    provider: requiredText(provider, "provider"),
    model: model ? String(model) : null,
    status: requiredText(status, "status"),
    prompt: prompt == null ? null : String(prompt),
    parameters: structuredClone(parameters ?? {}),
    inputs: structuredClone(inputs ?? []),
    artifacts: structuredClone(artifacts ?? []),
    providerResponse: structuredClone(providerResponse ?? {}),
    cost: cost == null ? null : structuredClone(cost),
    metadata: structuredClone(metadata ?? {}),
    ...(timings == null ? {} : { timings: structuredClone(timings) }),
    startedAt: isoTimestamp(startedAt),
    completedAt: isoTimestamp(completedAt),
  };
  const digest = digestReceiptBody(body);
  return {
    ...body,
    id: `receipt:sha256:${digest}`,
    hash: { algorithm: "sha256", value: digest },
  };
}

export function verifyReceipt(receipt) {
  const errors = [];
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) errors.push("Contrato de recibo inválido.");
  if (!receipt?.hash?.value || receipt.hash.algorithm !== "sha256") errors.push("Recibo sem hash SHA-256 válido.");
  if (errors.length) return { valid: false, errors };
  const { id, hash, ...body } = receipt;
  const digest = digestReceiptBody(body);
  if (hash.value !== digest) errors.push("Hash SHA-256 do recibo divergente.");
  if (id !== `receipt:sha256:${digest}`) errors.push("Identificador do recibo divergente.");
  return { valid: errors.length === 0, errors };
}

export function receiptPathForArtifact(file) {
  return `${path.resolve(requiredText(file, "file"))}.receipt.json`;
}

export async function writeReceipt(file, receipt) {
  const validation = verifyReceipt(receipt);
  if (!validation.valid) throw new Error(`Recibo inválido: ${validation.errors.join(" ")}`);
  const absolute = path.resolve(requiredText(file, "file"));
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, absolute);
    try {
      const directory = await open(path.dirname(absolute), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (!new Set(["EPERM", "EISDIR", "EINVAL", "ENOTSUP"]).has(error?.code)) throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

export async function readReceipt(file, { verify = true } = {}) {
  const absolute = path.resolve(requiredText(file, "file"));
  const receipt = JSON.parse(await readFile(absolute, "utf8"));
  if (verify) {
    const validation = verifyReceipt(receipt);
    if (!validation.valid) throw new Error(`Recibo inválido: ${validation.errors.join(" ")}`);
  }
  return receipt;
}
