import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inventorySchemaBearingDocuments } from "../lib/media-pipeline/schema-bearing-inventory.mjs";

test("inventário classifica documentos por papel e ignora outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-inventory-"));
  try {
    await mkdir(path.join(root, "schemas"), { recursive: true });
    await mkdir(path.join(root, "recipes"), { recursive: true });
    await mkdir(path.join(root, "outputs"), { recursive: true });
    await writeFile(path.join(root, "schemas", "a.schema.json"), JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "a" }));
    await writeFile(path.join(root, "recipes", "a.json"), JSON.stringify({ schema: "gerador-de-videos/receita@2" }));
    await writeFile(path.join(root, "outputs", "receipt.json"), JSON.stringify({ schema: "ignored" }));
    const report = await inventorySchemaBearingDocuments({ root });
    assert.equal(report.total, 2);
    assert.deepEqual(report.roles, { "authored-master-recipe": 1, "authoring-contract": 1 });
    assert.equal(report.providerCalls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
