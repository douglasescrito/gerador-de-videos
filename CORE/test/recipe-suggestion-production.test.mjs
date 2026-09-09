import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createStudioBrief } from "../lib/media-pipeline/studio-context.mjs";
import { createCreativeDirectionProposal, materializeCreativeDirection } from "../lib/media-pipeline/creative-direction.mjs";
import { suggestMasterRecipeFromBrief } from "../lib/media-pipeline/recipe-brief-suggestion.mjs";
import { listRecipeStoryStructures } from "../lib/media-pipeline/recipe-story-structures.mjs";
import { inspectMasterRecipe, parseMasterRecipe, resolveMasterRecipe, preflightMasterRecipeBytes } from "../lib/media-pipeline/master-recipe-v2.mjs";
import { handleRecipeCommand } from "../lib/cli/recipe-command-handler.mjs";

const brief = (overrides = {}) => createStudioBrief({ briefId: "brief:producao", clientId: "client:teste", projectId: "project:teste", userBrief: "Explique o processo com exemplos e uma conclusão clara.", objective: "Explicar o processo", audience: "Pessoas iniciantes", message: "Comece pelo essencial.", requiredText: ["Revise."], cta: "Experimente.", durationSeconds: 30, format: "16:9", ...overrides });
const options = (overrides = {}) => ({ brief: brief(), rootScopeId: "client:teste", style: "flat-2d@1", ...overrides });
const stories = {
  produto: { problem: "Objetos se misturam na gaveta.", demonstration: ["Separe os objetos em três divisórias.", "Feche a gaveta."], benefit: "Cada objeto fica na sua divisória." },
  comparacao: { criterion: "Quantidade de etapas informadas.", alternativeA: "O processo A tem três etapas.", alternativeB: "O processo B tem duas etapas.", conclusion: "B tem uma etapa a menos neste exemplo." },
  tutorial: { outcome: "Uma lista revisada.", steps: ["Escreva os itens.", "Confira cada item."] },
  entrevista: { question: "Como você organiza o processo?", answer: "Começo pela lista de tarefas.", followUp: "A lista é revisada antes da execução.", closing: "A revisão termina esta conversa." },
  documental: { context: "Observação de uma oficina.", observations: ["Ferramentas na bancada.", "Uma peça sendo medida."], conclusion: "A medição antecede o corte nesta observação." },
  manifesto: { thesis: "Organização é uma prática.", principles: ["Anotar antes de agir.", "Revisar antes de concluir."], commitment: "Manter uma lista revisada." },
  virada: { situation: "Um círculo parece imóvel.", expectation: "Ele parece ser um botão.", turn: "O plano se abre e revela uma roda.", resolution: "A roda move a composição." },
  humor: { setup: "Um quadrado tenta entrar em um círculo.", escalation: ["O quadrado gira.", "O círculo também gira."], payoff: "Os dois trocam de lugar e finalmente encaixam." },
  serie: { seriesTitle: "Processos em prática", episodeTitle: "A lista", premise: "Como começar a organizar?", development: ["Anote os itens.", "Revise a ordem."], nextEpisodeHook: "Na continuação fornecida, a lista será executada." },
};

async function modules() {
  const golden = JSON.parse(await readFile(new URL("../recipes/golden-30s.receita-v2.5b.json", import.meta.url), "utf8"));
  return Object.fromEntries(["assets", "cast", "narration", "alignment", "music", "sfx", "captions", "mix"].map((key) => [key, key === "assets" ? [] : key === "cast" ? { people: [] } : golden[key]]));
}

test("nove estruturas narrativas preservam os fatos e chegam ao mesmo compilador", () => {
  const structures = listRecipeStoryStructures();
  assert.equal(structures.length, 12);
  const plans = new Set();
  for (const [structure, story] of Object.entries(stories)) {
    assert.ok(structures.some((entry) => entry.id === structure));
    const input = options({ structure, story });
    const snapshot = structuredClone(input);
    const candidate = suggestMasterRecipeFromBrief(input);
    assert.deepEqual(candidate, suggestMasterRecipeFromBrief(input));
    assert.deepEqual(input, snapshot);
    const { executionPlan } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
    plans.add(executionPlan.fingerprint);
    assert.equal(executionPlan.timeline.durationFrames, 720);
    assert.equal(executionPlan.brief.hash, input.brief.hash);
    assert.equal(executionPlan.spec.narration.mode, "none");
    const prompts = candidate.recipe.videoGeneration.shots.map((shot) => shot.prompt).join("\n");
    for (const fact of Object.values(story).flat()) assert.ok(prompts.includes(fact), `${structure} perdeu ${fact}`);
    for (const text of [input.brief.message, ...input.brief.requiredText, input.brief.cta]) assert.ok(prompts.includes(text));
  }
  assert.equal(plans.size, 9);
});

test("auto explica a seleção e faltas narrativas falham antes de inventar conteúdo", () => {
  const candidate = suggestMasterRecipeFromBrief(options({ structure: "auto", story: stories.tutorial }));
  assert.equal(candidate.evidence.structure, "tutorial");
  assert.match(candidate.evidence.structureReason, /Única estrutura compatível/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ structure: "comparacao", story: { criterion: "preço" } })), /alternativeA/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ structure: "tutorial", story: { ...stories.tutorial, invented: "x" } })), /desconhecidos/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ structure: "tutorial", story: { ...stories.tutorial, steps: [] } })), /1 a 24/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ structure: "constructor" })), /--structure inválida/);
});

test("módulos de áudio explícitos materializam voz, trilha, alinhamento, legenda e mix", async () => {
  const audio = await modules();
  const candidate = suggestMasterRecipeFromBrief(options({ structure: "tutorial", story: stories.tutorial, modules: audio }));
  const { executionPlan, filmSpec } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  assert.equal(filmSpec.narration.text, audio.narration.blocks.map((block) => block.text).join("\n"));
  assert.equal(filmSpec.music.intent, audio.music.intent);
  assert.equal(filmSpec.finishing.audio.ending, "clean-cut");
  assert.deepEqual(filmSpec.narration.blocks, audio.narration.blocks);
  assert.equal(filmSpec.captions.mode, "word");
  assert.equal(filmSpec.alignment.timing.status, "planned-not-measured");
  const nodes = new Map(executionPlan.nodes.map((node) => [node.id, node]));
  assert.ok(nodes.has("voice-master"));
  assert.ok(nodes.has("music-source"));
  assert.ok(nodes.has("audio-mix"));
  assert.deepEqual(nodes.get("voice-master").dependencies, []);
  assert.deepEqual(nodes.get("music-source").dependencies, []);
  assert.equal(candidate.evidence.planFingerprint, executionPlan.fingerprint);
  assert.equal(candidate.readiness.runtimeAuthority, "not-checked");
  const withoutCaptions = structuredClone(audio);
  withoutCaptions.captions.mode = "none";
  const silentText = suggestMasterRecipeFromBrief(options({ modules: withoutCaptions }));
  assert.equal(inspectMasterRecipe(JSON.stringify(silentText.recipe)).filmSpec.captions.mode, "none");
  assert.throws(() => suggestMasterRecipeFromBrief(options({ modules: { ...audio, narration: { ...audio.narration, voice: "inventada" } } })), /Voz Google Vids desconhecida/);
});

test("referência fica somente na cena indicada e preflight relê bytes sem conceder direitos", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "suggest-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audio = await modules();
  const bytes = Buffer.from("fixture de bytes; não enviada a provider");
  await writeFile(path.join(root, "portrait.png"), bytes);
  audio.assets = [{ id: "portrait", mediaKind: "image", role: "person-reference", source: { kind: "workspace", locator: "portrait.png" }, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png", rights: { providerInput: "allowed", reuse: "allowed" }, authorization: { mode: "scope-grant", bindingHash: "a".repeat(64) } }];
  audio.cast = { people: [{ id: "person", assetId: "portrait", role: "person-reference" }] };
  const shotBindings = [{ shotId: "desenvolvimento", task: "reference-to-video", inputAssetIds: ["portrait"], castIds: ["person"] }];
  const candidate = suggestMasterRecipeFromBrief(options({ brief: brief({ references: ["portrait"] }), modules: audio, shotBindings }));
  const { filmSpec, resolved } = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  assert.equal(filmSpec.scenes[0].generationTask, "text_to_video");
  assert.deepEqual(filmSpec.scenes[0].references, []);
  assert.equal(filmSpec.scenes[1].generationTask, "reference_to_video");
  assert.equal(filmSpec.scenes[1].references[0].assetId, "portrait");
  assert.deepEqual(filmSpec.scenes[2].references, []);
  assert.equal(candidate.readiness.assetBytes, "not-checked");
  assert.equal((await preflightMasterRecipeBytes(resolved, { workspaceRoot: root })).status, "ready");
  await writeFile(path.join(root, "portrait.png"), "alterado");
  assert.ok((await preflightMasterRecipeBytes(resolved, { workspaceRoot: root })).blockers.some((blocker) => blocker.code === "asset-bytes-diverged"));
  audio.assets[0].rights.providerInput = "unknown";
  const blocked = suggestMasterRecipeFromBrief(options({ modules: audio, shotBindings }));
  assert.equal(blocked.readiness.capabilityPreflight, "blocked");
  assert.equal(blocked.evidence.planFingerprint, null);
  assert.throws(() => inspectMasterRecipe(JSON.stringify(blocked.recipe)), /provider-input-rights-not-allowed/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ modules: audio, shotBindings: [{ ...shotBindings[0], shotId: "nao-existe" }] })), /inexistente/);
});

test("decisão do diretor preserva seed e não repetição até o plano, sem promoção automática", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "suggest-direction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { schema: "mkt-videos/director-context@1", rootScopeId: "client:teste", projectScopeId: "project:teste", activeRelease: { id: "release:test", hash: "a".repeat(64) }, profileFingerprint: "b".repeat(64), contextFingerprint: "c".repeat(64), profile: { clientId: "teste", projectId: "teste", brand: { positioning: "Clareza", requiredClosing: "Experimente.", forbiddenTerms: [] }, creative: { primaryStyle: "flat-2d@1" } }, recentCreativeFingerprints: [] };
  const decision = { decisionId: "human:test", marketingObjective: "Explicar", audience: "Iniciantes", promise: "Entender o processo", callToAction: "Experimente.", axisOptions: { thesis: ["Uma ação de cada vez"], arc: ["pergunta-resposta", "progressão"], keyVisual: ["Peças se encaixam"], aestheticTerritory: ["flat editorial"], motionMechanism: ["deslizamento"], composition: ["grade"], soundResolution: ["corte limpo"] } };
  const first = createCreativeDirectionProposal({ context, decision });
  context.recentCreativeFingerprints = [{ productionId: "previous", fingerprint: first.fingerprint }];
  const next = createCreativeDirectionProposal({ context, decision });
  const materialized = await materializeCreativeDirection({ proposal: next, expectedProposalHash: next.proposalHash, confirmHuman: true, productionDir: root, productionId: "production:test" });
  const approved = JSON.parse(await readFile(path.join(root, "creative-direction.json"), "utf8"));
  assert.ok(materialized);
  const candidate = suggestMasterRecipeFromBrief(options({ creativeDirection: approved }));
  const compiled = inspectMasterRecipe(JSON.stringify(candidate.recipe));
  assert.deepEqual(compiled.executionPlan.creativeDirection, approved);
  assert.equal(candidate.evidence.planSeed, next.planSeed);
  assert.equal(candidate.evidence.variation.repeatedCombination, false);
  assert.equal(candidate.evidence.variation.comparedWith, "previous");
  assert.notEqual(first.fingerprint.combinationHash, approved.fingerprint.combinationHash);
  assert.equal(approved.authority.promotesKnowledge, false);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ creativeDirection: next })), /creative-direction-decision/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ creativeDirection: { ...approved, productionId: "adulterado" } })), /hash/);
  assert.throws(() => suggestMasterRecipeFromBrief(options({ brief: brief({ projectId: "project:outro" }), creativeDirection: approved })), /atravessa/);
});

test("CLI descobre estruturas e sugere receita completa que plan relê sem tradução", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "suggest-production-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = { brief: path.join(root, "brief.json"), story: path.join(root, "story.json"), modules: path.join(root, "modules.json"), out: path.join(root, "recipe.receita-v2.json") };
  await Promise.all([writeFile(files.brief, JSON.stringify(brief())), writeFile(files.story, JSON.stringify(stories.manifesto)), modules().then((audio) => writeFile(files.modules, JSON.stringify(audio)))]);
  const run = (...args) => spawnSync(process.execPath, ["scripts/omni-cli.mjs", "recipe", ...args], { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  const listed = run("structures");
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).structures.length, 12);
  const suggested = run("suggest", "--file", files.brief, "--structure", "auto", "--style", "flat-2d@1", "--root-scope-id", "client:teste", "--story-file", files.story, "--modules-file", files.modules, "--out", files.out);
  assert.equal(suggested.status, 0, suggested.stderr);
  const summary = JSON.parse(suggested.stdout);
  assert.equal(summary.structure, "manifesto");
  const explained = run("explain", "--file", files.out);
  assert.equal(explained.status, 0, explained.stderr);
  const execution = JSON.parse(explained.stdout).execution;
  assert.ok(execution.initiallyReady.includes("voice-master"));
  assert.ok(execution.initiallyReady.includes("music-source"));
  assert.ok(execution.possibleOverlap.pairs.some((pair) => pair.nodes.includes("voice-master") && pair.nodes.includes("music-source")));
  assert.deepEqual(execution.nodes.find((node) => node.id === "voice-master").resources, [{ id: "provider:vids", weight: 1 }]);
  assert.equal(execution.measuredDuration, null);
  assert.equal(execution.outputs.physicalValidation, "pending-production");
  const planned = run("plan", "--file", files.out, "--dry-run", "true");
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(JSON.parse(planned.stdout).executionPlan.fingerprint, summary.hashes.planFingerprint);
  const studioRoot = path.join(root, "studio");
  const studio = (command) => spawnSync(process.execPath, ["scripts/omni-cli.mjs", command, "--spec", files.out, "--out-root", studioRoot, "--eta-root", path.join(root, "receipts")], { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test", MKT_VIDEOS_RUNTIME_DB: path.join(root, "runtime.sqlite") } });
  const dryRun = studio("dry-run");
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).dryRun, true);
  await assert.rejects(access(studioRoot), { code: "ENOENT" });
  const admitted = studio("plan");
  assert.equal(admitted.status, 0, admitted.stderr);
  const planResult = JSON.parse(admitted.stdout);
  assert.ok(planResult.stateFile);
  const state = JSON.parse(await readFile(planResult.stateFile, "utf8"));
  const savedPlan = JSON.parse(await readFile(state.planFile, "utf8"));
  assert.equal(savedPlan.executionPlan.governance.eta.root, path.join(root, "receipts"));
  assert.equal(savedPlan.executionPlan.governance.eta.scannedReceipts, 0);
  assert.equal(savedPlan.executionPlan.spec.brief.hash, brief().hash);
  assert.equal(savedPlan.executionPlan.spec.narration.text, JSON.parse(await readFile(files.modules, "utf8")).narration.blocks.map((block) => block.text).join("\n"));
  assert.equal(savedPlan.executionPlan.governance.executorCompatibility.supported, true);
  await assert.rejects(handleRecipeCommand({ action: "plan", "story-file": files.story }), /pertencem a recipe suggest/);
});

test("contexto da receita recusa escopo, hash adulterado e campos não selados", () => {
  const candidate = suggestMasterRecipeFromBrief(options());
  const wrongScope = structuredClone(candidate.recipe);
  wrongScope.scope.rootScopeId = "client:outro";
  assert.throws(() => parseMasterRecipe(JSON.stringify(wrongScope)), /atravessa/);
  const tampered = structuredClone(candidate.recipe);
  tampered.context.brief.objective = "adulterado";
  assert.throws(() => parseMasterRecipe(JSON.stringify(tampered)), /hash/);
  const hidden = structuredClone(candidate.recipe);
  hidden.context.brief.hidden = "não estava selado";
  assert.throws(() => resolveMasterRecipe(parseMasterRecipe(JSON.stringify(hidden))), /campo desconhecido/);
});
