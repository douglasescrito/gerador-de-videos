import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_BACKENDS,
  FLOW_MUSIC_GENERATION_MODELS,
  DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
  MUSIC_PRESETS,
  FLOW_MUSIC_TAG_TAXONOMY,
  FLOW_AUDIO_ENHANCEMENT_PROFILES,
  resolveAudioEnhancementFilter,
  buildSmartFlowPrompt,
  resolveMusicPrompt,
  resolveFlowMusicGenerationModel,
} from "../lib/media-pipeline/flow-music.mjs";

test("Flow Music é o único backend musical do gerador", () => {
  assert.deepEqual(Object.keys(MUSIC_BACKENDS), ["flow-music"]);
  assert.equal(MUSIC_BACKENDS["flow-music"].operational, true);
});

test("Lyria 3.5 é o modelo explícito padrão do Flow Music", () => {
  assert.equal(DEFAULT_FLOW_MUSIC_GENERATION_MODEL, "lyria-3.5");
  assert.equal(MUSIC_BACKENDS["flow-music"].model, "flow-music-web");
  assert.equal(MUSIC_BACKENDS["flow-music"].defaultGenerationModel, "lyria-3.5");
  assert.equal(FLOW_MUSIC_GENERATION_MODELS["lyria-3.5"].label, "Lyria 3.5");
  assert.deepEqual(resolveFlowMusicGenerationModel("Lyria 3.5"), FLOW_MUSIC_GENERATION_MODELS["lyria-3.5"]);
  assert.throws(() => resolveFlowMusicGenerationModel("modelo-inexistente"), /Modelo Flow Music desconhecido/);
});

test("direção musical combina preset e texto literal", () => {
  const result = resolveMusicPrompt({ preset: "institucional", prompt: "Pulso discreto." });
  assert.equal(result.userPrompt, "Pulso discreto.");
  assert.match(result.effectivePrompt, /Instrumental institutional soundtrack/);
  assert.match(result.effectivePrompt, /Pulso discreto\.$/);
});

test("buildSmartFlowPrompt compõe prompt 5+1+1 estruturado com tags e salvaguarda negativa", () => {
  const prompt = buildSmartFlowPrompt({
    durationSeconds: 45,
    genre: "Modern Corporate Underscore",
    mood: "inspiring",
    bpm: 118,
    key: "D major",
    instruments: ["clean muted electric guitar", "warm synth pads"],
    mix: ["wide stereo field", "analog tape warmth"],
  });

  assert.match(prompt, /\[Format: 45-second commercial cue/);
  assert.match(prompt, /Modern Corporate Underscore/);
  assert.match(prompt, /inspiring atmosphere/);
  assert.match(prompt, /118 BPM/);
  assert.match(prompt, /D major/);
  assert.match(prompt, /clean muted electric guitar/);
  assert.match(prompt, /wide stereo field/);
  assert.match(prompt, /NEGATIVE AUDIO PROMPT/);
});

test("resolveMusicPrompt compõe dinamicamente com atributos musicais", () => {
  const result = resolveMusicPrompt({
    genre: "Cyber Synthwave 80s",
    mood: "energetic",
    bpm: 124,
    duration: 30,
  });

  assert.ok(result.smartPrompt);
  assert.match(result.effectivePrompt, /Cyber Synthwave 80s/);
  assert.match(result.effectivePrompt, /124 BPM/);
  assert.match(result.effectivePrompt, /NEGATIVE AUDIO PROMPT/);
});

test("FLOW_MUSIC_TAG_TAXONOMY expõe catálogo de estruturas, gêneros, climas, BPMs e mixagem", () => {
  assert.equal(FLOW_MUSIC_TAG_TAXONOMY.schema, "mkt-videos/flow-music-tag-taxonomy@1");
  assert.ok(FLOW_MUSIC_TAG_TAXONOMY.structures.length > 5);
  assert.ok(FLOW_MUSIC_TAG_TAXONOMY.genres.corporate.length >= 3);
  assert.ok(FLOW_MUSIC_TAG_TAXONOMY.bpms.includes(120));
  assert.ok(Object.keys(MUSIC_PRESETS).includes("podcast-lofi"));
  assert.ok(Object.keys(MUSIC_PRESETS).includes("boom-bap-90s"));
});

test("FLOW_AUDIO_ENHANCEMENT_PROFILES expõe perfis de masterização e resolveAudioEnhancementFilter valida", () => {
  const profiles = Object.keys(FLOW_AUDIO_ENHANCEMENT_PROFILES);
  assert.ok(profiles.includes("transparent"));
  assert.ok(profiles.includes("warm-tape"));

  const transparentFilter = resolveAudioEnhancementFilter("transparent");
  assert.equal(transparentFilter, null);

  const warmFilter = resolveAudioEnhancementFilter("warm-tape");
  assert.match(warmFilter, /lowpass=f=16000/);

  assert.throws(() => resolveAudioEnhancementFilter("perfil-invalido"), /Perfil de áudio desconhecido/);
});
