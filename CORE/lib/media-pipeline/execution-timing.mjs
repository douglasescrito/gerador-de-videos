import { AsyncLocalStorage } from "node:async_hooks";
import { createStageMetrics } from "./stage-metrics.mjs";

const active = new AsyncLocalStorage();
const phases = ["admission", "capacity-wait", "preparation", "submission", "polling", "download", "pending-wait", "local-process", "publication", "verification", "adapter-execution", "local-execution"];

function unionMs(intervals) {
  const sorted = intervals.map(({ startMs, endMs }) => [startMs, endMs]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = 0;
  for (const [start, next] of sorted) { total += Math.max(0, next - Math.max(start, end)); end = Math.max(end, next); }
  return Math.round(total * 1000) / 1000;
}

// Só nomes fechados e números. Nem argumentos, caminhos, prompts ou mensagens
// de erro entram no documento. AsyncLocalStorage isola produções concorrentes.
export function createExecutionTiming({ scope = "operation", ...options } = {}) {
  if (!["operation", "node", "batch-invocation"].includes(scope)) throw new Error("Escopo de medição inválido.");
  const metrics = createStageMetrics(options);
  let count = 0, omitted = 0;
  const collector = {
    run(work) { return active.run(collector, work); },
    async measure(phase, work) {
      if (!phases.includes(phase)) throw new Error(`Fase de medição desconhecida: ${phase}.`);
      if (count >= 10000) { omitted++; return work(); }
      count++;
      const span = metrics.open(phase).begin();
      try { const result = await work(); span.end({ status: "ok" }); return result; }
      catch (error) { span.end({ status: "error" }); throw error; }
    },
    snapshot() {
      const measured = metrics.snapshot();
      const intervals = measured.spans.map((span) => ({ phase: span.stage, startMs: span.startedAtMs, endMs: span.endedAtMs, outcome: span.outcome }));
      return { schema: "mkt-videos/execution-timing@1", scope, startedAt: measured.startedAt, wallMs: measured.wallMs,
        openIntervals: measured.openSpans.length, omittedIntervals: omitted,
        phaseMs: Object.fromEntries(phases.map((phase) => {
          const selected = intervals.filter((interval) => interval.phase === phase);
          return [phase, selected.length ? unionMs(selected) : null];
        })), remoteProcessingMs: null, intervals };
    },
  };
  return Object.freeze(collector);
}

export function measureExecutionPhase(phase, work) {
  return active.getStore()?.measure(phase, work) ?? work();
}

export function currentExecutionTiming() { return active.getStore()?.snapshot() ?? null; }

export function assertExecutionTiming(value) {
  const keys = ["schema", "scope", "startedAt", "wallMs", "openIntervals", "omittedIntervals", "phaseMs", "remoteProcessingMs", "intervals"];
  if (!value || typeof value !== "object" || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
    || value.schema !== "mkt-videos/execution-timing@1" || !["operation", "node", "batch-invocation"].includes(value.scope) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
    || !Number.isFinite(value.wallMs) || value.wallMs < 0 || value.remoteProcessingMs !== null
    || !Number.isSafeInteger(value.openIntervals) || value.openIntervals < 0 || !Number.isSafeInteger(value.omittedIntervals) || value.omittedIntervals < 0
    || !Array.isArray(value.intervals) || value.intervals.length > 10000) throw new Error("Medição de execução inválida.");
  if (!value.phaseMs || Object.keys(value.phaseMs).length !== phases.length || phases.some((phase) => !Object.hasOwn(value.phaseMs, phase))) throw new Error("Fases de medição inválidas.");
  for (const interval of value.intervals) {
    if (!interval || Object.keys(interval).length !== 4 || !phases.includes(interval.phase) || !["ok", "error"].includes(interval.outcome)
      || !Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs) || interval.startMs < 0 || interval.endMs < interval.startMs || interval.endMs > value.wallMs) throw new Error("Intervalo de medição inválido.");
  }
  for (const phase of phases) {
    const selected = value.intervals.filter((interval) => interval.phase === phase);
    if (value.phaseMs[phase] !== (selected.length ? unionMs(selected) : null)) throw new Error("Total de fase diverge dos intervalos medidos.");
  }
  return structuredClone(value);
}

export function summarizeExecutionTimings(nodes) {
  const records = [], unknownNodes = [];
  for (const node of nodes) {
    if (!node.executionTiming) { unknownNodes.push(node.id); continue; }
    const timing = assertExecutionTiming(node.executionTiming.measurement);
    records.push({ nodeId: node.id, attemptId: node.executionTiming.attemptId, outcome: node.executionTiming.outcome, ...timing });
  }
  const overlap = [];
  let truncated = false;
  const workPhases = new Set(["submission", "polling", "download", "local-process", "publication"]);
  const windows = records.map((record) => {
    const merged = [];
    for (const interval of record.intervals.filter((i) => workPhases.has(i.phase)).sort((a, b) => a.startMs - b.startMs)) {
      const start = Date.parse(record.startedAt) + interval.startMs, end = Date.parse(record.startedAt) + interval.endMs;
      if (merged.length && start <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], end);
      else merged.push([start, end]);
    }
    return merged;
  });
  pairs: for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) {
    const left = records[a], right = records[b];
    let i = 0, j = 0, overlapMs = 0;
    while (i < windows[a].length && j < windows[b].length) {
      const l = windows[a][i], r = windows[b][j];
      overlapMs += Math.max(0, Math.min(l[1], r[1]) - Math.max(l[0], r[0]));
      if (l[1] <= r[1]) i++; else j++;
    }
    if (!overlapMs) continue;
    if (overlap.length >= 100) { truncated = true; break pairs; }
    overlap.push({ nodes: [left.nodeId, right.nodeId], overlapMs: Math.round(overlapMs * 1000) / 1000 });
  }
  return { schema: "mkt-videos/execution-timing-report@1", coverage: "latest-recorded-invocation-per-node",
    records: records.map(({ schema: _schema, intervals, ...record }) => ({ ...record, measuredIntervals: intervals.length })), unknownNodes,
    intervalSource: "execution-journal",
    overlap: { pairs: overlap, truncated, precision: "millisecond-wall-clock-anchor" },
    limitations: ["Tempos ausentes permanecem null; processamento interno do provedor não é observável.", "Fases podem conter outras fases; seus tempos não devem ser somados como tempo de parede.", "local-process mede a duração do subprocesso, não segundos de CPU. adapter-execution inclui etapas ainda não instrumentadas.", "Sobreposição usa somente intervalos instrumentados de submissão, polling, download, subprocesso e publicação; não conta espera.", "Retomadas parciais e falhas preservam apenas a última invocação registrada por nó nesta projeção; o journal conserva os eventos anteriores."] };
}
