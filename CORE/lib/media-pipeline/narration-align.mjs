// Alinhamento de narração: dos blocos Omni ao cronograma de palavras do master.
//
// Este é o elo que faltava entre "gerar a voz" e "pedir o efeito sincronizado".
// O manual mandava fazer à mão (ffmpeg -vn, whisper, conferir a olho); aqui a
// receita vira código com veredito explícito.
//
// Quatro passos, nesta ordem:
//  1. extrair o áudio de cada bloco Omni (o vídeo preto é descartável);
//  2. medir os tempos por palavra com Whisper (--word_timestamps);
//  3. CORRIGIR a ortografia contra o roteiro — o Whisper erra acento, número e
//     homófono, mas o roteiro é a verdade; o tempo medido é que manda;
//  4. montar a narração-mestre e reposicionar cada palavra no tempo do master.
//
// A correção nunca inventa tempo: só troca a GRAFIA da palavra medida pela do
// roteiro. Quando o locutor realmente falou outra coisa (não é erro de grafia),
// o alinhamento sai `blocked` e o bloco precisa ser regerado.

import { stat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { mapWithConcurrency, resolveCpuConcurrency } from "./concurrency.mjs";
import { probeMedia, runFfmpeg } from "./media-tools.mjs";
import { createStageReceipt, operationFingerprint, writeJsonAtomic, writeStageReceipt } from "./pipeline-operation.mjs";
import { createStageMetrics } from "./stage-metrics.mjs";
import { DEFAULT_WHISPER_BACKEND, runWhisperBackend } from "./whisper-backends.mjs";
import { computeAudioHash, createWhisperCache } from "./whisper-cache.mjs";
import { probeTorchRuntime, resolveWhisperDevice, resolveWhisperRuntime, whisperRuntimeFingerprint } from "./whisper-runtime.mjs";
import { applyLlmAlignmentProposal, buildLlmAlignmentRequest } from "./narration-text-contract.mjs";

export const NARRATION_ALIGNMENT_SCHEMA = "mkt-videos/narration-alignment@1";

// Janela de aparo de cada bloco e respiro entre blocos. O respiro define o tom:
// 0,30s soa institucional; 0,22s soa publicitário (medido na apresentação v2).
export const ALIGN_DEFAULTS = Object.freeze({
  leadInSeconds: 0.1,
  tailOutSeconds: 0.22,
  gapSeconds: 0.22,
  sampleRate: 48_000,
  whisperModel: "small",
  language: "pt",
  minConfidence: 0.6,
  whisperDevice: "auto",
  whisperBackend: DEFAULT_WHISPER_BACKEND,
  // Extrair WAV, medir duração e calcular hash é trabalho de CPU e disco: roda
  // em paralelo. A inferência é trabalho de GPU e a VRAM é de 8 GB: roda em fila
  // de largura 1. Abrir seis Whispers ao mesmo tempo troca espera por swap.
  cpuConcurrency: null,
  inferenceConcurrency: 1,
  cache: true,
});

function normalizedToken(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

// Aliases privados de pronúncia não acompanham a distribuição.
const PHONETIC_TOKEN_ALIASES = Object.freeze(new Map());

function comparableToken(value) {
  const normalized = normalizedToken(value);
  return PHONETIC_TOKEN_ALIASES.get(normalized) ?? normalized;
}

// Tokens "de fala": pontuação fica colada na palavra do roteiro (o cronograma
// mostra "sonho?" e não "sonho"), mas a comparação usa só a forma normalizada.
export function scriptTokens(value) {
  return String(value ?? "").split(/\s+/).map((raw) => raw.trim()).filter(Boolean)
    .map((text) => ({ text, normalized: comparableToken(text) }))
    .filter((token) => token.normalized.length > 0);
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

// Distância de edição normalizada entre duas formas — separa "erro de grafia do
// Whisper" (recibo/recebo, voce/você) de "o locutor falou outra palavra".
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...Array(b.length).fill(0)]);
  for (let column = 0; column <= b.length; column += 1) rows[0][column] = column;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - rows[a.length][b.length] / Math.max(a.length, b.length);
}

// Needleman-Wunsch sobre as formas normalizadas. Alinhar de verdade (em vez de
// comparar posição a posição) é o que permite corrigir um bloco onde o Whisper
// engoliu ou dobrou uma palavra sem desalinhar tudo o que vem depois.
export function alignTokenSequences(expected, measured) {
  const gapPenalty = -1;
  const score = Array.from({ length: expected.length + 1 }, () => new Float64Array(measured.length + 1));
  for (let i = 1; i <= expected.length; i += 1) score[i][0] = i * gapPenalty;
  for (let j = 1; j <= measured.length; j += 1) score[0][j] = j * gapPenalty;
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= measured.length; j += 1) {
      const pair = similarity(expected[i - 1].normalized, measured[j - 1].normalized) * 2 - 1;
      score[i][j] = Math.max(score[i - 1][j - 1] + pair, score[i - 1][j] + gapPenalty, score[i][j - 1] + gapPenalty);
    }
  }
  const operations = [];
  let i = expected.length;
  let j = measured.length;
  while (i > 0 || j > 0) {
    const pair = i > 0 && j > 0 ? similarity(expected[i - 1].normalized, measured[j - 1].normalized) * 2 - 1 : -Infinity;
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + pair) {
      operations.push({ expectedIndex: i - 1, measuredIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && score[i][j] === score[i - 1][j] + gapPenalty) {
      operations.push({ expectedIndex: i - 1, measuredIndex: null });
      i -= 1;
    } else {
      operations.push({ expectedIndex: null, measuredIndex: j - 1 });
      j -= 1;
    }
  }
  return operations.reverse();
}

/**
 * Reparte a janela medida entre a palavra que casou e as vagas ao lado dela.
 *
 * Quando o Whisper devolve um token para várias palavras faladas — "38" para
 * "trinta e oito", "9h30" para "nove e meia" — quem casou fica com o tempo
 * inteiro e as outras ficam sem nenhum. A doadora não é sempre a vizinha de
 * trás: o alinhador pode casar "38" com "oito", e aí quem inchou está na
 * frente. Escolhemos pela duração por caractere, porque a palavra que engoliu
 * a fala das outras é justamente a que está longa demais para o tamanho que
 * tem. A fatia é proporcional ao tamanho de cada palavra, o que mantém a ordem
 * e não inventa tempo fora da janela que foi de fato medida.
 */
export function repartirJanelasDasVagas(palavras) {
  const vaga = (p) => p.start == null || p.end == null;
  if (!palavras.some(vaga)) return palavras;
  if (palavras.every(vaga)) throw new Error("Nenhuma palavra do roteiro recebeu tempo medido; não há janela para repartir.");

  const inchaco = (k) => (palavras[k].end - palavras[k].start) / Math.max(1, palavras[k].word.length);

  let i = 0;
  while (i < palavras.length) {
    if (!vaga(palavras[i])) { i += 1; continue; }
    let fim = i;
    while (fim + 1 < palavras.length && vaga(palavras[fim + 1])) fim += 1;

    const atras = i > 0 ? i - 1 : null;
    const frente = fim + 1 < palavras.length ? fim + 1 : null;
    const doador = atras === null ? frente
      : frente === null ? atras
      : (inchaco(frente) > inchaco(atras) ? frente : atras);
    const primeiro = Math.min(doador, i);
    const ultimo = Math.max(doador, fim);
    const inicio = palavras[doador].start;
    const termino = palavras[doador].end;

    let total = 0;
    for (let k = primeiro; k <= ultimo; k += 1) total += Math.max(1, palavras[k].word.length);
    let cursor = inicio;
    for (let k = primeiro; k <= ultimo; k += 1) {
      const fatia = (termino - inicio) * (Math.max(1, palavras[k].word.length) / total);
      palavras[k].start = cursor;
      palavras[k].end = k === ultimo ? termino : cursor + fatia;
      cursor = palavras[k].end;
    }
    i = fim + 1;
  }
  return palavras;
}

// Adota a grafia do roteiro mantendo o tempo medido. `spellingFloor` é o quanto
// duas formas precisam se parecer para a divergência contar como erro de ASR.
// `spellingFloor` calibrado em 0,75: "recibo/recebo" (0,83) é erro de ASR e a
// grafia do roteiro vale. A hipótese lexical do Whisper nunca fornece o texto
// publicado: divergências e tokens extras são apenas diagnósticos; bloqueamos
// somente quando falta uma janela temporal para uma palavra canônica.
export function correctWordsAgainstScript({ script, words, spellingFloor = 0.75, minConfidence = ALIGN_DEFAULTS.minConfidence } = {}) {
  const expected = scriptTokens(script);
  if (!expected.length) throw new Error("O roteiro do bloco está vazio.");
  const measured = (Array.isArray(words) ? words : []).map((word, index) => {
    const text = String(word?.word ?? word?.text ?? "").trim();
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`Palavra medida ${index + 1} inválida no alinhamento.`);
    const confidence = word?.probability ?? word?.confidence;
    return { text, normalized: comparableToken(text), start, end, confidence: confidence == null ? null : Number(confidence) };
  }).filter((word) => word.normalized.length > 0);
  if (!measured.length) throw new Error("O Whisper não devolveu palavras para este bloco.");

  const findings = [];
  const corrected = [];
  // Modo correção ortográfica: quando `spellingFloor` é baixo (passe --corrigir),
  // divergências de contagem (palavra extra/omitida) e trocas fonéticas viram
  // `info` e a grafia do roteiro é adotada mantendo os timestamps medidos.
  const modoCorrecao = spellingFloor < 0.5;
  const operations = alignTokenSequences(expected, measured);
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const operation = operations[operationIndex];
    let target = operation.expectedIndex == null ? null : expected[operation.expectedIndex];
    let sources = operation.measuredIndex == null ? [] : [measured[operation.measuredIndex]];
    const next = operations[operationIndex + 1];
    // O Whisper pode fragmentar um único token falado ("atravessá-la" vira
    // "atravessá" + "-la"; "haverá" vira "há" + "verá"). O texto continua
    // vindo integralmente do roteiro; apenas unimos os intervalos medidos quando
    // a concatenação normalizada coincide EXATAMENTE com o token canônico.
    if (target && sources.length === 1 && next && next.expectedIndex == null && next.measuredIndex != null) {
      const candidate = [sources[0], measured[next.measuredIndex]];
      if (candidate.map((source) => source.normalized).join("") === target.normalized) {
        sources = candidate;
        operationIndex += 1;
      }
    } else if (!target && sources.length === 1 && next && next.expectedIndex != null && next.measuredIndex != null) {
      const nextTarget = expected[next.expectedIndex];
      const candidate = [sources[0], measured[next.measuredIndex]];
      if (candidate.map((source) => source.normalized).join("") === nextTarget.normalized) {
        target = nextTarget;
        sources = candidate;
        operationIndex += 1;
      }
    }
    const source = sources.length ? {
      text: sources.map((entry) => entry.text).join(""),
      normalized: sources.map((entry) => entry.normalized).join(""),
      start: sources[0].start,
      end: sources.at(-1).end,
      confidence: sources.every((entry) => entry.confidence != null) ? Math.min(...sources.map((entry) => entry.confidence)) : null,
    } : null;
    if (target && source) {
      const closeness = similarity(target.normalized, source.normalized);
      if (sources.length > 1) {
        findings.push({
          code: "whisper_tokens_joined",
          severity: "info",
          expected: target.text,
          actual: sources.map((entry) => entry.text),
          at: round(source.start),
        });
      }
      if (closeness < 1) {
        findings.push({
          code: closeness >= spellingFloor || modoCorrecao ? "spelling_corrected" : "whisper_lexical_divergence",
          severity: "info",
          expected: target.text,
          actual: source.text,
          similarity: round(closeness, 2),
          at: round(source.start),
        });
      }
      corrected.push({ word: target.text, start: source.start, end: source.end, ...(source.confidence == null ? {} : { probability: source.confidence }), ...(closeness < 1 ? { transcribed: source.text } : {}) });
    } else if (target) {
      // O Whisper devolve "38" onde o roteiro diz "trinta e oito": um token no
      // lugar de três. As duas palavras sem par saíam do texto publicado e a
      // tela dizia "Você tem oito anos". Em modo correção elas entram como
      // vaga sem tempo, e a janela é repartida com a vizinha logo abaixo — o
      // texto publicado é o roteiro inteiro, sempre.
      findings.push({
        code: modoCorrecao ? "missing_word_filled" : "missing_word",
        severity: modoCorrecao ? "info" : "block",
        expected: target.text,
        actual: null,
      });
      if (modoCorrecao) corrected.push({ word: target.text, start: null, end: null, preenchida: true });
    } else if (source) {
      findings.push({ code: "whisper_extra_token_ignored", severity: "info", expected: null, actual: source.text, at: round(source.start) });
    }
  }
  repartirJanelasDasVagas(corrected);
  for (const word of corrected) {
    if (word.probability != null && word.probability < minConfidence) {
      findings.push({ code: "low_alignment_confidence", severity: "warn", expected: word.word, confidence: round(word.probability, 2), at: round(word.start) });
    }
  }
  for (let index = 1; index < corrected.length; index += 1) {
    if (corrected[index].start + 1e-6 < corrected[index - 1].start) findings.push({ code: "non_monotonic_alignment", severity: "block", at: round(corrected[index].start) });
  }
  return {
    words: corrected,
    findings,
    status: findings.some((entry) => entry.severity === "block") ? "blocked" : "pass",
    spellingCorrections: findings.filter((entry) => entry.code === "spelling_corrected").length,
  };
}

export async function extractNarrationAudio({ videoFile, outputFile, sampleRate = ALIGN_DEFAULTS.sampleRate }) {
  await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await runFfmpeg(["-y", "-i", path.resolve(videoFile), "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", path.resolve(outputFile)]);
  return path.resolve(outputFile);
}

// Roda o Whisper e devolve as palavras medidas. Sem fallback silencioso: se o
// Whisper não existir, o erro precisa aparecer, porque não há como inventar tempo.
// `device` também não tem fallback mudo — `cuda` exigido e ausente é erro, e a
// queda para CPU em modo `auto` sai registrada em `device`/`deviceReason`.
export async function transcribeWordTimestamps({
  audioFile,
  workDir,
  model = ALIGN_DEFAULTS.whisperModel,
  language = ALIGN_DEFAULTS.language,
  command = "whisper",
  backend = ALIGN_DEFAULTS.whisperBackend,
  device = ALIGN_DEFAULTS.whisperDevice,
  devicePlan = null,
  pythonCommand = null,
} = {}) {
  const source = path.resolve(audioFile);
  const output = path.resolve(workDir);
  await mkdir(output, { recursive: true });
  const plan = devicePlan ?? resolveWhisperDevice({
    requested: device,
    probe: device === "cpu" ? null : await probeTorchRuntime({ whisperCommand: command }),
  });
  const measured = await runWhisperBackend({
    backend,
    audioFile: source,
    workDir: output,
    model,
    language,
    device: plan.device,
    fp16: plan.fp16,
    command,
    pythonCommand,
  });
  return {
    words: measured.words,
    transcript: measured.transcript,
    jsonFile: measured.jsonFile,
    model,
    backend: measured.backend,
    device: plan.device,
    fp16: plan.fp16,
    deviceReason: plan.reason,
    runtime: { source: measured.runtime.source },
  };
}

/**
 * Plano de execução do Whisper para um lote: sonda o torch uma única vez,
 * resolve o device e produz o fingerprint que entra na chave do cache.
 */
export async function planWhisperExecution({
  device = ALIGN_DEFAULTS.whisperDevice,
  command = "whisper",
  backend = ALIGN_DEFAULTS.whisperBackend,
  model = ALIGN_DEFAULTS.whisperModel,
  language = ALIGN_DEFAULTS.language,
  probeImpl = probeTorchRuntime,
  resolveRuntimeImpl = resolveWhisperRuntime,
} = {}) {
  const runtime = await resolveRuntimeImpl({ command });
  const probe = String(device) === "cpu" ? null : await probeImpl({ whisperCommand: runtime.command });
  const plan = resolveWhisperDevice({ requested: device, probe });
  return {
    ...plan,
    command: runtime.command,
    commandSource: runtime.source,
    backend: String(backend),
    model: String(model),
    language: String(language),
    fingerprint: whisperRuntimeFingerprint({
      backend,
      device: plan.device,
      fp16: plan.fp16,
      torch: probe?.torch ?? null,
      cudaVersion: probe?.cudaVersion ?? null,
      commandSource: runtime.source,
    }),
  };
}

// Plano de aparo: cada bloco entra no master pela janela da fala, com respiro
// entre blocos. Devolve as palavras já no tempo do master.
export function planNarrationMaster({ blocks, leadInSeconds = ALIGN_DEFAULTS.leadInSeconds, tailOutSeconds = ALIGN_DEFAULTS.tailOutSeconds, gapSeconds = ALIGN_DEFAULTS.gapSeconds } = {}) {
  if (!Array.isArray(blocks) || !blocks.length) throw new Error("planNarrationMaster exige ao menos um bloco alinhado.");
  const lead = Number(leadInSeconds);
  const tail = Number(tailOutSeconds);
  const gap = Number(gapSeconds);
  if (![lead, tail, gap].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("leadIn, tailOut e gap devem ser números não negativos.");
  let cursor = 0;
  const words = [];
  const spans = blocks.map((block, index) => {
    if (!Array.isArray(block.words) || !block.words.length) throw new Error(`Bloco ${block.id ?? index + 1} não tem palavras alinhadas.`);
    const first = block.words[0];
    const last = block.words.at(-1);
    const trimStart = Math.max(0, first.start - lead);
    const trimEnd = Math.min(Number(block.duration ?? Infinity), last.end + tail);
    if (!(trimEnd > trimStart)) throw new Error(`Bloco ${block.id ?? index + 1}: janela de aparo vazia.`);
    const offset = cursor;
    const wordStart = words.length;
    for (const word of block.words) {
      words.push({ word: word.word, start: round(offset + word.start - trimStart), end: round(offset + word.end - trimStart), block: block.id, ...(word.probability == null ? {} : { probability: word.probability }) });
    }
    cursor = round(offset + (trimEnd - trimStart) + (index < blocks.length - 1 ? gap : 0));
    return {
      id: block.id,
      source: block.audioFile ?? null,
      trim: [round(trimStart), round(trimEnd)],
      span: [round(offset), round(offset + (trimEnd - trimStart))],
      wordRange: [wordStart, words.length - 1],
      text: block.words.map((word) => word.word).join(" "),
    };
  });
  return { duration: round(spans.at(-1).span[1]), spans, words, breathSeconds: gap };
}

// Uma única passada de ffmpeg: apara cada bloco e emenda com silêncio real.
export async function renderNarrationMaster({ plan, outputFile, sampleRate = ALIGN_DEFAULTS.sampleRate }) {
  const target = path.resolve(outputFile);
  await mkdir(path.dirname(target), { recursive: true });
  const inputs = [];
  const filters = [];
  const chain = [];
  plan.spans.forEach((span, index) => {
    inputs.push("-i", path.resolve(span.source));
    filters.push(`[${index}:a]atrim=start=${span.trim[0].toFixed(6)}:end=${span.trim[1].toFixed(6)},asetpts=N/SR/TB,aformat=sample_fmts=s16:sample_rates=${sampleRate}:channel_layouts=mono[b${index}]`);
    chain.push(`[b${index}]`);
    if (index < plan.spans.length - 1 && plan.breathSeconds > 0) {
      filters.push(`aevalsrc=0:d=${Number(plan.breathSeconds).toFixed(6)}:s=${sampleRate}:c=mono,aformat=sample_fmts=s16:sample_rates=${sampleRate}:channel_layouts=mono[g${index}]`);
      chain.push(`[g${index}]`);
    }
  });
  filters.push(`${chain.join("")}concat=n=${chain.length}:v=0:a=1[out]`);
  await runFfmpeg(["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", target]);
  const probe = await probeMedia(target);
  if (Math.abs(Number(probe.duration) - plan.duration) > 0.05) {
    throw new Error(`Narração-mestre divergiu do plano: previsto ${plan.duration.toFixed(3)}s, obtido ${Number(probe.duration).toFixed(3)}s.`);
  }
  return { file: target, probe };
}

// Passo completo: blocos gerados -> narração-mestre + cronograma de palavras.
// `blocks` é o mesmo array usado em `commercial --step narration-jobs`, com o
// MP4 de cada bloco resolvido pelo chamador.
//
// O trabalho é dividido em duas camadas, e só a técnica é paralela:
//
//   CPU (paralela)  extrair WAV -> probe de duração -> hash do áudio
//   GPU (fila 1)    medir tempos por palavra, com cache por hash
//   CPU (série)     corrigir contra o roteiro, planejar e montar o master
//
// A ordem editorial não muda: nada é reenviado sem revisão, e bloco bloqueado
// continua impedindo a montagem do master.
export async function alignNarrationBlocks({
  blocks,
  outDir,
  masterFile = path.join(outDir, "narracao-master.wav"),
  wordsFile = path.join(outDir, "palavras-master.json"),
  spansFile = path.join(outDir, "spans.json"),
  receiptFile = path.join(outDir, "alinhamento.receipt.json"),
  metricsFile = path.join(outDir, "alinhamento.metrics.json"),
  whisperModel = ALIGN_DEFAULTS.whisperModel,
  whisperCommand = "whisper",
  whisperBackend = ALIGN_DEFAULTS.whisperBackend,
  whisperDevice = ALIGN_DEFAULTS.whisperDevice,
  whisperPython = null,
  language = ALIGN_DEFAULTS.language,
  leadInSeconds = ALIGN_DEFAULTS.leadInSeconds,
  tailOutSeconds = ALIGN_DEFAULTS.tailOutSeconds,
  gapSeconds = ALIGN_DEFAULTS.gapSeconds,
  sampleRate = ALIGN_DEFAULTS.sampleRate,
  minConfidence = ALIGN_DEFAULTS.minConfidence,
  spellingFloor = 0.75,
  cpuConcurrency = ALIGN_DEFAULTS.cpuConcurrency,
  inferenceConcurrency = ALIGN_DEFAULTS.inferenceConcurrency,
  cache = ALIGN_DEFAULTS.cache,
  cacheDir = null,
  refreshCache = false,
  parentReceipts = [],
  runWhisperBackendImpl = runWhisperBackend,
  planWhisperExecutionImpl = planWhisperExecution,
  llmCorrector = null,
  correctionWhisperModel = null,
  preserveSingleAudioMaster = false,
} = {}) {
  if (!Array.isArray(blocks) || !blocks.length) throw new Error("alignNarrationBlocks exige blocos { id, text, file }.");
  const root = path.resolve(outDir);
  const workDir = path.join(root, "alinhamento");
  await mkdir(workDir, { recursive: true });
  const startedAt = new Date();
  const metrics = createStageMetrics({ run: "narration-align" });

  const identified = blocks.map((block, index) => {
    const id = String(block.id ?? `n${String(index + 1).padStart(2, "0")}`);
    if (!block.file && !block.audioFile) throw new Error(`Bloco ${id} não tem mídia de narração associada.`);
    return { ...block, id, index };
  });

  const execution = await metrics.measure("whisper-plan", () => planWhisperExecutionImpl({
    device: whisperDevice,
    command: whisperCommand,
    backend: whisperBackend,
    model: whisperModel,
    language,
  }), { device: whisperDevice, backend: whisperBackend });
  metrics.resource("whisper-runtime", {
    device: execution.device,
    requested: execution.requested,
    reason: execution.reason,
    fp16: execution.fp16,
    backend: execution.backend,
    torch: execution.probed?.torch ?? null,
    cudaVersion: execution.probed?.cudaVersion ?? null,
    gpu: execution.gpu?.name ?? null,
    gpuMemoryBytes: execution.gpu?.totalMemoryBytes ?? null,
    fingerprint: execution.fingerprint,
  });

  // Camada 1 — CPU em paralelo. Nenhuma decisão aqui, só preparo verificável.
  const cpuWidth = resolveCpuConcurrency(cpuConcurrency, identified.length);
  const prepared = await mapWithConcurrency(identified, cpuWidth, async (block) => {
    const span = metrics.open("audio-extract", { blockId: block.id }).begin();
    try {
      const audioFile = block.audioFile
        ? path.resolve(block.audioFile)
        : await extractNarrationAudio({
            videoFile: block.file,
            outputFile: path.join(workDir, `${block.id}.wav`),
            sampleRate,
          });
      span.mark("extract");
      const [probe, audioHash, stats] = await Promise.all([
        probeMedia(audioFile),
        computeAudioHash(audioFile),
        stat(audioFile),
      ]);
      span.end({ status: "ok", durationSeconds: Number(probe.duration) });
      return { ...block, audioFile, duration: Number(probe.duration), audioHash, audioBytes: stats.size };
    } catch (error) {
      span.end({ status: "error", error });
      throw error;
    }
  });

  // Camada 2 — GPU em fila controlada. Uma inferência pesada por vez.
  const store = cache ? createWhisperCache({ cacheDir }) : null;
  const parameters = { wordTimestamps: true, sampleRate, backend: execution.backend };
  const measurements = await mapWithConcurrency(prepared, Math.max(1, Number(inferenceConcurrency) || 1), async (block) => {
    const span = metrics.open("whisper-transcribe", {
      blockId: block.id,
      model: whisperModel,
      device: execution.device,
      backend: execution.backend,
    });
    span.begin();
    const measure = async () => {
      const result = await runWhisperBackendImpl({
        backend: execution.backend,
        audioFile: block.audioFile,
        workDir,
        model: whisperModel,
        language,
        device: execution.device,
        fp16: execution.fp16,
        command: whisperCommand,
        pythonCommand: whisperPython,
      });
      return {
        words: result.words,
        transcript: result.transcript,
        jsonFile: result.jsonFile,
        backend: result.backend,
        device: execution.device,
        fp16: execution.fp16,
        torch: execution.probed?.torch ?? null,
        cudaVersion: execution.probed?.cudaVersion ?? null,
        audioBytes: block.audioBytes,
        durationSeconds: block.duration,
      };
    };
    try {
      if (!store) {
        const measured = await measure();
        span.end({ status: "ok", cache: "bypass", wordCount: measured.words.length });
        return { ...block, words: measured.words, transcript: measured.transcript, whisperJson: measured.jsonFile, cache: "bypass" };
      }
      const resolved = await store.resolve({
        descriptor: {
          audioHash: block.audioHash,
          model: whisperModel,
          language,
          parameters,
          runtimeFingerprint: execution.fingerprint,
        },
        measure,
        refresh: refreshCache,
      });
      span.end({ status: "ok", cache: resolved.cache, wordCount: resolved.entry.measurement.wordCount });
      return {
        ...block,
        words: resolved.entry.measurement.words,
        transcript: resolved.entry.measurement.transcript,
        whisperJson: null,
        cache: resolved.cache,
        cacheKey: resolved.key,
      };
    } catch (error) {
      span.end({ status: "error", error });
      throw error;
    }
  });

  // Camada 3 — decisão. Puro CPU, determinística, em ordem editorial.
  const aligned = [];
  const perBlock = [];
  for (const block of measurements) {
    const span = metrics.open("script-correction", { blockId: block.id }).begin();
    const deterministic = correctWordsAgainstScript({ script: block.text, words: block.words, minConfidence, spellingFloor });
    let correction = deterministic;
    let llmCorrection = null;
    let confirmation = null;
    if (deterministic.status === "blocked" && correctionWhisperModel) {
      const confirmed = await metrics.measure("whisper-confirmation", () => runWhisperBackendImpl({
        backend: execution.backend,
        audioFile: block.audioFile,
        workDir: path.join(workDir, "confirmacao", block.id),
        model: correctionWhisperModel,
        language,
        device: execution.device,
        fp16: execution.fp16,
        command: execution.command ?? whisperCommand,
        pythonCommand: whisperPython,
      }), { blockId: block.id, model: correctionWhisperModel, device: execution.device });
      const confirmedCorrection = correctWordsAgainstScript({
        script: block.text,
        words: confirmed.words,
        minConfidence,
        spellingFloor,
      });
      confirmation = {
        status: confirmedCorrection.status,
        model: correctionWhisperModel,
        transcript: confirmed.transcript,
        backend: confirmed.backend ?? execution.backend,
        device: execution.device,
      };
      if (confirmedCorrection.status === "pass") {
        correction = {
          ...confirmedCorrection,
          findings: [
            ...deterministic.findings.map((finding) => ({ ...finding, severity: "info", supersededBy: "larger-whisper-confirmation" })),
            ...confirmedCorrection.findings,
            { code: "larger_whisper_confirmation_passed", severity: "info", model: correctionWhisperModel },
          ],
        };
      }
    }
    if (correction.status === "blocked" && typeof llmCorrector === "function") {
      const request = buildLlmAlignmentRequest({ blockId: block.id, script: block.text, transcript: block.transcript, words: block.words });
      try {
        const proposal = await llmCorrector(structuredClone(request));
        const binding = applyLlmAlignmentProposal({ request, proposal });
        correction = {
          status: "pass",
          words: binding.words,
          spellingCorrections: binding.words.filter((word) => word.lexicalSimilarity < 1).length,
          findings: [
            ...deterministic.findings.map((finding) => ({ ...finding, severity: "info", supersededBy: "validated-llm-index-binding" })),
            { code: "llm_index_binding_validated", severity: "info", bindingFingerprint: binding.fingerprint },
          ],
        };
        llmCorrection = {
          status: "accepted",
          authority: "proposal-only",
          requestFingerprint: request.fingerprint,
          proposalFingerprint: binding.proposalFingerprint,
          bindingFingerprint: binding.fingerprint,
          model: proposal?.model ?? null,
        };
      } catch (error) {
        correction = {
          ...deterministic,
          findings: [...deterministic.findings, { code: "llm_correction_rejected", severity: "block", message: String(error?.message ?? error) }],
        };
        llmCorrection = { status: "rejected", authority: "proposal-only", requestFingerprint: request.fingerprint };
      }
    }
    span.end({ status: "ok", verdict: correction.status, spellingCorrections: correction.spellingCorrections, llmCorrection: llmCorrection?.status ?? "not-used" });
    aligned.push({ id: block.id, words: correction.words, audioFile: block.audioFile, duration: block.duration });
    perBlock.push({
      id: block.id,
      status: correction.status,
      transcript: block.transcript,
      script: String(block.text),
      wordCount: correction.words.length,
      spellingCorrections: correction.spellingCorrections,
      findings: correction.findings,
      sourceVideo: block.file ? path.resolve(block.file) : null,
      audioFile: block.audioFile,
      audioHash: block.audioHash,
      whisperJson: block.whisperJson,
      whisperRuntime: { source: execution.probed?.python ?? null, device: execution.device, backend: execution.backend },
      llmCorrection,
      confirmation,
    });
  }
  const blocked = perBlock.filter((entry) => entry.status === "blocked");
  if (preserveSingleAudioMaster && aligned.length !== 1) throw new Error("preserveSingleAudioMaster exige exatamente um áudio de narração.");
  const plan = preserveSingleAudioMaster
    ? {
        duration: aligned[0].duration,
        breathSeconds: 0,
        words: aligned[0].words.map((word) => ({ ...word })),
        spans: [{
          id: aligned[0].id,
          source: aligned[0].audioFile,
          trim: [0, aligned[0].duration],
          span: [0, aligned[0].duration],
          wordRange: [0, Math.max(0, aligned[0].words.length - 1)],
          text: aligned[0].words.map((word) => word.word).join(" "),
        }],
      }
    : planNarrationMaster({ blocks: aligned, leadInSeconds, tailOutSeconds, gapSeconds });
  const master = blocked.length
    ? null
    : preserveSingleAudioMaster
      ? { file: path.resolve(aligned[0].audioFile), probe: await probeMedia(aligned[0].audioFile) }
      : await metrics.measure("narration-master", () => renderNarrationMaster({ plan, outputFile: masterFile, sampleRate }));

  const metricsDocument = metrics.snapshot();
  const alignment = {
    schema: NARRATION_ALIGNMENT_SCHEMA,
    status: blocked.length ? "blocked" : "pass",
    duration: plan.duration,
    wordCount: plan.words.length,
    breathSeconds: plan.breathSeconds,
    trim: { leadInSeconds, tailOutSeconds },
    whisper: {
      model: whisperModel,
      language,
      backend: execution.backend,
      device: execution.device,
      fp16: execution.fp16,
      deviceReason: execution.reason,
      deviceNotice: execution.notice,
      gpu: execution.gpu ?? null,
      runtimeFingerprint: execution.fingerprint,
      runtime: perBlock[0]?.whisperRuntime ?? null,
    },
    masterFile: master ? master.file : null,
    blocks: perBlock,
    policy: {
      source: "measured-alignment",
      inventedTimestamps: false,
      spellingSource: "script",
      llmAuthority: "proposal-only",
      llmOutputMaySupplyText: false,
      llmOutputMaySupplyTimestamps: false,
    },
  };

  // Observabilidade fica separada do documento de alinhamento de propósito:
  // tempo de parede e acerto de cache mudam a cada execução e não podem entrar
  // na impressão digital do resultado — dois runs com a mesma medição precisam
  // continuar produzindo o mesmo fingerprint.
  const executionReport = {
    concurrency: { cpu: cpuWidth, inference: Math.max(1, Number(inferenceConcurrency) || 1) },
    cache: {
      enabled: Boolean(cache),
      hits: measurements.filter((entry) => entry.cache === "hit").length,
      misses: measurements.filter((entry) => entry.cache === "miss").length,
      bypass: measurements.filter((entry) => entry.cache === "bypass").length,
    },
    blocks: measurements.map((entry) => ({ id: entry.id, cache: entry.cache, cacheKey: entry.cacheKey ?? null, audioHash: entry.audioHash })),
    metrics: { wallMs: metricsDocument.wallMs, stages: metricsDocument.stages },
  };
  await Promise.all([
    writeJsonAtomic(wordsFile, plan.words, { label: "Cronograma de palavras do master" }),
    writeJsonAtomic(spansFile, { ...alignment, spans: plan.spans, fingerprint: operationFingerprint(alignment), execution: executionReport }, { label: "Spans da narração" }),
    // O documento completo de métricas fica fora do recibo (é grande e não é
    // evidência de autorização), mas ao lado dele, para comparar execuções.
    writeJsonAtomic(metricsFile, metricsDocument, { label: "Métricas do alinhamento" }),
  ]);

  const artifacts = master ? [await createArtifactFromFile({ file: master.file, kind: "audio", role: "narration-master", source: { provider: preserveSingleAudioMaster ? "preserved-provider-audio" : "ffmpeg" } })] : [];
  const receipt = createStageReceipt({
    operation: "align-narration",
    provider: `whisper:${whisperModel}`,
    mode: "studio",
    stage: "narration-align",
    parameters: {
      whisperModel,
      correctionWhisperModel,
      language,
      leadInSeconds,
      tailOutSeconds,
      gapSeconds,
      sampleRate,
      minConfidence,
      whisperBackend: execution.backend,
      whisperDevice: execution.device,
      whisperDeviceRequested: execution.requested,
      fp16: execution.fp16,
      cpuConcurrency: cpuWidth,
      inferenceConcurrency: Math.max(1, Number(inferenceConcurrency) || 1),
      cache: Boolean(cache),
      preserveSingleAudioMaster: Boolean(preserveSingleAudioMaster),
    },
    inputs: await Promise.all(blocks.map((block) => createArtifactFromFile({ file: path.resolve(block.audioFile ?? block.file), kind: block.audioFile ? "audio" : "video", role: block.audioFile ? "narration-source-audio" : "narration-block" }))),
    artifacts,
    metadata: { ...alignment, execution: executionReport, wordsFile: path.resolve(wordsFile), spansFile: path.resolve(spansFile) },
    parentReceipts,
    startedAt,
    completedAt: new Date(),
  });
  await writeStageReceipt(receiptFile, receipt);
  if (!master && !preserveSingleAudioMaster) await rm(path.resolve(masterFile), { force: true });
  return {
    ...alignment,
    execution: executionReport,
    words: plan.words,
    spans: plan.spans,
    wordsFile: path.resolve(wordsFile),
    spansFile: path.resolve(spansFile),
    metricsFile: path.resolve(metricsFile),
    metricsDocument,
    receiptFile: path.resolve(receiptFile),
    blockedBlocks: blocked.map((entry) => entry.id),
  };
}
