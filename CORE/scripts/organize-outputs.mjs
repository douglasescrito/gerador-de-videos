import { lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const legacyRulesUrl = new URL('./legacy-output-rules.mjs', import.meta.url);
let legacyRules = null;
try {
  const info = await lstat(legacyRulesUrl);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Regras legadas devem ser arquivo regular.');
  legacyRules = (await import(legacyRulesUrl.href)).rules;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const GENERIC_OUTPUT_RULES = [
  [/^omni-reference_to_video/i, 'omni-reference-to-video'],
  [/^omni-text_to_video/i, 'omni-text-to-video'],
  [/^omni-product-studio-headless/i, 'omni-product-studio-headless'],
  [/^omni-product-studio-still/i, 'omni-product-studio-stills'],
];
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { replaceFileAtomic, replaceJsonAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";

const coreRoot = path.resolve(import.meta.dirname, "..");
const outputsRoot = path.join(coreRoot, "outputs");
const collectionsRoot = outputsRoot;

function slug(value, fallback = "colecao") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function stripKnownExtensions(name) {
  return name
    .replace(/\.(?:mp4|jpe?g|png)\.receipt\.json$/i, "")
    .replace(/\.mp4$/i, "")
    .replace(/\.jpe?g$/i, "")
    .replace(/\.png$/i, "")
    .replace(/\.txt$/i, "");
}

export function collectionForName(name) {
  const stem = stripKnownExtensions(name);
  const rules = legacyRules ?? GENERIC_OUTPUT_RULES;
  for (const [pattern, collection] of rules) {
    if (pattern.test(stem)) return collection;
  }
  return slug(stem.replace(/-(?:cena|parte|variante)-\d+$/i, "").replace(/-\d+$/i, ""), "colecao");
}

function isReceipt(name) {
  return /\.(?:mp4|jpe?g|png)\.receipt\.json$/i.test(name);
}

function isMp4(name) {
  return /\.mp4$/i.test(name);
}

function isImage(name) {
  return /\.(?:jpe?g|png)$/i.test(name);
}

function isFinalVideo(name) {
  const stem = stripKnownExtensions(name);
  return /(?:^|-)final$|(?:^|-)juntado$|(?:^|-)completo$|filme-completo$|filme-corrigido$/i.test(stem);
}

function hasReceiptFor(name, receiptNames) {
  return receiptNames.has(`${name}.receipt.json`.toLowerCase());
}

function concatPath(file) {
  return path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function runFfmpegConcat(listFile, outputFile) {
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputFile], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0) resolve();
      else reject(new Error(`ffmpeg concat falhou (${status}): ${stderr.trim()}`));
    });
  });
}

async function moveExclusive(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
  return target;
}

async function main() {
  await mkdir(collectionsRoot, { recursive: true });
  const entries = await readdir(outputsRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const receiptNames = new Set(files.filter(isReceipt).map((name) => name.toLowerCase()));
  const collections = new Map();

  function stateFor(name) {
    const collection = collectionForName(name);
    if (!collections.has(collection)) {
      const root = path.join(collectionsRoot, collection);
      collections.set(collection, {
        name: collection,
        root,
        videosDir: path.join(root, "videos-soltos"),
        receiptsDir: path.join(root, "receitas"),
        finalDir: path.join(root, "videos-unidos"),
        metadataDir: path.join(root, "metadados"),
        assetsDir: path.join(root, "assets-e-extras"),
        individualVideos: [],
        finalVideos: [],
        receipts: [],
        extras: [],
      });
    }
    return collections.get(collection);
  }

  for (const name of files) {
    if (!isMp4(name) && !isReceipt(name) && !/\.txt$/i.test(name) && !isImage(name)) continue;
    const source = path.join(outputsRoot, name);
    const state = stateFor(name);
    let target;
    if (isReceipt(name)) {
      target = path.join(state.receiptsDir, name);
      state.receipts.push(await moveExclusive(source, target));
    } else if (isMp4(name) && isFinalVideo(name)) {
      target = path.join(state.finalDir, name);
      state.finalVideos.push(await moveExclusive(source, target));
    } else if (isMp4(name) && hasReceiptFor(name, receiptNames)) {
      target = path.join(state.videosDir, name);
      state.individualVideos.push(await moveExclusive(source, target));
    } else if (/\.txt$/i.test(name)) {
      target = path.join(state.metadataDir, name);
      await moveExclusive(source, target);
    } else {
      target = path.join(state.assetsDir, name);
      state.extras.push(await moveExclusive(source, target));
    }
  }

  const summaries = [];
  for (const state of collections.values()) {
    await Promise.all([state.videosDir, state.receiptsDir, state.finalDir, state.metadataDir, state.assetsDir].map((directory) => mkdir(directory, { recursive: true })));
    state.individualVideos.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    let generatedFinal = null;
    let finalError = null;
    if (state.finalVideos.length === 0 && state.individualVideos.length > 0) {
      const finalFile = path.join(state.finalDir, `${state.name}-partes-juntas.mp4`);
      const concatList = path.join(state.metadataDir, "concat.txt");
      await replaceFileAtomic(concatList, state.individualVideos.map((file) => `file '${concatPath(file)}'`).join("\n") + "\n", { label: "Lista de concatenação", encoding: "utf8" });
      const temporary = `${finalFile}.${process.pid}.${Date.now()}.tmp.mp4`;
      try {
        if (state.individualVideos.length === 1) await copyFile(state.individualVideos[0], temporary);
        else await runFfmpegConcat(concatList, temporary);
        await rename(temporary, finalFile);
        generatedFinal = finalFile;
        state.finalVideos.push(finalFile);
      } catch (error) {
        await rm(temporary, { force: true });
        finalError = error?.message ?? String(error);
      }
    }

    const assemblyReceipt = path.join(state.receiptsDir, `${state.name}-montagem.receipt.json`);
    const updatedAt = new Date().toISOString();
    await replaceJsonAtomic(assemblyReceipt, {
      schema: "mkt-videos/collection-assembly@1",
      collection: state.name,
      method: generatedFinal ? (state.individualVideos.length === 1 ? "copy-single-part" : "ffmpeg-concat-stream-copy") : "existing-final-video",
      individualVideos: state.individualVideos,
      finalVideos: state.finalVideos,
      generatedFinal,
      finalError,
      extrasWithoutReceipts: state.extras,
      updatedAt,
    }, { label: "Recibo de organização" });

    const manifest = {
      schema: "mkt-videos/collection-manifest@1",
      name: state.name,
      root: state.root,
      videosDir: state.videosDir,
      receiptsDir: state.receiptsDir,
      finalDir: state.finalDir,
      metadataDir: state.metadataDir,
      assetsDir: state.assetsDir,
      individualVideos: state.individualVideos,
      receipts: state.receipts,
      finalVideos: state.finalVideos,
      assemblyReceipt,
      finalError,
      extrasWithoutReceipts: state.extras,
      updatedAt,
    };
    await replaceJsonAtomic(path.join(state.root, "manifest.json"), manifest, { label: "Manifesto organizado" });
    summaries.push({
      collection: state.name,
      individualVideos: state.individualVideos.length,
      receipts: state.receipts.length,
      finalVideos: state.finalVideos.length,
      extrasWithoutReceipts: state.extras.length,
      generatedFinal: Boolean(generatedFinal),
      finalError,
      root: state.root,
    });
  }

  console.log(JSON.stringify({
    schema: "mkt-videos/organize-outputs-summary@1",
    collectionsRoot,
    collections: summaries.sort((a, b) => a.collection.localeCompare(b.collection)),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
