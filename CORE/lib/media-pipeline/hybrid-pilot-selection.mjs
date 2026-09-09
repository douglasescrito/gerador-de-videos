import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { createHybridCompositionManifest } from "./hybrid-compositor.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";
import { readReceipt } from "./receipt.mjs";

export const HYBRID_PILOT_SELECTION_SCHEMA =
  "mkt-videos/hybrid-pilot-selection@1";
export const HYBRID_PILOT_READINESS_SCHEMA =
  "mkt-videos/hybrid-pilot-readiness@1";
export const HYBRID_PILOT_CANDIDATE_AUDIT_SCHEMA =
  "mkt-videos/hybrid-pilot-candidate-audit@1";

const SOURCE_CLASSES = new Set(["omni-approved", "local-deterministic"]);

function sourceClassForProvider(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (normalized.includes("gemini") || normalized.includes("omni")) return "omni-approved";
  if (normalized.includes("local") || normalized.includes("playwright") || normalized.includes("ffmpeg")) return "local-deterministic";
  return null;
}

function relativeReportPath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function insideRoot(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function listReceiptFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(file);
      } else if (entry.isFile() && entry.name.endsWith(".receipt.json")) {
        files.push(file);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 512) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function safeId(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function sha256(value, label) {
  const normalized = String(value ?? "");
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${label} deve ser SHA-256.`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = requiredText(value, label);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} deve ser timestamp ISO-8601 UTC canônico.`);
  }
  return normalized;
}

function normalizeAsset(value, label, expectedSourceClass) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} inválido.`);
  const sourceClass = requiredText(value.sourceClass, `${label}.sourceClass`);
  if (sourceClass !== expectedSourceClass || !SOURCE_CLASSES.has(sourceClass)) {
    throw new Error(`${label}.sourceClass incompatível.`);
  }
  if (value.rightsStatus !== "allowed") throw new Error(`${label}.rightsStatus deve ser allowed.`);
  return {
    file: path.resolve(requiredText(value.file, `${label}.file`)),
    artifactId: requiredText(value.artifactId, `${label}.artifactId`),
    artifactContentHash: sha256(value.artifactContentHash, `${label}.artifactContentHash`),
    receiptFile: path.resolve(requiredText(value.receiptFile, `${label}.receiptFile`)),
    receiptId: requiredText(value.receiptId, `${label}.receiptId`),
    receiptHash: sha256(value.receiptHash, `${label}.receiptHash`),
    rightsStatus: "allowed",
    sourceClass,
  };
}

function selectionBody(value = {}) {
  if (value.humanConfirmed !== true) throw new Error("Seleção do piloto exige humanConfirmed=true.");
  const base = normalizeAsset(value.base, "base", "omni-approved");
  const overlay = normalizeAsset(value.overlay, "overlay", "local-deterministic");
  if (base.file === overlay.file || base.artifactId === overlay.artifactId || base.receiptId === overlay.receiptId) {
    throw new Error("Seleção híbrida exige base e overlay distintos.");
  }
  return {
    schema: HYBRID_PILOT_SELECTION_SCHEMA,
    selectionId: safeId(value.selectionId, "selectionId"),
    rootScopeId: safeId(value.rootScopeId, "rootScopeId"),
    productionScopeId: safeId(value.productionScopeId, "productionScopeId"),
    selectedBy: requiredText(value.selectedBy, "selectedBy"),
    selectedAt: timestamp(value.selectedAt, "selectedAt"),
    humanConfirmed: true,
    timelineFingerprint: requiredText(value.timelineFingerprint, "timelineFingerprint"),
    base,
    overlay,
  };
}

export function createHybridPilotSelection(value = {}) {
  const body = selectionBody(value);
  return { ...body, fingerprint: operationFingerprint(body) };
}

export function assertHybridPilotSelection(value) {
  const body = selectionBody(value);
  if (value?.schema !== HYBRID_PILOT_SELECTION_SCHEMA) throw new Error("Seleção de piloto híbrido inválida.");
  if (value?.fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint da seleção híbrida divergente.");
  return true;
}

export function assertHybridPilotReadiness(value) {
  if (!value || value.schema !== HYBRID_PILOT_READINESS_SCHEMA) throw new Error("Readiness do piloto híbrido inválida.");
  if (value.humanConfirmed !== true || value.providerCalls !== 0 || value.changed !== false) {
    throw new Error("Readiness do piloto híbrido não pode declarar efeitos.");
  }
  if (!Array.isArray(value.assets) || value.assets.length !== 2 || !Array.isArray(value.issues)) {
    throw new Error("Readiness do piloto híbrido possui projeção inválida.");
  }
  const { fingerprint, ...body } = value;
  if (fingerprint !== operationFingerprint(body)) throw new Error("Fingerprint da readiness híbrida divergente.");
  return true;
}

function receiptContainsArtifact(receipt, artifact) {
  return Array.isArray(receipt?.artifacts) && receipt.artifacts.some((entry) => (
    entry?.id === artifact.id
    && entry?.hash?.algorithm === "sha256"
    && entry?.hash?.value === artifact.hash.value
  ));
}

function receiptProvenanceMatches(receipt, sourceClass) {
  const provider = String(receipt?.provider ?? "").trim().toLowerCase();
  if (!provider) return false;
  if (sourceClass === "omni-approved") {
    return provider.includes("gemini") || provider.includes("omni");
  }
  if (sourceClass === "local-deterministic") {
    return provider.includes("local")
      || provider.includes("playwright")
      || provider.includes("ffmpeg");
  }
  return false;
}

export async function verifyHybridPilotSelection(selection) {
  assertHybridPilotSelection(selection);
  const issues = [];
  const assets = [];
  for (const [role, expected] of [["base", selection.base], ["overlay", selection.overlay]]) {
    try {
      const artifact = await createArtifactFromFile({
        file: expected.file,
        kind: "video",
        role,
      });
      const receipt = await readReceipt(expected.receiptFile);
      const matchesArtifact = artifact.id === expected.artifactId
        && artifact.hash.value === expected.artifactContentHash;
      const matchesReceipt = receipt.id === expected.receiptId
        && receipt.hash?.value === expected.receiptHash
        && receiptContainsArtifact(receipt, artifact);
      const matchesProvenance = receiptProvenanceMatches(receipt, expected.sourceClass);
      if (!matchesArtifact) issues.push(`${role}:artifact-mismatch`);
      if (!matchesReceipt) issues.push(`${role}:receipt-mismatch`);
      if (!matchesProvenance) issues.push(`${role}:receipt-provenance`);
      assets.push({
        role,
        status: matchesArtifact && matchesReceipt && matchesProvenance ? "resolved" : "quarantined",
        artifactId: artifact.id,
        receiptId: receipt.id,
        provenance: matchesProvenance ? "matched" : "mismatch",
      });
    } catch (error) {
      issues.push(`${role}:unreadable`);
      assets.push({ role, status: "missing" });
    }
  }
  const body = {
    schema: HYBRID_PILOT_READINESS_SCHEMA,
    selectionFingerprint: selection.fingerprint,
    humanConfirmed: selection.humanConfirmed,
    providerCalls: 0,
    changed: false,
    ready: issues.length === 0,
    assets,
    issues,
  };
  const fingerprintBody = {
      schema: HYBRID_PILOT_READINESS_SCHEMA,
      selectionFingerprint: selection.fingerprint,
      humanConfirmed: selection.humanConfirmed,
      providerCalls: 0,
      changed: false,
      ready: issues.length === 0,
      assets,
      issues,
    };
  const result = { ...body, fingerprint: operationFingerprint(fingerprintBody) };
  assertHybridPilotReadiness(result);
  return result;
}

function auditRightsStatus(receipt) {
  const direct = receipt?.rightsStatus;
  const metadata = receipt?.metadata?.rightsStatus;
  const governance = receipt?.metadata?.governance?.rightsStatus;
  return [direct, metadata, governance].find((value) => value === "allowed") ?? null;
}

function pushAuditReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function assertHybridPilotCandidateAudit(value) {
  if (!value || value.schema !== HYBRID_PILOT_CANDIDATE_AUDIT_SCHEMA) {
    throw new Error("Auditoria de candidatos do piloto híbrido inválida.");
  }
  if (value.providerCalls !== 0 || value.changed !== false || value.selectionRequired !== true) {
    throw new Error("Auditoria do piloto híbrido não pode declarar efeitos ou seleção automática.");
  }
  if (!Number.isInteger(value.receiptCount) || value.receiptCount < 0) {
    throw new Error("Auditoria do piloto híbrido possui receiptCount inválido.");
  }
  if (!Array.isArray(value.candidates) || !Array.isArray(value.blocked)) {
    throw new Error("Auditoria do piloto híbrido possui listas inválidas.");
  }
  const { fingerprint, ...body } = value;
  if (fingerprint !== operationFingerprint(body)) {
    throw new Error("Fingerprint da auditoria do piloto híbrido divergente.");
  }
  return true;
}

/**
 * Produz somente um inventário report-only para a seleção humana do Piloto C.
 * Direitos não são inferidos: sem rightsStatus=allowed no próprio receipt (ou
 * metadata governada do receipt), o asset permanece bloqueado e não é hasheado.
 */
export async function auditHybridPilotCandidates({
  root,
  clock = () => new Date(),
} = {}) {
  const rootDirectory = path.resolve(requiredText(root, "root"));
  const rootInfo = await lstat(rootDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("root da auditoria do piloto híbrido deve ser um diretório real.");
  }
  const atValue = clock();
  const capturedAt = (atValue instanceof Date ? atValue : new Date(atValue)).toISOString();
  const receiptFiles = await listReceiptFiles(rootDirectory);
  const candidates = [];
  const blocked = [];
  let completedReceiptCount = 0;

  for (const receiptFile of receiptFiles) {
    let receipt;
    try {
      receipt = await readReceipt(receiptFile);
    } catch {
      blocked.push({ receipt: relativeReportPath(rootDirectory, receiptFile), reasons: ["receipt-invalid"] });
      continue;
    }
    if (receipt.status === "completed") completedReceiptCount += 1;
    const sourceClass = sourceClassForProvider(receipt.provider);
    const rightsStatus = auditRightsStatus(receipt);
    const reasons = [];
    if (receipt.status !== "completed") pushAuditReason(reasons, `receipt-${String(receipt.status ?? "missing")}`);
    if (!sourceClass) pushAuditReason(reasons, "provider-provenance-unknown");
    if (rightsStatus !== "allowed") pushAuditReason(reasons, "rights-status-not-explicitly-allowed");
    const videoArtifact = Array.isArray(receipt.artifacts)
      ? receipt.artifacts.find((artifact) => artifact?.kind === "video" && artifact?.file)
      : null;
    if (!videoArtifact) pushAuditReason(reasons, "video-artifact-missing");
    const artifactFile = videoArtifact?.file ? path.resolve(String(videoArtifact.file)) : null;
    if (artifactFile && !insideRoot(rootDirectory, artifactFile)) pushAuditReason(reasons, "artifact-outside-audit-root");
    if (reasons.length) {
      blocked.push({
        receipt: relativeReportPath(rootDirectory, receiptFile),
        receiptId: receipt.id,
        reasons: reasons.sort(),
      });
      continue;
    }
    try {
      const artifactInfo = await lstat(artifactFile);
      if (artifactInfo.isSymbolicLink() || !artifactInfo.isFile() || Number(artifactInfo.nlink ?? 1) > 1) {
        throw new Error("artifact físico não é um arquivo regular exclusivo");
      }
      const artifact = await createArtifactFromFile({ file: artifactFile, kind: "video", role: "pilot-candidate" });
      if (artifact.id !== videoArtifact.id || artifact.hash.value !== videoArtifact.hash?.value) {
        blocked.push({ receipt: relativeReportPath(rootDirectory, receiptFile), receiptId: receipt.id, reasons: ["artifact-hash-mismatch"] });
        continue;
      }
      candidates.push({
        sourceClass,
        rightsStatus: "allowed",
        relativeFile: relativeReportPath(rootDirectory, artifactFile),
        relativeReceipt: relativeReportPath(rootDirectory, receiptFile),
        artifactId: artifact.id,
        receiptId: receipt.id,
        receiptHash: receipt.hash.value,
        artifactContentHash: artifact.hash.value,
      });
    } catch {
      blocked.push({ receipt: relativeReportPath(rootDirectory, receiptFile), receiptId: receipt.id, reasons: ["artifact-unreadable"] });
    }
  }

  candidates.sort((left, right) => `${left.sourceClass}:${left.relativeFile}`.localeCompare(`${right.sourceClass}:${right.relativeFile}`));
  blocked.sort((left, right) => left.receipt.localeCompare(right.receipt));
  const body = {
    schema: HYBRID_PILOT_CANDIDATE_AUDIT_SCHEMA,
    capturedAt,
    rootLabel: path.basename(rootDirectory),
    providerCalls: 0,
    changed: false,
    selectionRequired: true,
    receiptCount: receiptFiles.length,
    completedReceiptCount,
    candidateCount: candidates.length,
    candidates,
    blocked,
  };
  const result = { ...body, fingerprint: operationFingerprint(body) };
  assertHybridPilotCandidateAudit(result);
  return result;
}

export function buildHybridCompositionManifestFromPilot({
  selection,
  readiness,
  fps,
  durationFrames,
  overlay = {},
} = {}) {
  assertHybridPilotSelection(selection);
  assertHybridPilotReadiness(readiness);
  if (readiness.selectionFingerprint !== selection.fingerprint) {
    throw new Error("Readiness e seleção do piloto possuem fingerprints diferentes.");
  }
  if (readiness.ready !== true) {
    throw new Error("Piloto híbrido não está pronto; composição bloqueada.");
  }
  const startFrame = Number(overlay.startFrame ?? 0);
  const endFrameExclusive = Number(overlay.endFrameExclusive ?? durationFrames);
  const zIndex = Number(overlay.zIndex ?? 1);
  const position = {
    x: Number(overlay.position?.x ?? 0),
    y: Number(overlay.position?.y ?? 0),
  };
  return createHybridCompositionManifest({
    mode: "studio",
    fps,
    durationFrames,
    timelineFingerprint: selection.timelineFingerprint,
    tracks: [
      {
        id: "pilot-base",
        kind: "video-base",
        file: selection.base.file,
        startFrame: 0,
        endFrameExclusive: null,
        zIndex: 0,
      },
      {
        id: "pilot-overlay",
        kind: "video-alpha",
        file: selection.overlay.file,
        startFrame,
        endFrameExclusive,
        zIndex,
        alpha: true,
        position,
      },
    ],
    audio: { mode: "preserve-base" },
    cache: { reuseApproved: false },
    metadata: {
      pilotSelectionFingerprint: selection.fingerprint,
      pilotReadinessFingerprint: readiness.fingerprint,
      humanConfirmed: true,
    },
  });
}
