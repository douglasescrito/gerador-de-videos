export async function executar(contexto) {
  const {
    path,
    muxMasterAudio,
    required,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "mux-audio");
    const videoFile = path.resolve(required(options.video, "--video"));
    const audioFile = path.resolve(required(options.audio, "--audio"));
    const outputFile = path.resolve(required(options.out, "--out"));
    const receiptFile = path.resolve(String(options.receipt ?? `${outputFile}.receipt.json`));
    const result = await muxMasterAudio({
      videoFile,
      audioFile,
      outputFile,
      receiptFile,
      durationToleranceSeconds: Number(options["duration-tolerance"] ?? 0.05),
      metadata: { workflow: "joined-video-plus-flow-music" },
    });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, durationDecision: result.durationDecision }, null, 2));
  }
}
