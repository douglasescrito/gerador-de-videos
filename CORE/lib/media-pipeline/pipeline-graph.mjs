// O pipeline como grafo: o que é independente roda junto, o que depende de
// decisão humana espera.
//
// A produção nunca foi uma fila; era executada como uma. Preparar prompts,
// escrever o brief musical e gerar as narrações não dependem um do outro, e
// música, efeitos e cenas visuais também não. Declarar as dependências de
// verdade permite ganhar tempo sem inventar atalho.
//
// O que NÃO paraleliza está declarado como barreira e é impossível de contornar
// por acidente: revisão antes de qualquer reenvio, aprovação do bloco corrigido,
// aceite das cenas antes da montagem, QA antes da publicação. Um nó de barreira
// nunca executa sozinho — sem decisão humana registrada, o grafo para e diz o
// que está esperando.

import { createLimiter } from "./concurrency.mjs";

export const PRODUCTION_GRAPH_SCHEMA = "mkt-videos/production-graph@1";
export const PRODUCTION_GRAPH_RUN_SCHEMA = "mkt-videos/production-graph-run@1";

export const NODE_KINDS = new Set(["local", "provider", "human"]);

/**
 * Grafo canônico da produção. `dependsOn` é a única fonte de ordem: quem não
 * aparece na lista de outro pode rodar em paralelo com ele.
 */
export const PRODUCTION_GRAPH = Object.freeze([
  { id: "roteiro", label: "Brief e roteiro", kind: "local", lane: "script", dependsOn: [] },

  { id: "prompts-visuais", label: "Preparar prompts visuais", kind: "local", lane: "visual", dependsOn: ["roteiro"] },
  { id: "brief-musical", label: "Preparar brief musical", kind: "local", lane: "music", dependsOn: ["roteiro"] },
  { id: "narracao-blocos", label: "Gerar narrações", kind: "provider", lane: "voice", dependsOn: ["roteiro"] },

  { id: "alinhamento", label: "Alinhamento Whisper", kind: "local", lane: "voice", dependsOn: ["narracao-blocos"] },
  // Barreira: o reenvio é decisão editorial, não consequência automática de uma
  // divergência medida.
  { id: "revisao-narracao", label: "Revisão ortográfica e lógica", kind: "human", gate: "human-decision", lane: "voice", dependsOn: ["alinhamento"] },
  { id: "reenvio-blocos", label: "Reenviar somente blocos aprovados", kind: "provider", lane: "voice", dependsOn: ["revisao-narracao"] },
  { id: "confirmacao-correcao", label: "Confirmar correções", kind: "human", gate: "human-decision", lane: "voice", dependsOn: ["reenvio-blocos"] },
  { id: "voz-master", label: "Narração-mestre", kind: "local", lane: "voice", dependsOn: ["confirmacao-correcao"] },

  { id: "cenas-visuais", label: "Gerar cenas Omni", kind: "provider", lane: "visual", dependsOn: ["prompts-visuais", "voz-master"] },
  { id: "musica", label: "Gerar trilha", kind: "provider", lane: "music", dependsOn: ["brief-musical", "voz-master"] },
  { id: "efeitos", label: "Cama de efeitos", kind: "local", lane: "sfx", dependsOn: ["voz-master"] },

  { id: "inspecao-cenas", label: "Inspeção técnica das cenas", kind: "local", lane: "visual", dependsOn: ["cenas-visuais"] },
  { id: "aceite-cenas", label: "Aceite das cenas", kind: "human", gate: "human-decision", lane: "visual", dependsOn: ["inspecao-cenas"] },

  { id: "mixagem", label: "Mixagem", kind: "local", lane: "assembly", dependsOn: ["voz-master", "musica", "efeitos"] },
  { id: "montagem", label: "Montagem final", kind: "local", lane: "assembly", dependsOn: ["mixagem", "aceite-cenas"] },

  { id: "contact-sheet", label: "Contact sheet e relatórios", kind: "local", lane: "report", dependsOn: ["montagem"] },
  { id: "acabamento", label: "Acabamento e entrega", kind: "local", lane: "assembly", dependsOn: ["montagem"] },
  { id: "qa", label: "QA técnico", kind: "local", lane: "qa", dependsOn: ["acabamento"] },
  { id: "publicacao", label: "Publicação externa", kind: "human", gate: "human-decision", lane: "qa", dependsOn: ["qa"] },
]);

/**
 * Grafo executável de um filme concreto. É o que o orquestrador escalona: os
 * ids são os mesmos nomes de estágio que já existem no `state.stages` e nos nós
 * do execution-plan, então nada aqui cria um segundo executor — só descreve
 * quem depende de quem, para o executor de sempre parar de enfileirar trabalho
 * que não tem relação nenhuma entre si.
 *
 * `run` cobre a fase anterior à aprovação humana; `resume` cobre a janela em
 * que montagem e mixagem podem andar juntas.
 */
export function buildFilmGraph(spec, { phase = "run", executionPlan = null } = {}) {
  const hasNarration = Boolean(spec?.narration);
  const hasMusic = Boolean(spec?.music);

  if (phase === "resume") {
    // Montagem (concatena os vídeos) e mixagem (voz + trilha + ambiência) não
    // trocam nada: só o mux precisa das duas prontas.
    const sceneAudio = spec?.audio?.sceneAudioGainDb != null;
    const separateMix = Boolean(hasNarration || hasMusic || spec?.audio?.ambienceFile || spec?.audio?.sfx?.cues?.length || sceneAudio) && (!executionPlan || executionPlan.nodes?.some((node) => node.id === "audio-mix"));
    const graph = [
      { id: "assembly", label: "Montagem das cenas", kind: "local", lane: "assembly", dependsOn: [] },
      ...(separateMix
        ? [
            { id: "audioMix", label: "Mixagem", kind: "local", lane: "assembly", dependsOn: sceneAudio ? ["assembly"] : [] },
            { id: "audioMux", label: "Master com áudio", kind: "local", lane: "assembly", dependsOn: ["assembly", "audioMix"] },
          ]
        : [{ id: "audioMux", label: "Master do filme", kind: "local", lane: "assembly", dependsOn: ["assembly"] }]),
    ];
    const stageFor = { assembly: "assembly", "audio-mix": "audioMix", master: "audioMux" };
    for (const planned of executionPlan?.nodes ?? []) {
      const stage = graph.find((node) => node.id === stageFor[planned.id]);
      if (!stage) continue;
      for (const dependency of planned.dependencies ?? []) {
        const dependencyStage = stageFor[dependency];
        if (dependencyStage && dependencyStage !== stage.id && !stage.dependsOn.includes(dependencyStage)) stage.dependsOn.push(dependencyStage);
      }
    }
    planGraphExecution(graph);
    return graph;
  }
  if (phase !== "run") throw new Error(`Fase de grafo desconhecida: ${phase}.`);

  // A geração musical não consome a voz. O ajuste final depende das duas.
  // Planos históricos podem declarar uma ordem mais restrita; a projeção
  // abaixo preserva essas dependências sem reescrever o plano congelado.
  const graph = [
    ...(hasNarration
      ? [
          { id: "tts", label: "Narração e alinhamento", kind: "provider", lane: "voice", dependsOn: [] },
          { id: "voice-probe", label: "Probe da voz mestre", kind: "local", lane: "voice", dependsOn: ["tts"] },
        ]
      : []),
    ...(hasMusic
      ? [
          { id: "music", label: "Trilha", kind: "provider", lane: "music", dependsOn: [] },
          { id: "musicFit", label: "Ajuste da trilha à duração", kind: "local", lane: "music", dependsOn: ["music", ...(hasNarration ? ["voice-probe"] : [])] },
        ]
      : []),
    {
      id: "alignment",
      label: "Registro de alinhamento no journal",
      kind: "local",
      lane: "script",
      dependsOn: hasNarration ? ["voice-probe"] : [],
    },
    { id: "timeline-lock", label: "Trava da timeline", kind: "local", lane: "script", dependsOn: ["alignment", ...(hasMusic ? ["musicFit"] : [])] },
    { id: "draft", label: "Keyframes e storyboard", kind: "provider", lane: "visual", dependsOn: ["timeline-lock"] },
    { id: "animatic", label: "Animatic", kind: "local", lane: "visual", dependsOn: ["draft", "timeline-lock"] },
  ];
  if (!executionPlan) return graph;
  const stageFor = (id) => {
    if (id === "voice-master" || id.startsWith("voice:") || id.startsWith("video:narration:")) return "tts";
    if (id.startsWith("keyframe:")) return "draft";
    if (id === "music-source") return "music";
    if (id === "music-fit") return "musicFit";
    return graph.some((node) => node.id === id) ? id : null;
  };
  const byStage = new Map(graph.map((node) => [node.id, node]));
  for (const node of executionPlan.nodes ?? []) {
    const stage = stageFor(node.id);
    if (!stage || !byStage.has(stage)) continue;
    for (const dependency of node.dependencies ?? []) {
      const dependencyStage = stageFor(dependency);
      if (!dependencyStage || !byStage.has(dependencyStage)) {
        throw new Error(`Dependência do plano sem etapa executável: ${node.id} -> ${dependency}.`);
      }
      if (dependencyStage !== stage && !byStage.get(stage).dependsOn.includes(dependencyStage)) {
        byStage.get(stage).dependsOn.push(dependencyStage);
      }
    }
  }
  // Valida também ciclos introduzidos por um plano que não cabe nos estágios
  // da fachada; essa recusa acontece antes de iniciar qualquer operação.
  planGraphExecution(graph);
  return graph;
}

export function assertProductionGraph(nodes = PRODUCTION_GRAPH) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("O grafo precisa de ao menos um nó.");
  const byId = new Map();
  for (const node of nodes) {
    const id = String(node?.id ?? "").trim();
    if (!id) throw new Error("Nó do grafo sem id.");
    if (byId.has(id)) throw new Error(`Nó repetido no grafo: ${id}.`);
    if (!NODE_KINDS.has(String(node.kind))) throw new Error(`Nó ${id} tem kind inválido: ${node.kind}.`);
    if (!Array.isArray(node.dependsOn)) throw new Error(`Nó ${id} precisa declarar dependsOn.`);
    byId.set(id, node);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(String(dependency))) throw new Error(`Nó ${node.id} depende de ${dependency}, que não existe.`);
      if (String(dependency) === String(node.id)) throw new Error(`Nó ${node.id} depende de si mesmo.`);
    }
  }
  return byId;
}

/**
 * Níveis topológicos: cada nível é um conjunto que pode rodar em paralelo.
 * Um ciclo é erro de projeto do grafo e falha aqui, não em produção.
 */
export function planGraphExecution(nodes = PRODUCTION_GRAPH) {
  const byId = assertProductionGraph(nodes);
  const pending = new Map([...byId.entries()].map(([id, node]) => [id, new Set(node.dependsOn.map(String))]));
  const levels = [];
  const settled = new Set();

  while (settled.size < byId.size) {
    const ready = [...pending.entries()]
      .filter(([id, dependencies]) => !settled.has(id) && [...dependencies].every((dependency) => settled.has(dependency)))
      .map(([id]) => id);
    if (ready.length === 0) {
      const stuck = [...byId.keys()].filter((id) => !settled.has(id));
      throw new Error(`O grafo tem ciclo ou dependência impossível entre: ${stuck.join(", ")}.`);
    }
    levels.push(ready);
    for (const id of ready) settled.add(id);
  }

  const gates = [...byId.values()].filter((node) => node.gate === "human-decision").map((node) => node.id);
  return {
    schema: PRODUCTION_GRAPH_SCHEMA,
    nodes: [...byId.values()].map((node) => ({ ...node })),
    levels,
    order: levels.flat(),
    humanGates: gates,
    maxParallelism: Math.max(...levels.map((level) => level.length)),
  };
}

/**
 * Caminho crítico com custos medidos. Serve para saber se aumentar paralelismo
 * ainda ajuda: se o caminho crítico já domina o total, o próximo ganho tem que
 * vir de acelerar uma etapa, não de rodar mais coisas ao mesmo tempo.
 */
export function criticalPath(nodes = PRODUCTION_GRAPH, costsMs = {}) {
  const byId = assertProductionGraph(nodes);
  const best = new Map();
  const from = new Map();
  for (const id of planGraphExecution(nodes).order) {
    const node = byId.get(id);
    const own = Number(costsMs[id] ?? 0);
    let bestDependency = null;
    let bestCost = 0;
    for (const dependency of node.dependsOn.map(String)) {
      const cost = best.get(dependency) ?? 0;
      if (cost >= bestCost) {
        bestCost = cost;
        bestDependency = dependency;
      }
    }
    best.set(id, bestCost + own);
    from.set(id, bestDependency);
  }
  let tail = [...best.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const path = [];
  while (tail) {
    path.unshift(tail);
    tail = from.get(tail) ?? null;
  }
  return { path, totalMs: Math.round(Math.max(0, ...best.values())) };
}

function blockedReason(node, statuses) {
  const failed = node.dependsOn.map(String).filter((dependency) => statuses.get(dependency) === "failed");
  if (failed.length) return { reason: "dependency_failed", dependencies: failed };
  const waiting = node.dependsOn.map(String).filter((dependency) => statuses.get(dependency) === "awaiting_human");
  if (waiting.length) return { reason: "awaiting_human_decision", dependencies: waiting };
  const rejected = node.dependsOn.map(String).filter((dependency) => statuses.get(dependency) === "rejected");
  if (rejected.length) return { reason: "dependency_rejected", dependencies: rejected };
  return { reason: "dependency_blocked", dependencies: node.dependsOn.map(String).filter((dependency) => statuses.get(dependency) === "blocked") };
}

/**
 * Executa o grafo respeitando dependências e barreiras humanas.
 *
 * @param {object} args
 * @param {Array} [args.graph] nós do grafo
 * @param {(node: any) => Promise<any>} args.execute executor de um nó
 * @param {Record<string, "approved"|"rejected">} [args.decisions] decisões humanas já registradas
 * @param {number} [args.concurrency] largura máxima por nível
 * @param {(event: any) => void} [args.onEvent]
 */
export async function runProductionGraph({
  graph = PRODUCTION_GRAPH,
  execute,
  decisions = {},
  concurrency = 4,
  onEvent = null,
  metrics = null,
} = {}) {
  if (typeof execute !== "function") throw new Error("runProductionGraph exige a função execute.");
  const plan = planGraphExecution(graph);
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const dependents = new Map(plan.nodes.map((node) => [node.id, []]));
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn.map(String)) dependents.get(dependency).push(node.id);
  }
  const remaining = new Map(plan.nodes.map((node) => [node.id, node.dependsOn.length]));
  const statuses = new Map();
  const results = [];
  const startedAt = new Date();
  const limiter = createLimiter(concurrency);
  const inFlight = new Set();
  const pending = new Set();

  const emit = (event) => { if (onEvent) onEvent(event); };

  // Liberação por dependência concluída, não por nível topológico. Um nó cujo
  // predecessor terminou entra na fila na hora; ele não espera o irmão lento e
  // independente do mesmo nível — que era exatamente a barreira artificial que
  // anulava o ganho do DAG.
  function settle(id, status, extra = {}) {
    statuses.set(id, status);
    results.push({ id, status, ...extra });
    const satisfied = status === "completed" || status === "approved";
    for (const dependent of dependents.get(id) ?? []) {
      remaining.set(dependent, remaining.get(dependent) - 1);
      if (!satisfied) continue;
      if (remaining.get(dependent) === 0 && !statuses.has(dependent)) release(dependent);
    }
    if (!satisfied) {
      // Propaga o bloqueio por toda a jusante, com o motivo nomeado na origem.
      for (const dependent of dependents.get(id) ?? []) {
        if (statuses.has(dependent) || inFlight.has(dependent)) continue;
        settle(dependent, "blocked", blockedReason(byId.get(dependent), statuses));
        emit({ type: "node_blocked", id: dependent });
      }
    }
  }

  function release(id) {
    const node = byId.get(id);
    // Barreira: nada aqui roda por inferência. Sem decisão registrada, o grafo
    // para neste ponto e o que vem depois fica explicitamente bloqueado.
    if (node.gate === "human-decision") {
      const decision = String(decisions?.[id] ?? "").toLowerCase();
      if (decision !== "approved") {
        const status = decision === "rejected" ? "rejected" : "awaiting_human";
        settle(id, status, { gate: node.gate, decision: decision || null });
        emit({ type: status === "rejected" ? "node_rejected" : "node_awaiting_human", id });
        return;
      }
    }
    inFlight.add(id);
    const promise = limiter.run(async () => {
      const span = metrics?.open(`graph:${id}`, { lane: node.lane, kind: node.kind });
      span?.begin();
      try {
        const value = await execute(node);
        span?.end({ status: "ok" });
        settle(id, node.gate === "human-decision" ? "approved" : "completed", {
          value: value ?? null,
          ...(node.gate ? { gate: node.gate, decision: "approved" } : {}),
        });
        emit({ type: "node_completed", id });
      } catch (error) {
        span?.end({ status: "error", error });
        settle(id, "failed", { error: String(error?.message ?? error) });
        emit({ type: "node_failed", id, error: String(error?.message ?? error) });
      } finally {
        inFlight.delete(id);
        pending.delete(promise);
      }
    });
    pending.add(promise);
  }

  for (const [id, count] of remaining) if (count === 0) release(id);
  // Cada nó concluído pode liberar outros; o run só termina quando não há mais
  // nada em voo nem nada recém-liberado.
  while (pending.size > 0) await Promise.race([...pending]).catch(() => {});

  // Execução é paralela, relatório não: a ordem do grafo é estável para que dois
  // runs iguais produzam o mesmo documento.
  results.sort((left, right) => plan.order.indexOf(left.id) - plan.order.indexOf(right.id));
  const byStatus = (status) => results.filter((entry) => entry.status === status).map((entry) => entry.id);
  const failed = byStatus("failed");
  const awaiting = byStatus("awaiting_human");
  const rejected = byStatus("rejected");
  return {
    schema: PRODUCTION_GRAPH_RUN_SCHEMA,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: failed.length ? "failed" : rejected.length ? "rejected" : awaiting.length ? "awaiting_human" : "completed",
    completed: byStatus("completed"),
    approved: byStatus("approved"),
    failed,
    awaitingHuman: awaiting,
    rejected,
    blocked: byStatus("blocked"),
    nodes: results,
    plan: { levels: plan.levels, humanGates: plan.humanGates, maxParallelism: plan.maxParallelism },
  };
}
