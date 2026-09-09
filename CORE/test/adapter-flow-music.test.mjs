import assert from "node:assert/strict";
import test from "node:test";

import { createFlowMusicAdapter, FLOW_MUSIC_ADAPTER_ID } from "../lib/media-pipeline/adapters/flow-music.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeDirectAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });

function dubleQueGera({ aoChamar = () => {} } = {}) {
  return async (pedido) => {
    aoChamar(pedido);
    return {
      file: pedido.outputFile,
      receiptFile: `${pedido.outputFile}.receipt.json`,
      providerFile: `${pedido.outputFile}.provider.m4a`,
      attemptFile: `${pedido.outputFile}.flow-attempt.json`,
      receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "audio" }] },
      model: "lyria-3.5",
      backend: "flow-music",
    };
  };
}

test("o adapter assina o contrato e declara o que faz", () => {
  const adapter = createFlowMusicAdapter({ gerarMusica: dubleQueGera() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, FLOW_MUSIC_ADAPTER_ID);
  assert.equal(adapter.kind, "audio");
  assert.equal(adapter.authContract, "cookie-only-browser-session");
  assert.deepEqual(adapter.paidOperations, ["music-generate"]);
  assert.deepEqual(adapter.reconcileOperations, [], "o registro declara reconcile:false para o flow-music");
});

test("passa na conformidade sem tocar provedor", async () => {
  const adapter = createFlowMusicAdapter({ gerarMusica: dubleQueGera() });
  const relatorio = await runAdapterConformanceSuite({
    adapter, capabilityRegistry: await registro(), operation: "music-generate",
    request: { outputFile: "trilha.wav" },
  });
  assert.equal(relatorio.passed, true, JSON.stringify(relatorio.checks));
  assert.equal(relatorio.providerFree, true);
});

test("preserva o original do provedor e a duração pedida no caminho do pedido", async () => {
  let recebido = null;
  const adapter = createFlowMusicAdapter({ gerarMusica: dubleQueGera({ aoChamar: (p) => { recebido = p; } }) });
  const request = { outputFile: "trilha.wav", durationSeconds: 20, preserveOriginalDuration: true, prompt: "cue calmo" };
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "music-generate", request,
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.equal(resultado.status, "ready");
  assert.equal(recebido.durationSeconds, 20);
  assert.equal(recebido.preserveOriginalDuration, true, "o original do provedor não pode ser cortado sem pedido");
  assert.equal(resultado.metadata.providerFile, "trilha.wav.provider.m4a", "o original fica ao lado do master");
  assert.equal(resultado.metadata.model, "lyria-3.5");
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let chamou = false;
  const adapter = createFlowMusicAdapter({ gerarMusica: dubleQueGera({ aoChamar: () => { chamou = true; } }) });
  const registroBloqueado = await registro();
  registroBloqueado.providers.find((p) => p.id === FLOW_MUSIC_ADAPTER_ID).status = "blocked";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "music-generate", request: { outputFile: "x.wav" },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(chamou, false);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  const modulo = await import("../lib/media-pipeline/adapters/flow-music.mjs");
  assert.equal(typeof modulo.createFlowMusicAdapter, "function");
});
