import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
  KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
  knowledgeAssetLinkItemId,
  projectKnowledgeAssetLink,
  verifyKnowledgeAssetIntegrityFromRepository,
} from "../lib/media-pipeline/knowledge-asset-integrity.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  runKnowledgeAction,
} from "../lib/media-pipeline/knowledge-service.mjs";

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function grant(rootScopeIds) {
  return createScopeGrant({
    rootScopeIds,
    permissions: ["read", "write", "release", "integrity"],
    actor: "asset-repository-test",
    purpose: "provider-free governed asset link test",
    issuedAt: "2026-07-24T11:00:00.000Z",
    expiresAt: "2026-07-24T13:00:00.000Z",
  });
}

function envelope({
  rootScopeId,
  scopeId = rootScopeId,
  sourceRef,
  rights = { inventory: "allowed" },
} = {}) {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: {
      type: scopeId.startsWith("project:") ? "project" : "client",
      id: scopeId,
    },
    provenance: [{
      sourceType: "asset-receipt",
      sourceRef,
      method: "manual",
      observedAt: FIXED_NOW,
      contentHash: digest(sourceRef),
    }],
    modality: "observation",
    evidenceIds: [],
    retention: { policy: "manual-review" },
    rights,
    createdAt: FIXED_NOW,
    createdBy: "asset-repository-test",
  }, {
    expectedActor: "asset-repository-test",
  });
}

function assetItem({
  rootScopeId,
  scopeId = rootScopeId,
  rootKind = "outputs",
  relativePath,
  contents,
  revision = 1,
  supersedesRevision = null,
  governance = null,
} = {}) {
  const payload = {
    schema: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    rootKind,
    relativePath,
    expectedSha256: digest(contents),
    expectedBytes: Buffer.byteLength(contents),
    mediaType: "video/mp4",
  };
  return {
    id: knowledgeAssetLinkItemId({
      rootScopeId,
      rootKind,
      relativePath,
    }),
    revision,
    rootScopeId,
    scopeId,
    recordType: "relation",
    schemaId: KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA,
    schemaVersion: 1,
    status: "active",
    governance: governance ?? envelope({
      rootScopeId,
      scopeId,
      sourceRef: `receipt:${rootScopeId}/${relativePath}/${revision}`,
    }),
    supersedesRevision,
    payload,
    createdAt: FIXED_NOW.toISOString(),
    createdBy: "asset-repository-test",
  };
}

async function setup(context) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-asset-repository-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const workspaceRoot = path.join(temporary, "workspace");
  const coreRoot = path.join(workspaceRoot, "CORE");
  const outputsRoot = path.join(coreRoot, "outputs");
  const pessoasRoot = path.join(workspaceRoot, "PESSOAS");
  const dbFile = path.join(temporary, "private", "knowledge.sqlite");
  await Promise.all([
    mkdir(path.join(workspaceRoot, ".git"), { recursive: true }),
    mkdir(outputsRoot, { recursive: true }),
    mkdir(pessoasRoot, { recursive: true }),
    mkdir(path.dirname(dbFile), { recursive: true }),
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
  return {
    temporary,
    workspaceRoot,
    coreRoot,
    outputsRoot,
    pessoasRoot,
    dbFile,
    repository,
  };
}

function createRoot(repository, scopeGrant, rootScopeId) {
  repository.createScope({
    grant: scopeGrant,
    scope: {
      id: rootScopeId,
      rootScopeId,
      kind: "client",
      name: rootScopeId,
      createdAt: FIXED_NOW,
    },
  });
}

test("asset link persistido usa repository, isola roots e verifica sem mutação", async (context) => {
  const setupState = await setup(context);
  const rootA = "client:asset-a";
  const rootB = "client:asset-b";
  const grantA = grant([rootA]);
  const grantB = grant([rootB]);
  createRoot(setupState.repository, grantA, rootA);
  createRoot(setupState.repository, grantB, rootB);
  const relativePath = "campanha/videos-soltos/cena-01.mp4";
  const absolutePath = path.join(
    setupState.outputsRoot,
    ...relativePath.split("/"),
  );
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "video-original");
  const item = assetItem({
    rootScopeId: rootA,
    relativePath,
    contents: "video-original",
  });

  assert.throws(
    () => setupState.repository.appendKnowledgeItem({
      grant: grantA,
      item,
    }),
    /appendKnowledgeAssetLinkItem/,
  );
  const stored = setupState.repository.appendKnowledgeAssetLinkItem({
    grant: grantA,
    item,
  });
  assert.equal(stored.id, item.id);
  assert.equal(stored.schemaId, KNOWLEDGE_ASSET_LINK_PAYLOAD_SCHEMA);
  assert.equal(
    setupState.repository.listKnowledgeAssetLinkItems({
      grant: grantA,
      rootScopeId: rootA,
    }).length,
    1,
  );
  assert.deepEqual(
    setupState.repository.listKnowledgeAssetLinkItems({
      grant: grantB,
      rootScopeId: rootB,
    }),
    [],
  );
  assert.throws(
    () => setupState.repository.listKnowledgeAssetLinkItems({
      grant: grantB,
      rootScopeId: rootA,
    }),
    /não autoriza o root scope/,
  );

  const fileBefore = await stat(absolutePath);
  const dbBefore = await stat(setupState.dbFile);
  const dbBytesBefore = await readFile(setupState.dbFile);
  const report = await verifyKnowledgeAssetIntegrityFromRepository({
    repository: setupState.repository,
    grant: grantA,
    rootScopeId: rootA,
    allowedRoots: [
      { rootKind: "outputs", directory: setupState.outputsRoot },
      { rootKind: "PESSOAS", directory: setupState.pessoasRoot },
    ],
    at: FIXED_NOW,
  });
  assert.equal(report.status, "match");
  assert.equal(report.counts.resolved, 1);
  assert.equal(report.counts.extra, 0);
  assert.equal(report.results[0].linkId, item.id);
  assert.equal((await stat(absolutePath)).mtimeMs, fileBefore.mtimeMs);
  assert.equal((await stat(setupState.dbFile)).mtimeMs, dbBefore.mtimeMs);
  assert.deepEqual(await readFile(setupState.dbFile), dbBytesBefore);
  assert.equal(JSON.stringify(report).includes(absolutePath), false);

  const publicReport = await runKnowledgeAction({
    action: "integrity",
    dbFile: setupState.dbFile,
    rootScopeId: rootA,
    coreRoot: setupState.coreRoot,
    actor: "asset-integrity-service",
    clock: () => FIXED_NOW,
  });
  assert.equal(
    publicReport.schema,
    "mkt-videos/knowledge-integrity-report@2",
  );
  assert.equal(publicReport.status, "pass");
  assert.equal(publicReport.linkedArtifacts.status, "match");
  assert.equal(publicReport.linkedArtifacts.counts.resolved, 1);
});

test("asset link deriva rights/status e preserva localização entre revisões", async (context) => {
  const setupState = await setup(context);
  const rootId = "client:asset-lifecycle";
  const scopeGrant = grant([rootId]);
  createRoot(setupState.repository, scopeGrant, rootId);
  const relativePath = "entrega/videos-unidos/master.mp4";
  const first = assetItem({
    rootScopeId: rootId,
    relativePath,
    contents: "master-v1",
  });
  const storedFirst = setupState.repository.appendKnowledgeAssetLinkItem({
    grant: scopeGrant,
    item: first,
  });
  const second = assetItem({
    rootScopeId: rootId,
    relativePath,
    contents: "master-v2",
    revision: 2,
    supersedesRevision: 1,
  });
  const storedSecond = setupState.repository.appendKnowledgeAssetLinkItem({
    grant: scopeGrant,
    item: second,
  });
  assert.equal(storedSecond.id, storedFirst.id);
  assert.notEqual(
    storedSecond.payload.expectedSha256,
    storedFirst.payload.expectedSha256,
  );
  assert.equal(
    setupState.repository.listKnowledgeAssetLinkItems({
      grant: scopeGrant,
      rootScopeId: rootId,
      history: true,
    }).length,
    2,
  );
  assert.throws(
    () => setupState.repository.appendKnowledgeItem({
      grant: scopeGrant,
      item: {
        ...second,
        revision: 3,
        supersedesRevision: 2,
        schemaId: "mkt-videos/knowledge-item@1",
      },
    }),
    /Revisão de asset link exige appendKnowledgeAssetLinkItem/,
  );

  const quarantined = setupState.repository.reviewKnowledgeItem({
    grant: scopeGrant,
    rootScopeId: rootId,
    itemId: storedSecond.id,
    expectedRevision: storedSecond.revision,
    expectedContentHash: storedSecond.contentHash,
    action: "quarantine",
    reason: "asset retirado por decisão humana",
    evidenceIds: [],
    reviewedAt: FIXED_NOW,
  });
  const projected = projectKnowledgeAssetLink(quarantined.item, {
    at: FIXED_NOW,
  });
  assert.equal(projected.quarantineStatus, "quarantined");
  assert.equal(projected.rightsStatus, "unknown");
  assert.equal(
    setupState.repository.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: rootId,
    }).ok,
    true,
  );
});

test("asset link rejeita owner, ID e path fora do contrato sem gravar", async (context) => {
  const setupState = await setup(context);
  const rootId = "client:asset-invalid";
  const scopeGrant = grant([rootId]);
  createRoot(setupState.repository, scopeGrant, rootId);
  const valid = assetItem({
    rootScopeId: rootId,
    relativePath: "safe/video.mp4",
    contents: "safe",
  });
  for (const invalid of [
    {
      ...valid,
      id: "kal_0000000000000000",
    },
    {
      ...valid,
      payload: {
        ...valid.payload,
        relativePath: "../escape.mp4",
      },
    },
    {
      ...valid,
      governance: envelope({
        rootScopeId: rootId,
        scopeId: "client:outro",
        sourceRef: "receipt:owner-invalido",
      }),
    },
  ]) {
    assert.throws(
      () => setupState.repository.appendKnowledgeAssetLinkItem({
        grant: scopeGrant,
        item: invalid,
      }),
      /localização governada|relativePath|Owner/,
    );
  }
  assert.deepEqual(
    setupState.repository.listKnowledgeAssetLinkItems({
      grant: scopeGrant,
      rootScopeId: rootId,
    }),
    [],
  );
});
