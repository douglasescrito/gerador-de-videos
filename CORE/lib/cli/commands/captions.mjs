export async function executar(contexto) {
  const {
    path,
    renderWordCaptions,
    required,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "captions");
    const result = await renderWordCaptions({
      videoFile: path.resolve(required(options.video, "--video")),
      wordsFile: path.resolve(required(options.words, "--words")),
      scriptFile: options.script ? path.resolve(String(options.script)) : null,
      outputFile: path.resolve(required(options.out, "--out")),
      assFile: options.ass ? path.resolve(String(options.ass)) : undefined,
      style: options["caption-style"] ?? "kinetic-word@1",
      aspect: options.aspect ?? "16:9",
      sidecars: options.sidecars ?? [],
    });
    console.log(JSON.stringify({ file: result.file, ass: result.assFile, receipt: result.receiptFile, words: result.wordCount }, null, 2));
  }
}
