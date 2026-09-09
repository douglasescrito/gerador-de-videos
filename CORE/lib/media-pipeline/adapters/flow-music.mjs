// flow-music sob o contrato de adapter.
//
// Segundo dos seis. Mesma moldura do `flow-image`: a geração continua sendo a
// `createCookieMusicOperation` de sempre, e o que entra é preflight contra o
// registro de capacidades, portão de operação paga e resultado normalizado na
// taxonomia `ready | pending | ambiguous | failed`.
//
// Duas coisas deste provedor que o adapter não pode atropelar, e por isso estão
// escritas aqui: a duração original do provedor é preservada quando pedido
// (`preserveOriginalDuration`), e o adapter **nunca** repete sozinho uma
// submissão ambígua — a trilha pode ter sido gerada do outro lado.

import { createAdapterContract } from "../adapter-contract.mjs";

export const FLOW_MUSIC_ADAPTER_ID = "flow-music";

async function operacaoPadrao() {
  const { createCookieMusicOperation } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieMusicOperation();
}

function pedidoParaOperacao(request) {
  return {
    backend: request.backend ?? "flow-music",
    prompt: request.prompt ?? null,
    preset: request.preset ?? null,
    outputFile: request.outputFile,
    durationSeconds: Number(request.durationSeconds ?? 30),
    preserveOriginalDuration: Boolean(request.preserveOriginalDuration),
    vocals: Boolean(request.vocals),
    timeoutMs: request.timeoutMs,
    model: request.model,
    receiptFile: request.receiptFile,
    metadata: request.metadata,
  };
}

export function createFlowMusicAdapter({ gerarMusica = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: FLOW_MUSIC_ADAPTER_ID,
    providerId: FLOW_MUSIC_ADAPTER_ID,
    kind: "audio",
    operations: ["music-generate"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["music-generate"],
    // O registro declara `reconcile: false` para o flow-music: não há handle
    // para consultar depois. Estado ambíguo vira decisão humana, não retentativa.
    reconcileOperations: [],
    resultKinds: ["audio"],

    estimate: async () => ({ paidCalls: 1, localOperations: 0, provider: FLOW_MUSIC_ADAPTER_ID }),

    execute: async ({ request = {} } = {}) => {
      const gerar = gerarMusica ?? (await operacaoPadrao());
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
          // O original do provedor é preservado ao lado do master, sem corte.
          providerFile: resultado.providerFile ?? null,
          attemptFile: resultado.attemptFile ?? null,
          model: resultado.model ?? null,
          backend: resultado.backend ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
