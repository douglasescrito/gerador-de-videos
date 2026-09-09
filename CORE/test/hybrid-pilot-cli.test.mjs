import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createArtifactFromFile } from "../lib/media-pipeline/artifact.mjs";
import { createHybridPilotSelection } from "../lib/media-pipeline/hybrid-pilot-selection.mjs";
import { createStageReceipt, writeJsonAtomic, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";

const execFileAsync = promisify(execFile);

test("hybrid-pilot CLI verifica seleção e grava readiness/manifest sem provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hybrid-pilot-cli-"));
  try {
    const baseFile = path.join(root, "base.mp4");
    const overlayFile = path.join(root, "overlay.mp4");
    await writeFile(baseFile, "base-bytes", "utf8");
    await writeFile(overlayFile, "overlay-bytes", "utf8");
    const baseArtifact = await createArtifactFromFile({ file: baseFile, kind: "video", role: "video-base" });
    const overlayArtifact = await createArtifactFromFile({ file: overlayFile, kind: "video", role: "video-alpha" });
    const baseReceiptFile = path.join(root, "base.receipt.json");
    const overlayReceiptFile = path.join(root, "overlay.receipt.json");
    const baseReceipt = createStageReceipt({ operation: "fixture-base", provider: "gemini-omni", stage: "fixture", artifacts: [baseArtifact], metadata: { rightsStatus: "allowed" } });
    const overlayReceipt = createStageReceipt({ operation: "fixture-overlay", provider: "local-html", stage: "fixture", artifacts: [overlayArtifact], metadata: { rightsStatus: "allowed" } });
    await writeStageReceipt(baseReceiptFile, baseReceipt);
    await writeStageReceipt(overlayReceiptFile, overlayReceipt);
    const selection = createHybridPilotSelection({
      selectionId: "selection:cli-test",
      rootScopeId: "client-test",
      productionScopeId: "production-test",
      selectedBy: "human-test",
      selectedAt: "2026-07-27T18:30:00.000Z",
      humanConfirmed: true,
      timelineFingerprint: "timeline:test",
      base: { file: baseFile, artifactId: baseArtifact.id, artifactContentHash: baseArtifact.hash.value, receiptFile: baseReceiptFile, receiptId: baseReceipt.id, receiptHash: baseReceipt.hash.value, rightsStatus: "allowed", sourceClass: "omni-approved" },
      overlay: { file: overlayFile, artifactId: overlayArtifact.id, artifactContentHash: overlayArtifact.hash.value, receiptFile: overlayReceiptFile, receiptId: overlayReceipt.id, receiptHash: overlayReceipt.hash.value, rightsStatus: "allowed", sourceClass: "local-deterministic" },
    });
    const selectionFile = path.join(root, "selection.json");
    const readinessFile = path.join(root, "readiness.json");
    const manifestFile = path.join(root, "manifest.json");
    const auditFile = path.join(root, "audit.json");
    await writeJsonAtomic(selectionFile, selection, { label: "selection fixture" });
    const { stdout } = await execFileAsync(process.execPath, [path.join(process.cwd(), "scripts", "omni-cli.mjs"), "hybrid-pilot", "--selection", selectionFile, "--readiness", readinessFile, "--out-manifest", manifestFile, "--duration-frames", "192"], { cwd: process.cwd(), windowsHide: true });
    const readiness = JSON.parse(await readFile(readinessFile, "utf8"));
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    assert.equal(readiness.ready, true);
    assert.equal(readiness.providerCalls, 0);
    assert.equal(manifest.metadata.humanConfirmed, true);
    assert.equal(JSON.parse(stdout).composition, null);
    const auditStdout = await execFileAsync(process.execPath, [path.join(process.cwd(), "scripts", "omni-cli.mjs"), "hybrid-pilot", "--audit-root", root, "--audit-out", auditFile], { cwd: process.cwd(), windowsHide: true });
    const audit = JSON.parse(await readFile(auditFile, "utf8"));
    assert.equal(JSON.parse(auditStdout.stdout).candidateCount, 2);
    assert.equal(audit.providerCalls, 0);
    assert.equal(audit.changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
