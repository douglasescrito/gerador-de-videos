import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REFERENCE_RIGHT_KEYS,
  buildReferenceInventory,
  validateReferenceInventory,
} from "../lib/media-pipeline/knowledge-reference-inventory.mjs";

function options(root, overrides = {}) {
  return {
    root,
    rootScopeId: "client:a",
    scopeId: "project:a",
    owner: { type: "client", id: "client:a" },
    rootAlias: "motion-library",
    now: new Date("2026-07-24T12:00:00.000Z"),
    ...overrides,
  };
}

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mkt-ref-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "b.mp4"), "video-b");
  await writeFile(path.join(root, "nested", "a.mp4"), "video-a");
  await writeFile(path.join(root, "ignored.txt"), "not inventoried");
  return root;
}

test("inventário é metadata-only, determinístico e mantém todos os direitos unknown", async (context) => {
  const root = await fixture(context);
  const first = await buildReferenceInventory(options(root));
  const repeated = await buildReferenceInventory(options(root, {
    now: new Date("2026-07-24T13:00:00.000Z"),
  }));

  assert.equal(first.assetCount, 2);
  assert.equal(first.fingerprint, repeated.fingerprint);
  assert.notEqual(first.generatedAt, repeated.generatedAt);
  assert.deepEqual(
    first.assets.map(({ logicalPath }) => logicalPath),
    ["b.mp4", "nested/a.mp4"],
  );
  assert.deepEqual(first.analysis, {
    contentInspected: false,
    probe: false,
    decode: false,
    frames: false,
    audio: false,
    ocr: false,
    providerCalls: 0,
  });
  for (const asset of first.assets) {
    assert.ok(REFERENCE_RIGHT_KEYS.every((right) =>
      asset.rights[right] === "unknown"));
    assert.match(asset.fileSha256, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(asset), /C:\\|\/tmp\//iu);
  }
  assert.equal(first.analysis.probe, false);
  assert.equal(first.analysis.frames, false);
});

test("proveniência conhecida continua sem conceder qualquer direito", async (context) => {
  const root = await fixture(context);
  const inventory = await buildReferenceInventory(options(root, {
    provenanceCandidate: "client-supplied",
  }));
  assert.ok(inventory.assets.every((asset) =>
    asset.provenanceCandidate === "client-supplied"));
  assert.ok(inventory.assets.every((asset) =>
    REFERENCE_RIGHT_KEYS.every((right) =>
      asset.rights[right] === "unknown")));
});

test("schema e semântica rejeitam permissão, hash e fingerprint autoatribuídos", async (context) => {
  const root = await fixture(context);
  const inventory = await buildReferenceInventory(options(root));

  const allowed = structuredClone(inventory);
  allowed.assets[0].rights.localAnalysis = "allowed";
  assert.throws(
    () => validateReferenceInventory(allowed),
    /Reference inventory inválido|Proveniência não pode conceder direitos/,
  );

  const forgedAsset = structuredClone(inventory);
  forgedAsset.assets[0].fileSha256 = "f".repeat(64);
  assert.throws(
    () => validateReferenceInventory(forgedAsset),
    /contentHash do asset diverge/,
  );

  const forgedManifest = structuredClone(inventory);
  forgedManifest.assetCount += 1;
  assert.throws(
    () => validateReferenceInventory(forgedManifest),
    /assetCount diverge/,
  );
});

test("hardlink em asset inventariado falha fechado", async (context) => {
  const root = await fixture(context);
  await link(path.join(root, "b.mp4"), path.join(root, "copy.mp4"));
  await assert.rejects(
    buildReferenceInventory(options(root)),
    /hardlink|sem links/,
  );
});

test("symlink ou junction dentro da biblioteca falha fechado", async (context) => {
  const root = await fixture(context);
  const target = path.join(root, "b.mp4");
  const linked = path.join(root, "linked.mp4");
  try {
    await symlink(target, linked, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) {
      context.skip(`Host não permite criar symlink: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    buildReferenceInventory(options(root)),
    /symlink|junction/,
  );
});

test("rootAlias e caminhos lógicos não aceitam path, ADS, controles ou traversal", async (context) => {
  const root = await fixture(context);
  await assert.rejects(
    buildReferenceInventory(options(root, { rootAlias: "../refs" })),
    /rootAlias/,
  );
  await writeFile(path.join(root, "bad\u202ename.mp4"), "bidi-name");
  await assert.rejects(
    buildReferenceInventory(options(root)),
    /caminho lógico relativo e seguro/,
  );
});
