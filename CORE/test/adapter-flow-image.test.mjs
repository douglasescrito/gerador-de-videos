import assert from "node:assert/strict";
import test from "node:test";

import { createFlowImageAdapter, FLOW_IMAGE_ADAPTER_ID } from "../lib/media-pipeline/adapters/flow-image.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeAdapterInvocation,
  executeDirectAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });

/** Dublê no formato que a operação de cookie devolve. Nenhum provedor é tocado. */
function dubleQueGera({ aoChamar = () => {} } = {}) {
  return async (pedido) => {
    aoChamar(pedido);
    return {
      files: [pedido.outputFile],
      receiptFile: `${pedido.outputFile}.receipt.json`,
      receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "image" }] },
      model: "flow-nano-banana-2",
      aspectRatio: pedido.aspectRatio,
      count: pedido.count,
      creditos: 0,
      attempts: 1,
    };
  };
}

test("o adapter assina o contrato e declara o que faz", () => {
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, FLOW_IMAGE_ADAPTER_ID);
  assert.equal(adapter.authContract, "cookie-only-browser-session");
  assert.deepEqual(adapter.operations, ["image-generate"]);
  assert.deepEqual(adapter.paidOperations, ["image-generate"], "gera mídia no provedor, então é operação paga");
  assert.deepEqual(adapter.reconcileOperations, [], "o registro declara reconcile:false para este provedor");
  assert.ok(adapter.fingerprint);
});

test("passa na suíte de conformidade sem tocar provedor", async () => {
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera() });
  const relatorio = await runAdapterConformanceSuite({
    adapter, capabilityRegistry: await registro(), operation: "image-generate",
    request: { prompt: "p", outputFile: "saida.png" },
  });
  assert.equal(relatorio.passed, true, JSON.stringify(relatorio.checks));
  assert.equal(relatorio.providerFree, true);
});

test("a execução avulsa gera e devolve resultado normalizado", async () => {
  let recebido = null;
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera({ aoChamar: (p) => { recebido = p; } }) });
  const request = { prompt: "porta fechada", outputFile: "porta.png", aspectRatio: "16:9", count: 2 };
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "image-generate", request,
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.metadata.files[0], "porta.png");
  assert.equal(resultado.metadata.model, "flow-nano-banana-2");
  assert.equal(recebido.provider, FLOW_IMAGE_ADAPTER_ID, "o pedido chega traduzido para a operação");
  assert.equal(recebido.count, 2);
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let chamou = false;
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera({ aoChamar: () => { chamou = true; } }) });
  const registroBloqueado = await registro();
  const entrada = registroBloqueado.providers.find((p) => p.id === FLOW_IMAGE_ADAPTER_ID);
  entrada.status = "pending";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "image-generate",
    request: { prompt: "p", outputFile: "x.png" },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(chamou, false, "nenhuma chamada ao provedor quando a capacidade não está supported");
});

test("o caminho planejado continua exigindo autorização presa a plano", async () => {
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera() });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "image-generate",
    request: { prompt: "p", outputFile: "x.png" },
  });
  assert.equal(invocation.paid, true);
  assert.equal(invocation.authorizationRequired, true);
  // A execução avulsa dispensa a autorização de plano; a planejada, não.
  await assert.rejects(() => executeAdapterInvocation({ adapter, invocation }), /ExecutionAuthorization/);
});

test("a estimativa conta uma chamada paga por imagem pedida", async () => {
  const adapter = createFlowImageAdapter({ gerarImagem: dubleQueGera() });
  assert.deepEqual(await adapter.estimate({ request: {} }), { paidCalls: 1, localOperations: 0, provider: FLOW_IMAGE_ADAPTER_ID });
  assert.equal((await adapter.estimate({ request: { count: 4 } })).paidCalls, 4);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  // O adapter só resolve a operação real dentro do execute. Se o import de topo
  // puxasse o headless, este teste provider-free tocaria o provedor.
  const modulo = await import("../lib/media-pipeline/adapters/flow-image.mjs");
  assert.equal(typeof modulo.createFlowImageAdapter, "function");
});
