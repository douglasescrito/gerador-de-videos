export async function executar(contexto) {
  const {
    MUSIC_PRESETS,
    assertStyleEvidenceReconciliation,
    buildStyleEvidenceReconciliationReport,
    listStyleSpecs,
    renderStyleCatalogMarkdown,
    explicitBoolean,
    officialDocs,
    options,
  } = contexto;
  {
    const includeConcepts = explicitBoolean(options["include-concepts"], "--include-concepts", false);
    let styles = listStyleSpecs({ includeConcepts, includeDeprecated: true });
    if (options.family != null) styles = styles.filter((style) => style.family === String(options.family));
    if (options.status != null) styles = styles.filter((style) => style.status === String(options.status));
    const format = String(options.format ?? "json").toLowerCase();
    if (format === "markdown") console.log(renderStyleCatalogMarkdown({ styles }));
    else if (format === "json") {
      const evidenceReconciliation = assertStyleEvidenceReconciliation(
        buildStyleEvidenceReconciliationReport({ styles }),
      );
      console.log(JSON.stringify({
        schema: "mkt-videos/style-catalog@1",
        styles,
        evidenceReconciliation,
        musicPresets: MUSIC_PRESETS,
        musicBackends: officialDocs.musicBackends,
      }, null, 2));
    }
    else throw new Error("--format deve ser json ou markdown.");
  }
}
