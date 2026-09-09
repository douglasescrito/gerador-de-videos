import assert from "node:assert/strict";
import test from "node:test";
import {
  composeDirection,
  DIRECTION_PRESETS,
  isLiveSelectableStyleSpec,
  listDirectionPresets,
  listStyleSpecs,
  resolveDirectionPreset,
  resolveStyleSpec,
  STYLE_SPECS,
  STYLE_SPEC_SCHEMA,
} from "../lib/media-pipeline/direction-presets.mjs";

const LEGACY_IDS = [
  "cinematic-3d@1",
  "soft-realism@1",
  "documentario@1",
  "aquarela-2d@1",
  "flat-2d@1",
  "vertical-social@1",
  "logo-fiel@1",
];
const LIVE_IDS = [
  "documentario-sobrio@1", "suspensao@1", "plantao@1",
  "cinematic-3d@1",
  "soft-realism@1",
  "documentario@1",
  "aquarela-2d@1",
  "flat-2d@1",
  "react-audiovisual@1",
  "vertical-social@1",
  "logo-fiel@1",
];

test("sem preset preserva prompt byte a byte após trim externo", () => {
  const result = composeDirection({ userPrompt: "Uma cena simples." });
  assert.equal(result.effectivePrompt, "Uma cena simples.");
  assert.equal(result.compositionAuthorized, false);
  assert.equal(result.directionPreset, null);
});

test("preset explícito registra composição e mantém o prompt literal", () => {
  const result = composeDirection({ userPrompt: "Uma ponte ao amanhecer.", style: "aquarela-2d" });
  assert.equal(result.directionPreset, "aquarela-2d@1");
  assert.equal(result.compositionAuthorized, true);
  assert.match(result.effectivePrompt, /watercolor/i);
  assert.ok(result.effectivePrompt.endsWith("Uma ponte ao amanhecer."));
});

test("presets são versionados e catálogo é cópia segura", () => {
  assert.ok(Object.keys(DIRECTION_PRESETS).every((id) => /@\d+$/.test(id)));
  assert.deepEqual(Object.keys(DIRECTION_PRESETS), LIVE_IDS);
  const list = listDirectionPresets();
  assert.equal(list.length, 11);
  list[0].label = "alterado";
  assert.notEqual(list[0].label, Object.values(DIRECTION_PRESETS)[0].label);
  assert.throws(() => composeDirection({ userPrompt: "x", style: "inexistente" }), /Preset desconhecido/);
});

test("StyleSpec é a fonte canônica sem alterar direction, aspect ou tags dos presets", () => {
  assert.equal(Object.keys(STYLE_SPECS).length, 13);
  for (const id of LIVE_IDS) {
    assert.equal(DIRECTION_PRESETS[id], STYLE_SPECS[id]);
    assert.equal(STYLE_SPECS[id].schema, STYLE_SPEC_SCHEMA);
    assert.equal(STYLE_SPECS[id].status, "pilot");
    assert.equal(STYLE_SPECS[id].studioOnly, true);
    assert.equal(isLiveSelectableStyleSpec(STYLE_SPECS[id]), true);
  }
  assert.equal(resolveDirectionPreset("vertical-social").aspect, "9:16");
  assert.deepEqual(resolveDirectionPreset("flat-2d").tags, ["2d", "flat", "motion-graphics"]);
  assert.match(resolveDirectionPreset("logo-fiel").direction, /absolute fidelity/i);
  assert.match(resolveDirectionPreset("react-audiovisual").direction, /literal modern React/i);
  assert.match(resolveDirectionPreset("react-audiovisual").direction, /frame zero must already be the first authored motion state/i);
  assert.match(resolveDirectionPreset("react-audiovisual").direction, /unless the user explicitly marks one as <FIRST_FRAME>/i);
  assert.deepEqual(resolveDirectionPreset("react-audiovisual").formats.allowedAspects, ["16:9", "9:16"]);
});

test("conceito streaks-de-luz é inspecionável, mas falha fechado para geração live", () => {
  const concept = resolveStyleSpec("produto/streaks-de-luz", { allowConcept: true });
  assert.equal(concept.status, "concept");
  assert.equal(concept.studioOnly, true);
  assert.equal(concept.generation.defaultTopology, "independent");
  assert.deepEqual(concept.generation.allowedTasks, ["image_to_video"]);
  assert.equal(concept.generation.defaultTask, "image_to_video");
  assert.equal(concept.runtimeInputs.maxReferences, 0);
  assert.equal(isLiveSelectableStyleSpec(concept), false);
  assert.equal(DIRECTION_PRESETS[concept.id], undefined);
  assert.throws(
    () => composeDirection({ userPrompt: "Luz abstrata.", style: concept.id }),
    /status concept.+não pode ser selecionado para geração live/,
  );
});

test("listStyleSpecs devolve cópia profunda e permite ocultar concepts", () => {
  const all = listStyleSpecs();
  assert.equal(all.length, 13);
  const concept = all.find((style) => style.id === "produto/streaks-de-luz@1");
  concept.generation.allowedTasks.push("edit");
  assert.deepEqual(STYLE_SPECS[concept.id].generation.allowedTasks, ["image_to_video"]);
  assert.equal(listStyleSpecs({ includeConcepts: false }).length, 11);
});
