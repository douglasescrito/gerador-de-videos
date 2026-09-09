import assert from "node:assert/strict";
import test from "node:test";
import { adaptExecutionPlanToLegacy, compileFilmSpec, migrateFilmSpecV1 } from "../lib/media-pipeline/film-compiler.mjs";
import { validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import { createStudioBrief } from "../lib/media-pipeline/studio-context.mjs";
import { buildProductionContextBinding } from "../lib/media-pipeline/production-context.mjs";

function legacySpec() {
  return {
    name: "compiler-test", aspect: "16:9", style: "aquarela-2d@1",
    scenes: [
      { id: "a", prompt: "Cena A", motionPrompt: "Movimento A", duration: 2 },
      { id: "b", prompt: "Cena B", motionPrompt: "Movimento B", duration: 2 },
    ],
    narration: {
      provider: "google-vids",
      documentUrl: "https://docs.google.com/videos/d/test/edit",
      text: "Uma narração contínua.",
      voice: "Nyla",
      blocks: [{ id: "narration-1", text: "Uma narração contínua." }],
    },
    music: { preset: "institucional", backend: "flow-music" },
    assembly: { fps: 24, transition: "dissolve", transitionDuration: 0.5 },
    captions: { wordsFile: "words.json", style: "kinetic-word@1" },
    qa: { semantic: false, gate: "block" },
    delivery: { profile: "web-1080p" },
    budget: { image: 2, tts: 1, music: 1, omni: 2, semanticQa: 0 },
  };
}

test("compiler é puro e byte-determinístico", () => {
  const input = legacySpec();
  const before = structuredClone(input);
  const first = compileFilmSpec(input);
  const second = compileFilmSpec(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(input, before);
  assert.equal(first.schema, "mkt-videos/execution-plan@1");
  assert.equal(first.spec.schema, "mkt-videos/film-spec@2");
  assert.equal(first.timeline.schema, "mkt-videos/timeline@1");
  assert.equal("createdAt" in first, false);
  assert.equal(first.nodes[0].id, "voice-master");
  assert.deepEqual(first.nodes.find((node) => node.id === "music-source").dependencies, []);
  assert.deepEqual(first.nodes.find((node) => node.id === "music-fit").dependencies.sort(), ["music-source", "voice-probe"]);
  assert.deepEqual(first.nodes.find((node) => node.id === "audio-mix").dependencies.sort(), ["music-fit", "voice-master"]);
  assert.deepEqual(first.nodes.find((node) => node.id === "audio-mix").resources, [{ id: "cpu:ffmpeg", weight: 1 }]);
  assert.deepEqual(first.nodes.find((node) => node.id === "master").dependencies, ["assembly", "audio-mix"]);
  assert.ok(first.nodes.find((node) => node.id === "video:a").dependencies.includes("animatic-approval"));
});

test("fachada antiga sem pós-produção vazia continua legível", () => {
  const canonical = migrateFilmSpecV1(legacySpec());
  delete canonical.compatibility;
  canonical.finishing.postProduction = { module: "ffmpeg-post@1", operations: [] };
  const plan = compileFilmSpec(canonical);
  const oldFacade = adaptExecutionPlanToLegacy(plan);
  delete oldFacade.postProduction;
  assert.doesNotThrow(() => validateFilmSpec(oldFacade, { executionPlan: plan }));
});

test("multivoz mantém identidade do spec legado ao DAG e à normalização do executor", () => {
  const input = legacySpec();
  input.narration.speakerMode = "multi-voice";
  input.narration.speakers = [{ id: "a", voice: "Nyla" }, { id: "b", voice: "Charon" }];
  input.narration.blocks = [{ id: "a", text: "Primeiro.", speakerId: "a" }, { id: "b", text: "Segundo.", speakerId: "b" }];
  input.budget.tts = 2;
  const canonical = migrateFilmSpecV1(input);
  assert.equal(canonical.narration.speakerMode, "multi-voice");
  delete canonical.compatibility;
  const plan = compileFilmSpec(canonical);
  assert.deepEqual(plan.nodes.filter((node) => node.kind === "tts").map((node) => node.id), ["voice:a", "voice:b"]);
  const normalized = validateFilmSpec(adaptExecutionPlanToLegacy(plan));
  assert.equal(normalized.narration.speakerMode, "multi-voice");
  assert.equal(normalized.calls.tts, 2);
  assert.deepEqual(normalized.narration.blocks.map((block) => block.speakerId), ["a", "b"]);
});

test("migrador @1 preserva o contrato observado pelo executor legado", () => {
  const legacy = legacySpec();
  const migrated = migrateFilmSpecV1(legacy);
  const plan = compileFilmSpec(migrated);
  const adapted = adaptExecutionPlanToLegacy(plan);
  assert.deepEqual(adapted, legacy);
  const originalBehavior = validateFilmSpec(legacy, { outputsRoot: "C:/tmp/compiler" });
  const adaptedBehavior = validateFilmSpec(adapted, { outputsRoot: "C:/tmp/compiler" });
  assert.deepEqual(adaptedBehavior, originalBehavior);
  assert.deepEqual(plan.budget, legacy.budget);
});

test("timeline usa frames racionais e só bloqueia quando todos os spans são conhecidos", () => {
  const locked = compileFilmSpec(legacySpec()).timeline;
  assert.deepEqual(locked.timeBase, { numerator: 1, denominator: 24 });
  assert.equal(locked.locked, true);
  assert.equal(locked.durationFrames, 84);
  const open = legacySpec();
  delete open.scenes[1].duration;
  assert.equal(compileFilmSpec(open).timeline.locked, false);
  assert.equal(compileFilmSpec(open).timeline.durationFrames, null);
});

test("narração Omni vira blocos de vídeo pagos e alinhamento Whisper local", () => {
  const input = legacySpec();
  input.narration = {
    provider: "omni",
    text: "Primeiro bloco. Segundo bloco.",
    voice: "voz brasileira institucional",
    blocks: [
      { id: "primeiro", text: "Primeiro bloco.", seconds: 8 },
      { id: "segundo", text: "Segundo bloco.", seconds: 8 },
    ],
  };
  input.budget = { ...input.budget, tts: 0, omni: 4 };
  const plan = compileFilmSpec(input);
  assert.equal(plan.nodes.some((node) => node.kind === "tts"), false);
  assert.deepEqual(
    plan.nodes.filter((node) => node.kind === "omni-narration").map((node) => node.id),
    ["video:narration:primeiro", "video:narration:segundo"],
  );
  assert.deepEqual(plan.nodes.find((node) => node.id === "voice-master").dependencies, ["video:narration:primeiro", "video:narration:segundo"]);
  assert.deepEqual(
    plan.governance.paidCalls.filter((call) => call.stage === "tts").map((call) => [call.provider, call.operation, call.count]),
    [["gemini-omni", "text-to-video", 2]],
  );
});

test("film-spec@2 rejeita papéis, formatos e reuse inválidos", () => {
  const v2 = migrateFilmSpecV1(legacySpec());
  v2.scenes[0].role = "everything";
  assert.throws(() => compileFilmSpec(v2), /Papel de cena inválido/);
  const badFormat = migrateFilmSpecV1(legacySpec());
  badFormat.formats.master = "1:1";
  assert.throws(() => compileFilmSpec(badFormat), /formats.master/);
});

test("DAG usa tipografia Omni por padrão e reserva motion local para GC explícito", () => {
  const native = migrateFilmSpecV1(legacySpec());
  native.scenes[0].onScreenText = "CTA nativo";
  native.scenes[0].textRendering = "omni-native";
  const nativePlan = compileFilmSpec(native);
  assert.equal(nativePlan.spec.scenes[0].textRendering, "omni-native");
  assert.equal(nativePlan.nodes.some((node) => node.id === "motion:a"), false);

  const v2 = migrateFilmSpecV1(legacySpec());
  v2.scenes[0].onScreenText = "CTA exato";
  v2.scenes[0].textRendering = "local-gc";
  const invalidText = structuredClone(v2);
  invalidText.scenes[0].onScreenText = "controle\u0000";
  assert.throws(() => compileFilmSpec(invalidText), /controle não renderizável/);
  v2.formats.variants = ["9:16", { format: "1:1", strategy: "fit-pad", approved: true }];
  const plan = compileFilmSpec(v2);
  assert.deepEqual(plan.nodes.find((node) => node.id === "motion:a").dependencies, ["video:a", "timeline-lock"]);
  assert.ok(plan.nodes.find((node) => node.id === "assembly").dependencies.includes("qa-scene:a"));
  assert.ok(plan.nodes.find((node) => node.id === "variant:9x16").dependencies.includes("timeline-lock"));
  const blocked = migrateFilmSpecV1(legacySpec());
  blocked.formats.variants = ["1:1"];
  assert.throws(() => compileFilmSpec(blocked), /approved:true/);
});

test("productionContextBinding consistente com o brief compila e chega ao plano", () => {
  const v2 = migrateFilmSpecV1(legacySpec());
  const brief = createStudioBrief({
    briefId: "brief:pc-compiler",
    userBrief: "Anunciar o curso novo.",
    objective: "Converter matrícula.",
  });
  v2.brief = brief;
  v2.productionContextBinding = buildProductionContextBinding({
    rootScopeId: "client:pc-compiler",
    briefHash: brief.hash,
  });
  const plan = compileFilmSpec(v2);
  assert.equal(plan.productionContextBinding.rootScopeId, "client:pc-compiler");
  assert.equal(plan.productionContextBinding.briefHash, brief.hash);
});

test("productionContextBinding preso a um brief diferente falha fechado", () => {
  const v2 = migrateFilmSpecV1(legacySpec());
  v2.brief = createStudioBrief({
    briefId: "brief:pc-compiler-2",
    userBrief: "Anunciar o curso novo.",
    objective: "Converter matrícula.",
  });
  v2.productionContextBinding = buildProductionContextBinding({
    rootScopeId: "client:pc-compiler",
    briefHash: "0".repeat(64),
  });
  assert.throws(() => compileFilmSpec(v2), /productionContextBinding\.briefHash diverge/);
});
