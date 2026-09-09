import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_BACKUP_MANIFEST_SCHEMA,
  KNOWLEDGE_BACKUP_MANIFEST_V1_SCHEMA,
  KNOWLEDGE_RESTORE_REPORT_SCHEMA,
  createKnowledgeBackup,
  readKnowledgeBackupManifest,
  restoreKnowledgeBackup,
} from "../lib/media-pipeline/knowledge-backup.mjs";
import {
  checkKnowledgeStoreIntegrity,
  createKnowledgeStoreRepository,
  createKnowledgeStoreSnapshotAdapter,
  createScopeGrant,
  initializeKnowledgeStore,
  readKnowledgeStoreStatus,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  knowledgeAssetLinkItemId,
} from "../lib/media-pipeline/knowledge-asset-integrity.mjs";
import {
  KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";

const FIXED_NOW = new Date("2026-07-23T18:00:00.000Z");
const ROOT_SCOPE_ID = "client:backup-test";

function scopeGrantFor(
  rootScopeId = ROOT_SCOPE_ID,
  permissions = [
    "read",
    "write",
    "release",
    "export",
    "integrity",
    "backup",
    "restore",
  ],
) {
  return createScopeGrant({
    rootScopeIds: [rootScopeId],
    permissions,
    actor: "knowledge-backup-test",
    purpose: "provider-free backup and restore contract",
    issuedAt: "2026-07-23T17:00:00.000Z",
    expiresAt: "2026-07-23T19:00:00.000Z",
  });
}

function scopeGrant() {
  return scopeGrantFor();
}

function decisionPayload({
  rationale,
  impact = {},
  approvedBy = "knowledge-backup-test",
} = {}) {
  return {
    schema: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
    question: "Esta decisão deve integrar o Knowledge Core?",
    options: [
      { id: "decision:accept", label: "Registrar decisão" },
      { id: "decision:reject", label: "Não registrar decisão" },
    ],
    selectedOptionId: "decision:accept",
    rationale,
    contextRefs: [],
    evidenceRefs: [],
    confidence: 1,
    impact,
    humanConfirmed: true,
    approvedBy,
    decidedAt: FIXED_NOW.toISOString(),
  };
}

function governedItem(item, grant, {
  rights = {},
} = {}) {
  const createdAt = new Date(item.createdAt ?? FIXED_NOW).toISOString();
  const createdBy = grant.actor;
  return {
    ...item,
    governance: createKnowledgeRecordEnvelope({
      classification: item.classification ?? "confidential",
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
      modality: "fact",
      evidenceIds: [],
      retention: { policy: "manual-review" },
      rights,
      createdAt,
      createdBy,
    }, { expectedActor: grant.actor }),
    createdAt,
    createdBy,
  };
}

function sqliteSnapshotAdapter(callLog = []) {
  const adapter = createKnowledgeStoreSnapshotAdapter();
  return {
    async createConsistentSnapshot({ sourceFile, destinationFile }) {
      callLog.push({ action: "snapshot", sourceFile, destinationFile });
      await adapter.createConsistentSnapshot({ sourceFile, destinationFile });
    },
    async inspectSnapshot({ snapshotFile }) {
      callLog.push({ action: "inspect", snapshotFile });
      return adapter.inspectSnapshot({ snapshotFile });
    },
  };
}

async function fixture(context, label) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), `knowledge-backup-${label}-`),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const workspaceRoot = path.join(temporary, "workspace");
  const coreRoot = path.join(workspaceRoot, "CORE");
  const privateRoot = path.join(temporary, "private");
  const dbFile = path.join(privateRoot, "knowledge.sqlite");
  const assetRoot = path.join(coreRoot, "outputs");
  const pessoasRoot = path.join(workspaceRoot, "PESSOAS");
  await Promise.all([
    mkdir(coreRoot, { recursive: true }),
    mkdir(path.join(workspaceRoot, ".git"), { recursive: true }),
    mkdir(privateRoot, { recursive: true }),
    mkdir(assetRoot, { recursive: true }),
    mkdir(pessoasRoot, { recursive: true }),
  ]);
  initializeKnowledgeStore({
    dbFile,
    coreRoot,
    clock: () => FIXED_NOW,
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    coreRoot,
    clock: () => FIXED_NOW,
  });
  const grant = scopeGrant();
  repository.createScope({
    grant,
    scope: {
      id: ROOT_SCOPE_ID,
      rootScopeId: ROOT_SCOPE_ID,
      kind: "client",
      name: "Cliente de backup",
      createdAt: FIXED_NOW,
    },
  });
  repository.appendKnowledgeItem({
    grant,
    item: governedItem({
      id: "decision:backup",
      revision: 1,
      rootScopeId: ROOT_SCOPE_ID,
      scopeId: ROOT_SCOPE_ID,
      recordType: "decision",
      schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      schemaVersion: 1,
      payload: decisionPayload({
        rationale: "preservar conhecimento privado",
        impact: { privateText: "conteudo-do-store" },
      }),
      createdAt: FIXED_NOW,
    }, grant),
  });
  await Promise.all([
    writeFile(path.join(assetRoot, "visual.bin"), "asset-visual-original"),
    writeFile(path.join(assetRoot, "audio.bin"), "asset-audio-original"),
  ]);
  for (const [relativePath, contents] of [
    ["visual.bin", "asset-visual-original"],
    ["audio.bin", "asset-audio-original"],
  ]) {
    repository.appendKnowledgeAssetLinkItem({
      grant,
      item: governedItem({
        id: knowledgeAssetLinkItemId({
          rootScopeId: ROOT_SCOPE_ID,
          rootKind: "outputs",
          relativePath,
        }),
        revision: 1,
        rootScopeId: ROOT_SCOPE_ID,
        scopeId: ROOT_SCOPE_ID,
        recordType: "relation",
        schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
        schemaVersion: 1,
        payload: {
          schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
          rootKind: "outputs",
          relativePath,
          expectedSha256: createHash("sha256")
            .update(contents, "utf8")
            .digest("hex"),
          expectedBytes: Buffer.byteLength(contents),
          mediaType: "application/octet-stream",
        },
        createdAt: FIXED_NOW,
      }, grant, {
        rights: { inventory: "allowed" },
      }),
    });
  }
  return {
    temporary,
    workspaceRoot,
    coreRoot,
    privateRoot,
    dbFile,
    assetRoot,
    pessoasRoot,
    repository,
    grant,
  };
}

async function emptyFixture(context, label) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), `knowledge-backup-${label}-`),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const workspaceRoot = path.join(temporary, "workspace");
  const coreRoot = path.join(workspaceRoot, "CORE");
  const privateRoot = path.join(temporary, "private");
  const dbFile = path.join(privateRoot, "knowledge.sqlite");
  await Promise.all([
    mkdir(coreRoot, { recursive: true }),
    mkdir(path.join(workspaceRoot, ".git"), { recursive: true }),
    mkdir(privateRoot, { recursive: true }),
  ]);
  initializeKnowledgeStore({
    dbFile,
    coreRoot,
    clock: () => FIXED_NOW,
  });
  return {
    temporary,
    workspaceRoot,
    coreRoot,
    privateRoot,
    dbFile,
  };
}

async function captureSqliteSourceState(dbFile) {
  const captureFile = async (file) => {
    try {
      const [metadata, bytes] = await Promise.all([
        stat(file),
        readFile(file),
      ]);
      return {
        exists: true,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { exists: false };
      throw error;
    }
  };
  return {
    database: await captureFile(dbFile),
    wal: await captureFile(`${dbFile}-wal`),
    shm: await captureFile(`${dbFile}-shm`),
  };
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

async function convertBackupManifestToV1(sourceFile, destinationFile) {
  const source = await readFile(sourceFile);
  const magicBytes = 8;
  const headerBytes = magicBytes + 4;
  const manifestBytes = source.readUInt32BE(magicBytes);
  const current = JSON.parse(
    source.subarray(headerBytes, headerBytes + manifestBytes).toString("utf8"),
  );
  const legacyBody = {
    ...current,
    schema: KNOWLEDGE_BACKUP_MANIFEST_V1_SCHEMA,
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

async function rewriteBackupManifest(
  sourceFile,
  destinationFile,
  transform,
) {
  const source = await readFile(sourceFile);
  const magicBytes = 8;
  const headerBytes = magicBytes + 4;
  const manifestBytes = source.readUInt32BE(magicBytes);
  const current = JSON.parse(
    source.subarray(headerBytes, headerBytes + manifestBytes).toString("utf8"),
  );
  const body = transform(structuredClone(current));
  delete body.manifestHash;
  const rewritten = {
    ...body,
    manifestHash: createHash("sha256")
      .update(canonicalJson(body), "utf8")
      .digest("hex"),
  };
  const serialized = Buffer.from(canonicalJson(rewritten), "utf8");
  const header = Buffer.alloc(headerBytes);
  source.subarray(0, magicBytes).copy(header, 0);
  header.writeUInt32BE(serialized.length, magicBytes);
  const snapshot = source.subarray(headerBytes + manifestBytes);
  await writeFile(
    destinationFile,
    Buffer.concat([header, serialized, snapshot]),
  );
}

test("store vazio permite backup e restore sem root e permanece íntegro", async (context) => {
  const setup = await emptyFixture(context, "empty");
  const adapter = sqliteSnapshotAdapter();
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "empty.mkvbackup",
  );
  const restoredDb = path.join(
    setup.temporary,
    "restores",
    "empty.sqlite",
  );

  const backedUp = await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "internal",
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  const restored = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: restoredDb,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  assert.equal(backedUp.manifest.scopeAttestation, null);
  assert.equal(backedUp.manifest.ledger.rootCount, 0);
  assert.equal(restored.status, "restored");
  assert.equal(restored.scopeAttestationVerified, false);
  assert.equal(
    checkKnowledgeStoreIntegrity({
      dbFile: setup.dbFile,
      coreRoot: setup.coreRoot,
    }).ok,
    true,
  );
  const restoredIntegrity = checkKnowledgeStoreIntegrity({
    dbFile: restoredDb,
    coreRoot: setup.coreRoot,
  });
  assert.equal(restoredIntegrity.ok, true);
  assert.equal(restoredIntegrity.ledgerSummary.rootCount, 0);
});

test("store com dados exige grants reais e permissões exatas por operação", async (context) => {
  const setup = await fixture(context, "permissions");
  const calls = [];
  const adapter = sqliteSnapshotAdapter(calls);
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "permissions.mkvbackup",
  );
  const backupWithoutIntegrity = scopeGrantFor(ROOT_SCOPE_ID, ["backup"]);
  const integrityWithoutBackup = scopeGrantFor(ROOT_SCOPE_ID, ["integrity"]);
  const backupWithoutRead = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["integrity", "backup"],
  );
  const validBackupGrant = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["read", "integrity", "backup"],
  );

  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile,
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: backupWithoutIntegrity,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /permissões read, integrity e backup/,
  );
  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile,
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: integrityWithoutBackup,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /permissões read, integrity e backup/,
  );
  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile,
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: backupWithoutRead,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /permissões read, integrity e backup/,
  );
  assert.equal(calls.some((entry) => entry.action === "snapshot"), false);

  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: validBackupGrant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  const restoreWithoutIntegrity = scopeGrantFor(ROOT_SCOPE_ID, ["restore"]);
  const integrityWithoutRestore = scopeGrantFor(ROOT_SCOPE_ID, ["integrity"]);
  const backupGrantCannotRestore = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["integrity", "backup"],
  );
  const restoreWithoutRead = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["integrity", "restore"],
  );
  const validRestoreGrant = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["read", "integrity", "restore"],
  );
  const restoreAttempts = [
    restoreWithoutIntegrity,
    integrityWithoutRestore,
    backupGrantCannotRestore,
    restoreWithoutRead,
  ];
  for (const [index, grant] of restoreAttempts.entries()) {
    const destination = path.join(
      setup.temporary,
      "restores",
      `forbidden-${index}.sqlite`,
    );
    await assert.rejects(
      restoreKnowledgeBackup({
        backupFile,
        destinationDbFile: destination,
        rootScopeId: ROOT_SCOPE_ID,
        grant,
        snapshotAdapter: adapter,
        coreRoot: setup.coreRoot,
        clock: () => FIXED_NOW,
      }),
      /permissões read, integrity e restore/,
    );
    await assert.rejects(stat(destination), { code: "ENOENT" });
  }

  const restoredDb = path.join(
    setup.temporary,
    "restores",
    "authorized.sqlite",
  );
  const restored = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: restoredDb,
    rootScopeId: ROOT_SCOPE_ID,
    grant: validRestoreGrant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.scopeAttestationVerified, true);
});

test("store multi-root falha antes de criar snapshot ou bundle", async (context) => {
  const setup = await fixture(context, "multi-root-preflight");
  const secondRootId = "client:backup-test-second";
  const secondGrant = scopeGrantFor(secondRootId);
  setup.repository.createScope({
    grant: secondGrant,
    scope: {
      id: secondRootId,
      rootScopeId: secondRootId,
      kind: "client",
      name: "Segundo cliente",
      createdAt: FIXED_NOW,
    },
  });
  const calls = [];
  const adapter = sqliteSnapshotAdapter(calls);
  const backupDirectory = path.join(setup.temporary, "never-created");
  const backupFile = path.join(backupDirectory, "multi-root.mkvbackup");

  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile,
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /múltiplos roots|snapshot global/,
  );

  assert.deepEqual(calls, []);
  await assert.rejects(stat(backupFile), { code: "ENOENT" });
  await assert.rejects(stat(backupDirectory), { code: "ENOENT" });
});

test("backup bloqueia segundo root criado entre pré-voo e snapshot", async (context) => {
  const setup = await fixture(context, "root-count-toctou");
  const delegate = createKnowledgeStoreSnapshotAdapter();
  const secondRoot = "client:backup-concurrent";
  const secondGrant = scopeGrantFor(secondRoot);
  let injectedBeforeSnapshot = false;
  const adapter = {
    async createConsistentSnapshot(options) {
      setup.repository.createScope({
        grant: secondGrant,
        scope: {
          id: secondRoot,
          rootScopeId: secondRoot,
          kind: "client",
          name: "Cliente concorrente",
          createdAt: FIXED_NOW,
        },
      });
      injectedBeforeSnapshot = true;
      return delegate.createConsistentSnapshot(options);
    },
    inspectSnapshot(options) {
      return delegate.inspectSnapshot(options);
    },
  };
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "root-count-toctou.mkvbackup",
  );

  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile,
      classification: "restricted",
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /múltiplos roots|Quantidade de roots mudou/,
  );
  assert.equal(injectedBeforeSnapshot, true);
  await assert.rejects(stat(backupFile), { code: "ENOENT" });
});

test("adapter de produção não sobrescreve snapshot e leituras preservam a origem", async (context) => {
  const setup = await fixture(context, "production-adapter");
  const adapter = createKnowledgeStoreSnapshotAdapter();
  const existingSnapshot = path.join(
    setup.temporary,
    "existing-snapshot.sqlite",
  );
  await writeFile(existingSnapshot, "conteudo-preservado");
  const existingBytes = await readFile(existingSnapshot);

  await assert.rejects(
    adapter.createConsistentSnapshot({
      sourceFile: setup.dbFile,
      destinationFile: existingSnapshot,
    }),
    /não pode sobrescrever/,
  );
  assert.deepEqual(await readFile(existingSnapshot), existingBytes);

  const before = await captureSqliteSourceState(setup.dbFile);
  const status = readKnowledgeStoreStatus({
    dbFile: setup.dbFile,
    coreRoot: setup.coreRoot,
  });
  assert.equal(status.initialized, true);
  assert.equal(status.issues.length, 0);
  assert.deepEqual(await captureSqliteSourceState(setup.dbFile), before);

  const backupFile = path.join(
    setup.temporary,
    "backups",
    "production-adapter.mkvbackup",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: scopeGrantFor(
      ROOT_SCOPE_ID,
      ["read", "integrity", "backup"],
    ),
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  assert.deepEqual(await captureSqliteSourceState(setup.dbFile), before);
  assert.equal((await stat(backupFile)).isFile(), true);
});

test("backup não rebaixa a classificação máxima do snapshot", async (context) => {
  const setup = await fixture(context, "classification-floor");
  setup.repository.appendKnowledgeItem({
    grant: setup.grant,
    item: governedItem({
      id: "decision:restricted-backup",
      revision: 1,
      rootScopeId: ROOT_SCOPE_ID,
      scopeId: ROOT_SCOPE_ID,
      recordType: "decision",
      classification: "restricted",
      schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      schemaVersion: 1,
      payload: decisionPayload({
        rationale: "preservar classificação restrita no bundle",
      }),
      createdAt: FIXED_NOW,
    }, setup.grant),
  });
  const calls = [];
  const adapter = sqliteSnapshotAdapter(calls);
  const rejectedFile = path.join(
    setup.temporary,
    "backups",
    "classification-too-low.mkvbackup",
  );

  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile: rejectedFile,
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /não pode ser inferior ao store: restricted/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(stat(rejectedFile), { code: "ENOENT" });

  const acceptedFile = path.join(
    setup.temporary,
    "backups",
    "classification-restricted.mkvbackup",
  );
  const accepted = await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile: acceptedFile,
    classification: "restricted",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(accepted.manifest.classification.level, "restricted");
  assert.equal(
    checkKnowledgeStoreIntegrity({
      dbFile: setup.dbFile,
      coreRoot: setup.coreRoot,
    }).classificationFloor,
    "restricted",
  );
});

test("backup cria bundle atômico, determinístico e sem conteúdo de assets", async (context) => {
  const setup = await fixture(context, "create");
  const calls = [];
  const adapter = sqliteSnapshotAdapter(calls);
  const firstFile = path.join(setup.temporary, "backups", "first.mkvbackup");
  const secondFile = path.join(setup.temporary, "backups", "second.mkvbackup");
  const options = {
    sourceDbFile: setup.dbFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  };

  const first = await createKnowledgeBackup({
    ...options,
    backupFile: firstFile,
  });
  const second = await createKnowledgeBackup({
    ...options,
    backupFile: secondFile,
  });
  const inspected = await readKnowledgeBackupManifest({
    backupFile: firstFile,
    coreRoot: setup.coreRoot,
  });

  assert.equal(first.manifest.schema, KNOWLEDGE_BACKUP_MANIFEST_SCHEMA);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(inspected.manifest, first.manifest);
  assert.equal(first.manifest.store.userVersion, 4);
  assert.equal(first.manifest.assets.mode, "governed-inventory");
  assert.equal(
    first.manifest.assets.sourceSchema,
    KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  );
  assert.equal(first.manifest.assets.status, "match");
  assert.equal(first.manifest.assets.count, 2);
  assert.match(first.manifest.assets.aggregateSha256, /^[a-f0-9]{64}$/);
  assert.match(first.manifest.assets.integrityReportHash, /^[a-f0-9]{64}$/);
  assert.equal(
    first.manifest.scopeAttestation.activeActivationId,
    null,
  );
  assert.equal(
    first.manifest.scopeAttestation.activeActivationHash,
    null,
  );
  assert.equal(first.manifest.scopeAttestation.activeReleaseId, null);
  assert.equal(first.manifest.scopeAttestation.activeReleaseHash, null);
  assert.deepEqual(
    first.manifest.assets.entries
      .map((entry) => entry.relativePath)
      .sort(),
    ["audio.bin", "visual.bin"],
  );
  assert.equal(
    JSON.stringify(first.manifest).includes("asset-visual-original"),
    false,
  );
  assert.match(first.manifest.scopeAttestation.rootScopeHash, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(first.manifest).includes(ROOT_SCOPE_ID),
    false,
  );
  assert.equal((await stat(firstFile)).isFile(), true);
  assert.equal((await stat(firstFile)).nlink, 1);
  assert.equal(calls.filter((entry) => entry.action === "snapshot").length, 2);

  const bytesBefore = await readFile(firstFile);
  await assert.rejects(
    createKnowledgeBackup({ ...options, backupFile: firstFile }),
    /já existe|não será sobrescrita/,
  );
  assert.deepEqual(await readFile(firstFile), bytesBefore);
});

test("manifest captura somente links presentes no snapshot consistente", async (context) => {
  const setup = await fixture(context, "snapshot-assets");
  const productionAdapter = createKnowledgeStoreSnapshotAdapter();
  const lateRelativePath = "late-after-snapshot.bin";
  const lateContents = "asset-criado-depois-do-snapshot";
  const adapter = {
    async createConsistentSnapshot({ sourceFile, destinationFile }) {
      await productionAdapter.createConsistentSnapshot({
        sourceFile,
        destinationFile,
      });
      await writeFile(
        path.join(setup.assetRoot, lateRelativePath),
        lateContents,
      );
      setup.repository.appendKnowledgeAssetLinkItem({
        grant: setup.grant,
        item: governedItem({
          id: knowledgeAssetLinkItemId({
            rootScopeId: ROOT_SCOPE_ID,
            rootKind: "outputs",
            relativePath: lateRelativePath,
          }),
          revision: 1,
          rootScopeId: ROOT_SCOPE_ID,
          scopeId: ROOT_SCOPE_ID,
          recordType: "relation",
          schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
          schemaVersion: 1,
          payload: {
            schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
            rootKind: "outputs",
            relativePath: lateRelativePath,
            expectedSha256: createHash("sha256")
              .update(lateContents, "utf8")
              .digest("hex"),
            expectedBytes: Buffer.byteLength(lateContents),
            mediaType: "application/octet-stream",
          },
          createdAt: FIXED_NOW,
        }, setup.grant, {
          rights: { inventory: "allowed" },
        }),
      });
    },
    inspectSnapshot(options) {
      return productionAdapter.inspectSnapshot(options);
    },
  };
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "snapshot-assets.mkvbackup",
  );

  const result = await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  assert.equal(
    setup.repository.listKnowledgeAssetLinkItems({
      grant: setup.grant,
      rootScopeId: ROOT_SCOPE_ID,
    }).length,
    3,
  );
  assert.equal(result.manifest.assets.count, 2);
  assert.equal(
    result.manifest.assets.entries.some(
      (entry) => entry.relativePath === lateRelativePath,
    ),
    false,
  );
});

test("backup v2 atesta e restaura a release ativa exata", async (context) => {
  const setup = await fixture(context, "active-release");
  const eligibleItem = setup.repository.appendKnowledgeItem({
    grant: setup.grant,
    item: governedItem({
      id: "decision:eligible-release",
      revision: 1,
      rootScopeId: ROOT_SCOPE_ID,
      scopeId: ROOT_SCOPE_ID,
      recordType: "decision",
      schemaId: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      schemaVersion: 1,
      payload: decisionPayload({
        rationale: "release aprovada para análise local",
      }),
      createdAt: FIXED_NOW,
    }, setup.grant, {
      rights: { localAnalysis: "allowed" },
    }),
  });
  const release = setup.repository.createRelease({
    grant: setup.grant,
    rootScopeId: ROOT_SCOPE_ID,
    label: "Release ativa no backup",
    members: [{
      id: eligibleItem.id,
      revision: eligibleItem.revision,
    }],
    createdAt: FIXED_NOW,
  });
  const activation = setup.repository.activateRelease({
    grant: setup.grant,
    rootScopeId: ROOT_SCOPE_ID,
    releaseId: release.id,
    expectedReleaseHash: release.hash,
    expectedCurrentActivationId: null,
    reason: "aprovação humana registrada no fixture",
    createdAt: FIXED_NOW,
  });
  const adapter = sqliteSnapshotAdapter();
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "active-release.mkvbackup",
  );
  const backup = await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  assert.equal(
    backup.manifest.scopeAttestation.activeActivationId,
    activation.id,
  );
  assert.equal(
    backup.manifest.scopeAttestation.activeActivationHash,
    activation.hash,
  );
  assert.equal(
    backup.manifest.scopeAttestation.activeReleaseId,
    release.id,
  );
  assert.equal(
    backup.manifest.scopeAttestation.activeReleaseHash,
    release.hash,
  );

  const destination = path.join(
    setup.temporary,
    "restores",
    "active-release.sqlite",
  );
  const restored = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: destination,
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.scopeAttestationVerified, true);
  const restoredRepository = createKnowledgeStoreRepository({
    dbFile: destination,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  const restoredActive = restoredRepository.getActiveRelease({
    grant: setup.grant,
    rootScopeId: ROOT_SCOPE_ID,
  });
  assert.equal(restoredActive.activation.id, activation.id);
  assert.equal(restoredActive.activation.hash, activation.hash);
  assert.equal(restoredActive.release.id, release.id);
  assert.equal(restoredActive.release.hash, release.hash);
});

test("restore preserva compatibilidade com manifest histórico v1", async (context) => {
  const setup = await fixture(context, "legacy-v1");
  const adapter = sqliteSnapshotAdapter();
  const currentFile = path.join(
    setup.temporary,
    "backups",
    "current.mkvbackup",
  );
  const legacyFile = path.join(
    setup.temporary,
    "backups",
    "legacy-v1.mkvbackup",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile: currentFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  await convertBackupManifestToV1(currentFile, legacyFile);
  const inspected = await readKnowledgeBackupManifest({
    backupFile: legacyFile,
    coreRoot: setup.coreRoot,
  });
  assert.equal(
    inspected.manifest.schema,
    KNOWLEDGE_BACKUP_MANIFEST_V1_SCHEMA,
  );
  assert.equal(
    "activeReleaseId" in inspected.manifest.scopeAttestation,
    false,
  );

  const destination = path.join(
    setup.temporary,
    "restores",
    "legacy-v1.sqlite",
  );
  const legacyGrant = scopeGrantFor(
    ROOT_SCOPE_ID,
    ["integrity", "restore"],
  );
  const restored = await restoreKnowledgeBackup({
    backupFile: legacyFile,
    destinationDbFile: destination,
    rootScopeId: ROOT_SCOPE_ID,
    grant: legacyGrant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.scopeAttestationVerified, true);
  assert.equal(
    checkKnowledgeStoreIntegrity({
      dbFile: destination,
      coreRoot: setup.coreRoot,
    }).ok,
    true,
  );
});

test("root específico exige ScopeGrant real antes de criar snapshot", async (context) => {
  const setup = await fixture(context, "grant");
  const calls = [];
  const adapter = sqliteSnapshotAdapter(calls);
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "scoped.mkvbackup",
  );
  const base = {
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  };

  await assert.rejects(
    createKnowledgeBackup(base),
    /exige ScopeGrant/,
  );
  await assert.rejects(
    createKnowledgeBackup({
      ...base,
      grant: structuredClone(setup.grant),
    }),
    /não emitido por este runtime/,
  );
  assert.equal(calls.some((entry) => entry.action === "snapshot"), false);
  await assert.rejects(stat(backupFile), { code: "ENOENT" });
});

test("restore verifica store e reporta assets ausentes ou divergentes sem corrigi-los", async (context) => {
  const setup = await fixture(context, "restore");
  const adapter = sqliteSnapshotAdapter();
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "restore-source.mkvbackup",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  const matchingDestination = path.join(
    setup.temporary,
    "restores",
    "matching.sqlite",
  );
  const matching = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: matchingDestination,
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(matching.schema, KNOWLEDGE_RESTORE_REPORT_SCHEMA);
  assert.equal(matching.status, "restored");
  assert.equal(matching.assets.mode, "governed-inventory");
  assert.equal(matching.assets.status, "match");
  assert.deepEqual(matching.assets.counts, {
    total: 2,
    resolved: 2,
    missing: 0,
    revoked: 0,
    quarantined: 0,
    extra: 0,
  });
  assert.equal(matching.assets.results.length, 2);
  assert.equal(
    matching.assets.results.every(
      (entry) =>
        entry.status === "resolved"
        && entry.reason === "hash-match",
    ),
    true,
  );
  assert.equal(matching.scopeAttestationVerified, true);
  assert.equal(
    checkKnowledgeStoreIntegrity({
      dbFile: matchingDestination,
      coreRoot: setup.coreRoot,
    }).ok,
    true,
  );
  const restoredRepository = createKnowledgeStoreRepository({
    dbFile: matchingDestination,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(
    restoredRepository.getKnowledgeItem({
      grant: setup.grant,
      rootScopeId: ROOT_SCOPE_ID,
      id: "decision:backup",
    }).payload.impact.privateText,
    "conteudo-do-store",
  );

  await writeFile(
    path.join(setup.assetRoot, "visual.bin"),
    "asset-visual-alterado",
  );
  await rm(path.join(setup.assetRoot, "audio.bin"));
  const asymmetricDestination = path.join(
    setup.temporary,
    "restores",
    "asymmetric.sqlite",
  );
  const asymmetric = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: asymmetricDestination,
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(asymmetric.status, "restored-asymmetric");
  assert.equal(asymmetric.assets.mode, "governed-inventory");
  assert.equal(asymmetric.assets.status, "asymmetric");
  assert.deepEqual(asymmetric.assets.counts, {
    total: 2,
    resolved: 0,
    missing: 2,
    revoked: 0,
    quarantined: 0,
    extra: 0,
  });
  assert.deepEqual(
    asymmetric.assets.results
      .map((entry) => [entry.status, entry.reason])
      .sort((left, right) => left[1].localeCompare(right[1])),
    [
      ["missing", "asset-not-found"],
      ["missing", "hash-mismatch"],
    ],
  );
  assert.equal(asymmetric.reportOnlyAssets, true);
  assert.equal(asymmetric.repairPerformed, false);
  assert.equal(
    await readFile(path.join(setup.assetRoot, "visual.bin"), "utf8"),
    "asset-visual-alterado",
  );
  await assert.rejects(
    stat(path.join(setup.assetRoot, "audio.bin")),
    { code: "ENOENT" },
  );

  const destinationBytes = await readFile(asymmetricDestination);
  await assert.rejects(
    restoreKnowledgeBackup({
      backupFile,
      destinationDbFile: asymmetricDestination,
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /já existe|não será sobrescrita/,
  );
  assert.deepEqual(await readFile(asymmetricDestination), destinationBytes);
});

test("restore assimétrico não exige asset root e nunca cria assets", async (context) => {
  const setup = await fixture(context, "missing-assets");
  const adapter = sqliteSnapshotAdapter();
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "missing-assets.mkvbackup",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  await rm(setup.assetRoot, { recursive: true });
  const destination = path.join(
    setup.temporary,
    "restores",
    "without-assets.sqlite",
  );
  const report = await restoreKnowledgeBackup({
    backupFile,
    destinationDbFile: destination,
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  assert.equal(report.status, "restored-asymmetric");
  assert.equal(report.assets.mode, "governed-inventory");
  assert.equal(report.assets.status, "asymmetric");
  assert.deepEqual(report.assets.counts, {
    total: 2,
    resolved: 0,
    missing: 2,
    revoked: 0,
    quarantined: 0,
    extra: 0,
  });
  assert.equal(
    report.assets.results.every(
      (entry) =>
        entry.status === "missing"
        && entry.reason === "asset-not-found",
    ),
    true,
  );
  assert.equal(report.scopeAttestationVerified, true);
  await assert.rejects(stat(setup.assetRoot), { code: "ENOENT" });
});

test("manifest governado divergente do SQLite bloqueia restore antes do commit", async (context) => {
  const setup = await fixture(context, "manifest-db-mismatch");
  const adapter = sqliteSnapshotAdapter();
  const originalFile = path.join(
    setup.temporary,
    "backups",
    "original.mkvbackup",
  );
  const rewrittenFile = path.join(
    setup.temporary,
    "backups",
    "rewritten.mkvbackup",
  );
  const destination = path.join(
    setup.temporary,
    "restores",
    "must-not-exist.sqlite",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile: originalFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });
  await rewriteBackupManifest(
    originalFile,
    rewrittenFile,
    (manifest) => {
      manifest.assets.entries[0].expectedBytes += 1;
      manifest.assets.aggregateSha256 = createHash("sha256")
        .update(canonicalJson(manifest.assets.entries), "utf8")
        .digest("hex");
      return manifest;
    },
  );

  await assert.rejects(
    restoreKnowledgeBackup({
      backupFile: rewrittenFile,
      destinationDbFile: destination,
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /manifest diverge dos links do snapshot/,
  );
  await assert.rejects(stat(destination), { code: "ENOENT" });
});

test("checksum adulterado, workspace e hardlink falham fechados", async (context) => {
  const setup = await fixture(context, "guards");
  const adapter = sqliteSnapshotAdapter();
  const backupFile = path.join(
    setup.temporary,
    "backups",
    "guarded.mkvbackup",
  );
  await createKnowledgeBackup({
    sourceDbFile: setup.dbFile,
    backupFile,
    classification: "confidential",
    rootScopeId: ROOT_SCOPE_ID,
    grant: setup.grant,
    snapshotAdapter: adapter,
    coreRoot: setup.coreRoot,
    clock: () => FIXED_NOW,
  });

  await assert.rejects(
    createKnowledgeBackup({
      sourceDbFile: setup.dbFile,
      backupFile: path.join(
        setup.workspaceRoot,
        "private-backup.mkvbackup",
      ),
      classification: "confidential",
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /não pode ficar dentro do workspace/,
  );

  const tampered = path.join(
    setup.temporary,
    "backups",
    "tampered.mkvbackup",
  );
  const tamperedBytes = Buffer.from(await readFile(backupFile));
  tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
  await writeFile(tampered, tamperedBytes);
  const tamperedDestination = path.join(
    setup.temporary,
    "restores",
    "tampered.sqlite",
  );
  await assert.rejects(
    restoreKnowledgeBackup({
      backupFile: tampered,
      destinationDbFile: tamperedDestination,
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /Checksum do snapshot SQLite diverge/,
  );
  await assert.rejects(stat(tamperedDestination), { code: "ENOENT" });

  const copied = path.join(
    setup.temporary,
    "backups",
    "hardlink-source.mkvbackup",
  );
  const hardlink = path.join(
    setup.temporary,
    "backups",
    "hardlink-alias.mkvbackup",
  );
  await copyFile(backupFile, copied);
  await link(copied, hardlink);
  await assert.rejects(
    readKnowledgeBackupManifest({
      backupFile: hardlink,
      coreRoot: setup.coreRoot,
    }),
    /hardlink/,
  );

  await assert.rejects(
    restoreKnowledgeBackup({
      backupFile,
      destinationDbFile: path.join(
        setup.workspaceRoot,
        "inside-workspace.sqlite",
      ),
      rootScopeId: ROOT_SCOPE_ID,
      grant: setup.grant,
      snapshotAdapter: adapter,
      coreRoot: setup.coreRoot,
      clock: () => FIXED_NOW,
    }),
    /não pode ficar dentro do workspace/,
  );
});
