import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_VIDS_VOICES,
  googleVidsVoiceCatalog,
  listGoogleVidsVoices,
  resolveGoogleVidsVoice,
} from "../lib/media-pipeline/google-vids-voices.mjs";

test("catálogo Google Vids expõe as 37 vozes observadas sem duplicatas", () => {
  assert.equal(GOOGLE_VIDS_VOICES.length, 37);
  assert.equal(new Set(GOOGLE_VIDS_VOICES.map((voice) => voice.name)).size, 37);
  assert.equal(GOOGLE_VIDS_VOICES.filter((voice) => voice.group === "natural").length, 30);
  assert.equal(GOOGLE_VIDS_VOICES.filter((voice) => voice.group === "classic").length, 7);
  assert.deepEqual(resolveGoogleVidsVoice("persuasiva"), {
    name: "Persuasiva",
    description: "Envolvente, tom grave",
    group: "classic",
    engine: "Google Vids",
  });
});

test("catálogo Google Vids filtra grupo e atributos em português", () => {
  assert.deepEqual(listGoogleVidsVoices({ group: "natural", query: "informativa" }).map((voice) => voice.name), ["Holt", "Iro"]);
  const catalog = googleVidsVoiceCatalog({ group: "classic" });
  assert.equal(catalog.total, 7);
  assert.equal(catalog.dynamicProviderCatalog, true);
  assert.throws(() => resolveGoogleVidsVoice("inexistente"), /npm run video -- voices/);
});
