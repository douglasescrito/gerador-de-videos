export const PRODUCTION_POOL_SCHEMA = "mkt-videos/production-pool@1";

/**
 * Parar a fila na primeira falha existe por um motivo bom: se o provedor está
 * recusando tudo — sessão expirada, cota no fim, serviço fora —, insistir com
 * mais trinta chamadas só queima cota. O preço era o outro extremo: um único
 * clipe recusado matava a onda inteira, e trinta e três peças que nem tinham
 * sido tentadas voltavam como `not_admitted`.
 *
 * `haltAfterConsecutiveFailures` separa os dois casos sem precisar adivinhar a
 * forma do erro. Falha isolada no meio de sucessos é problema daquele job e a
 * fila segue; falhas em sequência, sem nenhum sucesso entre elas, são sintoma de
 * provedor e a fila para. Um sucesso zera a contagem.
 *
 * O padrão é 1, que é exatamente o comportamento antigo — quem não escolher
 * nada continua protegido como antes.
 */
export async function runProductionPool({
  jobs,
  parallel = 3,
  preflight = null,
  onEvent = null,
  haltAfterConsecutiveFailures = 1,
} = {}) {
  if (!Array.isArray(jobs) || !jobs.length) throw new Error("Production pool exige jobs.");
  const concurrency = Number(parallel);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("parallel deve ser inteiro entre 1 e 8.");
  const limiteFalhas = haltAfterConsecutiveFailures === null ? Number.POSITIVE_INFINITY : Number(haltAfterConsecutiveFailures);
  if (!(limiteFalhas >= 1)) throw new Error("haltAfterConsecutiveFailures deve ser inteiro >= 1, ou null para nunca parar.");
  const ids = new Set();
  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job.run !== "function") throw new Error(`Job ${index + 1} exige run.`);
    const id = String(job.id ?? index + 1);
    if (ids.has(id)) throw new Error(`Job duplicado: ${id}.`);
    ids.add(id);
  }
  if (preflight) await preflight(jobs);
  let eventQueue = Promise.resolve();
  const emit = (event) => {
    if (!onEvent) return Promise.resolve();
    eventQueue = eventQueue.then(() => onEvent(event));
    return eventQueue;
  };
  const results = Array(jobs.length).fill(null);
  let cursor = 0;
  let stopped = false;
  let falhasSeguidas = 0;
  let falhasNoCorte = 0;
  let active = 0;
  let pending = 0;
  const continuations = [];
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  function dispatch() {
    while (active < concurrency) {
      // Uma tentativa já admitida sempre pode concluir, mesmo após o corte
      // de novas admissões. Retomadas não ficam atrás de toda a fila nova.
      if (continuations.length) {
        active += 1;
        continuations.shift()();
      } else if (!stopped && cursor < jobs.length) {
        active += 1;
        pending += 1;
        void runJob(cursor++);
      } else break;
    }
    if (pending === 0 && (stopped || cursor >= jobs.length)) settle();
  }
  async function runJob(index) {
    const job = jobs[index];
    const id = String(job.id ?? index + 1);
    let ownsWorker = true;
    let waiting = false;
    const waitWithoutWorker = async (wait) => {
      if (typeof wait !== "function" || waiting || !ownsWorker) throw new Error("Espera do pool exige função e uma única espera ativa por job.");
      waiting = true;
      ownsWorker = false;
      active -= 1;
      // Somente a espera é destacada. A continuação precisa readquirir
      // a vaga antes de executar a próxima fase local.
      dispatch();
      let value; let failure; let failed = false;
      try {
        await emit({ event: "job_waiting", id, index });
        value = await wait();
      } catch (error) { failed = true; failure = error; }
      await new Promise((resolve) => {
        continuations.push(() => { ownsWorker = true; waiting = false; resolve(); });
        dispatch();
      });
      await emit({ event: "job_resumed", id, index });
      if (failed) throw failure;
      return value;
    };
    try {
      await emit({ event: "job_started", id, index });
      const value = await job.run({ waitWithoutWorker });
      results[index] = { id, index, status: "fulfilled", value };
      falhasSeguidas = 0;
      await emit({ event: "job_completed", id, index });
    } catch (error) {
      results[index] = { id, index, status: "rejected", error: error?.message ?? String(error), cause: error };
      falhasSeguidas += 1;
      if (falhasSeguidas >= limiteFalhas) {
        stopped = true;
        falhasNoCorte = falhasSeguidas;
      }
      await emit({ event: "job_failed", id, index, error: results[index].error, consecutiveFailures: falhasSeguidas, halting: stopped }).catch(() => {});
    } finally {
      if (ownsWorker) active -= 1;
      pending -= 1;
      dispatch();
    }
  }
  dispatch();
  await finished;
  for (let index = 0; index < jobs.length; index += 1) if (!results[index]) results[index] = { id: String(jobs[index].id ?? index + 1), index, status: "not_admitted", reason: `pool_stopped_after_${falhasNoCorte}_consecutive_failures` };
  await eventQueue;
  return {
    schema: PRODUCTION_POOL_SCHEMA,
    parallel: concurrency,
    stopped,
    haltAfterConsecutiveFailures: Number.isFinite(limiteFalhas) ? limiteFalhas : null,
    consecutiveFailuresAtHalt: stopped ? falhasNoCorte : 0,
    admitted: results.filter((entry) => entry.status !== "not_admitted").length,
    fulfilled: results.filter((entry) => entry.status === "fulfilled").length,
    rejected: results.filter((entry) => entry.status === "rejected").length,
    results,
  };
}
