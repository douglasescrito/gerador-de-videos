import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectCoreContractHashes,
  collectGovernanceBaseline,
  DEFAULT_CORE_CONTRACT_FILES,
  extractTopLevelObjectKeys,
  GOVERNANCE_BASELINE_SCHEMA,
  resolveGovernanceOutputPath,
  writeGovernanceBaseline,
} from "../scripts/governance-baseline.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function put(file, value = "") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

async function createFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "governance-baseline-"));
  const repositoryRoot = path.join(temporary, "repo");
  const coreRoot = path.join(repositoryRoot, "CORE");
  const videoRefsRoot = path.join(temporary, "VIDEO REFS");

  await Promise.all([
    put(path.join(repositoryRoot, "AGENTS.md"), "# policy\n"),
    put(path.join(coreRoot, "package.json"), '{"type":"module"}\n'),
    put(path.join(coreRoot, "README.md"), "# readme\n"),
    put(path.join(coreRoot, "NOTES.md"), "# notes\n"),
    put(path.join(coreRoot, "sample.blocos.json"), "{}\n"),
    put(path.join(coreRoot, "sample.narration-jobs.json"), "[]\n"),
    put(path.join(coreRoot, "other.txt"), "other\n"),
    put(
      path.join(coreRoot, "scripts", "omni-cli.mjs"),
      [
        "// Dispatcher real; contagem de comandos vem de lib/cli/command-registry.mjs.",
        "",
      ].join("\n"),
    ),
    put(
      path.join(coreRoot, "lib", "cli", "command-registry.mjs"),
      [
        "export function listCommands() {",
        "  return [",
        '    { id: "help" },',
        '    { id: "styles" },',
        '    { id: "dry-run" },',
        "  ];",
        "}",
        "",
      ].join("\n"),
    ),
    put(
      path.join(coreRoot, "lib", "media-pipeline", "direction-presets.mjs"),
      [
        "export const DIRECTION_PRESETS = Object.freeze({",
        '  "flat-2d@1": {},',
        '  "aquarela-2d@1": {},',
        "});",
        "",
      ].join("\n"),
    ),
    put(
      path.join(coreRoot, "lib", "media-pipeline", "commercial.mjs"),
      [
        "export const SCENE_STYLES = Object.freeze({",
        "  default: {},",
        "  closer: {},",
        "});",
        "",
      ].join("\n"),
    ),
    mkdir(path.join(coreRoot, "outputs", "alpha"), { recursive: true }),
    mkdir(path.join(coreRoot, "outputs", "beta"), { recursive: true }),
    put(path.join(coreRoot, "outputs", "archive.sqlite"), "not-a-directory"),
    put(path.join(videoRefsRoot, "a.mp4"), "video-a"),
    put(path.join(videoRefsRoot, "nested", "b.MP4"), "video-b"),
    put(path.join(videoRefsRoot, "ignore.txt"), "not-video"),
  ]);

  const runGit = async (args) => {
    const command = args.join("\0");
    if (command === ["rev-parse", "--show-toplevel"].join("\0")) return `${repositoryRoot}\n`;
    if (command === ["rev-parse", "--verify", "HEAD"].join("\0")) return `${"a".repeat(40)}\n`;
    if (command === ["symbolic-ref", "--quiet", "--short", "HEAD"].join("\0")) return "codex/governance\n";
    if (args.includes("--porcelain=v1")) {
      return [
        " M CORE/README.md",
        "?? CORE/.env",
        "?? CORE/new-file.txt",
        "",
      ].join("\0");
    }
    throw new Error(`git inesperado: ${args.join(" ")}`);
  };

  return { temporary, repositoryRoot, coreRoot, videoRefsRoot, runGit };
}

test("extrai somente chaves de primeiro nível dos contratos JavaScript", () => {
  const source = [
    "const allowedOptions = {",
    "  help: new Set([]),",
    '  "dry-run": new Set([]),',
    "  nested: {",
    "    ignored: true,",
    "  },",
    "};",
  ].join("\n");
  assert.deepEqual(extractTopLevelObjectKeys(source, "const allowedOptions ="), ["help", "dry-run", "nested"]);
});

test("contratos canônicos cobrem lockfile e fundação Knowledge com hash determinístico", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const expected = [
    {
      id: "core-package-lock",
      scope: "core",
      path: "package-lock.json",
      content: '{"lockfileVersion":3}\n',
    },
    {
      id: "knowledge-schema-registry",
      scope: "core",
      path: "lib/media-pipeline/knowledge-schema-registry.mjs",
      content: 'export const registry = ["mkt-videos/knowledge-item@1"];\n',
    },
    {
      id: "knowledge-governance-envelope",
      scope: "core",
      path: "lib/media-pipeline/knowledge-governance-envelope.mjs",
      content: 'export const envelope = "mandatory";\n',
    },
    {
      id: "knowledge-backup",
      scope: "core",
      path: "lib/media-pipeline/knowledge-backup.mjs",
      content: 'export const backup = "single-root";\n',
    },
    {
      id: "knowledge-asset-integrity",
      scope: "core",
      path: "lib/media-pipeline/knowledge-asset-integrity.mjs",
      content: 'export const assetIntegrity = "report-only";\n',
    },
    {
      id: "knowledge-schema-replay",
      scope: "core",
      path: "lib/media-pipeline/knowledge-schema-replay.mjs",
      content: 'export const replay = "historical";\n',
    },
    {
      id: "knowledge-importers",
      scope: "core",
      path: "lib/media-pipeline/knowledge-importers.mjs",
      content: 'export const importers = "candidate-only";\n',
    },
  ];
  const defaults = expected.map(({ id }) => DEFAULT_CORE_CONTRACT_FILES.find((entry) => entry.id === id));
  assert.deepEqual(
    defaults,
    expected.map(({ id, scope, path: contractPath }) => ({ id, scope, path: contractPath })),
  );
  assert.equal(new Set(DEFAULT_CORE_CONTRACT_FILES.map(({ id }) => id)).size, DEFAULT_CORE_CONTRACT_FILES.length);

  await Promise.all(expected.map(({ path: contractPath, content }) => put(path.join(fixture.coreRoot, contractPath), content)));
  const first = await collectCoreContractHashes({
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    contractFiles: defaults,
    includeSchemas: false,
  });
  const repeated = await collectCoreContractHashes({
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    contractFiles: [...defaults].reverse(),
    includeSchemas: false,
  });

  assert.equal(first.fileCount, expected.length);
  assert.equal(first.availableFileCount, expected.length);
  assert.equal(first.missingFileCount, 0);
  assert.equal(first.aggregateSha256, repeated.aggregateSha256);
  assert.deepEqual(first.files, repeated.files);
  assert.deepEqual(
    first.files.map(({ id, path: displayPath, sha256: digest }) => ({ id, path: displayPath, sha256: digest })),
    expected
      .map(({ id, path: contractPath, content }) => ({
        id,
        path: `CORE/${contractPath}`,
        sha256: sha256(content),
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
  assert.equal(first.files.some(({ path: displayPath }) => displayPath.includes(fixture.temporary)), false);
});

test("contratos rejeitam IDs e paths ambíguos em vez de ocultar duplicatas", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));

  await assert.rejects(
    collectCoreContractHashes({
      coreRoot: fixture.coreRoot,
      repositoryRoot: fixture.repositoryRoot,
      includeSchemas: false,
      contractFiles: [
        { id: "same-id", scope: "core", path: "README.md" },
        { id: "same-id", scope: "core", path: "package.json" },
      ],
    }),
    /ID de contrato duplicado/,
  );
  await assert.rejects(
    collectCoreContractHashes({
      coreRoot: fixture.coreRoot,
      repositoryRoot: fixture.repositoryRoot,
      includeSchemas: false,
      contractFiles: [
        { id: "first-id", scope: "core", path: "README.md" },
        { id: "second-id", scope: "core", path: "README.md" },
      ],
    }),
    /Path de contrato duplicado/,
  );
});

test("schemas centrais de Knowledge entram automaticamente uma única vez", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const schemaFiles = [
    "knowledge-record-envelope.schema.json",
    "knowledge-backup-manifest.schema.json",
    "knowledge-asset-integrity-report.schema.json",
    "knowledge-replay-report.schema.json",
    "knowledge-import-candidate.schema.json",
  ];
  await Promise.all(schemaFiles.map((file) =>
    put(
      path.join(fixture.coreRoot, "schemas", file),
      `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema" })}\n`,
    )));

  const contracts = await collectCoreContractHashes({
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    contractFiles: [],
    includeSchemas: true,
  });
  const expectedIds = schemaFiles
    .map((file) => `schema:schemas/${file}`)
    .sort();

  assert.equal(contracts.fileCount, schemaFiles.length);
  assert.equal(new Set(contracts.files.map(({ id }) => id)).size, schemaFiles.length);
  assert.deepEqual(contracts.files.map(({ id }) => id).sort(), expectedIds);
});

test("domain packs versionados entram automaticamente no contrato da baseline", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const relative = "knowledge/domain-packs/motion-foundations@1.domain-pack.json";
  const content = `${JSON.stringify({
    schema: "mkt-videos/domain-pack@1",
    id: "motion-foundations",
    version: 1,
  })}\n`;
  await put(path.join(fixture.coreRoot, relative), content);

  const contracts = await collectCoreContractHashes({
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    contractFiles: [],
    includeSchemas: false,
    includeDomainPacks: true,
  });

  assert.deepEqual(contracts.files, [{
    id: `domain-pack:${relative}`,
    path: `CORE/${relative}`,
    status: "available",
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
  }]);
});

test("captura contagens, Git sanitizado, hashes e fingerprint provider-free", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const options = {
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    videoRefsRoot: fixture.videoRefsRoot,
    capturedAt: "2026-07-23T12:00:00-03:00",
    runGit: fixture.runGit,
    contractFiles: [
      { id: "workspace-policy", scope: "repository", path: "AGENTS.md" },
      { id: "core-package", scope: "core", path: "package.json" },
    ],
    includeSchemas: false,
  };
  const baseline = await collectGovernanceBaseline(options);
  const repeated = await collectGovernanceBaseline({ ...options, capturedAt: "2026-07-23T16:00:00Z" });

  assert.equal(baseline.schema, GOVERNANCE_BASELINE_SCHEMA);
  assert.equal(baseline.capturedAt, "2026-07-23T15:00:00.000Z");
  assert.equal(baseline.generator.providerFree, true);
  assert.equal(baseline.root.fileCount, 6);
  assert.equal(baseline.root.markdownFileCount, 2);
  assert.equal(baseline.root.rootWorkFileCount, 2);
  assert.equal(baseline.cli.commandCount, 3);
  assert.equal(baseline.cli.commandCountWithoutHelp, 2);
  assert.equal(baseline.styles.directionPresetCount, 2);
  assert.equal(baseline.styles.canonicalStyleSpecCount, 2);
  assert.equal(baseline.styles.commercialSceneStyleCount, 2);
  assert.equal(baseline.outputs.topLevelDirectoryCount, 2);
  assert.equal(baseline.videoReferences.mp4Count, 2);
  assert.deepEqual(baseline.videoReferences.files.map((file) => file.path), ["a.mp4", "nested/b.MP4"]);
  assert.equal(baseline.videoReferences.files[0].sha256, sha256("video-a"));
  assert.equal(baseline.git.head, "a".repeat(40));
  assert.equal(baseline.git.branch, "codex/governance");
  assert.equal(baseline.git.status.entryCount, 3);
  assert.equal(baseline.git.status.untrackedCount, 2);
  assert.ok(baseline.git.status.entries.some((entry) => entry.path.startsWith("[sensitive-path:") && entry.pathRedacted));
  assert.equal(baseline.coreContracts.availableFileCount, 2);
  assert.equal(baseline.coreContracts.files.find((file) => file.id === "core-package").sha256, sha256('{"type":"module"}\n'));
  assert.equal(repeated.baselineSha256, baseline.baselineSha256);
  assert.notEqual(repeated.capturedAt, baseline.capturedAt);
});

test("grava exclusivamente, atomicamente e sem sobrescrever em diagnosticos/governanca", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const baseline = await collectGovernanceBaseline({
    coreRoot: fixture.coreRoot,
    repositoryRoot: fixture.repositoryRoot,
    videoRefsRoot: fixture.videoRefsRoot,
    capturedAt: "2026-07-23T15:00:00Z",
    runGit: fixture.runGit,
    contractFiles: [{ id: "core-package", scope: "core", path: "package.json" }],
    includeSchemas: false,
  });
  const output = path.join(fixture.coreRoot, "diagnosticos", "governanca", "baseline.json");
  const outside = path.join(fixture.coreRoot, "baseline.json");

  assert.equal(resolveGovernanceOutputPath(output, fixture.coreRoot), output);
  assert.throws(() => resolveGovernanceOutputPath(outside, fixture.coreRoot), /diagnosticos\/governanca/);
  assert.throws(() => resolveGovernanceOutputPath(path.join(fixture.coreRoot, "diagnosticos", "governanca", "nested", "baseline.json"), fixture.coreRoot), /arquivo direto/);
  assert.throws(() => resolveGovernanceOutputPath(null, fixture.coreRoot), /nenhuma escrita/);

  await writeGovernanceBaseline({ baseline, outputFile: output, coreRoot: fixture.coreRoot });
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), baseline);
  await assert.rejects(
    writeGovernanceBaseline({ baseline, outputFile: output, coreRoot: fixture.coreRoot }),
    /não será sobrescrita/,
  );
  await assert.rejects(
    writeGovernanceBaseline({ baseline, outputFile: outside, coreRoot: fixture.coreRoot }),
    /diagnosticos\/governanca/,
  );
});
