import { createCliResultWriter } from "../result-output.mjs";

export async function executar(contexto) {
  const {
    path,
    statusFilm,
    required,
    explicitBoolean,
    options,
  } = contexto;
  const writeResult = createCliResultWriter({ command: "status", format: options["output-format"] });
  {
    if (explicitBoolean(options.handoff, "--handoff", false)) {
      const { productionHandoff } = await import("../../media-pipeline/production-handoff.mjs");
      writeResult(await productionHandoff({ stateFile: options.state, receiptFile: options.receipt }));
    } else {
      if (options.receipt) throw new Error("--receipt exige --handoff true.");
      writeResult(await statusFilm({ stateFile: path.resolve(required(options.state, "--state")) }));
    }
  }
}
