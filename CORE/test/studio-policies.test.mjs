import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialJobs } from "../lib/media-pipeline/commercial.mjs";
import { compileCommercialProfile } from "../lib/media-pipeline/commercial-profile.mjs";
import { adaptExecutionPlanToLegacy, compileFilmSpec, migrateFilmSpecV1 } from "../lib/media-pipeline/film-compiler.mjs";
import { createBrandKit, lintFilmBrand, resolveQaPolicy } from "../lib/media-pipeline/studio-policies.mjs";


// Kit de marca do proprio teste: o pacote entrega um kit padrao neutro, sem
// termo proibido e sem logo, entao o lint precisa de uma marca declarada aqui
// para ter o que bloquear.
const BRAND_KIT = createBrandKit({
  id: "aurora",
  forbiddenTerms: [{ term: "foco", label: "termo-clichê" }],
  logos: [{ id: "oficial", path: "assets/logo.png", hash: "a".repeat(64), fidelity: "exact", requiredForRoles: ["identity"] }],
  maxOnScreenWords: 10,
});

function commercial() {
  return {
    schema: "mkt-videos/commercial-spec@1", name: "campanha", aspect: "16:9",
    scenes: [
      { id: "s01", text: "Conhecimento transforma.", style: "default", span: [0, 3] },
      { id: "s02", text: "Escola Aurora.", style: "closer", span: [3, 6] },
    ],
  };
}

test("commercial-profile compila para o plano canônico sem dupla composição", () => {
  const source = commercial();
  const legacyJobs = buildCommercialJobs(source, { logoImage: "C:/logo.png" });
  const compiled = compileCommercialProfile(source, { logoImage: "C:/logo.png" });
  assert.equal(compiled.profile.schema, "mkt-videos/commercial-profile@1");
  assert.equal(compiled.executionPlan.schema, "mkt-videos/execution-plan@1");
  assert.deepEqual(compiled.spec.scenes.map((scene) => scene.visualPrompt), legacyJobs.map((job) => job.prompt));
  assert.deepEqual(compiled.spec.scenes.map((scene) => scene.generationTask), legacyJobs.map((job) => job.task));
  const adapted = adaptExecutionPlanToLegacy(compiled.executionPlan);
  assert.equal(adapted.scenes[0].style, null);
  assert.equal((adapted.scenes[0].prompt.match(/Spell the text EXACTLY/g) ?? []).length, 1);
  assert.equal(compiled.executionPlan.nodes.find((node) => node.id === "keyframe:s01").costClass, "local");
});

test("brand lint bloqueia termo, densidade e logo ausente antes do plano", () => {
  const forbidden = migrateFilmSpecV1({ name: "bad", scenes: [{ prompt: "Mantenha o foco." }], brandKit: BRAND_KIT });
  assert.throws(() => compileFilmSpec(forbidden), /Brand lint bloqueou.*brand_forbidden_term/);
  const missingLogo = migrateFilmSpecV1({ name: "logo", scenes: [{ prompt: "Encerramento", role: "identity" }], brandKit: BRAND_KIT });
  assert.throws(() => compileFilmSpec(missingLogo), /brand_logo_reference_missing/);
  const dense = migrateFilmSpecV1({ name: "dense", scenes: [{ prompt: "Cena", role: "typography", onScreenText: "um dois três quatro cinco seis sete oito nove dez onze doze treze" }], brandKit: BRAND_KIT });
  assert.equal(lintFilmBrand(dense, BRAND_KIT).status, "blocked");
});

test("brand-kit e qa-policy são versionados e verificáveis", () => {
  const kit = createBrandKit({ id: "teste", forbiddenTerms: ["proibido"] });
  assert.equal(kit.schema, "mkt-videos/brand-kit@1");
  assert.equal(kit.hash.length, 64);
  const policy = resolveQaPolicy("editorial@1");
  assert.equal(policy.schema, "mkt-videos/qa-policy@1");
  assert.equal(policy.rules.black_interval, "warn");
  assert.equal(policy.autoRefine, false);
});
