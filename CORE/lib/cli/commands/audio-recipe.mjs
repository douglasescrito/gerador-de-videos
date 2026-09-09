export async function executar(contexto) {
  const {
    createCookieMusicOperation,
    createCookieTtsOperation,
    executeAudioRecipe,
    planAudioRecipe,
    resolveAudioRecipe,
    explicitBoolean,
    studioMode,
    optionText,
    options,
  } = contexto;
  {
    studioMode(options, "audio-recipe");
    const rawText = options.text === undefined && options["text-file"] === undefined ? null : await optionText(options.text, options["text-file"], "--text", "--text-file");
    const recipe = await resolveAudioRecipe({
      recipeFile: options.recipe ? String(options.recipe) : null,
      preset: options.preset ? String(options.preset) : null,
      strategy: options.strategy ? String(options.strategy) : null,
      text: rawText,
      voice: options.voice ? String(options.voice) : null,
      voiceGain: options["voice-gain"] ? String(options["voice-gain"]) : null,
      musicPrompt: options["music-prompt"] ? String(options["music-prompt"]) : null,
      musicPreset: options["music-preset"] ? String(options["music-preset"]) : null,
      musicGain: options["music-gain"] ? String(options["music-gain"]) : null,
      musicTail: options["music-tail"] ?? options.tail,
      musicDuration: options["music-duration"],
      wordsPerSecond: options["words-per-second"] ?? options.wps,
      loudness: options.loudness ? String(options.loudness) : null,
      title: options.title ? String(options.title) : null,
    });
    if (explicitBoolean(options["dry-run"], "--dry-run", false)) {
      const plan = planAudioRecipe(recipe, {
        collection: options.collection ? String(options.collection) : null,
        out: options.out ? String(options.out) : null,
      });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    const generateTts = createCookieTtsOperation();
    const generateMusic = createCookieMusicOperation();
    const result = await executeAudioRecipe({
      recipe,
      collection: options.collection ? String(options.collection) : null,
      out: options.out ? String(options.out) : null,
      documentUrl: options["document-url"] ? String(options["document-url"]) : null,
      generateTts,
      generateMusic,
    });
    console.log(JSON.stringify({
      masterWav: result.masterWav,
      masterMp3: result.masterMp3,
      receiptFile: result.receiptFile,
      summary: result.summary,
    }, null, 2));
  }
}
