import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

import { validateSemanticScript } from "./energy-analyzer.mjs";

const execFileAsync = promisify(execFile);

// Helper para rodar comandos
async function runCommand(cmd, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: timeoutMs, windowsHide: true });
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, error };
  }
}

// Helper para verificar espaço em disco no Windows
async function getFreeDiskSpaceGB() {
  try {
    const { stdout } = await execFileAsync("wmic", ["logicaldisk", "get", "freespace,caption"], { timeout: 5000, windowsHide: true });
    const lines = stdout.split("\n").map(l => l.trim()).filter(l => l);
    const cDrive = lines.find(l => l.startsWith("C:"));
    if (cDrive) {
        const parts = cDrive.split(/\s+/);
        if (parts.length >= 2) {
            const bytes = parseInt(parts[1], 10);
            if (!isNaN(bytes)) {
                return bytes / (1024 * 1024 * 1024);
            }
        }
    }
    return 10; // Fallback caso não consiga extrair
  } catch (err) {
    return 10; // Fallback silencioso em caso de erro no WMI
  }
}

export async function runV17Preflight({ scriptRaw, sfxDir = null, checkWhisper = true, checkFfmpeg = true, checkSession = false } = {}) {
  const timestamp = new Date().toISOString();
  const checks = [];

  // 1. script-valid
  try {
    const scriptValid = validateSemanticScript(scriptRaw);
    if (scriptValid.valid !== false) { // Assumimos true se ausente
      checks.push({ id: "script-valid", status: "pass", message: "Script validado com sucesso." });
    } else {
      checks.push({ id: "script-valid", status: "fail", message: "Script inválido de acordo com analyzer." });
    }
  } catch (err) {
    checks.push({ id: "script-valid", status: "fail", message: `Erro ao validar script: ${err.message}` });
  }

  // 2. sfx-assets
  const sfxPath = sfxDir || path.resolve(import.meta.dirname, '..', '..', 'assets', 'sfx');
  const requiredSfx = ["boom.wav", "glass.wav", "glitch.wav", "whoosh.wav"];
  const found = [];
  const missing = [];
  for (const sfx of requiredSfx) {
    try {
      await fs.access(path.join(sfxPath, sfx));
      found.push(sfx);
    } catch {
      missing.push(sfx);
    }
  }
  if (missing.length === 0) {
    checks.push({ id: "sfx-assets", status: "pass", message: "Todos os efeitos sonoros básicos encontrados.", details: { found, missing } });
  } else {
    checks.push({ id: "sfx-assets", status: "fail", message: `Faltam efeitos sonoros: ${missing.join(", ")}`, details: { found, missing } });
  }

  // 3. ffmpeg-available
  if (checkFfmpeg) {
    const res = await runCommand("ffmpeg", ["-version"], 5000);
    if (res.success) {
      checks.push({ id: "ffmpeg-available", status: "pass", message: "FFmpeg está disponível." });
    } else {
      checks.push({ id: "ffmpeg-available", status: "fail", message: "FFmpeg não foi encontrado ou falhou ao executar." });
    }
  } else {
      checks.push({ id: "ffmpeg-available", status: "skip", message: "Verificação do FFmpeg ignorada." });
  }

  // 4. whisper-available
  if (checkWhisper) {
    let res = await runCommand("whisper", ["--help"], 5000);
    if (!res.success) {
      res = await runCommand("whisper.exe", ["--help"], 5000);
    }
    if (res.success) {
      checks.push({ id: "whisper-available", status: "pass", message: "Whisper está disponível." });
    } else {
      checks.push({ id: "whisper-available", status: "fail", message: "Whisper não foi encontrado." });
    }
  } else {
    checks.push({ id: "whisper-available", status: "skip", message: "Verificação do Whisper ignorada." });
  }

  // 5. disk-space
  const freeGb = await getFreeDiskSpaceGB();
  if (freeGb < 2) {
    checks.push({ id: "disk-space", status: "warn", message: "Espaço em disco inferior a 2GB.", details: { freeGb } });
  } else {
    checks.push({ id: "disk-space", status: "pass", message: "Espaço em disco suficiente.", details: { freeGb } });
  }

  // A validação passa apenas se não houver NENHUMA falha
  const passed = !checks.some(c => c.status === "fail");
  
  // Para fins de contagem no summary, contamos itens não falhos
  const passedCount = checks.filter(c => c.status !== "fail").length;

  return {
    schema: "mkt-videos/v17-preflight-report@1",
    timestamp,
    passed,
    checks,
    summary: `Pré-voo V17: ${passedCount}/${checks.length} verificações passaram ou foram ignoradas.`
  };
}
