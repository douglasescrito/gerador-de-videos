export async function executar(contexto) {
  const {
    path,
    createProvenanceManifest,
    required,
    explicitBoolean,
    readJsonFile,
    options,
  } = contexto;
  {
    const receiptIds = options["receipt-ids"] ? (await readJsonFile(options["receipt-ids"], "--receipt-ids")).value : [];
    if (!Array.isArray(receiptIds)) throw new Error("--receipt-ids deve apontar para um array JSON.");
    console.log(JSON.stringify(await createProvenanceManifest({ masterFile: path.resolve(required(options.video, "--video")), receiptIds, outputFile: path.resolve(required(options.out, "--out")), timelineFingerprint: options["timeline-fingerprint"] ?? null, c2pa: explicitBoolean(options.c2pa, "--c2pa") }), null, 2));
  }
}
