import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiOmniAdapter, GEMINI_OMNI_ADAPTER_ID } from "../lib/media-pipeline/adapters/gemini-omni.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeDirectAdapterInvocation,
  reconcileAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });

function dubleDeVideo({ aoGerar = () => {}, aoReconciliar = () => {}, classificacao = "ready" } = {}) {
  return {
    async generate(pedido) {
      aoGerar(pedido);
      return {
        file: pedido.outputFile,
        receiptFile: `${pedido.outputFile}.receipt.json`,
        receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "video" }] },
        attemptId: "attempt:teste",
        interactionId: "interaction:teste",
        fileId: "file:teste",
      };
    },
    async reconcile(pedido) {
      aoReconciliar(pedido);
      return {
        classification: classificacao,
        zeroPost: true,
        fileId: pedido.fileId,
        checkedAt: "2026-09-02T12:00:00.000Z",
        file: pedido.outputFile,
        receiptFile: `${pedido.outputFile}.receipt.json`,
        receipt: { id: "receipt:sha256:reconciliado", artifacts: [{ id: "artifact:reconciliado", kind: "video" }] },
      };
    },
  };
}

test("o adapter assina o contrato e é o único que declara reconciliação", () => {
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, GEMINI_OMNI_ADAPTER_ID);
  assert.equal(adapter.kind, "video");
  assert.deepEqual(adapter.operations.sort(), ["edit", "image-to-video", "reference-to-video", "text-to-video"]);
  assert.deepEqual(adapter.reconcileOperations.sort(), adapter.operations.sort(), "o registro declara reconcile:true para o gemini-omni");
  assert.equal(typeof adapter.reconcile, "function");
});

test("passa na conformidade nas quatro operações, sem tocar provedor", async () => {
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo() });
  const capabilityRegistry = await registro();
  for (const operation of adapter.operations) {
    const relatorio = await runAdapterConformanceSuite({
      adapter, capabilityRegistry, operation, request: { prompt: "p", outputFile: "v.mp4" },
    });
    assert.equal(relatorio.passed, true, `${operation}: ${JSON.stringify(relatorio.checks)}`);
    assert.equal(relatorio.providerFree, true);
  }
});

test("cada operação vira a task correta do Omni", async () => {
  const esperado = new Map([
    ["text-to-video", "text_to_video"],
    ["image-to-video", "image_to_video"],
    ["reference-to-video", "reference_to_video"],
    ["edit", "edit"],
  ]);
  const capabilityRegistry = await registro();
  for (const [operation, task] of esperado) {
    let recebido = null;
    const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo({ aoGerar: (p) => { recebido = p; } }) });
    const invocation = buildAdapterInvocation({
      adapter, capabilityRegistry, operation, request: { prompt: "p", outputFile: "v.mp4" },
    });
    await executeDirectAdapterInvocation({ adapter, invocation });
    assert.equal(recebido.task, task, operation);
  }
});

test("o handle do provedor volta no resultado, para reconciliar em vez de resubmeter", async () => {
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo() });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.providerHandle, "file:teste", "sem o handle não há como reconciliar depois");
  assert.equal(resultado.metadata.attemptId, "attempt:teste");
});

test("reconciliar busca pelo handle e nunca submete de novo", async () => {
  let gerou = 0;
  let recebido = null;
  const adapter = createGeminiOmniAdapter({
    operacaoDeVideo: dubleDeVideo({ aoGerar: () => { gerou += 1; }, aoReconciliar: (p) => { recebido = p; } }),
  });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  const resultado = await reconcileAdapterInvocation({
    adapter, invocation, request: { fileId: "file:ambiguo", outputFile: "v.mp4" },
  });
  assert.equal(gerou, 0, "reconciliar não pode gerar nada");
  assert.equal(recebido.fileId, "file:ambiguo");
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.reconcile, true);
});

test("reconciliar sem handle falha em vez de virar nova submissão", async () => {
  let gerou = 0;
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo({ aoGerar: () => { gerou += 1; } }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  await assert.rejects(
    () => reconcileAdapterInvocation({ adapter, invocation, request: { outputFile: "v.mp4" } }),
    /fileId/,
  );
  assert.equal(gerou, 0);
});

test("mídia ainda não pronta volta como ambígua, não como pronta", async () => {
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo({ classificacao: "pending" }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  const resultado = await reconcileAdapterInvocation({
    adapter, invocation, request: { fileId: "file:x", outputFile: "v.mp4" },
  });
  assert.equal(resultado.status, "ambiguous");
  assert.equal(resultado.nextAction, "reconcile");
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let gerou = 0;
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo({ aoGerar: () => { gerou += 1; } }) });
  const registroBloqueado = await registro();
  registroBloqueado.providers.find((p) => p.id === GEMINI_OMNI_ADAPTER_ID).status = "blocked";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(gerou, 0);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  const modulo = await import("../lib/media-pipeline/adapters/gemini-omni.mjs");
  assert.equal(typeof modulo.createGeminiOmniAdapter, "function");
});

test("o permit de entrada externa não pode ser descartado no caminho", async () => {
  let recebido = null;
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: dubleDeVideo({ aoGerar: (p) => { recebido = p; } }) });
  const permit = { schema: "mkt-videos/direct-provider-input-permit@1", hash: "sha256:teste" };
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "reference-to-video",
    request: { prompt: "p", outputFile: "v.mp4", images: ["ref.png"], providerInputPermit: permit },
  });
  await executeDirectAdapterInvocation({ adapter, invocation });
  assert.deepEqual(recebido.providerInputPermit, permit);
});

test("fases do adapter preservam task, permit e hooks e deixam a coleta separada", async () => {
  const calls = [];
  const before = async () => {};
  const handle = async () => {};
  const permit = { schema: "mkt-videos/direct-provider-input-permit@1", hash: "sha256:phases" };
  const adapter = createGeminiOmniAdapter({ operacaoDeVideo: {
    generate: async () => assert.fail("não deve entrar no fluxo legado"),
    submit: async (request) => {
      calls.push("submit");
      assert.equal(request.task, "reference_to_video");
      assert.equal(request.providerInputPermit, permit);
      assert.equal(request.onBeforeSubmit, before);
      assert.equal(request.onProviderHandle, handle);
      return { status: "pending", fileId: "file-phases", attemptId: "attempt-phases" };
    },
    observeMany: async ({ requests }) => { calls.push("observe"); return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true })); },
    collect: async (request) => {
      calls.push("collect");
      assert.equal(request.fileId, "file-phases");
      assert.equal(request.startedAt, "2026-09-05T10:00:00.000Z");
      return { fileId: request.fileId, file: request.outputFile, receipt: { id: "receipt:phased", artifacts: [] } };
    },
  } });
  const submitted = await adapter.submit({ operation: "reference-to-video", request: { prompt: "p", images: ["reference.png"], outputFile: "v.mp4", providerInputPermit: permit, onBeforeSubmit: before, onProviderHandle: handle } });
  assert.equal(submitted.status, "pending");
  assert.equal(submitted.providerHandle, "file-phases");
  const observed = await adapter.observeMany({ requests: [{ providerHandle: submitted.providerHandle }] });
  assert.equal(observed[0].classification, "ready");
  const collected = await adapter.collect({ operation: "reference-to-video", request: { providerHandle: submitted.providerHandle, startedAt: "2026-09-05T10:00:00.000Z", outputFile: "v.mp4" } });
  assert.equal(collected.status, "ready");
  assert.equal(collected.receiptId, "receipt:phased");
  assert.deepEqual(calls, ["submit", "observe", "collect"]);
});
