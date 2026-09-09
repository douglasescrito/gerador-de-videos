export async function executar(contexto) {
  const {
    path,
    mixAudio,
    required,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "mix");
    const result = await mixAudio({
      voiceFile: path.resolve(required(options.voice, "--voice")),
      musicFile: options.music ? path.resolve(String(options.music)) : null,
      musicDurationSeconds: options["music-duration"] == null ? null : Number(options["music-duration"]),
      ambienceFile: options.ambience ? path.resolve(String(options.ambience)) : null,
      outputFile: path.resolve(required(options.out, "--out")),
      loudness: options.loudness ?? "platform",
      voiceGain: options["voice-gain"] ?? 1.0,
      // parseGain aceita tanto linear ("0.45") quanto dB ("+9dB"); coagir com
      // Number() aqui transformava "+9dB" em NaN e quebrava o ffmpeg lá na frente.
      musicGain: options["music-gain"] ?? 0.45,
      ambienceGain: options["ambience-gain"] ?? 0.2,
      duckingThreshold: Number(options["ducking-threshold"] ?? 0.08),
      duckingRatio: Number(options["ducking-ratio"] ?? 8),
      fadeIn: Number(options["fade-in"] ?? 0.25),
      fadeOut: Number(options["fade-out"] ?? 0),
    });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, analysis: result.analysis }, null, 2));
  }
}
