import test from "node:test";
import assert from "node:assert/strict";
import {
  minePromptsWithGrok,
  generateDubleePrompts,
  GROK_PROMPT_MINER_SCHEMA,
  GROK_PROMPT_RECEIPT_SCHEMA,
} from "../lib/media-pipeline/grok-prompt-miner.mjs";
import { listProviderCapabilities } from "../lib/media-pipeline/provider-registry.mjs";

test("grok-prompt-miner: capacidade está registrada e suportada no Provider Registry", () => {
  const capabilities = listProviderCapabilities();
  const grok = capabilities.find((c) => c.id === "grok-miner");
  assert.ok(grok, "A capacidade grok-miner deve estar presente no registry.");
  assert.equal(grok.status, "supported");
  assert.deepEqual(grok.operations, ["prompt-mining", "image-prompt-generation", "video-prompt-generation"]);
});

test("grok-prompt-miner: rejeita briefing vazio ou ausente", async () => {
  await assert.rejects(
    () => minePromptsWithGrok({ brief: "" }),
    /brief é obrigatório/
  );
  await assert.rejects(
    () => minePromptsWithGrok({ brief: null }),
    /brief é obrigatório/
  );
});

test("grok-prompt-miner: gera prompts de vídeo no modo dublê por padrão", async () => {
  const result = await minePromptsWithGrok({
    brief: "Comercial de tênis esportivo em alta velocidade",
    targetMedia: "video",
    count: 3,
    dublee: true,
  });

  assert.equal(result.schema, GROK_PROMPT_MINER_SCHEMA);
  assert.equal(result.provider, "grok-miner");
  assert.equal(result.targetMedia, "video");
  assert.equal(result.prompts.length, 3);

  for (const promptItem of result.prompts) {
    assert.equal(promptItem.targetMedia, "video");
    assert.ok(promptItem.effectivePrompt.length > 20);
    assert.match(promptItem.effectivePrompt, /shot|camera|lighting|motion|tracking/i);
  }

  assert.equal(result.receipt.schema, GROK_PROMPT_RECEIPT_SCHEMA);
  assert.equal(result.receipt.provider, "grok-miner");
  assert.equal(result.receipt.promptsGenerated, 3);
  assert.equal(result.receipt.executionMode, 'offline');
});

test("grok-prompt-miner: gera prompts de imagem com estilo aplicado", async () => {
  const result = await minePromptsWithGrok({
    brief: "Xícara de café fumegante",
    targetMedia: "image",
    style: "aquarela-2d",
    count: 2,
    dublee: true,
  });

  assert.equal(result.targetMedia, "image");
  assert.equal(result.prompts.length, 2);
  assert.ok(result.prompts[0].effectivePrompt.includes("[Style: aquarela-2d]"));
});

test("generateDubleePrompts: gera número correto de variações", () => {
  const prompts = generateDubleePrompts({
    brief: "Carro elétrico futurista",
    targetMedia: "video",
    count: 4,
  });
  assert.equal(prompts.length, 4);
  assert.equal(prompts[0].variant, 1);
  assert.equal(prompts[3].variant, 4);
});
