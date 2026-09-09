// Dois motores de medição de tempo, um formato só.
//
// `openai-whisper` é a referência: é ele que produziu os alinhamentos já
// aprovados, e continua sendo o juiz. `faster-whisper` (CTranslate2) é o
// candidato — pode evitar o caminho lento de DTW observado no benchmark, mas só
// entra em produção depois de provar equivalência bloco a bloco.
//
// O candidato roda em ambiente isolado por construção: o interpretador precisa
// ser informado (opção ou FASTER_WHISPER_PYTHON). Nunca se assume o mesmo python
// do Whisper oficial, porque uma instalação estragando a outra é exatamente o
// risco que a separação existe para evitar.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./media-tools.mjs";
import { resolveWhisperRuntime, whisperDeviceArgs } from "./whisper-runtime.mjs";

export const WHISPER_BACKENDS = Object.freeze(["openai-whisper", "faster-whisper"]);
export const DEFAULT_WHISPER_BACKEND = "openai-whisper";

const FASTER_WHISPER_DRIVER = path.resolve(import.meta.dirname, "..", "..", "scripts", "faster-whisper-words.py");

/** Achata o JSON do Whisper (segments -> words) no formato usado pelo alinhamento. */
export function normalizeWhisperPayload(payload) {
  const words = (payload?.segments ?? []).flatMap((segment) => segment?.words ?? []);
  return { words, transcript: String(payload?.text ?? "").trim() };
}

async function runOpenAiWhisper({ source, output, model, language, device, fp16, command, env = process.env, runCommandImpl }) {
  const runtime = await resolveWhisperRuntime({ command });
  try {
    await runCommandImpl(runtime.command, [
      source,
      "--model", model,
      "--language", language,
      "--word_timestamps", "True",
      "--output_format", "json",
      "--output_dir", output,
      "--verbose", "False",
      ...whisperDeviceArgs({ device, fp16 }),
    ], {
      env: { ...process.env, ...env, PYTHONIOENCODING: "utf-8" },
      maxOutputBytes: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Whisper falhou em ${path.basename(source)}: ${error.message}. `
      + 'Instale com "pip install -U openai-whisper" ou informe --whisper-command.',
    );
  }
  return {
    jsonFile: path.join(output, `${path.parse(source).name}.json`),
    runtime: { command: runtime.command, source: runtime.source },
  };
}

async function runFasterWhisper({ source, output, model, language, device, fp16, pythonCommand, env, runCommandImpl }) {
  const python = String(pythonCommand ?? env.FASTER_WHISPER_PYTHON ?? "").trim();
  if (!python) {
    throw new Error(
      "O backend faster-whisper exige um interpretador isolado: informe --faster-whisper-python ou FASTER_WHISPER_PYTHON. "
      + "Não se reaproveita o ambiente do Whisper oficial, que é a referência de validação.",
    );
  }
  const jsonFile = path.join(output, `${path.parse(source).name}.faster.json`);
  try {
    await runCommandImpl(python, [
      FASTER_WHISPER_DRIVER,
      "--audio", source,
      "--out", jsonFile,
      "--model", model,
      "--language", language,
      "--device", device,
      "--compute-type", device === "cuda" && fp16 ? "float16" : "float32",
    ], { maxOutputBytes: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(
      `faster-whisper falhou em ${path.basename(source)}: ${error.message}. `
      + 'Instale no ambiente isolado com "pip install faster-whisper".',
    );
  }
  return { jsonFile, runtime: { command: python, source: "faster-whisper-python" } };
}

/**
 * Executa um backend e devolve sempre a mesma forma. Sem fallback silencioso
 * entre motores: quem pediu faster-whisper e não o tem recebe erro, não uma
 * medição feita por outro programa.
 */
export async function runWhisperBackend({
  backend = DEFAULT_WHISPER_BACKEND,
  audioFile,
  workDir,
  model,
  language,
  device = "cpu",
  fp16 = false,
  command = "whisper",
  pythonCommand = null,
  env = process.env,
  runCommandImpl = runCommand,
} = {}) {
  const chosen = String(backend ?? DEFAULT_WHISPER_BACKEND);
  if (!WHISPER_BACKENDS.includes(chosen)) {
    throw new Error(`Backend de Whisper desconhecido: ${chosen}. Use ${WHISPER_BACKENDS.join(", ")}.`);
  }
  const source = path.resolve(audioFile);
  const output = path.resolve(workDir);
  await mkdir(output, { recursive: true });

  const executed = chosen === "faster-whisper"
    ? await runFasterWhisper({ source, output, model, language, device, fp16, pythonCommand, env, runCommandImpl })
    : await runOpenAiWhisper({ source, output, model, language, device, fp16, command, runCommandImpl });

  const payload = JSON.parse(await readFile(executed.jsonFile, "utf8"));
  const { words, transcript } = normalizeWhisperPayload(payload);
  if (!words.length) throw new Error(`${chosen} não produziu palavras para ${path.basename(source)}.`);
  return { backend: chosen, words, transcript, jsonFile: executed.jsonFile, model, language, device, fp16, runtime: executed.runtime };
}
