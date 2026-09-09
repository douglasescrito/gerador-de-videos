import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptVideoDuration, buildMusicFitFilter, createNarrationCues, fitMusicToDuration, fitNarrationToDuration, lockTimelineFromCues, probeTiming, renderAudioFirstEnding } from "../lib/media-pipeline/audio-first.mjs";
import { runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";

test("cues usam timestamps medidos e bloqueiam omissão, repetição e baixa confiança", () => {
  const pass = createNarrationCues({
    script: "Olá mundo",
    words: [{ word: "Olá", start: 0, end: 0.4, confidence: 0.99 }, { word: "mundo", start: 0.5, end: 1, confidence: 0.98 }],
    blocks: [{ id: "intro", wordStart: 0, wordEnd: 1, text: "Olá mundo" }],
  });
  assert.equal(pass.status, "pass");
  assert.equal(pass.blocks[0].end, 1);
  assert.equal(pass.policy.inventedTimestamps, false);
  const locked = lockTimelineFromCues({ cues: pass, scenes: [{ id: "intro" }], fps: { numerator: 24, denominator: 1 } });
  assert.equal(locked.locked, true);
  assert.equal(locked.spans[0].durationFrames, 24);
  const blocked = createNarrationCues({ script: "Olá mundo", words: [{ word: "Olá", start: 0, end: 0.4, confidence: 0.4 }, { word: "extra", start: 0.5, end: 1 }] });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.findings.some((entry) => entry.code === "word_mismatch"), true);
  assert.equal(blocked.findings.some((entry) => entry.code === "low_alignment_confidence"), true);
});

test("adaptação visual estende sem áudio Omni e nunca comprime para caber", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "audio-adapt-"));
  try {
    const source = path.join(root, "source.mp4");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    const adapted = await adaptVideoDuration({ sourceFile: source, targetDuration: 1.5, policy: "freeze-tail", fps: 24, outputFile: path.join(root, "adapted.mp4") });
    assert.equal(Boolean(adapted.after.audio), false);
    assert.ok(Math.abs(adapted.after.duration - 1.5) <= (1 / 24) + 0.01);
    await assert.rejects(adaptVideoDuration({ sourceFile: source, targetDuration: 0.5, outputFile: path.join(root, "cut.mp4") }), /não comprime nem corta/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("musicFit escolhe trim ou loop com crossfade sem comprimir tempo", () => {
  const trimmed = buildMusicFitFilter({ sourceDuration: 10, targetDuration: 5 });
  assert.equal(trimmed.mode, "trim");
  assert.equal(trimmed.fadeOutSeconds, 0);
  assert.doesNotMatch(trimmed.filter, /afade=t=out/);
  assert.match(buildMusicFitFilter({ sourceDuration: 10, targetDuration: 5, fadeOutSeconds: 0.5 }).filter, /afade=t=out/);
  const loop = buildMusicFitFilter({ sourceDuration: 1, targetDuration: 2.5, crossfadeSeconds: 0.1 });
  assert.equal(loop.mode, "loop-crossfade");
  assert.ok(loop.loops >= 3);
  assert.match(loop.filter, /afade=.*amix/s);
  assert.doesNotMatch(loop.filter, /atempo/);
});

test("musicFit e timing report cumprem 50 ms e um frame em mídia sintética", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "audio-first-"));
  try {
    const source = path.join(root, "source.wav");
    const bed = path.join(root, "bed.wav");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", source]);
    const fitted = await fitMusicToDuration({ sourceFile: source, targetDuration: 2.5, outputFile: bed, crossfadeSeconds: 0.1 });
    assert.ok(Math.abs(fitted.probe.duration - 2.5) <= 0.05);

    const media = path.join(root, "timing.mp4");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media]);
    const report = await probeTiming({ mediaFile: media, expectedFrames: 48, expectedAudioStart: 0, expectedAudioDuration: 2, coextensive: true });
    assert.equal(report.status, "pass");
    assert.equal(report.streams.find((stream) => stream.codec_type === "video").decodedFrames, 48);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("voice-fit preserva o original, limita andamento e entrega a duração exata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "voice-fit-"));
  try {
    const source = path.join(root, "voice.wav");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.1", "-c:a", "pcm_s16le", source]);
    const fitted = await fitNarrationToDuration({ sourceFile: source, targetDuration: 1, maxTempoRatio: 1.15, outputFile: path.join(root, "voice-fitted.wav") });
    assert.ok(Math.abs(fitted.after.duration - 1) <= 0.05);
    assert.ok(fitted.tempoRatio > 1.09 && fitted.tempoRatio < 1.11);
    await assert.rejects(fitNarrationToDuration({ sourceFile: source, targetDuration: 0.5, maxTempoRatio: 1.15, outputFile: path.join(root, "too-fast.wav") }), /acima do limite/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ending audio-first preserva SFX, sobe a cauda e fecha vídeo e áudio no mesmo alvo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "audio-ending-"));
  try {
    const source = path.join(root, "source.mp4");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
    const result = await renderAudioFirstEnding({ sourceFile: source, targetDuration: 1.5, narrationEndSeconds: 1, dipToBlackSeconds: 0.5, omniTailGainDb: 3.5, omniTailRiseSeconds: 0.2, fps: 24, outputFile: path.join(root, "ending.mp4") });
    assert.ok(result.after.video);
    assert.ok(result.after.audio);
    assert.ok(Math.abs(result.after.duration - 1.5) <= (1 / 24) + 0.01);
    assert.equal(result.receipt.parameters.insufficientRemainderPolicy, "fail");
    assert.equal(result.receipt.parameters.dipToBlackSeconds, 0.5);
    await assert.rejects(renderAudioFirstEnding({ sourceFile: source, targetDuration: 3, narrationEndSeconds: 1, outputFile: path.join(root, "too-long.mp4") }), /nova geração automática é proibida/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
