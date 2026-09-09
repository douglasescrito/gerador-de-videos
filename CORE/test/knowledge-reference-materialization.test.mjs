import assert from "node:assert/strict";
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
  buildReferenceInventory,
} from "../lib/media-pipeline/knowledge-reference-inventory.mjs";
import {
  resolveEffectiveRights,
} from "../lib/media-pipeline/knowledge-effective-rights.mjs";
import {
  buildReferenceKnowledgeMaterialization,
  validateReferenceKnowledgeMaterialization,
} from "../lib/media-pipeline/knowledge-reference-materialization.mjs";
import {
  createCohortRightsAttestation,
  createReferenceCohortManifest,
} from "../lib/media-pipeline/knowledge-reference-rights.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";

const ROOT_A = "client:a";
const ROOT_B = "client:b";
const SCOPE_A = "project:a";
const POLICY_HASH = "f".repeat(64);
const FIXED_AT = "2026-07-24T13:05:00.000Z";

function permissions() {
  return {
    inventory: "allowed",
    localAnalysis: "allowed",
    textualIndexing: "unknown",
    embedding: "denied",
    training: "denied",
    providerInput: "denied",
    publication: "unknown",
    reuse: "unknown",
  };
}

async function fixture(context, {
  rootScopeId = ROOT_A,
  scopeId = SCOPE_A,
  contents = ["one", "two", "three"],
} = {}) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mkt-reference-materialization-"),
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "nested"));
  await Promise.all([
    writeFile(path.join(root, "one.mp4"), contents[0]),
    writeFile(path.join(root, "nested", "two.mp4"), contents[1]),
    writeFile(path.join(root, "three.mp4"), contents[2]),
  ]);
  const inventory = await buildReferenceInventory({
    root,
    rootScopeId,
    scopeId,
    owner: { type: "client", id: rootScopeId },
    rootAlias: "motion-library",
    now: new Date("2026-07-24T12:00:00.000Z"),
  });
  const manifest = createReferenceCohortManifest({
    inventory,
    assetIds: inventory.assets.map(({ id }) => id),
    claimedProvenance: "third-party-reference",
    generatedAt: new Date("2026-07-24T13:00:00.000Z"),
    generatedBy: "human:operator",
  });
  const includedEntryIds = manifest.entries
    .slice(0, 2)
    .map(({ id }) => id);
  const excludedEntryIds = manifest.entries
    .slice(2)
    .map(({ id }) => id);
  const attestation = createCohortRightsAttestation({
    manifest,
    includedEntryIds,
    excludedEntryIds,
    permissions: permissions(),
    basis: "Autorização humana para análise local do cohort exato.",
    validFrom: "2026-07-24T13:00:00.000Z",
    expiresAt: null,
    policyId: "knowledge-governance-policy@1",
    policyHash: POLICY_HASH,
    approvedAt: new Date(FIXED_AT),
    approvedBy: "human:operator",
    confirmHuman: true,
    expectedManifestHash: manifest.contentHash,
  });
  return {
    root,
    inventory,
    manifest,
    attestation,
  };
}

function build(input, overrides = {}) {
  return buildReferenceKnowledgeMaterialization({
    ...input,
    rootScopeId: input.inventory.rootScopeId,
    confirmHuman: true,
    expectedAttestationHash: input.attestation.contentHash,
    ...overrides,
  });
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

test("materializa evidência, todos os assets, decisão e rights incluídos na ordem canônica", async (context) => {
  const input = await fixture(context);
  const result = build(input);

  assert.equal(result.providerFree, true);
  assert.equal(result.persisted, false);
  assert.equal(result.evidenceItem.recordType, "evidence");
  assert.equal(result.entityItems.length, input.manifest.entryCount);
  assert.equal(result.decisionItem.recordType, "decision");
  assert.equal(
    result.rightsItems.length,
    input.attestation.includedEntryIds.length,
  );
  assert.deepEqual(result.items, [
    result.evidenceItem,
    ...result.entityItems,
    result.decisionItem,
    ...result.rightsItems,
  ]);
  assert.ok(result.items.every((item) =>
    item.schema === "mkt-videos/knowledge-item@1"
    && item.status === "active"
    && /^[a-f0-9]{64}$/u.test(item.contentHash)));
  assert.ok(Object.values(result.evidenceItem.governance.rights)
    .every((state) => state === "unknown"));
  assert.ok(Object.values(result.decisionItem.governance.rights)
    .every((state) => state === "unknown"));

  const evidenceRef = itemRef(result.evidenceItem);
  for (const entity of result.entityItems) {
    assert.deepEqual(entity.payload.evidenceRefs, [evidenceRef]);
  }
  assert.deepEqual(
    result.decisionItem.payload.contextRefs,
    result.entityItems.map(itemRef),
  );
  for (const rights of result.rightsItems) {
    const target = result.entityItems.find(({ id }) =>
      id === rights.payload.targetRef.id);
    assert.ok(target);
    assert.deepEqual(rights.payload.targetRef, itemRef(target));
    assert.deepEqual(rights.payload.evidenceRefs, [evidenceRef]);
  }
  assert.equal(
    validateReferenceKnowledgeMaterialization(result),
    result,
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
});

test("entries excluídas continuam unknown e nunca recebem rights-record", async (context) => {
  const input = await fixture(context);
  const result = build(input);
  const excluded = new Set(input.attestation.excludedEntryIds);
  const included = new Set(input.attestation.includedEntryIds);

  for (const entity of result.entityItems) {
    const entryId = entity.payload.attributes.cohortEntryId;
    if (excluded.has(entryId)) {
      assert.ok(Object.values(entity.governance.rights)
        .every((state) => state === "unknown"));
      assert.equal(
        result.rightsItems.some(({ payload }) =>
          payload.targetRef.id === entity.id),
        false,
      );
      const effective = resolveEffectiveRights({
        targetItem: entity,
        rightsItems: result.rightsItems,
        at: FIXED_AT,
      });
      assert.ok(Object.values(effective.permissions)
        .every(({ state }) => state === "unknown"));
    } else {
      assert.equal(included.has(entryId), true);
      assert.deepEqual(entity.governance.rights, permissions());
      assert.equal(
        result.rightsItems.some(({ payload }) =>
          payload.targetRef.id === entity.id),
        true,
      );
      const effective = resolveEffectiveRights({
        targetItem: entity,
        rightsItems: result.rightsItems,
        at: FIXED_AT,
      });
      assert.equal(
        effective.permissions.localAnalysis.state,
        "allowed",
      );
      assert.equal(
        effective.permissions.providerInput.state,
        "denied",
      );
    }
  }
});

test("root explícito e documentos de roots diferentes falham fechado", async (context) => {
  const inputA = await fixture(context);
  const inputB = await fixture(context, {
    rootScopeId: ROOT_B,
    scopeId: "project:b",
  });

  assert.throws(
    () => build(inputA, { rootScopeId: ROOT_B }),
    /igualdade exata de rootScopeId/,
  );
  assert.throws(
    () => build({
      inventory: inputA.inventory,
      manifest: inputB.manifest,
      attestation: inputB.attestation,
    }, {
      rootScopeId: ROOT_A,
    }),
    /igualdade exata de rootScopeId|inventário exato/,
  );
});

test("hash esperado, atestação e vínculo inventory-manifest são exatos", async (context) => {
  const input = await fixture(context);
  assert.throws(
    () => build(input, {
      expectedAttestationHash: "0".repeat(64),
    }),
    /expectedAttestationHash diverge/,
  );
  assert.throws(
    () => build(input, { confirmHuman: false }),
    /confirmação humana explícita/,
  );
  assert.throws(
    () => build(input, {
      materializedAt: "2026-07-24T13:04:59.999Z",
    }),
    /não pode preceder/,
  );
  assert.throws(
    () => build(input, {
      materializedBy: "human:other",
    }),
    /approvedBy da atestação exata/,
  );

  const tamperedAttestation = structuredClone(input.attestation);
  tamperedAttestation.permissions.localAnalysis = "denied";
  assert.throws(
    () => build({
      ...input,
      attestation: tamperedAttestation,
    }),
    /contentHash da atestação diverge/,
  );

  const changed = await fixture(context, {
    contents: ["changed", "two", "three"],
  });
  assert.throws(
    () => build({
      inventory: changed.inventory,
      manifest: input.manifest,
      attestation: input.attestation,
    }),
    /inventário exato/,
  );
});

test("mesmos inputs produzem bytes lógicos determinísticos sem mutação", async (context) => {
  const input = await fixture(context);
  const snapshot = structuredClone(input);
  const first = build(input);
  const second = build(input);

  assert.deepEqual(first, second);
  assert.equal(first.materializationHash, second.materializationHash);
  assert.deepEqual(input, snapshot);
});

test("nova atestação conserva identidades lógicas de entity e rights", async (context) => {
  const input = await fixture(context);
  const secondAttestation = createCohortRightsAttestation({
    manifest: input.manifest,
    includedEntryIds: input.attestation.includedEntryIds,
    excludedEntryIds: input.attestation.excludedEntryIds,
    permissions: permissions(),
    basis: "Nova decisão humana sobre o mesmo cohort e os mesmos assets.",
    validFrom: "2026-07-24T13:00:00.000Z",
    expiresAt: null,
    policyId: "knowledge-governance-policy@1",
    policyHash: POLICY_HASH,
    approvedAt: new Date("2026-07-24T13:06:00.000Z"),
    approvedBy: "human:operator",
    confirmHuman: true,
    expectedManifestHash: input.manifest.contentHash,
  });
  const first = build(input);
  const second = build({
    ...input,
    attestation: secondAttestation,
  });

  const firstEntityIds = first.entityItems.map(({ id }) => id);
  const secondEntityIds = second.entityItems.map(({ id }) => id);
  assert.deepEqual(secondEntityIds, firstEntityIds);
  assert.ok(firstEntityIds.every((id) =>
    /^reference-asset:kra_[a-f0-9]{32}$/u.test(id)));
  assert.ok(first.entityItems.some((item, index) =>
    item.contentHash !== second.entityItems[index].contentHash));

  assert.deepEqual(
    second.rightsItems.map(({ id }) => id),
    first.rightsItems.map(({ id }) => id),
  );
  assert.ok(first.rightsItems.some((item, index) =>
    item.contentHash !== second.rightsItems[index].contentHash));
});

test("materialização completa persiste atomicamente no repository único", async (context) => {
  const input = await fixture(context);
  const materialization = build(input);
  const dbFile = path.join(input.root, "knowledge.sqlite");
  initializeKnowledgeStore({
    dbFile,
    clock: () => new Date(FIXED_AT),
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    clock: () => new Date(FIXED_AT),
  });
  const grant = createScopeGrant({
    rootScopeIds: [ROOT_A],
    permissions: ["read", "write", "integrity"],
    actor: "human:operator",
    purpose: "persist exact attested reference cohort",
    issuedAt: "2026-07-24T13:00:00.000Z",
    expiresAt: "2026-07-24T14:00:00.000Z",
  });
  repository.createScope({
    grant,
    scope: {
      id: ROOT_A,
      rootScopeId: ROOT_A,
      parentScopeId: null,
      kind: "client",
      name: "Client A",
      createdAt: FIXED_AT,
      createdBy: "human:operator",
    },
  });
  repository.createScope({
    grant,
    scope: {
      id: SCOPE_A,
      rootScopeId: ROOT_A,
      parentScopeId: ROOT_A,
      kind: "project",
      name: "Project A",
      createdAt: FIXED_AT,
      createdBy: "human:operator",
    },
  });

  const persisted = repository.appendKnowledgeItemsAtomic({
    grant,
    items: materialization.items,
  });
  assert.deepEqual(persisted, materialization.items);
  assert.equal(
    repository.listKnowledgeItems({
      grant,
      rootScopeId: ROOT_A,
    }).length,
    materialization.items.length,
  );
  assert.equal(
    repository.checkIntegrity({
      grant,
      rootScopeId: ROOT_A,
    }).ok,
    true,
  );
});
