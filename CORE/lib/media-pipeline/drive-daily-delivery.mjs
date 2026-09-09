import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { studioLocalPath } from '../studio-local-config.mjs';
import {
  createStageReceipt,
  operationFingerprint,
  pathExists,
  readVerifiedReceipt,
  replaceJsonAtomic,
  writeJsonAtomic,
  writeStageReceipt,
} from "./pipeline-operation.mjs";
import { createArtifactFromFile } from "./artifact.mjs";

export const DRIVE_DAILY_DELIVERY_REQUEST_SCHEMA = "mkt-videos/drive-daily-delivery-request@1";
export const DRIVE_DAILY_DELIVERY_METADATA_SCHEMA = "mkt-videos/drive-daily-delivery@1";
export const DEFAULT_GCP_CLI = studioLocalPath('gcpCli');

const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".webm"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

export function normalizeDriveFolderId(value) {
  const normalized = requiredText(value, "--root-folder-id");
  try {
    const url = new URL(normalized);
    const parts = url.pathname.split("/").filter(Boolean);
    const folderIndex = parts.indexOf("folders");
    if (folderIndex >= 0 && parts[folderIndex + 1]) return parts[folderIndex + 1];
    const fileIndex = parts.indexOf("d");
    if (fileIndex >= 0 && parts[fileIndex + 1]) return parts[fileIndex + 1];
  } catch {
    return normalized;
  }
  return normalized;
}

export function normalizeDeliveryDate(value, now = new Date()) {
  if (value == null || String(value).trim() === "") {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("--date deve usar AAAA-MM-DD.");
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (
    Number.isNaN(parsed.getTime())
    || `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}` !== normalized
  ) {
    throw new Error("--date deve representar uma data válida em AAAA-MM-DD.");
  }
  return normalized;
}

export function normalizePieceName(value) {
  const normalized = requiredText(value, "--name").replace(/\s+/g, " ").trim();
  if (/[\\/\0]/u.test(normalized)) throw new Error("--name não pode conter separadores de caminho.");
  if (normalized.length > 180) throw new Error("--name deve ter no máximo 180 caracteres.");
  return normalized;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "peca";
}

async function recursiveFiles(root) {
  const absolute = path.resolve(root);
  if (!await pathExists(absolute)) return [];
  const found = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) found.push(file);
    }
  };
  await visit(absolute);
  return found.sort((left, right) => left.localeCompare(right));
}

function flattenedRemoteName(file, base) {
  return path.relative(base, file).split(path.sep).filter(Boolean).join("--");
}

async function resolveCollectionRoot(coreRoot, collection) {
  const requested = requiredText(collection, "--collection");
  const direct = path.resolve(requested);
  const fallback = path.resolve(coreRoot, "outputs", requested);
  const resolved = await pathExists(direct) ? direct : fallback;
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Coleção não encontrada: ${resolved}`);
  return resolved;
}

async function collectDeliverySources(collectionRoot, { includeOriginals = false } = {}) {
  const videosRoot = path.join(collectionRoot, "videos-unidos");
  const videoFiles = (await recursiveFiles(videosRoot))
    .filter((file) => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (!videoFiles.length) {
    throw new Error(`A coleção não possui master em videos-unidos: ${collectionRoot}`);
  }

  const receiptsRoot = path.join(collectionRoot, "receitas");
  const canonicalReceipts = (await recursiveFiles(receiptsRoot))
    .filter((file) => path.extname(file).toLowerCase() === ".json")
    .filter((file) => !file.endsWith(".drive-delivery.receipt.json"));
  const allSidecars = (await recursiveFiles(collectionRoot))
    .filter((file) => file.endsWith(".receipt.json"))
    .filter((file) => !file.startsWith(`${receiptsRoot}${path.sep}`))
    .filter((file) => !file.endsWith(".drive-delivery.receipt.json"));

  const originalsRoot = path.join(collectionRoot, "videos-soltos");
  const originalFiles = includeOriginals
    ? (await recursiveFiles(originalsRoot)).filter((file) => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    : [];

  const sources = [
    ...videoFiles.map((file) => ({
      category: "videos",
      file,
      remoteName: includeOriginals
        ? `masters--${flattenedRemoteName(file, videosRoot)}`
        : flattenedRemoteName(file, videosRoot),
      mediaRole: "master",
    })),
    ...originalFiles.map((file) => ({
      category: "videos",
      file,
      remoteName: `originais--${flattenedRemoteName(file, originalsRoot)}`,
      mediaRole: "original",
    })),
    ...canonicalReceipts.map((file) => ({
      category: "receitas",
      file,
      remoteName: flattenedRemoteName(file, receiptsRoot),
    })),
    ...allSidecars.map((file) => ({
      category: "receitas",
      file,
      remoteName: flattenedRemoteName(file, collectionRoot),
    })),
  ];

  const seen = new Set();
  for (const source of sources) {
    const key = `${source.category}/${source.remoteName}`.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Destino remoto duplicado na coleção: ${source.category}/${source.remoteName}`);
    }
    seen.add(key);
  }
  return sources;
}

async function sourceArtifact(source) {
  return createArtifactFromFile({
    file: source.file,
    kind: source.category === "videos" ? "video" : "document",
    role: source.category === "videos" ? "delivery-video" : "delivery-receipt",
    metadata: {
      driveCategory: source.category,
      remoteName: source.remoteName,
    },
  });
}

function manifestFileFromArtifact(source, artifact) {
  return {
    category: source.category,
    sourcePath: artifact.file,
    remoteName: source.remoteName,
    ...(source.mediaRole ? { mediaRole: source.mediaRole } : {}),
    bytes: artifact.bytes,
    sha256: artifact.hash.value,
  };
}

export async function createDriveDailyDeliveryPlan({
  coreRoot,
  collection,
  rootFolderId,
  client = null,
  pieceName = null,
  date = null,
  receiptFile = null,
  gcpCli = DEFAULT_GCP_CLI,
  includeOriginals = false,
  now = new Date(),
} = {}) {
  const absoluteCore = path.resolve(requiredText(coreRoot, "coreRoot"));
  const normalizedClient = requiredText(client, "--client");
  const collectionRoot = await resolveCollectionRoot(absoluteCore, collection);
  const normalizedPiece = normalizePieceName(pieceName ?? path.basename(collectionRoot));
  const normalizedDate = normalizeDeliveryDate(date, now);
  const normalizedRoot = normalizeDriveFolderId(rootFolderId);
  const absoluteGcpCli = path.resolve(requiredText(gcpCli, 'Helper Drive ausente: configure STUDIO_GCP_CLI ou --gcp-cli'));
  const sources = await collectDeliverySources(collectionRoot, { includeOriginals });
  const artifacts = await Promise.all(sources.map(sourceArtifact));
  const files = sources.map((source, index) => manifestFileFromArtifact(source, artifacts[index]));
  const requestFingerprint = operationFingerprint({
    rootFolderId: normalizedRoot,
    date: normalizedDate,
    pieceName: normalizedPiece,
    includeOriginals: Boolean(includeOriginals),
    files: files.map(({ category, remoteName, bytes, sha256 }) => ({
      category,
      remoteName,
      bytes,
      sha256,
    })),
  });
  const manifest = {
    schema: DRIVE_DAILY_DELIVERY_REQUEST_SCHEMA,
    rootFolderId: normalizedRoot,
    date: normalizedDate,
      pieceName: normalizedPiece,
      includeOriginals: Boolean(includeOriginals),
    requestFingerprint,
    files,
  };
  const defaultReceipt = path.join(
    collectionRoot,
    "receitas",
    `${normalizedDate}--${slugify(normalizedPiece)}.drive-delivery.receipt.json`,
  );
  return {
    schema: DRIVE_DAILY_DELIVERY_METADATA_SCHEMA,
    collectionRoot,
    rootFolderId: normalizedRoot,
    client: normalizedClient,
    date: normalizedDate,
    pieceName: normalizedPiece,
    layout: `${normalizedDate}/${normalizedPiece}/{videos,receitas}`,
    gcpCli: absoluteGcpCli,
    receiptFile: path.resolve(receiptFile ? String(receiptFile) : defaultReceipt),
    requestFingerprint,
    manifest,
    artifacts,
    summary: {
      videos: files.filter((item) => item.category === "videos").length,
      receipts: files.filter((item) => item.category === "receitas").length,
      files: files.length,
      bytes: files.reduce((total, item) => total + item.bytes, 0),
    },
  };
}

function matchingRemoteItem(driveResult, manifestFile) {
  return (driveResult?.files ?? []).find((item) => (
    item.category === manifestFile.category
    && item.remoteName === manifestFile.remoteName
    && item.verified === true
    && Number(item.bytes) === Number(manifestFile.bytes)
    && String(item.sha256) === String(manifestFile.sha256)
    && item.remote?.id
    && item.remote?.name === manifestFile.remoteName
    && Number(item.remote?.size) === Number(manifestFile.bytes)
  ));
}

async function supplementalUpload(plan, files, driveRunner) {
  const artifacts = await Promise.all(files.map(async ({ file, remoteName }) => {
    const artifact = await createArtifactFromFile({
      file,
      kind: "document",
      role: "drive-delivery-evidence",
      metadata: { driveCategory: "receitas", remoteName },
    });
    return {
      category: "receitas",
      sourcePath: artifact.file,
      remoteName,
      bytes: artifact.bytes,
      sha256: artifact.hash.value,
    };
  }));
  const result = await driveRunner({
    gcpCli: plan.gcpCli,
    client: plan.client,
    manifest: {
      schema: DRIVE_DAILY_DELIVERY_REQUEST_SCHEMA,
      rootFolderId: plan.rootFolderId,
      date: plan.date,
      pieceName: plan.pieceName,
      requestFingerprint: operationFingerprint({
        parent: plan.requestFingerprint,
        files: artifacts.map(({ remoteName, bytes, sha256 }) => ({ remoteName, bytes, sha256 })),
      }),
      files: artifacts,
    },
    apply: true,
  });
  if (result?.verifiedCount !== artifacts.length) {
    throw new Error("O Drive não confirmou as evidências complementares da publicação.");
  }
  return result;
}

async function archiveAndPurgeLocalMedia({ plan, driveResult, driveRunner, confirmLocalMediaDelete }) {
  if (confirmLocalMediaDelete !== true) {
    throw new Error("A limpeza local exige --confirm-local-media-delete true.");
  }
  const media = plan.manifest.files.filter((item) => item.category === "videos");
  const remoteFiles = media.map((item) => {
    const verified = matchingRemoteItem(driveResult, item);
    if (!verified) throw new Error(`Mídia sem prova remota exata: ${item.remoteName}`);
    return {
      sourcePath: item.sourcePath,
      mediaRole: item.mediaRole ?? "master",
      remoteName: item.remoteName,
      bytes: item.bytes,
      sha256: item.sha256,
      localMd5: verified.localMd5,
      remote: verified.remote,
    };
  });
  const metadataRoot = path.join(plan.collectionRoot, "metadados");
  const archiveFile = path.join(metadataRoot, "remote-archive-manifest.json");
  const cleanupStateFile = path.join(metadataRoot, "local-media-cleanup.state.json");
  const archiveManifest = {
    schema: "mkt-videos/remote-archive-manifest@1",
    requestFingerprint: plan.requestFingerprint,
    rootFolderId: plan.rootFolderId,
    date: plan.date,
    pieceName: plan.pieceName,
    verifiedAt: new Date().toISOString(),
    files: remoteFiles,
  };
  if (await pathExists(archiveFile)) {
    const existing = JSON.parse(await readFile(archiveFile, "utf8"));
    if (operationFingerprint(existing.files) !== operationFingerprint(archiveManifest.files)) {
      throw new Error("Manifest remoto existente diverge da publicação atual.");
    }
  } else {
    await writeJsonAtomic(archiveFile, archiveManifest, { label: "Manifest remoto" });
  }
  const archiveDrive = await supplementalUpload(plan, [{
    file: archiveFile,
    remoteName: path.basename(archiveFile),
  }], driveRunner);

  const state = {
    schema: "mkt-videos/local-media-cleanup-state@1",
    requestFingerprint: plan.requestFingerprint,
    collectionRoot: plan.collectionRoot,
    startedAt: new Date().toISOString(),
    completedAt: null,
    files: [],
  };
  await replaceJsonAtomic(cleanupStateFile, state, { label: "Estado de limpeza local" });
  for (const item of remoteFiles) {
    const absolute = path.resolve(item.sourcePath);
    const relative = path.relative(plan.collectionRoot, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Limpeza recusada fora da coleção: ${absolute}`);
    }
    if (!VIDEO_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
      throw new Error(`Limpeza recusada para extensão não autorizada: ${absolute}`);
    }
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error(`Limpeza recusada para arquivo não regular ou com hard links: ${absolute}`);
    }
    const current = await createArtifactFromFile({
      file: absolute,
      kind: "video",
      role: "local-media-cleanup-verification",
    });
    if (current.bytes !== item.bytes || current.hash.value !== item.sha256) {
      throw new Error(`Hash local divergiu antes da remoção: ${absolute}`);
    }
    await unlink(absolute);
    state.files.push({
      sourcePath: absolute,
      bytes: item.bytes,
      sha256: item.sha256,
      remoteId: item.remote.id,
      deletedAt: new Date().toISOString(),
    });
    await replaceJsonAtomic(cleanupStateFile, state, { label: "Estado de limpeza local" });
  }
  state.completedAt = new Date().toISOString();
  state.deletedFiles = state.files.length;
  state.deletedBytes = state.files.reduce((total, item) => total + item.bytes, 0);
  await replaceJsonAtomic(cleanupStateFile, state, { label: "Estado de limpeza local" });
  const cleanupReceiptFile = path.join(plan.collectionRoot, "receitas", "local-media-cleanup.receipt.json");
  const cleanupReceipt = createStageReceipt({
    operation: "local-media-cleanup-after-drive",
    provider: "local",
    mode: "studio",
    stage: "retention-cleanup",
    parameters: {
      requestFingerprint: plan.requestFingerprint,
      deletionScope: "verified-media-files-only",
    },
    inputs: plan.artifacts.filter((artifact) => artifact.kind === "video"),
    artifacts: [],
    metadata: {
      localMediaCleanup: {
        deletedFiles: state.deletedFiles,
        deletedBytes: state.deletedBytes,
        archiveManifest: archiveFile,
        cleanupState: cleanupStateFile,
      },
    },
  });
  await writeStageReceipt(cleanupReceiptFile, cleanupReceipt);
  const cleanupDrive = await supplementalUpload(plan, [
    { file: cleanupReceiptFile, remoteName: path.basename(cleanupReceiptFile) },
    { file: cleanupStateFile, remoteName: path.basename(cleanupStateFile) },
  ], driveRunner);
  return {
    status: "local_purged",
    deletedFiles: state.deletedFiles,
    deletedBytes: state.deletedBytes,
    archiveFile,
    cleanupStateFile,
    cleanupReceiptFile,
    archiveDrive: sanitizedDriveResult(archiveDrive),
    cleanupDrive: sanitizedDriveResult(cleanupDrive),
  };
}

function sanitizedDriveResult(result) {
  return {
    schema: result?.schema ?? null,
    dryRun: Boolean(result?.dryRun),
    requestFingerprint: result?.requestFingerprint ?? null,
    rootFolder: result?.rootFolder ?? null,
    folders: result?.folders ?? null,
    fileCount: result?.fileCount ?? 0,
    uploadedCount: result?.uploadedCount ?? 0,
    alreadyPresentCount: result?.alreadyPresentCount ?? 0,
    plannedCount: result?.plannedCount ?? 0,
    verifiedCount: result?.verifiedCount ?? 0,
    files: (result?.files ?? []).map((item) => ({
      category: item.category,
      sourcePath: item.sourcePath,
      remoteName: item.remoteName,
      bytes: item.bytes,
      sha256: item.sha256,
      status: item.status,
      localMd5: item.localMd5,
      verified: item.verified,
      remote: item.remote ?? null,
    })),
  };
}

async function runCliGcp({
  gcpCli,
  client,
  manifest,
  apply,
  spawnImpl = spawn,
} = {}) {
  await access(gcpCli);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "mkt-videos-drive-"));
  const manifestFile = path.join(temporaryRoot, "delivery.json");
  try {
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      gcpCli,
      "--client",
      client,
      "drive-daily-publish",
      "--manifest",
      manifestFile,
      ...(apply ? ["--yes"] : []),
    ];
    const outcome = await new Promise((resolve, reject) => {
      const child = spawnImpl("powershell.exe", args, {
        cwd: path.dirname(gcpCli),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        process.stderr.write(text);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    if (outcome.code !== 0) {
      const message = outcome.stderr.trim().split(/\r?\n/).slice(-1)[0] || "falha sem mensagem";
      throw new Error(`cli-gcp drive-daily-publish falhou: ${message}`);
    }
    try {
      return JSON.parse(outcome.stdout);
    } catch {
      throw new Error("cli-gcp drive-daily-publish não retornou JSON válido.");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function receiptMatchesPlan(receipt, plan) {
  return (
    receipt?.operation === "drive-daily-delivery"
    && receipt?.metadata?.dailyDriveDelivery?.requestFingerprint === plan.requestFingerprint
  );
}

async function deliveryReceipt(plan, driveResult, now = new Date()) {
  if (await pathExists(plan.receiptFile)) {
    const existing = await readVerifiedReceipt(plan.receiptFile);
    if (!receiptMatchesPlan(existing, plan)) {
      throw new Error(`Recibo existente não corresponde ao plano atual: ${plan.receiptFile}`);
    }
    return { receipt: existing, created: false };
  }
  const receipt = createStageReceipt({
    operation: "drive-daily-delivery",
    provider: "google-drive-via-cli-gcp",
    model: null,
    mode: "studio",
    stage: "delivery-archive",
    parameters: {
      rootFolderId: plan.rootFolderId,
      client: plan.client,
      date: plan.date,
      pieceName: plan.pieceName,
      layout: plan.layout,
    },
    inputs: plan.artifacts,
    artifacts: [],
    providerResponse: sanitizedDriveResult(driveResult),
    cost: null,
    metadata: {
      dailyDriveDelivery: {
        schema: DRIVE_DAILY_DELIVERY_METADATA_SCHEMA,
        requestFingerprint: plan.requestFingerprint,
        collectionRoot: plan.collectionRoot,
        summary: plan.summary,
        verified: driveResult?.verifiedCount === driveResult?.fileCount,
      },
    },
    startedAt: now,
    completedAt: new Date(),
  });
  await writeStageReceipt(plan.receiptFile, receipt);
  return { receipt, created: true };
}

async function receiptUploadManifest(plan) {
  const artifact = await createArtifactFromFile({
    file: plan.receiptFile,
    kind: "document",
    role: "drive-delivery-receipt",
    metadata: { driveCategory: "receitas", remoteName: path.basename(plan.receiptFile) },
  });
  return {
    schema: DRIVE_DAILY_DELIVERY_REQUEST_SCHEMA,
    rootFolderId: plan.rootFolderId,
    date: plan.date,
    pieceName: plan.pieceName,
    requestFingerprint: operationFingerprint({
      parent: plan.requestFingerprint,
      receipt: artifact.hash.value,
    }),
    files: [{
      category: "receitas",
      sourcePath: artifact.file,
      remoteName: path.basename(plan.receiptFile),
      bytes: artifact.bytes,
      sha256: artifact.hash.value,
    }],
  };
}

export async function deliverCollectionToDrive({
  coreRoot,
  collection,
  rootFolderId,
  client = null,
  pieceName = null,
  date = null,
  receiptFile = null,
  gcpCli = DEFAULT_GCP_CLI,
  includeOriginals = false,
  cleanupLocalMedia = false,
  confirmLocalMediaDelete = false,
  dryRun = true,
  confirmDriveWrite = false,
  now = new Date(),
  driveRunner = runCliGcp,
} = {}) {
  const plan = await createDriveDailyDeliveryPlan({
    coreRoot,
    collection,
    rootFolderId,
    client,
    pieceName,
    date,
    receiptFile,
    gcpCli,
    includeOriginals,
    now,
  });
  if (dryRun) {
    const driveResult = await driveRunner({
      gcpCli: plan.gcpCli,
      client: plan.client,
      manifest: plan.manifest,
      apply: false,
    });
    return {
      status: "planned",
      dryRun: true,
      plan: {
        ...plan,
        artifacts: plan.artifacts,
      },
      drive: sanitizedDriveResult(driveResult),
    };
  }
  if (confirmDriveWrite !== true) {
    throw new Error("A publicação no Drive exige --confirm-drive-write true.");
  }
  const driveResult = await driveRunner({
    gcpCli: plan.gcpCli,
    client: plan.client,
    manifest: plan.manifest,
    apply: true,
  });
  if (driveResult?.verifiedCount !== driveResult?.fileCount) {
    throw new Error("O Drive não confirmou todos os arquivos da coleção.");
  }
  const receiptResult = await deliveryReceipt(plan, driveResult, now);
  const receiptDriveResult = await driveRunner({
    gcpCli: plan.gcpCli,
    client: plan.client,
    manifest: await receiptUploadManifest(plan),
    apply: true,
  });
  if (receiptDriveResult?.verifiedCount !== 1) {
    throw new Error("O Drive não confirmou o recibo final da publicação.");
  }
  const cleanup = cleanupLocalMedia
    ? await archiveAndPurgeLocalMedia({
        plan,
        driveResult,
        driveRunner,
        confirmLocalMediaDelete,
      })
    : null;
  return {
    status: cleanup ? "local_purged" : "completed",
    dryRun: false,
    collectionRoot: plan.collectionRoot,
    rootFolderId: plan.rootFolderId,
    date: plan.date,
    pieceName: plan.pieceName,
    layout: plan.layout,
    summary: plan.summary,
    drive: sanitizedDriveResult(driveResult),
    receiptFile: plan.receiptFile,
    receiptId: receiptResult.receipt.id,
    receiptCreated: receiptResult.created,
    receiptDrive: sanitizedDriveResult(receiptDriveResult),
    cleanup,
  };
}
