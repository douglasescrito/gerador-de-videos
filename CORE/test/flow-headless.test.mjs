import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  FLOW_ATTEMPT_SCHEMA,
  FLOW_IMAGE_MODEL,
  FLOW_VIDEO_MODEL,
  flowMediaUrl,
  flowOutputPaths,
  parseFlowAvailabilityError,
  parseFlowCreditsLine,
  parseFlowMediaResponse,
  resolveFlowAspect,
  resolveFlowCount,
  resolveFlowDuration,
  resolveFlowResolution,
  runFlowImage,
  runFlowVideo,
} from "../scripts/flow-headless.mjs";
import {
  createCookieFlowImageOperation,
  createCookieFlowVideoOperation,
} from "../scripts/cookie-studio-operations.mjs";
import { PROVIDER_CAPABILITIES, resolveCapabilityIntent } from "../lib/media-pipeline/provider-registry.mjs";

let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "flow-adapter-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

const mp4 = () => Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test("a resposta de batchGenerate entrega id, workflow e o que o provedor entendeu", () => {
  const bruto = JSON.stringify({
    media: [
      { name: "media-1", workflowId: "wf-1", image: { generatedImage: { seed: 379839, prompt: "barras", modelNameType: "NARWHAL", fifeUrl: "https://flow-content.google/image/media-1" } } },
      { name: "media-2", workflowId: "wf-1", video: { generatedVideo: { seed: 11, prompt: "barras", modelNameType: "OMNI", fifeUrl: "https://flow-content.google/video/media-2" } } },
      { workflowId: "wf-sem-id" },
    ],
  });
  const lido = parseFlowMediaResponse(bruto);
  assert.equal(lido.length, 2, "entrada sem id não vira mídia");
  assert.deepEqual(lido[0], { name: "media-1", workflowId: "wf-1", kind: "image", seed: 379839, prompt: "barras", modelNameType: "NARWHAL", fifeUrl: "https://flow-content.google/image/media-1" });
  assert.equal(lido[1].kind, "video");
  assert.equal(parseFlowMediaResponse("não é json").length, 0);
});

test("o custo anunciado é lido antes de qualquer submissão", () => {
  assert.equal(parseFlowCreditsLine("A geração vai usar 12 créditos"), 12);
  assert.equal(parseFlowCreditsLine("A geração vai usar 1.050 créditos"), 1050);
  assert.equal(parseFlowCreditsLine("A geração vai usar 0 créditos"), 0);
  assert.equal(parseFlowCreditsLine("outra frase qualquer"), null);
  assert.equal(parseFlowCreditsLine(null), null);
});

test("falta de cota é distinguida de quebra no seletor de envio", () => {
  assert.match(
    parseFlowAvailabilityError("Não há créditos de IA e do Google Flow suficientes para realizar esta ação."),
    /Cota insuficiente no Google Flow/,
  );
  assert.equal(parseFlowAvailabilityError("A geração vai usar 12 créditos"), null);
});

test("a mídia é endereçada por id, com escape", () => {
  assert.equal(flowMediaUrl("abc-123"), "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=abc-123");
  assert.match(flowMediaUrl("a b&c"), /name=a%20b%26c$/);
  assert.throws(() => flowMediaUrl(""), /mediaName é obrigatório/);
});

test("o lote nomeia o primeiro pelo --out e sufixa os demais", () => {
  const saidas = flowOutputPaths("C:/saida/clipe.mp4", 3);
  assert.equal(path.basename(saidas[0]), "clipe.mp4");
  assert.equal(path.basename(saidas[1]), "clipe-2.mp4");
  assert.equal(path.basename(saidas[2]), "clipe-3.mp4");
  assert.equal(flowOutputPaths("C:/saida/clipe.mp4", 1).length, 1);
});

test("os parâmetros só aceitam o que o painel do Flow oferece", () => {
  assert.deepEqual(resolveFlowAspect("9:16"), { aspect: "9:16", icone: "crop_9_16" });
  assert.throws(() => resolveFlowAspect("1:1"), /só aceita 16:9 ou 9:16/);
  assert.equal(resolveFlowResolution("360p"), "360p");
  assert.throws(() => resolveFlowResolution("1080p"), /Resolução inválida/);
  assert.equal(resolveFlowDuration(10), 10);
  assert.throws(() => resolveFlowDuration(7), /Duração inválida/);
  assert.equal(resolveFlowCount(4), 4);
  assert.throws(() => resolveFlowCount(5), /Quantidade inválida/);
  assert.throws(() => resolveFlowCount(0), /Quantidade inválida/);
});

test("adapter live é proibido em NODE_ENV=test", async () => {
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    await assert.rejects(runFlowVideo({ prompt: "shapes" }), /Provider-free test guard/);
    await assert.rejects(runFlowImage({ prompt: "shapes" }), /Provider-free test guard/);
  } finally {
    if (anterior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = anterior;
  }
});

test("o recibo de vídeo guarda créditos, lote e a ausência de marca-d'água", async () => {
  const destino = path.join(root, "flow-clipe.mp4");
  let chamadas = 0;
  const gerar = createCookieFlowVideoOperation({
    generateVideo: async (options) => {
      chamadas += 1;
      assert.equal(options.aspect, "16:9");
      assert.equal(options.duration, 10);
      await writeFile(options.out, mp4());
      return {
        file: options.out, files: [options.out], model: "flow-omni-1.1-flash",
        aspect: "16:9", resolution: "720p", duration: 10, count: 1, creditos: 12,
        projectUrl: "https://labs.google/fx/pt/tools/flow/project/teste",
        media: [{ file: options.out, bytes: 12, mediaName: "media-1", workflowId: "wf-1", seed: 7, modelNameType: "OMNI" }],
        startedAt: "2026-08-28T18:00:00.000Z", completedAt: "2026-08-28T18:01:00.000Z",
      };
    },
  });
  const resultado = await gerar({ provider: "google-flow-video", prompt: "flat 2D bars", outputFile: destino, aspectRatio: "16:9", duration: 10 });
  assert.equal(chamadas, 1);
  assert.equal(resultado.receipt.provider, "google-flow-playwright");
  assert.equal(resultado.receipt.parameters.durationSeconds, 10);
  assert.equal(resultado.receipt.parameters.visibleWatermark, null);
  assert.equal(resultado.receipt.providerResponse.creditosAnunciados, 12);
  assert.equal(resultado.receipt.providerResponse.media[0].mediaName, "media-1");
  assert.equal(resultado.receipt.parameters.auth.mode, "windows-credential-manager");
  const serializado = await readFile(resultado.receiptFile, "utf8");
  assert.doesNotMatch(serializado, /recaptcha|__Secure|session-token/i);
});

test("o recibo de imagem registra o lote inteiro como artefato", async () => {
  const destino = path.join(root, "flow-quadro.png");
  const gerar = createCookieFlowImageOperation({
    generateImage: async (options) => {
      const segundo = destino.replace(".png", "-2.png");
      await writeFile(options.out, Buffer.from("png-1"));
      await writeFile(segundo, Buffer.from("png-2"));
      return {
        file: options.out, files: [options.out, segundo], model: "flow-nano-banana-2",
        aspect: "16:9", resolution: null, duration: null, count: 2, creditos: 0,
        projectUrl: "https://labs.google/fx/pt/tools/flow/project/teste",
        media: [
          { file: options.out, bytes: 5, mediaName: "img-1", workflowId: "wf-2", seed: 1, modelNameType: "NARWHAL" },
          { file: segundo, bytes: 5, mediaName: "img-2", workflowId: "wf-2", seed: 2, modelNameType: "NARWHAL" },
        ],
      };
    },
  });
  const resultado = await gerar({ provider: "google-flow-image", prompt: "flat chart", outputFile: destino, count: 2 });
  assert.equal(resultado.files.length, 2);
  assert.equal(resultado.receipt.artifacts.length, 2);
  assert.equal(resultado.receipt.providerResponse.creditosAnunciados, 0);
  assert.equal(resultado.receipt.operation, "generate-image");
});

test("cada adapter recusa provider que não é o dele antes de tocar no provedor", async () => {
  let chamadas = 0;
  const video = createCookieFlowVideoOperation({ generateVideo: async () => { chamadas += 1; } });
  const imagem = createCookieFlowImageOperation({ generateImage: async () => { chamadas += 1; } });
  await assert.rejects(video({ provider: "google-flow-image", prompt: "x", outputFile: path.join(root, "a.mp4") }), /O provider deste adapter é google-flow-video/);
  await assert.rejects(imagem({ provider: "gemini-image", prompt: "x", outputFile: path.join(root, "b.png") }), /O provider deste adapter é google-flow-image/);
  assert.equal(chamadas, 0);
});

test("kernel exigido bloqueia antes de gastar crédito", async () => {
  let chamadas = 0;
  const video = createCookieFlowVideoOperation({ generateVideo: async () => { chamadas += 1; } });
  await assert.rejects(
    video({ provider: "google-flow-video", prompt: "x", outputFile: path.join(root, "c.mp4"), executionKernel: "required" }),
    /não foi emitida pelo journal/,
  );
  assert.equal(chamadas, 0);
});

test("o Flow entra como secundário sem disputar o intent do provedor principal", () => {
  const principal = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "video.generate.text", operation: "text-to-video" });
  assert.equal(principal.capability.id, "gemini-omni");

  const imagemPrincipal = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "image.generate", operation: "image-generate" });
  assert.equal(imagemPrincipal.capability.id, "gemini-image");

  assert.equal(PROVIDER_CAPABILITIES["google-flow-video"].reconcile, false);
  assert.equal(PROVIDER_CAPABILITIES["google-flow-image"].reconcile, false);

  // O intent secundário de imagem é só do Flow enquanto o gemini-image está fora.
  const imagemSecundaria = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "image.generate.secondary", operation: "image-generate" });
  assert.equal(imagemSecundaria.capability.id, "google-flow-image");

  // Vids e Flow dividem o intent secundário de vídeo: a seleção automática é
  // recusada de propósito, para que a escolha do caminho continue humana.
  assert.throws(
    () => resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "video.generate.text.secondary", operation: "text-to-video" }),
    /mais de uma capability ativa/,
  );
});

test("constantes do recibo ficam estáveis para quem lê o acervo", () => {
  assert.equal(FLOW_ATTEMPT_SCHEMA, "google-flow-attempt@1");
  assert.equal(FLOW_VIDEO_MODEL, "flow-omni-1.1-flash");
  assert.equal(FLOW_IMAGE_MODEL, "flow-nano-banana-2");
});
