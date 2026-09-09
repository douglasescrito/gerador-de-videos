import { cp, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { measureFixturePreparation } from "./preparation-profile.mjs";

const execute = promisify(execFile);

/** Mesmo entrypoint e código, mas raízes de mídia físicas e descartáveis. */
export async function createIsolatedCliWorkspace(sourceRoot, { documentary = false } = {}) {
  if (documentary) throw new Error("Private documentary fixture is not part of this distribution.");
  return measureFixturePreparation("isolated-cli-workspace", async () => {
    const started = performance.now();
    const temporary = await mkdtemp(path.join(os.tmpdir(), "isolated-cli-workspace-"));
    const workspaceRoot = path.join(temporary, "workspace");
    const coreRoot = path.join(workspaceRoot, "CORE");
    try {
      await mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
      await mkdir(coreRoot);
      for (const name of ["lib", "scripts", "schemas", "knowledge"]) {
        await cp(path.join(sourceRoot, name), path.join(coreRoot, name), {
          recursive: true,
          filter: async (source) => {
            const metadata = await lstat(source);
            if (metadata.isSymbolicLink()) throw new Error("Fixture de código não aceita symlink nas fontes.");
            return metadata.isDirectory() || /\.(?:mjs|cjs|js|json|sql)$/.test(source) || name === "knowledge" && source.endsWith(".md");
          },
        });
      }
      await cp(path.join(sourceRoot, "package.json"), path.join(coreRoot, "package.json"));
      await mkdir(path.join(coreRoot, "docs"));
      await cp(path.join(sourceRoot, "docs/KNOWLEDGE-GOVERNANCE-POLICY.md"), path.join(coreRoot, "docs/KNOWLEDGE-GOVERNANCE-POLICY.md"));
      await cp(path.resolve(sourceRoot, "../AGENTS.md"), path.join(workspaceRoot, "AGENTS.md"));
      // Dependências de código são compartilhadas; outputs/PESSOAS nunca são links.
      await symlink(path.join(sourceRoot, "node_modules"), path.join(coreRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      await mkdir(path.join(coreRoot, "outputs"));
      await mkdir(path.join(workspaceRoot, "PESSOAS"));
      const guardFile = path.join(temporary, "forbid-operational-inventory.mjs");
      const forbidden = [path.join(sourceRoot, "outputs"), path.resolve(sourceRoot, "../PESSOAS")];
      await writeFile(guardFile, `import fs from "node:fs";
  import fsp from "node:fs/promises";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { syncBuiltinESMExports } from "node:module";
  const normalize = value => { const absolute = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value)); return process.platform === "win32" ? absolute.toLowerCase() : absolute; };
  const forbidden = ${JSON.stringify(forbidden)}.map(normalize);
  function check(value) {
    const absolute = normalize(value);
    if (forbidden.some(root => absolute === root || absolute.startsWith(root + path.sep))) throw new Error("OPERATIONAL_MEDIA_ENUMERATION_FORBIDDEN");
  }
  for (const [object, method] of [[fs, "readdir"], [fs, "readdirSync"], [fsp, "readdir"], [fs, "opendir"], [fs, "opendirSync"], [fsp, "opendir"]]) {
    const original = object[method];
    object[method] = function (directory, ...args) { check(directory); return Reflect.apply(original, this, [directory, ...args]); };
  }
  syncBuiltinESMExports();
  `, "utf8");
      return { coreRoot, workspaceRoot, guardFile, preparationMs: Math.round(performance.now() - started),
        runNode: (args, options = {}) => execute(process.execPath, ["--import", pathToFileURL(guardFile).href, ...args], { ...options, cwd: coreRoot, windowsHide: true }),
        dispose: () => rm(temporary, { recursive: true, force: true }) };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  });
}
