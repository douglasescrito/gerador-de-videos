import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const SCHEMA_BEARING_INVENTORY_SCHEMA = "mkt-videos/schema-bearing-inventory@1";
const EXCLUDED = new Set(["node_modules", "outputs", "diagnosticos", "target", "runtime", "dist", ".git", ".cache"]);

function role(relPath, value) {
  const normalized = relPath.replaceAll("\\", "/");
  if (/^schemas\/.*\.schema\.json$/u.test(normalized)) return "authoring-contract";
  if (/^schemas\//u.test(normalized)) return "generated-contract-catalog";
  if (/^recipes\//u.test(normalized)) return value.schema === "gerador-de-videos/receita@2" ? "authored-master-recipe" : "legacy-recipe-or-fixture";
  if (/^knowledge\//u.test(normalized)) return "governed-knowledge-candidate";
  if (/^(test|app\/e2e)\//u.test(normalized)) return "test-fixture";
  return "runtime-config-or-evidence";
}

export async function inventorySchemaBearingDocuments({ root } = {}) {
  const absolute = path.resolve(String(root));
  const entries = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory() && EXCLUDED.has(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile() && item.name.endsWith(".json")) {
        let value;
        try { value = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
        if (typeof value?.schema !== "string" && typeof value?.$schema !== "string" && typeof value?.$id !== "string") continue;
        const relPath = path.relative(absolute, file).replaceAll("\\", "/");
        const bytes = await readFile(file);
        entries.push({ relPath, role: role(relPath, value), schema: value.schema ?? value.$id ?? value.$schema, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await visit(absolute);
  entries.sort((left, right) => left.relPath.localeCompare(right.relPath));
  const body = { schema: SCHEMA_BEARING_INVENTORY_SCHEMA, root: absolute, generatedFromFilesystem: true, total: entries.length, roles: Object.fromEntries([...new Set(entries.map((entry) => entry.role))].sort().map((key) => [key, entries.filter((entry) => entry.role === key).length])), entries, providerCalls: 0 };
  return Object.freeze({ ...body, inventoryHash: operationFingerprint(body) });
}
