// Inventário de chamadas públicas de fs, sem caminhos ou conteúdo no relatório.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

const directory = process.env.MKT_VERIFICATION_PROFILE_DIR;
if (directory) {
  const append = fs.appendFileSync;
  const normalize = value => {
    const text = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
    if (typeof text !== "string") return null;
    const absolute = path.resolve(text);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  const root = path.resolve(import.meta.dirname, "..");
  const inside = (file, base) => file === base || file.startsWith(base + path.sep);
  const roots = [
    ["verification-artifacts", directory],
    ["operational-outputs", path.join(root, "outputs")],
    ["operational-people", path.resolve(root, "../PESSOAS")],
    ...(process.env.LOCALAPPDATA ? [["operational-knowledge", path.join(process.env.LOCALAPPDATA, "GeradorDeVideos/Knowledge")],
      ["browser-sessions", path.join(process.env.LOCALAPPDATA, "GeradorDeVideos/BrowserSessions")]] : []),
    ["dependencies", path.join(root, "node_modules")],
    ["workspace-other", root],
    ["temporary", os.tmpdir()],
  ].map(([name, base]) => [name, normalize(base)]);
  const bucket = value => {
    if (typeof value === "number") return "descriptor";
    try {
      const file = normalize(value);
      return file === null ? "unresolved" : roots.find(([, base]) => inside(file, base))?.[0] ?? "outside-workspace";
    } catch { return "unresolved"; }
  };
  const rows = new Map();
  const record = (api, role, value) => {
    const area = bucket(value);
    if (area === "verification-artifacts") return;
    const key = `${api}:${role}:${area}`;
    const row = rows.get(key) ?? { api, role, area, calls: 0 };
    row.calls++;
    rows.set(key, row);
  };
  const operations = {
    read: ["readFile", "readdir", "opendir", "stat", "lstat", "statfs", "access", "exists", "readlink", "realpath", "createReadStream", "glob", "watch", "watchFile"],
    write: ["writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "truncate", "chmod", "chown", "lchmod", "lchown", "utimes", "lutimes", "createWriteStream"],
    open: ["open"],
    descriptor: ["read", "readv", "write", "writev", "fstat", "fchmod", "fchown", "ftruncate", "fsync", "fdatasync", "futimes", "close"],
    pair: ["rename", "copyFile", "cp", "link", "symlink"],
  };
  for (const [object, prefix, suffixes] of [[fs, "fs", ["", "Sync"]], [fsp, "fs/promises", [""]]]) {
    for (const [role, names] of Object.entries(operations)) for (const name of names) for (const suffix of suffixes) {
      const method = name + suffix;
      const original = object[method];
      if (typeof original !== "function") continue;
      function instrumented(...args) {
        record(`${prefix}.${method}`, role === "pair" ? "source" : role, args[0]);
        if (role === "pair") record(`${prefix}.${method}`, "destination", args[1]);
        return Reflect.apply(original, this, args);
      }
      // Preservar promisify.custom e realpath.native; as rotas que bypassam
      // esta chamada não são contadas como se tivessem sido observadas.
      for (const key of Reflect.ownKeys(original).filter(key => !["name", "length", "prototype", "arguments", "caller"].includes(key))) {
        Object.defineProperty(instrumented, key, Object.getOwnPropertyDescriptor(original, key));
      }
      object[method] = instrumented;
    }
  }
  syncBuiltinESMExports();
  const testFile = process.argv.find(arg => arg.endsWith(".test.mjs"));
  process.once("exit", () => append(path.join(directory, `${process.pid}.jsonl`), JSON.stringify({
    type: "filesystem-access-summary", owner: testFile ? path.basename(testFile) : "test-runner", pid: process.pid,
    accesses: [...rows.values()].sort((a, b) => `${a.api}:${a.role}:${a.area}`.localeCompare(`${b.api}:${b.role}:${b.area}`)),
  }) + "\n"));
}
