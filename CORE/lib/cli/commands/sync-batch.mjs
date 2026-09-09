export async function executar(contexto) {
  const {
    mkdir,
    path,
    compilarReceita,
    bindExactGraphicsTextToLocalWords,
    createArtifactFromFile,
    createStageReceipt,
    remapCanonicalWordsToClipWindows,
    withVerifiedGraphicsText,
    withVerifiedLocalWordTimeline,
    writeFileAtomic,
    writeJsonAtomic,
    writeStageReceipt,
    required,
    arrayValue,
    readJsonFile,
    options,
  } = contexto;
  {
    const recipeFile = path.resolve(required(options.recipe, "--recipe"));
    const wordsFile = path.resolve(required(options.words, "--words"));
    const outDir = path.resolve(required(options["out-dir"], "--out-dir"));
    const videosDir = path.resolve(required(options["videos-dir"], "--videos-dir"));
    const [{ value: recipe }, { value: words }] = await Promise.all([
      readJsonFile(recipeFile, "--recipe"),
      readJsonFile(wordsFile, "--words"),
    ]);
    if (!Array.isArray(words) || !words.length) throw new Error("--words deve conter a timeline canônica de palavras.");
    const compiled = compilarReceita(recipe);
    if (compiled.motor !== "filme") throw new Error("sync-batch exige receita kind filme.");
    const scenes = compiled.receita.scenes;
    const selectedSceneIds = new Set(arrayValue(options.scenes).map((value) => String(value)));
    for (const sceneId of selectedSceneIds) if (!scenes.some((scene) => scene.id === sceneId)) throw new Error(`--scene desconhecida: ${sceneId}.`);
    const attempt = Number(options.attempt ?? 1);
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) throw new Error("--attempt deve ser inteiro entre 1 e 3.");
    const windows = remapCanonicalWordsToClipWindows({ words, scenes });
    const byScene = new Map(windows.map((entry) => [entry.sceneId, entry.binding]));
    const promptsDir = path.join(outDir, "prompts");
    await Promise.all([mkdir(promptsDir, { recursive: true }), mkdir(videosDir, { recursive: true })]);
    const jobs = [];
    const promptFiles = [];
    const bindings = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      if (selectedSceneIds.size && !selectedSceneIds.has(scene.id)) continue;
      const binding = byScene.get(scene.id);
      if (!binding) throw new Error(`Janela local ausente para ${scene.id}.`);
      const graphics = bindExactGraphicsTextToLocalWords({ scene, binding });
      let prompt = withVerifiedLocalWordTimeline(withVerifiedGraphicsText(scene.prompt, graphics), binding);
      if (scene.onScreenText) {
        prompt += `\n\nNATIVE TYPOGRAPHY CONTRACT\nRender only the exact text "${scene.onScreenText}" directly in the generated pixels as authored kinetic typography, never as subtitles. No other readable text is allowed.`;
      }
      prompt += "\n\nEXTERNAL NARRATION AUDIO CONTRACT\nThe narration is generated separately and will be added in post. Do not generate, speak, dub, sing or imitate narration, dialogue, vocalization or intelligible human voice. Generate only designed non-verbal ambience and sound effects synchronized to the verified local word timeline. Do not generate music.";
      const promptFile = path.join(promptsDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.txt`);
      await writeFileAtomic(promptFile, `${prompt.trim()}\n`, { label: `Prompt sincronizado ${scene.id}`, encoding: "utf8" });
      promptFiles.push(promptFile);
      const images = (scene.references ?? []).map((reference) => path.resolve(path.dirname(recipeFile), reference.relPath));
      jobs.push({
        id: scene.id,
        promptFile: path.relative(outDir, promptFile).replace(/\\/g, "/"),
        task: scene.generationTask,
        aspect: compiled.receita.aspect,
        mode: "raw",
        out: path.join(videosDir, `${String(index + 1).padStart(2, "0")}-${scene.id}${attempt > 1 ? `-attempt-${String(attempt).padStart(2, "0")}` : ""}.mp4`),
        ...(images.length ? { images } : {}),
      });
      bindings.push({ sceneId: scene.id, onScreenText: scene.onScreenText, graphicsBinding: graphics.binding, ...binding });
    }
    const jobsFile = path.join(outDir, "omni-jobs.json");
    const bindingsFile = path.join(outDir, "local-word-windows.json");
    await Promise.all([
      writeJsonAtomic(jobsFile, jobs, { label: "Jobs Omni sincronizados" }),
      writeJsonAtomic(bindingsFile, { schema: "mkt-videos/local-word-windows@1", recipeId: compiled.receita.id, textAuthority: "approved-script-only", timestampAuthority: "whisper-measured-only", remapping: "global-minus-clip-origin@1", scenes: bindings }, { label: "Janelas locais de palavras" }),
    ]);
    const receiptFile = path.join(outDir, "sync-batch.receipt.json");
    const receipt = createStageReceipt({
      operation: "prepare-synchronized-omni-batch",
      provider: "local-deterministic",
      mode: "studio",
      stage: "sync-batch",
      parameters: { recipeId: compiled.receita.id, sceneCount: jobs.length, selectedSceneIds: [...selectedSceneIds], attempt, remapping: "global-minus-clip-origin@1", externalNarration: true, omniVoice: false, omniMusic: false },
      inputs: await Promise.all([recipeFile, wordsFile].map((file) => createArtifactFromFile({ file, kind: "document", role: file === recipeFile ? "recipe" : "canonical-word-timeline" }))),
      artifacts: await Promise.all([jobsFile, bindingsFile, ...promptFiles].map((file) => createArtifactFromFile({ file, kind: "document", role: file === jobsFile ? "omni-jobs" : file === bindingsFile ? "local-word-windows" : "omni-prompt" }))),
      metadata: { sourcePreserved: true, providerCalls: 0 },
    });
    await writeStageReceipt(receiptFile, receipt);
    console.log(JSON.stringify({ jobs: jobsFile, bindings: bindingsFile, receipt: receiptFile, scenes: jobs.length, attempt }, null, 2));
  }
}
