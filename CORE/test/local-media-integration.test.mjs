import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleFilm } from "../lib/media-pipeline/film-assembly.mjs";
import { finishVideo } from "../lib/media-pipeline/delivery-profile.mjs";
import { mixAudio, muxMasterAudio } from "../lib/media-pipeline/audio-mix.mjs";
import { probeMedia, runCommand, runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { runQa } from "../lib/media-pipeline/qa.mjs";

test("pipeline FFmpeg local monta, mixa, finaliza e audita mídia sintética", async (context) => {
  try {
    await runCommand("ffmpeg", ["-version"]);
    await runCommand("ffprobe", ["-version"]);
  } catch {
    context.skip("FFmpeg/ffprobe não estão disponíveis.");
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "mkt-local-media-"));
  try {
    const scene1 = path.join(dir, "scene-1.mp4");
    const scene2 = path.join(dir, "scene-2.mp4");
    const voice = path.join(dir, "voice.wav");
    const music = path.join(dir, "music.wav");
    await Promise.all([
      runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=0.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", scene1]),
      runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=orange:s=320x180:r=24:d=0.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", scene2]),
      runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:a", "pcm_s16le", voice]),
      runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=1.2", "-c:a", "pcm_s16le", music]),
    ]);
    const assembled = await assembleFilm({ sceneFiles: [scene1, scene2], outputFile: path.join(dir, "assembled.mp4"), transition: "cut" });
    const mixed = await mixAudio({ voiceFile: voice, musicFile: music, outputFile: path.join(dir, "master.wav") });
    const mastered = await muxMasterAudio({ videoFile: assembled.file, audioFile: mixed.file, outputFile: path.join(dir, "mastered.mp4") });
    const qa = await runQa({ videoFile: mastered.file, outputFile: path.join(dir, "qa.json"), sourceReceipts: [mastered.receiptFile], expectedParts: 2, actualParts: 2 });
    const delivered = await finishVideo({ inputFile: mastered.file, outputFile: path.join(dir, "delivery.mp4"), profile: "web-1080p", parentReceipts: [qa.receipt.id] });
    const probe = await probeMedia(delivered.file);
    assert.equal(probe.video.width, 1920);
    assert.equal(probe.video.height, 1080);
    assert.ok(probe.audio);
    assert.equal(qa.report.receiptIntegrity[0].valid, true);
    assert.deepEqual(qa.report.parts, { expected: 2, actual: 2 });

    const shortVideo = path.join(dir, "short-video.mp4");
    const longVoice = path.join(dir, "long-voice.wav");
    const blockedOutput = path.join(dir, "must-not-exist.mp4");
    await Promise.all([
      runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", shortVideo]),
      runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.9", "-c:a", "pcm_s16le", longVoice]),
    ]);
    await assert.rejects(
      muxMasterAudio({ videoFile: shortVideo, audioFile: longVoice, outputFile: blockedOutput }),
      /mux bloqueado para evitar truncamento/i,
    );
    await assert.rejects(access(blockedOutput), /ENOENT/);
    await assert.rejects(access(`${blockedOutput}.receipt.json`), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
