import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { buildArchiveIndex, searchArchive, setArchiveReview, upsertArchiveReceipt } from "../lib/media-pipeline/archive-index.mjs";
import { reuseApprovedArtifact } from "../lib/media-pipeline/approved-reuse.mjs";
import { createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { createRecipeV2, recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";
import { createLocalAssetRuntime } from "../lib/media-pipeline/local-asset-use.mjs";
import { createApprovedReuseRuntime } from "../lib/media-pipeline/approved-reuse.mjs";
import { governedLocalAssetFixture } from "./fixtures/governed-sfx.mjs";
import { runCommand } from "../lib/media-pipeline/media-tools.mjs";

const consumer = { id: "fixture-operation", version: "fixture@1" };
async function authorizeFixture({ root, sourceFile, sourceReceiptFile, sourceReceipt, dbFile }) {
  const recipe = recipeFromReceipt(sourceReceipt);
  const binding = { schema: "mkt-videos/approved-reuse-binding@1", consumer, recipeHash: recipe.hash, receiptHash: sourceReceipt.hash.value, artifactRole: "scene-video" };
  const stored = await governedLocalAssetFixture({ root, file: sourceFile, mediaKind: "video", mediaType: "video/mp4", role: "scene-video", approvedReuse: binding });
  const context = { ...stored.context, reuse: { dbFile, candidates: [{ asset: stored.asset, receiptFile: sourceReceiptFile, binding }] } };
  const authorizeLocalAssets = await createLocalAssetRuntime(context);
  return { ...stored, context, recipe, runtime: createApprovedReuseRuntime({ context, authorizeLocalAssets }),
    options: { rootScopeId: context.rootScopeId, consumer, candidates: context.reuse.candidates, authorizeLocalAssets, artifactRole: "scene-video" } };
}

test("recipe@2 muda com semântica e ignora timeout, polling e caminhos", () => {
  const base = { operation: "generate-video", provider: "omni", model: "m1", prompt: "Cena", task: "image_to_video", aspect: "16:9", inputHashes: ["b", "a"], parameters: { timeoutMs: 10, pollIntervalMs: 2, outputFile: "C:/a.mp4", temperature: 0.2 }, brandKit: { hash: "brand-a" } };
  const first = createRecipeV2(base);
  const operationalChange = createRecipeV2({ ...base, parameters: { ...base.parameters, timeoutMs: 999, pollIntervalMs: 88, outputFile: "D:/b.mp4" } });
  assert.equal(first.hash, operationalChange.hash);
  assert.notEqual(first.hash, createRecipeV2({ ...base, aspect: "9:16" }).hash);
  assert.notEqual(first.hash, createRecipeV2({ ...base, inputHashes: ["a", "c"] }).hash);
  assert.notEqual(first.hash, createRecipeV2({ ...base, brandKit: { hash: "brand-b" } }).hash);
});

test("reuso aprovado exige autoridade vigente e cópia avulsa não inventa operação evitada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-reuse-"));
  try {
    const outputs = path.join(root, "outputs");
    const sourceDir = path.join(outputs, "origem", "receitas");
    await mkdir(sourceDir, { recursive: true });
    const sourceFile = path.join(outputs, "origem", "videos-soltos", "scene.mp4");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "approved-video");
    const artifact = await createArtifactFromFile({ file: sourceFile, kind: "video", role: "scene-video" });
    const sourceReceiptFile = path.join(sourceDir, "scene.receipt.json");
    const sourceReceipt = createStageReceipt({ operation: "generate-video", provider: "omni", model: "m1", stage: "video", prompt: "Cena", parameters: { consumer, task: "image_to_video", aspect: "16:9", timeoutMs: 10 }, artifacts: [artifact] });
    await writeStageReceipt(sourceReceiptFile, sourceReceipt);
    const dbFile = path.join(root, "archive.sqlite");
    await buildArchiveIndex({ root: outputs, dbFile });
    setArchiveReview({ dbFile, receiptPath: sourceReceiptFile, status: "approved" });
    const recipe = recipeFromReceipt(sourceReceipt);
    const authority = await authorizeFixture({ root, sourceFile, sourceReceiptFile, sourceReceipt, dbFile });
    const target = path.join(outputs, "nova", "videos-soltos", "scene.mp4");
    await assert.rejects(reuseApprovedArtifact({ policy: "require-approved", dbFile, recipe, outputFile: target, artifactRole: "scene-video" }), /autorização vigente/);
    const reused = await reuseApprovedArtifact({ ...authority.options, policy: "require-approved", dbFile, recipe, outputFile: target });
    assert.equal(reused.hit, true);
    assert.equal(reused.zeroPost, true);
    assert.equal(await readFile(target, "utf8"), "approved-video");
    assert.equal(reused.receipt.metadata.avoidedProviderPost, false);
    assert.equal(reused.receipt.metadata.avoidedOperation, null);
    await authority.runtime.validate({ rootScopeId: authority.context.rootScopeId, recipe, consumer, artifactRole: "scene-video", receipt: reused.receipt });
    authority.changeRights({ permissions: { reuse: "revoked" } });
    await assert.rejects(authority.runtime.validate({ rootScopeId: authority.context.rootScopeId, recipe, consumer, artifactRole: "scene-video", receipt: reused.receipt }), /revoked/);

    const incrementalReceiptFile = path.join(sourceDir, "second.receipt.json");
    const incremental = createStageReceipt({ operation: "local-transform", provider: "ffmpeg", stage: "finish" });
    await writeStageReceipt(incrementalReceiptFile, incremental);
    await upsertArchiveReceipt({ root: outputs, dbFile, receiptFile: incrementalReceiptFile });
    assert.equal(searchArchive({ dbFile }).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artefato divergente jamais é reutilizado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-reuse-corrupt-"));
  try {
    const outputs = path.join(root, "outputs");
    const sourceFile = path.join(outputs, "origem", "clip.mp4");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "original");
    const artifact = await createArtifactFromFile({ file: sourceFile, kind: "video", role: "scene-video" });
    const receiptFile = path.join(outputs, "origem", "clip.receipt.json");
    const receipt = createStageReceipt({ operation: "generate-video", provider: "omni", stage: "video", parameters: { consumer }, artifacts: [artifact] });
    await writeStageReceipt(receiptFile, receipt);
    const dbFile = path.join(root, "archive.sqlite");
    await buildArchiveIndex({ root: outputs, dbFile });
    setArchiveReview({ dbFile, receiptPath: receiptFile, status: "approved" });
    const authority = await authorizeFixture({ root, sourceFile, sourceReceiptFile: receiptFile, sourceReceipt: receipt, dbFile });
    await writeFile(sourceFile, "tampered");
    await assert.rejects(reuseApprovedArtifact({ ...authority.options, policy: "require-approved", dbFile, recipe: recipeFromReceipt(receipt), outputFile: path.join(outputs, "new.mp4") }), /Bytes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reuso isola root, papel, parâmetros, versão, aprovação e revogação antes da publicação", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reuse-rejections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputs = path.join(root, "outputs");
  await mkdir(outputs);
  const sourceFile = path.join(outputs, "scene.mp4");
  await writeFile(sourceFile, "approved-original");
  const artifact = await createArtifactFromFile({ file: sourceFile, kind: "video", role: "scene-video" });
  const sourceReceiptFile = `${sourceFile}.receipt.json`;
  const sourceReceipt = createStageReceipt({ operation: "fixture-operation", provider: "local", stage: "video", parameters: { consumer, colour: "blue" }, artifacts: [artifact] });
  await writeStageReceipt(sourceReceiptFile, sourceReceipt);
  const dbFile = path.join(root, "archive.sqlite");
  await buildArchiveIndex({ root: outputs, dbFile });
  setArchiveReview({ dbFile, receiptPath: sourceReceiptFile, status: "approved" });
  const authority = await authorizeFixture({ root, sourceFile, sourceReceiptFile, sourceReceipt, dbFile });
  const target = path.join(root, "reuse.mp4");
  const request = { ...authority.options, dbFile, recipe: authority.recipe, outputFile: target, policy: "prefer-approved" };
  await assert.rejects(authority.runtime({ ...request, rootScopeId: "client:other" }), /root/);
  for (const overrides of [{ artifactRole: "voice-master" }, { consumer: { ...consumer, version: "fixture@2" } }, { recipe: createRecipeV2({ ...authority.recipe, parameters: { ...authority.recipe.parameters, colour: "red" } }) }]) {
    assert.equal((await authority.runtime({ ...request, ...overrides })).hit, false);
  }
  setArchiveReview({ dbFile, receiptPath: sourceReceiptFile, status: "rejected" });
  assert.equal((await authority.runtime(request)).hit, false);
  await assert.rejects(authority.runtime({ ...request, policy: "require-approved" }), /Nenhum artefato aprovado/);
  setArchiveReview({ dbFile, receiptPath: sourceReceiptFile, status: "approved" });
  const alteredBinding = { ...authority.context.reuse.candidates[0].binding, receiptHash: "a".repeat(64) };
  await assert.rejects(reuseApprovedArtifact({ ...request, candidates: [{ ...authority.context.reuse.candidates[0], binding: alteredBinding }] }), /Registro governado/);
  for (const reuse of ["unknown", "denied", "revoked"]) {
    authority.changeRights({ permissions: { reuse } });
    await assert.rejects(authority.runtime(request), new RegExp(reuse));
  }
  authority.changeRights({ permissions: { reuse: "allowed" } });
  let calls = 0;
  await assert.rejects(reuseApprovedArtifact({ ...request, authorizeLocalAssets: async (value) => {
    if (++calls === 2) authority.changeRights({ permissions: { reuse: "revoked" } });
    return authority.options.authorizeLocalAssets(value);
  } }), /revoked/);
  assert.equal(calls, 2);
  await assert.rejects(access(target), { code: "ENOENT" });
  await assert.rejects(access(`${target}.receipt.json`), { code: "ENOENT" });
  assert.equal((await readdir(root)).filter((file) => file.startsWith(".reuse-")).length, 0);
  authority.changeRights({ permissions: { reuse: "allowed" } });
  const contextFile = path.join(root, "asset-context.json");
  await writeFile(contextFile, JSON.stringify(authority.context));
  const cli = await runCommand(process.execPath, ["scripts/omni-cli.mjs", "reuse", "--source-receipt", sourceReceiptFile, "--asset-context", contextFile, "--role", "scene-video", "--out", target, "--policy", "require-approved"]);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.hit, true);
  assert.equal(result.receipt.metadata.avoidedOperation, null);
  assert.equal(await readFile(sourceFile, "utf8"), "approved-original");
  await assert.rejects(authority.runtime(request), /já existe/);
});
