import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { alignNarrationBlocks } from "../../lib/media-pipeline/narration-align.mjs";
import { replayMultiVoiceNarration } from "../../lib/media-pipeline/multi-voice-narration.mjs";
import { writeJsonAtomic } from "../../lib/media-pipeline/pipeline-operation.mjs";

async function requireAbsent(file) {
  try { await lstat(file); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Saída já existe; escolha um destino novo: ${file}`);
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} falhou (${code}): ${stderr.trim()}`)));
  });
}

async function concatSegments({ inputs, outputFile }) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(outputFile), "multi-voice-concat-"));
  try {
    const listFile = path.join(temporary, "inputs.ffconcat");
    const rows = ["ffconcat version 1.0", ...inputs.map((file) => {
      const normalized = path.resolve(file).replaceAll("\\", "/");
      if (/[\r\n]/u.test(normalized)) throw new Error("Caminho de áudio contém quebra de linha.");
      return `file '${normalized.replaceAll("'", "'\\''")}'`;
    })];
    await writeFile(listFile, `${rows.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", outputFile]);
  } finally {
    // Only the freshly created directory above contains temporary list data.
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function finalizeMultiVoiceProof({ planFile, outFile, alignImpl = alignNarrationBlocks } = {}) {
  if (!planFile || !outFile) throw new Error("Informe o plano e o relatório de saída.");
  planFile = path.resolve(planFile);
  outFile = path.resolve(outFile);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  const destinations = [outFile, plan.masterFile, plan.alignmentFile].map((file) => path.resolve(file));
  const key = (file) => process.platform === "win32" ? file.toLowerCase() : file;
  if (new Set(destinations.map(key)).size !== destinations.length) throw new Error("Master, palavras e relatório exigem destinos distintos.");
  for (const file of destinations) await requireAbsent(file);

  async function alignMaster({ audioFile, blocks, outputFile }) {
    await mkdir(path.dirname(outFile), { recursive: true });
    const workDir = await mkdtemp(path.join(path.dirname(outFile), "multi-voice-alignment-"));
    const result = await alignImpl({
      blocks: [{ id: "global-master", text: blocks.map((block) => block.text).join(" "), audioFile }],
      outDir: workDir,
      masterFile: audioFile,
      wordsFile: outputFile,
      preserveSingleAudioMaster: true,
      whisperModel: "small",
      whisperDevice: "auto",
      language: "pt",
    });
    if (result.status !== "pass") throw new Error(`Alinhamento multi-voz não aprovado: ${result.status}. Diagnóstico preservado em ${workDir}`);
    return {
      schema: "mkt-videos/multi-voice-global-alignment@1",
      status: result.status,
      duration: result.duration,
      wordCount: result.wordCount,
      wordsFile: result.wordsFile,
      receiptFile: result.receiptFile,
      whisper: result.whisper,
    };
    }
  
  const segmentArtifacts = await Promise.all(plan.segments.map(async (segment) => ({
    segmentId: segment.id,
    file: segment.outputFile,
    receiptFile: segment.receiptFile,
    sha256: createHash("sha256").update(await readFile(segment.outputFile)).digest("hex"),
  })));
  const replay = await replayMultiVoiceNarration({ plan, segmentArtifacts, concatSegments, alignMaster });
  await writeJsonAtomic(outFile, replay, { label: "Replay live multi-voz" });
    return { outFile, replayHash: replay.replayHash, segments: replay.segmentArtifacts.length, status: replay.status, providerCalls: 0 };
  }
  
  if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
      console.log("Uso: node scripts/estudos/finalize-live-multi-voice-proof.mjs plano.json relatorio.json\nUsa WAVs e recibos já existentes; concatena com FFmpeg e mede palavras no master com Whisper local. Não gera voz nem chama provedores. Exige destinos novos e preserva diagnósticos de falha.");
    } else {
      if (args.length !== 2 || args.some((arg) => arg.startsWith("--"))) throw new Error("Informe exatamente plano.json e relatorio.json; consulte --help.");
      console.log(JSON.stringify(await finalizeMultiVoiceProof({ planFile: args[0], outFile: args[1] }), null, 2));
    }
  }
