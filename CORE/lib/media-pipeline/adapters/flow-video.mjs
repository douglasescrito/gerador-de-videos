// google-flow-video sob o contrato de adapter.
//
// Sexto e último dos adapters de mídia. Caminho secundário de vídeo, pelo Flow
// (Omni 1.1 Flash) — clipes de 4 a 10 s em 1280x720 com áudio, sem marca-d'água.
//
// O registro declara `reconcile: false` e a razão é dura: o vídeo é assíncrono,
// o adapter espera a mídia aparecer no projeto, e **não há handle** para buscar
// depois. Estado ambíguo aqui volta como decisão humana, com a URL do projeto no
// recibo de tentativa — nunca como retentativa automática.
//
// Este provedor nunca é escolhido sozinho: o intent é próprio
// (`video.generate.text.secondary`) justamente para que trocar o principal pelo
// secundário continue sendo escolha de quem dirige.

import { createAdapterContract } from "../adapter-contract.mjs";

export const FLOW_VIDEO_ADAPTER_ID = "google-flow-video";

async function operacaoPadrao() {
  const { createCookieFlowVideoOperation } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieFlowVideoOperation();
}

function pedidoParaOperacao(request) {
  return {
    provider: FLOW_VIDEO_ADAPTER_ID,
    prompt: request.prompt,
    outputFile: request.outputFile,
    projectUrl: request.projectUrl ?? null,
    aspectRatio: request.aspectRatio ?? "16:9",
    count: request.count == null ? 1 : Number(request.count),
    resolution: request.resolution ?? "720p",
    duration: request.duration == null ? 8 : Number(request.duration),
    timeoutMs: request.timeoutMs,
    receiptFile: request.receiptFile,
    metadata: request.metadata,
  };
}

export function createFlowVideoAdapter({ gerarVideo = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: FLOW_VIDEO_ADAPTER_ID,
    providerId: FLOW_VIDEO_ADAPTER_ID,
    kind: "video",
    operations: ["text-to-video"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["text-to-video"],
    reconcileOperations: [],
    resultKinds: ["video"],

    estimate: async ({ request = {} } = {}) => ({
      paidCalls: request.count == null ? 1 : Number(request.count),
      localOperations: 0,
      provider: FLOW_VIDEO_ADAPTER_ID,
    }),

    execute: async ({ request = {} } = {}) => {
      const gerar = gerarVideo ?? (await operacaoPadrao());
      const resultado = await gerar(pedidoParaOperacao(request));
      return {
        status: "ready",
        artifacts: resultado.receipt?.artifacts ?? [],
        receipt: resultado.receipt ?? null,
        receiptId: resultado.receipt?.id ?? resultado.receiptId ?? null,
        file: resultado.files?.[0] ?? null,
        metadata: {
          receipt: resultado.receipt ?? null,
          files: resultado.files ?? [],
          receiptFile: resultado.receiptFile ?? null,
          model: resultado.model ?? null,
          aspectRatio: resultado.aspectRatio ?? null,
          resolution: resultado.resolution ?? null,
          duration: resultado.duration ?? null,
          count: resultado.count ?? null,
          // ~12 créditos por clipe pelo painel do Flow; quem cobra é o provedor.
          creditos: resultado.creditos ?? null,
          attempts: resultado.attempts ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
