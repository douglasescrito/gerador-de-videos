import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  applyPromptBackfill,
  inspectPromptBackfill,
} from "../lib/media-pipeline/archive-prompt-backfill.mjs";
import { buildPromptIndex } from "../lib/media-pipeline/receipt-index.mjs";

test("backfill liga somente output declarado e mantém ambiguidade desconhecida", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompt-backfill-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "colecao", "metadados"), { recursive: true });
  await writeFile(path.join(root, "colecao", "um.mp4"), Buffer.from("video-um"));
  await writeFile(path.join(root, "colecao", "dois.mp4"), Buffer.from("video-dois"));
  await writeFile(path.join(root, "colecao", "metadados", "jobs.json"), JSON.stringify({
    jobs: [
      { prompt: "prompt exato", outputFile: "C:\\antigo\\CORE\\outputs\\colecao\\um.mp4" },
      { prompt: "primeiro conflito", outputFile: "../dois.mp4" },
      { prompt: "segundo conflito", outputFile: "../dois.mp4" },
      { prompt: "sem output", id: "um" },
    ],
  }));
  // Receitas recentes podem usar `blocks` como objeto de configuração. Isso
  // não é uma lista de candidatos e não pode derrubar o índice do Acervo.
  await writeFile(path.join(root, "colecao", "metadados", "recipe.json"), JSON.stringify({
    blocks: { layout: "cinematic" },
  }));
  const report = inspectPromptBackfill({
    outputsRoot: root,
    promptIndex: { entries: {} },
  });
  assert.equal(report.candidateCount, 1);
  assert.equal(report.candidates[0].relPath, "colecao/um.mp4");
  assert.equal(report.ambiguousCount, 1);
  assert.equal(report.ambiguous[0].relPath, "colecao/dois.mp4");
  assert.throws(
    () => applyPromptBackfill({ outputsRoot: root, report, confirmHuman: false }),
    /confirmHuman=true/,
  );
  const applied = applyPromptBackfill({
    outputsRoot: root,
    report,
    confirmHuman: true,
    clock: () => new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(applied.writtenCount, 1);
  const index = buildPromptIndex(root);
  assert.equal(index.entries["colecao/um.mp4"].prompt, "prompt exato");
  assert.equal(index.entries["colecao/um.mp4"].status, "provenance-linked");
  assert.equal(index.entries["colecao/dois.mp4"], undefined);
  assert.equal(index.stats.withReceipt, 0);
});
