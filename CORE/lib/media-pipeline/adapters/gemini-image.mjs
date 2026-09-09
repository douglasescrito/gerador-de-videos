// gemini-image (AI Studio) sob o contrato de adapter.
//
// Mesma superfície do `gemini-omni` — o app Omni Product Studio dentro do AI
// Studio —, mas gerando imagem. É o quadro-chave do fluxo de draft: a imagem
// aprovada vira o primeiro quadro do vídeo.
//
// A limitação que o registro de capacidades já declara e o adapter não pode
// esconder: imagem intermediária aceita aqui **não garante** aceitação depois
// pelo Omni. O adapter entrega a imagem e o recibo; quem decide se ela serve de
// quadro-chave é a etapa seguinte.

import { createAdapterContract } from "../adapter-contract.mjs";

export const GEMINI_IMAGE_ADAPTER_ID = "gemini-image";

async function operacaoPadrao() {
  const { createCookieImageAdapter } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieImageAdapter();
}

function pedidoParaOperacao(request) {
  return {
    prompt: request.prompt,
    outputFile: request.outputFile,
    images: request.images ?? [],
    inputRoles: request.inputRoles ?? [],
    model: request.model,
    aspectRatio: request.aspectRatio,
    imageSize: request.imageSize,
    // O permit de entrada externa é mecanismo de segurança, não detalhe de
    // transporte: ele autoriza aquele arquivo, para aquela operação, naquela
    // invocação. Descartá-lo aqui faria a referência passar sem autorização.
    providerInputPermit: request.providerInputPermit ?? null,
    receiptFile: request.receiptFile,
    metadata: request.metadata,
  };
}

export function createGeminiImageAdapter({ operacaoDeImagem = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: GEMINI_IMAGE_ADAPTER_ID,
    providerId: GEMINI_IMAGE_ADAPTER_ID,
    kind: "image",
    operations: ["image-generate"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["image-generate"],
    // O registro declara `reconcile: false`: a imagem volta na mesma resposta.
    reconcileOperations: [],
    resultKinds: ["image"],

    estimate: async () => ({ paidCalls: 1, localOperations: 0, provider: GEMINI_IMAGE_ADAPTER_ID }),

    execute: async ({ request = {} } = {}) => {
      const operacao = operacaoDeImagem ?? (await operacaoPadrao());
      const resultado = await operacao.generate(pedidoParaOperacao(request));
      return {
        status: "ready",
        artifacts: resultado.receipt?.artifacts ?? [],
        receipt: resultado.receipt ?? null,
        receiptId: resultado.receipt?.id ?? resultado.receiptId ?? null,
        file: resultado.file ?? null,
        metadata: {
          file: resultado.file ?? null,
          receipt: resultado.receipt ?? null,
          receiptFile: resultado.receiptFile ?? null,
          interactionId: resultado.interactionId ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
