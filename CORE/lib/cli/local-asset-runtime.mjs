import { readFile } from "node:fs/promises";
import path from "node:path";

export async function withLocalAssetRuntime(operations, options, { stateFile = null } = {}) {
  let runtime = operations;
  if (options["asset-context"] != null) {
    const context = JSON.parse(await readFile(path.resolve(String(options["asset-context"])), "utf8"));
    const { createLocalAssetRuntime } = await import("../media-pipeline/local-asset-use.mjs");
    const authorizeLocalAssets = await createLocalAssetRuntime(context, { coreRoot: path.resolve(import.meta.dirname, "../..") });
    runtime = { ...operations, authorizeLocalAssets };
    if (context.reuse != null) {
      const { createApprovedReuseRuntime } = await import("../media-pipeline/approved-reuse.mjs");
      runtime.reuseApprovedArtifact = createApprovedReuseRuntime({ context, authorizeLocalAssets });
    }
  }
  if (stateFile != null) {
    const { preflightFilmLocalAssets } = await import("../media-pipeline/film-orchestrator.mjs");
    await preflightFilmLocalAssets({ stateFile, operations: runtime });
  }
  return runtime;
}
