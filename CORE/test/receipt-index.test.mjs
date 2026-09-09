import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  buildPromptIndex,
  groupByPrompt,
  isGenerativeReceipt,
  projectReceipt,
  queryPromptIndex,
  RECEIPT_SCHEMA,
} from "../lib/media-pipeline/receipt-index.mjs";

const temporaryRoots = [];
after(() => {
  for (const root of temporaryRoots) {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('receipt-index-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-index-"));
  temporaryRoots.push(root);
  return root;
}

function writeVideo(root, relPath, receipt) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "fake-mp4");
  if (receipt) fs.writeFileSync(`${full}.receipt.json`, JSON.stringify(receipt));
}

function generativeReceipt(overrides = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    operation: "generate-video",
    provider: "gemini-omni-product-studio-playwright",
    model: "gemini-omni-flash-preview",
    status: "completed",
    prompt: "Aquarela 2D sobre papel texturizado",
    parameters: {
      task: "text_to_video",
      aspectRatio: "9:16",
      mode: "studio",
      auth: { secretMaterialPersisted: false, cookie: "NAO-DEVE-VAZAR" },
    },
    metadata: {
      promptComposition: {
        userPrompt: "Vídeo vertical sereno",
        directionPreset: "aquarela-2d@1",
        effectivePrompt: "Aquarela 2D sobre papel texturizado",
        compositionAuthorized: true,
        suggestedAspect: null,
      },
      batchId: "lote-1",
    },
    startedAt: "2026-07-29T20:00:00.000Z",
    completedAt: "2026-07-29T20:01:10.000Z",
    id: "receipt:sha256:abc",
    ...overrides,
  };
}

test("recibo de operação local não é confundido com recibo defeituoso", () => {
  const ffmpegReceipt = {
    schema: RECEIPT_SCHEMA,
    operation: "finish-video",
    provider: "ffmpeg",
    model: null,
    prompt: null,
    status: "completed",
  };

  assert.equal(isGenerativeReceipt(ffmpegReceipt), false);
  assert.equal(projectReceipt(ffmpegReceipt), null);

  const root = makeRoot();
  writeVideo(root, "colecao/gerado.mp4", generativeReceipt());
  writeVideo(root, "colecao/videos-unidos/montado.mp4", ffmpegReceipt);
  writeVideo(root, "colecao/sem-recibo.mp4", null);

  const index = buildPromptIndex(root);
  assert.equal(index.stats.videos, 3);
  assert.equal(index.stats.indexed, 1);
  assert.equal(index.stats.withoutReceipt, 1);
  assert.equal(index.stats.nonGenerativeReceipts, 1);
  assert.deepEqual(index.stats.nonGenerativeByOperation, { "finish-video": 1 });
  assert.equal(index.stats.unreadableReceipts, 0);
});

test("índice não publica material de autenticação", () => {
  const root = makeRoot();
  writeVideo(root, "colecao/gerado.mp4", generativeReceipt());

  const index = buildPromptIndex(root);
  const serialized = JSON.stringify(index);
  assert.equal(serialized.includes("NAO-DEVE-VAZAR"), false);
  assert.equal(serialized.includes("auth"), false);
});

test("vídeo sem recibo fica ausente, nunca com prompt inventado", () => {
  const root = makeRoot();
  writeVideo(root, "colecao/orfao.mp4", null);

  const index = buildPromptIndex(root);
  assert.equal(index.entries["colecao/orfao.mp4"], undefined);
  assert.equal(index.stats.indexed, 0);
  assert.equal(index.stats.promptCoverage, 0);
});

test("recibo ilegível ou de schema desconhecido é contado à parte", () => {
  const root = makeRoot();
  const full = path.join(root, "colecao/quebrado.mp4");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "fake-mp4");
  fs.writeFileSync(`${full}.receipt.json`, "{ isto não é json");
  writeVideo(root, "colecao/outro-schema.mp4", { schema: "outra-coisa@9", prompt: "x" });

  const index = buildPromptIndex(root);
  assert.equal(index.stats.unreadableReceipts, 2);
  assert.equal(index.stats.indexed, 0);
});

test("composição preserva direção do usuário e preset de estilo", () => {
  const projected = projectReceipt(generativeReceipt());
  assert.equal(projected.promptComposition.directionPreset, "aquarela-2d@1");
  assert.equal(projected.promptComposition.userPrompt, "Vídeo vertical sereno");
  assert.equal(projected.promptComposition.compositionAuthorized, true);
  assert.equal(projected.durationMs, 70_000);
  assert.equal(projected.batchId, "lote-1");
});

test("busca combina filtros por AND e casa também no preset de estilo", () => {
  const root = makeRoot();
  writeVideo(root, "a/um.mp4", generativeReceipt());
  writeVideo(
    root,
    "b/dois.mp4",
    generativeReceipt({
      prompt: "Flat 2D motion graphics",
      parameters: { task: "text_to_video", aspectRatio: "16:9", mode: "raw" },
      metadata: { promptComposition: null },
      completedAt: "2026-07-28T10:00:00.000Z",
    }),
  );

  const index = buildPromptIndex(root);

  assert.equal(queryPromptIndex(index, { text: "aquarela-2d@1" }).length, 1);
  assert.equal(queryPromptIndex(index, { aspect: "16:9" }).length, 1);
  assert.equal(queryPromptIndex(index, { collection: "a" }).length, 1);
  assert.equal(queryPromptIndex(index, { mode: "raw", aspect: "9:16" }).length, 0);
  assert.equal(queryPromptIndex(index, {}).length, 2);

  // ordenação do mais recente para o mais antigo
  assert.equal(queryPromptIndex(index, {})[0].relPath, "a/um.mp4");
  assert.equal(queryPromptIndex(index, { limit: 1 }).length, 1);
});

test("cache é reaproveitado quando o recibo não mudou e descartado quando muda", () => {
  const root = makeRoot();
  writeVideo(root, "a/um.mp4", generativeReceipt());

  const first = buildPromptIndex(root);
  assert.equal(first.stats.reusedFromCache, 0);

  const second = buildPromptIndex(root, { cache: first });
  assert.equal(second.stats.reusedFromCache, 1);
  assert.equal(second.stats.indexed, 1);

  // recibo regravado com prompt diferente invalida a entrada cacheada
  writeVideo(root, "a/um.mp4", generativeReceipt({ prompt: "Outro prompt totalmente diferente" }));
  const third = buildPromptIndex(root, { cache: second });
  assert.equal(third.stats.reusedFromCache, 0);
  assert.equal(third.entries["a/um.mp4"].prompt, "Outro prompt totalmente diferente");
});

test("agrupamento por prompt conta reuso e carrega o preset", () => {
  const root = makeRoot();
  writeVideo(root, "a/um.mp4", generativeReceipt());
  writeVideo(root, "a/dois.mp4", generativeReceipt());
  writeVideo(root, "a/tres.mp4", generativeReceipt({ prompt: "Prompt solitário" }));

  const groups = groupByPrompt(queryPromptIndex(buildPromptIndex(root), {}));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].directionPreset, "aquarela-2d@1");
  assert.equal(groups[0].videos.length, 2);
});

test("raiz inexistente devolve índice vazio em vez de estourar", () => {
  const index = buildPromptIndex(path.join(os.tmpdir(), "nao-existe-mesmo-12345"));
  assert.equal(index.stats.videos, 0);
  assert.equal(index.stats.promptCoverage, 0);
});
