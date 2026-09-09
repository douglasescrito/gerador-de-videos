import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VIDS_VIDEO_ATTEMPT_SCHEMA,
  VIDS_VIDEO_MODEL,
  detectNonEnglishPrompt,
  parseVidsGenerateResponse,
  parseVidsQuotaSummary,
  resolveVidsAspect,
  runVidsVideo,
} from "../scripts/vids-video-headless.mjs";
import { PROVIDER_CAPABILITIES, resolveCapabilityIntent } from "../lib/media-pipeline/provider-registry.mjs";

const MEDIA_URL = "https://contribution-rt.usercontent.google.com/download?c=CgxiYXJkX3N0b3JhZ2U&filename=video.mp4&opi=108436427";

function generateResponse({ width = 1280, height = 720, duration = "10" } = {}) {
  const media = ["284cfd87b939", "bard_storage", "temp_data", "lookup_temp_data", MEDIA_URL, width, height, [duration]];
  return JSON.stringify([[[[[null, null, null, null, null, null, [null, null, null, null, media, [12, 0]]]]]], null, []]);
}

test("resposta de /v1/genai/generate entrega URL temporária, dimensões e duração", () => {
  const parsed = parseVidsGenerateResponse(generateResponse());
  assert.equal(parsed.mediaUrl, MEDIA_URL);
  assert.equal(parsed.width, 1280);
  assert.equal(parsed.height, 720);
  assert.equal(parsed.durationSeconds, 10);
});

test("prefixo anti-hijack é removido antes da leitura", () => {
  const parsed = parseVidsGenerateResponse(`)]}'\n${generateResponse({ width: 720, height: 1280 })}`);
  assert.equal(parsed.width, 720);
  assert.equal(parsed.height, 1280);
});

test("varredura textual salva resposta que não fecha como JSON", () => {
  const truncated = `)]}'\n[[[[ "${MEDIA_URL}",1280,720,["10"]`;
  const parsed = parseVidsGenerateResponse(truncated);
  assert.equal(parsed.mediaUrl, MEDIA_URL);
  assert.equal(parsed.width, 1280);
  assert.equal(parsed.durationSeconds, 10);
});

test("resposta sem mídia não vira clipe fantasma", () => {
  assert.equal(parseVidsGenerateResponse(JSON.stringify([[null], null])), null);
  assert.equal(parseVidsGenerateResponse(""), null);
});

test("cota mensal do Vids é lida com limite, restante e data de virada", () => {
  const quota = parseVidsQuotaSummary(JSON.stringify([[null, ["50", null, "49", 1, null, null, ["1788246000"], 0], "1", [9], 1, 26, 32]]));
  assert.equal(quota.limit, 50);
  assert.equal(quota.remaining, 49);
  assert.equal(quota.used, 1);
  assert.equal(quota.resetsAt, new Date(1788246000 * 1000).toISOString());
  assert.equal(parseVidsQuotaSummary("não é json"), null);
});

test("o seletor do Vids só aceita as duas proporções que existem na UI", () => {
  assert.deepEqual(resolveVidsAspect("16:9"), { aspect: "16:9", label: "Paisagem", option: "Paisagem 16:9" });
  assert.deepEqual(resolveVidsAspect("9:16"), { aspect: "9:16", label: "Retrato", option: "Retrato 9:16" });
  assert.throws(() => resolveVidsAspect("1:1"), /só aceita 16:9 ou 9:16/);
});

test("comando em português é sinalizado sem bloquear a submissão", () => {
  assert.equal(detectNonEnglishPrompt("Três formas planas deslizam para o centro."), true);
  assert.equal(detectNonEnglishPrompt("uma barra colorida entra pela esquerda"), true);
  assert.equal(detectNonEnglishPrompt("Flat 2D motion design, three shapes glide in and align."), false);
});

test("adapter live é proibido em NODE_ENV=test", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    await assert.rejects(runVidsVideo({ prompt: "flat 2D shapes" }), /Provider-free test guard/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("google-vids-video não disputa o intent do gemini-omni", () => {
  const primary = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "video.generate.text", operation: "text-to-video" });
  assert.equal(primary.status, "ready");
  assert.equal(primary.capability.id, "gemini-omni");

  // Desde que o google-flow-video entrou, existem dois caminhos secundários
  // vivos no mesmo intent. O registry recusa escolher entre eles de propósito:
  // qual fallback usar é decisão humana, feita pelo comando que se digita.
  assert.throws(
    () => resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "video.generate.text.secondary", operation: "text-to-video" }),
    /mais de uma capability ativa/,
  );
  const vids = PROVIDER_CAPABILITIES["google-vids-video"];
  assert.equal(vids.status, "supported");
  assert.equal(vids.reconcile, false);
  assert.deepEqual([...vids.aspects], ["16:9", "9:16"]);
});

test("constantes do recibo ficam estáveis para quem lê o acervo", () => {
  assert.equal(VIDS_VIDEO_ATTEMPT_SCHEMA, "google-vids-video-attempt@1");
  assert.equal(VIDS_VIDEO_MODEL, "google-vids-omni-720p");
});
