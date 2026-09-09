// Aceleração de hardware como candidata, não como padrão.
//
// A RTX pode encodar o perfil de entrega muito mais rápido que a CPU, mas o
// master é o que o cliente recebe: velocidade só vale se a peça sair com a mesma
// duração, a mesma resolução, o mesmo fps e o mesmo áudio. Este módulo sonda o
// que o ffmpeg local sabe fazer, traduz o perfil para o encoder escolhido e
// oferece o comparador que decide se o candidato pode ser promovido.
//
// Duas regras que não mudam:
//  - stream-copy continua sendo o melhor caminho quando é possível: não
//    reencodar é sempre mais rápido e mais fiel que reencodar depressa;
//  - promoção é decisão humana sobre uma comparação medida, nunca automática.

import { runCommand } from "./media-tools.mjs";

export const ENCODER_CAPABILITIES_SCHEMA = "mkt-videos/encoder-capabilities@1";
export const ENCODER_PROMOTION_SCHEMA = "mkt-videos/encoder-promotion@1";

export const VIDEO_ACCEL_MODES = Object.freeze(["cpu", "nvenc", "auto"]);

// CRF (qualidade constante da CPU) e CQ (do NVENC) não são a mesma escala, mas
// nesta faixa produzem peças equivalentes para entrega web. O gate confere.
const NVENC_PRESET_BY_X264_PRESET = Object.freeze({
  ultrafast: "p1",
  superfast: "p1",
  veryfast: "p2",
  faster: "p3",
  fast: "p4",
  medium: "p5",
  slow: "p6",
  slower: "p7",
  veryslow: "p7",
});

export const PROMOTION_TOLERANCES = Object.freeze({
  durationSeconds: 0.05,
  sizeRatio: 1.6,
  fpsExact: true,
});

export async function probeVideoEncoders({ runCommandImpl = runCommand } = {}) {
  try {
    const { stdout } = await runCommandImpl("ffmpeg", ["-hide_banner", "-encoders"], { maxOutputBytes: 2 * 1024 * 1024 });
    const encoders = new Set(
      [...String(stdout).matchAll(/^\s*[A-Z.]{6}\s+(\S+)/gm)].map((match) => match[1]).filter((name) => name !== "="),
    );
    return {
      schema: ENCODER_CAPABILITIES_SCHEMA,
      available: true,
      encoders: [...encoders].sort(),
      nvenc: { h264: encoders.has("h264_nvenc"), hevc: encoders.has("hevc_nvenc") },
      error: null,
    };
  } catch (error) {
    return {
      schema: ENCODER_CAPABILITIES_SCHEMA,
      available: false,
      encoders: [],
      nvenc: { h264: false, hevc: false },
      error: String(error?.message ?? error),
    };
  }
}

/**
 * Traduz o perfil de entrega para o encoder pedido.
 * `auto` usa NVENC quando existe; `nvenc` exigido e ausente é erro explícito.
 */
export function resolveVideoEncoder({ profile, accel = "cpu", capabilities = null } = {}) {
  const mode = String(accel ?? "cpu").trim().toLowerCase();
  if (!VIDEO_ACCEL_MODES.includes(mode)) {
    throw new Error(`Modo de aceleração inválido: ${accel}. Use ${VIDEO_ACCEL_MODES.join(", ")}.`);
  }
  if (!profile?.videoCodec) throw new Error("Perfil de entrega sem videoCodec.");

  // Cópia de stream não passa por encoder nenhum: acelerar aqui não existe.
  if (profile.videoCodec === "copy") {
    return { accel: "none", encoder: "copy", args: ["-c:v", "copy"], reason: "stream-copy", fallback: false };
  }

  const hasNvenc = Boolean(capabilities?.nvenc?.h264);
  if (mode === "nvenc" && !hasNvenc) {
    throw new Error(
      "NVENC exigido, mas o ffmpeg local não expõe h264_nvenc. "
      + "Rode com --accel cpu ou instale um ffmpeg com suporte a NVENC.",
    );
  }
  if (mode === "cpu" || (mode === "auto" && !hasNvenc)) {
    return {
      accel: "cpu",
      encoder: profile.videoCodec,
      args: ["-c:v", profile.videoCodec, "-crf", String(profile.crf), "-preset", String(profile.preset)],
      reason: mode === "auto" ? "auto-cpu-fallback" : "requested-cpu",
      fallback: mode === "auto",
    };
  }
  const preset = NVENC_PRESET_BY_X264_PRESET[String(profile.preset)] ?? "p5";
  return {
    accel: "nvenc",
    encoder: "h264_nvenc",
    args: ["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", String(profile.crf), "-b:v", "0", "-preset", preset, "-tune", "hq"],
    reason: mode === "auto" ? "auto-nvenc" : "requested-nvenc",
    fallback: false,
    mappedFrom: { crf: profile.crf, preset: profile.preset },
  };
}

function frameRate(stream) {
  const raw = String(stream?.r_frame_rate ?? "");
  const [numerator, denominator] = raw.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * Compara o que entrou com o que saiu. Não julga estética: julga se a peça
 * continua sendo a mesma peça.
 */
export function compareDeliveryProbes(before, after, { tolerances = PROMOTION_TOLERANCES, expectResize = false } = {}) {
  const findings = [];
  if (!after?.video) findings.push({ code: "video_stream_missing", severity: "block" });
  if (before?.audio && !after?.audio) findings.push({ code: "audio_stream_lost", severity: "block" });

  const beforeDuration = Number(before?.duration);
  const afterDuration = Number(after?.duration);
  if (Number.isFinite(beforeDuration) && Number.isFinite(afterDuration)) {
    const delta = Math.abs(afterDuration - beforeDuration);
    if (delta > Number(tolerances.durationSeconds)) {
      findings.push({ code: "duration_drift", severity: "block", deltaSeconds: Math.round(delta * 1000) / 1000, toleranceSeconds: tolerances.durationSeconds });
    }
  } else {
    findings.push({ code: "duration_unreadable", severity: "block" });
  }

  if (!expectResize && before?.video && after?.video) {
    if (Number(before.video.width) !== Number(after.video.width) || Number(before.video.height) !== Number(after.video.height)) {
      findings.push({ code: "resolution_changed", severity: "block", before: `${before.video.width}x${before.video.height}`, after: `${after.video.width}x${after.video.height}` });
    }
  }
  const beforeFps = frameRate(before?.video);
  const afterFps = frameRate(after?.video);
  if (beforeFps != null && afterFps != null && tolerances.fpsExact && beforeFps !== afterFps) {
    findings.push({ code: "fps_changed", severity: "block", before: beforeFps, after: afterFps });
  }
  if (before?.audio && after?.audio) {
    if (Number(before.audio.sample_rate) !== Number(after.audio.sample_rate)) {
      findings.push({ code: "audio_sample_rate_changed", severity: "warn", before: before.audio.sample_rate, after: after.audio.sample_rate });
    }
    if (Number(before.audio.channels) !== Number(after.audio.channels)) {
      findings.push({ code: "audio_channels_changed", severity: "block", before: before.audio.channels, after: after.audio.channels });
    }
  }
  return {
    status: findings.some((finding) => finding.severity === "block") ? "blocked" : findings.length ? "warning" : "pass",
    findings,
    duration: { before: Number.isFinite(beforeDuration) ? beforeDuration : null, after: Number.isFinite(afterDuration) ? afterDuration : null },
    fps: { before: beforeFps, after: afterFps },
  };
}

export function assertDeliveryIntegrity(before, after, options = {}) {
  const comparison = compareDeliveryProbes(before, after, options);
  if (comparison.status === "blocked") {
    const codes = comparison.findings.filter((finding) => finding.severity === "block").map((finding) => finding.code);
    throw new Error(`A entrega não preservou o master: ${codes.join(", ")}.`);
  }
  return comparison;
}

/**
 * Gate de promoção do encoder acelerado. O candidato precisa entregar a mesma
 * peça — duração, resolução, fps, áudio — e não pode inflar o arquivo além da
 * tolerância. Ganho de tempo sozinho nunca promove.
 */
export function evaluateEncoderPromotion({ reference, candidate, tolerances = PROMOTION_TOLERANCES } = {}) {
  if (!reference?.probe || !candidate?.probe) throw new Error("Promoção de encoder exige as duas medições.");
  const findings = [];
  const referenceDuration = Number(reference.probe.duration);
  const candidateDuration = Number(candidate.probe.duration);
  const durationDelta = Math.abs(candidateDuration - referenceDuration);
  if (!(durationDelta <= Number(tolerances.durationSeconds))) {
    findings.push({ code: "duration_diverged", severity: "block", deltaSeconds: Math.round(durationDelta * 1000) / 1000 });
  }
  if (Number(reference.probe.video?.width) !== Number(candidate.probe.video?.width)
    || Number(reference.probe.video?.height) !== Number(candidate.probe.video?.height)) {
    findings.push({ code: "resolution_diverged", severity: "block" });
  }
  const referenceFps = frameRate(reference.probe.video);
  const candidateFps = frameRate(candidate.probe.video);
  if (referenceFps !== candidateFps) findings.push({ code: "fps_diverged", severity: "block", reference: referenceFps, candidate: candidateFps });
  if (Boolean(reference.probe.audio) !== Boolean(candidate.probe.audio)) {
    findings.push({ code: "audio_presence_diverged", severity: "block" });
  }
  const referenceBytes = Number(reference.probe.format?.size ?? reference.bytes ?? 0);
  const candidateBytes = Number(candidate.probe.format?.size ?? candidate.bytes ?? 0);
  const sizeRatio = referenceBytes > 0 ? Math.round((candidateBytes / referenceBytes) * 100) / 100 : null;
  if (sizeRatio != null && sizeRatio > Number(tolerances.sizeRatio)) {
    findings.push({ code: "bitrate_inflated", severity: "block", sizeRatio, tolerance: tolerances.sizeRatio });
  }
  const speedup = Number(reference.elapsedMs) > 0 && Number(candidate.elapsedMs) > 0
    ? Math.round((Number(reference.elapsedMs) / Number(candidate.elapsedMs)) * 100) / 100
    : null;

  return {
    schema: ENCODER_PROMOTION_SCHEMA,
    evaluatedAt: new Date().toISOString(),
    referenceEncoder: reference.encoder ?? "libx264",
    candidateEncoder: candidate.encoder ?? "h264_nvenc",
    verdict: findings.some((finding) => finding.severity === "block") ? "rejected" : "accepted",
    speedup,
    sizeRatio,
    elapsedMs: { reference: reference.elapsedMs ?? null, candidate: candidate.elapsedMs ?? null },
    findings,
    policy: { autoPromote: false, decidedBy: "human" },
  };
}
