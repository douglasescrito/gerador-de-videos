import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { readReceipt, verifyReceipt } from "./receipt.mjs";

export const PRODUCTION_MANIFEST_SCHEMA = "mkt-videos/production-manifest@1";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^preq_[a-f0-9]{32}$/u;
const LINKAGES = new Set(["verified", "legacy"]);
const ARTIFACT_ROLES = new Set(["master", "derivative", "reference"]);
const RELATIVE_PATH = /^[^\0]+$/u;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser objeto.`);
  return value;
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function assertNullableId(value, label) {
  return value == null ? null : assertId(value, label);
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} deve ser SHA-256 hexadecimal.`);
  return value;
}

function assertNullableHash(value, label) {
  return value == null ? null : assertHash(value, label);
}

function assertRelPath(value, label) {
  const normalized = String(value ?? "");
  // Caminho relativo já resolvido pelo chamador (dentro do outputsRoot); esta
  // função só garante que é texto não vazio e sem NUL — a resolução/contenção
  // real acontece em quem grava o manifesto (resolveInsideRoot já existente).
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("\\") || /^[A-Za-z]:/u.test(normalized) || !RELATIVE_PATH.test(normalized)) {
    throw new Error(`${label} deve ser um caminho relativo não vazio.`);
  }
  return normalized;
}

function assertRequestRef(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "requestId" && key !== "requestHash");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (!REQUEST_ID.test(value.requestId)) throw new Error(`${label}.requestId inválido.`);
  return { requestId: value.requestId, requestHash: assertHash(value.requestHash, `${label}.requestHash`) };
}

function assertRecipeTemplateRef(value, label) {
  if (value == null) return null;
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["templateId", "templateRevision", "templateHash"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  const templateRevision = Number(value.templateRevision);
  if (!Number.isInteger(templateRevision) || templateRevision < 1) throw new Error(`${label}.templateRevision deve ser inteiro positivo.`);
  return {
    templateId: assertId(value.templateId, `${label}.templateId`),
    templateRevision,
    templateHash: assertHash(value.templateHash, `${label}.templateHash`),
  };
}

function assertArtifact(value, label) {
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["relPath", "sha256", "role", "kind"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (!ARTIFACT_ROLES.has(value.role)) throw new Error(`${label}.role inválido.`);
  return {
    relPath: assertRelPath(value.relPath, `${label}.relPath`),
    sha256: assertHash(value.sha256, `${label}.sha256`),
    role: value.role,
    kind: String(value.kind ?? "").trim() || (() => { throw new Error(`${label}.kind é obrigatório.`); })(),
  };
}

function assertReceiptEntry(value, label) {
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => !["relPath", "receiptRelPath", "receiptId", "valid", "verifiedAt"].includes(key));
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  if (typeof value.valid !== "boolean") throw new Error(`${label}.valid deve ser booleano.`);
  if (typeof value.verifiedAt !== "string" || Number.isNaN(Date.parse(value.verifiedAt))) {
    throw new Error(`${label}.verifiedAt deve ser timestamp ISO-8601.`);
  }
  return {
    relPath: assertRelPath(value.relPath, `${label}.relPath`),
    receiptRelPath: assertRelPath(value.receiptRelPath, `${label}.receiptRelPath`),
    receiptId: String(value.receiptId ?? "").trim() || (() => { throw new Error(`${label}.receiptId é obrigatório.`); })(),
    valid: value.valid,
    verifiedAt: value.verifiedAt,
  };
}

function assertDeliverable(value, label) {
  assertObject(value, label);
  const extraKeys = Object.keys(value).filter((key) => key !== "relPath" && key !== "kind");
  if (extraKeys.length) throw new Error(`${label} possui campos não reconhecidos: ${extraKeys.join(", ")}.`);
  return {
    relPath: assertRelPath(value.relPath, `${label}.relPath`),
    kind: String(value.kind ?? "").trim() || (() => { throw new Error(`${label}.kind é obrigatório.`); })(),
  };
}

// runs reusa a projeção já existente de generation-attempt@1
// (production-order-projection.mjs) como passthrough — o manifesto não
// reimplementa o modelo de retry/reconcile, só o carrega.
function assertRun(value, label) {
  assertObject(value, label);
  if (value.schema !== "mkt-videos/generation-attempt@1") throw new Error(`${label}.schema deve ser mkt-videos/generation-attempt@1.`);
  if (!value.itemId || !value.attemptId || !value.state) {
    throw new Error(`${label} exige itemId, attemptId e state.`);
  }
  return clone(value);
}

function validatedBody({
  rootScopeId,
  projectId = null,
  campaignId = null,
  productionId,
  deliverableId = null,
  linkage,
  requestRef = null,
  contextBindingHash = null,
  planFingerprint = null,
  executionId = null,
  recipeTemplateRef = null,
  artifacts = [],
  runs = [],
  receipts = [],
  deliverables = [],
  materializedAt,
} = {}) {
  if (!LINKAGES.has(linkage)) throw new Error("linkage deve ser verified ou legacy.");
  const bindingFields = [requestRef, contextBindingHash, planFingerprint, executionId];
  if (linkage === "verified" && bindingFields.some((field) => field == null)) {
    throw new Error("linkage verified exige requestRef, contextBindingHash, planFingerprint e executionId.");
  }
  if (linkage === "legacy" && bindingFields.some((field) => field != null)) {
    throw new Error("linkage legacy não pode carregar requestRef/contextBindingHash/planFingerprint/executionId — vínculo por nome/pasta nunca é verificado.");
  }
  if (typeof materializedAt !== "string" || Number.isNaN(Date.parse(materializedAt))) {
    throw new Error("materializedAt deve ser timestamp ISO-8601.");
  }
  return {
    schema: PRODUCTION_MANIFEST_SCHEMA,
    rootScopeId: assertId(rootScopeId, "rootScopeId"),
    projectId: assertNullableId(projectId, "projectId"),
    campaignId: assertNullableId(campaignId, "campaignId"),
    productionId: assertId(productionId, "productionId"),
    deliverableId: assertNullableId(deliverableId, "deliverableId"),
    linkage,
    requestRef: assertRequestRef(requestRef, "requestRef"),
    contextBindingHash: assertNullableHash(contextBindingHash, "contextBindingHash"),
    planFingerprint: assertNullableHash(planFingerprint, "planFingerprint"),
    executionId: assertNullableId(executionId, "executionId"),
    recipeTemplateRef: assertRecipeTemplateRef(recipeTemplateRef, "recipeTemplateRef"),
    artifacts: (Array.isArray(artifacts) ? artifacts : (() => { throw new Error("artifacts deve ser lista."); })())
      .map((entry, index) => assertArtifact(entry, `artifacts[${index}]`)),
    runs: (Array.isArray(runs) ? runs : (() => { throw new Error("runs deve ser lista."); })())
      .map((entry, index) => assertRun(entry, `runs[${index}]`)),
    receipts: (Array.isArray(receipts) ? receipts : (() => { throw new Error("receipts deve ser lista."); })())
      .map((entry, index) => assertReceiptEntry(entry, `receipts[${index}]`)),
    deliverables: (Array.isArray(deliverables) ? deliverables : (() => { throw new Error("deliverables deve ser lista."); })())
      .map((entry, index) => assertDeliverable(entry, `deliverables[${index}]`)),
    materializedAt,
  };
}

/**
 * Constrói a projeção production-manifest@1 (plano §5.4): cliente/projeto/
 * produção/receita/plano/tentativa/recibo, materializada exclusivamente pelo
 * CLI. linkage "verified" exige a cadeia completa de bindings; "legacy" a
 * proíbe por completo — nunca um meio-termo por nome de pasta.
 */
export function buildProductionManifest(input = {}) {
  const body = validatedBody(input);
  return { ...body, hash: operationFingerprint(body) };
}

export function assertProductionManifest(value, { label = "production-manifest@1" } = {}) {
  assertObject(value, label);
  if (value.schema !== PRODUCTION_MANIFEST_SCHEMA) throw new Error(`${label}.schema inválido.`);
  const body = validatedBody(value);
  assertHash(value.hash, `${label}.hash`);
  const expected = operationFingerprint(body);
  if (value.hash !== expected) throw new Error(`${label} diverge do manifesto canônico.`);
  return clone(value);
}

/**
 * Verifica cada recibo de verdade via verifyReceipt (nunca reimplementa a
 * regra de hash) e projeta a entrada sanitizada para o manifesto.
 */
export async function buildReceiptEntry({ outputsRoot, relPath, receiptRelPath }) {
  const receipt = await readReceipt(path.join(outputsRoot, receiptRelPath), { verify: false });
  const { valid } = verifyReceipt(receipt);
  return {
    relPath,
    receiptRelPath,
    receiptId: receipt.id,
    valid,
    verifiedAt: new Date().toISOString(),
  };
}

export async function writeProductionManifest(outputsRoot, productionDir, manifest) {
  const validated = assertProductionManifest(manifest);
  const absoluteDir = path.resolve(outputsRoot, productionDir);
  if (!absoluteDir.startsWith(path.resolve(outputsRoot))) {
    throw new Error("productionDir escapa de outputsRoot.");
  }
  await mkdir(absoluteDir, { recursive: true });
  const absolute = path.join(absoluteDir, "production-manifest.json");
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, absolute);
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

export async function readProductionManifest(outputsRoot, productionDir) {
  const absolute = path.join(path.resolve(outputsRoot), productionDir, "production-manifest.json");
  const manifest = JSON.parse(await readFile(absolute, "utf8"));
  return assertProductionManifest(manifest);
}
