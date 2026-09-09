import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  COOKIE_AUTH_SCHEMA,
  createCookieImageAdapter,
  createCookieMusicOperation,
  createCookieTtsOperation,
  createCookieVideoAdapter,
  createCookieVidsVideoOperation,
} from "../scripts/cookie-studio-operations.mjs";

let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), "cookie-studio-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

const mp4 = () => Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test("adapters de imagem e vídeo registram somente metadados não secretos da sessão", async () => {
  const secret = "cookie-sintetico-que-nao-pode-vazar";
  const harFile = path.join(root, `${secret}.har`);
  const imageFile = path.join(root, "imagem.png");
  const videoFile = path.join(root, "video.mp4");
  await writeFile(harFile, "{}", "utf8");

  const imageAdapter = createCookieImageAdapter({
    harFile,
    generate: async ({ outputFile, harFile: receivedHar }) => {
      assert.equal(receivedHar, harFile);
      await writeFile(outputFile, Buffer.from("png-sintetico"));
      return { interactionId: "image-test", responses: [{ status: 200 }] };
    },
  });
  const image = await imageAdapter.generate({ prompt: "quadro", outputFile: imageFile, model: "gemini-3.1-flash-image", aspectRatio: "16:9", imageSize: "2K" });
  assert.equal(image.receipt.parameters.auth.schema, COOKIE_AUTH_SCHEMA);
  assert.equal(image.receipt.parameters.auth.mode, "har-cookie-import");
  assert.equal(image.receipt.parameters.auth.secretMaterialPersisted, false);

  let persistedHandle = null;
  let forwardedModel = null;
  const videoAdapter = createCookieVideoAdapter({
    harFile,
    generate: async ({ outputFile, attemptId, onProviderHandle, model }) => {
      forwardedModel = model;
      await onProviderHandle?.({ attemptId, fileId: "file-cookie-test" });
      await writeFile(outputFile, mp4());
      return { fileId: "file-cookie-test", interactionId: "video-test", states: ["ACTIVE"], responses: [{ status: 200 }] };
    },
  });
  const video = await videoAdapter.generate({
    prompt: "movimento",
    outputFile: videoFile,
    task: "text_to_video",
    model: "gemini-omni-flash-preview",
    onProviderHandle: async (handle) => { persistedHandle = handle; },
  });
  assert.equal(persistedHandle.fileId, "file-cookie-test");
  assert.equal(forwardedModel, "gemini-omni-flash-preview");
  assert.equal(video.receipt.parameters.auth.transport, "playwright-headless");

  const serialized = `${await readFile(image.receiptFile, "utf8")}\n${await readFile(video.receiptFile, "utf8")}`;
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /cookie-sintetico/);
});

test("reconcile cookie-only é zero POST", async () => {
  const source = path.join(root, "reconcile.mp4");
  const videoAdapter = createCookieVideoAdapter({
    reconcile: async ({ outputFile, fileId }) => {
      assert.equal(fileId, "file-persistido");
      await writeFile(outputFile, mp4());
      return { classification: "ready", checkedAt: "2026-07-22T12:00:00.000Z" };
    },
  });
  const reconciled = await videoAdapter.reconcile({ fileId: "file-persistido", outputFile: source });
  assert.equal(reconciled.zeroPost, true);
  assert.equal(reconciled.receipt.parameters.zeroPost, true);

});

test("Google Vids TTS usa Credential Manager, uma nova cena e fallback apenas manual", async () => {
  const voiceFile = path.join(root, "vids-voice.wav");
  let calls = 0;
  const tts = createCookieTtsOperation({
    generateVids: async (options) => {
      calls += 1;
      assert.equal(options["new-scene"], true);
      assert.equal(options.voice, "Persuasiva");
      assert.match(options.url, /^https:\/\/docs\.google\.com\/videos\/d\//);
      await writeFile(options.out, Buffer.from("wav-google-vids"));
      return { model: "google-vids-tts", startedAt: "2026-08-11T12:00:00.000Z", completedAt: "2026-08-11T12:00:01.000Z" };
    },
  });
  const result = await tts({
    provider: "google-vids",
    documentUrl: "https://docs.google.com/videos/d/test/edit",
    text: "Uma narração de teste com palavras suficientes para o adapter simulado.",
    voice: "persuasiva",
    newScene: true,
    fallbackProvider: "omni",
    fallbackPolicy: "manual-after-preflight-failure",
    outputFile: voiceFile,
  });
  assert.equal(calls, 1);
  assert.equal(result.receipt.provider, "google-vids-playwright");
  assert.equal(result.receipt.parameters.auth.mode, "windows-credential-manager");
  assert.equal(result.receipt.parameters.voice, "Persuasiva");
  assert.equal(result.voice, "Persuasiva");
  assert.equal(result.receipt.parameters.fallbackProvider, "omni");
  assert.equal(result.receipt.parameters.fallbackPolicy, "manual-after-preflight-failure");
});

test("Google Vids rejeita voz fora do catálogo antes de abrir o adapter", async () => {
  let calls = 0;
  const tts = createCookieTtsOperation({ generateVids: async () => { calls += 1; } });
  await assert.rejects(tts({
    provider: "google-vids",
    documentUrl: "https://docs.google.com/videos/d/test/edit",
    text: "Uma narração de teste com palavras suficientes para validar antes do provedor.",
    voice: "Voz inventada",
    outputFile: path.join(root, "never.wav"),
  }), /Voz Google Vids desconhecida/);
  assert.equal(calls, 0);
});

test("Flow Music preserva original, master e recibo sem material secreto", async () => {
  const providerFile = path.join(root, "flow-music.provider.mp3");
  const musicFile = path.join(root, "flow-music.wav");
  const attemptFile = `${musicFile}.flow-attempt.json`;
  const fitReceiptFile = `${musicFile}.fit.receipt.json`;
  const secret = "https://signed-audio.example.invalid/private?token=nao-persistir";
  let flowCalls = 0;
  const music = createCookieMusicOperation({
    generate: async () => assert.fail("não deve usar Lyria"),
    generateFlow: async ({ prompt, outputFile, durationSeconds, model }) => {
      flowCalls += 1;
      assert.match(prompt, /trilha elegante/i);
      assert.equal(outputFile, musicFile);
      assert.equal(durationSeconds, 30);
      assert.equal(model, "lyria-3.5");
      await Promise.all([
        writeFile(providerFile, Buffer.from("mp3-original-flow")),
        writeFile(outputFile, Buffer.from("wav-master-flow")),
        writeFile(attemptFile, JSON.stringify({ status: "completed", signedUrl: secret }), "utf8"),
        writeFile(fitReceiptFile, "{}", "utf8"),
      ]);
      return {
        model: "lyria-3.5",
        modelLabel: "Lyria 3.5",
        adapterModel: "flow-music-web",
        modelSelection: {
          selectionMethod: "playwright-ui-model-menu",
          verifiedAt: "2026-07-29T12:00:00.500Z",
        },
        providerFile,
        attemptFile,
        fitReceiptFile,
        fitReceiptId: "receipt:flow-fit",
        attemptId: "attempt-flow",
        clipId: "clip-flow",
        operationId: "operation-flow",
        requestedDurationSeconds: 30,
        sourceDurationSeconds: 31.2,
        durationSeconds: 30,
        startedAt: "2026-07-29T12:00:00.000Z",
        completedAt: "2026-07-29T12:00:01.000Z",
      };
    },
  });

  const score = await music({
    prompt: "trilha elegante",
    backend: "flow-music",
    durationSeconds: 30,
    outputFile: musicFile,
    confirmPaid: true,
  });

  assert.equal(flowCalls, 1);
  assert.equal(score.backend, "flow-music");
  assert.equal(score.model, "lyria-3.5");
  assert.equal(score.providerFile, providerFile);
  assert.equal(score.receipt.provider, "flow-music-playwright");
  assert.equal(score.receipt.parameters.fadeOutSeconds, 0);
  assert.equal(score.receipt.parameters.cleanCut, true);
  assert.equal(score.receipt.parameters.sourceDurationSeconds, 31.2);
  assert.equal(score.receipt.parameters.requestedModel, "lyria-3.5");
  assert.equal(score.receipt.parameters.selectedModelLabel, "Lyria 3.5");
  assert.equal(score.receipt.parameters.adapterModel, "flow-music-web");
  assert.equal(score.receipt.inputs[0].role, "provider-original");
  assert.ok(score.receipt.metadata.pipeline.parentReceiptIds.includes("receipt:flow-fit"));
  const serialized = await readFile(score.receiptFile, "utf8");
  assert.doesNotMatch(serialized, /signed-audio|token=nao-persistir/);
});

test("operações cookie-only bloqueiam recursos sem contrato de sessão", async () => {
  const tts = createCookieTtsOperation({ generateVids: async () => assert.fail("não deve gerar") });
  await assert.rejects(tts({ text: "diálogo", speakers: [{ speaker: "A", voice: "Charon" }] }), /multi-speaker/);

  const music = createCookieMusicOperation({ generateFlow: async () => assert.fail("não deve gerar") });
  await assert.rejects(music({ prompt: "x", backend: "lyria-realtime" }), /único backend musical.*flow-music/);
});

test("adapter em modo kernel falha antes do provider sem effect authorization", async () => {
  let imageCalls = 0;
  const image = createCookieImageAdapter({
    generate: async () => {
      imageCalls += 1;
    },
  });
  await assert.rejects(
    image.generate({
      prompt: "teste",
      outputFile: path.join(root, "blocked.png"),
      metadata: { mode: "studio", executionKernel: "required" },
    }),
    /não foi emitida pelo journal/,
  );
  assert.equal(imageCalls, 0);

  let ttsCalls = 0;
  const tts = createCookieTtsOperation({
    generate: async () => {
      ttsCalls += 1;
    },
  });
  await assert.rejects(
    tts({
      text: "teste",
      outputFile: path.join(root, "blocked.wav"),
      executionKernel: "required",
    }),
    /não foi emitida pelo journal/,
  );
  assert.equal(ttsCalls, 0);
});

test("Google Vids vídeo grava recibo com proporção, cota e a marca visível do provedor", async () => {
  const clipFile = path.join(root, "vids-clipe.mp4");
  let calls = 0;
  const generateVidsVideo = createCookieVidsVideoOperation({
    generateVideo: async (options) => {
      calls += 1;
      assert.equal(options.aspect, "9:16");
      assert.equal(options["document-url"], null);
      await writeFile(options.out, mp4());
      return {
        model: "google-vids-omni-720p",
        aspect: "9:16",
        documentUrl: "https://docs.google.com/videos/d/teste/edit",
        width: 720,
        height: 1280,
        durationSeconds: 10,
        quota: { limit: 50, remaining: 49, used: 1, resetsAt: "2026-09-01T07:00:00.000Z" },
        receipt: { promptLooksNonEnglish: false },
        startedAt: "2026-08-28T12:00:00.000Z",
        completedAt: "2026-08-28T12:00:50.000Z",
      };
    },
  });
  const result = await generateVidsVideo({
    provider: "google-vids-video",
    prompt: "Flat 2D motion design, three shapes glide in.",
    aspectRatio: "9:16",
    outputFile: clipFile,
  });
  assert.equal(calls, 1);
  assert.equal(result.receipt.provider, "google-vids-playwright");
  assert.equal(result.receipt.parameters.auth.mode, "windows-credential-manager");
  assert.equal(result.receipt.parameters.aspectRatio, "9:16");
  assert.equal(result.receipt.parameters.visibleWatermark, "sparkle-bottom-right");
  assert.equal(result.receipt.parameters.promptLooksNonEnglish, false);
  assert.equal(result.receipt.providerResponse.durationSeconds, 10);
  assert.equal(result.receipt.providerResponse.quota.remaining, 49);
  assert.equal(result.durationSeconds, 10);
  assert.equal(result.attempts, 1);
});

test("fases cookie Omni preservam handle, hooks e recibo sem repetir generate", async () => {
  const outputFile = path.join(root, "phased-video.mp4");
  const harFile = "session-path-not-for-receipt.har";
  const calls = [];
  const adapter = createCookieVideoAdapter({
    harFile,
    generate: async () => assert.fail("as fases não podem chamar generate"),
    submit: async ({ onBeforeSubmit, onProviderHandle, attemptId, harFile: receivedHar }) => {
      assert.equal(receivedHar, harFile);
      await onBeforeSubmit({ attemptId });
      calls.push("submit");
      await onProviderHandle({ attemptId, fileId: "file-phases" });
      return { status: "pending", fileId: "file-phases", attemptId, interactionId: "interaction-phases", startedAt: "2026-09-05T10:00:00.000Z", submittedAt: "2026-09-05T10:00:01.000Z", cookies: [{ value: "not-for-handle" }] };
    },
    observeMany: async ({ requests, harFile: receivedHar }) => {
      assert.equal(receivedHar, harFile);
      calls.push("observe");
      return requests.map(({ fileId }) => ({ fileId, classification: "ready", zeroPost: true }));
    },
    collect: async ({ fileId, outputFile: file, harFile: receivedHar, attemptId }) => {
      assert.equal(receivedHar, harFile);
      assert.equal(fileId, "file-phases");
      calls.push("collect");
      await writeFile(file, mp4());
      return { fileId, attemptId, zeroPost: true, classification: "ready" };
    },
  });
  const options = { prompt: "texto aprovado", task: "text_to_video", outputFile, attemptId: "attempt-phases", onBeforeSubmit: async () => calls.push("reserve"), onProviderHandle: async () => calls.push("persist") };
  const submitted = await adapter.submit(options);
  assert.equal(submitted.attemptId, options.attemptId);
  assert.doesNotMatch(JSON.stringify(submitted), /not-for-handle|session-path-not-for-receipt/);
  await adapter.observe({ fileId: submitted.fileId });
  const result = await adapter.collect({ ...options, ...submitted });
  assert.deepEqual(calls, ["reserve", "submit", "persist", "observe", "collect"]);
  assert.equal(result.receipt.operation, "generate-video");
  assert.equal(result.receipt.parameters.attemptId, options.attemptId);
  assert.equal(result.receipt.parameters.collectionZeroPost, true);
  assert.equal(result.zeroPost, true);
  assert.doesNotMatch(await readFile(result.receiptFile, "utf8"), /not-for-handle|session-path-not-for-receipt/);
});

test("submit cookie distingue falha local de falha sem estado do transporte", async () => {
  let calls = 0;
  const outputFile = path.join(root, "phased-collision.mp4");
  await writeFile(outputFile, mp4());
  const adapter = createCookieVideoAdapter({ submit: async () => { calls += 1; throw new Error("resposta perdida"); } });
  await assert.rejects(adapter.submit({ outputFile }), (error) => error.postStarted === false && error.submissionAmbiguous === false);
  assert.equal(calls, 0);
  await assert.rejects(adapter.submit({ outputFile: path.join(root, "phased-uncertain.mp4") }), (error) => error.postStarted === true && error.submissionAmbiguous === true);
  assert.equal(calls, 1);
});

test("Google Vids vídeo recusa provider que não é o dele antes de tocar no provedor", async () => {
  let calls = 0;
  const generateVidsVideo = createCookieVidsVideoOperation({ generateVideo: async () => { calls += 1; } });
  await assert.rejects(
    generateVidsVideo({ provider: "gemini-omni", prompt: "shapes", outputFile: path.join(root, "recusado.mp4") }),
    /O provider deste adapter é google-vids-video/,
  );
  assert.equal(calls, 0);
});

test("Google Vids vídeo com kernel exigido não gera sem autorização do journal", async () => {
  let calls = 0;
  const generateVidsVideo = createCookieVidsVideoOperation({ generateVideo: async () => { calls += 1; } });
  await assert.rejects(
    generateVidsVideo({
      provider: "google-vids-video",
      prompt: "shapes",
      outputFile: path.join(root, "bloqueado.mp4"),
      executionKernel: "required",
    }),
    /não foi emitida pelo journal/,
  );
  assert.equal(calls, 0);
});
