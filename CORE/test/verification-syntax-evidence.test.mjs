import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSyntaxEvidence } from "../scripts/verification-syntax-evidence.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "syntax-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/run-verification.mjs"), "// driver\n");
  await writeFile(path.join(root, "scripts/verification-syntax-evidence.mjs"), "// evidence\n");
  const store = (options = {}) => createSyntaxEvidence({ root, env: { NODE_ENV: "test" }, ...options });
  return { root, store };
}
async function check(args, source = null) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { windowsHide: true, env });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    child.stdin.end(source);
  });
}
async function publish(root, store, prepared) {
  const checked = await check(["--check", `--input-type=${prepared.input.format}`], prepared.source);
  assert.equal(checked.code, 0, checked.stderr);
  const file = path.join(root, "diagnosticos/verificacoes/fixture/report.json");
  await mkdir(path.dirname(file), { recursive: true });
  const report = { schema: "gerador-de-videos/verification@1", status: "partial-passed", sourceStable: true,
    syntaxEvidence: { ...store.describe(), engineStable: await store.verifyEngine() },
    syntax: [{ name: "syntax-0", status: "passed", exitCode: checked.code, execution: "executed", syntaxInput: prepared.input,
      args: ["--check", `--input-type=${prepared.input.format}`] }] };
  await writeFile(file, JSON.stringify(report));
  assert.equal((await store.publish(report, file)).published, 1);
  return file;
}

test("parser Node recebe os mesmos bytes de mjs/cjs e não executa código nem imports", async (t) => {
  const { root, store } = await fixture(t);
  const evidence = store();
  const cases = [
    ["mjs", 'import "./ABSENT_MUST_NOT_LOAD.mjs"; await Promise.resolve();'],
    ["mjs", '#!/usr/bin/env node\nexport const unicode = "ação";'],
    ["mjs", `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(root, "SHOULD_NOT_EXIST"))}, "bad");`],
    ["mjs", "export const = ;"], ["mjs", "return 3;"],
    ["cjs", "return 3;"], ["cjs", 'require("ABSENT_MUST_NOT_LOAD");'],
    ["cjs", "await Promise.resolve();"], ["cjs", "const broken = {;"],
  ];
  for (const [index, [extension, source]] of cases.entries()) {
    const file = `${index}.${extension}`;
    await writeFile(path.join(root, file), source);
    const prepared = await evidence.prepare(file);
    assert.equal(prepared.input.sourceHash, digest(prepared.source));
    const original = await check(["--check", path.join(root, file)]);
    const immutableInput = await check(["--check", `--input-type=${prepared.input.format}`], prepared.source);
    assert.equal(immutableInput.code, original.code, `${file}: ${immutableInput.stderr}`);
  }
  await assert.rejects(readFile(path.join(root, "SHOULD_NOT_EXIST")), { code: "ENOENT" });
  await writeFile(path.join(root, "unknown.js"), "export default 1;");
  assert.equal(await evidence.prepare("unknown.js"), null);
  assert.equal(await store({ enabled: false }).prepare("0.mjs"), null);
  const unbound = store({ env: { NODE_ENV: "test", NODE_OPTIONS: "--no-warnings" } });
  assert.equal(await unbound.prepare("0.mjs"), null);
  assert.equal(unbound.describe().reason, "unknown-node-startup-environment");
});

test("evidência exige origem íntegra, bytes, parser e driver; cache não aprova input novo", async (t) => {
  const { root, store } = await fixture(t);
  await writeFile(path.join(root, "input.mjs"), "export default 1;");
  const writer = store();
  const prepared = await writer.prepare("input.mjs");
  const reportFile = await publish(root, writer, prepared);
  const reader = store();
  assert.ok(await reader.lookup(await reader.prepare("input.mjs")));
  assert.equal(await store({ reuse: false }).lookup(prepared), null);
  await writeFile(path.join(root, "input.mjs"), "export const = ;");
  assert.equal(await reader.lookup(await reader.prepare("input.mjs")), null);
  await writeFile(path.join(root, "input.mjs"), "export default 1;");
  const proof = await reader.lookup(prepared);
  const original = await readFile(proof.recordFile, "utf8");
  const record = JSON.parse(original);
  record.body.input.engine.nodeHash = "0".repeat(64);
  record.digest = digest(JSON.stringify(record.body));
  await writeFile(proof.recordFile, JSON.stringify(record));
  assert.equal(await store().lookup(prepared), null);
  const reportBytes = await readFile(reportFile, "utf8");
  for (const patch of [
    (report) => { report.status = "failed"; },
    (report) => { report.sourceStable = false; },
    (report) => { report.syntaxEvidence.engineStable = false; },
    (report) => { report.syntax[0].execution = "reused"; },
    (report) => { report.syntax[0].exitCode = 1; },
  ]) {
    const report = JSON.parse(reportBytes); patch(report);
    const updated = JSON.stringify(report);
    await writeFile(reportFile, updated);
    const poisoned = JSON.parse(original);
    poisoned.body.proof.reportHash = digest(updated);
    poisoned.digest = digest(JSON.stringify(poisoned.body));
    await writeFile(proof.recordFile, JSON.stringify(poisoned));
    assert.equal(await store().lookup(prepared), null, "checksum válido não substitui prova executada, aprovada e estável");
  }
  await writeFile(reportFile, reportBytes);
  await writeFile(path.join(root, "diagnosticos/report.json"), reportBytes);
  const traversal = JSON.parse(original);
  traversal.body.proof.report = "diagnosticos/verificacoes/../report.json";
  traversal.digest = digest(JSON.stringify(traversal.body));
  await writeFile(proof.recordFile, JSON.stringify(traversal));
  assert.equal(await store().lookup(prepared), null);
  await writeFile(proof.recordFile, original);
  await writeFile(reportFile, (await readFile(reportFile, "utf8")) + " ");
  assert.equal(await reader.lookup(prepared), null, "o hash da origem é revalidado também dentro da mesma rodada");
  assert.equal(await store().lookup(prepared), null, "até alteração semanticamente neutra invalida o checksum da origem");
  await writeFile(path.join(root, "scripts/run-verification.mjs"), "// changed driver\n");
  assert.equal(await writer.verifyEngine(), false);
  const changedDriver = store();
  assert.notEqual((await changedDriver.prepare("input.mjs")).key, prepared.key);
});

test("lote valida registros distintos numa origem comum e relê a origem na consulta seguinte", async (t) => {
  const { root, store } = await fixture(t);
  const evidence = store();
  const inputs = [];
  for (const [index, source] of ['export const a = 1;', 'export const b = 2;'].entries()) {
    await writeFile(path.join(root, `${index}.mjs`), source);
    const input = await evidence.prepare(`${index}.mjs`);
    assert.equal((await check(["--check", "--input-type=module"], input.source)).code, 0);
    inputs.push(input);
  }
  const file = path.join(root, "diagnosticos/verificacoes/batch/report.json");
  await mkdir(path.dirname(file), { recursive: true });
  const report = { schema: "gerador-de-videos/verification@1", status: "partial-passed", sourceStable: true,
    syntaxEvidence: { ...evidence.describe(), engineStable: await evidence.verifyEngine() },
    syntax: inputs.map((input, index) => ({ name: `syntax-${index}`, status: "passed", exitCode: 0, execution: "executed",
      syntaxInput: input.input, args: ["--check", "--input-type=module"] })) };
  const bytes = JSON.stringify(report);
  await writeFile(file, bytes);
  assert.equal((await evidence.publish(report, file)).published, 2);
  const first = await evidence.lookupBatch([inputs[0], null, inputs[1], inputs[0]]);
  assert.equal(first[1], null);
  assert.equal(first[0].check, "syntax-0");
  assert.equal(first[2].check, "syntax-1");
  assert.deepEqual(first[3], first[0]);
  assert.equal(evidence.describe().originReads, 1);
  await writeFile(file, bytes + " ");
  assert.deepEqual(await evidence.lookupBatch(inputs), [null, null]);
  assert.equal(evidence.describe().originReads, 2);
  assert.equal(await evidence.lookup(inputs[0]), null);
  await writeFile(file, bytes);
  await writeFile(first[0].recordFile, "{}");
  const mixed = await evidence.lookupBatch(inputs);
  assert.equal(mixed[0], null);
  assert.equal(mixed[1].check, "syntax-1");
  assert.deepEqual(await store({ reuse: false }).lookupBatch(inputs), [null, null]);
});
