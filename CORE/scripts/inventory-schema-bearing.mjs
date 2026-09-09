import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inventorySchemaBearingDocuments } from "../lib/media-pipeline/schema-bearing-inventory.mjs";

const out = path.resolve(process.argv[2] ?? "diagnosticos/phase8-schema-bearing-inventory.json");
const report = await inventorySchemaBearingDocuments({ root: path.resolve(".") });
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ out, total: report.total, roles: report.roles, inventoryHash: report.inventoryHash }, null, 2));
