import { spawn } from 'node:child_process';
import path from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { createArtifactFromFile, createStageReceipt, writeStageReceipt } from './index.mjs';
import { assertPathAvailable, requireStudioMode } from './pipeline-operation.mjs';

const SFX_LIBRARY_DIR = path.resolve(import.meta.dirname, "../../assets/sfx");

export async function compileSfxBed(cueSheet, options) {
  requireStudioMode(options.mode ?? 'studio', 'SFX');
  const durationMs = cueSheet.totalDurationMs;
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("totalDurationMs deve ser um número positivo finito");
  
  const cues = cueSheet.cues || [];
  if (!Array.isArray(cues)) throw new Error('cues deve ser uma lista');
  for (const cue of cues) {
    if (!cue || !/^[a-zA-Z0-9_-]+$/.test(cue.sound ?? '')) throw new Error('sound deve identificar um efeito da biblioteca local');
    if (!Number.isFinite(cue.atMs) || cue.atMs < 0 || cue.atMs >= durationMs) throw new Error('atMs deve estar dentro da duração declarada');
    if (cue.gain != null && (!Number.isFinite(cue.gain) || cue.gain < 0)) throw new Error('gain deve ser um número finito não negativo');
  }
  const outFile = path.resolve(options.out);
  const receiptFile = path.resolve(options.receipt || `${outFile}.receipt.json`);
  const comparable = file => process.platform === 'win32' ? file.toLowerCase() : file;
  if (comparable(outFile) === comparable(receiptFile)) throw new Error('Áudio e recibo exigem destinos distintos');
  await assertPathAvailable(outFile, 'Áudio SFX');
  await assertPathAvailable(receiptFile, 'Recibo SFX');
  
  await mkdir(path.dirname(outFile), { recursive: true });

  const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-n"];
  
  if (cues.length === 0) {
    ffmpegArgs.push(
      "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`,
      "-t", String(durationMs / 1000),
      outFile
    );
  } else {
    const uniqueSounds = [...new Set(cues.map(c => c.sound))];
    const soundInputs = {};
    
    for (let i = 0; i < uniqueSounds.length; i++) {
      const s = uniqueSounds[i];
      const p = path.join(SFX_LIBRARY_DIR, `${s}.wav`);
      await access(p); 
      ffmpegArgs.push("-i", p);
      soundInputs[s] = i;
    }
    
    const filterParts = [];
    
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const inputIdx = soundInputs[cue.sound];
      const delayMs = cue.atMs;
      const gain = cue.gain ?? 1.0;
      
      filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${gain}[a${i}]`);
    }
    
    ffmpegArgs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${durationMs / 1000}`);
    const silenceIdx = uniqueSounds.length;
    
    const mixInputs = cues.map((_, i) => `[a${i}]`).join('') + `[${silenceIdx}:a]`;
    const numInputs = cues.length + 1;
    const durationSeconds = durationMs / 1000;
    filterParts.push(`${mixInputs}amix=inputs=${numInputs}:duration=longest:normalize=0[mixed]`);
    filterParts.push(`[mixed]atrim=0:${durationSeconds.toFixed(6)},apad=whole_dur=${durationSeconds.toFixed(6)},asetpts=N/SR/TB[out]`);
    
    ffmpegArgs.push("-filter_complex", filterParts.join(";"));
    ffmpegArgs.push("-map", "[out]");
    ffmpegArgs.push("-t", String(durationMs / 1000));
    ffmpegArgs.push("-ar", "48000", "-ac", "2");
    ffmpegArgs.push(outFile);
  }
  
  const startedAt = new Date();
  
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegArgs, { stdio: "pipe", windowsHide: true });
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg falhou (${code}): ${stderr.trim()}`));
    });
    child.on("error", reject);
  });
  
  const outputArtifact = await createArtifactFromFile({ file: outFile, kind: "audio", role: "sfx-bed", source: { provider: "ffmpeg-lavfi" } });
  
  const receipt = createStageReceipt({
    operation: "sfx-bed",
    provider: "ffmpeg-lavfi",
    mode: options.mode ?? "studio",
    stage: "audio-sfx",
    parameters: { durationMs, cues: cues.length },
    inputs: [], // Could list the cue sheet here if we wanted
    artifacts: [outputArtifact],
    metadata: {
      cueSheetFingerprint: cueSheet.alignmentFingerprint,
      ffmpegArgs
    },
    parentReceipts: [],
    startedAt,
    completedAt: new Date(),
  });
  
  await writeStageReceipt(receiptFile, receipt);
  
  return { file: outFile, receiptFile: path.resolve(receiptFile), receipt, args: ffmpegArgs };
}
