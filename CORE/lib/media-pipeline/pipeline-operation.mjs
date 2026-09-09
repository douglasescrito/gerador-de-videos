import { createHash, randomUUID } from "node:crypto";
import { copyFile, link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReceipt, verifyReceipt, writeReceipt } from "./receipt.mjs";
import { currentExecutionTiming, measureExecutionPhase } from "./execution-timing.mjs";

export const PIPELINE_MODES = new Set(["raw", "studio"]);

export function normalizePipelineMode(value = "raw") {
  const mode = String(value ?? "raw").trim().toLowerCase();
  if (!PIPELINE_MODES.has(mode)) throw new Error(`Modo inválido: ${mode}. Use raw ou studio.`);
  return mode;
}

export function requireStudioMode(mode, feature) {
  const normalized = normalizePipelineMode(mode);
  if (normalized !== "studio") {
    throw new Error(`${feature} exige --mode studio. O modo raw preserva o fluxo Omni sem composição nem pós-processamento.`);
  }
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function operationFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export async function pathExists(file) {
  try {
    await lstat(path.resolve(file));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function assertPathAvailable(file, label = "Saída") {
  const absolute = path.resolve(String(file));
  if (await pathExists(absolute)) throw new Error(`${label} já existe e não será sobrescrita: ${absolute}`);
  return absolute;
}

function temporaryPath(target, suffix = "tmp") {
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.${suffix}`);
}

async function publishExclusive(temporary, target, label) {
  try {
    await link(temporary, target);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} já existe e não será sobrescrito: ${target}`);
    throw error;
  }
}

export async function commitTemporaryFile(temporary, target, { label = "Arquivo", preserveOnFailure = false } = {}) {
  return measureExecutionPhase("publication", async () => {
  const absoluteTemporary = path.resolve(String(temporary));
  const absoluteTarget = await assertPathAvailable(target, label);
  await mkdir(path.dirname(absoluteTarget), { recursive: true });
  let published = false;
  try {
    await publishExclusive(absoluteTemporary, absoluteTarget, label);
    published = true;
  } finally {
    if (published || !preserveOnFailure) await rm(absoluteTemporary, { force: true });
  }
  return absoluteTarget;
  });
}

export async function writeFileAtomic(file, data, { label = "Arquivo", encoding = null } = {}) {
  return measureExecutionPhase("publication", async () => {
  const target = await assertPathAvailable(file, label);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  try {
    await writeFile(temporary, data, { flag: "wx", ...(encoding ? { encoding } : {}) });
    await assertPathAvailable(target, label);
    await publishExclusive(temporary, target, label);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
  });
}

export async function writeJsonAtomic(file, value, { label = "JSON" } = {}) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { label, encoding: "utf8" });
}

export async function replaceFileAtomic(file, data, { label = "Estado", encoding = null } = {}) {
  const target = path.resolve(String(file));
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  try {
    await writeFile(temporary, data, { flag: "wx", ...(encoding ? { encoding } : {}) });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}

export async function replaceJsonAtomic(file, value, { label = "Estado" } = {}) {
  return replaceFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { label, encoding: "utf8" });
}

export async function copyFileAtomic(source, target, { label = "Arquivo" } = {}) {
  return measureExecutionPhase("publication", async () => {
  const absoluteSource = path.resolve(String(source));
  const absoluteTarget = await assertPathAvailable(target, label);
  await mkdir(path.dirname(absoluteTarget), { recursive: true });
  const temporary = temporaryPath(absoluteTarget);
  try {
    await copyFile(absoluteSource, temporary);
    await assertPathAvailable(absoluteTarget, label);
    await publishExclusive(temporary, absoluteTarget, label);
  } finally {
    await rm(temporary, { force: true });
  }
  return absoluteTarget;
  });
}

export function createStageReceipt({
  operation,
  provider,
  model = null,
  mode = "studio",
  stage,
  prompt = null,
  parameters = {},
  inputs = [],
  artifacts = [],
  providerResponse = {},
  cost = null,
  metadata = {},
  timings = null,
  parentReceipts = [],
  startedAt = new Date(),
  completedAt = new Date(),
} = {}) {
  const normalizedMode = normalizePipelineMode(mode);
  const requestedPipeline = metadata?.pipeline && typeof metadata.pipeline === "object" ? metadata.pipeline : {};
  const parents = [...new Set([...(parentReceipts ?? []), ...(requestedPipeline.parentReceiptIds ?? [])].map((value) => String(value).trim()).filter(Boolean))];
  const effectiveStage = String(requestedPipeline.stage ?? stage ?? operation);
  const metadataWithoutPipeline = { ...structuredClone(metadata ?? {}) };
  delete metadataWithoutPipeline.pipeline;
  const executionTiming = currentExecutionTiming();
  return createReceipt({
    operation,
    provider,
    model,
    prompt,
    parameters: { ...structuredClone(parameters ?? {}), mode: normalizedMode },
    inputs,
    artifacts,
    providerResponse,
    cost,
    metadata: {
      ...metadataWithoutPipeline,
      ...(executionTiming ? { executionTiming: { coverage: "until-receipt-construction", measurement: executionTiming } } : {}),
      pipeline: {
        ...structuredClone(requestedPipeline),
        stage: effectiveStage,
        parentReceiptIds: parents,
        fingerprint: operationFingerprint({ operation, provider, model, mode: normalizedMode, stage: effectiveStage, prompt, parameters, inputs: inputs.map((item) => item?.id ?? item?.file ?? item) }),
      },
    },
    timings,
    startedAt,
    completedAt,
  });
}

export async function writeStageReceipt(file, receipt) {
  await assertPathAvailable(file, "Recibo");
  const written = await measureExecutionPhase("publication", () => writeReceipt(file, receipt));
  const parsed = path.parse(written);
  const segments = written.slice(parsed.root.length).split(path.sep);
  const outputsIndex = segments.map((segment) => segment.toLowerCase()).lastIndexOf("outputs");
  if (outputsIndex >= 0) {
    const outputsRoot = path.join(parsed.root, ...segments.slice(0, outputsIndex + 1));
    try {
      const { upsertArchiveReceipt } = await import("./archive-index.mjs");
      await upsertArchiveReceipt({ root: outputsRoot, dbFile: path.join(outputsRoot, "archive.sqlite"), receiptFile: written });
    } catch (error) {
      process.emitWarning(`Índice incremental do acervo não foi atualizado: ${String(error?.message ?? error).replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]").slice(0, 300)}`);
    }
  }
  return written;
}

export async function readVerifiedReceipt(file) {
  const absolute = path.resolve(String(file));
  const receipt = JSON.parse(await readFile(absolute, "utf8"));
  const validation = verifyReceipt(receipt);
  if (!validation.valid) throw new Error(`Recibo inválido em ${absolute}: ${validation.errors.join(" ")}`);
  return receipt;
}
