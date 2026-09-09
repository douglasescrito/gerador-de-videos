import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compilarProductionSpec, validarProductionSpec } from "../lib/media-pipeline/production-spec.mjs";

const documento = {
  schema: "mkt-videos/production-spec@1",
  name: "teste-producao",
  aspect: "16:9",
  narration: {
    provider: "omni",
    blocks: [
      { id: "c1", text: "Bloco sintético A." },
      { id: "c2", text: "Bloco sintético B." },
    ],
  },
  sync: { engine: "whisper-word-timestamps", scenesFollowSpeech: true },
  scenes: [
    { id: "c1", block: "c1", visual: "Formas suaves se organizando.", onScreenText: "O COMEÇO" },
    { id: "c2", block: "c2", visual: "Cards se conectando.", onScreenText: "O CAMINHO" },
  ],
  music: { preset: "institucional", fit: "exact", fadeOut: 0 },
  assembly: { fps: 24 },
  qa: { structural: true },
  delivery: { profile: "web-1080p" },
};

test("validarProductionSpec aceita documento mestre completo", () => {
  const valido = validarProductionSpec(documento);
  assert.equal(valido.schema, "mkt-videos/production-spec@1");
  assert.equal(valido.name, "teste-producao");
  assert.equal(valido.narration.blocks.length, 2);
  assert.equal(valido.scenes.length, 2);
  assert.equal(valido.sync.scenesFollowSpeech, true);
  assert.equal(valido.music.preset, "institucional");
});

test("validarProductionSpec exige blocks únicos e scenes ligadas a blocks", () => {
  assert.throws(() => validarProductionSpec({ ...documento, name: "dup", narration: { provider: "omni", blocks: [{ id: "x", text: "a" }, { id: "x", text: "b" }] } }), /duplicado/);
  assert.throws(() => validarProductionSpec({ ...documento, name: "orf", scenes: [{ id: "c9", block: "c9", visual: "x" }] }), /block inexistente/);
});

test("compilarProductionSpec gera film-spec@2 e execution-plan com etapas", () => {
  const { production, filmSpec, plan } = compilarProductionSpec(documento);
  assert.equal(filmSpec.schema, "mkt-videos/film-spec@2");
  assert.equal(filmSpec.narration.mode, "omni");
  assert.equal(filmSpec.narration.blocks.length, 2);
  assert.equal(filmSpec.music.mode, "generated");
  assert.equal(filmSpec.scenes.length, 2);
  assert.equal(filmSpec.scenes[0].visualPrompt, "Formas suaves se organizando.");
  // Execution-plan cobre de ponta a ponta.
  const ids = plan.nodes.map((n) => n.id);
  assert.ok(ids.includes("video:narration:c1"));
  assert.ok(ids.includes("voice-master"));
  assert.ok(ids.includes("alignment"));
  assert.ok(ids.includes("timeline-lock"));
  assert.ok(ids.includes("video:c1"));
  assert.ok(ids.includes("assembly"));
  assert.ok(ids.includes("master"));
  assert.ok(ids.includes("delivery"));
  assert.ok(plan.fingerprint);
});

test("compilarProductionSpec é determinístico", () => {
  const a = compilarProductionSpec(documento);
  const b = compilarProductionSpec(documento);
  assert.equal(a.plan.fingerprint, b.plan.fingerprint);
});

test('public production document compiles with own-account Google Vids placeholders', async () => {
  const input = JSON.parse(await readFile(new URL('../recipes/exemplo-documento-mestre.json', import.meta.url), 'utf8'));
  const { filmSpec, plan } = compilarProductionSpec(input);
  assert.equal(filmSpec.narration.provider, 'google-vids');
  assert.equal(filmSpec.narration.mode, 'continuous');
  assert.equal(filmSpec.narration.blocks.length, 3);
  assert.match(filmSpec.narration.documentUrl, /USER_DOCUMENT_ID$/);
  assert.equal(filmSpec.music.backend, 'flow-music');
  assert.ok(filmSpec.scenes.every(scene => !scene.onScreenText && !scene.references.length));
  assert.ok(!plan.nodes.some(node => node.id.startsWith('video:narration:')));
  assert.equal(compilarProductionSpec(input).plan.fingerprint, plan.fingerprint);
});
