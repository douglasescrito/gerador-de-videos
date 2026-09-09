export async function executar(contexto) {
  const {
    path,
    renderMotionGraphics,
    required,
    explicitBoolean,
    readJsonFile,
    options,
  } = contexto;
  {
    const cards = (await readJsonFile(options.cards, "--cards")).value;
    const outputFile = path.resolve(required(options.out, "--out"));
    console.log(JSON.stringify(await renderMotionGraphics({ videoFile: path.resolve(required(options.video, "--video")), cards, outputFile, assFile: options.ass ? path.resolve(String(options.ass)) : `${outputFile}.motion.ass`, receiptFile: options.receipt ? path.resolve(String(options.receipt)) : `${outputFile}.receipt.json`, aspect: options.aspect ?? "16:9", preserveAudio: explicitBoolean(options["preserve-audio"], "--preserve-audio", true), timelineFingerprint: options["timeline-fingerprint"] ?? null, brandKitHash: options["brand-kit-hash"] ?? null }), null, 2));
  }
}
