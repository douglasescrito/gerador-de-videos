// Opt-in pelo runner de testes. Não registra argumentos, ambiente nem saída.
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const directory = process.env.MKT_VERIFICATION_PROFILE_DIR;
if (directory) {
  const file = path.join(directory, `${process.pid}.jsonl`);
  const testFile = process.argv.find((arg) => arg.endsWith(".test.mjs"));
  const owner = testFile ? path.basename(testFile) : "test-runner";
  const record = (value) => appendFileSync(file, `${JSON.stringify({ owner, pid: process.pid, ...value })}\n`);
  const category = (command) => {
    const name = path.basename(String(command ?? "")).toLowerCase().replace(/\.exe$/, "");
    return ["node", "ffmpeg", "ffprobe", "git", "python", "python3", "py", "powershell", "pwsh", "cmd"].includes(name) ? name : "other";
  };
  const begin = (api, command) => ({ api, command: category(command), startedAtMs: Date.now(), start: performance.now() });
  const end = ({ start, ...span }, result = {}) => record({ type: "subprocess", ...span,
    durationMs: performance.now() - start, exitCode: result.status ?? result.exitCode ?? null,
    signal: result.signal ?? null, error: result.error ? String(result.error.code ?? result.error.name ?? "Error") : null });

  // Instrumentar o ponto comum preserva execFile/exec/fork e seus callbacks.
  const originalSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function (options) {
    const span = begin("async", options.file);
    const closed = (exitCode, signal) => end(span, { exitCode, signal });
    this.once("close", closed);
    try { return originalSpawn.call(this, options); }
    catch (value) { this.removeListener("close", closed); end(span, { error: value }); throw value; }
  };
  // As APIs síncronas usam bindings internos, não o método acima.
  for (const api of ["spawnSync", "execFileSync", "execSync"]) {
    const original = childProcess[api];
    childProcess[api] = function (...args) {
      const span = begin(api, api === "execSync" ? "shell" : args[0]);
      try { const result = Reflect.apply(original, this, args); end(span, api === "spawnSync" ? result : { status: 0 }); return result; }
      catch (error) { end(span, { status: error.status, signal: error.signal, error }); throw error; }
    };
  }
  syncBuiltinESMExports();
  record({ type: "process-start", startedAtMs: Date.now(), uptimeMs: process.uptime() * 1000 });
  process.once("exit", () => record({ type: "process-end", uptimeMs: process.uptime() * 1000, cpuUsage: process.cpuUsage(), maxRssKb: process.resourceUsage().maxRSS }));
}
