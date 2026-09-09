import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCueSheet } from './sfx-cue-sheet-generator.mjs';

test('generateCueSheet - happy path with spacing and limits', () => {
  const scriptPlan = {
    schema: "mkt-videos/script-plan@1",
    blocks: [
      {
        id: "n01",
        energy: "LOW",
        impactWords: ["word1", "word2"] // Only 1 allowed for LOW
      },
      {
        id: "n02",
        energy: "RISING",
        impactWords: ["word3", "word4"] // 2 allowed for RISING
      }
    ]
  };
  
  const palavras = {
    duration: 10.0,
    words: [
      { word: "word1", start: 1.0, end: 1.2 },
      { word: "word2", start: 2.0, end: 2.2 }, // This should be rejected because LOW limit is 1
      { word: "word3", start: 3.0, end: 3.2 },
      { word: "word4", start: 3.5, end: 3.7 }  // Rejected because < 900ms from word3 (3000 -> 3500 is 500ms)
    ]
  };

  const cueSheet = generateCueSheet(palavras, scriptPlan, "fingerprint-123");
  
  assert.strictEqual(cueSheet.schema, "mkt-videos/sfx-cue-sheet@1");
  assert.strictEqual(cueSheet.cues.length, 2); // word1 and word3
  
  const rejected = cueSheet.rejected;
  assert.strictEqual(rejected.length, 2);
  assert.strictEqual(rejected[0].word, "word2");
  assert.match(rejected[0].reason, /limite de cues excedido/);
  assert.strictEqual(rejected[1].word, "word4");
  assert.match(rejected[1].reason, /distanciamento mínimo de 900ms/);
});

test('generateCueSheet - missing word', () => {
  const scriptPlan = {
    schema: "mkt-videos/script-plan@1",
    blocks: [
      { id: "n01", energy: "LOW", impactWords: ["word1"] }
    ]
  };
  const palavras = { words: [{ word: "other", start: 1.0, end: 1.2 }] };
  
  const cueSheet = generateCueSheet(palavras, scriptPlan, "fp");
  assert.strictEqual(cueSheet.cues.length, 0);
  assert.strictEqual(cueSheet.rejected.length, 1);
  assert.match(cueSheet.rejected[0].reason, /não encontrada/);
});
