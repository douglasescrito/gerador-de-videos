import path from "node:path";

// Os handlers continuam únicos. Carregamos somente o contexto de que cada
// consulta precisa, depois da validação e do caminho de ajuda do bootstrap.
export async function loadCommandContext(bootstrap) {
  const { command } = bootstrap;
  if (command === "help" || command === "commands") return bootstrap;
  const coreRoot = path.resolve(import.meta.dirname, "../..");
  if (command === 'text') return { ...bootstrap, path, coreRoot };
  if (command === "render") return { ...bootstrap, path, coreRoot };
  if (command === "knowledge") return { ...bootstrap, path, coreRoot };
  if (command === "docs" || command === "capabilities") {
    const [{ buildEffectiveCapabilityMap }, { createCliReferenceDocs }] = await Promise.all([
      import("../media-pipeline/provider-registry.mjs"),
      import("./reference-docs.mjs"),
    ]);
    return { ...bootstrap, path, buildEffectiveCapabilityMap, officialDocs: createCliReferenceDocs() };
  }
  if (command === "tecnicas") return { ...bootstrap, path, coreRoot };
  if (command === "voices") {
    const { googleVidsVoiceCatalog } = await import("../media-pipeline/google-vids-voices.mjs");
    return { ...bootstrap, googleVidsVoiceCatalog };
  }
  if (command === "styles") {
    const [styles, catalog, evidence, music, reference] = await Promise.all([
      import("../media-pipeline/direction-presets.mjs"),
      import("../media-pipeline/style-catalog.mjs"),
      import("../media-pipeline/style-evidence-reconciliation.mjs"),
      import("../media-pipeline/flow-music.mjs"),
      import("./reference-docs.mjs"),
    ]);
    return { ...bootstrap, listStyleSpecs: styles.listStyleSpecs, renderStyleCatalogMarkdown: catalog.renderStyleCatalogMarkdown,
      assertStyleEvidenceReconciliation: evidence.assertStyleEvidenceReconciliation, buildStyleEvidenceReconciliationReport: evidence.buildStyleEvidenceReconciliationReport,
      MUSIC_PRESETS: music.MUSIC_PRESETS, officialDocs: reference.createCliReferenceDocs() };
  }
  if (command === "recipe") {
    const { selectRecipeInput } = await import("./recipe-input.mjs");
    selectRecipeInput(bootstrap.parse(bootstrap.args));
    const { handleRecipeCommand } = await import("./recipe-command-handler.mjs");
    return { ...bootstrap, handleRecipeCommand };
  }
  if (command === "receitas") {
    const [{ mkdir, readFile }, { discoverRecipeFiles }] = await Promise.all([
      import("node:fs/promises"),
      import("../media-pipeline/recipe-shelf.mjs"),
    ]);
    return { ...bootstrap, path, coreRoot, mkdir, readFile, discoverRecipeFiles };
  }
  const { createCliContext } = await import("./context.mjs");
  return createCliContext([command, ...bootstrap.args]);
}
