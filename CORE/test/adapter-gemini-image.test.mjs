import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiImageAdapter, GEMINI_IMAGE_ADAPTER_ID } from "../lib/media-pipeline/adapters/gemini-image.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeDirectAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });

function dubleDeImagem({ aoGerar = () => {} } = {}) {
  return {
    async generate(pedido) {
      aoGerar(pedido);
      return {
        file: pedido.outputFile,
        receiptFile: `${pedido.outputFile}.receipt.json`,
        receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "image" }] },
        interactionId: "interaction:teste",
      };
    },
  };
}

test("o adapter assina o contrato e declara o que faz", () => {
  const adapter = createGeminiImageAdapter({ operacaoDeImagem: dubleDeImagem() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, GEMINI_IMAGE_ADAPTER_ID);
  assert.equal(adapter.kind, "image");
  assert.deepEqual(adapter.paidOperations, ["image-generate"]);
  assert.deepEqual(adapter.reconcileOperations, []);
});

test("passa na conformidade sem tocar provedor", async () => {
  const adapter = createGeminiImageAdapter({ operacaoDeImagem: dubleDeImagem() });
  const relatorio = await runAdapterConformanceSuite({
    adapter, capabilityRegistry: await registro(), operation: "image-generate",
    request: { prompt: "p", outputFile: "quadro.png" },
  });
  assert.equal(relatorio.passed, true, JSON.stringify(relatorio.checks));
  assert.equal(relatorio.providerFree, true);
});

test("referências e tamanho chegam à operação", async () => {
  let recebido = null;
  const adapter = createGeminiImageAdapter({ operacaoDeImagem: dubleDeImagem({ aoGerar: (p) => { recebido = p; } }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "image-generate",
    request: { prompt: "p", outputFile: "quadro.png", images: ["ref.png"], imageSize: "2K", aspectRatio: "16:9" },
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.deepEqual(recebido.images, ["ref.png"]);
  assert.equal(recebido.imageSize, "2K");
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.metadata.interactionId, "interaction:teste");
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let gerou = 0;
  const adapter = createGeminiImageAdapter({ operacaoDeImagem: dubleDeImagem({ aoGerar: () => { gerou += 1; } }) });
  const registroBloqueado = await registro();
  registroBloqueado.providers.find((p) => p.id === GEMINI_IMAGE_ADAPTER_ID).status = "pending";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "image-generate",
    request: { prompt: "p", outputFile: "x.png" },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(gerou, 0);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  const modulo = await import("../lib/media-pipeline/adapters/gemini-image.mjs");
  assert.equal(typeof modulo.createGeminiImageAdapter, "function");
});

test("o permit de entrada externa não pode ser descartado no caminho", async () => {
  // Sem isto, uma referência externa chegaria ao provedor sem a autorização que
  // o `--confirm-provider-input` existe para exigir.
  let recebido = null;
  const adapter = createGeminiImageAdapter({ operacaoDeImagem: dubleDeImagem({ aoGerar: (p) => { recebido = p; } }) });
  const permit = { schema: "mkt-videos/direct-provider-input-permit@1", hash: "sha256:teste" };
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "image-generate",
    request: { prompt: "p", outputFile: "x.png", images: ["ref.png"], providerInputPermit: permit },
  });
  await executeDirectAdapterInvocation({ adapter, invocation });
  assert.deepEqual(recebido.providerInputPermit, permit);
});
