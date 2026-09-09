#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { bootstrapTestFiles, combineTestGroups, runBounded, selectVerification, structuralChecks, summarizeTestEvents, worktreeSnapshot } from "./verification-plan.mjs";
import { planTestResources, recommendVerificationCapacities, runWithTestResources } from "./verification-resources.mjs";
import { createSyntaxEvidence } from "./verification-syntax-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const options = { mode: "full", scheduling: "resources", "test-concurrency": null, "heavy-concurrency": null, "local-concurrency": null,
  "gate-concurrency": null, "compile-cache": "on", "syntax-evidence": "on", profile: "on", "fail-fast": null };
const selectedFiles = [];
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index].replace(/^--/, "");
  if (key === "list") { options.list = true; continue; }
  if (key === "file") {
    if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error("--file exige um arquivo de teste.");
    selectedFiles.push(process.argv[++index]); continue;
  }
  if (!Object.hasOwn(options, key) || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`Opção inválida: ${process.argv[index]}`);
  options[key] = process.argv[++index];
}
if (!["resources", "legacy"].includes(options.scheduling)) throw new Error("--scheduling aceita resources ou legacy.");
options["fail-fast"] ??= options.scheduling === "resources" ? "on" : "off";
if (!["on", "off"].includes(options["fail-fast"])) throw new Error("--fail-fast aceita on ou off.");
if (options.scheduling === "legacy" && options["fail-fast"] === "on") throw new Error("--fail-fast on exige --scheduling resources; legacy executa um único grupo.");
const host = { logicalCpus: os.availableParallelism(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() };
const recommendedCapacities = recommendVerificationCapacities(host);
options["test-concurrency"] ??= options.scheduling === "resources" ? String(recommendedCapacities.concurrency) : "2";
options["gate-concurrency"] ??= options.scheduling === "resources" && recommendedCapacities.concurrency === 8 ? "8" : "2";
for (const key of ["test-concurrency", "gate-concurrency"]) {
  options[key] = Number(options[key]);
  if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 8) throw new Error(`${key} deve estar entre 1 e 8.`);
}
for (const key of ["heavy-concurrency", "local-concurrency"]) {
  if (options.scheduling === "legacy") {
    if (options[key] !== null) throw new Error(`--${key} exige --scheduling resources.`);
    continue;
  }
  const defaultCapacity = key === "heavy-concurrency" ? recommendedCapacities.heavy : recommendedCapacities.local;
  options[key] = options[key] === null ? Math.min(defaultCapacity, options["test-concurrency"]) : Number(options[key]);
  if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > options["test-concurrency"]) {
    throw new Error(`--${key} deve estar entre 1 e --test-concurrency.`);
  }
}
if (!["on", "off"].includes(options["compile-cache"])) throw new Error("--compile-cache aceita on ou off.");
if (!["on", "off"].includes(options.profile)) throw new Error("--profile aceita on ou off.");
if (!["on", "off"].includes(options["syntax-evidence"])) throw new Error("--syntax-evidence aceita on ou off.");
const started = performance.now();
const inferImpact = options.mode === "affected" && !selectedFiles.length;
const { inventory, ...before } = await worktreeSnapshot(root, { includeInventory: inferImpact });
const testFiles = (await readdir(path.join(root, "test"))).filter((file) => file.endsWith(".test.mjs")).map((file) => `test/${file}`).sort();
let impact = null;
if (inferImpact) {
  const { buildVerificationImpact } = await import("./verification-impact.mjs");
  impact = await buildVerificationImpact({ root, inventory, changed: before.changed, testFiles, cache: !options.list });
}
const selection = selectVerification({ mode: options.mode, changed: before.changed, testFiles, selectedFiles, impact });
const resourcePlan = options.scheduling === "resources"
  ? await planTestResources({ root, files: selection.files.filter((file) => !bootstrapTestFiles.includes(file)) }) : null;
if (options.list) {
  console.log(JSON.stringify({ options, host, recommendedCapacities, selection, resourcePlan, source: before, bootstrapFiles: bootstrapTestFiles, gates: structuralChecks.map(([name]) => name) }, null, 2));
} else {
  const directory = path.join(root, "diagnosticos", "verificacoes", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true });
  const reportFile = path.join(directory, "report.json");
  const env = { ...process.env, NODE_ENV: "test", MKT_VIDEOS_PROVIDER_FREE_TEST: "1" };
  delete env.MKT_VIDEOS_RUNTIME_DB;
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  delete env.MKT_VERIFICATION_PROFILE_DIR;
  delete env.MKT_VERIFICATION_RESOURCE_CLASS;
  delete env.MKT_VERIFICATION_RESOURCE_AUDIT;
  if (options["compile-cache"] === "on") {
    env.NODE_COMPILE_CACHE = path.join(root, ".cache", "verification", process.version);
    delete env.NODE_DISABLE_COMPILE_CACHE;
  } else {
    delete env.NODE_COMPILE_CACHE;
    env.NODE_DISABLE_COMPILE_CACHE = "1";
  }
  const report = { schema: "gerador-de-videos/verification@1", status: "running", startedAt: new Date().toISOString(),
    node: process.version, platform: process.platform, arch: process.arch, options, host, recommendedCapacities, source: before, selection, resourcePlan,
    resultCache: "disabled", compileCache: options["compile-cache"], syntax: [], bootstrap: null, gates: [], tests: null };
  const save = async () => {
    const temporary = `${reportFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temporary, reportFile);
  };
  await save();
  console.log(`[check] ${selection.scope}: ${selection.reason}`);
  console.log(`[check] Relatório: ${reportFile}`);
  const syntaxEvidence = createSyntaxEvidence({ root, env, enabled: options["syntax-evidence"] === "on", reuse: selection.scope !== "full" });
  const run = async (name, args, extraEnv = {}, input = null) => {
    const start = performance.now();
    const logFile = path.join(directory, `${name}.log`);
    const fd = openSync(logFile, "wx");
    console.log(`[check] Início: ${name}`);
    let tail = "";
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, windowsHide: true, shell: false });
      const heartbeat = setInterval(() => console.log(`[check] Em execução: ${name} (${Math.round((performance.now() - start) / 1000)} s; log: ${logFile})`), 30_000);
      const capture = (chunk) => { writeSync(fd, chunk); tail = `${tail}${chunk}`.slice(-12000); };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      let spawnError = null;
      if (input !== null) {
        child.stdin.on("error", (error) => { if (error.code !== "EPIPE") spawnError ??= error.message; });
        child.stdin.end(input);
      }
      child.on("error", (error) => { spawnError = error.message; });
      child.on("close", (exitCode, signal) => { clearInterval(heartbeat); resolve({ exitCode, signal, ...(spawnError ? { error: spawnError } : {}) }); });
    });
    closeSync(fd);
    const row = { name, ...result, status: result.exitCode === 0 ? "passed" : "failed", durationMs: Math.round(performance.now() - start), logFile, args };
    console.log(`[check] ${row.status}: ${name} (${row.durationMs} ms)`);
    if (row.status === "failed") console.error(tail);
    return row;
  };
  const syntaxFiles = [];
  for (const file of before.changed.filter((file) => /\.(?:mjs|cjs|js)$/.test(file))) {
    try { if ((await stat(path.join(root, file))).isFile()) syntaxFiles.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const profileDirectory = path.join(directory, "subprocesses");
  if (options.profile === "on") await mkdir(profileDirectory);
  const runTests = async (name, files, resource = null) => {
    const eventsFile = path.join(directory, name + ".jsonl");
    const auditFile = path.join(directory, name + ".resources.jsonl");
    const row = await run(name, ["--import", "./test/test-environment.mjs", "--test", "--test-concurrency=" + options["test-concurrency"],
      "--test-reporter=spec", "--test-reporter=./scripts/verification-reporter.mjs", "--test-reporter-destination=stdout", "--test-reporter-destination=" + eventsFile, ...files],
      { ...(options.profile === "on" ? { MKT_VERIFICATION_PROFILE_DIR: profileDirectory } : {}),
        ...(resource ? { MKT_VERIFICATION_RESOURCE_CLASS: resource, MKT_VERIFICATION_RESOURCE_AUDIT: auditFile } : {}) });
    let events = [];
    try { events = (await readFile(eventsFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
    catch (error) { row.error = "Relatório de testes indisponível: " + (error.code ?? error.name); }
    const summary = summarizeTestEvents(events, files, root);
    if (resource) {
      let violations = [];
      try { violations = (await readFile(auditFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      row.resourceAudit = { resource, violations };
      if (violations.length) row.error = "Teste abriu ferramenta fora da classe declarada; atualizar a classificação após análise, sem retry automático.";
    }
    if (name === "bootstrap" && summary.summaries.findLast((event) => !event.file)?.counts?.skipped > 0) row.error = "Bootstrap obrigatório não aceita testes ignorados.";
    if (row.error || summary.error) { row.status = "failed"; console.error("[check] " + name + ": " + (row.error ?? summary.error)); }
    return { ...row, ...summary, files, eventsFile, events };
  };
  const syntaxPreparationStarted = performance.now();
  const syntaxInputs = await runBounded(syntaxFiles, options["gate-concurrency"], (file) => syntaxEvidence.prepare(file));
  const syntaxProofs = await syntaxEvidence.lookupBatch(syntaxInputs);
  const syntaxPreparationMs = Math.round(performance.now() - syntaxPreparationStarted);
  report.syntax = await runBounded(syntaxFiles, options["gate-concurrency"], async (file, index) => {
    const start = performance.now();
    const prepared = syntaxInputs[index];
    const reused = syntaxProofs[index];
    const args = prepared ? ["--check", `--input-type=${prepared.input.format}`] : ["--check", file];
    const name = `syntax-${index}`;
    if (reused) {
      console.log(`[check] reused: ${name} (${file})`);
      return { name, file, args, status: "passed", execution: "reused", exitCode: null,
        durationMs: Math.round(performance.now() - start), evidence: reused, syntaxInput: prepared.input };
    }
    const row = await run(name, args, {}, prepared?.source ?? null);
    if (row.status !== "passed") console.error(`[check] Sintaxe inválida em ${file}`);
    return { ...row, file, execution: "executed", ...(prepared ? { syntaxInput: prepared.input } : {}) };
  });
  let bootstrapGroup = null;
  if (report.syntax.every((row) => row.status === "passed")) {
    const parallelPrechecks = options.scheduling === "resources" && options["test-concurrency"] > 1 && options["gate-concurrency"] > 1;
    report.prechecks = { scheduling: parallelPrechecks ? "parallel" : "sequential", gateConcurrency: options["gate-concurrency"],
      limitation: "Bootstrap e verificadores provider-free de leitura são independentes. A suíte principal exige aprovação de ambos; seus limites internos permanecem separados." };
    if (parallelPrechecks) {
      const results = await Promise.allSettled([
        runTests("bootstrap", bootstrapTestFiles),
        runBounded(structuralChecks, options["gate-concurrency"], ([name, ...args]) => run(name, args)),
      ]);
      // Espera os dois ramos antes de propagar uma falha inesperada.
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
      bootstrapGroup = results[0].value;
      report.gates = results[1].value;
    } else {
      bootstrapGroup = await runTests("bootstrap", bootstrapTestFiles);
      if (bootstrapGroup.status === "passed") report.gates = await runBounded(structuralChecks, options["gate-concurrency"], ([name, ...args]) => run(name, args));
    }
    const { events: _events, ...bootstrapReport } = bootstrapGroup;
    report.bootstrap = bootstrapReport;
    await save();
  }
  await save();
  if (report.bootstrap?.status === "passed" && report.gates.length === structuralChecks.length && report.gates.every((gate) => gate.status === "passed") && selection.files.length) {
    const groups = [];
    if (bootstrapTestFiles.every((file) => selection.files.includes(file))) groups.push(bootstrapGroup);
    const remainingFiles = selection.files.filter((file) => !bootstrapTestFiles.includes(file));
    if (remainingFiles.length && resourcePlan) {
      const scheduled = await runWithTestResources(resourcePlan, { concurrency: options["test-concurrency"], heavy: options["heavy-concurrency"], local: options["local-concurrency"],
        stopOnResult: (result) => options["fail-fast"] === "on" && result.status !== "passed" },
        (job) => runTests(`suite-${job.index}`, [job.file], job.resource));
      groups.push(...scheduled.results);
      if (scheduled.stoppedBy) console.error(`[check] Fila encerrada após falha em ${scheduled.stoppedBy}; ${scheduled.notStarted.length} arquivos não iniciados. Processos já admitidos foram concluídos.`);
      report.resourceSchedule = { ...scheduled, results: undefined, limitation: "Capacidades contam arquivos admitidos. Subprocessos internos de cada arquivo mantêm sua concorrência própria. Esperas e execuções podem se sobrepor." };
      const suite = combineTestGroups(scheduled.results, remainingFiles, root);
      await writeFile(path.join(directory, "suite.jsonl"), suite.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    } else if (remainingFiles.length) groups.push(await runTests("suite", remainingFiles));
    const combined = combineTestGroups(groups, selection.files, root);
    report.tests = combined.report;
    if (report.resourceSchedule) report.tests.notStarted = report.resourceSchedule.notStarted;
    if (report.resourceSchedule) report.tests.durationMs = report.resourceSchedule.durationMs + (groups.includes(bootstrapGroup) ? bootstrapGroup.durationMs : 0);
    report.tests.eventsFile = path.join(directory, "tests.jsonl");
    await writeFile(report.tests.eventsFile, combined.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  }
  if (options.profile === "on" && bootstrapGroup) {
    const rows = (await Promise.all((await readdir(profileDirectory)).map(async (file) => (await readFile(path.join(profileDirectory, file), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)))).flat();
    const spans = rows.filter((row) => row.type === "subprocess");
    const groups = new Map();
    for (const span of spans) {
      const key = span.owner + ":" + span.command;
      const group = groups.get(key) ?? { owner: span.owner, command: span.command, count: 0, cumulativeMs: 0, maximumMs: 0 };
      group.count++; group.cumulativeMs += span.durationMs; group.maximumMs = Math.max(group.maximumMs, span.durationMs); groups.set(key, group);
    }
    const preparation = rows.filter((row) => row.type === "fixture-preparation");
    const profile = { directory: profileDirectory, scope: "bootstrap-and-selected-tests", count: spans.length, processes: rows.filter((row) => row.type === "process-end"),
      preparation: { spans: preparation, count: preparation.length,
        limitation: "Preparações explicitamente instrumentadas de workspace e tons. Incluem subprocessos internos; chamadas simultâneas podem se sobrepor. Não subtrair a soma do tempo de parede nem tratar ausência de eventos como custo zero." },
      filesystem: { processes: rows.filter(row => row.type === "filesystem-access-summary"),
        limitation: "Contagem de tentativas por API e área lexical, sem caminhos/conteúdo. Não comprova sucesso nem resolve symlinks; descritores, FileHandle, loaders internos, APIs nativas e descendentes sem preload têm cobertura limitada. Não é sandbox nem autorização de I/O." },
      groups: [...groups.values()].sort((a, b) => b.cumulativeMs - a.cumulativeMs),
      limitation: "Inclui bootstrap e testes selecionados. Duração de subprocesso inclui inicialização e execução; somas podem se sobrepor e não são tempo de parede. Descendentes sem preload não são instrumentados internamente. Sem argumentos, ambiente ou conteúdo de saída." };
    report.subprocessProfile = profile;
    if (report.tests) report.tests.subprocessProfile = profile;
  }
  report.sourceAfter = await worktreeSnapshot(root);
  report.sourceStable = before.fingerprint === report.sourceAfter.fingerprint && before.revision === report.sourceAfter.revision;
  report.syntaxEvidence = { ...syntaxEvidence.describe(), engineStable: await syntaxEvidence.verifyEngine(),
    preparationMs: syntaxPreparationMs,
    executed: report.syntax.filter((row) => row.execution === "executed").length,
    reused: report.syntax.filter((row) => row.execution === "reused").length,
    publicationFile: path.join(directory, "syntax-evidence-publication.json") };
  if (report.syntaxEvidence.reused) report.resultCache = "syntax-evidence-only";
  const failed = !report.syntaxEvidence.engineStable || report.bootstrap?.status === "failed" || report.syntax.some((row) => row.status !== "passed") || report.gates.some((gate) => gate.status !== "passed") || report.tests?.status === "failed";
  report.status = failed ? "failed" : !report.sourceStable ? "source-changed" : selection.scope === "full" ? "passed" : "partial-passed";
  report.completedAt = new Date().toISOString();
  report.durationMs = Math.round(performance.now() - started);
  await save();
  try {
    const publication = await syntaxEvidence.publish(report, reportFile);
    await writeFile(report.syntaxEvidence.publicationFile, JSON.stringify(publication, null, 2) + "\n");
  } catch (error) {
    const publication = { schema: "gerador-de-videos/syntax-evidence-publication@1", published: 0, errors: [{ code: String(error.code ?? error.name) }] };
    await writeFile(report.syntaxEvidence.publicationFile, JSON.stringify(publication, null, 2) + "\n");
    console.error(`[check] Evidência sintática não publicada: ${error.code ?? error.name}. Resultado da verificação preservado.`);
  }
  console.log(`[check] ${report.status} — ${report.durationMs} ms — ${reportFile}`);
  if (report.status === "failed" || report.status === "source-changed") process.exitCode = 1;
}
