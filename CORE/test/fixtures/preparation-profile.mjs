import { appendFileSync } from "node:fs";
import path from "node:path";

const names = new Set(["isolated-cli-workspace", "synthetic-tone"]);

// Mede preparação conhecida; não infere que o restante seja apenas execução.
// O relatório não inclui caminhos de assets, parâmetros ou mensagens de erro.
export async function measureFixturePreparation(name, operation) {
  if (!names.has(name)) throw new Error("Preparação de fixture não declarada.");
  const directory = process.env.MKT_VERIFICATION_PROFILE_DIR;
  if (!directory) return operation();
  const start = performance.now();
  const startedAtMs = Date.now();
  let status = "failed";
  try {
    const result = await operation();
    status = "passed";
    return result;
  } finally {
    const testFile = process.argv.find((arg) => arg.endsWith(".test.mjs"));
    const row = { type: "fixture-preparation", owner: testFile ? path.basename(testFile) : "test-runner", pid: process.pid,
      name, startedAtMs, durationMs: performance.now() - start, status };
    try { appendFileSync(path.join(directory, `${process.pid}.jsonl`), JSON.stringify(row) + "\n"); }
    catch (error) {
      // Uma falha secundária de instrumentação não substitui a causa da
      // operação. Sem causa anterior, a perda da evidência permanece erro.
      if (status === "passed") throw error;
    }
  }
}
