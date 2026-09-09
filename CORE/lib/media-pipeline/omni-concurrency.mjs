// Concorrência do lote como perfil medido, não como número fixo.
//
// `parallel: 3` era um chute que nunca foi reavaliado. Aqui a largura vira uma
// faixa nomeada, e o controlador mede o que acontece dentro dela: latência,
// erro de provedor, fila, utilização e taxa de bloqueio. Se o provedor começa a
// recusar, a largura cai; enquanto tudo passa e há fila esperando, ela sobe até
// o teto do perfil — nunca acima.
//
// A regra que não muda com a velocidade: concorrência maior NÃO habilita retry.
// Este módulo não sabe reenviar nada. Rejeição e estado ambíguo continuam
// exigindo reconciliação humana, exatamente como antes.

export const CONCURRENCY_PROFILE_SCHEMA = "mkt-videos/batch-concurrency-profile@1";
export const CONCURRENCY_REPORT_SCHEMA = "mkt-videos/batch-concurrency-report@1";

export const CONCURRENCY_PROFILES = Object.freeze({
  conservative: Object.freeze({ id: "conservative", start: 2, min: 1, max: 2, description: "Provedor instável ou lote caro." }),
  balanced: Object.freeze({ id: "balanced", start: 3, min: 2, max: 3, description: "Padrão medido em produção." }),
  fast: Object.freeze({ id: "fast", start: 4, min: 2, max: 4, description: "Lote grande com provedor respondendo bem." }),
  // 8 workers é medição, não produção: serve para achar o joelho da curva.
  stress: Object.freeze({ id: "stress", start: 6, min: 2, max: 8, benchmarkOnly: true, description: "Somente benchmark." }),
});

/**
 * Perfil derivado do `parallel` que o lote já carrega. O teto é exatamente o
 * que era antes — nenhum lote fica mais lento por causa desta mudança — e o
 * piso é metade dele: o ganho aqui não é subir, é ter para onde descer quando o
 * provedor começa a recusar, em vez de insistir na mesma largura até o fim.
 */
export function profileForParallel(parallel) {
  const width = Number(parallel);
  if (!Number.isInteger(width) || width < 1 || width > 8) {
    throw new Error("parallel deve ser um inteiro entre 1 e 8 para derivar o perfil de concorrência.");
  }
  const named = Object.values(CONCURRENCY_PROFILES)
    .find((profile) => !profile.benchmarkOnly && profile.max === width && profile.start === width);
  if (named) return named;
  return Object.freeze({
    id: `parallel-${width}`,
    start: width,
    min: Math.max(1, Math.floor(width / 2)),
    max: width,
    description: `Teto herdado do --parallel ${width}.`,
  });
}

export function resolveConcurrencyProfile(value, { benchmark = false } = {}) {
  // Perfil já resolvido (o derivado de `parallel`, por exemplo) passa direto.
  if (value && typeof value === "object") {
    const { id, start, min, max } = value;
    if (!id || ![start, min, max].every((entry) => Number.isInteger(entry) && entry >= 1)) {
      throw new Error("Perfil de concorrência malformado: exige id, start, min e max inteiros.");
    }
    if (min > start || start > max) throw new Error(`Perfil ${id} inconsistente: exige min <= start <= max.`);
    if (value.benchmarkOnly && benchmark !== true) throw new Error(`O perfil ${id} só roda em benchmark explícito (benchmark: true).`);
    return value;
  }
  const id = String(value ?? "balanced").trim().toLowerCase();
  const profile = CONCURRENCY_PROFILES[id];
  if (!profile) throw new Error(`Perfil de concorrência desconhecido: ${value}. Use ${Object.keys(CONCURRENCY_PROFILES).join(", ")}.`);
  if (profile.benchmarkOnly && benchmark !== true) {
    throw new Error(`O perfil ${id} só roda em benchmark explícito (benchmark: true).`);
  }
  return profile;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index]);
}

/**
 * Controlador de largura. `acquire`/`release` cercam a tentativa; o que ele faz
 * entre uma e outra é só medir e ajustar a permissão para a próxima.
 */
export function createConcurrencyController({
  profile = "balanced",
  benchmark = false,
  clock = () => Date.now(),
  windowSize = 8,
  minSamples = 3,
  rejectionThreshold = 0.25,
} = {}) {
  const resolved = resolveConcurrencyProfile(profile, { benchmark });
  const startedAt = clock();
  const waiters = [];
  const samples = [];
  const queueSamples = [];
  const adjustments = [];
  let limit = resolved.start;
  let active = 0;
  let busyMs = 0;
  let peakActive = 0;

  function pump() {
    while (active < limit && waiters.length > 0) {
      active += 1;
      if (active > peakActive) peakActive = active;
      waiters.shift()();
    }
  }

  function adapt() {
    const window = samples.slice(-windowSize);
    if (window.length < minSamples) return;
    const refused = window.filter((sample) => sample.outcome === "provider_rejected" || sample.outcome === "ambiguous").length;
    const rate = refused / window.length;
    if (rate >= rejectionThreshold && limit > resolved.min) {
      limit -= 1;
      adjustments.push({ at: new Date().toISOString(), limit, direction: "down", reason: "provider_pushback", rejectionRate: round(rate) });
      return;
    }
    // Só sobe com fila esperando: aumentar largura sem demanda não acelera nada
    // e só aumenta a chance de o provedor recusar.
    if (rate === 0 && limit < resolved.max && waiters.length > 0) {
      limit += 1;
      adjustments.push({ at: new Date().toISOString(), limit, direction: "up", reason: "healthy_with_queue" });
      pump();
    }
  }

  return Object.freeze({
    profile: resolved,
    get limit() { return limit; },
    get active() { return active; },
    get pending() { return waiters.length; },

    observeQueue(depth) {
      queueSamples.push(Math.max(0, Number(depth) || 0));
    },

    async acquire() {
      if (active < limit) {
        active += 1;
        if (active > peakActive) peakActive = active;
      } else {
        await new Promise((resolve) => waiters.push(resolve));
      }
      return { startedAt: clock() };
    },

    release(token, { outcome = "completed" } = {}) {
      const latencyMs = Math.max(0, clock() - Number(token?.startedAt ?? clock()));
      busyMs += latencyMs;
      samples.push({ latencyMs, outcome: String(outcome) });
      active = Math.max(0, active - 1);
      adapt();
      pump();
      return latencyMs;
    },

    report() {
      const wallMs = Math.max(1, clock() - startedAt);
      const latencies = samples.map((sample) => sample.latencyMs);
      const outcomes = {};
      for (const sample of samples) outcomes[sample.outcome] = (outcomes[sample.outcome] ?? 0) + 1;
      const refused = (outcomes.provider_rejected ?? 0) + (outcomes.ambiguous ?? 0);
      return {
        schema: CONCURRENCY_REPORT_SCHEMA,
        profile: resolved.id,
        benchmark: Boolean(benchmark),
        configured: { start: resolved.start, min: resolved.min, max: resolved.max },
        finalLimit: limit,
        peakActive,
        items: samples.length,
        outcomes,
        latencyMs: {
          mean: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : null,
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          max: latencies.length ? Math.max(...latencies) : null,
        },
        providerRejectionRate: samples.length ? round(refused / samples.length) : 0,
        // Utilização real da largura concedida: 1,0 significa que os workers
        // nunca ficaram ociosos; 0,4 significa que o gargalo não é a largura.
        utilization: round(Math.min(1, busyMs / (wallMs * Math.max(1, limit)))),
        effectiveParallelism: round(busyMs / wallMs),
        queueDepth: {
          max: queueSamples.length ? Math.max(...queueSamples) : 0,
          mean: queueSamples.length ? round(queueSamples.reduce((total, value) => total + value, 0) / queueSamples.length) : 0,
        },
        wallMs,
        adjustments,
        policy: { autoRetry: false, reconciliation: "human", note: "concorrência não reenvia item recusado nem ambíguo" },
      };
    },
  });
}
