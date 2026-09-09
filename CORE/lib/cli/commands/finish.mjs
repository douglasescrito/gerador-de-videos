export async function executar(contexto) {
  const {
    path,
    finishVideo,
    required,
    studioMode,
    deliveryAccel,
    options,
  } = contexto;
  {
    studioMode(options, "finish");
    const inputFile = path.resolve(required(options.video, "--video"));
    const outputFile = path.resolve(required(options.out, "--out"));
    const result = await finishVideo({
      inputFile,
      outputFile,
      profile: required(options["delivery-profile"], "--delivery-profile"),
      lut: options.lut ? path.resolve(String(options.lut)) : null,
      accel: deliveryAccel(options.accel),
    });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, profile: result.receipt.parameters.profile, accel: result.encoder?.accel, encoder: result.encoder?.encoder, integrity: result.integrity?.status }, null, 2));
  }
}
