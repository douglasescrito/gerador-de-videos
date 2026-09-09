export async function executar(contexto) {
  const {
    path,
    signC2paDelivery,
    required,
    options,
  } = contexto;
  {
    const outputFile = path.resolve(required(options.out, "--out"));
    const result = await signC2paDelivery({ masterFile: path.resolve(required(options.video, "--video")), c2paManifestFile: path.resolve(required(options.manifest, "--manifest")), outputFile, receiptFile: options.receipt ? path.resolve(String(options.receipt)) : `${outputFile}.receipt.json`, executable: String(options.executable ?? "c2patool") });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, c2paSigned: true }, null, 2));
  }
}
