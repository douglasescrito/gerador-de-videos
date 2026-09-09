import assert from "node:assert/strict";
import test from "node:test";
import { captionAssDocument, captionSrtDocument, captionVttDocument, captionWords, resolveCaptionStyle } from "../lib/media-pipeline/captions.mjs";

test("palavras rápidas preservam os limites Whisper sem sobrepor o cue seguinte", () => {
  const words = captionWords([{ word: "o", start: 8.34, end: 8.4 }, { word: "que", start: 8.4, end: 8.6 }]);
  assert.equal(words[0].end, words[1].start);
  const style = { ...resolveCaptionStyle(), initialScale: 100, normalScale: 100, fadeInMs: 0, fadeOutMs: 0 };
  const ass = captionAssDocument(words, { style });
  assert.match(ass, /fad\(0,0\)/);
  assert.doesNotMatch(ass, /fscx72/);
  assert.throws(() => captionAssDocument(words, { style: { ...style, initialScale: NaN } }), /inválido/);
});

test("legendas validam palavras e geram ASS determinístico", () => {
  const words = captionWords([{ word: "Olá", start: 0, end: 0.5 }, { word: "mundo", start: 0.6, end: 1 }]);
  const ass = captionAssDocument(words);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:00.50/);
  assert.match(ass, /Olá/);
  assert.throws(() => captionWords([{ word: "", start: 0, end: 1 }]), /inválida/);
});

test("SRT e VTT derivam dos mesmos cues monotônicos", () => {
  const words = captionWords([{ word: "Olá", start: 0, end: 0.5 }]);
  assert.match(captionSrtDocument(words), /00:00:00,000 --> 00:00:00,500/);
  assert.match(captionVttDocument(words), /^WEBVTT/);
  assert.match(captionVttDocument(words), /00:00:00\.000 --> 00:00:00\.500/);
});

test("caption style remove vocabulário especial e usa ênfase declarativa", () => {
  const regular = captionAssDocument(captionWords([{ word: "AI", start: 0, end: 0.5 }]));
  const emphasized = captionAssDocument(captionWords([{ word: "qualquer", start: 0, end: 0.5, emphasis: true }]), { aspect: "9:16" });
  assert.match(regular, /fscx116/);
  assert.doesNotMatch(regular, /fscx132/);
  assert.match(emphasized, /PlayResX: 720/);
  assert.match(emphasized, /fscx132/);
});
