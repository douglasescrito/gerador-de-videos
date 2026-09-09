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
  assertCohortApplicationSet,
  createCohortRightsAttestation,
  createReferenceCohortManifest,
  validateCohortRightsAttestation,
  validateReferenceCohortManifest,
} from "../lib/media-pipeline/knowledge-reference-rights.mjs";

const POLICY_HASH = "f".repeat(64);

async function setup(context, {
  rootScopeId = "client:a",
  scopeId = "project:a",
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-ref-cohort-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "one.mp4"), "one");
  await writeFile(path.join(root, "nested", "two.mp4"), "two");
  const inventory = await buildReferenceInventory({
    root,
    rootScopeId,
    scopeId,
    owner: { type: "client", id: rootScopeId },
    rootAlias: "motion-library",
    now: new Date("2026-07-24T12:00:00.000Z"),
  });
  return { root, inventory };
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

function manifestFor(inventory, assetIds = null) {
  return createReferenceCohortManifest({
    inventory,
    assetIds: assetIds ?? inventory.assets.map(({ id }) => id),
    claimedProvenance: "third-party-reference",
    generatedAt: new Date("2026-07-24T13:00:00.000Z"),
    generatedBy: "human:operator",
  });
}

function attest(manifest, overrides = {}) {
  return createCohortRightsAttestation({
    manifest,
    includedEntryIds: manifest.entries.map(({ id }) => id),
    excludedEntryIds: [],
    permissions: matrix(),
    basis: "Autorização humana para estudo local do cohort exato.",
    validFrom: "2026-07-24T13:00:00.000Z",
    expiresAt: null,
    policyId: "knowledge-governance-policy@1",
    policyHash: POLICY_HASH,
    approvedAt: new Date("2026-07-24T13:05:00.000Z"),
    approvedBy: "human:operator",
    confirmHuman: true,
    expectedManifestHash: manifest.contentHash,
    ...overrides,
  });
}

test("manifest e atestação ficam presos ao conjunto exato e ao hash confirmado", async (context) => {
  const { inventory } = await setup(context);
  const manifest = manifestFor(inventory);
  const attestation = attest(manifest);
  const result = assertCohortApplicationSet({
    manifest,
    attestation,
    entryIds: attestation.includedEntryIds,
  });
  assert.equal(result.length, manifest.entryCount);
  assert.ok(result.every(({ permissions }) =>
    permissions.providerInput === "denied"));
  assert.ok(result.every(({ permissions }) =>
    permissions.training === "denied"));
});

test("omissão, extra, duplicata e sobreposição nunca ampliam o cohort", async (context) => {
  const { inventory } = await setup(context);
  const manifest = manifestFor(inventory);
  const ids = manifest.entries.map(({ id }) => id);

  assert.throws(
    () => attest(manifest, { includedEntryIds: [ids[0]] }),
    /particionar exatamente/,
  );
  assert.throws(
    () => attest(manifest, {
      includedEntryIds: ids,
      excludedEntryIds: [ids[0]],
    }),
    /sobrepõem/,
  );
  assert.throws(
    () => attest(manifest, {
      includedEntryIds: [...ids, ids[0]],
    }),
    /duplicados/,
  );
  assert.throws(
    () => assertCohortApplicationSet({
      manifest,
      attestation: attest(manifest),
      entryIds: [ids[0]],
    }),
    /igualdade exata/,
  );
});

test("novo asset, rename, cópia ou mesmo hash não herdam a atestação", async (context) => {
  const { root, inventory } = await setup(context);
  const manifest = manifestFor(inventory);
  const attestation = attest(manifest);
  await writeFile(path.join(root, "future.mp4"), "one");
  const changed = await buildReferenceInventory({
    root,
    rootScopeId: inventory.rootScopeId,
    scopeId: inventory.scopeId,
    owner: inventory.owner,
    rootAlias: inventory.rootAlias,
    now: new Date("2026-07-24T14:00:00.000Z"),
  });
  const future = changed.assets.find(({ logicalPath }) =>
    logicalPath === "future.mp4");
  assert.ok(future);
  assert.throws(
    () => assertCohortApplicationSet({
      manifest,
      attestation,
      entryIds: [
        ...attestation.includedEntryIds,
        `kce_${future.contentHash.slice(0, 32)}`,
      ],
    }),
    /igualdade exata/,
  );
});

test("mesmo arquivo em outro root não satisfaz manifest ou atestação", async (context) => {
  const first = await setup(context, {
    rootScopeId: "client:a",
    scopeId: "project:a",
  });
  const second = await setup(context, {
    rootScopeId: "client:b",
    scopeId: "project:b",
  });
  const manifestA = manifestFor(first.inventory);
  const attestationA = attest(manifestA);
  const manifestB = manifestFor(second.inventory);
  assert.throws(
    () => validateCohortRightsAttestation(attestationA, {
      manifest: manifestB,
    }),
    /diverge do manifest exato/,
  );
});

test("provider input, treinamento e embedding ficam denied nesta versão", async (context) => {
  const { inventory } = await setup(context);
  const manifest = manifestFor(inventory);
  for (const key of ["providerInput", "training", "embedding"]) {
    assert.throws(
      () => attest(manifest, {
        permissions: matrix({ [key]: "allowed" }),
      }),
      new RegExp(`permissions\\.${key} deve permanecer denied`),
    );
  }
});

test("confirmação humana, hash esperado e validade são obrigatórios", async (context) => {
  const { inventory } = await setup(context);
  const manifest = manifestFor(inventory);
  assert.throws(
    () => attest(manifest, { confirmHuman: false }),
    /confirmação humana/,
  );
  assert.throws(
    () => attest(manifest, {
      expectedManifestHash: "0".repeat(64),
    }),
    /diverge do manifest apresentado/,
  );
  assert.throws(
    () => attest(manifest, {
      expiresAt: "2026-07-24T12:00:00.000Z",
    }),
    /posterior a validFrom/,
  );
});

test("IDs, counts e hashes adulterados falham fechado", async (context) => {
  const { inventory } = await setup(context);
  const manifest = manifestFor(inventory);

  const badEntry = structuredClone(manifest);
  badEntry.entries[0].fileSha256 = "0".repeat(64);
  assert.throws(
    () => validateReferenceCohortManifest(badEntry),
    /Entry ID diverge/,
  );

  const badCount = structuredClone(manifest);
  badCount.entryCount += 1;
  assert.throws(
    () => validateReferenceCohortManifest(badCount),
    /entryCount diverge/,
  );

  const attestation = attest(manifest);
  const badAttestation = structuredClone(attestation);
  badAttestation.permissions.localAnalysis = "denied";
  assert.throws(
    () => validateCohortRightsAttestation(badAttestation, { manifest }),
    /contentHash da atestação diverge/,
  );
});
