export async function executar(contexto) {
  const {
    access,
    mkdir,
    path,
    PROVIDER_WAIT_POLICY,
    resolveProviderWaitMs,
    createDirectAdmission,
    applyNarrationScript,
    buildNarrationTimingGuide,
    readWordTimeline,
    replaceVideoAudio,
    withNarrationTimingGuide,
    assertDirectProviderInputPermitJit,
    createArtifactFromFile,
    finishVideo,
    buildAdapterInvocation,
    executeDirectAdapterInvocation,
    probeProviderRegistry,
    requireStudioMode,
    writeJsonAtomic,
    writeStageReceipt,
    withCliResourceLease,
    createCliResourceBroker,
    BATCH_TASKS,
    BATCH_ASPECTS,
    cookieRuntime,
    preflightDirectProviderInputs,
    withDirectProviderInputMetadata,
    promptComposition,
    optionText,
    collectionOutputPlan,
    narratedOutputPlan,
    rebuildCollectionFinal,
    deliveryAccel,
    deliverySummary,
    options: commandOptions,
  } = contexto;
  {
    const { readDirectGenerateResume, directGenerateOptions, runDirectVideoPhases, readDirectGenerateDelivery, saveDirectGenerateDelivery, runDirectGenerateLocalStage } = await import("../../media-pipeline/direct-video-phases.mjs");
    const { acquireProductionLock } = await import("../../media-pipeline/production-lock.mjs");
    const { materializeDirectNarration } = await import("../../media-pipeline/direct-narration-stage.mjs");
    const { resolveDeliveryProfile } = await import("../../media-pipeline/delivery-profile.mjs");
    const { readReceipt } = await import("../../media-pipeline/receipt.mjs");
    const resume = commandOptions.resume ? await readDirectGenerateResume(commandOptions.resume) : null;
    if (resume) {
      const allowed = new Set(["resume", "confirm-provider-input", "auth", "har", "timeout", "poll"]);
      for (const key of Object.keys(commandOptions)) if (!allowed.has(key)) throw new Error(`--resume preserva o pedido salvo; não aceita --${key}.`);
    }
    const options = { ...(resume?.options ?? {}), ...commandOptions };
    for (const key of ["out", "video", "first-frame", "narration-audio", "word-timestamps", "narration-script-file", "lut"]) {
      if (options[key] !== undefined) options[key] = path.resolve(String(options[key]));
    }
    if (options.images) options.images = options.images.map((file) => path.resolve(String(file)));
    const userPrompt = await optionText(options.prompt, options["prompt-file"], "--prompt", "--prompt-file");
    const { mode, composition } = promptComposition(userPrompt, options);
    const prompt = composition.effectivePrompt;
    const narrationAudioValue = options["narration-audio"];
    const wordTimestampsValue = options["word-timestamps"];
    if ((narrationAudioValue === undefined) !== (wordTimestampsValue === undefined)) {
      throw new Error("Use --narration-audio e --word-timestamps juntos.");
    }
    const narration = narrationAudioValue === undefined ? null : {
      audioFile: path.resolve(String(narrationAudioValue)),
      wordsFile: path.resolve(String(wordTimestampsValue)),
    };
    if (narration) requireStudioMode(mode, "--narration-audio");
    if (narration) {
      await access(narration.audioFile);
      narration.words = await readWordTimeline(narration.wordsFile);
      if (options["narration-script-file"] !== undefined) {
        const scriptFile = path.resolve(String(options["narration-script-file"]));
        await access(scriptFile);
        narration.words = await applyNarrationScript(narration.words, scriptFile);
        narration.scriptFile = scriptFile;
      }
      narration.timingGuide = buildNarrationTimingGuide(narration.words);
    }
    const firstFrameValue = options["first-frame"];
    if (firstFrameValue !== undefined && (options.images?.length ?? 0) > 0) {
      throw new Error("Use --first-frame sozinho; não misture com --image na mesma geração.");
    }
    if (firstFrameValue !== undefined && options.video !== undefined) {
      throw new Error("--first-frame não pode ser combinado com --video.");
    }
    if (firstFrameValue !== undefined && options.task !== undefined && !["auto", "image_to_video"].includes(String(options.task))) {
      throw new Error("--first-frame aceita somente --task image_to_video ou --task auto.");
    }
    const firstFrame = firstFrameValue !== undefined ? path.resolve(String(firstFrameValue)) : null;
    const images = firstFrame ? [firstFrame] : (options.images ?? []).map((file) => path.resolve(String(file)));
    const referenceVideo = options.video ? path.resolve(String(options.video)) : null;
    const task = options.task && options.task !== "auto" ? options.task : (firstFrame ? "image_to_video" : referenceVideo ? "edit" : images.length > 0 ? "reference_to_video" : "text_to_video");
    if (!BATCH_TASKS.has(task)) throw new Error(`Task inválida: ${task}.`);
    const aspectRatio = options.aspect ?? "16:9";
    if (!BATCH_ASPECTS.has(aspectRatio)) throw new Error(`Aspecto inválido: ${aspectRatio}.`);
    const providerInputDescriptors = [
      ...images.map((file, index) => ({
        file,
        role: firstFrame && index === 0 ? "first-frame" : "reference-image",
        operation: "generate-video",
      })),
      ...(referenceVideo
        ? [{
            file: referenceVideo,
            role: "reference-video",
            operation: "generate-video",
          }]
        : []),
    ];
    const providerInputPermit = await preflightDirectProviderInputs(
      options,
      providerInputDescriptors,
      {
        purpose: "direct-video-generation",
        expectedOperations: "generate-video",
      },
    );
    if (options["delivery-profile"] !== undefined) { requireStudioMode(mode, "--delivery-profile"); resolveDeliveryProfile(options["delivery-profile"], { lut: options.lut }); deliveryAccel(options.accel); }
    if (options.lut !== undefined && options["delivery-profile"] === undefined) throw new Error("--lut exige --delivery-profile.");
    if (narration && !["error", "loop"].includes(String(options["video-fit"] ?? "error"))) throw new Error("--video-fit aceita error ou loop.");
    let plan = resume?.plan ?? await collectionOutputPlan({ options, text: prompt, kind: task });
    const lock = await acquireProductionLock(plan.collection?.root ?? path.join(path.dirname(plan.outputFile), ".generate-locks", path.basename(plan.outputFile)));
    let generateStateFile = resume?.stateFile;
    try {
      if (!resume && plan.collection) plan = await collectionOutputPlan({ options: { ...options, collection: plan.collection.name }, text: prompt, kind: task });
      const outputFile = plan.outputFile;
      await mkdir(path.dirname(outputFile), { recursive: true });
      const normalizedPrompt = narration ? withNarrationTimingGuide(prompt, narration.timingGuide, { renderWords: String(options["render-words"] ?? "false").toLowerCase() === "true" }) : prompt;
      const effectiveComposition = { ...composition, effectivePrompt: normalizedPrompt, narrationTimingGuideAuthorized: Boolean(narration) };
      const timeoutMs = resolveProviderWaitMs("omni", options.timeout ?? PROVIDER_WAIT_POLICY.omni.defaultMs);
      const pollIntervalMs = Number(options.poll ?? 5_000);
      const { videoAdapter } = await cookieRuntime(options);
      const broker = createCliResourceBroker();
      const phased = ["submit", "observe", "collect"].every((name) => typeof videoAdapter[name] === "function");
      if (resume && !phased) throw new Error("O adapter atual não expõe fases retomáveis para generate.");
      const frozenOptions = directGenerateOptions(options, userPrompt);
      const localInputs = await Promise.all([narration?.audioFile, narration?.wordsFile, narration?.scriptFile, options.lut].filter(Boolean).map(async (file) => {
        const { bytes, hash } = await createArtifactFromFile({ file, kind: "data" });
        return { file, bytes, hash };
      }));
      const assertLocalInputs = async () => {
        for (const input of localInputs) {
          const current = await createArtifactFromFile({ file: input.file, kind: "data" });
          if (current.bytes !== input.bytes || current.hash.value !== input.hash.value) throw new Error(`Entrada local alterada: ${input.file}`);
        }
      };
      const withLocalResources = (resources, work) => withCliResourceLease({ broker, resources, productionId: plan.collection?.name ?? `generate:${outputFile}` }, async () => { await assertLocalInputs(); return work(); });
      if (providerInputPermit) {
        await assertDirectProviderInputPermitJit(
          providerInputPermit,
          providerInputDescriptors,
          { requireAll: true },
        );
      }
      // Sexto adapter sob o contrato, e o caminho principal de vídeo. A operação
      // vem do runtime — em NODE_ENV=test é o dublê de loopback —, e o adapter
      // acrescenta preflight de capacidade e resultado normalizado por cima.
      const { createGeminiOmniAdapter } = await import("../../media-pipeline/adapters/gemini-omni.mjs");
      let admission;
      const adapterVideoOmni = createGeminiOmniAdapter({ operacaoDeVideo: phased ? {
        ...videoAdapter,
        generate: (request) => runDirectVideoPhases({
          request, videoAdapter, broker, plan, frozenOptions, localInputs,
          providerInputPermit, descriptors: providerInputDescriptors, resume, admission,
          assertInputs: async () => {
            if (providerInputPermit) await assertDirectProviderInputPermitJit(providerInputPermit, providerInputDescriptors, { requireAll: true });
            await assertLocalInputs();
          },
        }),
      } : videoAdapter });
      // A task do Omni e a operação do contrato são a mesma coisa escrita de dois
      // jeitos; auto já foi resolvido pelas entradas efetivamente declaradas.
      const operacaoOmni = { text_to_video: "text-to-video", image_to_video: "image-to-video", reference_to_video: "reference-to-video", edit: "edit" }[task] ?? "text-to-video";
      const pedidoVideo = {
        prompt: normalizedPrompt,
        outputFile,
        images,
        inputRoles: images.map((_file, index) => firstFrame && index === 0 ? "first-frame" : "reference-image"),
        referenceVideo,
        task,
        aspectRatio,
        model: options.model ?? "nano-banana-pro-preview",
        timeoutMs,
        pollIntervalMs,
        receiptFile: plan.receiptFile,
        providerInputPermit,
        metadata: withDirectProviderInputMetadata(
          { mode, promptComposition: effectiveComposition },
          providerInputPermit,
        ),
      };
      const invocacaoVideo = buildAdapterInvocation({
        adapter: adapterVideoOmni,
        capabilityRegistry: await probeProviderRegistry({ probes: {} }),
        operation: operacaoOmni,
        request: pedidoVideo,
        estimate: await adapterVideoOmni.estimate({ request: pedidoVideo }),
      });
      admission = createDirectAdmission({ invocation: invocacaoVideo, permit: providerInputPermit, permitDescriptors: providerInputDescriptors, outputFile });
      const execute = () => executeDirectAdapterInvocation({ adapter: adapterVideoOmni, invocation: invocacaoVideo });
      let saidaVideo;
      try {
        saidaVideo = phased ? await execute() : await withCliResourceLease(
          {
            resource: "provider:omni",
            productionId: plan.collection?.name ?? `generate:${outputFile}`,
            admission,
          },
          execute,
        );
      } catch (error) {
        if (error.generateStateFile) error.message += ` Retome com: npm run video -- generate --resume "${error.generateStateFile}".`;
        throw error;
      }
      // O restante do comando — montagem da coleção, narração, acabamento — já lia
      // este formato. O adapter devolve o normalizado; aqui ele volta à forma que
      // as etapas seguintes esperam, sem que elas precisem saber do contrato.
      const result = {
        file: saidaVideo.metadata?.file ?? null,
        receiptFile: saidaVideo.metadata?.receiptFile ?? null,
        receipt: saidaVideo.metadata?.receipt ?? null,
        fileId: saidaVideo.providerHandle ?? null,
        interactionId: saidaVideo.metadata?.interactionId ?? null,
        timings: saidaVideo.metadata?.timings ?? {},
        ...(saidaVideo.metadata?.stateFile ? { stateFile: saidaVideo.metadata.stateFile, lifecycle: saidaVideo.metadata.lifecycle } : {}),
      };
      generateStateFile = result.stateFile;
      if (result.stateFile) {
        const delivered = await readDirectGenerateDelivery(result.stateFile);
        if (delivered) { console.log(JSON.stringify(delivered, null, 2)); return; }
      }
      await assertLocalInputs();
      const finalVideo = await runDirectGenerateLocalStage({ stateFile: result.stateFile, key: "assembly", run: () => rebuildCollectionFinal(plan.collection, { recoverExisting: Boolean(resume) }), withResources: (work) => plan.collection ? withLocalResources(["cpu:ffmpeg"], work) : work(), files: (value) => [value?.file, value?.receipt] });
      let narrated = null;
      if (narration) {
        narrated = await runDirectGenerateLocalStage({
          stateFile: result.stateFile, key: "narration",
          files: (value) => [value.file, value.receipt, value.metadata],
          withResources: (work) => withLocalResources(["cpu:ffmpeg"], work),
          run: () => materializeDirectNarration({
            plan: narratedOutputPlan(plan), narration, source: result,
            fit: String(options["video-fit"] ?? "error"),
            renderWords: String(options["render-words"] ?? "false").toLowerCase() === "true",
            recoverExisting: Boolean(resume),
            operations: { replaceVideoAudio, writeStageReceipt, writeJsonAtomic },
          }),
        });
      }
      let finished = null;
      if (options["delivery-profile"] !== undefined) {
        requireStudioMode(mode, "--delivery-profile");
        const finishingSource = narrated ? { file: narrated.file, receipt: await readReceipt(narrated.receipt) } : result;
        const deliveryFile = path.join(path.dirname(result.file), `${path.basename(result.file, path.extname(result.file))}-${String(options["delivery-profile"])}.mp4`);
        finished = await runDirectGenerateLocalStage({
          stateFile: result.stateFile, key: "finish", files: (value) => [value.file, value.receiptFile],
          run: () => finishVideo({
            inputFile: finishingSource.file, outputFile: deliveryFile, profile: String(options["delivery-profile"]),
            lut: options.lut ? path.resolve(String(options.lut)) : null, accel: deliveryAccel(options.accel),
            parentReceipts: finishingSource.receipt?.id ? [finishingSource.receipt.id] : [], recoverExisting: Boolean(resume),
            withEncoderResources: (encoder, work) => withLocalResources(encoder.accel === "nvenc" ? ["cpu:ffmpeg", "gpu:nvenc"] : ["cpu:ffmpeg"], work),
          }),
        });
      } else if (options.lut !== undefined) {
        throw new Error("--lut exige --delivery-profile.");
      }
      const payload = { file: result.file, receipt: result.receiptFile, interactionId: result.interactionId, fileId: result.fileId, timings: result.timings, deliverySummary: deliverySummary(result), finished: finished ? { file: finished.file, receipt: finished.receiptFile } : null, narration: narrated, collection: plan.collection ? { name: plan.collection.name, root: plan.collection.root, partNumber: plan.collection.partNumber, finalVideo } : null, ...(result.stateFile ? { stateFile: result.stateFile, lifecycle: result.lifecycle } : {}) };
      if (result.stateFile) await saveDirectGenerateDelivery(result.stateFile, payload);
      console.log(JSON.stringify(payload, null, 2));
    } catch (error) {
      if (generateStateFile && !error.generateStateFile) {
        error.generateStateFile = generateStateFile;
        error.message += ` Retome com: npm run video -- generate --resume "${generateStateFile}".`;
      }
      throw error;
    } finally { await lock.release(); }
  }
}
