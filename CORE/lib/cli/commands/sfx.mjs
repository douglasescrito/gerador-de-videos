export async function executar(contexto) {
  const {
    args,
    studioMode,
    readJsonFile,
    options,
  } = contexto;
  {
    studioMode(options, "sfx");
    const { compileSfxBed } = await import("../../media-pipeline/sfx-compiler.mjs");
    const cuesJson = await readJsonFile(options.cues, "--cues");
    const result = await compileSfxBed(cuesJson.value, { out: options.out, mode: options.mode, receipt: options.receipt });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, args: result.args }, null, 2));
  }
}
