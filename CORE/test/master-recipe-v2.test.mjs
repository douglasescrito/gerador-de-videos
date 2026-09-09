import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  compileResolvedMasterRecipe,
  inspectMasterRecipe,
  parseMasterRecipe,
  resolveMasterRecipe,
} from "../lib/media-pipeline/master-recipe-v2.mjs";

const fixtureFile = path.resolve("recipes/golden-30s.receita-v2.json");

test("Receita Mestre 2.5A compila golden de 30 s em 720 frames sem provider", async () => {
  const source = await readFile(fixtureFile);
  const result = inspectMasterRecipe(source, { channel: "file" });
  assert.equal(result.providerCalls, 0);
  assert.equal(result.resolved.derived.durationSeconds, 30);
  assert.equal(result.executionPlan.timeline.locked, true);
  assert.equal(result.executionPlan.timeline.durationFrames, 720);
  assert.deepEqual(result.executionPlan.timeline.tracks[0].spans.map((span) => span.durationFrames), [240, 240, 240]);
  assert.ok(result.executionPlan.nodes.filter((node) => node.kind === "video").every((node) => node.parameters.scene.generationTask === "text_to_video"));
});

test("arquivo e stdin equivalentes convergem nos hashes e fingerprint sem confundir bytes do canal", async () => {
  const source = await readFile(fixtureFile);
  const compact = Buffer.from(JSON.stringify(JSON.parse(source.toString("utf8"))), "utf8");
  const fromFile = inspectMasterRecipe(source, { channel: "file" });
  const fromStdin = inspectMasterRecipe(compact, { channel: "stdin" });
  assert.notEqual(fromFile.parsed.sourceBytesHash, fromStdin.parsed.sourceBytesHash);
  assert.equal(fromFile.parsed.canonicalDocumentHash, fromStdin.parsed.canonicalDocumentHash);
  assert.equal(fromFile.resolved.hashes.normalizedHash, fromStdin.resolved.hashes.normalizedHash);
  assert.equal(fromFile.resolved.hashes.resolvedHash, fromStdin.resolved.hashes.resolvedHash);
  assert.equal(fromFile.executionPlan.fingerprint, fromStdin.executionPlan.fingerprint);
});

test("schema público falha fechado para campo futuro, campo ausente e chave duplicada", async () => {
  const source = await readFile(fixtureFile, "utf8");
  const future = JSON.parse(source);
  future.narration = { module: "google-vids-narration@1" };
  assert.throws(() => parseMasterRecipe(JSON.stringify(future)), /additional properties/);
  const missing = JSON.parse(source);
  delete missing.assembly.transition;
  assert.throws(() => parseMasterRecipe(JSON.stringify(missing)), /required property/);
  assert.throws(() => parseMasterRecipe('{"schema":"gerador-de-videos/receita@2","schema":"duplicado"}'), /chave duplicada: schema/);
});

test("cobertura de shots e soma de frames são invariantes semânticos", async () => {
  const source = JSON.parse(await readFile(fixtureFile, "utf8"));
  source.program.durationFrames = 719;
  assert.throws(() => parseMasterRecipe(JSON.stringify(source)), /soma dos shots/);
  source.program.durationFrames = 720;
  source.videoGeneration.shots[0].shotId = "inexistente";
  assert.throws(() => parseMasterRecipe(JSON.stringify(source)), /corresponder exatamente ao programa/);
});

test("resolver e compilador permanecem puros e determinísticos", async () => {
  const source = await readFile(fixtureFile);
  const parsed = parseMasterRecipe(source);
  const first = resolveMasterRecipe(parsed);
  const second = resolveMasterRecipe(parsed);
  assert.deepEqual(first, second);
  assert.deepEqual(compileResolvedMasterRecipe(first), compileResolvedMasterRecipe(second));
  assert.ok(first.resolutionTrace.every((entry) => entry.origin === "explicit" || entry.origin === "derived"));
});

test("CLI recipe expõe arquivo e stdin pelo mesmo application service", async () => {
  const source = await readFile(fixtureFile);
  const run = (args, input = undefined) => spawnSync(
    process.execPath,
    ["scripts/omni-cli.mjs", "recipe", ...args],
    { cwd: path.resolve("."), input, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
  );
  const fromFile = run(["plan", "--file", fixtureFile, "--dry-run", "true"]);
  const fromStdin = run(["plan", "--stdin", "--dry-run", "true"], Buffer.from(JSON.stringify(JSON.parse(source.toString("utf8")))));
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromStdin.status, 0, fromStdin.stderr);
  const fileResult = JSON.parse(fromFile.stdout);
  const stdinResult = JSON.parse(fromStdin.stdout);
  assert.equal(fileResult.executionPlan.fingerprint, stdinResult.executionPlan.fingerprint);
  assert.equal(fileResult.resolved.hashes.resolvedHash, stdinResult.resolved.hashes.resolvedHash);
  assert.equal(fileResult.providerCalls, 0);
  assert.equal(stdinResult.providerCalls, 0);
  for (const action of ["schema", "validate", "resolve", "explain"]) {
    const invocation = action === "schema" ? run([action]) : run([action, "--file", fixtureFile]);
    assert.equal(invocation.status, 0, `${action}: ${invocation.stderr}`);
    assert.doesNotThrow(() => JSON.parse(invocation.stdout), action);
  }
});
