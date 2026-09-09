// google-vids (narração) sob o contrato de adapter.
//
// Terceiro dos seis, e o segundo carro-chefe: 152 locuções nos dez dias antes
// desta migração. Mesma moldura dos outros — a geração continua sendo a
// `createCookieTtsOperation` de sempre, e o que entra é preflight contra o
// registro de capacidades, portão de operação paga e resultado normalizado.
//
// O que este provedor exige e o adapter não pode relaxar: `documentUrl` é
// obrigatório (a locução nasce dentro de um documento do Vids, e sem ele não há
// onde gerar), a voz é validada e confirmada antes de submeter, e uma submissão
// ambígua nunca é repetida sozinha.

import { createAdapterContract } from "../adapter-contract.mjs";

export const GOOGLE_VIDS_TTS_ADAPTER_ID = "google-vids";

async function operacaoPadrao() {
  const { createCookieTtsOperation } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieTtsOperation();
}

function pedidoParaOperacao(request) {
  const documentUrl = String(request.documentUrl ?? "").trim();
  if (!documentUrl) throw new Error("google-vids exige documentUrl: a locução nasce dentro de um documento do Vids.");
  return {
    provider: GOOGLE_VIDS_TTS_ADAPTER_ID,
    text: request.text,
    outputFile: request.outputFile,
    documentUrl,
    // Cena nova por padrão: escrever por cima de uma cena existente destruiria
    // locução que já foi aprovada.
    newScene: request.newScene === undefined ? true : Boolean(request.newScene),
    voice: request.voice ?? "Nyla",
    receiptFile: request.receiptFile,
    metadata: request.metadata,
  };
}

export function createGoogleVidsTtsAdapter({ gerarNarracao = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: GOOGLE_VIDS_TTS_ADAPTER_ID,
    providerId: GOOGLE_VIDS_TTS_ADAPTER_ID,
    kind: "audio",
    operations: ["text-to-speech"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["text-to-speech"],
    // O registro declara `reconcile: false` para o google-vids.
    reconcileOperations: [],
    resultKinds: ["audio"],

    estimate: async () => ({ paidCalls: 1, localOperations: 0, provider: GOOGLE_VIDS_TTS_ADAPTER_ID }),

    execute: async ({ request = {} } = {}) => {
      const gerar = gerarNarracao ?? (await operacaoPadrao());
      const resultado = await gerar(pedidoParaOperacao(request));
      return {
        status: "ready",
        artifacts: resultado.receipt?.artifacts ?? [],
        receipt: resultado.receipt ?? null,
        receiptId: resultado.receipt?.id ?? resultado.receiptId ?? null,
        file: resultado.file ?? null,
        metadata: {
          file: resultado.file ?? null,
          receiptFile: resultado.receiptFile ?? null,
          model: resultado.model ?? null,
          // A voz que o provedor confirmou, não a que foi pedida: o catálogo do
          // Vids é experimental e pode mudar do lado dele.
          voice: resultado.voice ?? null,
          attempts: resultado.attempts ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
