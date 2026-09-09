import assert from "node:assert/strict";
import test from "node:test";
import { insertDe } from "../lib/media-pipeline/documentary-direction.mjs";
import { materializeTechniques, listProductionTechniques, PRODUCTION_PROCEDURES } from "../lib/media-pipeline/prompt-techniques.mjs";
import { recordProductionTechniques } from "../lib/media-pipeline/production-technique-usage.mjs";

test("insert aplica o bloco canônico idêntico nos dois lados", () => {
  for (const side of ["left", "right"]) {
    const [block] = materializeTechniques([{ id: "native-semantic-insert@1", values: { highlight: "A IDEIA", side } }]);
    assert.equal(block.text, insertDe("A IDEIA", side));
    const use = { id: "native-semantic-insert@1", sceneId: "s1", values: { highlight: "A IDEIA", side }, prompt: block.text };
    assert.equal(recordProductionTechniques({ uses: [use] }).completeness, "complete");
    assert.throws(() => recordProductionTechniques({ uses: [{ ...use, prompt: "sem o bloco" }] }), /não comprova/);
  }
});

test("procedimentos aparecem no catálogo, mas não podem entrar no prompt", () => {
  for (const procedure of Object.values(PRODUCTION_PROCEDURES)) {
    assert.ok(listProductionTechniques().includes(procedure));
    assert.equal(procedure.block, undefined);
    assert.throws(() => materializeTechniques([procedure.id]), /Técnica desconhecida/);
    assert.throws(() => recordProductionTechniques({ uses: [{ id: procedure.id }] }), /exige parâmetro/);
  }
});

test("novidade sem registro impede completude; candidato documentado não é promovido", () => {
  const changes = [{ candidateId: "nova@1" }];
  assert.throws(() => recordProductionTechniques({ changes }), /sem registro/);
  const recorded = recordProductionTechniques({ changes, candidates: [{ id: "nova@1", problem: "Falha concreta", description: "Bloco experimental", evidenceRefs: ["diagnosticos/observacao.json"] }] });
  assert.equal(recorded.candidates[0].status, "candidate");
  assert.equal(recorded.candidates[0].authority, "none");
  assert.equal(recorded.automaticPromotion, false);
});

test("geometria é concept e conflitos de movimento falham antes de compor", () => {
  assert.throws(() => materializeTechniques(["object-boundary-contract@1"]), /concept/);
  assert.throws(() => materializeTechniques([
    { id: "gaze-exit@1", values: { movement: "turn left" } },
    { id: "clean-final-frame@1", values: { end_state: "still" } },
  ]), /incompatível/);
});
