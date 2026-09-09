import { withLocalAssetRuntime } from "../local-asset-runtime.mjs";
import { createCliResultWriter } from "../result-output.mjs";

export async function executar(contexto) {
  const {
    path,
    loadFilmSpec,
    resumeFilm,
    runFilm,
    statusFilm,
    createCliResourceBroker,
    required,
    cookieRuntime,
    explicitBoolean,
    planStudioFilm,
    assertStatePaidAuthorization,
    options,
  } = contexto;
  const writeResult = createCliResultWriter({ command: "run", format: options["output-format"] });
  {
    if (options.spec && options.state) throw new Error("Use somente --spec ou --state em run.");
    const allowConceptPilot = explicitBoolean(options["confirm-concept-pilot"], "--confirm-concept-pilot", false);
    let stateFile = options.state ? path.resolve(String(options.state)) : null;
    if (!stateFile) {
      const specFile = path.resolve(required(options.spec, "--spec"));
      const spec = await loadFilmSpec(specFile, options);
      const planned = await planStudioFilm({ spec, specFile, options });
      stateFile = planned.state.stateFile;
    }
    await assertStatePaidAuthorization(stateFile, options);
    const localOperations = await withLocalAssetRuntime({}, options, { stateFile });
    const runtime = await cookieRuntime(options);
    const operations = { ...runtime.operations, ...localOperations };
    const resourceBroker = createCliResourceBroker();
    const result = await runFilm({
      stateFile,
      confirmFingerprint: options["confirm-fingerprint"] ?? null,
      allowConceptPilot,
      authorizationSource: "cli",
      authorizationActor: "local-cli-production",
      operations,
      resourceBroker,
    });
    const autonomousCompletion = result.spec.workflow?.completionMode === "complete"
      || (result.spec.workflow?.authorizationMode === "production-once" && result.spec.workflow?.humanReview === false);
    if (autonomousCompletion) {
      await resumeFilm({
        stateFile,
        confirmFingerprint: options["confirm-fingerprint"] ?? null,
        allowConceptPilot,
        autoApprove: true,
        authorizationSource: "cli",
        authorizationActor: "local-cli-production",
        operations,
        resourceBroker,
      });
    }
    writeResult(await statusFilm({ stateFile: result.state.stateFile }));
  }
}
