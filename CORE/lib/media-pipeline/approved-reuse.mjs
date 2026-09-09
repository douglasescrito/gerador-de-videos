import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { commitTemporaryFile, copyFileAtomic, createStageReceipt, pathExists, readVerifiedReceipt, writeStageReceipt } from "./pipeline-operation.mjs";
import { normalizeReusePolicy, recipeFromReceipt } from "./recipe.mjs";

export const REUSE_RECEIPT_SCHEMA = "mkt-videos/reuse-artifact@1";

function approvedRow(dbFile, receiptFile, binding) {
  const db = new DatabaseSync(path.resolve(dbFile), { readOnly: true });
  try {
    // O índice editorial só é consultado para um candidato autorizado no root.
    return db.prepare(`SELECT r.id FROM receipts r JOIN reviews v ON v.receipt_path=r.path
      WHERE r.path=? AND r.recipe_hash=? AND r.receipt_hash=? AND v.status='approved'
      AND v.receipt_id=r.id AND (r.valid IS NULL OR r.valid=1)`).get(path.resolve(receiptFile), binding.recipeHash, binding.receiptHash);
  } finally { db.close(); }
}

function assertCandidate(candidate) {
  const binding = candidate?.binding;
  if (!candidate?.asset || !path.isAbsolute(String(candidate.receiptFile ?? "")) ||
      binding?.schema !== "mkt-videos/approved-reuse-binding@1" ||
      !/^[a-f0-9]{64}$/.test(binding.recipeHash ?? "") || !/^[a-f0-9]{64}$/.test(binding.receiptHash ?? "") ||
      !binding.artifactRole || !binding.consumer?.id || !binding.consumer?.version ||
      Object.keys(binding).some((key) => !["schema", "recipeHash", "receiptHash", "artifactRole", "consumer"].includes(key)) ||
      Object.keys(binding.consumer).some((key) => !["id", "version"].includes(key))) throw new Error("Candidato de reuso exige asset governado, recibo absoluto e approved-reuse-binding@1 completo.");
}

function miss(policy, reason) {
  if (policy === "require-approved") throw new Error(`Nenhum artefato aprovado e íntegro para reuso obrigatório (${reason}).`);
  return { hit: false, policy, reason };
}

export function createApprovedReuseRuntime({ context, authorizeLocalAssets }) {
  const config = structuredClone(context);
  if (!config?.rootScopeId || !config.reuse || !path.isAbsolute(String(config.reuse.dbFile ?? "")) ||
      !Array.isArray(config.reuse.candidates) || config.reuse.candidates.length > 256 ||
      Object.keys(config.reuse).some((key) => !["dbFile", "candidates"].includes(key)) || typeof authorizeLocalAssets !== "function") throw new Error("asset-context.reuse exige dbFile absoluto e até 256 candidatos governados.");
  for (const candidate of config.reuse.candidates) assertCandidate(candidate);
  const assertRoot = (request) => {
    if (request.rootScopeId !== config.rootScopeId) throw new Error("Contexto de reuso diverge do root da produção.");
    if (request.dbFile != null && path.resolve(request.dbFile) !== path.resolve(config.reuse.dbFile)) throw new Error("Índice de reuso diverge do asset-context.");
  };
  const runtime = async (request) => {
    assertRoot(request);
    return reuseApprovedArtifact({ ...request, dbFile: config.reuse.dbFile, candidates: config.reuse.candidates, authorizeLocalAssets });
  };
  runtime.rootScopeId = config.rootScopeId;
  runtime.validate = async ({ receipt, ...request }) => {
    assertRoot(request);
    const recorded = receipt.metadata?.approvedReuse;
    const candidate = config.reuse.candidates.find((entry) => isDeepStrictEqual(entry.binding, recorded?.binding) && isDeepStrictEqual(entry.asset, recorded?.asset));
    if (!candidate || candidate.binding.recipeHash !== request.recipe?.hash || candidate.binding.artifactRole !== request.artifactRole || !isDeepStrictEqual(candidate.binding.consumer, request.consumer)) throw new Error("Retomada diverge da receita, versão ou candidato de reuso aprovado.");
    await authorizeLocalAssets({ rootScopeId: config.rootScopeId, assets: [candidate.asset], reuseBinding: candidate.binding });
    if (!approvedRow(config.reuse.dbFile, candidate.receiptFile, candidate.binding) || (await readVerifiedReceipt(candidate.receiptFile)).hash.value !== candidate.binding.receiptHash) throw new Error("Aprovação ou recibo de origem mudou antes da retomada.");
  };
  return Object.freeze(runtime);
}

/** Copia apenas material aprovado no repository e no índice editorial existentes. */
export async function reuseApprovedArtifact({ policy = "off", dbFile, recipe, outputFile, receiptFile = `${outputFile}.receipt.json`, artifactRole = null,
  rootScopeId = null, consumer = null, candidates = [], authorizeLocalAssets = null, executionConsumer = null } = {}) {
  const normalizedPolicy = normalizeReusePolicy(policy);
  if (normalizedPolicy === "off") return { hit: false, policy: normalizedPolicy, reason: "disabled" };
  if (!/^[a-f0-9]{64}$/.test(recipe?.hash ?? "")) throw new Error("Reuso exige recipe@2 com hash.");
  if (!rootScopeId || typeof authorizeLocalAssets !== "function" || !consumer?.id || !consumer?.version || !artifactRole) throw new Error("Reuso exige root, autorização vigente, papel exato e consumidor versionado; informe --asset-context.");
  if (executionConsumer != null && !isDeepStrictEqual(executionConsumer, consumer)) throw new Error("Consumidor da execução diverge da chave de reuso.");
  if (await pathExists(outputFile)) throw new Error(`Destino de reuso já existe: ${path.resolve(outputFile)}.`);
  if (await pathExists(receiptFile)) throw new Error(`Recibo de reuso já existe: ${path.resolve(receiptFile)}.`);
  if (!dbFile || !(await pathExists(dbFile))) return miss(normalizedPolicy, "index_missing");
  for (const candidate of candidates) {
    assertCandidate(candidate);
    const { binding, asset } = candidate;
    if (binding.recipeHash !== recipe.hash || binding.artifactRole !== artifactRole || !isDeepStrictEqual(binding.consumer, consumer)) continue;
    const authorize = async () => {
      const [authorized] = await authorizeLocalAssets({ rootScopeId, assets: [asset], reuseBinding: binding });
      if (!authorized?.file || authorized.evidence?.rootScopeId !== rootScopeId || authorized.evidence.sha256 !== asset.sha256 || authorized.evidence.bytes !== asset.bytes) throw new Error("Autorização de reuso não cobre o asset exato.");
      return authorized;
    };
    // Revogação/expiração não vira miss silencioso seguido de trabalho novo.
    const authorized = await authorize();
    if (!approvedRow(dbFile, candidate.receiptFile, binding)) continue;
    let sourceReceipt;
    let source;
    try {
      sourceReceipt = await readVerifiedReceipt(candidate.receiptFile);
      if (sourceReceipt.hash.value !== binding.receiptHash || recipeFromReceipt(sourceReceipt).hash !== recipe.hash || !isDeepStrictEqual(sourceReceipt.parameters?.consumer, consumer)) continue;
      const matches = (sourceReceipt.artifacts ?? []).filter((entry) => entry.role === artifactRole && entry.hash?.value === asset.sha256 && entry.bytes === asset.bytes && entry.mimeType === asset.mimeType);
      if (matches.length !== 1) continue;
      source = { ...matches[0], file: authorized.file };
      if (!(await verifyArtifact(source)).valid) continue;
    } catch { continue; }
    const temporary = path.join(path.dirname(path.resolve(outputFile)), `.reuse-${randomUUID()}${path.extname(outputFile)}`);
    let published = false;
    try {
      await copyFileAtomic(authorized.file, temporary, { label: "Preparação de reuso" });
      if (!(await verifyArtifact({ ...source, file: temporary })).valid) throw new Error("Cópia de reuso diverge dos bytes autorizados.");
      const refreshed = await authorize();
      if (!approvedRow(dbFile, candidate.receiptFile, binding) || (await readVerifiedReceipt(candidate.receiptFile)).hash.value !== binding.receiptHash) throw new Error("Aprovação ou recibo de origem mudou antes da publicação.");
      await commitTemporaryFile(temporary, outputFile, { label: "Artefato reutilizado" });
      published = true;
      const artifact = await createArtifactFromFile({ file: outputFile, kind: source.kind, role: artifactRole, source: { provider: "approved-reuse", receiptId: sourceReceipt.id, artifactId: source.id } });
      if (artifact.hash.value !== asset.sha256 || artifact.bytes !== asset.bytes) throw new Error("Artefato publicado diverge do conteúdo autorizado.");
      const receipt = createStageReceipt({ operation: "reuse-artifact", provider: "local-approved-archive", stage: "reuse",
        parameters: { policy: normalizedPolicy, recipeHash: recipe.hash, consumer, copyMode: "atomic-copy" }, inputs: [source], artifacts: [artifact], parentReceipts: [sourceReceipt.id],
        metadata: { schema: REUSE_RECEIPT_SCHEMA, sourceReceipt: candidate.receiptFile, sourceArtifact: source.id, integrityVerified: true,
          approvedReuse: { binding, asset, authorization: refreshed.evidence }, avoidedOperation: executionConsumer?.id ?? null, avoidedProviderPost: false } });
      await writeStageReceipt(receiptFile, receipt);
      return { hit: true, policy: normalizedPolicy, file: path.resolve(outputFile), receiptFile: path.resolve(receiptFile), receipt, sourceReceipt: candidate.receiptFile, zeroPost: true };
    } catch (error) {
      if (published) await rm(path.resolve(outputFile), { force: true });
      throw error;
    } finally { await rm(temporary, { force: true }); }
  }
  return miss(normalizedPolicy, "no_approved_integral_hit");
}
