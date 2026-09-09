import assert from "node:assert/strict";
import test from "node:test";
import { DELIVERY_PROFILES } from "../lib/media-pipeline/delivery-profile.mjs";
import {
  assertDeliveryIntegrity,
  compareDeliveryProbes,
  evaluateEncoderPromotion,
  probeVideoEncoders,
  resolveVideoEncoder,
} from "../lib/media-pipeline/encoder-capabilities.mjs";

const ENCODERS_OUTPUT = [
  "Encoders:",
  " V..... libx264              libx264 H.264 / AVC",
  " V....D h264_nvenc           NVIDIA NVENC H.264 encoder",
  " V....D hevc_nvenc           NVIDIA NVENC hevc encoder",
  " A..... aac                  AAC (Advanced Audio Coding)",
].join("\n");

const withNvenc = { nvenc: { h264: true, hevc: true } };
const withoutNvenc = { nvenc: { h264: false, hevc: false } };

const probeOf = ({ duration = 30, width = 1920, height = 1080, fps = "30/1", audio = true, size = 10_000_000 } = {}) => ({
  duration,
  format: { size },
  video: { width, height, r_frame_rate: fps },
  audio: audio ? { sample_rate: 48_000, channels: 2 } : null,
});

test("a sonda lê os encoders do ffmpeg local", async () => {
  const capabilities = await probeVideoEncoders({ runCommandImpl: async () => ({ stdout: ENCODERS_OUTPUT }) });
  assert.equal(capabilities.available, true);
  assert.equal(capabilities.nvenc.h264, true);
  assert.ok(capabilities.encoders.includes("libx264"));

  const missing = await probeVideoEncoders({ runCommandImpl: async () => { throw new Error("ffmpeg não encontrado"); } });
  assert.equal(missing.available, false);
  assert.equal(missing.nvenc.h264, false);
});

test("stream-copy continua sendo copy: não existe acelerar o que não reencoda", () => {
  const encoder = resolveVideoEncoder({ profile: DELIVERY_PROFILES["archive-original"], accel: "nvenc", capabilities: withNvenc });
  assert.equal(encoder.encoder, "copy");
  assert.equal(encoder.reason, "stream-copy");
  assert.deepEqual(encoder.args, ["-c:v", "copy"]);
});

test("cpu mantém crf/preset e nvenc traduz para cq/preset p", () => {
  const cpu = resolveVideoEncoder({ profile: DELIVERY_PROFILES["web-1080p"], accel: "cpu", capabilities: withNvenc });
  assert.deepEqual(cpu.args, ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]);

  const nvenc = resolveVideoEncoder({ profile: DELIVERY_PROFILES["web-1080p"], accel: "nvenc", capabilities: withNvenc });
  assert.equal(nvenc.encoder, "h264_nvenc");
  assert.ok(nvenc.args.includes("-cq"));
  assert.equal(nvenc.args[nvenc.args.indexOf("-cq") + 1], "18");
  assert.equal(nvenc.args[nvenc.args.indexOf("-preset") + 1], "p5");
  assert.deepEqual(nvenc.mappedFrom, { crf: 18, preset: "medium" });
});

test("nvenc exigido e ausente é erro; auto cai para CPU dizendo o motivo", () => {
  assert.throws(
    () => resolveVideoEncoder({ profile: DELIVERY_PROFILES["web-1080p"], accel: "nvenc", capabilities: withoutNvenc }),
    /NVENC exigido/,
  );
  const auto = resolveVideoEncoder({ profile: DELIVERY_PROFILES["web-1080p"], accel: "auto", capabilities: withoutNvenc });
  assert.equal(auto.accel, "cpu");
  assert.equal(auto.reason, "auto-cpu-fallback");
  assert.equal(auto.fallback, true);
  assert.throws(() => resolveVideoEncoder({ profile: DELIVERY_PROFILES["web-1080p"], accel: "gpu" }), /Modo de aceleração inválido/);
});

test("a entrega precisa continuar sendo a mesma peça", () => {
  const before = probeOf();
  assert.equal(compareDeliveryProbes(before, probeOf()).status, "pass");

  const shortened = compareDeliveryProbes(before, probeOf({ duration: 29.5 }));
  assert.equal(shortened.status, "blocked");
  assert.equal(shortened.findings[0].code, "duration_drift");

  const mute = compareDeliveryProbes(before, probeOf({ audio: false }));
  assert.equal(mute.findings.some((finding) => finding.code === "audio_stream_lost"), true);

  const resampled = compareDeliveryProbes(before, probeOf({ fps: "25/1" }));
  assert.equal(resampled.findings.some((finding) => finding.code === "fps_changed"), true);

  // Perfil que redimensiona de propósito não é tratado como regressão.
  const resized = compareDeliveryProbes(before, probeOf({ width: 1080, height: 1920 }), { expectResize: true });
  assert.equal(resized.status, "pass");
  assert.throws(() => assertDeliveryIntegrity(before, probeOf({ duration: 25 })), /não preservou o master/);
});

test("NVENC só é promovido se entregar a mesma peça — velocidade não basta", () => {
  const reference = { probe: probeOf(), elapsedMs: 129_000, encoder: "libx264" };

  const good = evaluateEncoderPromotion({
    reference,
    candidate: { probe: probeOf({ size: 11_000_000 }), elapsedMs: 31_000, encoder: "h264_nvenc" },
  });
  assert.equal(good.verdict, "accepted");
  assert.ok(good.speedup > 4);
  assert.equal(good.policy.autoPromote, false);

  const drifted = evaluateEncoderPromotion({
    reference,
    candidate: { probe: probeOf({ duration: 29.2 }), elapsedMs: 20_000 },
  });
  assert.equal(drifted.verdict, "rejected");
  assert.equal(drifted.findings.some((finding) => finding.code === "duration_diverged"), true);

  const bloated = evaluateEncoderPromotion({
    reference,
    candidate: { probe: probeOf({ size: 40_000_000 }), elapsedMs: 15_000 },
  });
  assert.equal(bloated.verdict, "rejected");
  assert.equal(bloated.findings.some((finding) => finding.code === "bitrate_inflated"), true);
});
