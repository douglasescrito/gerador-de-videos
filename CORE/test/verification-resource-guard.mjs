// A classificação local/mídia não pode ocultar uma ferramenta nova.
// O arquivo de violações é privativo da rodada, separado do runtime produtivo.
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const resource = process.env.MKT_VERIFICATION_RESOURCE_CLASS;
const auditFile = process.env.MKT_VERIFICATION_RESOURCE_AUDIT;
if (resource && auditFile && process.argv.some((arg) => arg.endsWith(".test.mjs"))) {
  const check = (command) => {
    const name = path.basename(String(command)).toLowerCase().replace(/\.exe$/, "");
    if (["exclusive", "process"].includes(resource) || resource === "media" && ["ffmpeg", "ffprobe"].includes(name)) return;
    appendFileSync(auditFile, JSON.stringify({ resource, command: ["node", "ffmpeg", "ffprobe", "git"].includes(name) ? name : "other" }) + "\n");
    throw new Error("VERIFICATION_RESOURCE_UNDECLARED");
  };
  const spawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function (options) { check(options.file); return spawn.call(this, options); };
  for (const api of ["spawnSync", "execFileSync", "execSync"]) {
    const original = childProcess[api];
    childProcess[api] = function (...args) { check(api === "execSync" ? "shell" : args[0]); return Reflect.apply(original, this, args); };
  }
  syncBuiltinESMExports();
}
