import assert from "node:assert/strict";
import fs from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSafeCollection,
  mp4BufferError,
  persistOmniVideo,
  safeSlug,
} from "../lib/media-pipeline/omni-artifact-store.mjs";
import { buildPromptIndex } from "../lib/media-pipeline/receipt-index.mjs";
import { verifyReceipt } from "../lib/media-pipeline/receipt.mjs";
import { verifyArtifact } from "../lib/media-pipeline/artifact.mjs";

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

function fakeMp4(payload = "conteudo-de-video") {
  return Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypisom"),
    Buffer.from(payload.padEnd(40, "-")),
  ]);
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omni-store-"));
}

const baseArgs = (root) => ({
  outputsRoot: root,
  collection: "Ensinamentos de Vida",
  name: "Ensinamento 01 — Poder da Calma",
  buffer: fakeMp4(),
  prompt: "Aquarela 2D sobre papel texturizado",
  model: "gemini-omni-flash-preview",
  parameters: { task: "text_to_video", aspectRatio: "9:16", mode: "studio" },
  metadata: { promptComposition: { directionPreset: "aquarela-2d@1", userPrompt: "Sereno" } },
  exists,
});

test("persiste vídeo e recibo, e o índice de prompts enxerga o resultado", async () => {
  const root = makeRoot();
  const result = await persistOmniVideo(baseArgs(root));

  assert.equal(result.relPath, "ensinamentos-de-vida/ensinamento-01-poder-da-calma.mp4");
  assert.equal(fs.existsSync(result.videoFile), true);
  assert.equal(fs.existsSync(result.receiptFile), true);

  const receipt = JSON.parse(fs.readFileSync(result.receiptFile, "utf8"));
  assert.equal(verifyReceipt(receipt).valid, true);
  assert.equal(receipt.prompt, "Aquarela 2D sobre papel texturizado");
  assert.equal(receipt.parameters.aspectRatio, "9:16");

  // o artefato precisa bater com o arquivo realmente gravado
  const artifactCheck = await verifyArtifact(receipt.artifacts[0]);
  assert.equal(artifactCheck.valid, true, JSON.stringify(artifactCheck.errors ?? []));

  // e o índice da Fase 1 tem que enxergar sem nenhuma adaptação
  const index = buildPromptIndex(root);
  assert.equal(index.stats.indexed, 1);
  assert.equal(index.stats.promptCoverage, 100);
  const entry = index.entries[result.relPath];
  assert.equal(entry.promptComposition.directionPreset, "aquarela-2d@1");
  assert.equal(entry.task, "text_to_video");
});

test("não sobrescreve vídeo existente: gera nome livre", async () => {
  const root = makeRoot();
  const first = await persistOmniVideo(baseArgs(root));
  const second = await persistOmniVideo({ ...baseArgs(root), buffer: fakeMp4("outro") });

  assert.notEqual(first.videoFile, second.videoFile);
  assert.equal(second.relPath.endsWith("-2.mp4"), true);
  assert.equal(fs.existsSync(first.videoFile), true);
  assert.equal(buildPromptIndex(root).stats.indexed, 2);
});

test("recusa conteúdo que não é MP4 em vez de gravar lixo com recibo válido", async () => {
  const root = makeRoot();
  const html = Buffer.from("<!DOCTYPE html><html><body>erro do provedor</body></html>");

  await assert.rejects(
    () => persistOmniVideo({ ...baseArgs(root), buffer: html }),
    /não é um MP4 válido/,
  );
  assert.equal(fs.existsSync(path.join(root, "ensinamentos-de-vida")), false);
});

test("recusa persistir sem prompt: vídeo sem prompt não vira recibo consultável", async () => {
  const root = makeRoot();
  await assert.rejects(
    () => persistOmniVideo({ ...baseArgs(root), prompt: "  " }),
    /prompt é obrigatório/,
  );
});

test("material de autenticação nunca chega ao recibo", async () => {
  const root = makeRoot();
  const result = await persistOmniVideo({
    ...baseArgs(root),
    parameters: {
      task: "text_to_video",
      auth: { cookie: "NAO-DEVE-VAZAR", mode: "windows-credential-manager" },
    },
  });

  const raw = fs.readFileSync(result.receiptFile, "utf8");
  assert.equal(raw.includes("NAO-DEVE-VAZAR"), false);
  assert.equal(raw.includes('"auth"'), false);
});

test("coleção com sintaxe de caminho é rejeitada, não saneada em silêncio", () => {
  for (const bad of ["../fuga", "a/b", "..", "C:/Windows"]) {
    assert.throws(() => assertSafeCollection(bad), undefined, `deveria rejeitar ${bad}`);
  }
  assert.equal(assertSafeCollection("Ensinamentos de Vida"), "ensinamentos-de-vida");
});

test("slug remove acento, caminho e nome reservado do Windows", () => {
  assert.equal(safeSlug("Ensinamento 01 — Poder da Calma"), "ensinamento-01-poder-da-calma");
  assert.equal(safeSlug("ação/../escape"), "acao-escape");
  assert.equal(safeSlug("CON"), "con-arquivo");
  assert.equal(safeSlug("   "), "clipe");
  assert.equal(safeSlug("x".repeat(200)).length, 80);
});

test("buffer vazio ou curto demais é recusado antes de tocar o disco", () => {
  assert.match(mp4BufferError(Buffer.alloc(0)), /vazio/);
  assert.match(mp4BufferError(Buffer.from("abc")), /muito pequeno/);
  assert.equal(mp4BufferError(fakeMp4()), null);
});
