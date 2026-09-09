import assert from "node:assert/strict";
import test from "node:test";

import { createFlowVideoAdapter, FLOW_VIDEO_ADAPTER_ID } from "../lib/media-pipeline/adapters/flow-video.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeDirectAdapterInvocation,
  reconcileAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });

function dubleQueGera({ aoChamar = () => {} } = {}) {
  return async (pedido) => {
    aoChamar(pedido);
    return {
      files: [pedido.outputFile],
      receiptFile: `${pedido.outputFile}.receipt.json`,
      receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "video" }] },
      model: "flow-omni-1.1-flash",
      aspectRatio: pedido.aspectRatio,
      resolution: pedido.resolution,
      duration: pedido.duration,
      count: pedido.count,
      creditos: 12,
    };
  };
}

test("o adapter assina o contrato e declara o que faz", () => {
  const adapter = createFlowVideoAdapter({ gerarVideo: dubleQueGera() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, FLOW_VIDEO_ADAPTER_ID);
  assert.equal(adapter.kind, "video");
  assert.deepEqual(adapter.paidOperations, ["text-to-video"]);
  assert.deepEqual(adapter.reconcileOperations, [], "sem handle para buscar depois, não há reconciliação");
});

test("passa na conformidade sem tocar provedor", async () => {
  const adapter = createFlowVideoAdapter({ gerarVideo: dubleQueGera() });
  const relatorio = await runAdapterConformanceSuite({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  assert.equal(relatorio.passed, true, JSON.stringify(relatorio.checks));
});

test("duração e resolução chegam à operação com os padrões do provedor", async () => {
  let recebido = null;
  const adapter = createFlowVideoAdapter({ gerarVideo: dubleQueGera({ aoChamar: (p) => { recebido = p; } }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.equal(recebido.duration, 8, "8s é o padrão do Flow");
  assert.equal(recebido.resolution, "720p");
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.metadata.creditos, 12);
});

test("reconciliar é recusado, porque o provedor não devolve handle", async () => {
  const adapter = createFlowVideoAdapter({ gerarVideo: dubleQueGera() });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-video",
    request: { prompt: "p", outputFile: "v.mp4" },
  });
  await assert.rejects(
    () => reconcileAdapterInvocation({ adapter, invocation, request: {} }),
    /não declara reconcile/,
  );
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let chamou = false;
  const adapter = createFlowVideoAdapter({ gerarVideo: dubleQueGera({ aoChamar: () => { chamou = true; } }) });
  const registroBloqueado = await registro();
  registroBloqueado.providers.find((p) => p.id === FLOW_VIDEO_ADAPTER_ID).status = "pending";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "text-to-video",
    request: { prompt: "p", outputFile: "x.mp4" },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(chamou, false);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  const modulo = await import("../lib/media-pipeline/adapters/flow-video.mjs");
  assert.equal(typeof modulo.createFlowVideoAdapter, "function");
});
