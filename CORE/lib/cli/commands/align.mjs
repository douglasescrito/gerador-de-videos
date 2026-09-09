export async function executar(contexto) {
  const {
    access,
    mkdir,
    readdir,
    path,
    ALIGN_DEFAULTS,
    alignNarrationBlocks,
    required,
    explicitBoolean,
    optionText,
    readJsonFile,
    options,
  } = contexto;
  {
    const continuousAudio = options.audio ? path.resolve(String(options.audio)) : null;
    if (continuousAudio && (options.blocks || options["scenes-dir"])) throw new Error("Use --audio com --script/--script-file ou --blocks com --scenes-dir, não os dois modos.");
    let resolved;
    let defaultOutDir;
    if (continuousAudio) {
      await access(continuousAudio);
      const script = await optionText(options.script, options["script-file"], "--script", "--script-file");
      resolved = [{ id: "master", text: script, audioFile: continuousAudio }];
      defaultOutDir = path.join(path.dirname(continuousAudio), "..", "alinhamento");
    } else {
      const { value: blocks } = await readJsonFile(options.blocks, "--blocks");
      if (!Array.isArray(blocks) || !blocks.length) throw new Error("--blocks deve conter o mesmo array usado em narration-jobs { id, text }.");
      const scenesDir = path.resolve(required(options["scenes-dir"], "--scenes-dir"));
      const entries = await readdir(scenesDir);
      resolved = blocks.map((block, index) => {
        const id = String(block.id ?? `n${String(index + 1).padStart(2, "0")}`);
        if (!block.text) throw new Error(`Bloco ${id} não tem texto de roteiro para conferir a transcrição.`);
        const needle = id.toLowerCase();
        const match = entries.find((entry) => {
          if (!/\.mp4$/i.test(entry)) return false;
          const base = entry.toLowerCase().replace(/\.mp4$/, "");
          return base === needle || base.endsWith(`-${needle}`) || base.endsWith(`_${needle}`);
        });
        if (!match) throw new Error(`Não encontrei o MP4 do bloco ${id} em ${scenesDir} (esperado <algo>-${id}.mp4).`);
        return { id, text: String(block.text), file: path.join(scenesDir, match) };
      });
      defaultOutDir = path.join(scenesDir, "..", "alinhamento");
    }
    const outDir = path.resolve(String(options["out-dir"] ?? defaultOutDir));
    await mkdir(outDir, { recursive: true });
    const numeric = (value, fallback) => (value === undefined ? fallback : Number(value));
    const result = await alignNarrationBlocks({
      blocks: resolved,
      outDir,
      whisperModel: String(options["whisper-model"] ?? ALIGN_DEFAULTS.whisperModel),
      whisperCommand: String(options["whisper-command"] ?? "whisper"),
      whisperDevice: String(options["whisper-device"] ?? ALIGN_DEFAULTS.whisperDevice),
      whisperBackend: String(options["whisper-backend"] ?? ALIGN_DEFAULTS.whisperBackend),
      whisperPython: options["whisper-python"] ? String(options["whisper-python"]) : null,
      cpuConcurrency: numeric(options["cpu-concurrency"], ALIGN_DEFAULTS.cpuConcurrency),
      inferenceConcurrency: numeric(options["inference-concurrency"], ALIGN_DEFAULTS.inferenceConcurrency),
      cache: explicitBoolean(options.cache, "--cache", ALIGN_DEFAULTS.cache),
      refreshCache: explicitBoolean(options["refresh-cache"], "--refresh-cache", false),
      language: String(options.language ?? ALIGN_DEFAULTS.language),
      leadInSeconds: numeric(options["lead-in"], ALIGN_DEFAULTS.leadInSeconds),
      tailOutSeconds: numeric(options["tail-out"], ALIGN_DEFAULTS.tailOutSeconds),
      gapSeconds: numeric(options.gap, ALIGN_DEFAULTS.gapSeconds),
      minConfidence: numeric(options["min-confidence"], ALIGN_DEFAULTS.minConfidence),
      // Passe de correção ortográfica: --corrigir true adota a grafia do roteiro
      // para palavras foneticamente próximas, mantendo os timestamps medidos.
      spellingFloor: explicitBoolean(options.corrigir, "--corrigir", false) ? 0.3 : 0.75,
      preserveSingleAudioMaster: Boolean(continuousAudio),
    });
    console.log(JSON.stringify({
      status: result.status,
      duration: result.duration,
      wordCount: result.wordCount,
      master: result.masterFile,
      words: result.wordsFile,
      spans: result.spansFile,
      receipt: result.receiptFile,
      metrics: result.metricsFile,
      whisper: { device: result.whisper.device, backend: result.whisper.backend, fp16: result.whisper.fp16, reason: result.whisper.deviceReason },
      ...(result.whisper.deviceNotice ? { aviso: result.whisper.deviceNotice } : {}),
      execution: { concurrency: result.execution.concurrency, cache: result.execution.cache, wallMs: result.execution.metrics.wallMs },
      blocks: result.blocks.map((block) => ({ id: block.id, status: block.status, spellingCorrections: block.spellingCorrections, findings: block.findings })),
      ...(result.status === "pass"
        ? { next: `npm run video -- commercial --step scaffold --words "${result.wordsFile}" --narration-duration ${result.duration} --out spec.json` }
        : { blocked: result.blockedBlocks, hint: "Regere os blocos bloqueados: a voz disse algo diferente do roteiro. Confirme com --whisper-model large-v3-turbo antes de gastar." }),
    }, null, 2));
    if (result.status !== "pass") process.exitCode = 1;
  }
}
