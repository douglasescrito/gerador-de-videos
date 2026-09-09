import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertStudioGoldenReport,
  buildStudioGoldenReport,
} from "../lib/media-pipeline/studio-golden-corpus.mjs";

async function fixture() {
  return JSON.parse(await readFile(new URL("./fixtures/studio-golden-briefs@1.json", import.meta.url), "utf8"));
}

test("Piloto A compila 20 briefs gold provider-free, determinísticos e isolados", async () => {
  const corpus = await fixture();
  const report = buildStudioGoldenReport(corpus);
  assertStudioGoldenReport(report);
  assert.equal(report.caseCount, 20);
  assert.equal(report.providerCalls, 0);
  assert.equal(report.changed, false);
  assert.equal(report.humanVerdict, "pending");
  assert.equal(report.clientCount, 7);
  assert.equal(report.categories["documentary"], 2);
  assert.equal(report.categories["capability-unavailable"], 2);
  assert.equal(report.cases.every((entry) => entry.context.plannerInfluence === "none"), true);
  assert.equal(new Set(report.cases.map((entry) => entry.planFingerprint)).size, 20);
});

test("Piloto A falha fechado para corpus incompleto ou duplicado", async () => {
  const corpus = await fixture();
  assert.throws(() => buildStudioGoldenReport({ ...corpus, cases: corpus.cases.slice(0, 19) }), /20 briefs/);
  const duplicate = structuredClone(corpus);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => buildStudioGoldenReport(duplicate), /duplicado/);
});

test("auxiliar gold funciona fora de CORE e preserva relatórios existentes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-golden-cli-"));
  const helper = fileURLToPath(new URL("../scripts/estudos/run-studio-golden-corpus.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  try {
    const first = run("--out", "nested/first.json");
    assert.equal(first.status, 0, first.stderr);
    const original = await readFile(path.join(root, "nested/first.json"), "utf8");
    const report = assertStudioGoldenReport(JSON.parse(original));
    const second = run("--corpus=" + fileURLToPath(new URL("./fixtures/studio-golden-briefs@1.json", import.meta.url)), "--out=nested/second.json");
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(await readFile(path.join(root, "nested/second.json"), "utf8")).fingerprint, report.fingerprint);
    const repeated = run("--out", "nested/first.json");
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /Saída já existe/);
    assert.equal(await readFile(path.join(root, "nested/first.json"), "utf8"), original);
    for (const args of [["--out"], ["--out="], ["--unknown"], ["--out=a", "--out=b"]]) {
      assert.notEqual(run(...args).status, 0, args.join(" "));
    }
    assert.equal(run("--help").status, 0);
  } finally {
    // root is the dedicated directory returned by mkdtemp above.
    await rm(root, { recursive: true, force: true });
  }
});
