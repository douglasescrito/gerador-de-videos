import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPathAvailable,
  createStageReceipt,
  normalizePipelineMode,
  operationFingerprint,
  readVerifiedReceipt,
  replaceFileAtomic,
  requireStudioMode,
  writeFileAtomic,
  writeStageReceipt,
} from "../lib/media-pipeline/pipeline-operation.mjs";

test("modos raw/studio e fingerprint são determinísticos", () => {
  assert.equal(normalizePipelineMode(), "raw");
  assert.equal(normalizePipelineMode("STUDIO"), "studio");
  assert.throws(() => normalizePipelineMode("auto"), /Modo inválido/);
  assert.throws(() => requireStudioMode("raw", "presets"), /exige --mode studio/);
  assert.equal(operationFingerprint({ b: 2, a: 1 }), operationFingerprint({ a: 1, b: 2 }));
});

test("escrita atômica não sobrescreve", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-operation-"));
  try {
    const file = path.join(dir, "artifact.txt");
    await writeFileAtomic(file, "primeiro", { encoding: "utf8" });
    await assert.rejects(() => writeFileAtomic(file, "segundo", { encoding: "utf8" }), /não será sobrescrita|não será sobrescrito/);
    assert.equal(await readFile(file, "utf8"), "primeiro");
    await assert.rejects(() => assertPathAvailable(file), /não será sobrescrita/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estado mutável é substituído atomicamente sem resíduos", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-replace-"));
  try {
    const file = path.join(dir, "state.json");
    await replaceFileAtomic(file, "um", { encoding: "utf8" });
    await replaceFileAtomic(file, "dois", { encoding: "utf8" });
    assert.equal(await readFile(file, "utf8"), "dois");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recibo de etapa encadeia pais e continua verificável", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-receipt-"));
  try {
    const receiptFile = path.join(dir, "stage.receipt.json");
    const receipt = createStageReceipt({
      operation: "test-stage",
      provider: "local-test",
      stage: "foundation",
      mode: "studio",
      parameters: { answer: 42 },
      parentReceipts: ["receipt:sha256:parent"],
    });
    await writeStageReceipt(receiptFile, receipt);
    const reread = await readVerifiedReceipt(receiptFile);
    assert.equal(reread.parameters.mode, "studio");
    assert.deepEqual(reread.metadata.pipeline.parentReceiptIds, ["receipt:sha256:parent"]);
    await assert.rejects(() => writeStageReceipt(receiptFile, receipt), /não será sobrescrita/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
