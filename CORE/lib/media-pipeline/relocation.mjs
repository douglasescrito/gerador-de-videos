import { readFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, verifyArtifact } from "./artifact.mjs";
import { copyFileAtomic, writeJsonAtomic } from "./pipeline-operation.mjs";

export const RELOCATION_MANIFEST_SCHEMA = "mkt-videos/relocation-manifest@1";

export async function copyWithRelocationManifest({ sourceArtifact, destinationFile, manifestFile } = {}) {
  const sourceValidation = await verifyArtifact(sourceArtifact);
  if (!sourceValidation.valid) throw new Error(`Origem inválida para relocação: ${sourceValidation.errors.join(" ")}`);
  await copyFileAtomic(sourceArtifact.file, destinationFile, { label: "Cópia de arquivo" });
  const relocated = await createArtifactFromFile({ file: destinationFile, kind: sourceArtifact.kind, role: sourceArtifact.role, source: { relocationOf: sourceArtifact.id } });
  if (relocated.hash.value !== sourceArtifact.hash.value) throw new Error("Hash da cópia de relocação diverge da origem.");
  const manifest = { schema: RELOCATION_MANIFEST_SCHEMA, createdAt: new Date().toISOString(), source: { id: sourceArtifact.id, file: sourceArtifact.file, hash: sourceArtifact.hash }, relocated };
  await writeJsonAtomic(manifestFile, manifest, { label: "Manifesto de relocação" });
  return { file: path.resolve(destinationFile), manifestFile: path.resolve(manifestFile), manifest };
}

export async function resolveRelocatedArtifact({ artifact, manifestFiles = [] } = {}) {
  const original = await verifyArtifact(artifact);
  if (original.valid) return { resolved: true, source: "original", file: artifact.file, artifact };
  for (const file of manifestFiles) {
    try {
      const manifest = JSON.parse(await readFile(path.resolve(String(file)), "utf8"));
      if (manifest.schema !== RELOCATION_MANIFEST_SCHEMA) continue;
      if (manifest.source?.id !== artifact.id && manifest.source?.hash?.value !== artifact.hash?.value) continue;
      const validation = await verifyArtifact(manifest.relocated);
      if (validation.valid && manifest.relocated.hash.value === artifact.hash.value) return { resolved: true, source: "relocation", file: manifest.relocated.file, artifact: manifest.relocated, manifestFile: path.resolve(String(file)) };
    } catch {}
  }
  return { resolved: false, source: null, file: null, artifact, reason: "no_integral_location" };
}
