import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { auditHybridPilotCandidates, assertHybridPilotCandidateAudit, buildHybridCompositionManifestFromPilot, createHybridPilotSelection, verifyHybridPilotSelection } from "../lib/media-pipeline/hybrid-pilot-selection.mjs";
import { createReceipt, writeReceipt } from "../lib/media-pipeline/receipt.mjs";

async function asset(directory, name, contents, role, provider = role === "base" ? "gemini-omni" : "local-html", rightsStatus = null) {
  const file = path.join(directory, name);
  await writeFile(file, contents);
  const artifact = await createArtifactFromFile({ file, kind: "video", role });
  const receipt = createReceipt({
    operation: `pilot-${role}`,
    provider,
    status: "completed",
    artifacts: [artifact],
    metadata: rightsStatus ? { rightsStatus } : {},
  });
  const receiptFile = `${file}.receipt.json`;
  await writeReceipt(receiptFile, receipt);
  return {
    file,
    artifactId: artifact.id,
    artifactContentHash: artifact.hash.value,
    receiptFile,
    receiptId: receipt.id,
    receiptHash: receipt.hash.value,
    rightsStatus: "allowed",
    sourceClass: role === "base" ? "omni-approved" : "local-deterministic",
  };
}

test("pilot readiness valida clip, overlay, artifacts e receipts sem provider", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hybrid-pilot-selection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = await asset(directory, "base.mp4", Buffer.from("approved-omni"), "base");
  const overlay = await asset(directory, "overlay.webm", Buffer.from("deterministic-alpha"), "overlay");
  const selection = createHybridPilotSelection({
    selectionId: "pilot:streaks-de-luz",
    rootScopeId: "client-a",
    productionScopeId: "project-a",
    selectedBy: "human-reviewer",
    selectedAt: "2026-07-27T12:00:00.000Z",
    humanConfirmed: true,
    timelineFingerprint: "timeline:pilot",
    base,
    overlay,
  });
  const readiness = await verifyHybridPilotSelection(selection);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.providerCalls, 0);
  assert.equal(readiness.changed, false);
  assert.deepEqual(readiness.assets.map((entry) => entry.status), ["resolved", "resolved"]);
  assert.deepEqual(readiness.issues, []);
  const manifest = buildHybridCompositionManifestFromPilot({
    selection,
    readiness,
    fps: { numerator: 24, denominator: 1 },
    durationFrames: 48,
    overlay: { startFrame: 6, endFrameExclusive: 42, position: { x: 10, y: 20 } },
  });
  assert.equal(manifest.mode, "studio");
  assert.equal(manifest.tracks[0].kind, "video-base");
  assert.equal(manifest.tracks[1].kind, "video-alpha");
  assert.equal(manifest.tracks[1].endFrameExclusive, 42);
  assert.equal(manifest.metadata.humanConfirmed, true);
});

test("pilot readiness falha fechado para hash adulterado ou direito não permitido", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hybrid-pilot-selection-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = await asset(directory, "base.mp4", Buffer.from("approved-omni"), "base");
  const overlay = await asset(directory, "overlay.webm", Buffer.from("deterministic-alpha"), "overlay");
  assert.throws(() => createHybridPilotSelection({
    selectionId: "pilot:invalid",
    rootScopeId: "client-a",
    productionScopeId: "project-a",
    selectedBy: "human-reviewer",
    selectedAt: "2026-07-27T12:00:00.000Z",
    humanConfirmed: true,
    timelineFingerprint: "timeline:pilot",
    base: { ...base, rightsStatus: "unknown" },
    overlay,
  }), /rightsStatus/);
  const selection = createHybridPilotSelection({
    selectionId: "pilot:hash-mismatch",
    rootScopeId: "client-a",
    productionScopeId: "project-a",
    selectedBy: "human-reviewer",
    selectedAt: "2026-07-27T12:00:00.000Z",
    humanConfirmed: true,
    timelineFingerprint: "timeline:pilot",
    base: { ...base, artifactContentHash: "0".repeat(64) },
    overlay,
  });
  const readiness = await verifyHybridPilotSelection(selection);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("base:artifact-mismatch"));
  assert.throws(() => buildHybridCompositionManifestFromPilot({
    selection,
    readiness,
    fps: { numerator: 24, denominator: 1 },
    durationFrames: 48,
  }), /não está pronto/);
});

test("pilot readiness falha fechado quando a proveniência do receipt contradiz a classe", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hybrid-pilot-selection-provenance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = await asset(directory, "base.mp4", Buffer.from("approved-omni"), "base", "local-html");
  const overlay = await asset(directory, "overlay.webm", Buffer.from("deterministic-alpha"), "overlay");
  const selection = createHybridPilotSelection({
    selectionId: "pilot:provenance-mismatch",
    rootScopeId: "client-a",
    productionScopeId: "project-a",
    selectedBy: "human-reviewer",
    selectedAt: "2026-07-27T12:00:00.000Z",
    humanConfirmed: true,
    timelineFingerprint: "timeline:pilot",
    base,
    overlay,
  });
  const readiness = await verifyHybridPilotSelection(selection);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("base:receipt-provenance"));
  assert.equal(readiness.assets[0].provenance, "mismatch");
});

test("auditoria de candidatos é report-only, exige rights explícito e não muta outputs", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hybrid-pilot-candidate-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await asset(directory, "approved.mp4", Buffer.from("approved"), "base", "gemini-omni", "allowed");
  await asset(directory, "blocked.mp4", Buffer.from("blocked"), "base", "gemini-omni");
  const before = await readdir(directory);
  const audit = await auditHybridPilotCandidates({
    root: directory,
    clock: () => new Date("2026-07-27T20:00:00.000Z"),
  });
  assertHybridPilotCandidateAudit(audit);
  assert.equal(audit.providerCalls, 0);
  assert.equal(audit.changed, false);
  assert.equal(audit.selectionRequired, true);
  assert.equal(audit.candidateCount, 1);
  assert.equal(audit.candidates[0].sourceClass, "omni-approved");
  assert.ok(audit.blocked.some((entry) => entry.reasons.includes("rights-status-not-explicitly-allowed")));
  assert.deepEqual(await readdir(directory), before);
});
