import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkKnowledgeStoreIntegrity,
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  assertKnowledgeRecordPayloadContract,
  KNOWLEDGE_ASSERTION_SCHEMA,
  KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
  KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
  KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import { createReceipt } from "../lib/media-pipeline/receipt.mjs";
import { createIsolatedCliWorkspace } from "./fixtures/isolated-cli-workspace.mjs";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const isolatedWorkspace = await createIsolatedCliWorkspace(sourceRoot);
after(() => isolatedWorkspace.dispose());
const { coreRoot, guardFile } = isolatedWorkspace;
const cliFile = path.join(coreRoot, "scripts", "omni-cli.mjs");

test("workspace do Knowledge CLI bloqueia inventário operacional e conserva o entrypoint original", async (context) => {
  assert.deepEqual(await readFile(cliFile), await readFile(path.join(sourceRoot, "scripts/omni-cli.mjs")));
  const script = `import assert from "node:assert/strict";
    import { readdirSync } from "node:fs";
    import { readdir } from "node:fs/promises";
    assert.throws(() => readdirSync(${JSON.stringify(path.join(sourceRoot, "outputs"))}), /OPERATIONAL_MEDIA_ENUMERATION_FORBIDDEN/);
    await assert.rejects(async () => readdir(${JSON.stringify(path.resolve(sourceRoot, "../PESSOAS"))}), /OPERATIONAL_MEDIA_ENUMERATION_FORBIDDEN/);
    assert.deepEqual(await readdir(${JSON.stringify(path.join(coreRoot, "outputs"))}), []);
    console.log("isolated");`;
  const result = await execFileAsync(process.execPath, ["--import", pathToFileURL(guardFile).href, "--input-type=module", "-e", script], {
    cwd: coreRoot, windowsHide: true, env: { ...process.env, NODE_ENV: "test" },
  });
  assert.equal(result.stdout.trim(), "isolated");
  context.diagnostic(`Workspace provider-free preparado em ${isolatedWorkspace.preparationMs} ms; outputs/PESSOAS físicos e descartáveis.`);
});

async function runCli(args, environment = {}, nodeArguments = []) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ["--import", pathToFileURL(guardFile).href, ...nodeArguments, cliFile, ...args],
      {
        cwd: coreRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...environment,
        },
      },
    );
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: Number(error?.code ?? 1),
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? ""),
    };
  }
}

function parseJson(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        canonicalizeJson(value[key]),
      ]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

async function convertEmptyBackupManifestToV1(sourceFile, destinationFile) {
  const source = await readFile(sourceFile);
  const magicBytes = 8;
  const headerBytes = magicBytes + 4;
  const manifestBytes = source.readUInt32BE(magicBytes);
  const current = JSON.parse(
    source.subarray(headerBytes, headerBytes + manifestBytes).toString("utf8"),
  );
  assert.equal(current.assets.count, 0);
  const legacyBody = {
    ...current,
    schema: "mkt-videos/knowledge-backup-manifest@1",
    scopeAttestation: current.scopeAttestation == null
      ? null
      : {
          rootScopeHash: current.scopeAttestation.rootScopeHash,
          ledgerHead: current.scopeAttestation.ledgerHead,
          integritySha256: current.scopeAttestation.integritySha256,
        },
    assets: {
      mode: "not-included",
      count: 0,
      aggregateSha256: null,
      entries: [],
    },
  };
  delete legacyBody.manifestHash;
  const legacy = {
    ...legacyBody,
    manifestHash: createHash("sha256")
      .update(canonicalJson(legacyBody), "utf8")
      .digest("hex"),
  };
  const serialized = Buffer.from(canonicalJson(legacy), "utf8");
  const header = Buffer.alloc(headerBytes);
  source.subarray(0, magicBytes).copy(header, 0);
  header.writeUInt32BE(serialized.length, magicBytes);
  const snapshot = source.subarray(headerBytes + manifestBytes);
  await writeFile(
    destinationFile,
    Buffer.concat([header, serialized, snapshot]),
  );
}

function issueGrant(rootScopeId) {
  const issuedAt = new Date();
  return createScopeGrant({
    rootScopeIds: [rootScopeId],
    permissions: ["read", "write", "release", "export", "integrity"],
    actor: "knowledge-cli-test",
    purpose: "provider-free CLI fixture",
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1000),
  });
}

function createRoot(repository, grant, rootScopeId, name) {
  repository.createScope({
    grant,
    scope: {
      id: rootScopeId,
      rootScopeId,
      kind: "client",
      name,
    },
  });
}

function scopeReference(rootScopeId, id = rootScopeId) {
  return {
    schema: "mkt-videos/knowledge-reference@1",
    kind: "scope",
    rootScopeId,
    id,
  };
}

function itemReference(item) {
  return {
    schema: "mkt-videos/knowledge-reference@1",
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function governedItem(item, grant, {
  rights = {},
  modality = "fact",
} = {}) {
  assertKnowledgeRecordPayloadContract({
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    payload: item.payload,
  });
  const createdAt = new Date(item.createdAt ?? grant.issuedAt).toISOString();
  const createdBy = grant.actor;
  const evidenceIds = (item.payload.evidenceRefs ?? [])
    .map((reference) => reference.id);
  return {
    ...item,
    governance: createKnowledgeRecordEnvelope({
      classification: "confidential",
      owner: { type: "client", id: item.rootScopeId },
      provenance: [{
        sourceType: "test-fixture",
        sourceRef: `fixture:${item.rootScopeId}/${item.id}/${item.revision}`,
        method: "manual",
        observedAt: createdAt,
        contentHash: createHash("sha256")
          .update(JSON.stringify(item.payload ?? {}), "utf8")
          .digest("hex"),
      }],
      modality,
      evidenceIds,
      retention: { policy: "manual-review" },
      rights,
      createdAt,
      createdBy,
    }, { expectedActor: grant.actor }),
    createdAt,
    createdBy,
  };
}

function governedDecisionItem({
  id,
  revision = 1,
  rootScopeId,
  scopeId = rootScopeId,
  status,
  question,
  selectedLabel,
  alternativeLabel = "Não aplicar esta direção",
  rationale,
  impact = {},
}, grant, {
  rights = {},
} = {}) {
  const decidedAt = new Date(grant.issuedAt).toISOString();
  return governedItem({
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType: "decision",
    schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
    schemaVersion: 1,
    ...(status == null ? {} : { status }),
    payload: {
      schema: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      question,
      options: [
        { id: "selected", label: selectedLabel },
        { id: "alternative", label: alternativeLabel },
      ],
      selectedOptionId: "selected",
      rationale,
      contextRefs: [scopeReference(rootScopeId, scopeId)],
      evidenceRefs: [],
      confidence: 1,
      impact,
      humanConfirmed: true,
      approvedBy: grant.actor,
      decidedAt,
    },
  }, grant, {
    rights,
    modality: "preference",
  });
}

function governedEvidenceItem({
  id,
  revision = 1,
  rootScopeId,
  scopeId = rootScopeId,
  observation,
  targetRefs = [],
}, grant) {
  const observedAt = new Date(grant.issuedAt).toISOString();
  return governedItem({
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType: "evidence",
    schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
    schemaVersion: 1,
    payload: {
      schema: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
      source: {
        sourceType: "test-fixture",
        sourceRef: `fixture:${rootScopeId}/${id}/${revision}`,
        contentHash: createHash("sha256")
          .update(observation, "utf8")
          .digest("hex"),
        method: "manual",
        observedAt,
        fragment: null,
      },
      relation: "documents",
      targetRefs,
      observation,
      confidence: 1,
      evidenceRefs: [],
    },
  }, grant, {
    modality: "observation",
  });
}

function governedAssertionItem({
  id,
  revision = 1,
  rootScopeId,
  scopeId = rootScopeId,
  status,
  predicate,
  value,
  evidenceRefs = [],
}, grant, {
  rights = {},
} = {}) {
  return governedItem({
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType: "assertion",
    schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
    schemaVersion: 1,
    ...(status == null ? {} : { status }),
    payload: {
      schema: KNOWLEDGE_ASSERTION_SCHEMA,
      subjectRef: scopeReference(rootScopeId, scopeId),
      predicate,
      value,
      polarity: "positive",
      applicability: {},
      confidence: 0.75,
      evidenceRefs,
    },
  }, grant, {
    rights,
    modality: status === "candidate" ? "hypothesis" : "fact",
  });
}

test("knowledge status ausente é read-only e não cria diretório ou banco", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-status-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const knowledgeRoot = path.join(temporary, "private-store");
  const result = parseJson(await runCli(
    ["knowledge"],
    { MKT_VIDEO_KNOWLEDGE_ROOT: knowledgeRoot },
  ));

  assert.equal(result.action, "status");
  assert.equal(result.status, "not_initialized");
  assert.equal(result.readOnly, true);
  assert.equal(result.changed, false);
  assert.equal(result.store.exists, false);
  await assert.rejects(stat(knowledgeRoot), { code: "ENOENT" });
});

test("knowledge packs projeta catálogo sem DB, node:sqlite ou conteúdo integral", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-packs-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const knowledgeRoot = path.join(temporary, "must-not-exist");
  const environment = { MKT_VIDEO_KNOWLEDGE_ROOT: knowledgeRoot };
  const moduleIsolationLoader = path.join(
    temporary,
    "block-private-knowledge-loader.mjs",
  );
  await writeFile(
    moduleIsolationLoader,
    [
      "const privateKnowledge = /\\/lib\\/media-pipeline\\/knowledge-(?:service|store)\\.mjs(?:$|[?#])/i;",
      "export async function resolve(specifier, context, nextResolve) {",
      "  if (specifier === 'node:sqlite') {",
      "    throw new Error('SQLITE_MODULE_LOAD_FORBIDDEN');",
      "  }",
      "  const result = await nextResolve(specifier, context);",
      "  if (privateKnowledge.test(result.url)) {",
      "    throw new Error(`PRIVATE_KNOWLEDGE_MODULE_LOAD_FORBIDDEN:${result.url}`);",
      "  }",
      "  return result;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const first = parseJson(await runCli(
    ["knowledge", "--action", "packs"],
    environment,
  ));
  const second = parseJson(await runCli(
    ["knowledge", "--action", "packs"],
    environment,
  ));
  const isolatedRun = await runCli(
    ["knowledge", "--action", "packs"],
    environment,
    ["--experimental-loader", pathToFileURL(moduleIsolationLoader).href],
  );
  const repeatedActionRun = await runCli(
    ["knowledge", "--action", "init", "--action", "packs"],
    environment,
    ["--experimental-loader", pathToFileURL(moduleIsolationLoader).href],
  );
  assert.doesNotMatch(
    isolatedRun.stderr,
    /SQLITE_MODULE_LOAD_FORBIDDEN|PRIVATE_KNOWLEDGE_MODULE_LOAD_FORBIDDEN/,
  );
  const isolated = parseJson(isolatedRun);
  const repeatedAction = parseJson(repeatedActionRun);

  assert.deepEqual(second, first);
  assert.deepEqual(isolated, first);
  assert.deepEqual(repeatedAction, first);
  assert.deepEqual(Object.keys(first), [
    "schema",
    "action",
    "status",
    "providerFree",
    "readOnly",
    "changed",
    "deterministic",
    "approvalVerified",
    "manifest",
  ]);
  assert.equal(
    first.schema,
    "mkt-videos/knowledge-domain-pack-action-result@1",
  );
  assert.equal(first.action, "packs");
  assert.equal(first.status, "catalog-loaded");
  assert.equal(first.providerFree, true);
  assert.equal(first.readOnly, true);
  assert.equal(first.changed, false);
  assert.equal(first.deterministic, true);
  assert.equal(first.approvalVerified, false);
  assert.equal(first.manifest.packCount, first.manifest.packs.length);
  assert.equal(first.manifest.packCount, first.manifest.loadOrder.length);
  assert.match(first.manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(
    first.manifest.counts.candidates,
    first.manifest.packCount,
  );
  for (const pack of first.manifest.packs) {
    assert.equal(pack.status, "candidate");
    assert.equal(pack.approvalVerified, false);
    assert.equal(Object.hasOwn(pack, "declaredStatus"), false);
    assert.equal(Object.hasOwn(pack, "effectiveStatus"), false);
    assert.match(pack.hashes.fileSha256, /^[a-f0-9]{64}$/);
    assert.match(pack.hashes.contentHash, /^[a-f0-9]{64}$/);
  }
  for (const key of Object.keys(first.manifest.counts.content)) {
    assert.equal(
      first.manifest.counts.content[key],
      first.manifest.packs.reduce(
        (total, pack) => total + pack.counts[key],
        0,
      ),
    );
  }

  const firstPack = first.manifest.packs[0];
  const sourceDocument = JSON.parse(await readFile(
    path.join(
      coreRoot,
      "knowledge",
      "domain-packs",
      `${firstPack.ref}.domain-pack.json`,
    ),
    "utf8",
  ));
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(sourceDocument.title), false);
  assert.equal(serialized.includes(sourceDocument.summary), false);
  assert.equal(Object.hasOwn(firstPack, "document"), false);
  assert.equal(Object.hasOwn(firstPack, "sources"), false);
  await assert.rejects(stat(knowledgeRoot), { code: "ENOENT" });
});

test("knowledge packs rejeita store, escopo, input, grant e confirmações", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-packs-options-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const knowledgeRoot = path.join(temporary, "must-not-exist");
  const forbiddenOptions = [
    ["--db", path.join(temporary, "knowledge.sqlite")],
    ["--root-scope-id", "client:forbidden"],
    ["--input", path.join(temporary, "input.json")],
    ["--grant", "forbidden"],
    ["--confirm-human", "true"],
    ["--confirm-paid", "true"],
  ];

  for (const option of forbiddenOptions) {
    const result = await runCli(
      ["knowledge", "--action", "packs", ...option],
      { MKT_VIDEO_KNOWLEDGE_ROOT: knowledgeRoot },
    );
    assert.equal(result.code, 1, `${option[0]} deveria ser rejeitada`);
    assert.match(result.stderr, /Opção desconhecida para knowledge/);
  }
  await assert.rejects(stat(knowledgeRoot), { code: "ENOENT" });
});

test("knowledge init é idempotente e integrity permanece report-only", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-init-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const knowledgeRoot = path.join(temporary, "private-store");
  const environment = { MKT_VIDEO_KNOWLEDGE_ROOT: knowledgeRoot };

  const first = parseJson(await runCli(
    ["knowledge", "--action", "init"],
    environment,
  ));
  const second = parseJson(await runCli(
    ["knowledge", "--action", "init"],
    environment,
  ));
  const status = parseJson(await runCli(["knowledge"], environment));
  const integrity = parseJson(await runCli(
    ["knowledge", "--action", "integrity"],
    environment,
  ));

  assert.equal(first.status, "ready");
  assert.equal(first.changed, true);
  assert.equal(second.status, "ready");
  assert.equal(second.changed, false);
  assert.equal(status.store.userVersion, 4);
  assert.equal(integrity.status, "pass");
  assert.equal(integrity.readOnly, true);
  assert.equal(integrity.reportOnly, true);
  assert.equal(integrity.repairPerformed, false);
  assert.equal(integrity.global.ok, true);
  assert.equal(integrity.linkedArtifacts.status, "not_applicable");
  assert.equal(
    (await stat(path.join(knowledgeRoot, "knowledge.sqlite"))).isFile(),
    true,
  );
});

test("knowledge restore exige --db explícito e rejeita opções irrelevantes", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-restore-options-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const sourceDb = path.join(temporary, "source", "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile: sourceDb });
  const backupFile = path.join(temporary, "backups", "empty.mkvbackup");
  const backup = parseJson(await runCli([
    "knowledge",
    "--action",
    "backup",
    "--db",
    sourceDb,
    "--classification",
    "internal",
    "--out",
    backupFile,
  ]));
  assert.equal(backup.status, "backed-up");
  assert.equal(backup.scopedAttestation, false);

  const implicitKnowledgeRoot = path.join(
    temporary,
    "must-not-be-restore-destination",
  );
  const withoutExplicitDb = await runCli(
    [
      "knowledge",
      "--action",
      "restore",
      "--backup",
      backupFile,
    ],
    { MKT_VIDEO_KNOWLEDGE_ROOT: implicitKnowledgeRoot },
  );
  assert.equal(withoutExplicitDb.code, 1);
  assert.match(withoutExplicitDb.stderr, /restore exige --db/);
  await assert.rejects(stat(implicitKnowledgeRoot), { code: "ENOENT" });

  const destinationDb = path.join(
    temporary,
    "restore",
    "knowledge.sqlite",
  );
  const irrelevantOptions = [
    ["--release-id", "release:irrelevante"],
    ["--out", path.join(temporary, "irrelevant-output.json")],
    ["--classification", "confidential"],
  ];
  for (const option of irrelevantOptions) {
    const result = await runCli([
      "knowledge",
      "--action",
      "restore",
      "--backup",
      backupFile,
      "--db",
      destinationDb,
      ...option,
    ]);
    assert.equal(result.code, 1, `Opção deveria falhar: ${option[0]}`);
    assert.match(
      result.stderr,
      /restore não aceita --release-id, --out nem --classification/,
    );
    await assert.rejects(stat(destinationDb), { code: "ENOENT" });
  }
});

test("knowledge export é determinístico, não vaza outro root e não sobrescreve", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-export-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const knowledgeRoot = path.join(temporary, "private-store");
  const dbFile = path.join(knowledgeRoot, "knowledge.sqlite");
  const environment = { MKT_VIDEO_KNOWLEDGE_ROOT: knowledgeRoot };
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const grantA = issueGrant("client:a");
  const grantB = issueGrant("client:b");
  createRoot(repository, grantA, "client:a", "Cliente A");
  createRoot(repository, grantB, "client:b", "Cliente B");
  const itemA = repository.appendKnowledgeItem({
    grant: grantA,
    item: governedDecisionItem({
      id: "decision:cta",
      rootScopeId: "client:a",
      question: "Qual direção de CTA deve ser preservada?",
      selectedLabel: "CTA com pausa de 24 frames",
      rationale: "Direção aprovada para o Cliente A.",
      impact: {
        holdFrames: 24,
        privateText: "somente-cliente-a",
      },
    }, grantA),
  });
  repository.appendKnowledgeItem({
    grant: grantB,
    item: governedDecisionItem({
      id: "decision:private-b",
      rootScopeId: "client:b",
      question: "Qual direção privada deve ser preservada?",
      selectedLabel: "Direção privada do Cliente B",
      rationale: "Direção aprovada somente para o Cliente B.",
      impact: { privateText: "segredo-cliente-b" },
    }, grantB),
  });
  const release = repository.createRelease({
    grant: grantA,
    rootScopeId: "client:a",
    label: "release aprovada",
    members: [{ id: itemA.id, revision: itemA.revision }],
  });
  const firstOutput = path.join(temporary, "client-a-1.json");
  const secondOutput = path.join(temporary, "client-a-2.json");
  const argumentsBase = [
    "knowledge",
    "--action",
    "export",
    "--root-scope-id",
    "client:a",
    "--release-id",
    release.id,
  ];

  const first = parseJson(await runCli(
    [...argumentsBase, "--out", firstOutput],
    environment,
  ));
  const second = parseJson(await runCli(
    [...argumentsBase, "--out", secondOutput],
    environment,
  ));
  const firstBytes = await readFile(firstOutput, "utf8");
  const secondBytes = await readFile(secondOutput, "utf8");

  assert.equal(first.status, "exported");
  assert.equal(first.readOnly, false);
  assert.equal(first.storeReadOnly, true);
  assert.equal(first.changed, true);
  assert.equal(first.sha256, second.sha256);
  assert.equal(firstBytes, secondBytes);
  assert.equal(firstBytes.includes("somente-cliente-a"), true);
  assert.equal(firstBytes.includes("segredo-cliente-b"), false);
  assert.equal(firstBytes.includes("client:b"), false);

  const overwrite = await runCli(
    [...argumentsBase, "--out", firstOutput],
    environment,
  );
  assert.equal(overwrite.code, 1);
  assert.match(overwrite.stderr, /não será sobrescrita/);
  assert.equal(await readFile(firstOutput, "utf8"), firstBytes);

  const forbiddenOutput = path.join(coreRoot, "private-knowledge-export.json");
  const forbidden = await runCli(
    [...argumentsBase, "--out", forbiddenOutput],
    environment,
  );
  assert.equal(forbidden.code, 1);
  assert.match(forbidden.stderr, /não pode ser gravado dentro do workspace/);
  await assert.rejects(stat(forbiddenOutput), { code: "ENOENT" });

  const repositoryRootOutput = path.join(
    coreRoot,
    "..",
    "private-knowledge-export.json",
  );
  const repositoryRootAttempt = await runCli(
    [...argumentsBase, "--out", repositoryRootOutput],
    environment,
  );
  assert.equal(repositoryRootAttempt.code, 1);
  assert.match(
    repositoryRootAttempt.stderr,
    /não pode ser gravado dentro do workspace/,
  );
  await assert.rejects(stat(repositoryRootOutput), { code: "ENOENT" });
});

test("knowledge backup/restore usa snapshot real e bloqueia store multi-root", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "knowledge-cli-backup-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const unlinkedMedia = path.join(coreRoot, "outputs", "unlinked-fixture.bin");
  await writeFile(unlinkedMedia, "controlled-unlinked-media");
  context.after(() => rm(unlinkedMedia, { force: true }));
  const sourceDb = path.join(temporary, "private-source", "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile: sourceDb });
  const repository = createKnowledgeStoreRepository({ dbFile: sourceDb });
  const rootId = "client:backup-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de backup CLI");
  repository.appendKnowledgeItem({
    grant,
    item: governedDecisionItem({
      id: "decision:backup-cli",
      rootScopeId: rootId,
      question: "O snapshot governado deve ser preservado?",
      selectedLabel: "Preservar snapshot",
      rationale: "Decisão humana usada no fixture de backup.",
      impact: { snapshotPolicy: "preserve" },
    }, grant),
  });

  const backupFile = path.join(temporary, "backups", "knowledge.mkvbackup");
  const backup = parseJson(await runCli([
    "knowledge",
    "--action",
    "backup",
    "--db",
    sourceDb,
    "--root-scope-id",
    rootId,
    "--classification",
    "confidential",
    "--out",
    backupFile,
  ]));
  assert.equal(backup.status, "backed-up");
  assert.equal(backup.providerFree, true);
  assert.equal(backup.storeReadOnly, true);
  assert.equal(backup.scopedAttestation, true);
  assert.equal(backup.classification, "confidential");
  assert.equal((await stat(backupFile)).isFile(), true);

  const restoredDb = path.join(temporary, "private-restore", "knowledge.sqlite");
  const restored = parseJson(await runCli([
    "knowledge",
    "--action",
    "restore",
    "--backup",
    backupFile,
    "--root-scope-id",
    rootId,
    "--db",
    restoredDb,
  ]));
  assert.equal(
    restored.schema,
    "mkt-videos/knowledge-restore-action-result@2",
  );
  assert.equal(restored.status, "restored");
  assert.equal(restored.providerFree, true);
  assert.equal(restored.scopeAttestationVerified, true);
  assert.equal(restored.repairPerformed, false);
  assert.equal(restored.assets.mode, "governed-inventory");
  assert.equal(restored.assets.status, "match");
  const { extra, ...stableAssetCounts } = restored.assets.counts;
  assert.deepEqual(stableAssetCounts, {
    total: 0,
    resolved: 0,
    missing: 0,
    revoked: 0,
    quarantined: 0,
    divergent: 0,
    unsafe: 0,
  });
  assert.equal(extra, 1, "inventário deve conter somente o arquivo extra da fixture");
  assert.equal(checkKnowledgeStoreIntegrity({ dbFile: restoredDb }).ok, true);

  const legacyBackupFile = path.join(
    temporary,
    "backups",
    "knowledge-v1.mkvbackup",
  );
  await convertEmptyBackupManifestToV1(backupFile, legacyBackupFile);
  const legacyRestoredDb = path.join(
    temporary,
    "private-restore-v1",
    "knowledge.sqlite",
  );
  const legacyRestored = parseJson(await runCli([
    "knowledge",
    "--action",
    "restore",
    "--backup",
    legacyBackupFile,
    "--root-scope-id",
    rootId,
    "--db",
    legacyRestoredDb,
  ]));
  assert.equal(
    legacyRestored.schema,
    "mkt-videos/knowledge-restore-action-result@2",
  );
  assert.equal(legacyRestored.status, "restored");
  assert.equal(legacyRestored.assets.mode, "not-included");
  assert.equal(legacyRestored.assets.status, "not-declared");
  assert.deepEqual(legacyRestored.assets.counts, {
    total: 0,
    resolved: 0,
    missing: 0,
    revoked: 0,
    quarantined: 0,
    extra: 0,
    divergent: 0,
    unsafe: 0,
  });
  assert.equal(
    checkKnowledgeStoreIntegrity({ dbFile: legacyRestoredDb }).ok,
    true,
  );

  const before = await readFile(restoredDb);
  const overwrite = await runCli([
    "knowledge",
    "--action",
    "restore",
    "--backup",
    backupFile,
    "--root-scope-id",
    rootId,
    "--db",
    restoredDb,
  ]);
  assert.equal(overwrite.code, 1);
  assert.match(overwrite.stderr, /não será sobrescrita|já existe/);
  assert.deepEqual(await readFile(restoredDb), before);

  const secondRootId = "client:backup-cli-second";
  const secondGrant = issueGrant(secondRootId);
  createRoot(repository, secondGrant, secondRootId, "Segundo cliente");
  const forbiddenMultiRoot = path.join(
    temporary,
    "backups",
    "multi-root.mkvbackup",
  );
  const blocked = await runCli([
    "knowledge",
    "--action",
    "backup",
    "--db",
    sourceDb,
    "--root-scope-id",
    rootId,
    "--classification",
    "confidential",
    "--out",
    forbiddenMultiRoot,
  ]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /múltiplos roots|snapshot global/);
  await assert.rejects(stat(forbiddenMultiRoot), { code: "ENOENT" });

  const publicBackup = await runCli([
    "knowledge",
    "--action",
    "backup",
    "--db",
    restoredDb,
    "--root-scope-id",
    rootId,
    "--classification",
    "public",
    "--out",
    path.join(temporary, "backups", "public.mkvbackup"),
  ]);
  assert.equal(publicBackup.code, 1);
  assert.match(publicBackup.stderr, /Classificação inválida/);
});

test("knowledge release lifecycle exige confirmação humana e preserva rollback exato", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-release-lifecycle-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const rootId = "client:release-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de lifecycle");
  const item = repository.appendKnowledgeItem({
    grant,
    item: governedDecisionItem({
      id: "decision:release-cli",
      rootScopeId: rootId,
      question: "Qual conhecimento pode entrar no lifecycle da release?",
      selectedLabel: "Usar somente conhecimento aprovado",
      rationale: "A release deve conter apenas conhecimento aprovado.",
      impact: { releasePolicy: "approved-only" },
    }, grant, {
      rights: { localAnalysis: "allowed" },
    }),
  });
  const releaseOne = repository.createRelease({
    grant,
    rootScopeId: rootId,
    label: "Release inicial",
    members: [{ id: item.id, revision: item.revision }],
  });
  const releaseTwo = repository.createRelease({
    grant,
    rootScopeId: rootId,
    label: "Release sucessora",
    previousReleaseId: releaseOne.id,
    members: [{ id: item.id, revision: item.revision }],
  });

  const activeBefore = parseJson(await runCli([
    "knowledge",
    "--action",
    "active-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
  ]));
  assert.equal(activeBefore.status, "no-active-release");
  assert.equal(activeBefore.readOnly, true);
  assert.equal(activeBefore.changed, false);
  assert.equal(activeBefore.release, null);
  assert.equal(activeBefore.activation, null);

  const missingConfirmation = await runCli([
    "knowledge",
    "--action",
    "activate-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    releaseOne.id,
    "--expected-activation-id",
    "none",
    "--reason",
    "aprovação inicial",
  ]);
  assert.equal(missingConfirmation.code, 1);
  assert.match(missingConfirmation.stderr, /--confirm-human true/);
  assert.equal(
    repository.listReleaseActivations({
      grant,
      rootScopeId: rootId,
    }).length,
    0,
  );

  const first = parseJson(await runCli([
    "knowledge",
    "--action",
    "activate-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    releaseOne.id,
    "--expected-activation-id",
    "none",
    "--reason",
    "aprovação humana inicial",
    "--confirm-human",
    "true",
  ]));
  assert.equal(first.status, "activated");
  assert.equal(first.humanConfirmed, true);
  assert.equal(first.release.id, releaseOne.id);
  assert.equal(first.release.hash, releaseOne.hash);
  assert.equal(first.activation.previousActivationId, null);

  const second = parseJson(await runCli([
    "knowledge",
    "--action",
    "activate-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    releaseTwo.id,
    "--expected-activation-id",
    first.activation.id,
    "--reason",
    "aprovação humana da sucessora",
    "--confirm-human",
    "true",
  ]));
  assert.equal(second.status, "activated");
  assert.equal(second.release.id, releaseTwo.id);
  assert.equal(second.activation.previousActivationId, first.activation.id);

  const rollback = parseJson(await runCli([
    "knowledge",
    "--action",
    "rollback-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    releaseOne.id,
    "--expected-activation-id",
    second.activation.id,
    "--reason",
    "rollback humano para release conhecida",
    "--confirm-human",
    "true",
  ]));
  assert.equal(rollback.status, "rolled-back");
  assert.equal(rollback.release.id, releaseOne.id);
  assert.equal(rollback.release.hash, releaseOne.hash);
  assert.equal(
    rollback.activation.previousActivationId,
    second.activation.id,
  );

  const activeAfter = parseJson(await runCli([
    "knowledge",
    "--action",
    "active-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
  ]));
  assert.equal(activeAfter.status, "active");
  assert.equal(activeAfter.eligible, true);
  assert.equal(activeAfter.release.id, releaseOne.id);
  assert.equal(activeAfter.release.hash, releaseOne.hash);
  assert.equal(activeAfter.activation.id, rollback.activation.id);

  const staleCas = await runCli([
    "knowledge",
    "--action",
    "activate-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    releaseTwo.id,
    "--expected-activation-id",
    first.activation.id,
    "--reason",
    "tentativa concorrente obsoleta",
    "--confirm-human",
    "true",
  ]);
  assert.equal(staleCas.code, 1);
  assert.match(
    staleCas.stderr,
    /diverge de expectedCurrentActivationId/,
  );
  assert.equal(
    repository.listReleaseActivations({
      grant,
      rootScopeId: rootId,
    }).length,
    3,
  );
});

test("knowledge review-item promove e quarentena somente com confirmação humana", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-review-item-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const rootId = "client:review-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de review");
  const evidence = repository.appendKnowledgeItem({
    grant,
    item: governedEvidenceItem({
      id: "evidence:review-cli",
      rootScopeId: rootId,
      observation: "aceite humano",
    }, grant),
  });
  const candidate = repository.appendKnowledgeItem({
    grant,
    item: governedAssertionItem({
      id: "assertion:review-cli",
      rootScopeId: rootId,
      status: "candidate",
      predicate: "creative.direction-candidate",
      value: { direction: "direção candidata" },
      evidenceRefs: [itemReference(evidence)],
    }, grant, {
      rights: { localAnalysis: "allowed" },
    }),
  });

  const withoutConfirmation = await runCli([
    "knowledge",
    "--action",
    "review-item",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--item-id",
    candidate.id,
    "--operation",
    "promote",
    "--expected-revision",
    String(candidate.revision),
    "--expected-content-hash",
    candidate.contentHash,
    "--reason",
    "tentativa sem confirmação",
  ]);
  assert.equal(withoutConfirmation.code, 1);
  assert.match(withoutConfirmation.stderr, /--confirm-human true/);
  assert.equal(
    repository.listReviewDecisions({
      grant,
      rootScopeId: rootId,
    }).length,
    0,
  );

  const promoted = parseJson(await runCli([
    "knowledge",
    "--action",
    "review-item",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--item-id",
    candidate.id,
    "--operation",
    "promote",
    "--expected-revision",
    String(candidate.revision),
    "--expected-content-hash",
    candidate.contentHash,
    "--evidence-id",
    evidence.id,
    "--reason",
    "aprovação humana registrada",
    "--confirm-human",
    "true",
  ]));
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.humanConfirmed, true);
  assert.equal(promoted.decision.action, "promote");
  assert.equal(promoted.item.status, "active");
  assert.deepEqual(promoted.item.payload, candidate.payload);
  assert.deepEqual(promoted.decision.evidenceIds, [evidence.id]);

  const quarantined = parseJson(await runCli([
    "knowledge",
    "--action",
    "review-item",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--item-id",
    promoted.item.id,
    "--operation",
    "quarantine",
    "--expected-revision",
    String(promoted.item.revision),
    "--expected-content-hash",
    promoted.item.contentHash,
    "--reason",
    "quarentena humana explícita",
    "--confirm-human",
    "true",
  ]));
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.decision.action, "quarantine");
  assert.equal(quarantined.item.status, "quarantined");
  assert.equal(quarantined.item.revision, 3);
  assert.equal(
    repository.listReviewDecisions({
      grant,
      rootScopeId: rootId,
    }).length,
    2,
  );
  assert.equal(
    repository.checkIntegrity({
      grant,
      rootScopeId: rootId,
    }).ok,
    true,
  );
});

test("knowledge register-asset-link lê spec privado e usa a API governada", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-register-asset-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const rootId = "client:asset-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de asset CLI");
  const sourceHash = createHash("sha256")
    .update("receipt privado do asset", "utf8")
    .digest("hex");
  const assetHash = createHash("sha256")
    .update("bytes esperados do vídeo", "utf8")
    .digest("hex");
  const inputFile = path.join(temporary, "asset-link.json");
  await writeFile(inputFile, JSON.stringify({
    schema: "mkt-videos/knowledge-asset-link-registration@1",
    rootScopeId: rootId,
    scopeId: rootId,
    revision: 1,
    supersedesRevision: null,
    status: "active",
    rootKind: "outputs",
    relativePath: "campanha/videos-unidos/master.mp4",
    expectedSha256: assetHash,
    expectedBytes: 1234,
    mediaType: "video/mp4",
    governance: {
      classification: "confidential",
      provenance: [{
        sourceType: "asset-receipt",
        sourceRef: "receipt:asset-cli/master",
        method: "manual",
        observedAt: new Date().toISOString(),
        contentHash: sourceHash,
      }],
      modality: "observation",
      evidenceIds: [],
      retention: {
        policy: "manual-review",
      },
      rights: {
        inventory: "allowed",
        reuse: "allowed",
      },
    },
  }), "utf8");

  const withoutConfirmation = await runCli([
    "knowledge",
    "--action",
    "register-asset-link",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--input",
    inputFile,
    "--reason",
    "tentativa sem confirmação",
  ]);
  assert.equal(withoutConfirmation.code, 1);
  assert.match(withoutConfirmation.stderr, /--confirm-human true/);
  assert.deepEqual(
    repository.listKnowledgeAssetLinkItems({
      grant,
      rootScopeId: rootId,
    }),
    [],
  );

  const registered = parseJson(await runCli([
    "knowledge",
    "--action",
    "register-asset-link",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--input",
    inputFile,
    "--reason",
    "registro humano do vínculo",
    "--confirm-human",
    "true",
  ]));
  assert.equal(registered.status, "registered");
  assert.equal(registered.humanConfirmed, true);
  assert.equal(registered.item.recordType, "relation");
  assert.equal(
    registered.item.schemaId,
    "mkt-videos/knowledge-asset-link-payload@1",
  );
  assert.equal(
    registered.item.payload.relativePath,
    "campanha/videos-unidos/master.mp4",
  );
  assert.equal(registered.item.governance.rights.inventory, "allowed");
  assert.equal(registered.item.governance.rights.reuse, "allowed");
  assert.equal(
    repository.listKnowledgeAssetLinkItems({
      grant,
      rootScopeId: rootId,
    }).length,
    1,
  );
});

test("knowledge import-candidate sanitiza receipt sem persistir ou promover", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-import-candidate-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const rootId = "client:import-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de import CLI");
  const receipt = createReceipt({
    operation: "generate-video",
    provider: "omni",
    model: "gemini-omni-flash-preview",
    prompt: "PROMPT PRIVADO QUE NAO PODE SER IMPORTADO",
    parameters: {
      task: "text_to_video",
      aspect: "16:9",
      outputFile: String.raw`C:\private\video.mp4`,
    },
    startedAt: "2026-07-24T12:00:00.000Z",
    completedAt: "2026-07-24T12:00:08.000Z",
  });
  const inputFile = path.join(temporary, "import-request.json");
  await writeFile(inputFile, JSON.stringify({
    schema: "mkt-videos/knowledge-import-request@1",
    sourceKind: "receipt-metadata",
    rootScopeId: rootId,
    scopeId: rootId,
    sourceRef: "receipt:archive-entry-import-cli",
    sourceHash: null,
    governance: {
      classification: "confidential",
      owner: { type: "client", id: rootId },
      rights: {
        inventory: "allowed",
        localAnalysis: "allowed",
        providerInput: "denied",
      },
      retention: {
        policy: "manual-review",
        expiresAt: null,
        basis: null,
      },
      evidenceIds: [],
      observedAt: "2026-07-24T12:00:08.000Z",
    },
    source: receipt,
  }), "utf8");

  const result = parseJson(await runCli([
    "knowledge",
    "--action",
    "import-candidate",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--input",
    inputFile,
  ]));

  assert.equal(result.status, "candidate-created");
  assert.equal(result.providerFree, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.changed, false);
  assert.equal(result.candidate.status, "candidate");
  assert.equal(result.candidate.sourceKind, "receipt-metadata");
  assert.equal(
    result.candidate.payload.technical.task,
    "text_to_video",
  );
  assert.equal(
    JSON.stringify(result).includes("PROMPT PRIVADO"),
    false,
  );
  assert.equal(
    JSON.stringify(result).includes(String.raw`C:\private`),
    false,
  );
  assert.deepEqual(
    repository.listKnowledgeItems({
      grant,
      rootScopeId: rootId,
    }),
    [],
  );
});

test("knowledge replay-release usa registry builtin e retorna somente hashes", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-replay-release-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const repository = createKnowledgeStoreRepository({ dbFile });
  const rootId = "client:replay-cli";
  const grant = issueGrant(rootId);
  createRoot(repository, grant, rootId, "Cliente de replay CLI");
  const item = repository.appendKnowledgeItem({
    grant,
    item: governedItem({
      id: "entity:replay-client",
      revision: 1,
      rootScopeId: rootId,
      scopeId: rootId,
      recordType: "entity",
      schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      schemaVersion: 1,
      payload: {
        schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
        entityType: "client",
        name: "Cliente privado de replay",
        aliases: [],
        attributes: { privateField: "não deve sair no relatório" },
        evidenceRefs: [],
      },
    }, grant, {
      rights: { localAnalysis: "allowed" },
    }),
  });
  const release = repository.createRelease({
    grant,
    rootScopeId: rootId,
    label: "Release canônica de replay",
    members: [{ id: item.id, revision: item.revision }],
  });

  const result = parseJson(await runCli([
    "knowledge",
    "--action",
    "replay-release",
    "--db",
    dbFile,
    "--root-scope-id",
    rootId,
    "--release-id",
    release.id,
  ]));

  assert.equal(result.status, "replayed");
  assert.equal(result.providerFree, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.changed, false);
  assert.equal(result.report.memberCount, 1);
  assert.equal(
    result.report.members[0].sourceSchemaId,
    KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
  );
  assert.equal(
    JSON.stringify(result).includes("Cliente privado de replay"),
    false,
  );
  assert.equal(
    JSON.stringify(result).includes("não deve sair no relatório"),
    false,
  );
});

test("knowledge provision-scopes cria a cadeia e é idempotente", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-provision-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const rootId = "client:mkt-videos";
  const withoutConfirmation = await runCli([
    "knowledge", "--action", "provision-scopes",
    "--db", dbFile, "--root-scope-id", rootId,
    "--scope-id", "production:filme-teste",
    "--reason", "provisão sem confirmação",
  ]);
  assert.equal(withoutConfirmation.code, 1);
  assert.match(withoutConfirmation.stderr, /--confirm-human true/);

  const provisioned = parseJson(await runCli([
    "knowledge", "--action", "provision-scopes",
    "--db", dbFile, "--root-scope-id", rootId,
    "--scope-id", "production:filme-teste",
    "--reason", "provisão governada",
    "--confirm-human", "true",
  ]));
  assert.equal(provisioned.status, "provisioned");
  assert.equal(provisioned.changed, true);
  assert.equal(provisioned.scopes.length, 3);
  assert.deepEqual(provisioned.scopes.map((s) => s.created), [true, true, true]);

  const repository = createKnowledgeStoreRepository({ dbFile });
  const grant = createScopeGrant({
    rootScopeIds: [rootId], permissions: ["read", "write"],
    actor: "local-cli", purpose: "provision-scopes test",
    issuedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  assert.ok(repository.getScope({ grant, rootScopeId: rootId, scopeId: "project:geral" }));
  assert.ok(repository.getScope({ grant, rootScopeId: rootId, scopeId: "production:filme-teste" }));

  const repeated = parseJson(await runCli([
    "knowledge", "--action", "provision-scopes",
    "--db", dbFile, "--root-scope-id", rootId,
    "--scope-id", "production:filme-teste",
    "--reason", "repetição idempotente",
    "--confirm-human", "true",
  ]));
  assert.equal(repeated.status, "provisioned");
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.scopes.map((s) => s.created), [false, false, false]);
});

test("knowledge provision-scopes rejeita flags estranhas", async (context) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-cli-provision-flags-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dbFile = path.join(temporary, "knowledge.sqlite");
  initializeKnowledgeStore({ dbFile });
  const invalid = await runCli([
    "knowledge", "--action", "provision-scopes",
    "--db", dbFile, "--root-scope-id", "client:mkt-videos",
    "--scope-id", "production:x", "--reason", "r",
    "--input", path.join(temporary, "x.json"),
    "--confirm-human", "true",
  ]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /provision-scopes/);
});
