import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWhisperMeasurements,
  evaluateBackendPromotion,
} from "../lib/media-pipeline/whisper-equivalence.mjs";

const script = "Você não precisa de sorte.";
const reference = {
  transcript: "Você não precisa de sorte.",
  words: [
    { word: "Voce", start: 0.20, end: 0.55, probability: 0.98 },
    { word: "nao", start: 0.60, end: 0.80, probability: 0.97 },
    { word: "precisa", start: 0.85, end: 1.30, probability: 0.96 },
    { word: "de", start: 1.35, end: 1.45, probability: 0.99 },
    { word: "sorte", start: 1.50, end: 2.00, probability: 0.95 },
  ],
};

const shifted = (delta) => ({
  transcript: reference.transcript,
  words: reference.words.map((word) => ({ ...word, start: word.start + delta, end: word.end + delta })),
});

test("candidato com a mesma medição é aceito", () => {
  const result = compareWhisperMeasurements({ script, reference, candidate: structuredClone(reference), blockId: "n01" });
  assert.equal(result.verdict, "accepted");
  assert.equal(result.transcript.identical, true);
  assert.equal(result.decision.reference, "pass");
  assert.equal(result.decision.candidate, "pass");
  assert.equal(result.timing.maxDeltaSeconds, 0);
});

test("desvio pequeno passa; desvio acima da tolerância reprova", () => {
  assert.equal(compareWhisperMeasurements({ script, reference, candidate: shifted(0.02) }).verdict, "accepted");
  const drifted = compareWhisperMeasurements({ script, reference, candidate: shifted(0.4) });
  assert.equal(drifted.verdict, "rejected");
  assert.equal(drifted.findings.some((finding) => finding.code === "timestamp_out_of_tolerance"), true);
});

test("transcrição diferente reprova mesmo com tempos idênticos", () => {
  const candidate = {
    transcript: "Você não precisa de sonho.",
    words: reference.words.map((word, index) => (index === 4 ? { ...word, word: "sonho" } : word)),
  };
  const result = compareWhisperMeasurements({ script, reference, candidate });
  assert.equal(result.verdict, "rejected");
  assert.equal(result.findings.some((finding) => finding.code === "transcript_diverged"), true);
});

test("diferença lexical reprova equivalência sem dar autoridade textual ao Whisper", () => {
  const blockedScript = "Ela transforma tudo.";
  const blockingReference = {
    transcript: "Ela transportou tudo.",
    words: [
      { word: "Ela", start: 0, end: 0.3, probability: 0.9 },
      { word: "transportou", start: 0.3, end: 0.9, probability: 0.9 },
      { word: "tudo", start: 0.9, end: 1.2, probability: 0.9 },
    ],
  };
  const optimisticCandidate = {
    transcript: "Ela transforma tudo.",
    words: [
      { word: "Ela", start: 0, end: 0.3, probability: 0.9 },
      { word: "transforma", start: 0.3, end: 0.9, probability: 0.9 },
      { word: "tudo", start: 0.9, end: 1.2, probability: 0.9 },
    ],
  };
  const result = compareWhisperMeasurements({ script: blockedScript, reference: blockingReference, candidate: optimisticCandidate });
  assert.equal(result.verdict, "rejected");
  // Ambos têm janelas temporais completas: a grafia publicada vem do roteiro,
  // portanto a hipótese lexical do Whisper não bloqueia o alinhamento isolado.
  assert.equal(result.decision.reference, "pass");
  assert.equal(result.decision.candidate, "pass");
  // A comparação entre backends ainda detecta que as medições divergem e não
  // promove automaticamente o candidato.
  assert.equal(result.findings.some((finding) => finding.code === "transcript_diverged"), true);
});

test("um bloco reprovado reprova a promoção inteira", () => {
  const good = compareWhisperMeasurements({ script, reference, candidate: structuredClone(reference), blockId: "n01" });
  const bad = compareWhisperMeasurements({ script, reference, candidate: shifted(0.9), blockId: "n02" });

  const accepted = evaluateBackendPromotion({ comparisons: [good], speedup: 2.4 });
  assert.equal(accepted.verdict, "accepted");
  assert.equal(accepted.speedup, 2.4);
  assert.equal(accepted.policy.autoPromote, false);

  const rejected = evaluateBackendPromotion({ comparisons: [good, bad], speedup: 3.1 });
  assert.equal(rejected.verdict, "rejected");
  assert.deepEqual(rejected.rejectedBlocks, ["n02"]);
  // Velocidade não compra aprovação.
  assert.equal(rejected.speedup, 3.1);
});

test("promoção exige corpus", () => {
  assert.throws(() => evaluateBackendPromotion({ comparisons: [] }), /ao menos um bloco/);
});
