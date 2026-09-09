export async function executar(contexto) {
  const {
    path,
    buildHybridCompositionManifestFromPilot,
    auditHybridPilotCandidates,
    composeHybridVideo,
    verifyHybridPilotSelection,
    writeJsonAtomic,
    required,
    explicitBoolean,
    readJsonFile,
    options,
  } = contexto;
  {
    if (options["audit-root"] !== undefined) {
      const audit = await auditHybridPilotCandidates({ root: path.resolve(String(options["audit-root"])) });
      if (options["audit-out"]) await writeJsonAtomic(path.resolve(String(options["audit-out"])), audit, { label: "Auditoria de candidatos do piloto híbrido" });
      console.log(JSON.stringify({ ...audit, auditOut: options["audit-out"] ? path.resolve(String(options["audit-out"])) : null }, null, 2));
      return;
    }
    const selection = (await readJsonFile(options.selection, "--selection")).value;
    const readiness = await verifyHybridPilotSelection(selection);
    if (options.readiness) await writeJsonAtomic(path.resolve(String(options.readiness)), readiness, { label: "Readiness do piloto híbrido" });
    if (!readiness.ready) {
      throw new Error(`Piloto híbrido bloqueado: ${readiness.issues.join(", ") || "asset não resolvido"}.`);
    }
    const durationFrames = Number(required(options["duration-frames"], "--duration-frames"));
    const fps = { numerator: Number(options.fps ?? 24), denominator: 1 };
    const manifest = buildHybridCompositionManifestFromPilot({
      selection,
      readiness,
      fps,
      durationFrames,
      overlay: {
        startFrame: Number(options["overlay-start-frame"] ?? 0),
        endFrameExclusive: Number(options["overlay-end-frame"] ?? durationFrames),
        position: { x: Number(options["overlay-x"] ?? 0), y: Number(options["overlay-y"] ?? 0) },
      },
    });
    if (options["out-manifest"]) await writeJsonAtomic(path.resolve(String(options["out-manifest"])), manifest, { label: "Manifesto do piloto híbrido" });
    let composition = null;
    if (explicitBoolean(options.execute, "--execute")) {
      const outputFile = path.resolve(required(options.out, "--out"));
      composition = await composeHybridVideo({ manifest, outputFile, receiptFile: options.receipt ? path.resolve(String(options.receipt)) : `${outputFile}.receipt.json`, metadata: { pilotSelectionFingerprint: selection.fingerprint, pilotReadinessFingerprint: readiness.fingerprint, humanConfirmed: true } });
    }
    console.log(JSON.stringify({ schema: manifest.schema, selectionFingerprint: selection.fingerprint, readinessFingerprint: readiness.fingerprint, manifestFingerprint: manifest.fingerprint, readiness: { ready: readiness.ready, providerCalls: readiness.providerCalls, changed: readiness.changed }, outManifest: options["out-manifest"] ? path.resolve(String(options["out-manifest"])) : null, composition: composition ? { file: composition.file, receipt: composition.receiptFile } : null }, null, 2));
  }
}
