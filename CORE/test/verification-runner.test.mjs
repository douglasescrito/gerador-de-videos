import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bootstrapTestFiles, combineTestGroups, runBounded, selectVerification, structuralChecks, summarizeTestEvents, worktreeSnapshot } from "../scripts/verification-plan.mjs";

const execute = promisify(execFile);

test("inventário filesystem preserva APIs, erros e privacidade sem gravar caminhos", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "filesystem-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = path.join(root, "profile");
  await mkdir(profile);
  const source = `
    import assert from 'node:assert/strict';
    import fs, { readFileSync } from 'node:fs';
    import fsp from 'node:fs/promises';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    import { promisify } from 'node:util';
    const file = path.join(process.env.PROFILE_TEST_ROOT, 'private-file.txt');
    fs.writeFileSync(file, 'private-content');
    assert.equal(readFileSync(Buffer.from(file), 'utf8'), 'private-content');
    assert.equal(await fsp.readFile(pathToFileURL(file), 'utf8'), 'private-content');
    assert.equal(await promisify(fs.readFile)(file, 'utf8'), 'private-content');
    assert.equal(fs.realpathSync.native(file), fs.realpathSync(file));
    const handle = fs.openSync(file, 'r');
    assert.equal(fs.readFileSync(handle, 'utf8'), 'private-content');
    fs.closeSync(handle);
    let content = '';
    for await (const chunk of fs.createReadStream(file)) content += chunk;
    assert.equal(content, 'private-content');
    await fsp.copyFile(file, file + '.copy');
    assert.throws(() => fs.readFileSync(file + '.missing'), { code: 'ENOENT' });
    await assert.rejects(fsp.readFile(file + '.missing'), { code: 'ENOENT' });
    assert.throws(() => fs.readFileSync({}), { code: 'ERR_INVALID_ARG_TYPE' });
    console.log('preserved');
  `;
  const result = await execute(process.execPath, ["--import", new URL("./filesystem-profile.mjs", import.meta.url).href,
    "--input-type=module", "--eval", source], { windowsHide: true,
    env: { ...process.env, MKT_VERIFICATION_PROFILE_DIR: profile, PROFILE_TEST_ROOT: root } });
  assert.equal(result.stdout.trim(), "preserved");
  const files = await readdir(profile);
  assert.equal(files.length, 1);
  const text = await readFile(path.join(profile, files[0]), "utf8");
  assert.ok(!text.includes(root));
  assert.ok(!text.includes("private-file"));
  assert.ok(!text.includes("private-content"));
  const row = JSON.parse(text);
  assert.equal(row.type, "filesystem-access-summary");
  const observed = (api, role, area) => row.accesses.find(entry => entry.api === api && entry.role === role && entry.area === area)?.calls ?? 0;
  assert.ok(observed("fs.readFileSync", "read", "temporary") >= 2);
  assert.ok(observed("fs.readFileSync", "read", "descriptor") >= 1);
  assert.ok(observed("fs.readFileSync", "read", "unresolved") >= 1);
  assert.equal(observed("fs/promises.copyFile", "source", "temporary"), 1);
  assert.equal(observed("fs/promises.copyFile", "destination", "temporary"), 1);
  assert.ok(row.accesses.every(entry => Number.isSafeInteger(entry.calls) && entry.calls > 0));
  assert.ok(row.accesses.every(entry => entry.area !== "verification-artifacts"));
});

test("seleção distingue estrutura, testes alterados e regressão conservadora", () => {
  const testFiles = ["test/a.test.mjs", "test/b.test.mjs"];
  const fastFiles = ["test/cli-errors.test.mjs", "test/direction-presets.test.mjs"];
  const fast = selectVerification({ mode: "fast", changed: [], testFiles: [...testFiles, ...fastFiles] });
  assert.equal(fast.scope, "fast");
  assert.deepEqual(fast.files, fastFiles);
  assert.throws(() => selectVerification({ mode: "fast", changed: [], testFiles }), /Contrato obrigatório/);
  const stressFiles = ["test/direct-video-multiprocess.test.mjs", "test/mixed-routes-multiprocess.test.mjs", "test/production-pool.test.mjs", "test/resource-broker-multiprocess.test.mjs"];
  assert.deepEqual(selectVerification({ mode: "stress", changed: [], testFiles: [...testFiles, ...stressFiles] }).files, stressFiles);
  assert.equal(selectVerification({ mode: "stress", changed: [], testFiles: stressFiles }).scope, "stress");
  assert.throws(() => selectVerification({ mode: "stress", changed: [], testFiles: stressFiles.slice(1) }), /Contrato obrigatório de concorrência/);
  assert.deepEqual(selectVerification({ mode: "affected", changed: [testFiles[0]], testFiles }).files, [testFiles[0]]);
  for (const changed of [[], ["lib/a.mjs"], ["test/fixtures/input.json"], ["test/deleted.test.mjs"], ["docs/AGENT-CONTRACT.md"]]) {
    assert.equal(selectVerification({ mode: "affected", changed, testFiles }).scope, "full");
  }
  assert.throws(() => selectVerification({ mode: "unknown", changed: [], testFiles }), /Modo desconhecido/);
  const selected = selectVerification({ mode: "affected", changed: ["lib/a.mjs"], testFiles, selectedFiles: [testFiles[1], testFiles[1]] });
  assert.equal(selected.scope, "targeted");
  assert.deepEqual(selected.files, [testFiles[1]]);
  assert.throws(() => selectVerification({ mode: "full", changed: [], testFiles, selectedFiles: [testFiles[0]] }), /nunca é regressão completa/);
  assert.throws(() => selectVerification({ mode: "affected", changed: [], testFiles, selectedFiles: ["test/missing.test.mjs"] }), /não descoberto/);
});

test("gates respeitam o teto e preservam falha sem repetir o trabalho", async () => {
  let active = 0;
  let maximum = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const result = await runBounded([0, 1, 2, 3], 2, async (value) => {
    calls.push(value);
    maximum = Math.max(maximum, ++active);
    if (active === 2) release();
    await barrier;
    active--;
    return value === 1 ? "failed" : "passed";
  });
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.deepEqual(result, ["passed", "failed", "passed", "passed"]);
  await assert.rejects(runBounded([], 0, async () => {}), /Concorrência inválida/);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "verification-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([mkdir(path.join(root, "scripts")), mkdir(path.join(root, "test"))]);
  for (const file of ["run-verification.mjs", "verification-plan.mjs", "verification-reporter.mjs", "verification-impact.mjs", "verification-resources.mjs", "verification-syntax-evidence.mjs"]) {
    let source = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    // A miniatura mantém o algoritmo real e usa seu contrato de exemplo no
    // manifesto rápido. O manifesto produtivo é verificado no teste acima.
    if (file === "verification-plan.mjs") source = source.replace(/const fastTestFiles = \[[^\n]+\];/, 'const fastTestFiles = ["test/example.test.mjs"];');
    await writeFile(path.join(root, "scripts", file), source.replace('from "acorn"', `from ${JSON.stringify(import.meta.resolve("acorn"))}`)
      .replaceAll('import.meta.resolve("acorn")', JSON.stringify(import.meta.resolve("acorn"))));
  }
  const gate = 'if (process.env.NODE_ENV !== "test" || process.env.MKT_VIDEOS_RUNTIME_DB) throw new Error("isolamento ausente"); if (process.env.VERIFICATION_FIXTURE_GATE_FAIL === "yes") process.exitCode = 1;';
  for (const file of new Set(structuralChecks.map(([, file]) => file))) await writeFile(path.join(root, file), gate);
  await writeFile(path.join(root, ".gitignore"), "diagnosticos/\n.cache/\n");
  await writeFile(path.join(root, "test/test-environment.mjs"), await readFile(new URL("./test-environment.mjs", import.meta.url)));
  await writeFile(path.join(root, "test/verification-resource-guard.mjs"), await readFile(new URL("./verification-resource-guard.mjs", import.meta.url)));
  await writeFile(path.join(root, "test/subprocess-profile.mjs"), await readFile(new URL("./subprocess-profile.mjs", import.meta.url)));
  await writeFile(path.join(root, "test/filesystem-profile.mjs"), await readFile(new URL("./filesystem-profile.mjs", import.meta.url)));
  for (const file of bootstrapTestFiles) await writeFile(path.join(root, file), `import test from "node:test";
test("bootstrap fixture", { skip: process.env.VERIFICATION_FIXTURE_BOOTSTRAP_SKIP === "yes" }, () => { if (process.env.VERIFICATION_FIXTURE_BOOTSTRAP_FAIL === "yes") throw new Error("falha de bootstrap"); });`);
  await writeFile(path.join(root, "test/example.test.mjs"), `import test from "node:test"; import { writeFileSync } from "node:fs";
test("fixture", () => { if (process.env.VERIFICATION_FIXTURE_TEST_FAIL === "yes") throw new Error("falha prevista");
if (process.env.VERIFICATION_FIXTURE_MUTATE === "yes") writeFileSync("tracked.txt", "mudou"); });
test("skip explícito", { skip: "fixture" }, () => {});`);
  await writeFile(path.join(root, "tracked.txt"), "original");
  const git = (...args) => execute("git", args, { cwd: root, windowsHide: true });
  await git("init");
  await git("add", ".");
  await git("-c", "user.name=Verification Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  return { root, run: async (mode, extraEnv = {}, extraArgs = []) => {
    const before = await readdir(path.join(root, "diagnosticos/verificacoes")).catch(() => []);
    let code = 0;
    let output = "";
    // A evidência de sintaxe se desliga sozinha diante de qualquer NODE_* que
    // ela não conheça — é assim que ela evita reusar aprovação sob outra
    // partida do Node. Quem estiver rodando a suíte pode ter uma dessas
    // variáveis no ambiente (NODE_OPTIONS, NODE_USE_SYSTEM_CA), e aí o reuso
    // que este teste afirma nunca aconteceria. O ambiente do subprocesso é
    // entrada do teste: ele precisa ser dado, não herdado.
    const environment = { ...process.env, MKT_VIDEOS_RUNTIME_DB: "must-not-be-inherited.sqlite", ...extraEnv };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("NODE_") && !["NODE_ENV", "NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE", "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S"].includes(key)) delete environment[key];
    }
    try { await execute(process.execPath, ["scripts/run-verification.mjs", "--mode", mode, ...extraArgs], { cwd: root, windowsHide: true, timeout: 60_000,
      env: environment }); }
    catch (error) { if (typeof error.code !== "number") throw error; code = error.code; output = `${error.stdout}\n${error.stderr}`; }
    const directory = (await readdir(path.join(root, "diagnosticos/verificacoes"))).find((entry) => !before.includes(entry));
    assert.ok(directory, "relatório deve existir");
    const report = JSON.parse(await readFile(path.join(root, "diagnosticos/verificacoes", directory, "report.json"), "utf8"));
    return { code, report, output };
  } };
}

test("runner completo comprova totais; fast não declara integração e falha barata impede a suíte", async (t) => {
  const { run } = await fixture(t);
  const full = await run("full", {}, ["--test-concurrency", "4", "--heavy-concurrency", "3", "--local-concurrency", "1"]);
  assert.equal(full.code, 0, full.output);
  assert.equal(full.report.status, "passed");
  assert.equal(full.report.sourceStable, true);
  assert.match(full.report.source.testSourceHashes["test/example.test.mjs"], /^[a-f0-9]{64}$/);
  assert.deepEqual(full.report.source.testSourceHashes, full.report.sourceAfter.testSourceHashes);
  assert.equal(full.report.gates.length, 9);
  const totals = full.report.tests.summaries.findLast((event) => !event.file).counts;
  assert.equal(totals.tests, 3);
  assert.equal(totals.skipped, 1);
  assert.equal(full.report.resultCache, "disabled");
  assert.ok(full.report.tests.subprocessProfile.processes.length > 0);
  assert.equal(full.report.bootstrap.status, "passed");
  assert.equal(full.report.tests.requestedFiles, 2);
  assert.equal(full.report.tests.observedFiles, 2);
  assert.deepEqual(full.report.resourceSchedule.capacities, { concurrency: 4, heavy: 3, local: 1 });
  assert.deepEqual(full.report.tests.groups.map((group) => group.files), [bootstrapTestFiles, ["test/example.test.mjs"]]);
  const fast = await run("fast");
  assert.equal(fast.code, 0);
  assert.equal(fast.report.status, "partial-passed");
  assert.equal(fast.report.tests.status, "passed");
  assert.equal(fast.report.tests.requestedFiles, 1);
  assert.equal(fast.report.tests.observedFiles, 1);
  assert.deepEqual(fast.report.selection.files, ["test/example.test.mjs"]);
  assert.equal(fast.report.bootstrap.status, "passed");
  const targeted = await run("affected", {}, ["--file", "test/example.test.mjs", "--profile", "off"]);
  assert.equal(targeted.code, 0, targeted.output);
  assert.equal(targeted.report.status, "partial-passed");
  assert.equal(targeted.report.selection.scope, "targeted");
  assert.equal(targeted.report.tests.requestedFiles, 1);
  assert.equal(targeted.report.tests.subprocessProfile, undefined);
  const bootstrapOnly = await run("affected", {}, ["--file", bootstrapTestFiles[0]]);
  assert.equal(bootstrapOnly.code, 0, bootstrapOnly.output);
  assert.equal(bootstrapOnly.report.status, "partial-passed");
  assert.deepEqual(bootstrapOnly.report.tests.groups.map((group) => group.name), ["bootstrap"]);
  const failure = await run("full", { VERIFICATION_FIXTURE_GATE_FAIL: "yes" });
  assert.equal(failure.code, 1);
  assert.equal(failure.report.status, "failed");
  assert.equal(failure.report.tests, null);
});

test("falha de teste e mudança de código durante a rodada nunca geram verde", async (t) => {
  const { run } = await fixture(t);
  const failed = await run("full", { VERIFICATION_FIXTURE_TEST_FAIL: "yes" });
  assert.equal(failed.code, 1);
  assert.equal(failed.report.status, "failed");
  const fastFailed = await run("fast", { VERIFICATION_FIXTURE_TEST_FAIL: "yes" });
  assert.equal(fastFailed.code, 1);
  assert.equal(fastFailed.report.status, "failed");
  assert.equal(fastFailed.report.tests.observedFiles, 1);
  const changed = await run("full", { VERIFICATION_FIXTURE_MUTATE: "yes" });
  assert.equal(changed.code, 1);
  assert.equal(changed.report.status, "source-changed");
  assert.equal(changed.report.sourceStable, false);
});

test("fail-fast do runner lista arquivos não iniciados; off conserva diagnóstico completo", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(path.join(root, "test/example.test.mjs"), 'import test from "node:test"; test("FIRST_FAILURE", () => { throw new Error("ORIGINAL_CAUSE"); });');
  await writeFile(path.join(root, "test/z-pending.test.mjs"), 'import test from "node:test"; import { writeFileSync } from "node:fs"; test("PENDING_SENTINEL", () => writeFileSync("diagnosticos/pending-ran.txt", "executed"));');
  const stopped = await run("full", {}, ["--test-concurrency", "1", "--profile", "off"]);
  assert.equal(stopped.code, 1);
  assert.equal(stopped.report.status, "failed");
  assert.equal(stopped.report.options["fail-fast"], "on");
  assert.equal(stopped.report.tests.requestedFiles, 3);
  assert.equal(stopped.report.tests.observedFiles, 2);
  assert.deepEqual(stopped.report.tests.notStarted, [{ file: "test/z-pending.test.mjs", reason: "stopped-after-failure" }]);
  assert.equal(stopped.report.resourceSchedule.stoppedBy, "test/example.test.mjs");
  assert.match(stopped.output, /ORIGINAL_CAUSE/);
  assert.ok(!stopped.report.tests.groups.some((group) => group.files.includes("test/z-pending.test.mjs")));
  await assert.rejects(readFile(path.join(root, "diagnosticos/pending-ran.txt")), { code: "ENOENT" });
  const full = await run("full", {}, ["--test-concurrency", "1", "--profile", "off", "--fail-fast", "off"]);
  assert.equal(full.code, 1);
  assert.equal(full.report.status, "failed");
  assert.equal(full.report.tests.observedFiles, 3);
  assert.deepEqual(full.report.tests.notStarted, []);
  assert.equal(await readFile(path.join(root, "diagnosticos/pending-ran.txt"), "utf8"), "executed");
});

test("runner recusa aprovação quando teste captura violação da classe de recurso", async (t) => {
  const { root, run } = await fixture(t);
  const source = 'import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; test("captura", () => assert.throws(() => spawnSync(process.execPath, ["-e", "process.exit(99)"]), /VERIFICATION_RESOURCE_UNDECLARED/));';
  await writeFile(path.join(root, "test/example.test.mjs"), source);
  await writeFile(path.join(root, "test/verification-resource-policy.json"), JSON.stringify({ schema: "gerador-de-videos/verification-resources@1", files: {
    "test/example.test.mjs": { resource: "local", sourceHash: createHash("sha256").update(source).digest("hex") },
  } }));
  const result = await run("full", {}, ["--profile", "off"]);
  assert.equal(result.code, 1);
  assert.equal(result.report.status, "failed");
  assert.equal(result.report.resourceSchedule.admissions.length, 1);
  const group = result.report.tests.groups.find((row) => row.resourceAudit);
  assert.equal(group.exitCode, 0, "o caso capturou o erro e passou; o runner ainda deve recusar aprovação");
  assert.equal(group.status, "failed");
  assert.equal(group.resourceAudit.violations.length, 1);
});

test("affected aplica o grafo em mudança produtiva, reporta caminhos e encontra regressão real", async (t) => {
  const { root, run } = await fixture(t);
  await mkdir(path.join(root, "lib"));
  await mkdir(path.join(root, "schemas"));
  await writeFile(path.join(root, "schemas/value.json"), '{"value":1}');
  await writeFile(path.join(root, "lib/data.mjs"), 'import { readFile } from "node:fs/promises"; export const value = JSON.parse(await readFile(new URL("../schemas/value.json", import.meta.url), "utf8")).value;');
  await writeFile(path.join(root, "test/data.test.mjs"), 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/data.mjs"; test("data consumer", () => assert.equal(value, 1));');
  await writeFile(path.join(root, "lib/value.mjs"), "export const value = 1;");
  await writeFile(path.join(root, "lib/barrel.mjs"), 'export { value } from "./value.mjs";');
  await writeFile(path.join(root, "test/consumer.test.mjs"), 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/barrel.mjs"; test("consumer", () => assert.equal(value, 1));');
  await writeFile(path.join(root, "test/unrelated.test.mjs"), 'throw new Error("UNRELATED_MUST_NOT_RUN");');
  await execute("git", ["add", "."], { cwd: root, windowsHide: true });
  await execute("git", ["-c", "user.name=Verification Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "impact fixture"], { cwd: root, windowsHide: true });
  await writeFile(path.join(root, "lib/value.mjs"), "export const value = 1; // mudança produtiva\n");
  const partial = await run("affected", {}, ["--profile", "off"]);
  assert.equal(partial.code, 0, partial.output);
  assert.equal(partial.report.status, "partial-passed");
  assert.equal(partial.report.selection.scope, "affected");
  assert.ok(!partial.report.selection.files.includes("test/unrelated.test.mjs"));
  assert.deepEqual(partial.report.selection.impact.reasons.find((row) => row.file === "test/consumer.test.mjs").dependencies[0].path,
    ["test/consumer.test.mjs", "lib/barrel.mjs", "lib/value.mjs"]);
  assert.equal(partial.report.tests.requestedFiles, partial.report.tests.observedFiles);
  assert.equal(partial.report.selection.impact.index.enabled, true);
  assert.equal(partial.report.selection.impact.index.published, true);
  assert.equal(partial.report.selection.impact.index.reused, 0);
  await writeFile(path.join(root, "lib/value.mjs"), "export const value = 2;\n");
  const failed = await run("affected", {}, ["--profile", "off"]);
  assert.equal(failed.code, 1);
  assert.equal(failed.report.status, "failed");
  assert.ok(failed.report.selection.impact.index.reused > 0);
  assert.equal(failed.report.selection.impact.index.analyzed, 1);
  assert.match(failed.output, /consumer/);
  assert.doesNotMatch(failed.output, /UNRELATED_MUST_NOT_RUN/);
  await writeFile(path.join(root, "lib/value.mjs"), "export const value = 1;");
  await writeFile(path.join(root, "schemas/value.json"), '{"value":2}');
  const dataFailed = await run("affected", {}, ["--profile", "off"]);
  assert.equal(dataFailed.code, 1);
  assert.equal(dataFailed.report.status, "failed");
  assert.equal(dataFailed.report.selection.scope, "affected");
  assert.ok(!dataFailed.report.selection.files.includes("test/consumer.test.mjs"));
  assert.deepEqual(dataFailed.report.selection.impact.reasons.find((row) => row.file === "test/data.test.mjs").dependencies[0].path,
    ["test/data.test.mjs", "lib/data.mjs", "schemas/value.json"]);
  assert.match(dataFailed.output, /data consumer/);
  assert.doesNotMatch(dataFailed.output, /UNRELATED_MUST_NOT_RUN/);
});

test("fingerprint percebe arquivo novo, removido e staged, sem incluir logs ignorados", async (t) => {
  const { root } = await fixture(t);
  const original = await worktreeSnapshot(root);
  await mkdir(path.join(root, "diagnosticos"));
  await writeFile(path.join(root, "diagnosticos/test.log"), "progresso");
  assert.equal((await worktreeSnapshot(root)).fingerprint, original.fingerprint);
  await writeFile(path.join(root, "new.mjs"), "export const value = 1;");
  const added = await worktreeSnapshot(root);
  assert.ok(added.changed.includes("new.mjs"));
  assert.notEqual(added.fingerprint, original.fingerprint);
  await execute("git", ["add", "new.mjs"], { cwd: root, windowsHide: true });
  assert.ok((await worktreeSnapshot(root)).changed.includes("new.mjs"));
  await rm(path.join(root, "tracked.txt"));
  const removed = await worktreeSnapshot(root);
  assert.ok(removed.changed.includes("tracked.txt"));
  assert.notEqual(removed.fingerprint, added.fingerprint);
});

test("snapshot em subdiretório conserva nomes literais, renomeações e staged cancelado no working tree", async (t) => {
  const { root } = await fixture(t);
  const nested = path.join(root, "CORE com espaço");
  await mkdir(path.join(nested, "test"), { recursive: true });
  const literal = 'test/ação com espaço.test.mjs';
  const original = "// original\n";
  await writeFile(path.join(nested, literal), original);
  await writeFile(path.join(nested, "old name.mjs"), "// rename\n");
  await execute("git", ["add", "."], { cwd: root, windowsHide: true });
  await execute("git", ["-c", "user.name=Verification Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "nested fixture"], { cwd: root, windowsHide: true });
  const clean = await worktreeSnapshot(nested, { includeInventory: true });
  assert.deepEqual(clean.changed, []);
  assert.deepEqual(clean.inventory, ["old name.mjs", literal]);
  await writeFile(path.join(nested, literal), "// staged\n");
  await execute("git", ["add", "."], { cwd: nested, windowsHide: true });
  await writeFile(path.join(nested, literal), original);
  const restored = await worktreeSnapshot(nested);
  assert.equal(restored.fingerprint, clean.fingerprint, "bytes atuais iguais não ocultam staged divergente");
  assert.deepEqual(restored.changed, [literal]);
  await rename(path.join(nested, "old name.mjs"), path.join(nested, "new name.mjs"));
  await execute("git", ["add", "old name.mjs", "new name.mjs"], { cwd: nested, windowsHide: true });
  await writeFile(path.join(root, "outside.mjs"), "// fora\n");
  await mkdir(path.join(nested, "new folder"));
  await writeFile(path.join(nested, "new folder/arquivo ü.json"), "{}");
  const changed = await worktreeSnapshot(nested, { includeInventory: true });
  assert.deepEqual(changed.changed, ["new folder/arquivo ü.json", "new name.mjs", "old name.mjs", literal]);
  assert.deepEqual(changed.inventory, ["new folder/arquivo ü.json", "new name.mjs", literal]);
  assert.equal(changed.testSourceHashes[literal], createHash("sha256").update(original).digest("hex"));
});

test("erro de sintaxe alterada impede gates e suíte", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(path.join(root, "invalid.mjs"), "export const = ;");
  const result = await run("full");
  assert.equal(result.code, 1);
  assert.equal(result.report.status, "failed");
  assert.equal(result.report.syntax.length, 1);
  assert.equal(result.report.syntax[0].status, "failed");
  assert.deepEqual(result.report.gates, []);
  assert.equal(result.report.tests, null);
  assert.equal(result.report.bootstrap, null);
});

test("runner reutiliza só sintaxe parcial, invalida bytes e cache corrompido, e integra sem reuso", async (t) => {
  const { root, run } = await fixture(t);
  const source = 'import { writeFileSync } from "node:fs"; writeFileSync("SYNTAX_MUST_NOT_EXECUTE", "bad");';
  await writeFile(path.join(root, "changed.mjs"), source);
  const first = await run("fast");
  assert.equal(first.code, 0, first.output);
  assert.equal(first.report.syntaxEvidence.executed, 1);
  assert.equal(first.report.syntaxEvidence.reused, 0);
  assert.equal(JSON.parse(await readFile(first.report.syntaxEvidence.publicationFile, "utf8")).published, 1,
    JSON.stringify({ syntaxEvidence: first.report.syntaxEvidence, syntax: first.report.syntax }));
  const cached = await run("fast");
  assert.equal(cached.code, 0, cached.output);
  assert.equal(cached.report.status, "partial-passed");
  assert.equal(cached.report.resultCache, "syntax-evidence-only");
  assert.equal(cached.report.syntax[0].execution, "reused");
  assert.equal(cached.report.syntax[0].exitCode, null);
  assert.equal(cached.report.bootstrap.status, "passed");
  assert.ok(cached.report.bootstrap.durationMs > 0);
  assert.equal(cached.report.tests.status, "passed");
  assert.equal(cached.report.tests.observedFiles, 1);
  assert.equal(cached.report.gates.length, 9);
  await assert.rejects(readFile(path.join(root, "SYNTAX_MUST_NOT_EXECUTE")), { code: "ENOENT" });
  await writeFile(cached.report.syntax[0].evidence.recordFile, "{broken");
  const repaired = await run("fast");
  assert.equal(repaired.code, 0);
  assert.equal(repaired.report.syntax[0].execution, "executed");
  await writeFile(path.join(root, "changed.mjs"), "export const = ;");
  const invalid = await run("fast");
  assert.equal(invalid.code, 1);
  assert.equal(invalid.report.syntax[0].execution, "executed");
  assert.equal(invalid.report.syntax[0].status, "failed");
  assert.equal(invalid.report.bootstrap, null);
  await writeFile(path.join(root, "changed.mjs"), source);
  const full = await run("full");
  assert.equal(full.code, 0, full.output);
  assert.equal(full.report.resultCache, "disabled");
  assert.equal(full.report.syntaxEvidence.reuseAllowed, false);
  assert.equal(full.report.syntaxEvidence.reused, 0);
  assert.equal(full.report.syntax[0].execution, "executed");
  assert.equal(full.report.tests.requestedFiles, full.report.tests.observedFiles);
});

test("cache indisponível não muda aprovação executada e publica diagnóstico próprio", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(path.join(root, "changed.mjs"), "export default 1;");
  await writeFile(path.join(root, ".cache"), "cache directory obstructed");
  const result = await run("fast");
  assert.equal(result.code, 0, result.output);
  assert.equal(result.report.status, "partial-passed");
  assert.equal(result.report.syntax[0].execution, "executed");
  const publication = JSON.parse(await readFile(result.report.syntaxEvidence.publicationFile, "utf8"));
  assert.equal(publication.published, 0);
  assert.ok(publication.errors.length > 0);
});

test("bootstrap falho, ausente ou sem testes impede aprovação e suíte mesmo com gates aprovados", async (t) => {
  const { root, run } = await fixture(t);
  const failed = await run("full", { VERIFICATION_FIXTURE_BOOTSTRAP_FAIL: "yes" });
  assert.equal(failed.code, 1);
  assert.equal(failed.report.status, "failed");
  assert.equal(failed.report.bootstrap.status, "failed");
  assert.equal(failed.report.gates.length, structuralChecks.length);
  assert.equal(failed.report.tests, null);
  const skipped = await run("fast", { VERIFICATION_FIXTURE_BOOTSTRAP_SKIP: "yes" });
  assert.equal(skipped.code, 1);
  assert.equal(skipped.report.bootstrap.status, "failed");
  assert.equal(skipped.report.gates.length, structuralChecks.length);
  assert.equal(skipped.report.tests, null);
  await writeFile(path.join(root, bootstrapTestFiles[0]), "// nenhum contrato executado\n");
  const empty = await run("fast");
  assert.equal(empty.code, 1);
  assert.equal(empty.report.bootstrap.exitCode, 0);
  assert.equal(empty.report.bootstrap.status, "failed");
  assert.equal(empty.report.gates.length, structuralChecks.length);
  assert.equal(empty.report.tests, null);
  await rm(path.join(root, bootstrapTestFiles[0]));
  const missing = await run("full");
  assert.equal(missing.code, 1);
  assert.equal(missing.report.bootstrap.status, "failed");
  assert.equal(missing.report.gates.length, structuralChecks.length);
  assert.equal(missing.report.tests, null);
  const legacy = await run("full", {}, ["--scheduling", "legacy"]);
  assert.equal(legacy.code, 1);
  assert.equal(legacy.report.prechecks.scheduling, "sequential");
  assert.deepEqual(legacy.report.gates, []);
  assert.equal(legacy.report.tests, null);
});

test("bootstrap e gates se encontram numa barreira; integração só começa após ambos terminarem", async (t) => {
  const { root, run } = await fixture(t);
  await mkdir(path.join(root, ".cache"), { recursive: true });
  const rendezvous = `import { existsSync, writeFileSync } from "node:fs";
    import { setTimeout as delay } from "node:timers/promises";
    async function wait(file) { const until = Date.now() + 10000; while (!existsSync(file)) {
      if (Date.now() > until) throw new Error("PRECHECK_OVERLAP_MISSING"); await delay(5);
    } }`;
  await writeFile(path.join(root, bootstrapTestFiles[0]), `${rendezvous}
    import test from "node:test";
    test("bootstrap rendezvous", async () => { writeFileSync(".cache/bootstrap-started", "yes");
      await wait(".cache/gate-started"); writeFileSync(".cache/bootstrap-finished", "yes"); });`);
  await writeFile(path.join(root, structuralChecks[0][1]), `${rendezvous}
    writeFileSync(".cache/gate-started", "yes"); await wait(".cache/bootstrap-started"); writeFileSync(".cache/gate-finished", "yes");`);
  await writeFile(path.join(root, "test/example.test.mjs"), `import test from "node:test";
    import assert from "node:assert/strict"; import { existsSync } from "node:fs";
    test("admission waits for both prechecks", () => {
      assert.equal(existsSync(".cache/bootstrap-finished"), true); assert.equal(existsSync(".cache/gate-finished"), true);
    });`);
  const result = await run("full", {}, ["--test-concurrency", "2", "--gate-concurrency", "2"]);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.report.status, "passed");
  assert.equal(result.report.prechecks.scheduling, "parallel");
  assert.equal(result.report.bootstrap.status, "passed");
  assert.ok(result.report.gates.every((gate) => gate.status === "passed"));
  assert.equal(result.report.tests.summaries.findLast((event) => !event.file).counts.tests, 2);
});

test("totais reconciliam grupos distintos e recusam duplicação e cobertura ausente", () => {
  const root = path.resolve("fixture");
  const makeGroup = (file) => {
    const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, suites: 0, topLevel: 1 };
    const events = [{ type: "test:summary", success: true, counts, file: path.join(root, file) }, { type: "test:summary", success: true, counts }];
    return { ...summarizeTestEvents(events, [file], root), status: "passed", durationMs: 10, files: [file], events };
  };
  const a = makeGroup("a.test.mjs"), b = makeGroup("b.test.mjs");
  assert.equal(combineTestGroups([a, b], ["a.test.mjs", "b.test.mjs"], root).report.status, "passed");
  assert.equal(combineTestGroups([a, a], ["a.test.mjs"], root).report.status, "failed");
  assert.equal(combineTestGroups([a], ["a.test.mjs", "b.test.mjs"], root).report.status, "failed");
});

test("perfil conserva resultados síncronos, promises, códigos e erros sem registrar conteúdo", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "verification-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = path.join(root, "profile");
  await mkdir(profile);
  const preload = new URL("./subprocess-profile.mjs", import.meta.url).href;
  const source = `import assert from "node:assert/strict";
import { spawnSync, execFileSync, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const args = ["-e", "process.stdout.write('PRIVATE_SENTINEL')"];
assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).stdout, "PRIVATE_SENTINEL");
assert.equal(execFileSync(process.execPath, args, { encoding: "utf8" }), "PRIVATE_SENTINEL");
assert.equal((await promisify(execFile)(process.execPath, args)).stdout, "PRIVATE_SENTINEL");
assert.throws(() => execFileSync(process.execPath, ["-e", "process.exit(7)"]), { status: 7 });
await new Promise((resolve) => { const child = spawn("missing-verification-executable"); child.on("error", (e) => assert.equal(e.code, "ENOENT")); child.on("close", resolve); });
assert.throws(() => spawn(null), TypeError);
console.log("verified");`;
  const result = await execute(process.execPath, ["--import", preload, "--input-type=module", "-e", source], { windowsHide: true, env: { ...process.env, MKT_VERIFICATION_PROFILE_DIR: profile } });
  assert.equal(result.stdout.trim(), "verified");
  const content = (await Promise.all((await readdir(profile)).map((file) => readFile(path.join(profile, file), "utf8")))).join("");
  assert.ok(!content.includes("PRIVATE_SENTINEL"));
  assert.ok(!content.includes("missing-verification-executable"));
  const rows = content.trim().split(/\r?\n/).map(JSON.parse);
  const spans = rows.filter((row) => row.type === "subprocess");
  assert.equal(spans.length, 5);
  assert.ok(spans.some((row) => row.exitCode === 7));
  assert.ok(spans.every((row) => row.durationMs >= 0));
  assert.ok(rows.some((row) => row.type === "process-end"));
});

test("limites de recursos inválidos falham antes de iniciar uma verificação", async () => {
  const runner = new URL("../scripts/run-verification.mjs", import.meta.url);
  for (const args of [
    ["--heavy-concurrency", "0"], ["--heavy-concurrency", "1.5"], ["--heavy-concurrency", "9"],
    ["--local-concurrency", "0"], ["--local-concurrency", "no"],
    ["--test-concurrency", "1", "--heavy-concurrency", "2"],
    ["--scheduling", "legacy", "--heavy-concurrency", "2"],
    ["--scheduling", "legacy", "--local-concurrency", "2"],
  ]) {
    await assert.rejects(execute(process.execPath, [fileURLToPath(runner), ...args], { windowsHide: true }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /concurrency.*(?:entre|exige)/);
      assert.equal(error.stdout, "");
      return true;
    });
  }
});

test("entrada de cobertura usa o preload real e não herda banco operacional", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coverage-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "isolation.test.mjs");
  await writeFile(file, 'import test from "node:test"; import assert from "node:assert/strict"; test("COVERAGE_ISOLATED", () => { assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.MKT_VIDEOS_RUNTIME_DB, undefined); });');
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const args = manifest.scripts["test:coverage:core"].split(" ");
  assert.equal(args.shift(), "node");
  assert.equal(args.at(-1), "test/*.test.mjs");
  args[args.length - 1] = file;
  const environment = { ...process.env, NODE_ENV: "production", MKT_VIDEOS_RUNTIME_DB: "OPERATIONAL_SENTINEL" };
  delete environment.NODE_TEST_CONTEXT;
  const result = await execute(process.execPath, args, { windowsHide: true, cwd: new URL("../", import.meta.url), env: environment });
  assert.match(result.stdout, /COVERAGE_ISOLATED/);
});
