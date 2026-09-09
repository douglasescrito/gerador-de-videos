import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { approveAnimatic, createAnimatic, verifyAnimaticApproval } from "../lib/media-pipeline/animatic.mjs";
import { probeTiming, probeMedia, runFfmpeg } from "../lib/media-pipeline/index.mjs";

test("animatic usa keyframes aprováveis, spans exatos e aprovação por fingerprint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "animatic-"));
  try {
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=1280x720", "-frames:v", "1", first]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=1280x720", "-frames:v", "1", second]);
    const output = path.join(root, "animatic.mp4");
    const result = await createAnimatic({
      scenes: [
        { id: "a", keyframeFile: first, duration: 1, onScreenText: "IDEIA" },
        { id: "b", keyframeFile: second, duration: 1, onScreenText: "AÇÃO" },
      ],
      outputFile: output,
      fps: 24,
      timelineFingerprint: "timeline-test",
    });
    assert.ok(Math.abs((await probeMedia(output)).duration - 2) <= 0.05);
    assert.equal((await probeTiming({ mediaFile: output, expectedFrames: 48 })).status, "pass");
    const approved = await approveAnimatic({ animaticFile: output, receiptFile: result.receiptFile, author: "Operador de teste" });
    assert.equal((await verifyAnimaticApproval({ approvalFile: approved.file })).valid, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("animatic bloqueia keyframe com aspecto incorreto antes do render", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "animatic-aspect-"));
  try {
    const square = path.join(root, "square.png");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=black:s=512x512", "-frames:v", "1", square]);
    await assert.rejects(createAnimatic({ scenes: [{ id: "a", keyframeFile: square, duration: 1 }], outputFile: path.join(root, "bad.mp4"), aspect: "16:9" }), /keyframe_aspect_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
