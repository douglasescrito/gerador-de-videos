import { withLocalAssetRuntime } from "../local-asset-runtime.mjs";
import { createCliResultWriter } from "../result-output.mjs";
import { readFile } from "node:fs/promises";

export async function executar(contexto) {
  const {
    path,
    resumeFilm,
    statusFilm,
    createCliResourceBroker,
    required,
    cookieRuntime,
    explicitBoolean,
    assertStatePaidAuthorization,
    options,
  } = contexto;
  const writeResult = createCliResultWriter({ command: "resume", format: options["output-format"] });
  {
    const stateFile = path.resolve(required(options.state, "--state"));
    const allowConceptPilot = explicitBoolean(options["confirm-concept-pilot"], "--confirm-concept-pilot", false);
    const autoApprove = explicitBoolean(options["auto-approve"], "--auto-approve", false);
    const skipSceneQa = explicitBoolean(options["sem-qa"], "--sem-qa", false);
    const confirmHumanRetry = explicitBoolean(options["confirm-human"], "--confirm-human", false);
    const humanRetryDecision = options["retry-decision"]
      ? JSON.parse(await readFile(path.resolve(String(options["retry-decision"])), "utf8"))
      : null;
    if (confirmHumanRetry && !humanRetryDecision) throw new Error("--confirm-human exige --retry-decision nesta retomada.");
    await assertStatePaidAuthorization(stateFile, options);
    const localOperations = await withLocalAssetRuntime({}, options, { stateFile });
    const runtime = await cookieRuntime(options);
    const operations = { ...runtime.operations, ...localOperations };
    const resourceBroker = createCliResourceBroker();
    await resumeFilm({
      stateFile,
      confirmFingerprint: options["confirm-fingerprint"] ?? null,
      allowConceptPilot,
      autoApprove,
      skipSceneQa,
      authorizationSource: "cli",
      authorizationActor: "local-cli-production",
      operations,
      resourceBroker,
      humanRetryDecision,
      confirmHumanRetry,
    });
    writeResult(await statusFilm({ stateFile }));
  }
}
