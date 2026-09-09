import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeGovernedReferenceAnalysis,
  executeStoredReferenceAnalysis,
} from "../lib/media-pipeline/knowledge-reference-analysis-guard.mjs";
import {
  referenceRightsItemId,
} from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";

const NOW = "2026-07-24T12:00:00.000Z";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function withContentHash(body) {
  return {
    ...body,
    contentHash: sha256(JSON.stringify(canonicalize(body))),
  };
}

function rightsMatrix(overrides = {}) {
  return {
    inventory: "allowed",
    localAnalysis: "allowed",
    textualIndexing: "unknown",
    embedding: "denied",
    training: "denied",
    providerInput: "denied",
    publication: "unknown",
    reuse: "unknown",
    ...overrides,
  };
}

function governance(rights, {
  expiresAt = null,
  sourceRef = "attestation:analysis",
} = {}) {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: "client", id: "client:a" },
    provenance: [{
      sourceType: "human-attestation",
      sourceRef,
      method: "human-attestation",
      observedAt: NOW,
      contentHash: "a".repeat(64),
    }],
    modality: "hard-constraint",
    evidenceIds: [],
    retention: {
      policy: "manual-review",
      expiresAt,
      basis: "Atestação humana exata.",
    },
    rights,
    createdAt: NOW,
    createdBy: "human:operator",
  }, { expectedActor: "human:operator" });
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

function referenceAsset({
  fileSha256,
  bytes,
  status = "active",
  localAnalysis = "allowed",
  retentionExpiresAt = null,
} = {}) {
  return withContentHash({
    schema: "mkt-videos/knowledge-item@1",
    id: "reference:asset-a",
    revision: 1,
    rootScopeId: "client:a",
    scopeId: "client:a",
    recordType: "entity",
    schemaId: "mkt-videos/entity-profile@1",
    schemaVersion: 1,
    status,
    governance: governance(rightsMatrix({ localAnalysis }), {
      expiresAt: retentionExpiresAt,
    }),
    supersedesRevision: null,
    payload: {
      schema: "mkt-videos/entity-profile@1",
      entityType: "reference-asset",
      name: "Reference asset a",
      aliases: [],
      attributes: {
        rootAlias: "motion-library",
        logicalPath: "nested/a.mp4",
        fileSha256,
        bytes,
        mediaType: "video/mp4",
      },
      evidenceRefs: [],
    },
    createdAt: NOW,
    createdBy: "human:operator",
  });
}

function rightsItem(target, {
  status = "active",
  localAnalysis = "allowed",
  validFrom = NOW,
  expiresAt = null,
} = {}) {
  return withContentHash({
    schema: "mkt-videos/knowledge-item@1",
    id: referenceRightsItemId(target),
    revision: 1,
    rootScopeId: "client:a",
    scopeId: "client:a",
    recordType: "rights",
    schemaId: "mkt-videos/rights-record@1",
    schemaVersion: 1,
    status,
    governance: governance(rightsMatrix({ localAnalysis }), {
      sourceRef: "attestation:rights",
    }),
    supersedesRevision: null,
    payload: {
      schema: "mkt-videos/rights-record@1",
      targetRef: itemReference(target),
      permissions: rightsMatrix({ localAnalysis }),
      basis: "Atestação humana presa ao asset exato.",
      validFrom,
      expiresAt,
      evidenceRefs: [],
    },
    createdAt: NOW,
    createdBy: "human:operator",
  });
}

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-analysis-guard-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "nested", "a.mp4");
  const content = Buffer.from("local-reference-content");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  const target = referenceAsset({
    fileSha256: sha256(content),
    bytes: content.length,
  });
  return {
    root,
    file,
    target,
    rights: rightsItem(target),
  };
}

async function storedFixture(context) {
  const base = await mkdtemp(path.join(os.tmpdir(), "mkt-stored-analysis-"));
  context.after(() => rm(base, { recursive: true, force: true }));
  const coreRoot = path.join(base, "workspace", "CORE");
  const dbFile = path.join(base, "private", "knowledge.sqlite");
  const mediaRoot = path.join(base, "motion-library");
  const file = path.join(mediaRoot, "nested", "a.mp4");
  const content = Buffer.from("stored-reference-content");
  await Promise.all([
    mkdir(coreRoot, { recursive: true }),
    mkdir(path.dirname(dbFile), { recursive: true }),
    mkdir(path.dirname(file), { recursive: true }),
  ]);
  await writeFile(file, content);
  initializeKnowledgeStore({
    dbFile,
    coreRoot,
    clock: () => new Date(NOW),
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    coreRoot,
    clock: () => new Date(NOW),
  });
  const grant = createScopeGrant({
    rootScopeIds: ["client:a"],
    permissions: ["read", "write"],
    actor: "human:operator",
    purpose: "stored reference analysis provider-free test",
    issuedAt: "2026-07-24T11:00:00.000Z",
    expiresAt: "2026-07-24T14:00:00.000Z",
  });
  repository.createScope({
    grant,
    scope: {
      id: "client:a",
      rootScopeId: "client:a",
      parentScopeId: null,
      kind: "client",
      name: "Client A",
      createdAt: NOW,
    },
  });
  const target = repository.appendKnowledgeItem({
    grant,
    item: referenceAsset({
      fileSha256: sha256(content),
      bytes: content.length,
    }),
  });
  const rights = repository.appendKnowledgeItem({
    grant,
    item: rightsItem(target),
  });
  return {
    repository,
    grant,
    mediaRoot,
    file,
    target,
    rights,
  };
}

function countingStoredRuntime(setup) {
  const calls = {
    root: 0,
    analysis: 0,
  };
  return {
    calls,
    rootResolver: async (alias) => {
      calls.root += 1;
      assert.equal(alias, "motion-library");
      return setup.mediaRoot;
    },
    adapter: {
      kind: "local-deterministic",
      providerFree: true,
      async analyze({ file, target, effectiveRights }) {
        calls.analysis += 1;
        assert.equal(file, setup.file);
        assert.equal(target.id, setup.target.id);
        assert.equal(
          effectiveRights.permissions.localAnalysis.state,
          "allowed",
        );
        return { segmentCount: 3 };
      },
    },
  };
}

test("guard executa somente adapter local provider-free após direito e hash exatos", async (context) => {
  const setup = await fixture(context);
  let calls = 0;
  const result = await executeGovernedReferenceAnalysis({
    targetItem: setup.target,
    rightsItems: [setup.rights],
    rootResolver: async (alias) => {
      assert.equal(alias, "motion-library");
      return setup.root;
    },
    adapter: {
      kind: "local-deterministic",
      providerFree: true,
      async analyze({ file, target, effectiveRights }) {
        calls += 1;
        assert.equal(file, setup.file);
        assert.equal(target.contentHash, setup.target.contentHash);
        assert.equal(
          effectiveRights.permissions.localAnalysis.state,
          "allowed",
        );
        return { segmentCount: 2 };
      },
    },
    at: NOW,
  });
  assert.equal(calls, 1);
  assert.equal(result.providerFree, true);
  assert.equal(result.result.segmentCount, 2);
  assert.equal(
    result.physicalSnapshot.fileSha256,
    setup.target.payload.attributes.fileSha256,
  );
});

test("unknown, denied, revoked, quarantined e expirado param antes do resolver físico e do analyzer", async (context) => {
  const setup = await fixture(context);
  const cases = [
    { name: "unknown", target: setup.target, rights: [] },
    {
      name: "denied",
      target: referenceAsset({
        ...setup.target.payload.attributes,
        localAnalysis: "denied",
      }),
    },
    {
      name: "revoked",
      target: referenceAsset({
        ...setup.target.payload.attributes,
        status: "revoked",
      }),
    },
    {
      name: "quarantined",
      target: referenceAsset({
        ...setup.target.payload.attributes,
        status: "quarantined",
      }),
    },
    {
      name: "expired",
      target: referenceAsset({
        ...setup.target.payload.attributes,
        retentionExpiresAt: "2026-07-24T12:30:00.000Z",
      }),
      at: "2026-07-24T13:00:00.000Z",
    },
  ];
  for (const entry of cases) {
    let rootCalls = 0;
    let analysisCalls = 0;
    const rights = entry.rights ?? [rightsItem(entry.target)];
    await assert.rejects(
      executeGovernedReferenceAnalysis({
        targetItem: entry.target,
        rightsItems: rights,
        rootResolver: async () => {
          rootCalls += 1;
          return setup.root;
        },
        adapter: {
          kind: "local-deterministic",
          providerFree: true,
          async analyze() {
            analysisCalls += 1;
          },
        },
        at: entry.at ?? NOW,
      }),
      /localAnalysis bloqueado/,
      entry.name,
    );
    assert.equal(rootCalls, 0, entry.name);
    assert.equal(analysisCalls, 0, entry.name);
  }
});

test("mudança física depois da atestação bloqueia antes do analyzer", async (context) => {
  const setup = await fixture(context);
  await writeFile(setup.file, "changed-reference-content");
  let calls = 0;
  await assert.rejects(
    executeGovernedReferenceAnalysis({
      targetItem: setup.target,
      rightsItems: [setup.rights],
      rootResolver: async () => setup.root,
      adapter: {
        kind: "local-deterministic",
        providerFree: true,
        async analyze() {
          calls += 1;
        },
      },
      at: NOW,
    }),
    /Asset físico diverge/,
  );
  assert.equal(calls, 0);
});

test("adapter não declarado como local e provider-free é recusado sem análise", async (context) => {
  const setup = await fixture(context);
  let rootCalls = 0;
  let calls = 0;
  await assert.rejects(
    executeGovernedReferenceAnalysis({
      targetItem: setup.target,
      rightsItems: [setup.rights],
      rootResolver: async () => {
        rootCalls += 1;
        return setup.root;
      },
      adapter: {
        kind: "external",
        providerFree: false,
        async analyze() {
          calls += 1;
        },
      },
      at: NOW,
    }),
    /local-deterministic/,
  );
  assert.equal(rootCalls, 0);
  assert.equal(calls, 0);
});

test("runtime stored resolve heads autoritativos e chama analyzer uma vez", async (context) => {
  const setup = await storedFixture(context);
  const runtime = countingStoredRuntime(setup);
  const result = await executeStoredReferenceAnalysis({
    repository: setup.repository,
    grant: setup.grant,
    rootScopeId: "client:a",
    referenceAssetId: setup.target.id,
    rootResolver: runtime.rootResolver,
    adapter: runtime.adapter,
  });
  assert.equal(runtime.calls.root, 1);
  assert.equal(runtime.calls.analysis, 1);
  assert.equal(result.result.segmentCount, 3);
  assert.equal(result.target.contentHash, setup.target.contentHash);
});

test("runtime stored não herda localAnalysis quando o asset ganha revisão", async (context) => {
  const setup = await storedFixture(context);
  setup.repository.appendKnowledgeItem({
    grant: setup.grant,
    item: {
      ...setup.target,
      revision: 2,
      supersedesRevision: 1,
      contentHash: undefined,
    },
  });
  const runtime = countingStoredRuntime(setup);
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:a",
      referenceAssetId: setup.target.id,
      rootResolver: runtime.rootResolver,
      adapter: runtime.adapter,
    }),
    /localAnalysis bloqueado: unknown\/rights-target-stale/,
  );
  assert.equal(runtime.calls.root, 0);
  assert.equal(runtime.calls.analysis, 0);
});

test("runtime stored usa rights head revogado sem fallback", async (context) => {
  const setup = await storedFixture(context);
  setup.repository.appendKnowledgeItem({
    grant: setup.grant,
    item: {
      ...setup.rights,
      revision: 2,
      supersedesRevision: 1,
      status: "revoked",
      contentHash: undefined,
    },
  });
  const runtime = countingStoredRuntime(setup);
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:a",
      referenceAssetId: setup.target.id,
      rootResolver: runtime.rootResolver,
      adapter: runtime.adapter,
    }),
    /localAnalysis bloqueado: revoked\/rights-head-revoked/,
  );
  assert.equal(runtime.calls.root, 0);
  assert.equal(runtime.calls.analysis, 0);
});

test("runtime stored revalida rights JIT e captura revogação durante o hash", async (context) => {
  const setup = await storedFixture(context);
  const runtime = countingStoredRuntime(setup);
  const rootResolver = async (alias) => {
    const root = await runtime.rootResolver(alias);
    setup.repository.appendKnowledgeItem({
      grant: setup.grant,
      item: {
        ...setup.rights,
        revision: 2,
        supersedesRevision: 1,
        status: "revoked",
        contentHash: undefined,
      },
    });
    return root;
  };
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:a",
      referenceAssetId: setup.target.id,
      rootResolver,
      adapter: runtime.adapter,
    }),
    /localAnalysis bloqueado: revoked\/rights-head-revoked/,
  );
  assert.equal(runtime.calls.root, 1);
  assert.equal(runtime.calls.analysis, 0);
});

test("runtime stored bloqueia troca de asset mesmo com novo rights head permitido", async (context) => {
  const setup = await storedFixture(context);
  const runtime = countingStoredRuntime(setup);
  const rootResolver = async (alias) => {
    const root = await runtime.rootResolver(alias);
    const targetV2 = setup.repository.appendKnowledgeItem({
      grant: setup.grant,
      item: {
        ...setup.target,
        revision: 2,
        supersedesRevision: 1,
        contentHash: undefined,
      },
    });
    setup.repository.appendKnowledgeItem({
      grant: setup.grant,
      item: {
        ...rightsItem(targetV2),
        revision: 2,
        supersedesRevision: 1,
        contentHash: undefined,
      },
    });
    return root;
  };
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:a",
      referenceAssetId: setup.target.id,
      rootResolver,
      adapter: runtime.adapter,
    }),
    /Reference asset mudou durante a análise/,
  );
  assert.equal(runtime.calls.root, 1);
  assert.equal(runtime.calls.analysis, 0);
});

test("runtime stored rejeita root fora do ScopeGrant antes do resolver físico", async (context) => {
  const setup = await storedFixture(context);
  const runtime = countingStoredRuntime(setup);
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:b",
      referenceAssetId: setup.target.id,
      rootResolver: runtime.rootResolver,
      adapter: runtime.adapter,
    }),
    /não autoriza o root scope client:b/,
  );
  assert.equal(runtime.calls.root, 0);
  assert.equal(runtime.calls.analysis, 0);
});

test("runtime stored bloqueia asset físico alterado antes do analyzer", async (context) => {
  const setup = await storedFixture(context);
  await writeFile(setup.file, "changed-stored-reference-content");
  const runtime = countingStoredRuntime(setup);
  await assert.rejects(
    executeStoredReferenceAnalysis({
      repository: setup.repository,
      grant: setup.grant,
      rootScopeId: "client:a",
      referenceAssetId: setup.target.id,
      rootResolver: runtime.rootResolver,
      adapter: runtime.adapter,
    }),
    /Asset físico diverge/,
  );
  assert.equal(runtime.calls.root, 1);
  assert.equal(runtime.calls.analysis, 0);
});
