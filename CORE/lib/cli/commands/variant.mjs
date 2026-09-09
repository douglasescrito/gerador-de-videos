export async function executar(contexto) {
  const {
    path,
    createVideoVariant,
    required,
    explicitBoolean,
    options,
  } = contexto;
  {
    const outputFile = path.resolve(required(options.out, "--out"));
    console.log(JSON.stringify(await createVideoVariant({ inputFile: path.resolve(required(options.video, "--video")), outputFile, receiptFile: options.receipt ? path.resolve(String(options.receipt)) : `${outputFile}.receipt.json`, format: required(options.format, "--format"), strategy: options.strategy ?? "fit-pad", cropApproved: explicitBoolean(options["crop-approved"], "--crop-approved"), timelineFingerprint: required(options["timeline-fingerprint"], "--timeline-fingerprint") }), null, 2));
  }
}
