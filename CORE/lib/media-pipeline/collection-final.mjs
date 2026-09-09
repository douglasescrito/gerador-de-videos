import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile, sha256File } from "./artifact.mjs";
import { assertPathAvailable, createStageReceipt, operationFingerprint, pathExists, readVerifiedReceipt, replaceFileAtomic, replaceJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { commitOrVerifyLocalFile, readMatchingLocalReceipt } from "./local-publication-recovery.mjs";
import { writeHarvestedRecipe } from "./recipe-harvest.mjs";

export async function rebuildDirectCollection(collection, { recoverExisting = false, concat } = {}) {
  if (!collection) return null;
  const entries = await readdir(collection.videosDir, { withFileTypes: true });
  const videos = entries.filter((entry) => entry.isFile() && /^parte-\d{3,}\.mp4$/i.test(entry.name))
    .map((entry) => path.join(collection.videosDir, entry.name)).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (!videos.length) return null;
  if (recoverExisting && videos.some((file) => Number(path.basename(file).match(/\d+/)[0]) > collection.partNumber)) throw new Error("A coleção recebeu outra parte após esta tentativa; a retomada não substitui essa montagem.");
  const method = videos.length === 1 ? "copy-single-part" : "ffmpeg-concat-stream-copy";
  const parents = [];
  for (const file of videos) {
    try { const receipt = await readVerifiedReceipt(path.join(collection.receiptsDir, `${path.basename(file)}.receipt.json`)); if (receipt.id) parents.push(receipt.id); }
    catch (error) { if (recoverExisting) throw error; }
  }
  await Promise.all([collection.finalDir, collection.receiptsDir, collection.metadataDir].map((directory) => mkdir(directory, { recursive: true })));
  const existing = recoverExisting ? await readMatchingLocalReceipt({ file: collection.assemblyReceipt, operation: "assemble-collection", mode: collection.mode ?? "raw", inputFiles: videos, outputFile: collection.finalFile, parameters: { method, parts: videos.length }, parentReceipts: parents }) : null;
  if (!recoverExisting) await assertPathAvailable(collection.assemblyReceipt, "Recibo da montagem");
  const escapePath = (file) => path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''");
  await replaceFileAtomic(collection.concatList, videos.map((file) => `file '${escapePath(file)}'`).join("\n") + "\n", { label: "Lista da coleção", encoding: "utf8" });
  let assembly;
  if (existing) {
    const { pipeline: _pipeline, ...record } = existing.metadata;
    if (record.finalFile !== collection.finalFile || record.collection !== collection.name || operationFingerprint(record.parts?.map((entry) => entry.file)) !== operationFingerprint(videos)) throw new Error("Recibo da montagem diverge da coleção retomada.");
    assembly = record;
  } else {
    const startedAt = new Date();
    const temporary = `${collection.finalFile}.${process.pid}.${Date.now()}.tmp.mp4`;
    try {
      if (videos.length === 1) await copyFile(videos[0], temporary);
      else await concat(collection.concatList, temporary);
      if (recoverExisting && await pathExists(collection.finalFile)) {
        const [expected, current] = await Promise.all([sha256File(temporary), sha256File(collection.finalFile)]);
        if (expected !== current) {
          // A queda pode ter precedido a troca da montagem da parte anterior.
          // Só substitui esse agregado depois de verificar seu recibo e inputs.
          let previous;
          try { previous = JSON.parse(await readFile(collection.manifestFile, "utf8")); }
          catch (error) { throw new Error("Agregado existente não corresponde à montagem retomada e não há manifesto anterior verificável.", { cause: error }); }
          const prefix = videos.slice(0, previous.parts?.length ?? 0);
          if (!prefix.length || prefix.length >= videos.length || operationFingerprint(previous.parts) !== operationFingerprint(prefix) || previous.finalFile !== collection.finalFile || previous.assemblyReceipt === collection.assemblyReceipt || path.dirname(path.resolve(previous.assemblyReceipt ?? "")) !== path.resolve(collection.receiptsDir)) throw new Error("Manifesto anterior diverge da coleção retomada.");
          const receipt = await readMatchingLocalReceipt({ file: previous.assemblyReceipt, operation: "assemble-collection", mode: collection.mode ?? "raw", inputFiles: prefix, outputFile: collection.finalFile, parameters: { parts: prefix.length } });
          if (!receipt) throw new Error("Agregado anterior não possui recibo verificável.");
          await rename(temporary, collection.finalFile);
        } else await commitOrVerifyLocalFile(temporary, collection.finalFile, { recoverExisting: true, label: "Montagem" });
      } else await rename(temporary, collection.finalFile);
    } finally { await rm(temporary, { force: true }); }
    const completedAt = new Date();
    assembly = { schema: "mkt-videos/collection-assembly@1", collection: collection.name, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), method, parts: videos.map((file, index) => ({ index: index + 1, file })), finalFile: collection.finalFile, concatList: collection.concatList };
    const inputs = await Promise.all(videos.map((file) => createArtifactFromFile({ file, kind: "video", role: "collection-part" })));
    const artifact = await createArtifactFromFile({ file: collection.finalFile, kind: "video", role: "collection-final", source: { provider: method } });
    await writeStageReceipt(collection.assemblyReceipt, createStageReceipt({ operation: "assemble-collection", provider: videos.length === 1 ? "local-copy" : "ffmpeg", mode: collection.mode ?? "raw", stage: "collection-assembly", parameters: { method, parts: videos.length }, inputs, artifacts: [artifact], metadata: assembly, parentReceipts: parents, startedAt, completedAt }));
  }
  const manifest = { schema: "mkt-videos/collection-manifest@1", name: collection.name, root: collection.root, videosDir: collection.videosDir, receiptsDir: collection.receiptsDir, finalDir: collection.finalDir, metadataDir: collection.metadataDir, parts: videos, finalFile: collection.finalFile, assemblyReceipt: collection.assemblyReceipt, updatedAt: assembly.completedAt };
  await replaceJsonAtomic(collection.manifestFile, manifest, { label: "Manifesto da coleção" });
  let colheita = null;
  try { colheita = (await writeHarvestedRecipe({ root: collection.root, name: collection.name, masterFile: collection.finalFile }))?.file ?? null; }
  catch (error) { console.error(`Colheita da receita falhou (o filme está íntegro): ${String(error?.message ?? error)}`); }
  return { file: collection.finalFile, receipt: collection.assemblyReceipt, parts: videos.length, method, colheita };
}
