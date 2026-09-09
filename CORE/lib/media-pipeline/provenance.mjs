import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { runCommand } from "./media-tools.mjs";
import { commitTemporaryFile, createStageReceipt, operationFingerprint, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";

export const PROVENANCE_MANIFEST_SCHEMA = "mkt-videos/provenance-manifest@1";
export const C2PA_DELIVERY_SCHEMA = "mkt-videos/c2pa-delivery@1";

export async function createProvenanceManifest({ masterFile, receiptIds = [], outputFile, timelineFingerprint = null, c2pa = false } = {}) {
  if (c2pa) throw new Error("Assinatura C2PA não está configurada; não será simulada por um manifesto JSON.");
  const artifact = await createArtifactFromFile({ file: path.resolve(String(masterFile)), kind: "video", role: "provenance-master" });
  const body = {
    schema: PROVENANCE_MANIFEST_SCHEMA,
    claim: "declared-technical-provenance",
    c2paSigned: false,
    limitation: "Este manifesto declara origem técnica e cadeia de recibos; não prova verdade, qualidade estética ou consentimento.",
    master: artifact,
    receiptIds: [...new Set(receiptIds.map(String))],
    timelineFingerprint: timelineFingerprint == null ? null : String(timelineFingerprint),
    createdAt: new Date().toISOString(),
  };
  const manifest = { ...body, fingerprint: operationFingerprint(body) };
  await writeJsonAtomic(outputFile, manifest, { label: "Manifesto de proveniência" });
  return { file: path.resolve(outputFile), manifest };
}

export async function verifyProvenanceManifest(file) {
  const manifest = JSON.parse(await readFile(path.resolve(String(file)), "utf8"));
  if (manifest.schema !== PROVENANCE_MANIFEST_SCHEMA) return { valid: false, errors: ["schema_invalid"] };
  const { fingerprint, ...body } = manifest;
  const errors = [];
  if (operationFingerprint(body) !== fingerprint) errors.push("manifest_fingerprint_mismatch");
  const artifact = await verifyArtifact(manifest.master);
  if (!artifact.valid) errors.push(...artifact.errors.map(() => "master_hash_mismatch"));
  return { valid: errors.length === 0, errors, manifest, artifact };
}

export async function signC2paDelivery({ masterFile, c2paManifestFile, outputFile, receiptFile = `${outputFile}.receipt.json`, executable = "c2patool", parentReceipts = [], commandRunner = runCommand } = {}) {
  const source = path.resolve(String(masterFile));
  const signingManifest = path.resolve(String(c2paManifestFile));
  const target = path.resolve(String(outputFile));
  await Promise.all([access(source), access(signingManifest)]);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.c2pa.tmp${path.extname(target) || ".mp4"}`);
  const startedAt = new Date();
  let verification;
  try {
    await commandRunner(executable, [source, "-m", signingManifest, "-o", temporary]);
    const checked = await commandRunner(executable, [temporary, "--json"]);
    verification = JSON.parse(checked.stdout);
    if (!verification?.active_manifest && !verification?.manifests && !verification?.ingredient) throw new Error("c2patool não confirmou um manifesto ativo.");
    await commitTemporaryFile(temporary, target, { label: "Master C2PA" });
  } catch (error) {
    await rm(temporary, { force: true });
    const message = String(error?.message ?? error).replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]").slice(0, 500);
    throw new Error(`Assinatura C2PA falhou: ${message}`);
  }
  try {
    const [inputArtifact, outputArtifact] = await Promise.all([
      createArtifactFromFile({ file: source, kind: "video", role: "c2pa-source" }),
      createArtifactFromFile({ file: target, kind: "video", role: "c2pa-signed-master", source: { provider: "c2patool" } }),
    ]);
    const receipt = createStageReceipt({ operation: "sign-c2pa-delivery", provider: "c2patool", stage: "provenance", parameters: { schema: C2PA_DELIVERY_SCHEMA, verified: true }, inputs: [inputArtifact], artifacts: [outputArtifact], metadata: { c2paSigned: true, verification: { activeManifest: verification.active_manifest ?? null, manifestCount: verification.manifests ? Object.keys(verification.manifests).length : null }, limitation: "Content Credentials provam a cadeia técnica declarada, não verdade, qualidade estética ou consentimento." }, parentReceipts, startedAt, completedAt: new Date() });
    await writeStageReceipt(receiptFile, receipt);
    return { file: target, receiptFile: path.resolve(receiptFile), receipt, verification };
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}
