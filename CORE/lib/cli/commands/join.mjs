export async function executar(contexto) {
  const {
    access,
    path,
    concatPath,
    concatVideos,
    createArtifactFromFile,
    createStageReceipt,
    writeFileAtomic,
    writeStageReceipt,
    required,
    studioMode,
    readJsonFile,
    options,
  } = contexto;
  {
    studioMode(options, "join");
    const manifestFile = path.resolve(required(options.manifest, "--manifest"));
    const { value: manifest } = await readJsonFile(manifestFile, "--manifest");
    if (manifest?.schema === 'gerador-de-videos/assembly-edit@1') {
      const { assembleFilm } = await import('../../media-pipeline/film-assembly.mjs');
      const { createHash } = await import('node:crypto');
      const { createReadStream } = await import('node:fs');
      if (!Array.isArray(manifest.clips) || !manifest.clips.length || manifest.clips.length > 100) throw new Error('Montagem exige de 1 a 100 trechos.');
      const files = manifest.clips.map(c => path.resolve(path.dirname(manifestFile), required(c.file, 'Arquivo do trecho')));
      for (const [i, file] of files.entries()) {
        if (!/^[a-f0-9]{64}$/.test(manifest.clips[i].sha256 || '')) throw new Error('A montagem exige hash da origem.');
        const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk);
        if (digest.digest('hex') !== manifest.clips[i].sha256) throw new Error('Um arquivo de origem mudou. Reabra a montagem.');
      }
      const result = await assembleFilm({ sceneFiles: files, edits: manifest.clips, aspect: manifest.aspect || '16:9', fps: manifest.fps || 24,
        outputFile: path.resolve(required(options.out, '--out')), preserveAudio: true,
        metadata: { manifestFile, sourcePreserved: true, providerCalls: 0, recipeHash: manifest.recipeHash } });
      console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, duration: result.probe.duration, scenes: files.length, providerCalls: 0 }));
      return;
    }
    if (!Array.isArray(manifest) || !manifest.length) throw new Error("--manifest deve conter um array ordenado de arquivos MP4.");
    const files = manifest.map((entry, index) => {
      const value = typeof entry === "string" ? entry : entry?.file;
      if (!value || typeof value !== "string") throw new Error(`manifest[${index}] deve ser caminho ou { file }.`);
      return path.resolve(path.dirname(manifestFile), value);
    });
    await Promise.all(files.map((file) => access(file)));
    const outputFile = path.resolve(required(options.out, "--out"));
    const listFile = path.resolve(String(options.list ?? `${outputFile}.concat.txt`));
    const receiptFile = path.resolve(String(options.receipt ?? `${outputFile}.receipt.json`));
    await writeFileAtomic(listFile, `${files.map((file) => `file '${concatPath(file)}'`).join("\n")}\n`, { label: "Lista de concatenação", encoding: "utf8" });
    const joined = await concatVideos(listFile, outputFile);
    const receipt = createStageReceipt({
      operation: "join-video-stream-copy",
      provider: "ffmpeg",
      mode: "studio",
      stage: "assembly",
      parameters: { method: "concat-demuxer-stream-copy", count: files.length, preservesOmniAudio: true },
      inputs: await Promise.all(files.map((file) => createArtifactFromFile({ file, kind: "video", role: "scene-video" }))),
      artifacts: [await createArtifactFromFile({ file: outputFile, kind: "video", role: "joined-omni-program", source: { provider: "ffmpeg" } })],
      metadata: { manifestFile, listFile, duration: joined.duration, sourcePreserved: true, providerCalls: 0 },
    });
    await writeStageReceipt(receiptFile, receipt);
    console.log(JSON.stringify({ file: outputFile, receipt: receiptFile, list: listFile, duration: joined.duration, scenes: files.length }, null, 2));
  }
}
