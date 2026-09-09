import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resourcePolicyFromEvidence } from "./verification-resources.mjs";

const root = path.resolve(import.meta.dirname, "..");
const reportFile = process.argv[2];
if (!reportFile || process.argv.length !== 3) throw new Error("Informe um report.json completo aprovado para propor a classificação de testes.");
const report = JSON.parse(await readFile(path.resolve(reportFile), "utf8"));
const sourceHashes = {};
for (const name of (await readdir(path.join(root, "test"))).filter((file) => file.endsWith(".test.mjs")).sort()) {
  const file = `test/${name}`;
  sourceHashes[file] = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
}
const files = resourcePolicyFromEvidence({ report, sourceHashes });
const policy = { schema: "gerador-de-videos/verification-resources@1", evidence: path.relative(root, path.resolve(reportFile)).replaceAll("\\", "/"),
  basis: "observed-subprocesses-with-mandatory-runtime-guard", limitation: "Observação não é aprovação reutilizada nem inventário completo de descendentes. Fonte alterada exige exclusividade; ferramenta nova é bloqueada e invalida a rodada.", files };
await writeFile(path.join(root, "test/verification-resource-policy.json"), JSON.stringify(policy, null, 2) + "\n");
console.log(JSON.stringify({ files: Object.keys(files).length, classes: Object.values(files).reduce((counts, row) => ({ ...counts, [row.resource]: (counts[row.resource] ?? 0) + 1 }), {}) }));
