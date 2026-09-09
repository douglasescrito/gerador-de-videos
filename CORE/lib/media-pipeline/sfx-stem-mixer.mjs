import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

// Diretório padrão para efeitos sonoros
const DEFAULT_SFX_DIR = path.resolve(import.meta.dirname, "..", "..", "assets", "sfx");

/**
 * Mistura todos os efeitos sonoros em um único arquivo de áudio silenciado com as posições temporais sincronizadas.
 * @param {Object} options Parâmetros de mixagem
 * @param {Array<{startMs: number, type: string}>} options.triggers Gatilhos de efeitos sonoros
 * @param {string} [options.sfxDir] Diretório de efeitos sonoros
 * @param {number} options.totalDurationMs Duração total do áudio em milissegundos
 * @param {string} options.outputFile Caminho de saída do áudio
 * @param {string} [options.receiptFile] Caminho de saída para o recibo da mixagem (opcional)
 * @returns {Promise<Object>} Resumo da mixagem de efeitos
 */
export async function mixSfxStem({ triggers, sfxDir = null, totalDurationMs, outputFile, receiptFile = null } = {}) {
  if (!Array.isArray(triggers)) throw new Error("A lista de gatilhos (triggers) deve ser um array.");
  if (typeof totalDurationMs !== "number" || totalDurationMs <= 0) throw new Error("A duração total deve ser um número positivo.");
  if (!outputFile) throw new Error("O arquivo de saída não foi especificado.");

  const dir = sfxDir || DEFAULT_SFX_DIR;
  const stems = [];
  
  // Validar e preparar os caminhos para cada arquivo SFX
  for (const trigger of triggers) {
    const fileName = `${trigger.type.toLowerCase()}.wav`;
    const filePath = path.join(dir, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Arquivo do efeito sonoro não encontrado: ${filePath}`);
    }
    
    stems.push({
      type: trigger.type,
      startMs: trigger.startMs,
      file: filePath,
      fileName
    });
  }
  
  // Caso não existam gatilhos, gerar apenas um áudio com silêncio puro
  if (stems.length === 0) {
    await runFfmpegCommand([
      "-y",
      "-f", "lavfi",
      "-t", String(totalDurationMs / 1000),
      "-i", "anullsrc=r=44100:cl=stereo",
      "-c:a", "pcm_s16le",
      outputFile
    ]);
    
    const result = {
      outputFile,
      triggerCount: 0,
      totalDurationMs,
      stems: []
    };

    if (receiptFile) {
      await fs.writeFile(receiptFile, JSON.stringify(result, null, 2), "utf-8");
    }

    return result;
  }

  const args = ["-y"];
  
  // Entrada 0: Silêncio gerado nativamente pelo FFmpeg
  args.push("-f", "lavfi", "-t", String(totalDurationMs / 1000), "-i", "anullsrc=r=44100:cl=stereo");
  
  // Entradas 1..N: Arquivos individuais de efeitos sonoros
  for (const stem of stems) {
    args.push("-i", stem.file);
  }
  
  // Configurar o filtergraph com adelay para cada efeito e amix para misturá-los
  let filtergraph = "";
  for (let i = 0; i < stems.length; i++) {
    const startMs = stems[i].startMs;
    // O índice i + 1 indica a entrada do arquivo SFX no FFmpeg (a entrada 0 é o silêncio)
    filtergraph += `[${i + 1}:a]adelay=${Math.round(startMs)}|${Math.round(startMs)}[sfx${i}];`;
  }
  
  // Juntar as saídas de silêncio (0) e dos SFXs em um único amix
  const amixInputs = `[0:a]` + stems.map((_, i) => `[sfx${i}]`).join("");
  const totalInputs = stems.length + 1;
  filtergraph += `${amixInputs}amix=inputs=${totalInputs}:duration=first:dropout_transition=0:normalize=0[out]`;
  
  args.push("-filter_complex", filtergraph);
  args.push("-map", "[out]");
  args.push("-c:a", "pcm_s16le");
  args.push(outputFile);
  
  await runFfmpegCommand(args);
  
  const result = {
    outputFile,
    triggerCount: stems.length,
    totalDurationMs,
    stems: stems.map(s => ({ type: s.type, startMs: s.startMs, file: s.fileName }))
  };
  
  if (receiptFile) {
    await fs.writeFile(receiptFile, JSON.stringify(result, null, 2), "utf-8");
  }
  
  return result;
}

/**
 * Função utilitária para rodar o comando FFmpeg gerando uma promise
 * @param {string[]} args Array de argumentos
 */
function runFfmpegCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", (err) => reject(new Error(`Falha ao invocar o processo FFmpeg: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`O FFmpeg finalizou com código de erro ${code}. ${stderr.trim()}`));
    });
  });
}
