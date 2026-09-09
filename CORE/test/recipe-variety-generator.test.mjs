import assert from "node:assert/strict";
import test from "node:test";
import { gerarPlanoDiversidade, gerarReceitasCompletas, gerarReceitasDiversificadas } from "../lib/media-pipeline/recipe-variety-generator.mjs";
import { compilarReceita } from "../lib/media-pipeline/recipe-compiler.mjs";
import { composeDirection, isLiveSelectableStyleSpec, listStyleSpecs } from "../lib/media-pipeline/direction-presets.mjs";

const bank = {
  categories: {
    produto: { entries: [{ brief: "b1", video: [{ effectivePrompt: "p1" }, { effectivePrompt: "p2" }] }] },
    marca: { entries: [{ brief: "b2", video: [{ effectivePrompt: "p3" }] }] },
    tecnologia: { entries: [{ brief: "b3", video: [{ effectivePrompt: "p4" }] }] },
  },
};

test("gerarReceitasDiversificadas é determinístico para o mesmo seed", () => {
  const a = gerarReceitasDiversificadas({ promptBank: bank, seed: "x", count: 4 });
  const b = gerarReceitasDiversificadas({ promptBank: bank, seed: "x", count: 4 });
  assert.deepEqual(a.propostas.map((p) => p.id), b.propostas.map((p) => p.id));
  assert.equal(a.count, 4);
});

test("categoria escolhida restringe o brief nas duas superfícies", () => {
  const options = { promptBank: bank, seed: "category", count: 2, categorias: ["tecnologia"] };
  for (const recipe of gerarReceitasDiversificadas(options).propostas) assert.ok(recipe.parts.every((part) => part.prompt.startsWith("p4")));
  for (const recipe of gerarReceitasCompletas(options).receitas) assert.ok(recipe.scenes.every((scene) => scene.prompt.startsWith("p4")));
  assert.throws(() => gerarReceitasDiversificadas({ ...options, categorias: ["ausente"] }), /Categoria sem briefs/);
});

test("seed diferente muda as propostas", () => {
  const a = gerarReceitasDiversificadas({ promptBank: bank, seed: "x", count: 4 });
  const c = gerarReceitasDiversificadas({ promptBank: bank, seed: "y", count: 4 });
  assert.notDeepEqual(a.propostas.map((p) => p.id), c.propostas.map((p) => p.id));
});

test("favoritos priorizam e marcam propostas como favorito", () => {
  const d = gerarReceitasDiversificadas({ promptBank: bank, seed: "x", count: 8, favoritos: ["documentario@1", "flat-2d@1"] });
  assert.ok(d.propostas.some((p) => p.favorito === true));
  // Os estilos favoritos aparecem antes dos não favoritos no ciclo inicial.
  const estilos = d.propostas.map((p) => p.style);
  const primeiroFavorito = estilos.findIndex((s) => ["documentario@1", "flat-2d@1"].includes(s));
  const primeiroComum = estilos.findIndex((s) => !["documentario@1", "flat-2d@1"].includes(s));
  assert.ok(primeiroFavorito >= 0);
  assert.ok(primeiroFavorito <= primeiroComum);
});

test("cada proposta compila como receita@1 válida (kind lote)", () => {
  const geradas = gerarReceitasDiversificadas({ promptBank: bank, seed: "z", count: 2 });
  for (const proposta of geradas.propostas) {
    assert.equal(proposta.schema, "gerador-de-videos/receita@1");
    assert.equal(proposta.kind, "lote");
    assert.ok(proposta.parts.length >= 2);
    for (const part of proposta.parts) assert.doesNotThrow(() => composeDirection({ userPrompt: part.prompt, style: proposta.style, task: "text_to_video", techniques: part.techniques }));
    assert.equal("techniques" in proposta, false);
    assert.ok(proposta.aspect === "16:9" || proposta.aspect === "9:16");
    const compilado = compilarReceita(proposta);
    assert.equal(compilado.motor, "lote");
    assert.equal(compilado.saidas, proposta.parts.length);
  }
});

test("gerarPlanoDiversidade espalha propostas por dias", () => {
  const plano = gerarPlanoDiversidade({ promptBank: bank, seed: "p", dias: 3, porDia: 2 });
  assert.equal(plano.diasPlano.length, 3);
  assert.equal(plano.total, 6);
  for (const dia of plano.diasPlano) assert.equal(dia.propostas.length, 2);
  // Determinístico
  const plano2 = gerarPlanoDiversidade({ promptBank: bank, seed: "p", dias: 3, porDia: 2 });
  assert.deepEqual(plano.diasPlano, plano2.diasPlano);
});

test("gerarReceitasCompletas produz receitas filme que compilam para film-spec@1", () => {
  const geradas = gerarReceitasCompletas({ promptBank: bank, seed: "f", count: 2, duracaoPorCena: 10 });
  assert.equal(geradas.receitas.length, 2);
  for (const receita of geradas.receitas) {
    assert.equal(receita.kind, "filme");
    assert.equal(receita.scenes.length, 5);
    assert.equal(receita.targetDurationSeconds, 50);
    assert.ok(receita.audio.music);
    assert.equal(receita.audio.musicFit, "exact");
    assert.ok(receita.audio.narration.blocks.length >= 5);
    assert.equal(receita.workflow.narrationSync, "whisper-word-timestamps");
    assert.equal(receita.workflow.automaticRetry, true);
    assert.equal(receita.workflow.humanReview, false);
    assert.equal(receita.workflow.completionMode, "complete");
    assert.equal(receita.workflow.wallTargetSeconds, 300);
    assert.equal(receita.workflow.streamAlignment, true);
    assert.equal(receita.qa.structural, true);
    // Compila para film-spec@1 com tudo.
    const compilado = compilarReceita(receita);
    assert.equal(compilado.motor, "filme");
    assert.equal(compilado.filmSpec.schema, "mkt-videos/film-spec@1");
    assert.equal(compilado.filmSpec.scenes.length, 5);
    assert.ok(compilado.filmSpec.narration.blocks.length >= 5);
    assert.equal(compilado.filmSpec.music.durationSeconds, 50);
    assert.equal(compilado.saidas, 5);
  }
});

test("gerarReceitasCompletas é determinístico e prioriza favoritos", () => {
  const a = gerarReceitasCompletas({ promptBank: bank, seed: "z", count: 2 });
  const b = gerarReceitasCompletas({ promptBank: bank, seed: "z", count: 2 });
  assert.deepEqual(a.receitas.map((r) => r.id), b.receitas.map((r) => r.id));
  const d = gerarReceitasCompletas({ promptBank: bank, seed: "z", count: 6, favoritos: ["flat-2d@1"] });
  assert.ok(d.receitas.some((r) => r.favorito === true));
});

test("variedade usa estilos selecionáveis reais e cada proposta materializa sem slots inventados", () => {
  const options = { promptBank: bank, seed: "audit", count: 20, categorias: ["produto"] };
  const generated = gerarReceitasDiversificadas(options);
  const expected = listStyleSpecs().filter(isLiveSelectableStyleSpec).map((style) => style.id).sort();
  assert.deepEqual(generated.propostas.map((recipe) => recipe.style).sort(), expected);
  assert.ok(generated.propostas.some((recipe) => recipe.style === "documentario-sobrio@1"));
  assert.ok(generated.propostas.some((recipe) => recipe.parts.every((part) => part.techniques.length === 0)));
  for (const recipe of generated.propostas) for (const part of recipe.parts) {
    const direction = composeDirection({ userPrompt: part.prompt, style: recipe.style, task: "text_to_video", techniques: part.techniques });
    assert.doesNotMatch(direction.effectivePrompt, /\{\{[a-z_]+\}\}/);
  }
  assert.deepEqual(generated, gerarReceitasDiversificadas(options));
});

test("seleção explícita recusa estilo, família e slots inválidos antes de propor", () => {
  const options = { promptBank: bank, seed: "explicit", count: 1, estilos: ["flat-2d@1"] };
  assert.throws(() => gerarReceitasDiversificadas({ ...options, estilos: ["inventado@1"] }), /Estilo desconhecido/);
  assert.throws(() => gerarReceitasDiversificadas({ ...options, estilos: ["produto\/streaks-de-luz@1"] }), /concept/);
  assert.throws(() => gerarReceitasDiversificadas({ ...options, tecnicas: ["inventada@1"] }), /Técnica desconhecida/);
  assert.throws(() => gerarReceitasDiversificadas({ ...options, tecnicas: ["identity-wardrobe-lock@1"] }), /não se aplica/);
  assert.throws(() => gerarReceitasDiversificadas({ ...options, tecnicas: ["clean-final-frame@1"] }), /end_state/);
  assert.throws(() => gerarReceitasCompletas({ ...options, tecnicas: ["render-check-flat@1"] }), /--filme não possui/);
});

test("técnica do catálogo recebe apenas valores fornecidos e conserva o aspecto do estilo", () => {
  const generated = gerarReceitasDiversificadas({ promptBank: bank, count: 1, estilos: ["vertical-social@1"], tecnicas: [{ id: "clean-final-frame@1", values: { end_state: "a blue circle on white" } }] });
  const [recipe] = generated.propostas;
  assert.equal(recipe.aspect, "9:16");
  for (const part of recipe.parts) {
    assert.deepEqual(part.techniques, [{ id: "clean-final-frame@1", values: { end_state: "a blue circle on white" } }]);
    assert.doesNotThrow(() => composeDirection({ userPrompt: part.prompt, style: recipe.style, task: "text_to_video", techniques: part.techniques }));
  }
});
