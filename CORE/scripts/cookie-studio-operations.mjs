import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactFromFile, sha256File } from "../lib/media-pipeline/artifact.mjs";
import { assertPathAvailable, pathExists, createStageReceipt, writeStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";
import { DEFAULT_FLOW_MUSIC_GENERATION_MODEL, resolveMusicPrompt } from "../lib/media-pipeline/flow-music.mjs";
import { resolveGoogleVidsVoice } from "../lib/media-pipeline/google-vids-voices.mjs";
import { consumeExecutionEffectAuthorization } from "../lib/media-pipeline/execution-journal.mjs";
import { runVidsSpeech } from "./ai-studio-headless.mjs";
import { runVidsVideo } from "./vids-video-headless.mjs";
import { runFlowImage, runFlowVideo } from "./flow-headless.mjs";
import { generateFlowMusicWithBrowserAuth, reconcileFlowMusicWithBrowserAuth } from "./flow-music-headless.mjs";
import { collectVideoWithBrowserAuth, generateImageWithBrowserAuth, generateVideoWithBrowserAuth, observeVideosWithBrowserAuth, reconcileVideoWithBrowserAuth, submitVideoWithBrowserAuth } from "./omni-product-studio-submit.mjs";

export const COOKIE_AUTH_SCHEMA = "mkt-videos/cookie-session-auth@1";

function authRecord(harFile) {
  return { schema: COOKIE_AUTH_SCHEMA, mode: harFile ? "har-cookie-import" : "windows-credential-manager", transport: "playwright-headless", secretMaterialPersisted: false };
}

async function cleanupOnReceiptFailure(file, operation) {
  try { return await operation(); }
  catch (error) { await rm(path.resolve(file), { force: true }); throw error; }
}

function consumeKernelEffect(options, { provider, operation }) {
  const kernelRequired =
    options?.executionKernel === "required"
    || options?.metadata?.executionKernel === "required";
  if (!kernelRequired) return null;
  return consumeExecutionEffectAuthorization(
    options.executionEffectAuthorization,
    {
      provider,
      operation,
      attemptId: options.attemptId ?? null,
    },
  );
}

export function createCookieImageAdapter({ harFile = null, generate = generateImageWithBrowserAuth } = {}) {
  return {
    async generate(options) {
      consumeKernelEffect(options, {
        provider: "gemini-image",
        operation: "image-generate",
      });
      const startedAt = new Date();
      const browser = await generate({ prompt: options.prompt, images: options.images ?? [], model: options.model, aspectRatio: options.aspectRatio, imageSize: options.imageSize, outputFile: options.outputFile, harFile });
      const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
      return cleanupOnReceiptFailure(options.outputFile, async () => {
        const [inputs, artifact] = await Promise.all([
          Promise.all((options.images ?? []).map((file, index) => createArtifactFromFile({ file, kind: "image", role: options.inputRoles?.[index] ?? "reference-image" }))),
          createArtifactFromFile({ file: options.outputFile, kind: "image", role: "generated-image", source: { provider: "gemini-image-product-studio-playwright", model: options.model } }),
        ]);
        const receipt = createStageReceipt({ operation: "generate-image", provider: "gemini-image-product-studio-playwright", model: options.model, mode: options.metadata?.mode ?? "studio", stage: "draft", prompt: options.prompt, parameters: { aspectRatio: options.aspectRatio, imageSize: options.imageSize, auth: authRecord(harFile) }, inputs, artifacts: [artifact], providerResponse: { interactionId: browser.interactionId ?? null, responses: browser.responses ?? [] }, metadata: options.metadata ?? {}, startedAt, completedAt: new Date() });
        await writeStageReceipt(receiptFile, receipt);
        return { file: path.resolve(options.outputFile), receiptFile: path.resolve(receiptFile), receipt, interactionId: browser.interactionId ?? null };
      });
    },
  };
}

export function createCookieVideoAdapter({ harFile = null, generate = generateVideoWithBrowserAuth, reconcile = reconcileVideoWithBrowserAuth, submit = submitVideoWithBrowserAuth, observeMany = observeVideosWithBrowserAuth, collect = collectVideoWithBrowserAuth } = {}) {
  function browserOptions(options, attemptId) {
    return { prompt: options.prompt, images: options.images ?? [], videoFile: options.referenceVideo ?? null, task: options.task ?? "auto", aspectRatio: options.aspectRatio ?? "16:9", model: options.model ?? undefined, outputFile: options.outputFile, harFile, timeoutMs: options.timeoutMs, pollIntervalMs: options.pollIntervalMs, attemptId, onBeforeSubmit: options.onBeforeSubmit, onProviderHandle: options.onProviderHandle };
  }

  async function finishGeneratedVideo(options, browser, { attemptId, startedAt, preserveExisting = false }) {
    const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
    const finish = async () => {
      const [imageInputs, videoInput, artifact] = await Promise.all([
        Promise.all((options.images ?? []).map((file, index) => createArtifactFromFile({ file, kind: "image", role: options.inputRoles?.[index] ?? "reference-image" }))),
        options.referenceVideo ? createArtifactFromFile({ file: options.referenceVideo, kind: "video", role: "reference-video" }) : null,
        createArtifactFromFile({ file: options.outputFile, kind: "video", role: "generated-video", source: { provider: "gemini-omni-product-studio-playwright", model: options.model ?? "gemini-omni-flash-preview" } }),
      ]);
      const receipt = createStageReceipt({ operation: "generate-video", provider: "gemini-omni-product-studio-playwright", model: options.model ?? "gemini-omni-flash-preview", mode: options.metadata?.mode ?? "studio", stage: options.metadata?.pipeline?.stage ?? "omni-video", prompt: options.prompt, parameters: { task: options.task ?? "auto", aspectRatio: options.aspectRatio ?? "16:9", auth: authRecord(harFile), attemptId, ...(browser.zeroPost ? { collectionZeroPost: true } : {}) }, inputs: [...imageInputs, ...(videoInput ? [videoInput] : [])], artifacts: [artifact], providerResponse: { interactionId: browser.interactionId ?? null, fileId: browser.fileId, finalState: browser.states?.at(-1) ?? null, responses: browser.responses ?? [] }, metadata: options.metadata ?? {}, startedAt, completedAt: new Date() });
      await writeStageReceipt(receiptFile, receipt);
      return { file: path.resolve(options.outputFile), receiptFile: path.resolve(receiptFile), receipt, attemptId, interactionId: browser.interactionId ?? null, fileId: browser.fileId, ...(browser.zeroPost ? { zeroPost: true } : {}) };
    };
    return preserveExisting ? finish() : cleanupOnReceiptFailure(options.outputFile, finish);
  }

  return {
    async generate(options) {
      const attemptId = options.attemptId ?? randomUUID();
      consumeKernelEffect(
        { ...options, attemptId },
        {
          provider: "gemini-omni",
          operation: String(options.task ?? "image_to_video")
            .trim()
            .toLowerCase()
            .replaceAll("_", "-"),
        },
      );
      const startedAt = new Date();
      const browser = await generate(browserOptions(options, attemptId));
      return finishGeneratedVideo(options, browser, { attemptId, startedAt });
    },
    async submit(options) {
      const attemptId = options.attemptId ?? randomUUID();
      let transportCalled = false;
      try {
        if (options.outputFile != null) {
          await assertPathAvailable(options.outputFile, "MP4");
          await assertPathAvailable(options.receiptFile ?? `${options.outputFile}.receipt.json`, "Recibo");
        }
        consumeKernelEffect({ ...options, attemptId }, { provider: "gemini-omni", operation: String(options.task ?? "image_to_video").trim().toLowerCase().replaceAll("_", "-") });
        transportCalled = true;
        const browser = await submit(browserOptions(options, attemptId));
        if (!String(browser?.fileId ?? "").trim()) throw new Error("Submissão Omni não retornou fileId persistível.");
        return {
          status: "pending", attemptId, fileId: browser.fileId, interactionId: browser.interactionId ?? null,
          expirationTime: browser.expirationTime ?? null, startedAt: browser.startedAt,
          submittedAt: browser.submittedAt ?? browser.startedAt, authSource: browser.authSource,
          timeoutMs: browser.timeoutMs, requestedTimeoutMs: browser.requestedTimeoutMs, waitBudget: browser.waitBudget,
        };
      } catch (error) {
        // Erro local de destino/autoridade antecede a chamada ao transporte.
        // Os fatos mais conservadores emitidos pelo transporte prevalecem.
        if (typeof error?.postStarted !== "boolean") {
          const facts = { postStarted: transportCalled, submissionAmbiguous: transportCalled };
          try { Object.assign(error, facts); }
          catch { throw Object.assign(new Error(error?.message ?? "Falha na submissão Omni.", { cause: error }), facts); }
        }
        throw error;
      }
    },
    async observeMany(options = {}) {
      return observeMany({ ...options, harFile });
    },
    async observe(options) {
      return (await observeMany({ ...options, requests: [options], harFile }))[0];
    },
    async collect(options) {
      const startedAt = new Date(options.startedAt ?? new Date());
      if (!Number.isFinite(startedAt.getTime())) throw new Error("startedAt da submissão é inválido.");
      await assertPathAvailable(options.receiptFile ?? `${options.outputFile}.receipt.json`, "Recibo");
      if (options.recoverExistingOutput === true && await pathExists(options.outputFile)) {
        const temporary = path.join(path.dirname(options.outputFile), `.recover-${randomUUID()}.mp4`);
        try {
          const browser = await collect({ ...options, outputFile: temporary, harFile });
          if (browser.zeroPost !== true || browser.fileId !== options.fileId) throw new Error("Coleta de recuperação não comprova o mesmo handle sem POST.");
          const [expected, actual] = await Promise.all([sha256File(temporary), sha256File(options.outputFile)]);
          if (expected !== actual) throw new Error("MP4 existente diverge dos bytes coletados da mesma tentativa.");
          return finishGeneratedVideo(options, browser, { attemptId: options.attemptId, startedAt, preserveExisting: true });
        } finally { await rm(temporary, { force: true }); }
      }
      const browser = await collect({ ...options, harFile });
      return finishGeneratedVideo(options, browser, { attemptId: options.attemptId ?? browser.attemptId ?? null, startedAt });
    },
    async reconcile(options) {
      const browser = await reconcile({ fileId: options.fileId, outputFile: options.outputFile, harFile, timeoutMs: options.timeoutMs });
      const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
      return cleanupOnReceiptFailure(options.outputFile, async () => {
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "video", role: "reconciled-video", source: { provider: "gemini-omni-product-studio-playwright", fileId: options.fileId } });
        const receipt = createStageReceipt({ operation: "reconcile-video", provider: "gemini-omni-product-studio-playwright", model: "gemini-omni-flash-preview", mode: options.metadata?.mode ?? "studio", stage: options.metadata?.pipeline?.stage ?? "omni-video", parameters: { auth: authRecord(harFile), fileId: options.fileId, zeroPost: true }, artifacts: [artifact], providerResponse: { fileId: options.fileId, classification: browser.classification }, metadata: options.metadata ?? {}, startedAt: new Date(browser.checkedAt), completedAt: new Date() });
        await writeStageReceipt(receiptFile, receipt);
        return { classification: "ready", zeroPost: true, fileId: options.fileId, checkedAt: browser.checkedAt, file: path.resolve(options.outputFile), receiptFile: path.resolve(receiptFile), receipt };
      });
    },
  };
}

/**
 * Transporte de aplicação sobre o mesmo fluxo cookie-only usado pelo adapter
 * Studio. Ele não cria outro endpoint nem outro cliente: apenas converte inputs
 * inline do app em arquivos efêmeros e devolve os bytes já reconciliados.
 *
 * @param {{harFile?: string|null, generate?: Function, reconcile?: Function}} options
 */
export function createCookieVideoTransport({
  harFile = null,
  generate = generateVideoWithBrowserAuth,
  reconcile = reconcileVideoWithBrowserAuth,
} = {}) {
  async function withTemporaryFiles(inputs, operation) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "mkt-app-cookie-video-"));
    try {
      const imageFiles = [];
      for (let index = 0; index < (inputs.images ?? []).length; index += 1) {
        const image = inputs.images[index];
        const extension = String(image.mimeType ?? "").includes("png") ? ".png" : ".jpg";
        const file = path.join(temporary, `reference-${index + 1}${extension}`);
        await writeFile(file, Buffer.from(image.data, "base64"), { flag: "wx" });
        imageFiles.push(file);
      }
      let videoFile = null;
      if (inputs.referenceVideo) {
        videoFile = path.join(temporary, "reference.mp4");
        await writeFile(videoFile, Buffer.from(inputs.referenceVideo.data, "base64"), { flag: "wx" });
      }
      const outputFile = path.join(temporary, "result.mp4");
      return await operation({ imageFiles, videoFile, outputFile });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  return {
    async generate(options) {
      return withTemporaryFiles({
        images: options.images ?? [],
        referenceVideo: options.referenceVideo ?? null,
      }, async ({ imageFiles, videoFile, outputFile }) => {
        const result = await generate({
          prompt: options.prompt,
          images: imageFiles,
          videoFile,
          task: options.task ?? "auto",
          aspectRatio: options.aspectRatio ?? "16:9",
          outputFile,
          harFile,
          timeoutMs: options.timeoutMs,
          pollIntervalMs: options.pollIntervalMs,
          attemptId: options.attemptId,
          onBeforeSubmit: options.onBeforeSubmit,
          onProviderHandle: options.onProviderHandle,
        });
        return {
          attemptId: options.attemptId ?? null,
          interactionId: result.interactionId ?? null,
          fileId: result.fileId,
          buffer: await readFile(outputFile),
          startedAt: result.startedAt ?? null,
          completedAt: result.completedAt ?? null,
          authMode: harFile ? "har-cookie-import" : "windows-credential-manager",
        };
      });
    },
    async reconcile(options) {
      return withTemporaryFiles({}, async ({ outputFile }) => {
        const result = await reconcile({
          fileId: options.fileId,
          outputFile,
          harFile,
          timeoutMs: options.timeoutMs,
          pollIntervalMs: options.pollIntervalMs,
        });
        return {
          classification: result.classification,
          zeroPost: true,
          fileId: options.fileId,
          buffer: await readFile(outputFile),
          checkedAt: result.checkedAt,
          authMode: harFile ? "har-cookie-import" : "windows-credential-manager",
        };
      });
    },
  };
}

export function createCookieTtsOperation({ generateVids = runVidsSpeech } = {}) {
  return async function generateCookieTts(options) {
    const provider = String(options.provider ?? "google-vids").trim().toLowerCase();
    if (provider !== "google-vids") throw new Error("O único provider de narração do CLI é google-vids.");
    const consumedEffect = consumeKernelEffect(options, {
      provider: "google-vids",
      operation: "text-to-speech",
    });
    if (provider === "google-vids") {
      if (options.speakers?.length) throw new Error("Google Vids TTS não aceita diálogo multi-speaker neste adapter.");
      const voice = resolveGoogleVidsVoice(options.voice ?? "Nyla");
      const startedAt = new Date();
      const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
      const attemptReceiptFile = `${options.outputFile}.vids-attempt.json`;
      const browser = await generateVids({
        url: options.documentUrl,
        text: options.text,
        out: options.outputFile,
        receipt: attemptReceiptFile,
        "new-scene": options.newScene !== false,
        voice: voice.name,
      });
      return cleanupOnReceiptFailure(options.outputFile, async () => {
        const artifact = await createArtifactFromFile({ file: options.outputFile, kind: "audio", role: "tts-voice", source: { provider: "google-vids-playwright", model: browser.model } });
        const receipt = createStageReceipt({
          operation: "generate-tts",
          provider: "google-vids-playwright",
          model: browser.model,
          mode: "studio",
          stage: "tts",
          prompt: options.text,
          parameters: {
            voice: voice.name,
            auth: authRecord(null),
            documentUrl: options.documentUrl,
            newScene: options.newScene !== false,
            fallbackProvider: options.fallbackProvider ?? null,
            fallbackPolicy: options.fallbackPolicy ?? "manual-after-preflight-failure",
          },
          artifacts: [artifact],
          metadata: { ...(options.metadata ?? {}), attemptReceiptFile: path.resolve(attemptReceiptFile) },
          parentReceipts: options.parentReceipts ?? [],
          startedAt: browser.startedAt ? new Date(browser.startedAt) : startedAt,
          completedAt: browser.completedAt ? new Date(browser.completedAt) : new Date(),
        });
        await writeStageReceipt(receiptFile, receipt);
        return { file: path.resolve(options.outputFile), receiptFile: path.resolve(receiptFile), receipt, model: browser.model, voice: voice.name, attempts: 1, attemptReceiptFile: path.resolve(attemptReceiptFile) };
      });
    }
  };
}

/**
 * Geração de vídeo pelo Google Vids — caminho secundário ao `gemini-omni`.
 *
 * Não há reconciliação: a URL do MP4 devolvida pelo provedor é temporária e o
 * adapter já entrega os bytes em disco. O clipe sai sempre com 10 s e 720p.
 */
export function createCookieVidsVideoOperation({ generateVideo = runVidsVideo } = {}) {
  return async function generateCookieVidsVideo(options) {
    const provider = String(options.provider ?? "google-vids-video").trim().toLowerCase();
    if (provider !== "google-vids-video") throw new Error("O provider deste adapter é google-vids-video.");
    consumeKernelEffect(options, { provider: "google-vids-video", operation: "text-to-video" });
    const aspect = String(options.aspectRatio ?? "16:9").trim();
    const startedAt = new Date();
    const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
    const attemptReceiptFile = `${options.outputFile}.vids-attempt.json`;
    const browser = await generateVideo({
      prompt: options.prompt,
      out: options.outputFile,
      receipt: attemptReceiptFile,
      "document-url": options.documentUrl ?? null,
      aspect,
      timeout: options.timeoutMs ?? undefined,
    });
    return cleanupOnReceiptFailure(options.outputFile, async () => {
      const artifact = await createArtifactFromFile({
        file: options.outputFile,
        kind: "video",
        role: "generated-video",
        source: { provider: "google-vids-playwright", model: browser.model },
      });
      const receipt = createStageReceipt({
        operation: "generate-video",
        provider: "google-vids-playwright",
        model: browser.model,
        mode: options.metadata?.mode ?? "studio",
        stage: options.metadata?.pipeline?.stage ?? "vids-video",
        prompt: options.prompt,
        parameters: {
          task: "text_to_video",
          aspectRatio: browser.aspect ?? aspect,
          auth: authRecord(null),
          documentUrl: browser.documentUrl ?? null,
          promptLooksNonEnglish: browser.receipt?.promptLooksNonEnglish ?? null,
          visibleWatermark: "sparkle-bottom-right",
        },
        artifacts: [artifact],
        providerResponse: {
          width: browser.width ?? null,
          height: browser.height ?? null,
          durationSeconds: browser.durationSeconds ?? null,
          quota: browser.quota ?? null,
        },
        metadata: { ...(options.metadata ?? {}), attemptReceiptFile: path.resolve(attemptReceiptFile) },
        parentReceipts: options.parentReceipts ?? [],
        startedAt: browser.startedAt ? new Date(browser.startedAt) : startedAt,
        completedAt: browser.completedAt ? new Date(browser.completedAt) : new Date(),
      });
      await writeStageReceipt(receiptFile, receipt);
      return {
        file: path.resolve(options.outputFile),
        receiptFile: path.resolve(receiptFile),
        receipt,
        model: browser.model,
        aspectRatio: browser.aspect ?? aspect,
        width: browser.width ?? null,
        height: browser.height ?? null,
        durationSeconds: browser.durationSeconds ?? null,
        quota: browser.quota ?? null,
        attempts: 1,
        attemptReceiptFile: path.resolve(attemptReceiptFile),
      };
    });
  };
}

/**
 * Google Flow — terceiro caminho de mídia, com vídeo (Omni 1.1 Flash) e imagem
 * (Nano Banana 2) na mesma sessão. Sem reconciliação: o adapter já entrega os
 * bytes, e a mídia é endereçada por id no próprio provedor.
 */
function createCookieFlowOperation(kind, executar) {
  const provider = `google-flow-${kind}`;
  const operation = kind === "video" ? "text-to-video" : "image-generate";
  return async function generateCookieFlow(options) {
    const informado = String(options.provider ?? provider).trim().toLowerCase();
    if (informado !== provider) throw new Error(`O provider deste adapter é ${provider}.`);
    consumeKernelEffect(options, { provider, operation });
    const startedAt = new Date();
    const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
    const attemptReceiptFile = `${options.outputFile}.flow-attempt.json`;
    const browser = await executar({
      prompt: options.prompt,
      out: options.outputFile,
      receipt: attemptReceiptFile,
      "project-url": options.projectUrl ?? null,
      aspect: options.aspectRatio ?? "16:9",
      count: options.count ?? 1,
      resolution: options.resolution ?? undefined,
      duration: options.duration ?? undefined,
      timeout: options.timeoutMs ?? undefined,
    });
    return cleanupOnReceiptFailure(options.outputFile, async () => {
      const artifacts = await Promise.all(browser.files.map((file) => createArtifactFromFile({
        file,
        kind: kind === "video" ? "video" : "image",
        role: kind === "video" ? "generated-video" : "generated-image",
        source: { provider: "google-flow-playwright", model: browser.model },
      })));
      const receipt = createStageReceipt({
        operation: kind === "video" ? "generate-video" : "generate-image",
        provider: "google-flow-playwright",
        model: browser.model,
        mode: options.metadata?.mode ?? "studio",
        stage: options.metadata?.pipeline?.stage ?? `flow-${kind}`,
        prompt: options.prompt,
        parameters: {
          task: kind === "video" ? "text_to_video" : "text_to_image",
          aspectRatio: browser.aspect,
          resolution: browser.resolution,
          durationSeconds: browser.duration,
          count: browser.count,
          auth: authRecord(null),
          projectUrl: browser.projectUrl,
          visibleWatermark: null,
        },
        artifacts,
        providerResponse: {
          creditosAnunciados: browser.creditos ?? null,
          media: (browser.media ?? []).map((m) => ({ mediaName: m.mediaName, workflowId: m.workflowId, seed: m.seed, modelNameType: m.modelNameType })),
        },
        metadata: { ...(options.metadata ?? {}), attemptReceiptFile: path.resolve(attemptReceiptFile) },
        parentReceipts: options.parentReceipts ?? [],
        startedAt: browser.startedAt ? new Date(browser.startedAt) : startedAt,
        completedAt: browser.completedAt ? new Date(browser.completedAt) : new Date(),
      });
      await writeStageReceipt(receiptFile, receipt);
      return {
        file: path.resolve(browser.file),
        files: browser.files.map((f) => path.resolve(f)),
        receiptFile: path.resolve(receiptFile),
        receipt,
        model: browser.model,
        aspectRatio: browser.aspect,
        resolution: browser.resolution,
        duration: browser.duration,
        count: browser.count,
        creditos: browser.creditos ?? null,
        attempts: 1,
        attemptReceiptFile: path.resolve(attemptReceiptFile),
      };
    });
  };
}

export function createCookieFlowVideoOperation({ generateVideo = runFlowVideo } = {}) {
  return createCookieFlowOperation("video", generateVideo);
}

export function createCookieFlowImageOperation({ generateImage = runFlowImage } = {}) {
  return createCookieFlowOperation("image", generateImage);
}

export function createCookieMusicOperation({
  generateFlow = generateFlowMusicWithBrowserAuth,
} = {}) {
  return async function generateCookieMusic(options) {
    const backend = String(options.backend ?? "flow-music").trim().toLowerCase();
    if (backend !== "flow-music") throw new Error("O único backend musical do CLI é flow-music.");
    const consumedEffect = consumeKernelEffect(options, {
      provider: "flow-music",
      operation: "music-generate",
    });
    if ((options.images?.length ?? 0) > 0) throw new Error("Flow Music não aceita referências de imagem.");
    const composition = resolveMusicPrompt({ prompt: options.prompt, preset: options.preset ?? null });
    const receiptFile = options.receiptFile ?? `${options.outputFile}.receipt.json`;
    await Promise.all([
      assertPathAvailable(options.outputFile, "Trilha musical"),
      assertPathAvailable(receiptFile, "Recibo da trilha musical"),
    ]);
    const browser = await generateFlow({
      prompt: composition.effectivePrompt,
      outputFile: options.outputFile,
      model: options.model ?? DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
      durationSeconds: Number(options.durationSeconds ?? 30),
      preserveOriginalDuration: Boolean(options.preserveOriginalDuration),
      vocals: Boolean(options.vocals),
      timeoutMs: options.timeoutMs,
      softBudgetMs: options.performanceSoftBudgetMs,
    });
    return cleanupOnReceiptFailure(options.outputFile, async () => {
      const provider = "flow-music-playwright";
      const [providerOriginal, artifact] = await Promise.all([
        browser.providerFile
          ? createArtifactFromFile({
              file: browser.providerFile,
              kind: "audio",
              role: "provider-original",
              source: { provider, model: browser.model },
            })
          : null,
        createArtifactFromFile({
          file: options.outputFile,
          kind: "audio",
          role: "music",
          source: { provider, model: browser.model },
        }),
      ]);
      const receipt = createStageReceipt({
        operation: "generate-music",
        provider,
        model: browser.model,
        mode: "studio",
        stage: "music",
        prompt: composition.userPrompt,
        parameters: {
          backend,
          preset: composition.preset,
          effectivePrompt: composition.effectivePrompt,
          requestedModel: options.model ?? DEFAULT_FLOW_MUSIC_GENERATION_MODEL,
          selectedModelLabel: browser.modelLabel ?? null,
          adapterModel: browser.adapterModel ?? null,
          modelSelection: browser.modelSelection ?? null,
          requestedDurationSeconds: Number(options.durationSeconds ?? 30),
          durationSeconds: browser.durationSeconds,
          sourceDurationSeconds: browser.sourceDurationSeconds ?? null,
          fadeOutSeconds: 0,
          cleanCut: true,
          auth: authRecord(null),
        },
        inputs: providerOriginal ? [providerOriginal] : [],
        artifacts: [artifact],
        providerResponse: {
              clipId: browser.clipId,
              operationId: browser.operationId,
              attemptId: browser.attemptId,
            },
        metadata: {
          ...structuredClone(options.metadata ?? {}),
          ...(browser.attemptFile ? { attemptFile: browser.attemptFile } : {}),
          ...(browser.fitReceiptFile ? { fitReceiptFile: browser.fitReceiptFile } : {}),
        },
        parentReceipts: [
          ...(options.parentReceipts ?? []),
          ...(browser.fitReceiptId ? [browser.fitReceiptId] : []),
        ],
        startedAt: new Date(browser.startedAt),
        completedAt: new Date(browser.completedAt),
      });
      await writeStageReceipt(receiptFile, receipt);
      return {
        file: path.resolve(options.outputFile),
        receiptFile: path.resolve(receiptFile),
        receipt,
        backend,
        model: browser.model,
        providerFile: browser.providerFile ?? null,
        attemptFile: browser.attemptFile ?? null,
      };
    });
  };
}

export function createCookieMusicReconcileOperation({
  harFile = null,
  reconcileFlow = reconcileFlowMusicWithBrowserAuth,
} = {}) {
  const publish = createCookieMusicOperation({
    harFile,
    generateFlow: (options) => reconcileFlow({
      attemptFile: `${path.resolve(options.outputFile)}.flow-attempt.json`,
      outputFile: options.outputFile,
      timeoutMs: options.timeoutMs,
      softBudgetMs: options.softBudgetMs,
    }),
  });
  return (options) => publish({
    ...options,
    backend: "flow-music",
    executionKernel: null,
    executionEffectAuthorization: null,
  });
}

export function createCookieStudioOperations(options = {}) {
  return {
    imageAdapter: createCookieImageAdapter(options),
    videoAdapter: createCookieVideoAdapter(options),
    generateTts: createCookieTtsOperation(options),
    generateMusic: createCookieMusicOperation(options),
    reconcileMusic: createCookieMusicReconcileOperation(options),
  };
}
