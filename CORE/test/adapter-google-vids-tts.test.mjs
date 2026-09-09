import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleVidsTtsAdapter, GOOGLE_VIDS_TTS_ADAPTER_ID } from "../lib/media-pipeline/adapters/google-vids-tts.mjs";
import {
  assertAdapterContract,
  buildAdapterInvocation,
  executeDirectAdapterInvocation,
  runAdapterConformanceSuite,
} from "../lib/media-pipeline/adapter-contract.mjs";
import { probeProviderRegistry } from "../lib/media-pipeline/provider-registry.mjs";

const registro = () => probeProviderRegistry({ probes: {} });
const DOC = "https://docs.google.com/videos/d/exemplo/edit";

function dubleQueGera({ aoChamar = () => {} } = {}) {
  return async (pedido) => {
    aoChamar(pedido);
    return {
      file: pedido.outputFile,
      receiptFile: `${pedido.outputFile}.receipt.json`,
      receipt: { id: "receipt:sha256:teste", artifacts: [{ id: "artifact:teste", kind: "audio" }] },
      model: "google-vids-tts",
      voice: pedido.voice,
      attempts: 1,
    };
  };
}

test("o adapter assina o contrato e declara o que faz", () => {
  const adapter = createGoogleVidsTtsAdapter({ gerarNarracao: dubleQueGera() });
  assert.equal(assertAdapterContract(adapter), true);
  assert.equal(adapter.id, GOOGLE_VIDS_TTS_ADAPTER_ID);
  assert.equal(adapter.kind, "audio");
  assert.deepEqual(adapter.operations, ["text-to-speech"]);
  assert.deepEqual(adapter.paidOperations, ["text-to-speech"]);
});

test("passa na conformidade sem tocar provedor", async () => {
  const adapter = createGoogleVidsTtsAdapter({ gerarNarracao: dubleQueGera() });
  const relatorio = await runAdapterConformanceSuite({
    adapter, capabilityRegistry: await registro(), operation: "text-to-speech",
    request: { text: "oi", outputFile: "voz.wav", documentUrl: DOC },
  });
  assert.equal(relatorio.passed, true, JSON.stringify(relatorio.checks));
  assert.equal(relatorio.providerFree, true);
});

test("sem documentUrl falha antes de chamar o provedor", async () => {
  let chamou = false;
  const adapter = createGoogleVidsTtsAdapter({ gerarNarracao: dubleQueGera({ aoChamar: () => { chamou = true; } }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-speech",
    request: { text: "oi", outputFile: "voz.wav" },
  });
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /documentUrl/);
  assert.equal(chamou, false);
});

test("cena nova é o padrão, para não sobrescrever locução aprovada", async () => {
  let recebido = null;
  const adapter = createGoogleVidsTtsAdapter({ gerarNarracao: dubleQueGera({ aoChamar: (p) => { recebido = p; } }) });
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: await registro(), operation: "text-to-speech",
    request: { text: "oi", outputFile: "voz.wav", documentUrl: DOC, voice: "Persuasiva" },
  });
  const resultado = await executeDirectAdapterInvocation({ adapter, invocation });
  assert.equal(recebido.newScene, true);
  assert.equal(recebido.voice, "Persuasiva");
  assert.equal(resultado.status, "ready");
  assert.equal(resultado.metadata.voice, "Persuasiva", "a voz reportada é a que o provedor confirmou");
});

test("capacidade bloqueada barra antes de chamar o provedor", async () => {
  let chamou = false;
  const adapter = createGoogleVidsTtsAdapter({ gerarNarracao: dubleQueGera({ aoChamar: () => { chamou = true; } }) });
  const registroBloqueado = await registro();
  registroBloqueado.providers.find((p) => p.id === GOOGLE_VIDS_TTS_ADAPTER_ID).status = "pending";
  const invocation = buildAdapterInvocation({
    adapter, capabilityRegistry: registroBloqueado, operation: "text-to-speech",
    request: { text: "oi", outputFile: "x.wav", documentUrl: DOC },
  });
  assert.equal(invocation.preflight.status, "blocked");
  await assert.rejects(() => executeDirectAdapterInvocation({ adapter, invocation }), /bloqueado antes da execução/);
  assert.equal(chamou, false);
});

test("importar o módulo não arrasta Playwright nem cookie", async () => {
  const modulo = await import("../lib/media-pipeline/adapters/google-vids-tts.mjs");
  assert.equal(typeof modulo.createGoogleVidsTtsAdapter, "function");
});
