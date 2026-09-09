import { spawn } from "node:child_process";
import { measureExecutionPhase } from "./execution-timing.mjs";

export function runCommand(command, args, { input = null, maxOutputBytes = 4 * 1024 * 1024 } = {}) {
  return measureExecutionPhase("local-process", () => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxOutputBytes) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxOutputBytes) child.kill();
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      if (status === 0) resolve({ stdout, stderr, status: 0 });
      else reject(new Error(`${command} falhou (${status ?? signal ?? "desconhecido"}): ${stderr.trim() || stdout.trim()}`));
    });
    if (input != null) child.stdin.end(input);
  }));
}

export async function probeMedia(file) {
  const { stdout } = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,format_name,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,pix_fmt,color_range,color_space,color_transfer,color_primaries",
    "-of", "json",
    file,
  ]);
  const payload = JSON.parse(stdout);
  const duration = Number(payload?.format?.duration);
  return {
    ...payload,
    duration: Number.isFinite(duration) ? duration : null,
    video: payload?.streams?.find((stream) => stream.codec_type === "video") ?? null,
    audio: payload?.streams?.find((stream) => stream.codec_type === "audio") ?? null,
  };
}

export async function runFfmpeg(args) {
  return runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
}
