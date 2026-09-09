import { readdir } from "node:fs/promises";
import path from "node:path";

// Discovery e validação precisam enxergar os mesmos formatos nomeados.
export const PADRAO_RECEITA = /\.receita(-[a-z0-9.]+)?\.json$/i;

export async function discoverJsonFiles(root) {
  const absoluteRoot = path.resolve(String(root));
  const found = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absoluteFile = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absoluteFile);
      else if (entry.isFile() && /\.json$/i.test(entry.name)) {
        found.push({
          absoluteFile,
          relativeFile: path.relative(absoluteRoot, absoluteFile).replaceAll("\\", "/"),
        });
      }
    }
  }

  await visit(absoluteRoot);
  return found.sort((a, b) => a.relativeFile.localeCompare(b.relativeFile, "pt-BR"));
}

/**
 * Descobre receitas recursivamente sem seguir symlinks. CLI e Galeria usam a
 * mesma prateleira, permitindo organizar subpastas sem criar dois catálogos.
 */
export async function discoverRecipeFiles(root) {
  return (await discoverJsonFiles(root)).filter((entry) => PADRAO_RECEITA.test(entry.relativeFile));
}
