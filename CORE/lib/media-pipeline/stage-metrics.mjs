// Instrumentação por etapa: mede sem mudar comportamento.
//
// Otimizar sem medir é chute. Este módulo é a régua: cada etapa registra quanto
// esperou na fila, quanto executou de fato, se aproveitou cache, em que
// dispositivo rodou e quantas etapas irmãs rodaram junto. Nada aqui decide,
// bloqueia ou reordena — só observa, para que qualquer mudança possa ser
// comparada com a execução de referência.
//
// O paralelismo é medido, não declarado: `effectiveParallelism` é o tempo somado
// das execuções dividido pela janela real da etapa. Pedir 3 workers e medir 1,04
// significa que a concorrência não estava acontecendo, e o número denuncia isso.
//
// Segredo não entra: os atributos passam pelo mesmo saneamento da telemetria,
// que descarta cookie/token/prompt e mascara caminho local.

import { sanitizeTelemetryAttributes } from "./telemetry.mjs";

export const STAGE_METRICS_SCHEMA = "mkt-videos/stage-metrics@1";
export const STAGE_METRICS_COMPARISON_SCHEMA = "mkt-videos/stage-metrics-comparison@1";

const CACHE_OUTCOMES = new Set(["hit", "miss", "bypass", "write"]);

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return round(sorted[index]);
}

/**
 * Coletor de métricas de um run. Cada span tem três instantes distintos —
 * enfileirado, iniciado, encerrado — porque espera de fila e tempo de execução
 * são gargalos diferentes e a otimização de um não serve para o outro.
 */
export function createStageMetrics({
  run = null,
  clock = () => Number(process.hrtime.bigint() / 1_000n) / 1_000,
  now = () => new Date(),
} = {}) {
  const startedAtWall = now();
  const startedAtClock = clock();
  const spans = [];
  const resources = [];
  const running = new Map();
  let sequence = 0;

  function currentConcurrency(stage) {
    let total = 0;
    for (const value of running.values()) if (value === stage) total += 1;
    return total;
  }

  function open(stage, attributes = {}) {
    const name = String(stage ?? "").trim();
    if (!name) throw new Error("Span de métrica exige o nome da etapa.");
    const id = (sequence += 1);
    const record = {
      id,
      stage: name,
      status: "open",
      queuedAtMs: round(clock() - startedAtClock),
      startedAtMs: null,
      endedAtMs: null,
      queueMs: null,
      durationMs: null,
      concurrencyAtStart: null,
      attributes: sanitizeTelemetryAttributes(attributes),
      marks: [],
    };
    spans.push(record);

    const handle = {
      get id() { return id; },
      get stage() { return name; },
      detail(extra = {}) {
        Object.assign(record.attributes, sanitizeTelemetryAttributes(extra));
        return handle;
      },
      begin(extra = {}) {
        if (record.startedAtMs != null) return handle;
        record.startedAtMs = round(clock() - startedAtClock);
        record.queueMs = round(record.startedAtMs - record.queuedAtMs);
        record.concurrencyAtStart = currentConcurrency(name) + 1;
        record.status = "running";
        running.set(id, name);
        return handle.detail(extra);
      },
      // Sub-tempo dentro da etapa (ex.: "correção", "probe", "download") sem
      // criar outro span — o custo interno aparece sem poluir a agregação.
      mark(label, extra = {}) {
        const at = round(clock() - startedAtClock);
        const previous = record.marks.at(-1)?.atMs ?? record.startedAtMs ?? record.queuedAtMs;
        record.marks.push({
          label: String(label),
          atMs: at,
          sinceMs: round(at - previous),
          attributes: sanitizeTelemetryAttributes(extra),
        });
        return handle;
      },
      end({ status = "ok", cache = null, error = null, ...extra } = {}) {
        if (record.status === "settled") return handle;
        if (record.startedAtMs == null) handle.begin();
        running.delete(id);
        record.endedAtMs = round(clock() - startedAtClock);
        record.durationMs = round(record.endedAtMs - record.startedAtMs);
        record.status = "settled";
        record.outcome = String(status);
        if (cache != null) {
          if (!CACHE_OUTCOMES.has(String(cache))) throw new Error(`Resultado de cache inválido: ${cache}.`);
          record.cache = String(cache);
        }
        if (error) record.error = String(error?.code ?? error?.message ?? error).slice(0, 200);
        return handle.detail(extra);
      },
    };
    return handle;
  }

  return Object.freeze({
    open,
    // Caminho curto para etapa que já está pronta para rodar. Falha do trabalho
    // é registrada e repropagada: métrica não engole erro.
    async measure(stage, work, attributes = {}) {
      const span = open(stage, attributes).begin();
      try {
        const value = await work(span);
        span.end({ status: "ok" });
        return value;
      } catch (error) {
        span.end({ status: "error", error });
        throw error;
      }
    },
    // Fato de ambiente medido uma vez (GPU, VRAM, backend, versão do runtime).
    resource(kind, attributes = {}) {
      resources.push({ kind: String(kind), at: now().toISOString(), attributes: sanitizeTelemetryAttributes(attributes) });
      return resources.at(-1);
    },
    snapshot({ completedAt = now() } = {}) {
      const settled = spans.filter((span) => span.status === "settled");
      return {
        schema: STAGE_METRICS_SCHEMA,
        run: run == null ? null : String(run),
        startedAt: startedAtWall.toISOString(),
        completedAt: (completedAt instanceof Date ? completedAt : new Date(completedAt)).toISOString(),
        wallMs: round(clock() - startedAtClock),
        spanCount: spans.length,
        openSpans: spans.filter((span) => span.status !== "settled").map((span) => ({ stage: span.stage, status: span.status })),
        resources: structuredClone(resources),
        stages: summarizeSpans(settled),
        spans: settled.map((span) => structuredClone(span)),
      };
    },
  });
}

/** Agregação por etapa. Sempre a partir dos spans encerrados. */
export function summarizeSpans(spans) {
  const byStage = new Map();
  for (const span of spans) {
    if (!byStage.has(span.stage)) byStage.set(span.stage, []);
    byStage.get(span.stage).push(span);
  }
  return [...byStage.entries()].map(([stage, entries]) => {
    const durations = entries.map((entry) => Number(entry.durationMs ?? 0)).sort((a, b) => a - b);
    const busyMs = durations.reduce((total, value) => total + value, 0);
    const first = Math.min(...entries.map((entry) => entry.startedAtMs));
    const last = Math.max(...entries.map((entry) => entry.endedAtMs));
    const wallMs = round(last - first);
    return {
      stage,
      count: entries.length,
      errors: entries.filter((entry) => entry.outcome === "error").length,
      busyMs: round(busyMs),
      wallMs,
      queueMs: round(entries.reduce((total, entry) => total + Number(entry.queueMs ?? 0), 0)),
      medianMs: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations.length ? round(durations.at(-1)) : null,
      // Concorrência medida, não pedida: 1,0 significa fila serial de fato.
      effectiveParallelism: wallMs > 0 ? round(busyMs / wallMs, 2) : entries.length ? 1 : 0,
      peakConcurrency: Math.max(...entries.map((entry) => Number(entry.concurrencyAtStart ?? 1))),
      cache: {
        hit: entries.filter((entry) => entry.cache === "hit").length,
        miss: entries.filter((entry) => entry.cache === "miss").length,
        write: entries.filter((entry) => entry.cache === "write").length,
        bypass: entries.filter((entry) => entry.cache === "bypass").length,
      },
      devices: [...new Set(entries.map((entry) => entry.attributes?.device).filter(Boolean))],
      models: [...new Set(entries.map((entry) => entry.attributes?.model).filter(Boolean))],
    };
  }).sort((left, right) => right.busyMs - left.busyMs);
}

export function summarizeStageMetrics(document) {
  if (document?.schema !== STAGE_METRICS_SCHEMA) throw new Error("Documento de métricas inválido.");
  return document.stages;
}

/**
 * Compara duas execuções etapa a etapa. Serve para responder a única pergunta
 * que importa depois de uma otimização: ficou mais rápido, onde, e o ganho veio
 * de cache ou de execução? `toleranceRatio` evita chamar ruído de regressão.
 */
export function compareStageMetrics(baseline, candidate, { toleranceRatio = 0.05 } = {}) {
  if (baseline?.schema !== STAGE_METRICS_SCHEMA || candidate?.schema !== STAGE_METRICS_SCHEMA) {
    throw new Error("Comparação exige dois documentos mkt-videos/stage-metrics@1.");
  }
  const before = new Map(baseline.stages.map((stage) => [stage.stage, stage]));
  const after = new Map(candidate.stages.map((stage) => [stage.stage, stage]));
  const stages = [...new Set([...before.keys(), ...after.keys()])].map((stage) => {
    const left = before.get(stage) ?? null;
    const right = after.get(stage) ?? null;
    const baseMs = Number(left?.busyMs ?? 0);
    const nextMs = Number(right?.busyMs ?? 0);
    const deltaMs = round(nextMs - baseMs);
    const ratio = baseMs > 0 ? round(nextMs / baseMs, 4) : null;
    return {
      stage,
      presence: left && right ? "both" : left ? "baseline-only" : "candidate-only",
      baselineBusyMs: left ? baseMs : null,
      candidateBusyMs: right ? nextMs : null,
      deltaMs,
      ratio,
      verdict: ratio == null ? "new"
        : ratio <= 1 - toleranceRatio ? "faster"
          : ratio >= 1 + toleranceRatio ? "slower"
            : "unchanged",
      cacheHitDelta: Number(right?.cache?.hit ?? 0) - Number(left?.cache?.hit ?? 0),
      parallelismDelta: round(Number(right?.effectiveParallelism ?? 0) - Number(left?.effectiveParallelism ?? 0), 2),
    };
  }).sort((leftEntry, rightEntry) => leftEntry.deltaMs - rightEntry.deltaMs);

  const wallDelta = round(Number(candidate.wallMs) - Number(baseline.wallMs));
  const wallRatio = Number(baseline.wallMs) > 0 ? round(Number(candidate.wallMs) / Number(baseline.wallMs), 4) : null;
  return {
    schema: STAGE_METRICS_COMPARISON_SCHEMA,
    comparedAt: new Date().toISOString(),
    baseline: { run: baseline.run, wallMs: baseline.wallMs, startedAt: baseline.startedAt },
    candidate: { run: candidate.run, wallMs: candidate.wallMs, startedAt: candidate.startedAt },
    wallDeltaMs: wallDelta,
    wallRatio,
    verdict: wallRatio == null ? "inconclusive"
      : wallRatio <= 1 - toleranceRatio ? "faster"
        : wallRatio >= 1 + toleranceRatio ? "slower"
          : "unchanged",
    stages,
  };
}
