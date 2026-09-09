import test from "node:test";
import assert from "node:assert/strict";
import { minimumNarrationDurationSeconds, wavDurationSeconds } from "../scripts/ai-studio-headless.mjs";

function pcmWav({ durationSeconds, sampleRate = 24_000, channels = 1, bitsPerSample = 16 }) {
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = Math.round(durationSeconds * sampleRate * channels * bytesPerSample);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test("mede fisicamente a duração de WAV PCM capturado do Google Vids", () => {
  assert.equal(wavDurationSeconds(pcmWav({ durationSeconds: 62 })), 62);
  assert.equal(wavDurationSeconds(Buffer.from("nao-e-wav")), null);
});

test("rejeita fragmento curto como narração de roteiro longo", () => {
  const minimum = minimumNarrationDurationSeconds(133);
  assert.ok(minimum > 24 && minimum < 25);
  assert.ok(wavDurationSeconds(pcmWav({ durationSeconds: 2.32 })) < minimum);
  assert.ok(wavDurationSeconds(pcmWav({ durationSeconds: 58 })) >= minimum);
});
