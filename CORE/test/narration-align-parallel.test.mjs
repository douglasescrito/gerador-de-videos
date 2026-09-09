// Alinhamento paralelo com ffmpeg real e Whisper injetado.
//
// O que se mede aqui não é a transcrição (isso é do Whisper), e sim a forma da
// execução: extração em paralelo, inferência em fila de uma, ordem editorial
// preservada e cache poupando a segunda passada.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { alignNarrationBlocks, planWhisperExecution } from "../lib/media-pipeline/narration-align.mjs";
import { runFfmpeg } from "../lib/media-pipeline/media-tools.mjs";
import { createSyntheticToneFixtures } from "./fixtures/synthetic-tones.mjs";

const sourceTones = createSyntheticToneFixtures();
after(() => sourceTones.dispose());

const SCRIPTS = {
  n01: "Primeiro bloco da narração.",
  n02: "Segundo bloco da narração.",
  n03: "Terceiro bloco da narração.",
};

function wordsFor(text, offset = 0.5) {
  return text.split(/\s+/).map((word, index) => ({
    word,
    start: offset + index * 0.3,
    end: offset + index * 0.3 + 0.25,
    probability: 0.95,
  }));
}

const devicePlan = {
  device: "cuda",
  fp16: true,
  requested: "auto",
  reason: "auto-cuda",
  notice: null,
  fallback: false,
  probed: { torch: "2.5.1", cuda: true, cudaVersion: "12.1", python: "python.exe" },
  gpu: { index: 0, name: "RTX 4070 Laptop", totalMemoryBytes: 8_589_934_592 },
  backend: "openai-whisper",
  model: "small",
  language: "pt",
  fingerprint: "wrt1:testefixo",
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "align-parallel-"));
  const blocks = [];
  for (const [id, text] of Object.entries(SCRIPTS)) {
    const file = path.join(root, `${id}.wav`);
    // Cada bloco tem uma frequência diferente: hashes de áudio distintos.
    const frequency = 300 + blocks.length * 110;
    await sourceTones.materialize(file, { frequency, duration: 3 });
    blocks.push({ id, text, file });
  }
  return { root, blocks };
}

function trackedWhisper(state) {
  return async ({ audioFile }) => {
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    state.calls.push(path.basename(audioFile));
    await new Promise((resolve) => setTimeout(resolve, 30));
    state.active -= 1;
    const id = path.parse(audioFile).name;
    return {
      backend: "openai-whisper",
      words: wordsFor(SCRIPTS[id]),
      transcript: SCRIPTS[id],
      jsonFile: `${audioFile}.json`,
      runtime: { command: "whisper", source: "test" },
    };
  };
}

test("extração roda em paralelo, inferência em fila única e a ordem não muda", async () => {
  const { root, blocks } = await fixture();
  const cacheDir = path.join(root, "cache");
  const state = { active: 0, peak: 0, calls: [] };
  try {
    const result = await alignNarrationBlocks({
      blocks,
      outDir: path.join(root, "saida"),
      cacheDir,
      cpuConcurrency: 3,
      inferenceConcurrency: 1,
      planWhisperExecutionImpl: async () => devicePlan,
      runWhisperBackendImpl: trackedWhisper(state),
    });

    assert.equal(result.status, "pass");
    // A VRAM é uma só: nunca duas inferências ao mesmo tempo.
    assert.equal(state.peak, 1, `inferência concorrente detectada: ${state.peak}`);
    assert.deepEqual(state.calls, ["n01.wav", "n02.wav", "n03.wav"]);
    // Ordem editorial preservada mesmo com a CPU paralela.
    assert.deepEqual(result.blocks.map((block) => block.id), ["n01", "n02", "n03"]);
    assert.deepEqual(result.spans.map((span) => span.id), ["n01", "n02", "n03"]);
    assert.equal(result.execution.concurrency.cpu, 3);
    assert.equal(result.execution.concurrency.inference, 1);

    // A extração precisa ter acontecido de fato em paralelo.
    const extract = result.execution.metrics.stages.find((stage) => stage.stage === "audio-extract");
    assert.equal(extract.count, 3);
    assert.ok(extract.effectiveParallelism > 1, `extração não paralelizou: ${extract.effectiveParallelism}`);
    const inference = result.execution.metrics.stages.find((stage) => stage.stage === "whisper-transcribe");
    // A exclusão mútua é provada exatamente por state.peak acima. A razão
    // trabalho/wall-clock inclui overhead do scheduler e pode medir 0,99 sob
    // carga; ela deve permanecer próxima de uma lane, nunca alegar paralelismo.
    assert.ok(inference.effectiveParallelism >= 0.9 && inference.effectiveParallelism <= 1.01, `paralelismo efetivo de inferência inválido: ${inference.effectiveParallelism}`);

    // O device usado fica registrado, não implícito.
    assert.equal(result.whisper.device, "cuda");
    assert.equal(result.whisper.fp16, true);
    assert.equal(result.whisper.deviceReason, "auto-cuda");
    assert.equal(result.whisper.gpu.totalMemoryBytes, 8_589_934_592);
    assert.equal(result.execution.cache.misses, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("segunda passada com o mesmo áudio não volta ao Whisper", async () => {
  const { root, blocks } = await fixture();
  const cacheDir = path.join(root, "cache");
  const state = { active: 0, peak: 0, calls: [] };
  const options = {
    blocks,
    cacheDir,
    planWhisperExecutionImpl: async () => devicePlan,
    runWhisperBackendImpl: trackedWhisper(state),
  };
  try {
    await alignNarrationBlocks({ ...options, outDir: path.join(root, "primeira") });
    assert.equal(state.calls.length, 3);

    // Roteiro corrigido, áudio intacto: os timestamps aprovados são reusados.
    const corrigido = blocks.map((block) => ({ ...block, text: SCRIPTS[block.id] }));
    const second = await alignNarrationBlocks({ ...options, blocks: corrigido, outDir: path.join(root, "segunda") });
    assert.equal(state.calls.length, 3, "o Whisper foi chamado de novo para o mesmo áudio");
    assert.equal(second.execution.cache.hits, 3);
    assert.equal(second.status, "pass");

    // Modelo diferente invalida só o que era incompatível.
    const other = await alignNarrationBlocks({ ...options, outDir: path.join(root, "terceira"), whisperModel: "large-v3-turbo" });
    assert.equal(state.calls.length, 6);
    assert.equal(other.execution.cache.misses, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bloco sem timestamp para uma palavra canônica continua bloqueando o master", async () => {
  const { root, blocks } = await fixture();
  const state = { active: 0, peak: 0, calls: [] };
  try {
    const result = await alignNarrationBlocks({
      blocks,
      outDir: path.join(root, "saida"),
      cacheDir: path.join(root, "cache"),
      planWhisperExecutionImpl: async () => devicePlan,
      runWhisperBackendImpl: async ({ audioFile }) => {
        const id = path.parse(audioFile).name;
        const text = id === "n02" ? "Segundo trecho agora." : SCRIPTS[id];
        state.calls.push(id);
        return { backend: "openai-whisper", words: wordsFor(text), transcript: text, jsonFile: null, runtime: { command: "whisper", source: "test" } };
      },
    });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockedBlocks, ["n02"]);
    assert.equal(result.masterFile, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modelo maior confirma apenas o bloco recusado e evita regeneração de voz", async () => {
  const { root, blocks } = await fixture();
  const calls = [];
  try {
    const result = await alignNarrationBlocks({
      blocks,
      outDir: path.join(root, "saida-confirmada"),
      cache: false,
      correctionWhisperModel: "large-v3-turbo",
      planWhisperExecutionImpl: async () => devicePlan,
      runWhisperBackendImpl: async ({ audioFile, model }) => {
        const id = path.parse(audioFile).name;
        calls.push({ id, model });
        const text = id === "n02" && model !== "large-v3-turbo"
          ? "Segundo trecho agora."
          : SCRIPTS[id];
        return { backend: "openai-whisper", words: wordsFor(text), transcript: text, jsonFile: null };
      },
    });
    assert.equal(result.status, "pass");
    assert.deepEqual(calls.filter((entry) => entry.model === "large-v3-turbo").map((entry) => entry.id), ["n02"]);
    assert.equal(result.blocks.find((block) => block.id === "n02").confirmation.status, "pass");
    assert.ok(result.masterFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planejamento sonda o Python do executável Whisper resolvido", async () => {
  let probedCommand = null;
  const plan = await planWhisperExecution({
    device: "auto",
    command: "whisper",
    resolveRuntimeImpl: async () => ({ command: "C:\\Python311\\Scripts\\whisper.exe", source: "fixture" }),
    probeImpl: async ({ whisperCommand }) => {
      probedCommand = whisperCommand;
      return {
        python: "C:\\Python311\\python.exe",
        torch: "2.5.1+cu121",
        cuda: true,
        cudaVersion: "12.1",
        devices: [{ index: 0, name: "RTX", totalMemoryBytes: 8_589_934_592 }],
      };
    },
  });
  assert.equal(probedCommand, "C:\\Python311\\Scripts\\whisper.exe");
  assert.equal(plan.device, "cuda");
  assert.equal(plan.commandSource, "fixture");
});

test("LLM não é chamado quando o roteiro já pode usar as janelas medidas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "align-llm-contract-"));
  const file = path.join(root, "bloco.wav");
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", file]);
  try {
    let llmCalls = 0;
    const result = await alignNarrationBlocks({
      blocks: [{ id: "bloco-5", text: "Bem-vindo à nova era.", file }],
      outDir: path.join(root, "saida"),
      cache: false,
      planWhisperExecutionImpl: async () => devicePlan,
      runWhisperBackendImpl: async () => ({
        backend: "openai-whisper",
        transcript: "Bem-vindo à nova era.",
        words: [
          { word: "Ben", start: 0.5, end: 0.9, probability: 0.99 },
          { word: "-vindo", start: 0.9, end: 1.3, probability: 0.99 },
          { word: "à", start: 1.3, end: 1.45, probability: 0.99 },
          { word: "nova", start: 1.45, end: 1.8, probability: 0.99 },
          { word: "era.", start: 1.8, end: 2.2, probability: 0.99 },
        ],
        jsonFile: null,
        runtime: { command: "whisper", source: "test" },
      }),
      llmCorrector: async () => {
        llmCalls += 1;
        throw new Error("LLM não deve participar deste binding.");
      },
    });
    assert.equal(result.status, "pass");
    assert.deepEqual(result.words.map((word) => word.word), ["Bem-vindo", "à", "nova", "era."]);
    assert.equal(llmCalls, 0);
    assert.equal(result.blocks[0].llmCorrection, null);
    assert.equal(result.policy.llmOutputMaySupplyText, false);
    assert.equal(result.policy.llmOutputMaySupplyTimestamps, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
