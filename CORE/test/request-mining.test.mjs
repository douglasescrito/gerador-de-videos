import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_INSIGHT_SCHEMA,
  assertArchiveInsight,
  construirArchiveInsight,
  extrairCandidatoDeAchado,
  minerarCorrelacaoComVeredito,
  minerarDeltasDePedido,
  minerarLacunasDeCobertura,
  minerarVocabularioDePedido,
} from "../lib/media-pipeline/request-mining.mjs";

const AGORA = new Date("2026-08-14T12:00:00.000Z");

function linha(userPrompt, effectivePrompt, extras = {}) {
  return { userPrompt, effectivePrompt, directionPreset: "cinema@1", task: "image-to-video", aspectRatio: "16:9", ...extras };
}

test("delta revela a regra que o preset aplica ao pedido, com n visível", () => {
  const linhas = [
    linha("mesa de madeira", "mesa de madeira, shot on 35mm, shallow depth"),
    linha("praia ao amanhecer", "praia ao amanhecer, shot on 35mm, shallow depth"),
    linha("rosto sorrindo", "rosto sorrindo, shot on 35mm, shallow depth"),
  ];
  const { presets, comparaveis } = minerarDeltasDePedido(linhas, { minimoAmostra: 3 });
  assert.equal(comparaveis, 3);
  const cinema = presets.find((entrada) => entrada.preset === "cinema@1");
  assert.equal(cinema.n, 3);
  assert.equal(cinema.evidenciaSuficiente, true);
  assert.equal(cinema.formato, "preset-sufixa-o-pedido");
  const acrescentados = cinema.termosAcrescentados.map((entrada) => entrada.termo);
  assert.ok(acrescentados.includes("35mm"));
  assert.ok(acrescentados.includes("shallow"));
  // O que veio do pedido nunca pode aparecer como regra do preset.
  assert.ok(!acrescentados.includes("madeira"));
});

test("amostra abaixo do mínimo é publicada como evidência insuficiente, nunca omitida", () => {
  const { presets } = minerarDeltasDePedido([linha("gato", "gato, neon")], { minimoAmostra: 5 });
  assert.equal(presets.length, 1);
  assert.equal(presets[0].n, 1);
  assert.equal(presets[0].evidenciaSuficiente, false);
});

test("pedido idêntico ao efetivo não conta como tradução", () => {
  const { comparaveis } = minerarDeltasDePedido([linha("mesa", "mesa"), linha("  mesa  ", "mesa")]);
  assert.equal(comparaveis, 0);
});

test("vocabulário ignora palavras vazias e acha o que é pedido junto", () => {
  const linhas = [
    linha("uma mesa de madeira com luz quente", "x"),
    linha("a mesa de madeira ao entardecer", "x"),
    linha("mesa de madeira e luz quente", "x"),
  ];
  const { termos, coocorrencias, pedidos } = minerarVocabularioDePedido(linhas, { minimoCoocorrencia: 3 });
  assert.equal(pedidos, 3);
  const encontrados = termos.map((entrada) => entrada.termo);
  assert.ok(encontrados.includes("mesa"));
  assert.ok(encontrados.includes("madeira"));
  assert.ok(!encontrados.includes("uma"), "palavra vazia não pode virar vocabulário");
  assert.ok(coocorrencias.some((entrada) => entrada.termos.includes("madeira") && entrada.termos.includes("mesa")));
});

test("lacunas listam o que nunca foi pedido, não só o que foi", () => {
  const relatorio = minerarLacunasDeCobertura([linha("a", "b")], {
    presets: ["cinema@1", "flat-2d@1"],
    tarefas: ["image-to-video", "text-to-video"],
    formatos: ["16:9", "9:16"],
  });
  assert.equal(relatorio.espacoDeclarado, 8);
  assert.equal(relatorio.espacoExercitado, 1);
  assert.equal(relatorio.fracaoExercitada, 0.125);
  assert.equal(relatorio.naoTentadas.length, 7);
  assert.ok(relatorio.naoTentadas.includes("flat-2d@1 × text-to-video × 9:16"));
});

test("as duas taxonomias de tarefa continuam sendo coisas distintas", async () => {
  // Fronteira deliberada, não divergência: `text-to-video` é operação de
  // capability; `text_to_video` é tarefa de geração. Se alguém "uniformizar"
  // as duas, este teste cai antes de a mineração começar a mentir.
  const { PROVIDER_CAPABILITIES } = await import("../lib/media-pipeline/provider-registry.mjs");
  assert.ok(PROVIDER_CAPABILITIES["gemini-omni"].operations.includes("text-to-video"));
  const { compileFilmSpec } = await import("../lib/media-pipeline/film-compiler.mjs");
  const plano = compileFilmSpec({
    schema: "mkt-videos/film-spec@2",
    name: "fronteira",
    timeline: { fps: { numerator: 24, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 },
    scenes: [{ id: "s1", role: "spectacle", visualPrompt: "p", generationTask: "text-to-video", durationHint: 1 }],
    formats: { master: "16:9", variants: [] },
    narration: { mode: "none", text: null, blocks: [] },
    music: { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    qa: { enabled: false }, captions: { mode: "none" }, reuse: { policy: "off" },
    execution: { concurrency: { draft: 3, video: 3, localCpu: 1 }, budget: {}, providers: {} },
    finishing: { audio: {}, assembly: {}, ending: null, delivery: null },
  });
  assert.equal(plano.spec.scenes[0].generationTask, "text_to_video", "a spec normaliza para underscore");
});

test("tarefa com underscore do catálogo casa com o hífen dos registries", () => {
  // O acervo real grava `text_to_video`; a receita declara `text-to-video`.
  const relatorio = minerarLacunasDeCobertura(
    [linha("a", "b", { task: "text_to_video", directionPreset: "flat-2d@1" })],
    { presets: ["flat-2d@1"], tarefas: ["text-to-video"], formatos: ["16:9"] },
  );
  assert.equal(relatorio.espacoExercitado, 1, "divergência de taxonomia não pode inventar lacuna");
  assert.deepEqual(relatorio.naoTentadas, []);
});

test("relatório nasce sem autoridade e é determinístico", () => {
  const linhas = [linha("mesa", "mesa, neon"), linha("praia", "praia, neon")];
  const registries = { presets: ["cinema@1"], tarefas: ["image-to-video"], formatos: ["16:9"] };
  const insight = construirArchiveInsight({ rootScopeId: "client:focus", linhas, registries, geradoEm: AGORA });
  assert.equal(insight.schema, ARCHIVE_INSIGHT_SCHEMA);
  assert.equal(insight.authority, "none");
  assert.equal(insight.plannerInfluence, "none");
  assert.equal(insight.changed, false);
  assert.equal(insight.providerCalls, 0);
  assert.equal(insight.universo.comTraducao, 2);
  assert.equal(insight.universo.julgados, 0);
  assert.equal(assertArchiveInsight(insight), insight);
  const repetido = construirArchiveInsight({ rootScopeId: "client:focus", linhas, registries, geradoEm: AGORA });
  assert.equal(repetido.fingerprint, insight.fingerprint);
});

test("correlação publica a linha mesmo sem amostra, marcada como insuficiente", () => {
  const linhas = [
    linha("a", "b", { review: "approved" }),
    linha("c", "d", { review: "rejected" }),
    linha("e", "f", { review: "approved", directionPreset: "flat-2d@1" }),
    linha("g", "h", {}),
  ];
  const relatorio = minerarCorrelacaoComVeredito(linhas, { minimoAmostra: 20 });
  assert.equal(relatorio.julgados, 3);
  assert.equal(relatorio.conclusivo, false, "amostra pequena nunca pode virar conclusão");
  const cinema = relatorio.presets.find((entrada) => entrada.preset === "cinema@1");
  assert.equal(cinema.n, 2);
  assert.equal(cinema.taxaAprovacao, 0.5);
  assert.equal(cinema.status, "sem-evidencia-suficiente");
  // A combinação fraca continua listada: omitir é o jeito silencioso de
  // transformar ruído em recomendação.
  assert.ok(relatorio.presets.some((entrada) => entrada.preset === "flat-2d@1"));
});

test("correlação vira conclusiva ao alcançar a amostra mínima", () => {
  const linhas = Array.from({ length: 12 }, (_, indice) => linha("a", "b", { review: indice < 9 ? "approved" : "rejected" }));
  const relatorio = minerarCorrelacaoComVeredito(linhas, { minimoAmostra: 10 });
  assert.equal(relatorio.conclusivo, true);
  assert.equal(relatorio.presets[0].status, "com-evidencia");
  assert.equal(relatorio.presets[0].taxaAprovacao, 0.75);
});

test("candidato de promoção exige evidência e nunca promove sozinho", () => {
  const linhas = Array.from({ length: 6 }, () => linha("mesa", "mesa, aquarela suave"));
  const insight = construirArchiveInsight({ rootScopeId: "client:focus", linhas, geradoEm: AGORA });
  const candidato = extrairCandidatoDeAchado({ insight, preset: "cinema@1" });
  assert.equal(candidato.n, 6);
  assert.equal(candidato.autoridade, "none");
  assert.equal(candidato.requerDecisaoHumana, true);
  // O candidato precisa declarar que não tem destino, em vez de apontar um
  // portão que recusaria a proveniência dele.
  assert.equal(candidato.destino, "nenhum-portao-aceita-esta-proveniencia");
  assert.match(candidato.bloqueio, /sourceFeedback|sourceTarget/);
  assert.equal(candidato.origem.fingerprint, insight.fingerprint);
  assert.throws(() => extrairCandidatoDeAchado({ insight, preset: "inexistente@1" }), /não aparece no relatório/);
});

test("candidato sem amostra suficiente é recusado", () => {
  const insight = construirArchiveInsight({ rootScopeId: "client:focus", linhas: [linha("a", "a, b")], geradoEm: AGORA });
  assert.throws(() => extrairCandidatoDeAchado({ insight, preset: "cinema@1" }), /abaixo do mínimo/);
});

test("mineração sem rootScopeId falha fechado", () => {
  assert.throws(() => construirArchiveInsight({ linhas: [] }), /rootScopeId/);
});

test("relatório adulterado para declarar autoridade, mutação ou sem lacunas é recusado", () => {
  const base = construirArchiveInsight({ rootScopeId: "client:focus", linhas: [linha("a", "a, b")], geradoEm: AGORA });
  for (const alteracao of [{ authority: "advisory" }, { plannerInfluence: "ranking" }, { changed: true }, { providerCalls: 1 }]) {
    assert.throws(() => assertArchiveInsight({ ...base, ...alteracao }), /autoridade|mutação|fingerprint/);
  }
  const { lacunas, ...semLacunas } = base;
  assert.throws(() => assertArchiveInsight(semLacunas), /lacunas/);
});
