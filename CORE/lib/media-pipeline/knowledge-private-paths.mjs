import path from "node:path";
import { realpath } from "node:fs/promises";
function requiredText(value, label) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${label} é obrigatório.`); return text; }

export function isPathWithin(parent, candidate) {
  const normalizedParent = path.resolve(parent).toLocaleLowerCase("en-US");
  const normalizedCandidate = path.resolve(candidate).toLocaleLowerCase("en-US");
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

export async function realPathThroughExistingAncestor(target) {
  const missing = [];
  let cursor = path.resolve(target);
  while (true) {
    try {
      const resolved = await realpath(cursor);
      return path.resolve(resolved, ...missing);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(cursor, ...missing);
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function resolveKnowledgeExportFile(outputFile, coreRoot) {
  const output = path.resolve(requiredText(outputFile, "--out"));
  if (path.extname(output).toLowerCase() !== ".json") {
    throw new Error("knowledge export exige uma saída com extensão .json.");
  }
  const workspaceRoot = path.resolve(coreRoot, "..");
  const [resolvedOutput, resolvedWorkspace] = await Promise.all([
    realPathThroughExistingAncestor(output),
    realPathThroughExistingAncestor(workspaceRoot),
  ]);
  if (isPathWithin(resolvedWorkspace, resolvedOutput)) {
    throw new Error(
      "Export privado do Knowledge Store não pode ser gravado dentro do workspace.",
    );
  }
  return resolvedOutput;
}

