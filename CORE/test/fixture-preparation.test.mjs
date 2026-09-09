import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureFixturePreparation } from "./fixtures/preparation-profile.mjs";

test("preparação registra operação real e falha sem conteúdo privado nem perda da causa", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fixture-preparation-"));
  const previous = process.env.MKT_VERIFICATION_PROFILE_DIR;
  process.env.MKT_VERIFICATION_PROFILE_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.MKT_VERIFICATION_PROFILE_DIR;
    else process.env.MKT_VERIFICATION_PROFILE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, "private-input.txt");
  const value = await measureFixturePreparation("synthetic-tone", async () => { await writeFile(file, "PRIVATE_SENTINEL"); return { file }; });
  assert.equal(await readFile(value.file, "utf8"), "PRIVATE_SENTINEL");
  const failure = new Error("PRIVATE_ERROR_SENTINEL");
  await assert.rejects(measureFixturePreparation("isolated-cli-workspace", async () => { throw failure; }), error => error === failure);
  await assert.rejects(measureFixturePreparation("PRIVATE_NAME", async () => {}), /não declarada/);
  const content = await readFile(path.join(root, `${process.pid}.jsonl`), "utf8");
  assert.doesNotMatch(content, /PRIVATE|private-input/);
  const rows = content.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.status), ["passed", "failed"]);
  assert.ok(rows.every(row => row.type === "fixture-preparation" && row.durationMs >= 0 && row.startedAtMs > 0));
  delete process.env.MKT_VERIFICATION_PROFILE_DIR;
  assert.equal(await measureFixturePreparation("synthetic-tone", async () => 42), 42);
  assert.equal(await readFile(path.join(root, `${process.pid}.jsonl`), "utf8"), content);
  assert.deepEqual((await readdir(root)).sort(), [`${process.pid}.jsonl`, "private-input.txt"].sort());
  process.env.MKT_VERIFICATION_PROFILE_DIR = path.join(root, "missing");
  await assert.rejects(measureFixturePreparation("synthetic-tone", async () => { throw failure; }), error => error === failure);
  await assert.rejects(measureFixturePreparation("synthetic-tone", async () => 1), { code: "ENOENT" });
});
