import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionGraph,
  buildFilmGraph,
  criticalPath,
  planGraphExecution,
  PRODUCTION_GRAPH,
  runProductionGraph,
} from "../lib/media-pipeline/pipeline-graph.mjs";

test("resume conserva master legado e projeta dependências explícitas de montagem/mix", () => {
  const spec = { narration: { text: "voz" } };
  const legacy = { nodes: [{ id: "assembly", dependencies: ["clip-duration:a"] }, { id: "master", dependencies: ["assembly", "voice-master"] }] };
  const oldGraph = buildFilmGraph(spec, { phase: "resume", executionPlan: legacy });
  assert.deepEqual(oldGraph.map((node) => node.id), ["assembly", "audioMux"]);
  const current = { nodes: [...legacy.nodes, { id: "audio-mix", dependencies: ["voice-master", "assembly"] }] };
  const currentGraph = buildFilmGraph(spec, { phase: "resume", executionPlan: current });
  assert.deepEqual(currentGraph.find((node) => node.id === "audioMix").dependsOn, ["assembly"]);
  assert.deepEqual(currentGraph.find((node) => node.id === "audioMux").dependsOn, ["assembly", "audioMix"]);
});

test("grafo do filme inicia trilha e voz juntas, mantendo apenas o fit dependente da voz", () => {
  const graph = buildFilmGraph({ narration: { text: "voz" }, music: { mode: "generated" } });
  assert.deepEqual(graph.find((node) => node.id === "music").dependsOn, []);
  assert.deepEqual(graph.find((node) => node.id === "tts").dependsOn, []);
  assert.deepEqual(graph.find((node) => node.id === "musicFit").dependsOn.sort(), ["music", "voice-probe"]);
});

test("grafo respeita dependência mais restrita do plano congelado e recusa nó não mapeável", () => {
  const spec = { narration: { text: "voz" }, music: { mode: "generated" } };
  const executionPlan = { nodes: [
    { id: "voice-master", dependencies: [] },
    { id: "voice-probe", dependencies: ["voice-master"] },
    { id: "music-source", dependencies: ["voice-probe"] },
  ] };
  const snapshot = JSON.stringify(executionPlan);
  const graph = buildFilmGraph(spec, { executionPlan });
  assert.deepEqual(graph.find((node) => node.id === "music").dependsOn, ["voice-probe"]);
  assert.equal(JSON.stringify(executionPlan), snapshot);
  assert.throws(() => buildFilmGraph(spec, {
    executionPlan: { nodes: [{ id: "music-source", dependencies: ["etapa-futura"] }] },
  }), /Dependência do plano sem etapa executável/);
});

const approveAll = Object.fromEntries(
  PRODUCTION_GRAPH.filter((node) => node.gate === "human-decision").map((node) => [node.id, "approved"]),
);

test("o grafo canônico é válido e paraleliza o que não depende de decisão", () => {
  const plan = planGraphExecution();
  assert.ok(plan.maxParallelism >= 3);
  // Preparo de prompts, brief musical e narrações saem juntos do roteiro.
  const level = plan.levels.find((entries) => entries.includes("narracao-blocos"));
  assert.ok(level.includes("prompts-visuais"));
  assert.ok(level.includes("brief-musical"));
  // Música, efeitos e cenas visuais convivem no mesmo nível.
  const creative = plan.levels.find((entries) => entries.includes("musica"));
  assert.ok(creative.includes("efeitos"));
  assert.deepEqual(
    plan.humanGates,
    ["revisao-narracao", "confirmacao-correcao", "aceite-cenas", "publicacao"],
  );
});

test("a ordem editorial obrigatória continua sequencial", () => {
  const plan = planGraphExecution();
  const at = (id) => plan.order.indexOf(id);
  assert.ok(at("alinhamento") < at("revisao-narracao"), "revisão vem depois do alinhamento");
  assert.ok(at("revisao-narracao") < at("reenvio-blocos"), "reenvio nunca precede a revisão");
  assert.ok(at("reenvio-blocos") < at("confirmacao-correcao"));
  assert.ok(at("aceite-cenas") < at("montagem"), "montagem só depois do aceite das cenas");
  assert.ok(at("qa") < at("publicacao"), "publicação só depois do QA");
});

test("grafo com ciclo ou dependência inexistente falha no plano, não em produção", () => {
  assert.throws(() => planGraphExecution([
    { id: "a", kind: "local", dependsOn: ["b"] },
    { id: "b", kind: "local", dependsOn: ["a"] },
  ]), /ciclo/);
  assert.throws(() => assertProductionGraph([{ id: "a", kind: "local", dependsOn: ["fantasma"] }]), /não existe/);
  assert.throws(() => assertProductionGraph([{ id: "a", kind: "inventado", dependsOn: [] }]), /kind inválido/);
});

test("sem decisão humana o grafo para e diz o que está esperando", async () => {
  const executed = [];
  const run = await runProductionGraph({
    execute: async (node) => { executed.push(node.id); },
    decisions: {},
  });
  assert.equal(run.status, "awaiting_human");
  assert.deepEqual(run.awaitingHuman, ["revisao-narracao"]);
  // Reenvio é o que a barreira existe para impedir.
  assert.equal(executed.includes("reenvio-blocos"), false);
  assert.ok(run.blocked.includes("reenvio-blocos"));
  const blockedNode = run.nodes.find((node) => node.id === "reenvio-blocos");
  assert.equal(blockedNode.reason, "awaiting_human_decision");
  // O que não depende da revisão roda mesmo assim.
  assert.ok(executed.includes("prompts-visuais"));
  assert.ok(executed.includes("brief-musical"));
});

test("decisão rejeitada bloqueia a jusante sem executar nada", async () => {
  const executed = [];
  const run = await runProductionGraph({
    execute: async (node) => { executed.push(node.id); },
    decisions: { ...approveAll, "aceite-cenas": "rejected" },
  });
  assert.equal(run.status, "rejected");
  assert.deepEqual(run.rejected, ["aceite-cenas"]);
  assert.equal(executed.includes("montagem"), false);
  assert.ok(run.blocked.includes("montagem"));
});

test("com todas as decisões o grafo completa e o paralelismo é real", async () => {
  let active = 0;
  let peak = 0;
  const run = await runProductionGraph({
    decisions: approveAll,
    concurrency: 4,
    execute: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    },
  });
  assert.equal(run.status, "completed");
  assert.equal(run.failed.length, 0);
  assert.ok(peak >= 2, `esperava execução simultânea, medi ${peak}`);
  assert.deepEqual(run.approved, ["revisao-narracao", "confirmacao-correcao", "aceite-cenas", "publicacao"]);
});

test("falha em um ramo não derruba os ramos independentes", async () => {
  const executed = [];
  const run = await runProductionGraph({
    decisions: approveAll,
    execute: async (node) => {
      if (node.id === "musica") throw new Error("provedor de trilha fora do ar");
      executed.push(node.id);
    },
  });
  assert.equal(run.status, "failed");
  assert.deepEqual(run.failed, ["musica"]);
  assert.ok(executed.includes("cenas-visuais"), "o ramo visual continua");
  assert.ok(run.blocked.includes("mixagem"), "a mixagem depende da trilha e fica bloqueada");
  assert.equal(run.nodes.find((node) => node.id === "mixagem").reason, "dependency_failed");
});

test("nó pronto não espera irmão lento e independente do mesmo nível", async () => {
  // `rapido` e `lento` saem juntos da raiz. `depoisDoRapido` depende só do
  // rápido: com liberação por nível ele esperaria os 120ms do lento; com
  // liberação por dependência ele começa assim que o rápido termina.
  const graph = [
    { id: "raiz", kind: "local", dependsOn: [] },
    { id: "lento", kind: "local", dependsOn: ["raiz"] },
    { id: "rapido", kind: "local", dependsOn: ["raiz"] },
    { id: "depoisDoRapido", kind: "local", dependsOn: ["rapido"] },
  ];
  const inicio = new Map();
  const fim = new Map();
  const run = await runProductionGraph({
    graph,
    concurrency: 4,
    execute: async (node) => {
      inicio.set(node.id, Date.now());
      await new Promise((resolve) => setTimeout(resolve, node.id === "lento" ? 120 : 5));
      fim.set(node.id, Date.now());
    },
  });
  assert.equal(run.status, "completed");
  // O dependente do rápido começa antes de o lento terminar.
  assert.ok(
    inicio.get("depoisDoRapido") < fim.get("lento"),
    `depoisDoRapido começou em ${inicio.get("depoisDoRapido")} e lento terminou em ${fim.get("lento")}`,
  );
});

test("o limite de concorrência é respeitado mesmo liberando por dependência", async () => {
  const graph = Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, kind: "local", dependsOn: [] }));
  let ativo = 0;
  let pico = 0;
  await runProductionGraph({
    graph,
    concurrency: 2,
    execute: async () => {
      ativo += 1;
      pico = Math.max(pico, ativo);
      await new Promise((resolve) => setTimeout(resolve, 10));
      ativo -= 1;
    },
  });
  assert.ok(pico <= 2, `concorrência estourou: ${pico}`);
});

test("caminho crítico aponta onde ainda vale acelerar", () => {
  const costs = { "narracao-blocos": 600_000, alinhamento: 90_000, "cenas-visuais": 900_000, montagem: 120_000 };
  const { path, totalMs } = criticalPath(PRODUCTION_GRAPH, costs);
  assert.ok(path.includes("cenas-visuais"));
  assert.ok(path.includes("narracao-blocos"));
  assert.equal(totalMs, 600_000 + 90_000 + 900_000 + 120_000);
});
