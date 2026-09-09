import assert from "node:assert/strict";
import test from "node:test";
import { runProductionPool } from "../lib/media-pipeline/production-pool.mjs";

test("pool faz preflight global, limita concorrência e não admite novos jobs após falha", async () => {
  let active = 0;
  let maximum = 0;
  let preflight = false;
  const started = [];
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const jobs = Array.from({ length: 6 }, (_, index) => ({
    id: `job-${index}`,
    async run() {
      assert.equal(preflight, true);
      started.push(index);
      active += 1;
      maximum = Math.max(maximum, active);
      if (index === 0) { release(); active -= 1; throw new Error("provider failed"); }
      await barrier;
      active -= 1;
      return index;
    },
  }));
  const result = await runProductionPool({ jobs, parallel: 2, preflight: async () => { preflight = true; } });
  assert.ok(maximum <= 2);
  assert.equal(result.rejected, 1);
  assert.ok(result.admitted <= 2);
  assert.equal(result.results.filter((entry) => entry.status === "not_admitted").length >= 4, true);
  assert.deepEqual(started.sort(), [0, 1]);
});

test("pool preserva todos os sucessos e eventos serializados", async () => {
  const events = [];
  const result = await runProductionPool({
    jobs: [1, 2, 3].map((id) => ({ id, run: async () => id * 2 })),
    parallel: 3,
    onEvent: async (event) => { events.push(`${event.event}:${event.id}`); },
  });
  assert.equal(result.fulfilled, 3);
  assert.equal(result.stopped, false);
  assert.equal(events.length, 6);
});

test("seis cenas com parallel 3 usam duas ondas e uma execução por cena", async () => {
  let active = 0;
  let maximum = 0;
  const calls = new Map();
  const result = await runProductionPool({
    jobs: Array.from({ length: 6 }, (_, index) => ({
      id: `scene-${index + 1}`,
      async run() {
        calls.set(index, (calls.get(index) ?? 0) + 1);
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return index;
      },
    })),
    parallel: 3,
  });
  assert.equal(maximum, 3);
  assert.equal(result.fulfilled, 6);
  assert.deepEqual([...calls.values()], [1, 1, 1, 1, 1, 1]);
});

test("falha isolada não mata a onda: um clipe recusado, os outros terminam", async () => {
  // Era exatamente isto que quebrava: numa onda de 40 peças, a de índice 1
  // recusada levava junto as 38 que nem tinham sido tentadas.
  const executados = [];
  const result = await runProductionPool({
    haltAfterConsecutiveFailures: 3,
    parallel: 1,
    jobs: Array.from({ length: 5 }, (_, index) => ({
      id: `cena-${index}`,
      async run() {
        executados.push(index);
        if (index === 1) throw new Error("provedor recusou o conteúdo desta cena");
        return index;
      },
    })),
  });
  assert.deepEqual(executados, [0, 1, 2, 3, 4]);
  assert.equal(result.fulfilled, 4);
  assert.equal(result.rejected, 1);
  assert.equal(result.stopped, false);
  assert.equal(result.results.filter((entry) => entry.status === "not_admitted").length, 0);
});

test("três falhas seguidas param a fila: aí não é a cena, é o provedor", async () => {
  const executados = [];
  const result = await runProductionPool({
    haltAfterConsecutiveFailures: 3,
    parallel: 1,
    jobs: Array.from({ length: 8 }, (_, index) => ({
      id: `cena-${index}`,
      async run() {
        executados.push(index);
        if (index >= 2) throw new Error("sessão expirada");
        return index;
      },
    })),
  });
  assert.deepEqual(executados, [0, 1, 2, 3, 4]);
  assert.equal(result.stopped, true);
  assert.equal(result.consecutiveFailuresAtHalt, 3);
  assert.equal(result.results.filter((entry) => entry.status === "not_admitted").length, 3);
  assert.match(result.results.at(-1).reason, /3_consecutive_failures/);
});

test("um sucesso zera a contagem, então falhas espalhadas não param nada", async () => {
  const result = await runProductionPool({
    haltAfterConsecutiveFailures: 2,
    parallel: 1,
    jobs: [false, true, false, true, false, true].map((falha, index) => ({
      id: `cena-${index}`,
      run: async () => { if (falha) throw new Error("recusa isolada"); return index; },
    })),
  });
  assert.equal(result.stopped, false);
  assert.equal(result.rejected, 3);
  assert.equal(result.fulfilled, 3);
});

test("null nunca para, e o padrão continua sendo o comportamento antigo", async () => {
  const nunca = await runProductionPool({
    haltAfterConsecutiveFailures: null,
    parallel: 1,
    jobs: Array.from({ length: 4 }, (_, index) => ({ id: index, run: async () => { throw new Error("tudo falha"); } })),
  });
  assert.equal(nunca.stopped, false);
  assert.equal(nunca.rejected, 4);
  assert.equal(nunca.haltAfterConsecutiveFailures, null);

  const padrao = await runProductionPool({
    parallel: 1,
    jobs: Array.from({ length: 4 }, (_, index) => ({
      id: index,
      run: async () => { if (index === 0) throw new Error("primeira falha"); return index; },
    })),
  });
  assert.equal(padrao.stopped, true);
  assert.equal(padrao.haltAfterConsecutiveFailures, 1);
  assert.equal(padrao.results.filter((entry) => entry.status === "not_admitted").length, 3);
});

test("limite inválido falha fechado", async () => {
  const job = [{ id: "x", run: async () => 1 }];
  await assert.rejects(() => runProductionPool({ jobs: job, haltAfterConsecutiveFailures: 0 }), /haltAfterConsecutiveFailures/);
  await assert.rejects(() => runProductionPool({ jobs: job, haltAfterConsecutiveFailures: -2 }), /haltAfterConsecutiveFailures/);
});

test("espera libera o único worker e readquire a vaga antes de continuar", async () => {
  const trace = [];
  let release;
  const remote = new Promise((resolve) => { release = resolve; });
  const result = await runProductionPool({ parallel: 1, jobs: [
    { id: "remote", run: async ({ waitWithoutWorker }) => {
      trace.push("submit");
      await waitWithoutWorker(() => remote);
      trace.push("collect");
    } },
    { id: "local", run: async () => { trace.push("local"); release(); } },
  ] });
  assert.deepEqual(trace, ["submit", "local", "collect"]);
  assert.equal(result.fulfilled, 2);
});

test("corte de novas admissões não abandona uma tentativa esperando", async () => {
  let release;
  const remote = new Promise((resolve) => { release = resolve; });
  const trace = [];
  const result = await runProductionPool({ parallel: 1, jobs: [
    { id: "accepted", run: async ({ waitWithoutWorker }) => { await waitWithoutWorker(() => remote); trace.push("collected"); } },
    { id: "failure", run: async () => { release(); throw new Error("rejeição"); } },
    { id: "new", run: async () => { trace.push("unexpected"); } },
  ] });
  assert.deepEqual(trace, ["collected"]);
  assert.equal(result.fulfilled, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.results[2].status, "not_admitted");
});

test("falha da espera retorna ao job e não perde a vaga nem a causa", async () => {
  const result = await runProductionPool({ parallel: 1, haltAfterConsecutiveFailures: null, jobs: [
    { id: "wait", run: async ({ waitWithoutWorker }) => waitWithoutWorker(async () => { throw new Error("consulta indisponível"); }) },
    { id: "next", run: async () => "ok" },
  ] });
  assert.equal(result.rejected, 1);
  assert.match(result.results[0].error, /consulta indisponível/);
  assert.equal(result.results[1].value, "ok");
});
