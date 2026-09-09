import { createCliResultWriter } from "../result-output.mjs";

export async function executar(contexto) {
  const {
    path,
    listFilmJobs,
    coreRoot,
    runtimeDbFile,
    options,
  } = contexto;
  const writeResult = createCliResultWriter({ command: "jobs", format: options["output-format"] });
  {
    writeResult(await listFilmJobs({ root: path.resolve(String(options.root ?? path.join(coreRoot, "outputs"))), runtimeDb: path.resolve(String(options["runtime-db"] ?? runtimeDbFile)) }));
  }
}
