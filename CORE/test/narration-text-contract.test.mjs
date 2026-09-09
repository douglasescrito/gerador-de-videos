import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  applyLlmAlignmentProposal,
  bindExactGraphicsTextToLocalWords,
  bindGraphicsTextPlan,
  buildLlmAlignmentRequest,
  remapCanonicalWordsToClipWindows,
  withVerifiedGraphicsText,
  withVerifiedLocalWordTimeline,
} from "../lib/media-pipeline/narration-text-contract.mjs";

const measured = [
  { word: "Bem", start: 1.48, end: 2.1, probability: 0.98 },
  { word: "-vindo", start: 2.1, end: 2.68, probability: 0.97 },
  { word: "à", start: 2.7, end: 2.82, probability: 0.99 },
  { word: "nova", start: 2.82, end: 3.16, probability: 0.99 },
  { word: "era", start: 3.16, end: 3.42, probability: 0.99 },
];

function proposal(request) {
  return {
    schema: "mkt-videos/llm-alignment-proposal@1",
    requestFingerprint: request.fingerprint,
    model: "fixture-llm",
    assignments: [
      { scriptTokenIndex: 0, measuredTokenIndexes: [0, 1], reason: "hyphen-fragment" },
      { scriptTokenIndex: 1, measuredTokenIndexes: [2], reason: "exact" },
      { scriptTokenIndex: 2, measuredTokenIndexes: [3], reason: "exact" },
      { scriptTokenIndex: 3, measuredTokenIndexes: [4], reason: "exact" },
    ],
  };
}

test("LLM só propõe índices; texto vem do roteiro e tempo vem do Whisper", () => {
  const request = buildLlmAlignmentRequest({
    blockId: "bloco-5",
    script: "Bem-vindo à nova era",
    transcript: "Bem-vindo à nova era",
    words: measured,
  });
  const binding = applyLlmAlignmentProposal({ request, proposal: proposal(request) });
  assert.equal(binding.textAuthority, "approved-script-only");
  assert.equal(binding.timestampAuthority, "whisper-measured-only");
  assert.equal(binding.llmAuthority, "proposal-only");
  assert.deepEqual(binding.words.map((word) => word.word), ["Bem-vindo", "à", "nova", "era"]);
  assert.deepEqual([binding.words[0].start, binding.words[0].end], [1.48, 2.68]);
  assert.equal(binding.words[0].transcribed, "Bem-vindo");
});

test("request, proposta e timeline canônica cumprem os schemas fechados", async () => {
  const request = buildLlmAlignmentRequest({ blockId: "bloco-5", script: "Bem-vindo à nova era", words: measured });
  const proposed = proposal(request);
  const timeline = applyLlmAlignmentProposal({ request, proposal: proposed });
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const [file, value] of [
    ["llm-alignment-request.schema.json", request],
    ["llm-alignment-proposal.schema.json", proposed],
    ["canonical-word-timeline.schema.json", timeline],
  ]) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${file}`, import.meta.url), "utf8"));
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, `${file}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("proposta LLM adulterada, incompleta ou reaproveitada falha fechada", () => {
  const request = buildLlmAlignmentRequest({ blockId: "b", script: "Bem-vindo à nova era", words: measured });
  const wrongRequest = { ...proposal(request), requestFingerprint: "outro-fingerprint-0000" };
  assert.throws(() => applyLlmAlignmentProposal({ request, proposal: wrongRequest }), /não pertence/);

  const injectedText = { ...proposal(request), correctedText: "TEXTO INVENTADO" };
  assert.throws(() => applyLlmAlignmentProposal({ request, proposal: injectedText }), /campos não autorizados/);

  const omitted = proposal(request);
  omitted.assignments[0] = { ...omitted.assignments[0], measuredTokenIndexes: [0] };
  assert.throws(() => applyLlmAlignmentProposal({ request, proposal: omitted }), /texto divergente|omitiu palavra medida/);

  const inventedToken = proposal(request);
  inventedToken.assignments.push({ scriptTokenIndex: 4, measuredTokenIndexes: [4] });
  assert.throws(() => applyLlmAlignmentProposal({ request, proposal: inventedToken }), /todos os tokens do roteiro/);

  const semanticSwapRequest = buildLlmAlignmentRequest({
    blockId: "troca",
    script: "Ela transforma tudo",
    words: [
      { word: "Ela", start: 0, end: 0.3 },
      { word: "transportou", start: 0.3, end: 0.9 },
      { word: "tudo", start: 0.9, end: 1.2 },
    ],
  });
  assert.throws(() => applyLlmAlignmentProposal({
    request: semanticSwapRequest,
    proposal: {
      schema: "mkt-videos/llm-alignment-proposal@1",
      requestFingerprint: semanticSwapRequest.fingerprint,
      assignments: [
        { scriptTokenIndex: 0, measuredTokenIndexes: [0] },
        { scriptTokenIndex: 1, measuredTokenIndexes: [1] },
        { scriptTokenIndex: 2, measuredTokenIndexes: [2] },
      ],
    },
  }), /texto divergente/);
});

test("plano gráfico escolhe só índices; texto exato continua vindo da cena", () => {
  const words = [
    { word: "a", start: 0.1, end: 0.3 },
    { word: "mente", start: 0.3, end: 0.8 },
    { word: "acelerou", start: 0.8, end: 1.4 },
  ];
  const bindings = bindGraphicsTextPlan({
    scenes: [{ id: "c02", onScreenText: "FAÍSCA" }],
    words,
    proposal: {
      schema: "mkt-videos/graphics-text-plan@1",
      timelineFingerprint: "timeline-fingerprint-0001",
      bindings: [{ sceneId: "c02", startWordIndex: 1, endWordIndex: 2, reason: "clímax semântico" }],
    },
    timelineFingerprint: "timeline-fingerprint-0001",
  });
  assert.deepEqual(bindings[0], {
    sceneId: "c02",
    text: "FAÍSCA",
    binding: {
      start: 0.3,
      end: 1.4,
      startWordIndex: 1,
      endWordIndex: 2,
      textAuthority: "scene-spec-only",
      timestampAuthority: "canonical-word-timeline-only",
    },
  });
  const prompt = withVerifiedGraphicsText("Cena cinética.", bindings[0]);
  assert.match(prompt, /exact text "FAÍSCA"/);
  assert.match(prompt, /0\.300s/);
  assert.doesNotMatch(prompt, /clímax semântico/);
  assert.throws(() => bindGraphicsTextPlan({
    scenes: [{ id: "c02", onScreenText: "FAÍSCA" }],
    words,
    timelineFingerprint: "outra-timeline-000000",
    proposal: {
      schema: "mkt-videos/graphics-text-plan@1",
      timelineFingerprint: "timeline-fingerprint-0001",
      bindings: [{ sceneId: "c02", startWordIndex: 1, endWordIndex: 2 }],
    },
  }), /não pertence/);
});

test("timeline global vira tempos locais de clipes Omni de dez segundos", () => {
  const bindings = remapCanonicalWordsToClipWindows({
    scenes: [
      { id: "c1", expectedDuration: 10 },
      { id: "c2", expectedDuration: 10 },
      { id: "c3", expectedDuration: 10 },
    ],
    words: [
      { word: "primeiro", start: 0.2, end: 0.7 },
      { word: "segundo", start: 12.35, end: 12.8 },
      { word: "terceiro", start: 23.4, end: 24.1 },
    ],
  });
  assert.deepEqual(bindings.map((entry) => entry.binding.words[0]?.start), [0.2, 2.35, 3.4]);
  assert.deepEqual(bindings.map((entry) => entry.binding.clipOrigin), [0, 10, 20]);
  assert.equal(bindings[2].binding.words[0].word, "terceiro");
  const prompt = withVerifiedLocalWordTimeline("Cena dinâmica.", bindings[2].binding);
  assert.match(prompt, /global timestamp minus clip origin/i);
  assert.match(prompt, /\[3\.400s - 4\.100s\] terceiro/);
  assert.doesNotMatch(prompt, /\[23\.400s/);
});

test("remapeamento bloqueia locução que excede a quantidade de clipes", () => {
  assert.throws(() => remapCanonicalWordsToClipWindows({
    scenes: [{ id: "c1", expectedDuration: 10 }],
    words: [{ word: "fora", start: 10.1, end: 10.5 }],
  }), /excede a janela visual/);
});

test("texto gráfico exato recebe a janela local sem usar grafia do Whisper", () => {
  const result = bindExactGraphicsTextToLocalWords({
    scene: { id: "cena", onScreenText: "NOVAS POSSIBILIDADES" },
    binding: { words: [
      { word: "novas", start: 2.1, end: 2.5, wordIndex: 20 },
      { word: "possibilidades.", start: 2.5, end: 3.4, wordIndex: 21 },
    ] },
  });
  assert.equal(result.text, "NOVAS POSSIBILIDADES");
  assert.deepEqual([result.binding.start, result.binding.end], [2.1, 3.4]);
  assert.equal(result.binding.textAuthority, "scene-spec-only");
});
