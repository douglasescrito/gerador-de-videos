import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computeAudioHash,
  createWhisperCache,
  whisperCacheKey,
  WHISPER_CACHE_ENTRY_SCHEMA,
} from "../lib/media-pipeline/whisper-cache.mjs";

const descriptor = {
  audioHash: "sha256:aaaa",
  model: "small",
  language: "pt",
  parameters: { wordTimestamps: true, sampleRate: 48_000 },
  runtimeFingerprint: "wrt1:cuda-fp16",
};

const measurement = {
  transcript: "Você não precisa de sorte.",
  words: [
    { word: "Você", start: 0.2, end: 0.6, probability: 0.98 },
    { word: "não", start: 0.6, end: 0.8, probability: 0.97 },
    { word: "sorte.", start: 0.9, end: 1.4, probability: 0.95 },
  ],
};

async function withCache(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "whisper-cache-"));
  try {
    return await work(createWhisperCache({ cacheDir: root }), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a chave combina áudio, modelo, idioma, parâmetros e runtime", () => {
  const base = whisperCacheKey(descriptor);
  assert.match(base, /^wc2:[a-f0-9]{64}$/);
  // Ordem dos parâmetros não pode mudar a chave.
  assert.equal(whisperCacheKey({ ...descriptor, parameters: { sampleRate: 48_000, wordTimestamps: true } }), base);
  // Cada componente invalida, e só ele.
  assert.notEqual(whisperCacheKey({ ...descriptor, model: "large-v3-turbo" }), base);
  assert.notEqual(whisperCacheKey({ ...descriptor, language: "en" }), base);
  assert.notEqual(whisperCacheKey({ ...descriptor, audioHash: "sha256:bbbb" }), base);
  assert.notEqual(whisperCacheKey({ ...descriptor, runtimeFingerprint: "wrt1:cpu" }), base);
  assert.throws(() => whisperCacheKey({ ...descriptor, audioHash: "" }), /hash do áudio/);
});

test("a entrada guarda a medição inteira, não só a transcrição", async () => {
  await withCache(async (cache) => {
    const key = whisperCacheKey(descriptor);
    await cache.set(key, { ...descriptor, ...measurement, backend: "openai-whisper", device: "cuda", fp16: true, torch: "2.5.1" });
    const entry = await cache.get(key);
    assert.equal(entry.schema, WHISPER_CACHE_ENTRY_SCHEMA);
    assert.equal(entry.measurement.wordCount, 3);
    assert.equal(entry.measurement.words[0].probability, 0.98);
    assert.equal(entry.measurement.firstWordStart, 0.2);
    assert.equal(entry.measurement.lastWordEnd, 1.4);
    assert.equal(entry.runtime.device, "cuda");
    assert.equal(entry.request.model, "small");
    assert.equal(entry.audio.hash, "sha256:aaaa");
  });
});

test("resolve mede uma vez e reaproveita; troca de modelo volta a medir", async () => {
  await withCache(async (cache) => {
    let measurements = 0;
    const measure = async () => { measurements += 1; return measurement; };

    const first = await cache.resolve({ descriptor, measure });
    assert.equal(first.cache, "miss");
    const second = await cache.resolve({ descriptor, measure });
    assert.equal(second.cache, "hit");
    assert.equal(measurements, 1);
    assert.equal(second.entry.measurement.words.length, 3);

    // Roteiro corrigido não mexe no áudio: continua acerto.
    const third = await cache.resolve({ descriptor, measure });
    assert.equal(third.cache, "hit");

    // Modelo diferente é outra medição.
    await cache.resolve({ descriptor: { ...descriptor, model: "large-v3-turbo" }, measure });
    assert.equal(measurements, 2);

    // Runtime diferente (CPU no lugar da GPU) também.
    await cache.resolve({ descriptor: { ...descriptor, runtimeFingerprint: "wrt1:cpu" }, measure });
    assert.equal(measurements, 3);
  });
});

test("refresh força nova medição sem quebrar a chave", async () => {
  await withCache(async (cache) => {
    let measurements = 0;
    const measure = async () => { measurements += 1; return measurement; };
    await cache.resolve({ descriptor, measure });
    const refreshed = await cache.resolve({ descriptor, measure, refresh: true });
    assert.equal(refreshed.cache, "miss");
    assert.equal(measurements, 2);
    assert.equal((await cache.resolve({ descriptor, measure })).cache, "hit");
    assert.equal(measurements, 2);
  });
});

test("o lock impede dois Whisper medindo o mesmo áudio ao mesmo tempo", async () => {
  await withCache(async (cache) => {
    let concurrent = 0;
    let peak = 0;
    let measurements = 0;
    const measure = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      measurements += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      concurrent -= 1;
      return measurement;
    };

    const results = await Promise.all([
      cache.resolve({ descriptor, measure }),
      cache.resolve({ descriptor, measure }),
      cache.resolve({ descriptor, measure }),
    ]);
    // Um mede; os outros esperam e acham pronto.
    assert.equal(peak, 1);
    assert.equal(measurements, 1);
    assert.equal(results.filter((entry) => entry.cache === "miss").length, 1);
    assert.equal(results.filter((entry) => entry.cache === "hit").length, 2);
    assert.equal((await cache.stats()).locks, 0);
  });
});

test("entrada da versão 1 (só transcrição) conta como ausência, não como acerto", async () => {
  await withCache(async (cache, root) => {
    const key = whisperCacheKey(descriptor);
    const legacyFile = path.join(root, `${key.replace(/[^a-z0-9]/gi, "_").slice(0, 120)}.json`);
    await writeFile(legacyFile, JSON.stringify({ schema: "mkt-videos/whisper-cache-entry@1", transcript: "texto antigo" }), "utf-8");
    assert.equal(await cache.get(key), null);
    assert.equal(await cache.has(key), false);

    let measured = 0;
    await cache.resolve({ descriptor, measure: async () => { measured += 1; return measurement; } });
    assert.equal(measured, 1);
    const entry = JSON.parse(await readFile(legacyFile, "utf-8"));
    assert.equal(entry.schema, WHISPER_CACHE_ENTRY_SCHEMA);
  });
});

test("medição sem palavra utilizável não entra no cache", async () => {
  await withCache(async (cache) => {
    await assert.rejects(
      cache.resolve({ descriptor, measure: async () => ({ transcript: "vazio", words: [] }) }),
      /ao menos uma palavra/,
    );
    await assert.rejects(
      cache.resolve({ descriptor, measure: async () => ({ transcript: "x", words: [{ word: "a", start: "?", end: 1 }] }) }),
      /tempo utilizável/,
    );
  });
});

test("hash de áudio é estável e sensível a um único byte", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "whisper-hash-"));
  try {
    const first = path.join(root, "a.wav");
    const second = path.join(root, "b.wav");
    await writeFile(first, Buffer.from([1, 2, 3, 4]));
    await writeFile(second, Buffer.from([1, 2, 3, 5]));
    const hash = await computeAudioHash(first);
    assert.match(hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(await computeAudioHash(first), hash);
    assert.notEqual(await computeAudioHash(second), hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
