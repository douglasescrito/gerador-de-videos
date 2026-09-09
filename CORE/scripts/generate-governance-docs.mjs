import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceFileAtomic } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  loadCommandGovernance,
  renderCapabilityDocumentation,
  renderCommandStatusDocumentation,
} from "../lib/media-pipeline/governance-docs.mjs";

const coreRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputDirectory = path.join(coreRoot, "docs");

function parseArguments(argv) {
  const options = { check: false, stdout: false, outputDirectory: defaultOutputDirectory };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--stdout") {
      options.stdout = true;
    } else if (argument === "--out-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--out-dir exige um caminho.");
      options.outputDirectory = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
  }
  if (options.check && options.stdout) throw new Error("Use somente --check ou --stdout.");
  return options;
}

async function expectedDocuments() {
  const governance = await loadCommandGovernance({ coreRoot });
  return {
    "CAPABILITIES.md": renderCapabilityDocumentation(),
    "COMMAND-STATUS.md": renderCommandStatusDocumentation(governance),
  };
}

async function assertSynchronized(outputDirectory, documents) {
  for (const [name, expected] of Object.entries(documents)) {
    const target = path.join(outputDirectory, name);
    let current;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Documento ausente: ${target}.`);
      throw error;
    }
    if (current !== expected) {
      throw new Error(`Documento divergente: ${target}. Execute node scripts/generate-governance-docs.mjs.`);
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const documents = await expectedDocuments();
  if (options.stdout) {
    for (const [name, markdown] of Object.entries(documents)) {
      process.stdout.write(`<!-- ${name} -->\n${markdown}`);
    }
    return;
  }
  if (options.check) {
    await assertSynchronized(options.outputDirectory, documents);
    process.stdout.write("Documentos de governança sincronizados.\n");
    return;
  }
  for (const [name, markdown] of Object.entries(documents)) {
    await replaceFileAtomic(path.join(options.outputDirectory, name), markdown, {
      label: `Documento de governança ${name}`,
      encoding: "utf8",
    });
  }
  process.stdout.write(`Documentos de governança gerados em ${options.outputDirectory}\n`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && invokedFile.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
