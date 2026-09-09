// Cache de medição do Whisper: evidência reaproveitável, não atalho.
//
// A versão anterior guardava só a transcrição, então toda reexecução voltava a
// pagar 60s de GPU para recuperar timestamps que já existiam. Aqui a entrada
// guarda a medição inteira — palavras, tempos, probabilidades — e a chave
// carrega tudo que pode mudar o resultado:
//
//     hash-do-áudio + modelo + idioma + parâmetros + fingerprint-do-runtime
//
// Consequência prática: áudio intocado nunca volta ao Whisper; trocar de modelo
// invalida só o que era incompatível; corrigir o roteiro (que não altera o
// áudio) reaproveita os timestamps já aprovados.
//
// O lock por chave existe porque dois processos medindo o mesmo áudio na mesma
// GPU de 8 GB é o pior dos mundos: dobra o custo e ainda disputa VRAM.

import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";

export const WHISPER_CACHE_ENTRY_SCHEMA = "mkt-videos/whisper-cache-entry@2";
export const LEGACY_WHISPER_CACHE_ENTRY_SCHEMA = "mkt-videos/whisper-cache-entry@1";

// Diretório de cache padrão
const DEFAULT_CACHE_DIR = path.resolve(import.meta.dirname, "..", "..", ".cache", "whisper");
const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Calcula o hash SHA-256 de um arquivo de áudio por streaming.
 * @param {string} filePath Caminho para o arquivo
 * @returns {Promise<string>} Hash no formato "sha256:<hex>"
 */
export async function computeAudioHash(filePath) {
  if (!filePath) throw new Error("Caminho do arquivo não fornecido.");

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("error", (err) => reject(new Error(`Falha ao ler o arquivo para calcular o hash: ${err.message}`)));
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

function stableParameters(parameters) {
  const source = parameters && typeof parameters === "object" && !Array.isArray(parameters) ? parameters : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Chave composta e determinística. Qualquer campo que mude a medição precisa
 * entrar aqui — o que fica de fora vira cache envenenado.
 */
export function whisperCacheKey({ audioHash, model, language, parameters = {}, runtimeFingerprint = "unknown" } = {}) {
  const hash = String(audioHash ?? "").trim();
  if (!hash) throw new Error("Chave de cache exige o hash do áudio.");
  if (!String(model ?? "").trim()) throw new Error("Chave de cache exige o modelo.");
  if (!String(language ?? "").trim()) throw new Error("Chave de cache exige o idioma.");
  const payload = JSON.stringify({
    audioHash: hash,
    model: String(model),
    language: String(language),
    parameters: stableParameters(parameters),
    runtimeFingerprint: String(runtimeFingerprint),
  });
  return `wc2:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

function normalizeWords(words, label) {
  if (!Array.isArray(words) || words.length === 0) throw new Error(`${label}: a medição precisa de ao menos uma palavra.`);
  return words.map((word, index) => {
    const text = String(word?.word ?? word?.text ?? "");
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!text.trim() || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`${label}: palavra ${index + 1} não tem texto ou tempo utilizável.`);
    }
    const probability = word?.probability ?? word?.confidence;
    return {
      word: text,
      start,
      end,
      ...(probability == null ? {} : { probability: Number(probability) }),
    };
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cria a interface do cache de medições do Whisper.
 * @param {Object} options Opções
 * @param {string} [options.cacheDir] Diretório base para o cache
 * @returns {Object} Objeto de controle do cache
 */
export function createWhisperCache({
  cacheDir = null,
  lockStaleMs = DEFAULT_LOCK_STALE_MS,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  pollIntervalMs = 250,
} = {}) {
  const dir = cacheDir || DEFAULT_CACHE_DIR;
  // Fila em memória: dois `resolve` do mesmo processo nunca disputam o lock de
  // disco, apenas esperam um ao outro.
  const inProcess = new Map();

  async function ensureDir() {
    await fs.mkdir(dir, { recursive: true });
  }

  function safeName(key) {
    const value = String(key ?? "");
    if (!value) throw new Error("Chave de cache não fornecida.");
    return value.replace(/[^a-z0-9]/gi, "_").slice(0, 120);
  }

  function getFilePath(key) {
    return path.join(dir, `${safeName(key)}.json`);
  }

  function lockPath(key) {
    return path.join(dir, `${safeName(key)}.lock`);
  }

  async function readEntry(key) {
    try {
      const data = await fs.readFile(getFilePath(key), "utf-8");
      const entry = JSON.parse(data);
      // Entrada da versão 1 guardava só transcrição: não serve para alinhar e é
      // tratada como ausência, nunca como acerto parcial.
      if (entry?.schema !== WHISPER_CACHE_ENTRY_SCHEMA) return null;
      if (!Array.isArray(entry?.measurement?.words) || entry.measurement.words.length === 0) return null;
      return entry;
    } catch (err) {
      if (err.code === "ENOENT") return null;
      if (err instanceof SyntaxError) return null;
      throw new Error(`Falha ao ler do cache de transcrição: ${err.message}`);
    }
  }

  async function writeEntry(key, payload) {
    await ensureDir();
    const words = normalizeWords(payload?.words, "Cache do Whisper");
    const entry = {
      schema: WHISPER_CACHE_ENTRY_SCHEMA,
      key: String(key),
      cachedAt: new Date().toISOString(),
      audio: {
        hash: String(payload?.audioHash ?? ""),
        bytes: payload?.audioBytes == null ? null : Number(payload.audioBytes),
        durationSeconds: payload?.durationSeconds == null ? null : Number(payload.durationSeconds),
      },
      request: {
        model: String(payload?.model ?? ""),
        language: String(payload?.language ?? ""),
        parameters: stableParameters(payload?.parameters),
      },
      runtime: {
        fingerprint: String(payload?.runtimeFingerprint ?? "unknown"),
        backend: payload?.backend == null ? null : String(payload.backend),
        device: payload?.device == null ? null : String(payload.device),
        fp16: payload?.fp16 == null ? null : Boolean(payload.fp16),
        torch: payload?.torch == null ? null : String(payload.torch),
        cudaVersion: payload?.cudaVersion == null ? null : String(payload.cudaVersion),
      },
      measurement: {
        transcript: String(payload?.transcript ?? ""),
        wordCount: words.length,
        firstWordStart: words[0].start,
        lastWordEnd: words.at(-1).end,
        words,
      },
    };
    if (!entry.audio.hash) throw new Error("Cache do Whisper: entrada sem hash do áudio.");

    const filePath = getFilePath(key);
    const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(entry, null, 2), "utf-8");
      await fs.rename(tempPath, filePath); // Escrita atômica para evitar corrupção
    } catch (err) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignorar erro na limpeza do arquivo temporário
      }
      throw new Error(`Falha ao salvar no cache de transcrição: ${err.message}`);
    }
    return entry;
  }

  // Lock de diretório: mkdir é atômico em NTFS e em POSIX. Um lock esquecido por
  // processo morto expira por idade em vez de travar a fábrica para sempre.
  async function acquireLock(key) {
    const target = lockPath(key);
    const deadline = Date.now() + Number(lockTimeoutMs);
    for (;;) {
      try {
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf-8");
        return target;
      } catch (err) {
        if (err.code !== "EEXIST") throw new Error(`Falha ao travar o cache do Whisper: ${err.message}`);
        const age = await fs.stat(target).then((stat) => Date.now() - stat.mtimeMs).catch(() => 0);
        if (age > Number(lockStaleMs)) {
          await fs.rm(target, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(`Cache do Whisper travado há ${Math.round(age / 1000)}s para ${key}; remova ${target} se o processo morreu.`);
        }
        await sleep(pollIntervalMs);
      }
    }
  }

  async function releaseLock(target) {
    await fs.rm(target, { recursive: true, force: true });
  }

  async function withLock(key, work) {
    const previous = inProcess.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => gate, () => gate);
    inProcess.set(key, chained);
    await previous.catch(() => {});
    await ensureDir();
    const lock = await acquireLock(key);
    try {
      return await work();
    } finally {
      await releaseLock(lock);
      release();
      if (inProcess.get(key) === chained) inProcess.delete(key);
    }
  }

  return Object.freeze({
    key: whisperCacheKey,
    directory: dir,

    async get(key) {
      return readEntry(key);
    },

    async set(key, payload) {
      return writeEntry(key, payload);
    },

    async has(key) {
      return (await readEntry(key)) != null;
    },

    withLock,

    /**
     * Caminho único de uso: resolve a chave, segura o lock, reconfere o cache
     * dentro do lock (quem esperou pode ter acabado de gravar) e só então mede.
     * Devolve sempre `{ entry, cache }` para a instrumentação registrar hit/miss.
     */
    async resolve({ descriptor, measure, refresh = false } = {}) {
      if (typeof measure !== "function") throw new Error("resolve() exige a função de medição.");
      const key = whisperCacheKey(descriptor);
      if (!refresh) {
        const early = await readEntry(key);
        if (early) return { key, entry: early, cache: "hit" };
      }
      return withLock(key, async () => {
        if (!refresh) {
          const cached = await readEntry(key);
          if (cached) return { key, entry: cached, cache: "hit" };
        }
        const measured = await measure();
        const entry = await writeEntry(key, {
          ...descriptor,
          ...measured,
          audioHash: descriptor.audioHash,
          model: descriptor.model,
          language: descriptor.language,
          parameters: descriptor.parameters,
          runtimeFingerprint: descriptor.runtimeFingerprint,
        });
        return { key, entry, cache: "miss" };
      });
    },

    async clear() {
      await ensureDir();
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            await fs.unlink(path.join(dir, file));
          } else if (file.endsWith(".lock")) {
            await fs.rm(path.join(dir, file), { recursive: true, force: true });
          }
        }
      } catch (err) {
        throw new Error(`Falha ao limpar cache de transcrição: ${err.message}`);
      }
    },

    async stats() {
      await ensureDir();
      try {
        const files = await fs.readdir(dir);
        let entries = 0;
        let sizeBytes = 0;
        let locks = 0;

        for (const file of files) {
          if (file.endsWith(".json")) {
            const stat = await fs.stat(path.join(dir, file));
            entries++;
            sizeBytes += stat.size;
          } else if (file.endsWith(".lock")) {
            locks++;
          }
        }

        return { entries, sizeBytes, locks, directory: dir };
      } catch (err) {
        throw new Error(`Falha ao calcular as estatísticas do cache: ${err.message}`);
      }
    },
  });
}
