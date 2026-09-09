// google-flow-image sob o contrato de adapter.
//
// Primeiro dos seis adapters que produzem mídia a assinar o `adapter-contract@1`.
// O contrato existia e governava só as três coisas que não produzem nada; os seis
// que fazem o trabalho ficavam de fora, cada um tratando estado ambíguo do seu
// jeito.
//
// Isto não é um segundo executor. A geração continua sendo a mesma
// `createCookieFlowImageOperation` de sempre — o que se acrescenta é a moldura:
// preflight contra o registro de capacidades, portão de operação paga, resultado
// normalizado e erro sanitizado.
//
// A operação real é injetável e só é carregada dentro do `execute`. Assim o
// módulo pode ser importado — e testado — sem arrastar Playwright nem tocar em
// cookie, que é o que a regra provider-free dos testes exige.

import { createAdapterContract } from "../adapter-contract.mjs";

export const FLOW_IMAGE_ADAPTER_ID = "google-flow-image";

async function operacaoPadrao() {
  const { createCookieFlowImageOperation } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieFlowImageOperation();
}

/**
 * Traduz o pedido do contrato para o formato que a operação de cookie espera.
 * Fica explícito de propósito: se um campo novo aparecer no contrato e ninguém
 * mapear aqui, ele é ignorado em vez de vazar meio caminho.
 */
function pedidoParaOperacao(request) {
  return {
    provider: FLOW_IMAGE_ADAPTER_ID,
    prompt: request.prompt,
    outputFile: request.outputFile,
    projectUrl: request.projectUrl ?? null,
    aspectRatio: request.aspectRatio ?? "16:9",
    count: request.count == null ? 1 : Number(request.count),
    timeoutMs: request.timeoutMs,
    receiptFile: request.receiptFile,
    metadata: request.metadata,
  };
}

export function createFlowImageAdapter({ gerarImagem = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: FLOW_IMAGE_ADAPTER_ID,
    providerId: FLOW_IMAGE_ADAPTER_ID,
    kind: "image",
    operations: ["image-generate"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    // Gera mídia no provedor: passa pelo portão de operação paga.
    paidOperations: ["image-generate"],
    // O registro de capacidades declara `reconcile: false` para este provedor:
    // a imagem volta na mesma resposta, não há handle para reconciliar depois.
    reconcileOperations: [],
    resultKinds: ["image"],

    estimate: async ({ request = {} } = {}) => ({
      paidCalls: request.count == null ? 1 : Number(request.count),
      localOperations: 0,
      provider: FLOW_IMAGE_ADAPTER_ID,
    }),

    execute: async ({ request = {} } = {}) => {
      const gerar = gerarImagem ?? (await operacaoPadrao());
      const resultado = await gerar(pedidoParaOperacao(request));
      return {
        status: "ready",
        artifacts: resultado.receipt?.artifacts ?? [],
        receipt: resultado.receipt ?? null,
        receiptId: resultado.receipt?.id ?? resultado.receiptId ?? null,
        file: resultado.files?.[0] ?? null,
        metadata: {
          files: resultado.files ?? [],
          receiptFile: resultado.receiptFile ?? null,
          model: resultado.model ?? null,
          aspectRatio: resultado.aspectRatio ?? null,
          count: resultado.count ?? null,
          // O painel do Flow anuncia 0 crédito para imagem, mas quem cobra é o
          // provedor e isso pode mudar. Registrar o que ele disse, não o que a
          // gente supõe.
          creditos: resultado.creditos ?? null,
          attempts: resultado.attempts ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
