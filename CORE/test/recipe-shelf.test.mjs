import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRecipeFiles } from "../lib/media-pipeline/recipe-shelf.mjs";

test("prateleira encontra receitas em subpastas sem incluir JSONs auxiliares", async () => {
  const root = path.join(os.tmpdir(), `recipe-shelf-${process.pid}-${Date.now()}`);
  try {
    await mkdir(path.join(root, "candidatas", "motion"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "raiz.receita.json"), "{}"),
      writeFile(path.join(root, "mestre.receita-v2.5b.json"), "{}"),
      writeFile(path.join(root, "CAIXA.RECEITA-V2.JSON"), "{}"),
      writeFile(path.join(root, "candidatas", "motion", "nova.receita.json"), "{}"),
      writeFile(path.join(root, "candidatas", "motion", "validation.json"), "{}"),
    ]);
    const files = await discoverRecipeFiles(root);
    assert.deepEqual(files.map((item) => item.relativeFile), ["CAIXA.RECEITA-V2.JSON", "candidatas/motion/nova.receita.json", "mestre.receita-v2.5b.json", "raiz.receita.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
