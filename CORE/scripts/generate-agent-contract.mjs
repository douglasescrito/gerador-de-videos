import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { renderAgentContractDocumentation } from "../lib/cli/agent-contract-docs.mjs";

const coreRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputFile = path.join(coreRoot, "docs", "AGENT-CONTRACT.md");

function parseArguments(argv) {
  const options = { check: false, stdout: false };
  for (const argument of argv) {
    if (argument === "--check") options.check = true;
    else if (argument === "--stdout") options.stdout = true;
    else throw new Error(`Argumento desconhecido: ${argument}.`);
  }
  if (options.check && options.stdout) throw new Error("Use somente --check ou --stdout.");
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const expected = renderAgentContractDocumentation();
  if (options.stdout) {
    process.stdout.write(expected);
    return;
  }
  if (options.check) {
    let current;
    try {
      current = await readFile(outputFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Documento ausente: ${outputFile}.`);
      throw error;
    }
    if (current !== expected) {
      throw new Error(`Documento divergente: ${outputFile}. Execute node scripts/generate-agent-contract.mjs.`);
    }
    process.stdout.write("AGENT-CONTRACT.md sincronizado.\n");
    return;
  }
  await replaceFileAtomic(outputFile, expected, { label: "AGENT-CONTRACT.md", encoding: "utf8" });
  process.stdout.write(`AGENT-CONTRACT.md gerado em ${outputFile}\n`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && invokedFile.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
