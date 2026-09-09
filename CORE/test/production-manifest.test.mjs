import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertProductionManifest,
  buildProductionManifest,
  buildReceiptEntry,
  readProductionManifest,
  writeProductionManifest,
} from "../lib/media-pipeline/production-manifest.mjs";
import { createReceipt, writeReceipt } from "../lib/media-pipeline/receipt.mjs";

function verifiedInput({ productionId = "production:pm-fixture" } = {}) {
  return {
    rootScopeId: "client:pm-fixture",
    productionId,
    linkage: "verified",
    requestRef: { requestId: `preq_${"0".repeat(32)}`, requestHash: "a".repeat(64) },
    contextBindingHash: "b".repeat(64),
    planFingerprint: "c".repeat(64),
    executionId: "execution:pm-fixture",
    artifacts: [{ relPath: "pm-fixture/master.mp4", sha256: "d".repeat(64), role: "master", kind: "video/mp4" }],
    materializedAt: "2026-08-12T12:00:00.000Z",
  };
}

test("manifesto verified exige a cadeia completa de bindings", () => {
  const manifest = buildProductionManifest(verifiedInput());
  assert.equal(manifest.linkage, "verified");
  assertProductionManifest(manifest);
});

test("manifesto legacy não pode carregar nenhum campo de binding", () => {
  const manifest = buildProductionManifest({
    rootScopeId: "client:pm-fixture",
    productionId: "production:pm-legacy",
    linkage: "legacy",
    materializedAt: "2026-08-12T12:00:00.000Z",
  });
  assertProductionManifest(manifest);
  assert.equal(manifest.requestRef, null);
});

test("verified sem requestRef/contextBindingHash/planFingerprint/executionId é rejeitado", () => {
  assert.throws(
    () => buildProductionManifest({
      rootScopeId: "client:pm-fixture",
      productionId: "production:pm-fixture",
      linkage: "verified",
      materializedAt: "2026-08-12T12:00:00.000Z",
    }),
    /linkage verified exige/,
  );
});

test("legacy com contextBindingHash presente é rejeitado: vínculo por nome/pasta nunca é verificado", () => {
  assert.throws(
    () => buildProductionManifest({
      rootScopeId: "client:pm-fixture",
      productionId: "production:pm-fixture",
      linkage: "legacy",
      contextBindingHash: "b".repeat(64),
      materializedAt: "2026-08-12T12:00:00.000Z",
    }),
    /linkage legacy não pode carregar/,
  );
});

test("run precisa declarar schema generation-attempt@1", () => {
  assert.throws(
    () => buildProductionManifest({
      ...verifiedInput(),
      runs: [{ schema: "outro-schema", itemId: "x", attemptId: "y", state: "completed" }],
    }),
    /runs\[0\]\.schema deve ser mkt-videos\/generation-attempt@1/,
  );
  const manifest = buildProductionManifest({
    ...verifiedInput(),
    runs: [{ schema: "mkt-videos/generation-attempt@1", itemId: "x", attemptId: "y", state: "completed" }],
  });
  assertProductionManifest(manifest);
});

test("campo editado sem recalcular o hash diverge do manifesto canônico", () => {
  const manifest = buildProductionManifest(verifiedInput());
  const tampered = { ...manifest, productionId: "production:outra-producao" };
  assert.throws(() => assertProductionManifest(tampered), /diverge do manifesto canônico/);
});

test("buildReceiptEntry usa verifyReceipt de verdade e nunca reimplementa a regra", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "production-manifest-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const outputsRoot = path.join(temporary, "outputs");
  await mkdir(path.join(outputsRoot, "pm-fixture"), { recursive: true });
  const mediaPath = path.join(outputsRoot, "pm-fixture", "master.mp4");
  await writeFile(mediaPath, "conteudo-fixture");
  const receipt = createReceipt({ operation: "generate-video", provider: "omni", model: "gemini-omni" });
  await writeReceipt(`${mediaPath}.receipt.json`, receipt);

  const validEntry = await buildReceiptEntry({
    outputsRoot,
    relPath: "pm-fixture/master.mp4",
    receiptRelPath: "pm-fixture/master.mp4.receipt.json",
  });
  assert.equal(validEntry.valid, true);
  assert.equal(validEntry.receiptId, receipt.id);

  const corrupted = { ...receipt, provider: "outro-provider" };
  await writeFile(`${mediaPath}.receipt.json`, JSON.stringify(corrupted));
  const invalidEntry = await buildReceiptEntry({
    outputsRoot,
    relPath: "pm-fixture/master.mp4",
    receiptRelPath: "pm-fixture/master.mp4.receipt.json",
  });
  assert.equal(invalidEntry.valid, false);
});

test("writeProductionManifest grava atomicamente e readProductionManifest revalida na leitura", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "production-manifest-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const outputsRoot = path.join(temporary, "outputs");
  await mkdir(outputsRoot, { recursive: true });
  const manifest = buildProductionManifest(verifiedInput());

  const written = await writeProductionManifest(outputsRoot, "pm-fixture", manifest);
  assert.ok(written.endsWith("production-manifest.json"));

  const reread = await readProductionManifest(outputsRoot, "pm-fixture");
  assert.deepEqual(reread, manifest);
});

test("writeProductionManifest recusa productionDir que escapa de outputsRoot", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "production-manifest-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const outputsRoot = path.join(temporary, "outputs");
  await mkdir(outputsRoot, { recursive: true });
  const manifest = buildProductionManifest(verifiedInput());
  await assert.rejects(
    () => writeProductionManifest(outputsRoot, "../escape", manifest),
    /escapa de outputsRoot/,
  );
});
