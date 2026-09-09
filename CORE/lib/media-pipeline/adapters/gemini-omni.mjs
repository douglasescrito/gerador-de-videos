// gemini-omni (AI Studio · Omni Product Studio) sob o contrato de adapter.
//
// O caminho principal de vídeo do estúdio, e o **único provedor do projeto com
// `reconcile: true`** no registro de capacidades. Por isso este é o primeiro
// adapter que expõe `reconcile()` de verdade em vez de declarar que não tem.
//
// Por que a reconciliação importa aqui e não nos outros: o Omni devolve um
// `fileId` assim que aceita a submissão, antes de a mídia ficar pronta. Se a
// espera estourar, o vídeo pode ter sido gerado do outro lado — e existe como
// buscá-lo pelo handle. Repetir a submissão nesse estado geraria um segundo
// vídeo e gastaria cota duas vezes pelo mesmo pedido.
//
// A moldura é a mesma dos outros três: preflight contra o registro de
// capacidades, resultado normalizado, erro sanitizado. A geração continua sendo
// a `createCookieVideoAdapter` de sempre; nenhum executor novo.

import { createAdapterContract } from "../adapter-contract.mjs";

export const GEMINI_OMNI_ADAPTER_ID = "gemini-omni";

async function operacaoPadrao() {
  const { createCookieVideoAdapter } = await import("../../../scripts/cookie-studio-operations.mjs");
  return createCookieVideoAdapter();
}

/**
 * As quatro operações do Omni são tarefas do mesmo endpoint, não endpoints
 * diferentes. O contrato as declara separadas porque o preflight e o registro de
 * capacidades raciocinam por operação.
 */
const OPERACAO_PARA_TASK = new Map([
  ["text-to-video", "text_to_video"],
  ["image-to-video", "image_to_video"],
  ["reference-to-video", "reference_to_video"],
  ["edit", "edit"],
]);

function pedidoParaOperacao(request, operation) {
  return {
    prompt: request.prompt,
    outputFile: request.outputFile,
    images: request.images ?? [],
    inputRoles: request.inputRoles ?? [],
    referenceVideo: request.referenceVideo ?? null,
    task: OPERACAO_PARA_TASK.get(operation) ?? request.task ?? "auto",
    aspectRatio: request.aspectRatio ?? "16:9",
    // O permit de entrada externa é mecanismo de segurança, não detalhe de
    // transporte: ele autoriza aquele arquivo, para aquela operação, naquela
    // invocação. Descartá-lo aqui faria a referência passar sem autorização.
    providerInputPermit: request.providerInputPermit ?? null,
    model: request.model ?? undefined,
    timeoutMs: request.timeoutMs,
    pollIntervalMs: request.pollIntervalMs,
    attemptId: request.attemptId,
    receiptFile: request.receiptFile,
    metadata: request.metadata,
    // Como o handle chega antes da mídia: quem chama guarda o fileId para poder
    // reconciliar em vez de submeter de novo.
    onProviderHandle: request.onProviderHandle,
    onBeforeSubmit: request.onBeforeSubmit,
  };
}

function resultadoPronto(resultado) {
  return {
    status: "ready",
    artifacts: resultado.receipt?.artifacts ?? [],
    receipt: resultado.receipt ?? null,
    receiptId: resultado.receipt?.id ?? resultado.receiptId ?? null,
    file: resultado.file ?? null,
    providerHandle: resultado.fileId ?? null,
    metadata: {
      file: resultado.file ?? null,
      timings: resultado.timings ?? {},
      receipt: resultado.receipt ?? null,
      receiptFile: resultado.receiptFile ?? null,
      attemptId: resultado.attemptId ?? null,
      interactionId: resultado.interactionId ?? null,
      fileId: resultado.fileId ?? null,
      ...(resultado.stateFile ? { stateFile: resultado.stateFile, lifecycle: resultado.lifecycle } : {}),
    },
  };
}

export function createGeminiOmniAdapter({ operacaoDeVideo = null } = {}) {
  const adapter = {
    schema: "mkt-videos/adapter-contract@1",
    id: GEMINI_OMNI_ADAPTER_ID,
    providerId: GEMINI_OMNI_ADAPTER_ID,
    kind: "video",
    operations: ["text-to-video", "image-to-video", "reference-to-video", "edit"],
    authMode: "browser-session",
    authContract: "cookie-only-browser-session",
    paidOperations: ["text-to-video", "image-to-video", "reference-to-video", "edit"],
    // O registro declara `reconcile: true` só para este provedor.
    reconcileOperations: ["text-to-video", "image-to-video", "reference-to-video", "edit"],
    resultKinds: ["video"],

    estimate: async () => ({ paidCalls: 1, localOperations: 0, provider: GEMINI_OMNI_ADAPTER_ID }),

    execute: async ({ operation, request = {} } = {}) => {
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      const resultado = await operacao.generate(pedidoParaOperacao(request, operation));
      return resultadoPronto(resultado);
    },

    // Fases aditivas sobre o mesmo transporte. O runner mantém as reservas e
    // os handles duráveis; o adapter não espera o render remoto para devolver.
    submit: async ({ operation, request = {} } = {}) => {
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      const resultado = await operacao.submit(pedidoParaOperacao(request, operation));
      return {
        status: "pending",
        artifacts: [],
        providerHandle: resultado.fileId ?? null,
        metadata: resultado,
      };
    },

    observe: async ({ request = {} } = {}) => {
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      return operacao.observe({ ...request, fileId: request.fileId ?? request.providerHandle });
    },

    observeMany: async ({ requests = [], timeoutMs } = {}) => {
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      return operacao.observeMany({ requests: requests.map((request) => ({ ...request, fileId: request.fileId ?? request.providerHandle })), timeoutMs });
    },

    collect: async ({ operation, request = {} } = {}) => {
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      const resultado = await operacao.collect({
        ...pedidoParaOperacao(request, operation),
        fileId: request.fileId ?? request.providerHandle,
        startedAt: request.startedAt,
        interactionId: request.interactionId,
      });
      return resultadoPronto(resultado);
    },

    /**
     * Busca a mídia de uma tentativa que ficou ambígua, pelo handle que o
     * provedor já devolveu. Não submete nada: ou o vídeo existe do outro lado e
     * vem, ou não vem e a decisão volta para a pessoa.
     */
    reconcile: async ({ request = {} } = {}) => {
      const fileId = String(request.fileId ?? request.providerHandle ?? "").trim();
      if (!fileId) throw new Error("Reconciliar o gemini-omni exige o fileId da tentativa ambígua.");
      const operacao = operacaoDeVideo ?? (await operacaoPadrao());
      const resultado = await operacao.reconcile({
        fileId,
        outputFile: request.outputFile,
        timeoutMs: request.timeoutMs,
        receiptFile: request.receiptFile,
        metadata: request.metadata,
      });
      return {
        status: resultado.classification === "ready" ? "ready" : "ambiguous",
        artifacts: resultado.receipt?.artifacts ?? [],
        receipt: resultado.receipt ?? null,
        receiptId: resultado.receipt?.id ?? null,
        file: resultado.file ?? null,
        providerHandle: fileId,
        metadata: {
          file: resultado.file ?? null,
          receiptFile: resultado.receiptFile ?? null,
          classification: resultado.classification ?? null,
          checkedAt: resultado.checkedAt ?? null,
          // Reconciliar não pós-processa: entrega o que o provedor tem.
          zeroPost: resultado.zeroPost ?? null,
        },
      };
    },
  };
  return { ...adapter, ...createAdapterContract(adapter) };
}
