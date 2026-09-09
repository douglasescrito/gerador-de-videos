import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  link as createHardlink,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_ASSET_INTEGRITY_REPORT_SCHEMA,
  KNOWLEDGE_ASSET_LINK_SCHEMA,
  verifyKnowledgeAssetIntegrity,
} from "../lib/media-pipeline/knowledge-asset-integrity.mjs";
import {
  listKnowledgeSchemas,
  validateKnowledgeContract,
} from "../lib/media-pipeline/knowledge-schema-registry.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assetLink({
  id = "kal_0000000000000001",
  relativePath,
  expectedSha256,
  expectedBytes,
  rightsStatus = "allowed",
  quarantineStatus = "clear",
} = {}) {
  return {
    schema: KNOWLEDGE_ASSET_LINK_SCHEMA,
    id,
    rootKind: "test",
    relativePath,
    expectedSha256,
    ...(expectedBytes == null ? {} : { expectedBytes }),
    rightsStatus,
    quarantineStatus,
  };
}

async function fixture(run) {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "knowledge-asset-integrity-"),
  );
  const root = path.join(temporary, "assets");
  await mkdir(root);
  try {
    return await run({ temporary, root });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function allowTestRoot(root) {
  return [{ rootKind: "test", directory: root }];
}

test("contratos de asset link e relatório pertencem ao registry unificado", () => {
  const ids = new Set(listKnowledgeSchemas().map((entry) => entry.id));
  assert.equal(ids.has(KNOWLEDGE_ASSET_LINK_SCHEMA), true);
  assert.equal(ids.has(KNOWLEDGE_ASSET_INTEGRITY_REPORT_SCHEMA), true);

  const valid = assetLink({
    relativePath: "colecao/video.mp4",
    expectedSha256: "a".repeat(64),
  });
  assert.equal(validateKnowledgeContract(valid).valid, true);
  assert.equal(
    validateKnowledgeContract({
      ...valid,
      privateClientId: "cliente-real",
    }).valid,
    false,
  );
});

test("restore assimétrico reporta asset ausente e extra sem revelar paths", async () =>
  fixture(async ({ root }) => {
    const privateContents = "conteudo-privado-que-nao-pode-vazar";
    await writeFile(path.join(root, "extra-private.bin"), privateContents);
    const link = assetLink({
      relativePath: "missing-private.bin",
      expectedSha256: digest("expected"),
      expectedBytes: 8,
    });

    const before = await stat(path.join(root, "extra-private.bin"));
    const first = await verifyKnowledgeAssetIntegrity({
      links: [link],
      allowedRoots: allowTestRoot(root),
    });
    const second = await verifyKnowledgeAssetIntegrity({
      links: [link],
      allowedRoots: allowTestRoot(root),
    });
    const after = await stat(path.join(root, "extra-private.bin"));

    assert.equal(first.status, "asymmetric");
    assert.deepEqual(first.counts, {
      total: 1,
      resolved: 0,
      missing: 1,
      revoked: 0,
      quarantined: 0,
      extra: 1,
    });
    assert.deepEqual(first.results, [{
      linkId: link.id,
      rootKind: "test",
      status: "missing",
      reason: "asset-not-found",
    }]);
    assert.deepEqual(first.roots, [{
      rootKind: "test",
      linkedCount: 1,
      presentLinkedCount: 0,
      scannedFileCount: 1,
      extraCount: 1,
    }]);
    assert.equal(first.reportOnly, true);
    assert.equal(first.readOnly, true);
    assert.equal(first.repairPerformed, false);
    assert.equal(first.aggregateHash, second.aggregateHash);
    assert.equal(before.mtimeMs, after.mtimeMs);

    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes("missing-private.bin"), false);
    assert.equal(serialized.includes("extra-private.bin"), false);
    assert.equal(serialized.includes(privateContents), false);
  }));

test("hash e bytes divergentes viram missing com motivo específico", async () =>
  fixture(async ({ root }) => {
    const hashBytes = Buffer.from("AAAA", "utf8");
    const sizeBytes = Buffer.from("BBBBB", "utf8");
    await writeFile(path.join(root, "hash.bin"), hashBytes);
    await writeFile(path.join(root, "size.bin"), sizeBytes);
    const links = [
      assetLink({
        id: "kal_0000000000000002",
        relativePath: "hash.bin",
        expectedSha256: digest("ZZZZ"),
        expectedBytes: hashBytes.length,
      }),
      assetLink({
        id: "kal_0000000000000003",
        relativePath: "size.bin",
        expectedSha256: digest(sizeBytes),
        expectedBytes: sizeBytes.length + 1,
      }),
    ];

    const report = await verifyKnowledgeAssetIntegrity({
      links,
      allowedRoots: allowTestRoot(root),
    });
    assert.equal(report.counts.missing, 2);
    assert.equal(report.counts.extra, 0);
    assert.deepEqual(
      report.results.map((entry) => [entry.linkId, entry.reason]),
      [
        ["kal_0000000000000002", "hash-mismatch"],
        ["kal_0000000000000003", "size-mismatch"],
      ],
    );
  }));

test("root ausente só vira assimetria quando o chamador opta por report-only", async () =>
  fixture(async ({ root }) => {
    const link = assetLink({
      relativePath: "missing-root.bin",
      expectedSha256: digest("expected"),
    });
    await rm(root, { recursive: true });

    await assert.rejects(
      verifyKnowledgeAssetIntegrity({
        links: [link],
        allowedRoots: allowTestRoot(root),
      }),
      /deve existir/,
    );
    const report = await verifyKnowledgeAssetIntegrity({
      links: [link],
      allowedRoots: allowTestRoot(root),
      missingRootsAsEmpty: true,
    });
    assert.equal(report.status, "asymmetric");
    assert.deepEqual(report.counts, {
      total: 1,
      resolved: 0,
      missing: 1,
      revoked: 0,
      quarantined: 0,
      extra: 0,
    });
    assert.deepEqual(report.results, [{
      linkId: link.id,
      rootKind: "test",
      status: "missing",
      reason: "asset-not-found",
    }]);
    await assert.rejects(stat(root), { code: "ENOENT" });
  }));

test("rights e quarentena bloqueiam hash, e a verificação preserva mtime", async () =>
  fixture(async ({ root }) => {
    const files = [
      ["revoked.bin", "revoked-private"],
      ["quarantined.bin", "quarantined-private"],
      ["resolved.bin", "resolved-private"],
    ];
    for (const [name, contents] of files) {
      await writeFile(path.join(root, name), contents);
    }
    const before = new Map();
    for (const [name] of files) {
      before.set(name, (await stat(path.join(root, name))).mtimeMs);
    }
    const links = [
      assetLink({
        id: "kal_0000000000000004",
        relativePath: "revoked.bin",
        expectedSha256: "0".repeat(64),
        rightsStatus: "revoked",
      }),
      assetLink({
        id: "kal_0000000000000005",
        relativePath: "quarantined.bin",
        expectedSha256: "0".repeat(64),
        quarantineStatus: "quarantined",
      }),
      assetLink({
        id: "kal_0000000000000006",
        relativePath: "resolved.bin",
        expectedSha256: digest("resolved-private"),
        expectedBytes: Buffer.byteLength("resolved-private"),
      }),
    ];

    const report = await verifyKnowledgeAssetIntegrity({
      links: [links[2], links[0], links[1]],
      allowedRoots: allowTestRoot(root),
    });
    assert.deepEqual(
      report.results.map((entry) => [entry.status, entry.reason]),
      [
        ["revoked", "rights-revoked"],
        ["quarantined", "asset-quarantined"],
        ["resolved", "hash-match"],
      ],
    );
    assert.deepEqual(report.counts, {
      total: 3,
      resolved: 1,
      missing: 0,
      revoked: 1,
      quarantined: 1,
      extra: 0,
    });
    for (const [name] of files) {
      assert.equal(
        (await stat(path.join(root, name))).mtimeMs,
        before.get(name),
      );
    }
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.results), true);
  }));

test("rejeita paths inseguros e roots sobrepostos antes de ler assets", async () =>
  fixture(async ({ root }) => {
    const nested = path.join(root, "nested-root");
    await mkdir(nested);
    const base = assetLink({
      relativePath: "safe.bin",
      expectedSha256: "a".repeat(64),
    });
    for (const relativePath of [
      "../escape.bin",
      "folder/../escape.bin",
      "folder\\escape.bin",
      "C:/escape.bin",
      "/escape.bin",
    ]) {
      await assert.rejects(
        verifyKnowledgeAssetIntegrity({
          links: [{ ...base, relativePath }],
          allowedRoots: allowTestRoot(root),
        }),
        /relativePath|inválido/,
      );
    }
    await assert.rejects(
      verifyKnowledgeAssetIntegrity({
        links: [],
        allowedRoots: [
          { rootKind: "test", directory: root },
          { rootKind: "outputs", directory: nested },
        ],
      }),
      /sobrepostos/,
    );
  }));

test("nunca segue junction/symlink nem aceita hardlink", async (t) => {
  await t.test("junction", async () =>
    fixture(async ({ temporary, root }) => {
      const outside = path.join(temporary, "outside");
      await mkdir(outside);
      await writeFile(path.join(outside, "private.bin"), "private");
      const junction = path.join(root, "junction");
      try {
        await symlink(outside, junction, "junction");
      } catch (error) {
        if (error?.code === "EPERM") {
          t.skip("Criação de junction indisponível neste host.");
          return;
        }
        throw error;
      }
      await assert.rejects(
        verifyKnowledgeAssetIntegrity({
          links: [],
          allowedRoots: allowTestRoot(root),
        }),
        /symlink|junction/,
      );
    }));

  await t.test("hardlink", async () =>
    fixture(async ({ root }) => {
      const source = path.join(root, "source.bin");
      await writeFile(source, "private");
      await createHardlink(source, path.join(root, "alias.bin"));
      await assert.rejects(
        verifyKnowledgeAssetIntegrity({
          links: [],
          allowedRoots: allowTestRoot(root),
        }),
        /hardlink/,
      );
    }));
});
