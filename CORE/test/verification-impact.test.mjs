import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildVerificationImpact } from "../scripts/verification-impact.mjs";
import { selectVerification } from "../scripts/verification-plan.mjs";

const execute = promisify(execFile);
async function project(t, entries) {
  const root = await mkdtemp(path.join(os.tmpdir(), "verification-impact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  const inventory = Object.keys(entries);
  const testFiles = inventory.filter((file) => /^test\/[^/]+\.test\.mjs$/.test(file));
  return { root, inventory, testFiles, analyze: (changed) => buildVerificationImpact({ root, inventory, testFiles, changed }) };
}

test("impacto transitivo segue reexports, ciclos, imports literais e não interpreta comentários como código", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": "export const value = 1;",
    "lib/barrel.mjs": 'export { value } from "./value.mjs"; export * from "./cycle.mjs";',
    "lib/cycle.mjs": 'export * from "./barrel.mjs";',
    "test/value.test.mjs": 'import { value } from "../lib/barrel.mjs";',
    "test/dynamic.test.mjs": 'await import(`../lib/value.mjs`);',
    "test/unrelated.test.mjs": '// import "../lib/value.mjs";\nconst example = "import(unknown)";',
  });
  const impact = await fixture.analyze(["lib/value.mjs"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/dynamic.test.mjs", "test/value.test.mjs"]);
  assert.deepEqual(impact.reasons.find((row) => row.file === "test/value.test.mjs").dependencies[0].path,
    ["test/value.test.mjs", "lib/barrel.mjs", "lib/value.mjs"]);
  assert.ok(impact.reasons.every((row) => row.uncertainties.length === 0));
  const selection = selectVerification({ mode: "affected", changed: ["lib/value.mjs"], testFiles: fixture.testFiles, impact });
  assert.equal(selection.scope, "affected");
});

test("filesystem, subprocessos e imports desconhecidos ampliam consumidores sem executar suas fontes", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": 'throw new Error("ANALYZER_MUST_NOT_EXECUTE_SOURCE");',
    "lib/io.mjs": 'import { readFile } from "node:fs/promises"; await readFile(process.env.INPUT);',
    "test/direct.test.mjs": 'import "../lib/value.mjs";',
    "test/read.test.mjs": 'import "../lib/io.mjs";',
    "test/process.test.mjs": 'import { spawn } from "node:child_process";',
    "test/computed.test.mjs": 'const file = process.env.INPUT; await import(file);',
    "test/missing.test.mjs": 'import "./missing-fixture.mjs";',
    "test/unrelated.test.mjs": 'import assert from "node:assert/strict";',
  });
  const impact = await fixture.analyze(["lib/value.mjs"]);
  assert.equal(impact.status, "partial-selection");
  assert.equal(impact.files.length, 5);
  assert.ok(!impact.files.includes("test/unrelated.test.mjs"));
  assert.deepEqual(impact.reasons.find((row) => row.file === "test/read.test.mjs").uncertainties,
    [{ file: "lib/io.mjs", reasons: ["opaque-builtin:fs/promises"] }]);
});

test("templates de handlers explicitam o inventário mas conservam a incerteza de valores calculados", async (t) => {
  const fixture = await project(t, {
    "scripts/cli.mjs": 'await import(`../lib/commands/${command}.mjs`);',
    "lib/commands/first.mjs": "export const value = 1;",
    "lib/commands/new.mjs": "export const value = 2;",
    "test/cli.test.mjs": 'import "../scripts/cli.mjs";',
    "test/unrelated.test.mjs": "const ok = true;",
  });
  const impact = await fixture.analyze(["lib/commands/new.mjs"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/cli.test.mjs"]);
  assert.deepEqual(impact.reasons[0].dependencies[0].path, ["test/cli.test.mjs", "scripts/cli.mjs", "lib/commands/new.mjs"]);
  assert.ok(impact.reasons[0].uncertainties.some((row) => row.reasons.includes("dynamic-import-template")));
});

test("remoção, configuração, infraestrutura e fonte sem consumidor exigem regressão completa", async (t) => {
  const fixture = await project(t, {
    "lib/uncovered.mjs": "export const value = 1;",
    "lib/deleted.mjs": "export const value = 1;",
    "scripts/run-verification.mjs": "",
    "test/test-environment.mjs": "",
    "test/subprocess-profile.mjs": "",
    "test/filesystem-profile.mjs": "",
    "test/verification-resource-guard.mjs": "",
    "package-lock.json": "{}",
    "schemas/data.json": "{}",
    "test/example.test.mjs": "const ok = true;",
    "test/direct-infrastructure.test.mjs": 'import "./subprocess-profile.mjs"; import "./filesystem-profile.mjs"; import "./verification-resource-guard.mjs";',
  });
  await rm(path.join(fixture.root, "lib/deleted.mjs"));
  for (const changed of [[], ["lib/uncovered.mjs"], ["lib/deleted.mjs"], ["lib/removed.mjs"], ["scripts/run-verification.mjs"], ["test/test-environment.mjs"], ["test/subprocess-profile.mjs"], ["test/filesystem-profile.mjs"], ["test/verification-resource-guard.mjs"], ["package-lock.json"], ["schemas/data.json"]]) {
    const impact = await fixture.analyze(changed);
    assert.equal(impact.status, "full-required", changed.join(","));
    assert.ok(impact.fallbackReasons.length);
    if (changed[0]?.startsWith("test/")) assert.ok(impact.fallbackReasons.includes(`verification-infrastructure:${changed[0]}`));
    assert.deepEqual(impact.files, [...fixture.testFiles].sort());
    assert.equal(selectVerification({ mode: "affected", changed, testFiles: fixture.testFiles, impact }).scope, "full");
  }
});

test("parser não compreendido e require dinâmico mantêm testes potencialmente afetados", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": "export const value = 1;",
    "lib/legacy.cjs": 'require(process.env.MODULE);',
    "test/direct.test.mjs": 'import "../lib/value.mjs";',
    "test/legacy.test.mjs": 'import "../lib/legacy.cjs";',
    "test/invalid.test.mjs": 'import { broken',
    "test/builtin.test.mjs": 'process.getBuiltinModule("fs");',
  });
  const impact = await fixture.analyze(["lib/value.mjs"]);
  assert.deepEqual(impact.files, [...fixture.testFiles].sort());
  assert.ok(impact.reasons.find((row) => row.file === "test/invalid.test.mjs").uncertainties[0].reasons.includes("unsupported-or-invalid-syntax"));
});

test("seleção encontra regressão inserida no consumidor transitivo e preserva o teste independente fora da execução", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": "export const value = 2;",
    "lib/barrel.mjs": 'export { value } from "./value.mjs";',
    "test/consumer.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/barrel.mjs"; test("regressão inserida", () => assert.equal(value, 1));',
    "test/unrelated.test.mjs": 'throw new Error("UNRELATED_MUST_NOT_RUN");',
  });
  const impact = await fixture.analyze(["lib/value.mjs"]);
  assert.deepEqual(impact.files, ["test/consumer.test.mjs"]);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  await assert.rejects(execute(process.execPath, ["--test", ...impact.files], { cwd: fixture.root, windowsHide: true, env: environment }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /regressão inserida/);
    assert.doesNotMatch(error.stdout + error.stderr, /UNRELATED_MUST_NOT_RUN/);
    return true;
  });
});

test("leituras de URL literal vinculam dados transitivos e separam consumidores de arquivos diferentes", async (t) => {
  const fixture = await project(t, {
    "schemas/first.json": '{"value":1}',
    "schemas/second.json": '{"value":2}',
    "lib/first.mjs": 'import { readFile as read } from "node:fs/promises"; export const value = JSON.parse(await read(new URL("../schemas/first.json", import.meta.url), "utf8"));',
    "lib/second.mjs": 'import { readFileSync } from "node:fs"; export const value = JSON.parse(readFileSync(new URL(`../schemas/second.json`, import.meta.url), "utf8"));',
    "test/first.test.mjs": 'import "../lib/first.mjs";',
    "test/second.test.mjs": 'import "../lib/second.mjs";',
    "test/import.test.mjs": 'import data from "../schemas/first.json" with { type: "json" };',
    "test/process.test.mjs": 'import { spawn } from "node:child_process";',
    "test/unused.test.mjs": 'import { readFile } from "node:fs/promises";',
  });
  const impact = await fixture.analyze(["schemas/first.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/first.test.mjs", "test/import.test.mjs", "test/process.test.mjs"]);
  const first = impact.reasons.find((row) => row.file === "test/first.test.mjs");
  assert.deepEqual(first.dependencies, [{ changed: "schemas/first.json", path: ["test/first.test.mjs", "lib/first.mjs", "schemas/first.json"] }]);
  assert.deepEqual(first.uncertainties, []);
  assert.deepEqual((await fixture.analyze(["schemas/second.json"])).files, ["test/process.test.mjs", "test/second.test.mjs"]);
  assert.equal(selectVerification({ mode: "affected", changed: ["schemas/first.json"], testFiles: fixture.testFiles, impact }).scope, "affected");
});

test("fs permanece incerto para capturas, sombras, namespace, require, APIs mistas e caminhos calculados", async (t) => {
  const cases = {
    alias: 'import { readFile } from "node:fs/promises"; const read = readFile; await read(new URL("../schemas/other.json", import.meta.url));',
    capture: 'import { readFile } from "node:fs/promises"; use(readFile);',
    shadow: 'import { readFile } from "node:fs/promises"; function work(readFile) { return readFile(new URL("../schemas/other.json", import.meta.url)); }',
    namespace: 'import * as fs from "node:fs/promises"; await fs.readFile(new URL("../schemas/other.json", import.meta.url));',
    default: 'import fs from "node:fs"; fs.readFileSync(new URL("../schemas/other.json", import.meta.url));',
    require: 'import { readFileSync } from "node:fs"; require("node:fs"); readFileSync(new URL("../schemas/other.json", import.meta.url));',
    mixed: 'import { readFile, readdir } from "node:fs/promises"; await readFile(new URL("../schemas/other.json", import.meta.url));',
    calculated: 'import { readFile } from "node:fs/promises"; await readFile(new URL(`../schemas/${name}.json`, import.meta.url));',
    variable: 'import { readFile } from "node:fs/promises"; const file = new URL("../schemas/other.json", import.meta.url); await readFile(file);',
    base: 'import { readFile } from "node:fs/promises"; await readFile(new URL("../schemas/other.json", base));',
    constructor: 'import { readFile } from "node:fs/promises"; function URL() {} await readFile(new URL("../schemas/other.json", import.meta.url));',
    absent: 'import { readFile } from "node:fs/promises"; await readFile(new URL("../schemas/absent.json", import.meta.url));',
    traversal: 'import { readFile } from "node:fs/promises"; await readFile(new URL("../../outside.json", import.meta.url));',
    absolute: 'import { readFile } from "node:fs/promises"; await readFile(new URL("file:///outside.json", import.meta.url));',
  };
  const fixture = await project(t, {
    "schemas/target.json": '{}', "schemas/other.json": '{}',
    "test/direct.test.mjs": 'import { readFile } from "node:fs/promises"; await readFile(new URL("../schemas/target.json", import.meta.url));',
    ...Object.fromEntries(Object.entries(cases).map(([name, source]) => [`test/${name}.test.mjs`, source])),
  });
  const impact = await fixture.analyze(["schemas/target.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, [...fixture.testFiles].sort());
  for (const name of Object.keys(cases)) {
    const row = impact.reasons.find((row) => row.file === `test/${name}.test.mjs`);
    assert.ok(row.uncertainties.some((entry) => entry.reasons.some((reason) => reason.startsWith("opaque-builtin:fs"))), name);
  }
});

test("caminhos de módulo e strings const preservam vínculos sem confundir objetos URL mutáveis", async (t) => {
  const fixture = await project(t, {
    "schemas/target.json": '{}', "schemas/other.json": '{}',
    "test/direct.test.mjs": 'import { readFileSync } from "node:fs"; import path from "node:path"; const root = import.meta.dirname; const file = path.resolve(root, "../schemas/target.json"); readFileSync(file);',
    "test/alias.test.mjs": 'import { readFile } from "node:fs/promises"; import { join as combine } from "node:path"; const file = combine(import.meta.dirname, "../schemas/target.json"); const alias = file; await readFile(alias);',
    "test/url.test.mjs": 'import { readFileSync } from "node:fs"; import { fileURLToPath as convert } from "node:url"; const file = convert(new URL("../schemas/target.json", import.meta.url)); readFileSync(file);',
    "test/other.test.mjs": 'import { readFileSync } from "node:fs"; import * as path from "node:path"; readFileSync(path.join(import.meta.dirname, "../schemas/other.json"));',
  });
  const impact = await fixture.analyze(["schemas/target.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/alias.test.mjs", "test/direct.test.mjs", "test/url.test.mjs"]);
  assert.ok(impact.reasons.every((row) => row.uncertainties.length === 0));
  assert.deepEqual((await fixture.analyze(["schemas/other.json"])).files, ["test/other.test.mjs"]);
});

test("caminhos calculados, sombras e mutações de helpers conservam seleção ampla", async (t) => {
  const prefix = 'import { readFileSync } from "node:fs"; import path from "node:path";';
  const cases = {
    parameter: 'const file = path.resolve(import.meta.dirname, "../schemas/other.json"); function read(file) { readFileSync(file); }',
    destructured: 'const file = path.resolve(import.meta.dirname, "../schemas/other.json"); function read({ file }) { readFileSync(file); }',
    catch: 'const file = path.resolve(import.meta.dirname, "../schemas/other.json"); try {} catch (file) { readFileSync(file); }',
    local: 'const file = path.resolve(import.meta.dirname, "../schemas/other.json"); { const file = process.env.INPUT; readFileSync(file); }',
    mutable: 'let file = path.resolve(import.meta.dirname, "../schemas/other.json"); readFileSync(file);',
    environment: 'readFileSync(path.resolve(import.meta.dirname, process.env.INPUT));',
    absolute: 'readFileSync(path.resolve(import.meta.dirname, "/schemas/other.json"));',
    drive: 'readFileSync(path.resolve(import.meta.dirname, "C:/schemas/other.json"));',
    windows: 'readFileSync(path.resolve(import.meta.dirname, "..\\\\schemas\\\\other.json"));',
    traversal: 'readFileSync(path.resolve(import.meta.dirname, "../../outside.json"));',
    mutation: 'path.resolve = injected; readFileSync(path.resolve(import.meta.dirname, "../schemas/other.json"));',
    metaMutation: 'import.meta.dirname = process.env.INPUT; readFileSync(path.resolve(import.meta.dirname, "../schemas/other.json"));',
    metaEscape: 'modify(import.meta); readFileSync(path.resolve(import.meta.dirname, "../schemas/other.json"));',
    capture: 'modify(path); readFileSync(path.resolve(import.meta.dirname, "../schemas/other.json"));',
    computed: 'readFileSync(path["resolve"](import.meta.dirname, "../schemas/other.json"));',
    cycle: 'const first = second; const second = first; readFileSync(first);',
  };
  const fixture = await project(t, {
    "schemas/target.json": '{}', "schemas/other.json": '{}',
    "test/direct.test.mjs": prefix + 'readFileSync(path.join(import.meta.dirname, "../schemas/target.json"));',
    ...Object.fromEntries(Object.entries(cases).map(([name, source]) => [`test/${name}.test.mjs`, prefix + source])),
  });
  const impact = await fixture.analyze(["schemas/target.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, [...fixture.testFiles].sort());
  for (const name of Object.keys(cases)) assert.ok(impact.reasons.find((row) => row.file === `test/${name}.test.mjs`).uncertainties.length, name);
});

test("regressão em arquivo de caminho const é encontrada pela execução real selecionada", async (t) => {
  const fixture = await project(t, {
    "schemas/value.json": '{"value":2}', "schemas/other.json": '{}',
    "lib/reader.mjs": 'import { readFileSync } from "node:fs"; import path from "node:path"; const file = path.resolve(import.meta.dirname, "../schemas/value.json"); export const value = JSON.parse(readFileSync(file, "utf8")).value;',
    "test/consumer.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/reader.mjs"; test("regressão de caminho inserida", () => assert.equal(value, 1));',
    "test/independent.test.mjs": 'import { readFileSync } from "node:fs"; import { join } from "node:path"; const file = join(import.meta.dirname, "../schemas/other.json"); readFileSync(file); throw new Error("INDEPENDENT_MUST_NOT_RUN");',
  });
  const impact = await fixture.analyze(["schemas/value.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/consumer.test.mjs"]);
  assert.deepEqual(impact.reasons[0].dependencies[0].path, ["test/consumer.test.mjs", "lib/reader.mjs", "schemas/value.json"]);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_TEST_WORKER_ID;
  await assert.rejects(execute(process.execPath, ["--test", ...impact.files], { cwd: fixture.root, windowsHide: true, env: environment }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /regressão de caminho inserida/);
    assert.doesNotMatch(error.stdout + error.stderr, /INDEPENDENT_MUST_NOT_RUN/);
    return true;
  });
});

test("dados sem consumidor, remoções, configurações e dados fora das raízes mapeadas exigem suíte completa", async (t) => {
  const fixture = await project(t, {
    "schemas/known.json": '{}', "schemas/uncovered.json": '{}',
    "package.json": '{}', "knowledge/policy.json": '{}', "outputs/foreign.json": '{}',
    "test/direct.test.mjs": 'import { readFile } from "node:fs/promises"; await readFile(new URL("../schemas/known.json", import.meta.url));',
    "test/other.test.mjs": 'const ok = true;',
  });
  for (const file of ["schemas/uncovered.json", "schemas/removed.json", "package.json", "knowledge/policy.json", "outputs/foreign.json"]) {
    const impact = await fixture.analyze([file]);
    assert.equal(impact.status, "full-required", file);
    assert.deepEqual(impact.files, fixture.testFiles);
  }
  await rm(path.join(fixture.root, "schemas/known.json"));
  assert.equal((await fixture.analyze(["schemas/known.json"])).status, "full-required");
});

test("seleção de dados executa regressão real em schema lido e não executa consumidor independente", async (t) => {
  const fixture = await project(t, {
    "schemas/value.json": '{"value":2}', "schemas/other.json": '{}',
    "lib/reader.mjs": 'import { readFile } from "node:fs/promises"; export const value = JSON.parse(await readFile(new URL("../schemas/value.json", import.meta.url), "utf8")).value;',
    "test/consumer.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/reader.mjs"; test("regressão de dado inserida", () => assert.equal(value, 1));',
    "test/independent.test.mjs": 'import { readFileSync } from "node:fs"; readFileSync(new URL("../schemas/other.json", import.meta.url)); throw new Error("INDEPENDENT_MUST_NOT_RUN");',
  });
  const impact = await fixture.analyze(["schemas/value.json"]);
  assert.equal(impact.status, "partial-selection");
  assert.deepEqual(impact.files, ["test/consumer.test.mjs"]);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  await assert.rejects(execute(process.execPath, ["--test", ...impact.files], { cwd: fixture.root, windowsHide: true, env: environment }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /regressão de dado inserida/);
    assert.doesNotMatch(error.stdout + error.stderr, /INDEPENDENT_MUST_NOT_RUN/);
    return true;
  });
});

test("índice estático reutiliza parsing, preserva seleção e invalida bytes e inventário", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": 'export const value = 1;',
    "lib/other.mjs": 'export const other = 1;',
    "test/value.test.mjs": 'import "../lib/value.mjs";',
    "test/other.test.mjs": 'import "../lib/other.mjs";',
  });
  const args = { root: fixture.root, inventory: fixture.inventory, testFiles: fixture.testFiles, changed: ["lib/value.mjs"], cache: true };
  const cold = await buildVerificationImpact(args);
  const warm = await buildVerificationImpact(args);
  assert.deepEqual(warm.reasons, cold.reasons);
  assert.deepEqual(warm.files, cold.files);
  assert.equal(cold.index.analyzed, 4);
  assert.equal(warm.index.reused, 4);
  assert.equal(warm.index.analyzed, 0);
  assert.equal(warm.index.published, true);
  await writeFile(path.join(fixture.root, "test/other.test.mjs"), 'import "../lib/value.mjs";');
  const changed = await buildVerificationImpact(args);
  assert.equal(changed.index.reused, 3);
  assert.equal(changed.index.analyzed, 1);
  assert.deepEqual(changed.files, [...fixture.testFiles].sort());
  await writeFile(path.join(fixture.root, "lib/new.mjs"), 'export const added = true;');
  const expanded = await buildVerificationImpact({ ...args, inventory: [...fixture.inventory, "lib/new.mjs"] });
  assert.equal(expanded.index.reused, 0);
  assert.equal(expanded.index.analyzed, 5);
  assert.equal(expanded.index.rejected, true);
});

test("índice corrompido, engine divergente e publicação indisponível exigem análise real", async (t) => {
  const fixture = await project(t, {
    "lib/value.mjs": 'export const value = 1;',
    "test/value.test.mjs": 'import "../lib/value.mjs";',
  });
  const args = { root: fixture.root, inventory: fixture.inventory, testFiles: fixture.testFiles, changed: ["lib/value.mjs"], cache: true };
  const target = path.join(fixture.root, "diagnosticos/verificacoes/impact-index.json");
  const expected = await buildVerificationImpact(args);
  for (const mutate of [
    () => '{broken json',
    (body) => JSON.stringify({ ...body, checksum: "0".repeat(64) }),
    ({ checksum: _checksum, ...body }) => {
      body.engineHash = "0".repeat(64);
      return JSON.stringify({ ...body, checksum: createHash("sha256").update(JSON.stringify(body)).digest("hex") });
    },
  ]) {
    await writeFile(target, mutate(JSON.parse(await readFile(target, "utf8"))));
    const actual = await buildVerificationImpact(args);
    assert.deepEqual(actual.reasons, expected.reasons);
    assert.equal(actual.index.rejected, true);
    assert.equal(actual.index.reused, 0);
    assert.equal(actual.index.analyzed, 2);
  }
  await rm(path.join(fixture.root, "diagnosticos"), { recursive: true });
  await writeFile(path.join(fixture.root, "diagnosticos"), "not a directory");
  const unavailable = await buildVerificationImpact(args);
  assert.deepEqual(unavailable.reasons, expected.reasons);
  assert.equal(unavailable.index.analyzed, 2);
  assert.equal(unavailable.index.published, false);
  assert.ok(unavailable.index.publicationError);
});

test("índice não reutiliza aprovação: alteração do dado ainda executa e encontra a regressão", async (t) => {
  const fixture = await project(t, {
    "schemas/value.json": '{"value":1}',
    "lib/value.mjs": 'import { readFileSync } from "node:fs"; export const value = JSON.parse(readFileSync(new URL("../schemas/value.json", import.meta.url), "utf8")).value;',
    "test/value.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; import { value } from "../lib/value.mjs"; test("dado mudou com índice quente", () => assert.equal(value, 1));',
  });
  const args = { root: fixture.root, inventory: fixture.inventory, testFiles: fixture.testFiles, changed: ["schemas/value.json"], cache: true };
  await buildVerificationImpact(args);
  await writeFile(path.join(fixture.root, "schemas/value.json"), '{"value":2}');
  const impact = await buildVerificationImpact(args);
  assert.equal(impact.index.reused, 2);
  assert.deepEqual(impact.files, fixture.testFiles);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; delete env.NODE_TEST_WORKER_ID;
  await assert.rejects(execute(process.execPath, ["--test", ...impact.files], { cwd: fixture.root, windowsHide: true, env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /dado mudou com índice quente/);
    return true;
  });
});
