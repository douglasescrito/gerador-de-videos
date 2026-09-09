export async function executar(contexto) {
  const {
    access,
    mkdir,
    readdir,
    path,
    mediaDuration,
    readWordTimeline,
    buildCommercialJobs,
    buildNarrationBlockPrompt,
    concatPath,
    concatVideos,
    extractVerifyFrame,
    muxNarration,
    planAssembly,
    scaffoldCommercial,
    trimScene,
    validateSpec,
    writeFileAtomic,
    writeJsonAtomic,
    coreRoot,
    DEFAULT_COMMERCIAL_LOGO,
    required,
    readJsonFile,
    options,
  } = contexto;
  {
    const step = String(options.step ?? "").trim();
    if (step === "scaffold") {
      const words = await readWordTimeline(path.resolve(required(options.words, "--words")));
      const spec = scaffoldCommercial({
        words,
        name: options.name ? String(options.name) : "comercial",
        aspect: String(options.aspect ?? "16:9"),
        maxWords: Number(options["max-words"] ?? 7),
        narrationDuration: options["narration-duration"] !== undefined ? Number(options["narration-duration"]) : undefined,
      });
      const outFile = path.resolve(String(options.out ?? path.join(coreRoot, "outputs", "commercial-spec.json")));
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeJsonAtomic(outFile, spec, { label: "Spec comercial" });
      console.log(JSON.stringify({ step, spec: outFile, scenes: spec.scenes.length, words: words.length, hint: "Edite o spec (estilos: tense/brand/warm/forward/closer; ajuste settleOffset por cena se preciso)." }, null, 2));
    } else if (step === "jobs") {
      const { value: spec } = await readJsonFile(options.spec, "--spec");
      const logoImage = options.logo ? path.resolve(String(options.logo)) : DEFAULT_COMMERCIAL_LOGO;
      if (logoImage) await access(logoImage);
      const jobs = buildCommercialJobs(spec, { logoImage });
      const outFile = path.resolve(String(options.out ?? path.join(coreRoot, "outputs", "commercial-jobs.json")));
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeJsonAtomic(outFile, jobs, { label: "Jobs comerciais" });
      console.log(JSON.stringify({ step, jobs: outFile, logo: logoImage, count: jobs.length, next: `npm run video -- batch --jobs "${outFile}" --out-dir <scenes-dir>` }, null, 2));
    } else if (step === "narration-jobs") {
      const { value: blocks } = await readJsonFile(options.blocks, "--blocks");
      if (!Array.isArray(blocks) || !blocks.length) throw new Error("--blocks deve conter um array de blocos { id, text, direction?, seconds? }.");
      const jobs = blocks.map((block, index) => ({
        id: String(block.id ?? `bloco-${String(index + 1).padStart(2, "0")}`),
        task: "text_to_video",
        aspect: String(options.aspect ?? "16:9"),
        prompt: buildNarrationBlockPrompt(block.text, { direction: block.direction ?? "", seconds: block.seconds ?? 10, voice: block.voice ?? "" }),
      }));
      const outFile = path.resolve(String(options.out ?? path.join(coreRoot, "outputs", "narration-jobs.json")));
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeJsonAtomic(outFile, jobs, { label: "Jobs de narração" });
      console.log(JSON.stringify({ step, jobs: outFile, count: jobs.length, next: "Gere com batch, extraia o áudio de cada bloco (ffmpeg), alinhe com Whisper e monte o master." }, null, 2));
    } else if (step === "verify" || step === "assemble") {
      const { value: rawSpec } = await readJsonFile(options.spec, "--spec");
      const spec = validateSpec(rawSpec);
      const scenesDir = path.resolve(required(options["scenes-dir"], "--scenes-dir"));
      const entries = await readdir(scenesDir);
      const resolveSceneFile = async (scene) => {
        if (scene.file) { const file = path.resolve(scene.file); await access(file); return file; }
        const id = scene.id.toLowerCase();
        const match = entries.find((entry) => {
          if (!/\.mp4$/i.test(entry)) return false;
          const base = entry.toLowerCase().replace(/\.mp4$/, "");
          return base === id || base.endsWith(`-${id}`) || base.endsWith(`_${id}`);
        });
        if (!match) throw new Error(`Não encontrei o MP4 da cena ${scene.id} em ${scenesDir} (esperado <algo>${scene.id}.mp4).`);
        return path.join(scenesDir, match);
      };
      const sources = {};
      const clipDurations = {};
      for (const scene of spec.scenes) {
        sources[scene.id] = await resolveSceneFile(scene);
        clipDurations[scene.id] = await mediaDuration(sources[scene.id]);
      }
      const plan = planAssembly(spec, { clipDurations });
      if (step === "verify") {
        const outDir = path.resolve(String(options["out-dir"] ?? path.join(scenesDir, "verificacao")));
        await mkdir(outDir, { recursive: true });
        const frames = [];
        for (const entry of plan.scenes) {
          const at = entry.offset + Math.min(1.6, entry.duration * 0.6);
          const frameFile = path.join(outDir, `${entry.id}.jpg`);
          await extractVerifyFrame({ sourceFile: sources[entry.id], at, outputFile: frameFile });
          frames.push({ id: entry.id, at: Math.round(at * 100) / 100, frame: frameFile });
        }
        console.log(JSON.stringify({ step, outDir, frames, hint: "Confira o texto de cada frame; regenere cenas com erro via batch e rode assemble." }, null, 2));
      } else {
        const narrationFile = path.resolve(required(options.narration, "--narration"));
        await access(narrationFile);
        const finalFile = path.resolve(String(options.out ?? path.join(coreRoot, "outputs", spec.name, `${spec.name}-final.mp4`)));
        const workDir = path.join(path.dirname(finalFile), `${spec.name}-sync`);
        await mkdir(workDir, { recursive: true });
        const parts = [];
        for (const entry of plan.scenes) {
          const partFile = path.join(workDir, `${entry.id}-sync.mp4`);
          await trimScene({ sourceFile: sources[entry.id], offset: entry.offset, duration: entry.duration, outputFile: partFile, size: spec.assembly.size, fps: spec.assembly.fps });
          parts.push(partFile);
        }
        const concatList = path.join(workDir, "concat.txt");
        await writeFileAtomic(concatList, `${parts.map((file) => `file '${concatPath(file)}'`).join("\n")}\n`, { label: "Lista de concatenação comercial", encoding: "utf8" });
        const mudoFile = path.join(workDir, `${spec.name}-muda.mp4`);
        await concatVideos(concatList, mudoFile);
        const mux = await muxNarration({ videoFile: mudoFile, audioFile: narrationFile, outputFile: finalFile });
        const receiptFile = path.join(path.dirname(finalFile), `${spec.name}.assembly.receipt.json`);
        const receipt = {
          schema: "mkt-videos/commercial-assembly@1",
          collection: spec.name,
          completedAt: new Date().toISOString(),
          method: "commercial flat2d: trim(janela de texto formado) + concat + mux narração",
          narration: narrationFile,
          scenes: plan.scenes.map((entry) => ({ ...entry, source: sources[entry.id] })),
          plannedDuration: plan.totalDuration,
          finalFile,
          finalDuration: mux.duration,
        };
        await writeJsonAtomic(receiptFile, receipt, { label: "Recibo de montagem comercial" });
        console.log(JSON.stringify({ step, final: finalFile, receipt: receiptFile, scenes: plan.scenes.length, plannedDuration: plan.totalDuration, finalDuration: mux.duration }, null, 2));
      }
    } else {
      throw new Error("Use --step scaffold | jobs | narration-jobs | verify | assemble.");
    }
  }
}
