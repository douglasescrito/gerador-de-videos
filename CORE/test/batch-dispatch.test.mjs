import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBatchJob } from "../lib/media-pipeline/omni-batch-runner.mjs";
import {
  BATCH_DISPATCH_UNSUPPORTED_REFERENCES_MESSAGE,
  assertNoBatchReferences,
  createCliBatchGenerate,
  createCliBatchPersist,
  preflightBatchItems,
} from "../lib/media-pipeline/batch-dispatch.mjs";

const MP4 = Buffer.alloc(32);
MP4.writeUInt32BE(32, 0);
MP4.write("ftyp", 4, "ascii");
MP4.write("isom", 8, "ascii");
MP4.writeUInt32BE(0, 12);
MP4.write("isom", 16, "ascii");
MP4.write("iso2", 20, "ascii");

test("assertNoBatchReferences aceita itens sem referências e recusa itens com referência", () => {
  assertNoBatchReferences([{ prompt: "a" }, { prompt: "b", references: [] }]);
  assert.throws(
    () => assertNoBatchReferences([{ prompt: "a" }, { prompt: "b", references: [{ inputId: "x" }] }]),
    new RegExp(`Item 2: ${BATCH_DISPATCH_UNSUPPORTED_REFERENCES_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
});

test("preflightBatchItems recusa técnica incompatível com modo raw antes de tocar o estado do lote", () => {
  const job = createBatchJob({
    collection: "preflight-teste",
    items: [{ prompt: "um vídeo qualquer", techniques: [{ id: "zoom-in@1" }] }],
    defaults: { mode: "raw", task: "text_to_video", aspectRatio: "9:16" },
  });
  assert.throws(() => preflightBatchItems(job), /studio/);
});

test("preflightBatchItems aceita item raw sem técnica", () => {
  const job = createBatchJob({
    collection: "preflight-ok",
    items: [{ prompt: "um vídeo qualquer" }],
    defaults: { mode: "raw", task: "text_to_video", aspectRatio: "9:16" },
  });
  assert.doesNotThrow(() => preflightBatchItems(job));
});

test("createCliBatchGenerate escreve num arquivo temporário efêmero e devolve o buffer, sem deixar lixo", async () => {
  const seenCalls = [];
  const videoAdapter = {
    async generate({ prompt, outputFile, onProviderHandle }) {
      seenCalls.push({ prompt, outputFile });
      await onProviderHandle({ fileId: "file-1", interactionId: "interaction-1" });
      const fs = await import("node:fs/promises");
      await fs.writeFile(outputFile, MP4);
      return { fileId: "file-1", interactionId: "interaction-1" };
    },
  };
  const generate = createCliBatchGenerate({ videoAdapter, timeoutMs: 5_000, pollIntervalMs: 0 });
  const job = createBatchJob({
    collection: "generate-teste",
    items: [{ prompt: "cena um" }],
    defaults: { mode: "raw", task: "text_to_video", aspectRatio: "9:16" },
  });
  const item = job.items[0];
  let acceptedDetails = null;
  const result = await generate(item, job, { accepted: async (details) => { acceptedDetails = details; } });

  assert.equal(seenCalls.length, 1);
  assert.equal(seenCalls[0].prompt, "cena um");
  assert.ok(result.buffer.equals(MP4));
  assert.equal(result.fileId, "file-1");
  assert.equal(result.interactionId, "interaction-1");
  assert.equal(result.effectivePrompt, "cena um");
  assert.deepEqual(acceptedDetails, { fileId: "file-1", interactionId: "interaction-1" });

  const workDir = path.dirname(seenCalls[0].outputFile);
  await assert.rejects(readFile(workDir));
});

test("createCliBatchPersist grava no MESMO acervo via persistOmniVideo e devolve relPath/receiptId", async (context) => {
  const outputsRoot = await mkdtemp(path.join(os.tmpdir(), "batch-dispatch-persist-"));
  context.after(() => rm(outputsRoot, { recursive: true, force: true }));
  const persist = createCliBatchPersist({ outputsRoot });
  const stored = await persist({
    collection: "persist-teste",
    name: "cena-1",
    buffer: MP4,
    prompt: "cena um",
    model: null,
    parameters: {},
    metadata: {},
    startedAt: new Date(),
  });
  assert.equal(stored.collection, "persist-teste");
  assert.match(stored.relPath, /^persist-teste\/cena-1\.mp4$/);
  assert.ok(stored.receiptId);
  const bytes = await readFile(path.join(outputsRoot, stored.relPath));
  assert.ok(bytes.equals(MP4));
});
