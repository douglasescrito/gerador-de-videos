import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { outputAudioFromInteraction } from "./gemini-interactions.mjs";
import { createStageReceipt, writeFileAtomic, writeStageReceipt } from "./pipeline-operation.mjs";

export const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const TTS_FALLBACK_MODELS = Object.freeze(["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]);
export const TTS_VOICES = Object.freeze(["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"]);

function sampleRateFromMime(mimeType) {
  const match = /(?:rate|sample_rate)=(\d+)/i.exec(String(mimeType ?? ""));
  return match ? Number(match[1]) : 24_000;
}

function wavFromPcm(pcm, sampleRate, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function speechConfig({ voice, speakers }) {
  if (speakers?.length) {
    if (speakers.length > 2) throw new Error("Gemini TTS aceita no máximo dois speakers.");
    return speakers.map((speaker, index) => {
      const name = String(speaker?.speaker ?? "").trim();
      const selectedVoice = String(speaker?.voice ?? "").trim();
      if (!name || !selectedVoice) throw new Error(`Speaker ${index + 1} exige speaker e voice.`);
      return { speaker: name, voice: selectedVoice };
    });
  }
  return [{ voice: String(voice ?? "Charon") }];
}

export async function generateTts({
  text,
  outputFile,
  receiptFile = `${outputFile}.receipt.json`,
  voice = "Charon",
  speakers = null,
  readingDirection = null,
  model = DEFAULT_TTS_MODEL,
  fallbackModels = [],
  client = null,
  timeoutMs = 300_000,
  parentReceipts = [],
  metadata = {},
} = {}) {
  const literalText = String(text ?? "").trim();
  if (!literalText) throw new Error("Texto TTS é obrigatório.");
  if (!client?.create) throw new Error("TTS produtivo exige o adapter cookie-only do CLI; GEMINI_API_KEY não é suportada.");
  const models = [...new Set([model, ...(fallbackModels ?? [])].map((value) => String(value).trim()).filter(Boolean))];
  const prompt = readingDirection ? `${String(readingDirection).trim()}\n\n${literalText}` : literalText;
  const config = speechConfig({ voice, speakers });
  const attempts = [];
  const startedAt = new Date();
  let selected = null;
  for (const candidate of models) {
    try {
      const payload = await client.create({
        model: candidate,
        input: prompt,
        responseFormat: { type: "audio" },
        generationConfig: { speech_config: config },
        timeoutMs,
      });
      const audio = outputAudioFromInteraction(payload);
      if (!audio?.data) throw new Error(`Modelo ${candidate} não retornou output_audio.`);
      attempts.push({ model: candidate, status: "completed" });
      selected = { model: candidate, audio, interactionId: payload.id ?? null };
      break;
    } catch (error) {
      attempts.push({ model: candidate, status: "failed", httpStatus: error?.status ?? null, code: error?.code ?? null, message: error?.message ?? String(error) });
    }
  }
  if (!selected) {
    const error = new Error(`Nenhum modelo TTS concluiu: ${attempts.map((attempt) => `${attempt.model}: ${attempt.message}`).join(" | ")}`);
    error.attempts = attempts;
    throw error;
  }
  const raw = Buffer.from(selected.audio.data, "base64");
  if (!raw.length) throw new Error("Gemini TTS retornou áudio vazio.");
  const sampleRate = sampleRateFromMime(selected.audio.mimeType);
  const wav = raw.subarray(0, 4).toString("ascii") === "RIFF" ? raw : wavFromPcm(raw, sampleRate);
  const target = path.resolve(String(outputFile));
  await writeFileAtomic(target, wav, { label: "Narração TTS" });
  const artifact = await createArtifactFromFile({ file: target, kind: "audio", role: "tts-voice", source: { provider: "gemini-interactions", model: selected.model } });
  const durationSeconds = raw.subarray(0, 4).toString("ascii") === "RIFF" ? null : raw.length / (sampleRate * 2);
  const receipt = createStageReceipt({
    operation: "generate-tts",
    provider: "gemini-interactions",
    model: selected.model,
    mode: "studio",
    stage: "tts",
    prompt: literalText,
    parameters: { voice: speakers?.length ? null : voice, speakers: speakers ?? null, readingDirection, sampleRate, timeoutMs },
    artifacts: [artifact],
    providerResponse: { interactionId: selected.interactionId, attempts },
    metadata: { ...structuredClone(metadata ?? {}), durationSeconds },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  return { file: target, receiptFile: path.resolve(receiptFile), receipt, model: selected.model, attempts, sampleRate, durationSeconds };
}
