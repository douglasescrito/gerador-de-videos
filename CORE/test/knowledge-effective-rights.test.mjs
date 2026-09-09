import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  assertEffectiveRightAllowed,
  referenceRightsItemId,
  resolveEffectiveRights,
} from "../lib/media-pipeline/knowledge-effective-rights.mjs";
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

function rehashItem(item) {
  const copy = structuredClone(item);
  delete copy.contentHash;
  return {
    ...copy,
    contentHash: createHash("sha256")
      .update(JSON.stringify(canonicalize(copy)), "utf8")
      .digest("hex"),
  };
}

function matrix(overrides = {}) {
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

function envelope(rights, {
  createdAt = NOW,
  sourceRef = "attestation:test",
  ownerId = "client:a",
} = {}) {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: "client", id: ownerId },
    provenance: [{
      sourceType: "human-attestation",
      sourceRef,
      method: "human-attestation",
      observedAt: createdAt,
      contentHash: "a".repeat(64),
    }],
    modality: "hard-constraint",
    evidenceIds: [],
    retention: {
      policy: "manual-review",
      expiresAt: null,
      basis: "Atestação humana.",
    },
    rights,
    createdAt,
    createdBy: "human:operator",
  }, { expectedActor: "human:operator" });
}

function itemRef(item) {
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

async function setup(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-effective-rights-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, "workspace", "CORE");
  const dbFile = path.join(root, "private", "knowledge.sqlite");
  await Promise.all([
    mkdir(coreRoot, { recursive: true }),
    mkdir(path.dirname(dbFile), { recursive: true }),
  ]);
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
    permissions: ["read", "write", "release"],
    actor: "human:operator",
    purpose: "effective rights provider-free test",
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
    item: {
      id: "reference:asset-a",
      revision: 1,
      rootScopeId: "client:a",
      scopeId: "client:a",
      recordType: "entity",
      schemaId: "mkt-videos/entity-profile@1",
      schemaVersion: 1,
      status: "active",
      governance: envelope(matrix()),
      supersedesRevision: null,
      payload: {
        schema: "mkt-videos/entity-profile@1",
        entityType: "reference-asset",
        name: "Reference asset a",
        aliases: [],
        attributes: {
          rootAlias: "motion-library",
          logicalPath: "a.mp4",
          fileSha256: "b".repeat(64),
          bytes: 1,
          mediaType: "video/mp4",
        },
        evidenceRefs: [],
      },
      createdAt: NOW,
      createdBy: "human:operator",
    },
  });
  const rights = repository.appendKnowledgeItem({
    grant,
    item: {
      id: referenceRightsItemId(target),
      revision: 1,
      rootScopeId: "client:a",
      scopeId: "client:a",
      recordType: "rights",
      schemaId: "mkt-videos/rights-record@1",
      schemaVersion: 1,
      status: "active",
      governance: envelope(matrix(), {
        sourceRef: "attestation:rights-a",
      }),
      supersedesRevision: null,
      payload: {
        schema: "mkt-videos/rights-record@1",
        targetRef: itemRef(target),
        permissions: matrix(),
        basis: "Atestação humana exata.",
        validFrom: NOW,
        expiresAt: null,
        evidenceRefs: [],
      },
      createdAt: NOW,
      createdBy: "human:operator",
    },
  });
  return { repository, grant, target, rights };
}

test("resolver exige target e rights head exatos e aplica interseção conservadora", async (context) => {
  const { target, rights } = await setup(context);
  const effective = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [rights],
    at: NOW,
  });
  assert.equal(effective.permissions.localAnalysis.state, "allowed");
  assert.equal(effective.permissions.providerInput.state, "denied");
  assert.equal(effective.permissions.textualIndexing.state, "unknown");
  assertEffectiveRightAllowed({
    effectiveRights: effective,
    right: "localAnalysis",
  });
  assert.throws(
    () => assertEffectiveRightAllowed({
      effectiveRights: effective,
      right: "providerInput",
    }),
    /providerInput bloqueado/,
  );
});

test("repository resolve heads íntegros em um snapshot read-only", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const snapshot = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId: "client:a",
    referenceAssetId: target.id,
  });
  assert.deepEqual(snapshot.targetItem, target);
  assert.deepEqual(snapshot.rightsHead, rights);
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.state,
    "allowed",
  );
  assert.equal(
    snapshot.effectiveRights.rightsHead.contentHash,
    rights.contentHash,
  );
});

test("envelope do rights head participa da interseção fail-closed", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const restrictiveHead = repository.appendKnowledgeItem({
    grant,
    item: {
      ...rights,
      revision: 2,
      supersedesRevision: 1,
      governance: envelope(matrix({ localAnalysis: "denied" }), {
        sourceRef: "attestation:rights-envelope-restrictive",
      }),
      contentHash: undefined,
    },
  });
  const snapshot = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId: "client:a",
    referenceAssetId: target.id,
  });
  assert.deepEqual(snapshot.rightsHead, restrictiveHead);
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.state,
    "denied",
  );
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.reason,
    "intersection-denied",
  );
});

test("snapshot anterior à criação do target ou rights head nunca permite uso", async (context) => {
  const { target, rights } = await setup(context);
  const beforeTarget = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [rights],
    at: "2026-07-24T11:59:59.000Z",
  });
  assert.equal(
    beforeTarget.permissions.localAnalysis.reason,
    "target-not-yet-effective",
  );
  assert.equal(beforeTarget.permissions.localAnalysis.state, "unknown");

  const oldCreatedAt = "2026-07-24T10:00:00.000Z";
  const oldTarget = rehashItem({
    ...target,
    governance: envelope(matrix(), {
      createdAt: oldCreatedAt,
      sourceRef: "attestation:old-target",
    }),
    createdAt: oldCreatedAt,
  });
  const futureRights = rehashItem({
    ...rights,
    payload: {
      ...rights.payload,
      targetRef: itemRef(oldTarget),
    },
  });
  const beforeRights = resolveEffectiveRights({
    targetItem: oldTarget,
    rightsItems: [futureRights],
    at: "2026-07-24T11:30:00.000Z",
  });
  assert.equal(
    beforeRights.permissions.localAnalysis.reason,
    "rights-head-not-yet-effective",
  );
  assert.equal(beforeRights.permissions.localAnalysis.state, "unknown");
});

test("ausência, outro root e ID não canônico não viram autoridade", async (context) => {
  const { target, rights } = await setup(context);
  const absent = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [],
    at: NOW,
  });
  assert.equal(absent.permissions.localAnalysis.state, "unknown");

  const forged = rehashItem({
    ...rights,
    id: "rights:other",
  });
  const ignored = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [forged],
    at: NOW,
  });
  assert.equal(ignored.permissions.localAnalysis.state, "unknown");
});

test("repository nunca aceita revisão antiga do asset como autoridade", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const targetV2 = repository.appendKnowledgeItem({
    grant,
    item: {
      ...target,
      revision: 2,
      supersedesRevision: 1,
      payload: {
        ...target.payload,
        attributes: {
          ...target.payload.attributes,
          fileSha256: "c".repeat(64),
        },
      },
      contentHash: undefined,
    },
  });
  const snapshot = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId: "client:a",
    referenceAssetId: target.id,
  });
  assert.deepEqual(snapshot.targetItem, targetV2);
  assert.deepEqual(snapshot.rightsHead, rights);
  assert.equal(snapshot.effectiveRights.rightsHead.targetMatches, false);
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.reason,
    "rights-target-stale",
  );
});

test("nova revisão do asset nunca herda permissão da revisão anterior", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const targetV2 = repository.appendKnowledgeItem({
    grant,
    item: {
      ...target,
      revision: 2,
      supersedesRevision: 1,
      payload: {
        ...target.payload,
        attributes: {
          ...target.payload.attributes,
          fileSha256: "c".repeat(64),
        },
      },
      contentHash: undefined,
    },
  });
  const effective = resolveEffectiveRights({
    targetItem: targetV2,
    rightsItems: [rights],
    at: NOW,
  });
  assert.equal(effective.rightsHead.targetMatches, false);
  assert.equal(effective.permissions.localAnalysis.state, "unknown");
  assert.equal(
    effective.permissions.localAnalysis.reason,
    "rights-target-stale",
  );
});

test("repository usa o rights head revogado sem fallback", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const revoked = repository.appendKnowledgeItem({
    grant,
    item: {
      ...rights,
      revision: 2,
      supersedesRevision: 1,
      status: "revoked",
      contentHash: undefined,
    },
  });
  const snapshot = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId: "client:a",
    referenceAssetId: target.id,
  });
  assert.deepEqual(snapshot.rightsHead, revoked);
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.state,
    "revoked",
  );
  assert.equal(
    snapshot.effectiveRights.permissions.localAnalysis.reason,
    "rights-head-revoked",
  );
});

test("head candidate, revoked ou expirado prevalece sem fallback", async (context) => {
  const {
    repository,
    grant,
    target,
    rights,
  } = await setup(context);
  const candidate = repository.appendKnowledgeItem({
    grant,
    item: {
      ...rights,
      revision: 2,
      supersedesRevision: 1,
      status: "candidate",
      contentHash: undefined,
    },
  });
  const candidateResult = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [rights, candidate],
    at: NOW,
  });
  assert.equal(
    candidateResult.permissions.localAnalysis.reason,
    "rights-head-candidate",
  );

  const revoked = repository.appendKnowledgeItem({
    grant,
    item: {
      ...candidate,
      revision: 3,
      supersedesRevision: 2,
      status: "revoked",
      contentHash: undefined,
    },
  });
  const revokedResult = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [rights, candidate, revoked],
    at: NOW,
  });
  assert.equal(revokedResult.permissions.localAnalysis.state, "revoked");

  const expiredPayload = {
    ...rights.payload,
    validFrom: "2026-07-24T10:00:00.000Z",
    expiresAt: "2026-07-24T11:30:00.000Z",
  };
  const expired = rehashItem({
    ...rights,
    payload: expiredPayload,
  });
  const expiredResult = resolveEffectiveRights({
    targetItem: target,
    rightsItems: [expired],
    at: NOW,
  });
  assert.equal(expiredResult.permissions.localAnalysis.state, "expired");
});

test("repository falha para ID inexistente e root não autorizado", async (context) => {
  const { repository, grant, target } = await setup(context);
  const nonReference = repository.appendKnowledgeItem({
    grant,
    item: {
      ...target,
      id: "entity:not-a-reference",
      payload: {
        ...target.payload,
        entityType: "brand",
        name: "Not a reference asset",
      },
      contentHash: undefined,
    },
  });
  assert.throws(
    () => repository.resolveReferenceAssetEffectiveRights({
      grant,
      rootScopeId: "client:a",
      referenceAssetId: "reference:missing",
    }),
    /Reference asset inexistente no root autorizado/,
  );
  assert.throws(
    () => repository.resolveReferenceAssetEffectiveRights({
      grant,
      rootScopeId: "client:a",
      referenceAssetId: nonReference.id,
    }),
    /Target não é um reference-asset canônico/,
  );
  assert.throws(
    () => repository.resolveReferenceAssetEffectiveRights({
      grant,
      rootScopeId: "client:b",
      referenceAssetId: "reference:asset-a",
    }),
    /não autoriza o root scope client:b/,
  );
});

test("repository mantém heads de roots homônimos isolados", async (context) => {
  const {
    repository,
    grant: grantA,
    target: targetA,
  } = await setup(context);
  const grantB = createScopeGrant({
    rootScopeIds: ["client:b"],
    permissions: ["read", "write"],
    actor: "human:operator",
    purpose: "effective rights root isolation test",
    issuedAt: "2026-07-24T11:00:00.000Z",
    expiresAt: "2026-07-24T14:00:00.000Z",
  });
  repository.createScope({
    grant: grantB,
    scope: {
      id: "client:b",
      rootScopeId: "client:b",
      parentScopeId: null,
      kind: "client",
      name: "Client B",
      createdAt: NOW,
    },
  });
  const targetB = repository.appendKnowledgeItem({
    grant: grantB,
    item: {
      ...targetA,
      rootScopeId: "client:b",
      scopeId: "client:b",
      governance: envelope(matrix(), {
        ownerId: "client:b",
        sourceRef: "attestation:target-b",
      }),
      contentHash: undefined,
    },
  });
  const rightsB = repository.appendKnowledgeItem({
    grant: grantB,
    item: {
      id: referenceRightsItemId(targetB),
      revision: 1,
      rootScopeId: "client:b",
      scopeId: "client:b",
      recordType: "rights",
      schemaId: "mkt-videos/rights-record@1",
      schemaVersion: 1,
      status: "active",
      governance: envelope(matrix(), {
        ownerId: "client:b",
        sourceRef: "attestation:rights-b",
      }),
      supersedesRevision: null,
      payload: {
        schema: "mkt-videos/rights-record@1",
        targetRef: itemRef(targetB),
        permissions: matrix({ localAnalysis: "denied" }),
        basis: "Atestação humana exata para B.",
        validFrom: NOW,
        expiresAt: null,
        evidenceRefs: [],
      },
      createdAt: NOW,
      createdBy: "human:operator",
    },
  });
  const snapshotA = repository.resolveReferenceAssetEffectiveRights({
    grant: grantA,
    rootScopeId: "client:a",
    referenceAssetId: targetA.id,
  });
  const snapshotB = repository.resolveReferenceAssetEffectiveRights({
    grant: grantB,
    rootScopeId: "client:b",
    referenceAssetId: targetB.id,
  });
  assert.notEqual(snapshotA.rightsHead.id, rightsB.id);
  assert.equal(
    snapshotA.effectiveRights.permissions.localAnalysis.state,
    "allowed",
  );
  assert.equal(
    snapshotB.effectiveRights.permissions.localAnalysis.state,
    "denied",
  );
});
