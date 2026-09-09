#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

const runs = Number(option("runs", 20));
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100) throw new Error("--runs deve ficar entre 1 e 100.");
const outputFile = path.resolve(option("out", path.join("diagnosticos", "determinism-gate.json")));
const expectedSkips = Number(option("expected-skips", 3));
const concurrencyCycle = String(option("concurrency-cycle", "1,2,default")).split(",").map((value) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "default") return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--concurrency-cycle aceita inteiros positivos ou default.");
  return parsed;
});
if (!concurrencyCycle.length) throw new Error("--concurrency-cycle não pode ser vazio.");
const results = [];
const testFiles = (await readdir(path.resolve("test")))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join("test", name));
if (!testFiles.length) throw new Error("Nenhum teste core encontrado.");

function runSuite(concurrency, { files = testFiles, extraEnv = {}, extraArgs = [] } = {}) {
  const args = ["--import", "./test/test-environment.mjs", "--test", "--test-reporter=tap", ...(concurrency == null ? [] : [`--test-concurrency=${concurrency}`]), ...extraArgs, ...files];
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(process.execPath, args, { cwd: process.cwd(), shell: false, windowsHide: true, env: { ...process.env, MKT_VIDEOS_PROVIDER_FREE_TEST: "1", ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, args, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime(), stdout, stderr }));
  });
}

process.stderr.write("[determinism preflight] performance SLO isolado\n");
const performanceExecution = await runSuite(1, {
  files: [path.join("test", "operational-reports.test.mjs")],
  extraEnv: { MKT_VIDEOS_PERFORMANCE_GATE: "1" },
});
if (performanceExecution.code !== 0) {
  const failureFile = `${outputFile}.performance.failure.log`;
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(failureFile, `${performanceExecution.stdout}\n${performanceExecution.stderr}`, "utf8");
  throw new Error(`Gate isolado de performance falhou: ${failureFile}.`);
}
process.stderr.write("[determinism preflight] batch paralelo isolado\n");
const concurrencyExecution = await runSuite(1, {
  files: [path.join("test", "omni-cli.test.mjs")],
  extraArgs: ["--test-name-pattern", "batch limita concorrência"],
  extraEnv: { MKT_VIDEOS_CONCURRENCY_GATE: "1" },
});
if (concurrencyExecution.code !== 0) {
  const failureFile = `${outputFile}.concurrency.failure.log`;
  await writeFile(failureFile, `${concurrencyExecution.stdout}\n${concurrencyExecution.stderr}`, "utf8");
  throw new Error(`Gate isolado de batch paralelo falhou: ${failureFile}.`);
}

for (let index = 0; index < runs; index += 1) {
  const concurrency = concurrencyCycle[index % concurrencyCycle.length];
  process.stderr.write(`[determinism ${index + 1}/${runs}] concurrency=${concurrency ?? "default"}\n`);
  const execution = await runSuite(concurrency, { extraEnv: { MKT_VIDEOS_TEST_CONCURRENCY: concurrency == null ? "default" : String(concurrency) } });
  const summary = Object.fromEntries([...execution.stdout.matchAll(/(?:^|\n)[^\S\r\n]*(?:#|[ℹ✔✖﹣-])?\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)/gu)].map((match) => [match[1], Number(match[2])]));
  const skipNames = execution.stdout.split(/\r?\n/u).filter((line) => /# SKIP\b/i.test(line)).slice(0, 20);
  const result = { run: index + 1, concurrency: concurrency ?? "default", exitCode: execution.code, durationMs: execution.durationMs, summary, skipNames };
  results.push(result);
  const baselineSummary = results[0]?.summary;
  const summaryStable = index === 0 || ["tests", "pass", "fail", "cancelled", "skipped", "todo"].every((key) => summary[key] === baselineSummary[key]);
  if (execution.code !== 0 || !(summary.tests > 0) || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== expectedSkips || skipNames.length !== expectedSkips || !summaryStable) {
    await mkdir(path.dirname(outputFile), { recursive: true });
    const failureFile = `${outputFile}.run-${index + 1}.failure.log`;
    await writeFile(failureFile, `${execution.stdout}\n${execution.stderr}`, "utf8");
    const tail = `${execution.stdout}\n${execution.stderr}`.split(/\r?\n/u).slice(-80).join("\n");
    throw new Error(`Gate falhou na execução ${index + 1}: ${JSON.stringify({ summary, skipNames, summaryStable, failureFile })}.\n${tail}`);
  }
}

const report = {
  schema: "mkt-videos/determinism-gate@1",
  generatedAt: new Date().toISOString(),
  providerCalls: 0,
  requestedRuns: runs,
  completedRuns: results.length,
  concurrencyCycle: concurrencyCycle.map((value) => value ?? "default"),
  expectedNamedSkips: expectedSkips,
  status: "passed",
  performanceGate: { status: "passed", durationMs: performanceExecution.durationMs, target: "jobs-1000 < 2000ms" },
  concurrencyGate: { status: "passed", durationMs: concurrencyExecution.durationMs, target: "batch parallel=3" },
  results,
};
await mkdir(path.dirname(outputFile), { recursive: true });
const temporary = `${outputFile}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await rename(temporary, outputFile);
console.log(JSON.stringify({ status: report.status, completedRuns: report.completedRuns, outputFile, providerCalls: 0 }, null, 2));
