import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDomainPackCatalog,
} from "../lib/media-pipeline/knowledge-domain-pack-catalog.mjs";
import {
  renderDomainPackCatalogMarkdown,
} from "../lib/media-pipeline/knowledge-domain-pack-docs.mjs";
import {
  replaceFileAtomic,
} from "../lib/media-pipeline/pipeline-operation.mjs";

const coreRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultTarget = path.join(coreRoot, "docs", "KNOWLEDGE-PACKS.md");

function parseArguments(argv) {
  const options = {
    check: false,
    stdout: false,
    target: defaultTarget,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--stdout") {
      options.stdout = true;
    } else if (argument === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out exige um caminho.");
      }
      options.target = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
  }
  if (options.check && options.stdout) {
    throw new Error("Use somente --check ou --stdout.");
  }
  return options;
}

async function checkCatalog(target, expected) {
  let current;
  try {
    current = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Catálogo ausente: ${target}.`);
    }
    throw error;
  }
  if (current !== expected) {
    throw new Error(
      `Catálogo divergente: ${target}. Execute `
      + "node scripts/generate-knowledge-pack-catalog.mjs.",
    );
  }
  process.stdout.write(`Knowledge packs sincronizados: ${target}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = await loadDomainPackCatalog({ coreRoot });
  const markdown = renderDomainPackCatalogMarkdown({ catalog });
  if (options.stdout) {
    process.stdout.write(markdown);
    return;
  }
  if (options.check) {
    await checkCatalog(options.target, markdown);
    return;
  }
  await replaceFileAtomic(options.target, markdown, {
    label: "Catálogo de knowledge packs",
    encoding: "utf8",
  });
  process.stdout.write(`Knowledge packs gerados: ${options.target}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
