export async function executar(contexto) {
  const {
    path,
    fitNarrationToDuration,
    required,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "voice-fit");
    const result = await fitNarrationToDuration({
      sourceFile: path.resolve(required(options.voice, "--voice")),
      targetDuration: Number(required(options.duration, "--duration")),
      maxTempoRatio: Number(options["max-tempo"] ?? 1.15),
      outputFile: path.resolve(required(options.out, "--out")),
    });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, tempoRatio: result.tempoRatio, duration: result.after.duration }, null, 2));
  }
}
