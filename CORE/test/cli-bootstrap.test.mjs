import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { pathToFileURL } from "node:url";
import { listCommands } from "../lib/cli/command-registry.mjs";
import { cliFile, coreRoot, runNode } from "./fixtures/cli-boundary-runtime.mjs";
import { runBounded } from "../scripts/verification-plan.mjs";

const concurrency = Number(process.env.MKT_VERIFICATION_BOOTSTRAP_CONCURRENCY ?? Math.min(3, os.availableParallelism()));
assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 3, "Concorrência de bootstrap deve estar entre 1 e 3.");

// Os três contratos têm diretórios, ambiente dos filhos e limpeza próprios.
// A suíte só termina depois de todos; a integração principal exige a aprovação
// deste bootstrap e dos verificadores independentes de leitura.
describe("contratos de bootstrap isolados", { concurrency }, () => {

test("barreira de consultas recusa imports diretos e transitivos nos hooks atual e legado", async (context) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cli-import-guard-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const forbidden = ["node:sqlite", "playwright", "playwright-core", "playwright-core/lib/example"];
  for (const relative of ["lib/cli/context.mjs", "scripts/cookie-studio-operations.mjs", "lib/media-pipeline/index.mjs"]) {
    const file = path.join(cwd, relative);
    await mkdir(path.dirname(file), { recursive: true });
    // Um erro diferente denuncia que o módulo chegou a executar.
    await writeFile(file, 'throw new Error("FORBIDDEN_MODULE_EXECUTED");');
    forbidden.push(pathToFileURL(file).href + "?guard=1#boundary");
  }
  const transitive = path.join(cwd, "transitive.mjs");
  await writeFile(transitive, `import ${JSON.stringify(forbidden.at(-1))};`);
  const script = `
    import assert from "node:assert/strict";
    await import("node:path");
    const blocked = ${JSON.stringify([...forbidden, pathToFileURL(transitive).href])};
    for (const specifier of blocked) {
      await assert.rejects(import(specifier), /CLI_QUERY_HEAVY_IMPORT_FORBIDDEN:/);
    }
    console.log(JSON.stringify({ blocked: blocked.length }));
  `;
  const legacy = pathToFileURL(path.join(coreRoot, "test/fixtures/cli-query-isolation-loader.mjs")).href;
  for (const [name, options] of [
    ["automatic", { isolate: true }],
    ["legacy", { nodeArguments: ["--experimental-loader", legacy] }],
  ]) {
    const result = await runNode(["--input-type=module", "-e", script], { cwd, name, ...options });
    assert.equal(result.code, 0, `${name}: ${result.stderr || result.failure}`);
    assert.equal(JSON.parse(result.stdout).blocked, forbidden.length + 1);
  }
});

test("bootstrap raw não carrega nenhum módulo do Knowledge Core", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-raw-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const loaderFile = path.join(temporary, "block-knowledge-loader.mjs");
  await writeFile(
    loaderFile,
    [
      "const forbidden = /\\/lib\\/media-pipeline\\/knowledge-[^/]+\\.mjs(?:$|[?#])/i;",
      "function assertNotKnowledge(url) {",
      "  if (forbidden.test(url)) throw new Error(`FORBIDDEN_KNOWLEDGE_MODULE_LOAD:${url}`);",
      "}",
      "export async function resolve(specifier, context, nextResolve) {",
      "  const result = await nextResolve(specifier, context);",
      "  assertNotKnowledge(result.url);",
      "  return result;",
      "}",
      "export async function load(url, context, nextLoad) {",
      "  assertNotKnowledge(url);",
      "  return nextLoad(url, context);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const runCli = (args, environment, nodeArguments) => runNode([cliFile, ...args], { cwd: temporary, name: "raw", environment, nodeArguments });
  const result = await runCli(
    [
      "generate",
      "--mode",
      "raw",
      "--prompt",
      "provider-free raw boundary test",
      "--out",
      path.join(temporary, "never-generated.mp4"),
    ],
    {
      MKT_VIDEO_KNOWLEDGE_ROOT: path.join(coreRoot, "forbidden-knowledge"),
      MKT_VIDEO_TEST_COOKIE_ENDPOINT: "",
    },
    ["--experimental-loader", pathToFileURL(loaderFile).href],
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Provider-free test guard/);
  assert.doesNotMatch(result.stderr, /FORBIDDEN_KNOWLEDGE_MODULE_LOAD/);
  assert.doesNotMatch(result.stderr, /knowledge\.sqlite|Knowledge Store/);
});

test("descoberta e planejamento de receita funcionam sem adapters, runtime ou SQLite", async (context) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cli-query-isolation-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const queries = [
    // As duas consultas mais caras começam primeiro; todas são executadas.
    ["receitas", "--action", "validar"],
    ["recipe", "plan", "--file", path.join(coreRoot, "recipes/golden-30s.receita-v2.json"), "--dry-run", "true"],
    ["knowledge", "--action", "packs"],
    ["commands", "--format", "json"],
    ["docs"],
    ["capabilities"],
    ["styles", "--format", "json"],
    ["tecnicas", "--catalog-only", "true"],
    ["voices"],
    ["recipe", "schema"],
  ];
  // Consultas não compartilham banco e o hook proíbe runtime/adapters. Esperar
  // todos os filhos antes das asserções também preserva a limpeza em falhas.
  const width = Number(process.env.MKT_VERIFICATION_QUERY_CONCURRENCY ?? 4);
  assert.ok(Number.isSafeInteger(width) && width >= 1 && width <= 4, "Concorrência de consultas deve estar entre 1 e 4.");
  const results = await runBounded([...queries.entries()], width, ([index, args]) =>
    runNode([cliFile, ...args], { cwd, name: `query-${index}`, isolate: true }));
  for (const [index, args] of queries.entries()) {
    const result = results[index];
    assert.equal(result.code, 0, `${args.join(" ")}: ${result.stderr || result.failure}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload && typeof payload === "object");
    if (args[0] === "commands") assert.equal(payload.commands.length, listCommands().length);
    if (["docs", "capabilities"].includes(args[0])) {
      assert.equal(payload.authentication.mode, "cookie-only");
      assert.ok(payload.capabilityMap.capabilities.length > 0);
      assert.equal(payload.capabilityMap.summary.pending, Object.keys(payload.operationalPending).length);
    }
    if (args[0] === "styles") {
      assert.ok(payload.styles.length > 0);
      assert.ok(payload.styles.every((style) => style.schema === "mkt-videos/style-spec@1"));
      assert.equal(payload.musicBackends["flow-music"].auth, "cookie-session");
      assert.ok(payload.musicPresets.institucional);
    }
    if (args[0] === "tecnicas") assert.ok(payload.entries.length > 0);
    if (args[1] === "plan") assert.equal(payload.providerCalls, 0);
  }
  const typo = await runNode([cliFile, "generat"], { cwd, name: "typo", isolate: true });
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /generate/);
  assert.equal(JSON.parse(typo.stderr.trim().split(/\r?\n/).at(-1)).code, "usage");
});
});
