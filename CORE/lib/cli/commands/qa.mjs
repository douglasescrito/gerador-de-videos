export async function executar(contexto) {
  const {
    path,
    runQa,
    required,
    explicitBoolean,
    studioMode,
    options,
  } = contexto;
  {
    studioMode(options, "qa");
    const semantic = explicitBoolean(options.semantic, "--semantic", false);
    if (semantic) throw new Error("QA semântico ainda não possui adapter cookie-only verificável; use o QA técnico local.");
    const result = await runQa({
      videoFile: path.resolve(required(options.video, "--video")),
      outputFile: options.out ? path.resolve(String(options.out)) : undefined,
      receiptFile: options.receipt ? path.resolve(String(options.receipt)) : undefined,
      expectedText: options["expected-text"] ?? null,
      expectedDuration: options["expected-duration"] == null ? null : Number(options["expected-duration"]),
      expectedParts: options["expected-parts"] == null ? null : Number(options["expected-parts"]),
      actualParts: options["actual-parts"] == null ? null : Number(options["actual-parts"]),
      sourceReceipts: options["source-receipt"] ? [path.resolve(String(options["source-receipt"]))] : [],
      direction: options.direction ?? null,
      semantic,
      semanticModel: options["semantic-model"] ?? "gemini-3.5-flash",
      references: (options.images ?? []).map((file) => path.resolve(String(file))),
    });
    console.log(JSON.stringify({ file: result.file, receipt: result.receiptFile, status: result.report.status, warnings: result.report.warnings, suggestedRefineInstruction: result.report.suggestedRefineInstruction }, null, 2));
  }
}
