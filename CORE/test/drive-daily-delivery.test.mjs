import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDriveDailyDeliveryPlan,
  deliverCollectionToDrive,
  normalizeDeliveryDate,
  normalizeDriveFolderId,
} from "../lib/media-pipeline/drive-daily-delivery.mjs";
import { verifyReceipt } from "../lib/media-pipeline/receipt.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "drive-daily-delivery-"));
  const coreRoot = path.join(root, "CORE");
  const collectionRoot = path.join(coreRoot, "outputs", "sample-piece");
  const videosDir = path.join(collectionRoot, "videos-unidos");
  const receiptsDir = path.join(collectionRoot, "receitas");
  const looseDir = path.join(collectionRoot, "videos-soltos");
  await Promise.all([
    mkdir(videosDir, { recursive: true }),
    mkdir(receiptsDir, { recursive: true }),
    mkdir(looseDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(videosDir, "master.mp4"), Buffer.from("video")),
    writeFile(path.join(receiptsDir, "master.receipt.json"), "{}\n", "utf8"),
    writeFile(path.join(looseDir, "part.mp4.receipt.json"), "{}\n", "utf8"),
  ]);
  return { root, coreRoot, collectionRoot };
}

test("normaliza pasta e data da entrega diária", () => {
  assert.equal(
    normalizeDriveFolderId("https://drive.google.com/drive/folders/1Folder_ABC"),
    "1Folder_ABC",
  );
  assert.equal(
    normalizeDeliveryDate(null, new Date(2026, 6, 29, 12, 0, 0)),
    "2026-07-29",
  );
  assert.throws(() => normalizeDeliveryDate("29/07/2026"), /AAAA-MM-DD/);
});

test('cliente precisa ser explícito; a instalação não herda marca', async () => {
  await assert.rejects(createDriveDailyDeliveryPlan({ coreRoot: process.cwd(), collection: 'sample', rootFolderId: '1Root', gcpCli: path.resolve('helper.ps1') }), /--client/);
});

test("planeja videos e receitas sem chamar o Drive", async () => {
  const files = await fixture();
  try {
    const plan = await createDriveDailyDeliveryPlan({
      coreRoot: files.coreRoot,
      gcpCli: path.join(files.root, "helper.ps1"),
      collection: "sample-piece",
      rootFolderId: "1Root",
      client: "sample-client",
      date: "2026-07-29",
    });

    assert.equal(plan.layout, "2026-07-29/sample-piece/{videos,receitas}");
    assert.deepEqual(plan.summary, {
      videos: 1,
      receipts: 2,
      files: 3,
      bytes: 11,
    });
    assert.deepEqual(
      plan.manifest.files.map((item) => `${item.category}/${item.remoteName}`),
      [
        "videos/master.mp4",
        "receitas/master.receipt.json",
        "receitas/videos-soltos--part.mp4.receipt.json",
      ],
    );
    assert.match(plan.requestFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("dry-run reconcilia a pasta remota sem autorizar escrita", async () => {
  const files = await fixture();
  const calls = [];
  try {
    const result = await deliverCollectionToDrive({
      coreRoot: files.coreRoot,
      gcpCli: path.join(files.root, "helper.ps1"),
      collection: "sample-piece",
      rootFolderId: "1Root",
      client: "sample-client",
      date: "2026-07-29",
      dryRun: true,
      driveRunner: async ({ manifest, apply }) => {
        calls.push({ manifest, apply });
        return {
          schema: "mkt-videos/drive-daily-delivery-result@1",
          dryRun: true,
          requestFingerprint: manifest.requestFingerprint,
          rootFolder: { id: manifest.rootFolderId, name: "FOCUS INTROS" },
          folders: {
            day: { status: "planned", folder: { id: null, name: manifest.date } },
          },
          fileCount: manifest.files.length,
          uploadedCount: 0,
          alreadyPresentCount: 0,
          plannedCount: manifest.files.length,
          verifiedCount: 0,
          files: manifest.files.map((item) => ({
            ...item,
            status: "planned",
            localMd5: "local-md5",
            verified: null,
            remote: null,
          })),
        };
      },
    });

    assert.equal(result.status, "planned");
    assert.equal(result.drive.rootFolder.name, "FOCUS INTROS");
    assert.equal(result.drive.plannedCount, 3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].apply, false);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("publica com runner injetado, grava recibo e reconcilia repetição", async () => {
  const files = await fixture();
  const calls = [];
  const driveRunner = async ({ manifest, apply }) => {
    calls.push({ manifest, apply });
    return {
      schema: "mkt-videos/drive-daily-delivery-result@1",
      dryRun: false,
      requestFingerprint: manifest.requestFingerprint,
      rootFolder: { id: manifest.rootFolderId, name: "FOCUS INTROS" },
      folders: {
        day: { folder: { id: "day" } },
        piece: { folder: { id: "piece" } },
        videos: { folder: { id: "videos" } },
        receitas: { folder: { id: "receitas" } },
      },
      fileCount: manifest.files.length,
      uploadedCount: manifest.files.length,
      alreadyPresentCount: 0,
      plannedCount: 0,
      verifiedCount: manifest.files.length,
      files: manifest.files.map((item, index) => ({
        ...item,
        status: "uploaded",
        localMd5: `md5-${index}`,
        verified: true,
        remote: { id: `remote-${index}`, name: item.remoteName, size: String(item.bytes) },
      })),
    };
  };
  try {
    const first = await deliverCollectionToDrive({
      coreRoot: files.coreRoot,
      gcpCli: path.join(files.root, "helper.ps1"),
      collection: "sample-piece",
      rootFolderId: "1Root",
      client: "sample-client",
      date: "2026-07-29",
      dryRun: false,
      confirmDriveWrite: true,
      driveRunner,
    });

    assert.equal(first.status, "completed");
    assert.equal(first.receiptCreated, true);
    assert.equal(calls.length, 2);
    const receipt = JSON.parse(await readFile(first.receiptFile, "utf8"));
    assert.equal(receipt.operation, "drive-daily-delivery");
    assert.equal(receipt.metadata.dailyDriveDelivery.verified, true);
    assert.equal(verifyReceipt(receipt).valid, true);

    const second = await deliverCollectionToDrive({
      coreRoot: files.coreRoot,
      gcpCli: path.join(files.root, "helper.ps1"),
      collection: "sample-piece",
      rootFolderId: "1Root",
      client: "sample-client",
      date: "2026-07-29",
      dryRun: false,
      confirmDriveWrite: true,
      driveRunner,
    });

    assert.equal(second.receiptCreated, false);
    assert.equal(second.receiptId, first.receiptId);
    assert.equal(calls.length, 4);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("arquiva originais e masters e remove somente mídia após prova remota", async () => {
  const files = await fixture();
  const originalFile = path.join(files.collectionRoot, "videos-soltos", "part.mp4");
  const masterFile = path.join(files.collectionRoot, "videos-unidos", "master.mp4");
  await writeFile(originalFile, Buffer.from("original"));
  const calls = [];
  const driveRunner = async ({ manifest, apply }) => {
    calls.push({ manifest, apply });
    return {
      schema: "mkt-videos/drive-daily-delivery-result@1",
      dryRun: false,
      requestFingerprint: manifest.requestFingerprint,
      rootFolder: { id: manifest.rootFolderId, name: "FOCUS INTROS" },
      folders: {},
      fileCount: manifest.files.length,
      uploadedCount: manifest.files.length,
      alreadyPresentCount: 0,
      plannedCount: 0,
      verifiedCount: manifest.files.length,
      files: manifest.files.map((item, index) => ({
        ...item,
        status: "uploaded",
        localMd5: `md5-${index}`,
        verified: true,
        remote: {
          id: `remote-${calls.length}-${index}`,
          name: item.remoteName,
          size: String(item.bytes),
        },
      })),
    };
  };
  try {
    const result = await deliverCollectionToDrive({
      coreRoot: files.coreRoot,
      gcpCli: path.join(files.root, "helper.ps1"),
      collection: "sample-piece",
      rootFolderId: "1Root",
      client: "sample-client",
      date: "2026-07-29",
      dryRun: false,
      confirmDriveWrite: true,
      includeOriginals: true,
      cleanupLocalMedia: true,
      confirmLocalMediaDelete: true,
      driveRunner,
    });
    assert.equal(result.status, "local_purged");
    assert.equal(result.cleanup.deletedFiles, 2);
    await assert.rejects(readFile(originalFile), /ENOENT/);
    await assert.rejects(readFile(masterFile), /ENOENT/);
    assert.equal(await readFile(path.join(files.collectionRoot, "receitas", "master.receipt.json"), "utf8"), "{}\n");
    assert.equal(calls.length, 4);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});
