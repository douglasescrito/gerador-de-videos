import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import { renderTechniqueCatalogMarkdown } from "../lib/media-pipeline/technique-catalog.mjs";

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTarget = path.join(coreRoot, "docs", "TECHNIQUE-CATALOG.md");

function parseArguments(argv) {
  const options = { check: false, stdout: false, target: defaultTarget };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--stdout") {
      options.stdout = true;
    } else if (argument === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--out exige um caminho.");
      options.target = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
  }
  if (options.check && options.stdout) throw new Error("Use somente --check ou --stdout.");
  return options;
}

async function checkCatalog(target, expected) {
  let current;
  try {
    current = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Catálogo ausente: ${target}.`);
    throw error;
  }
  if (current !== expected) {
    throw new Error(`Catálogo divergente: ${target}. Execute node scripts/generate-technique-catalog.mjs.`);
  }
  process.stdout.write(`Catálogo sincronizado: ${target}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const markdown = renderTechniqueCatalogMarkdown();
  if (options.stdout) {
    process.stdout.write(markdown);
    return;
  }
  if (options.check) {
    await checkCatalog(options.target, markdown);
    return;
  }
  await replaceFileAtomic(options.target, markdown, { label: "Catálogo de técnicas", encoding: "utf8" });
  process.stdout.write(`Catálogo gerado: ${options.target}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
