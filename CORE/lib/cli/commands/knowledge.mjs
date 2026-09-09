export async function executar(contexto) {
  const {
    path,
    coreRoot,
    explicitBoolean,
    options,
  } = contexto;
  {
    const knowledgeAction = String(options.action ?? "status")
      .trim()
      .toLowerCase();
    let result;
    if (knowledgeAction === "packs") {
      const { runKnowledgeDomainPackAction } = await import(
        "../../media-pipeline/knowledge-domain-pack-action.mjs"
      );
      result = await runKnowledgeDomainPackAction({
        action: knowledgeAction,
        coreRoot,
      });
    } else {
      const { runKnowledgeAction } = await import(
        "../../media-pipeline/knowledge-service.mjs"
      );
      result = await runKnowledgeAction({
        action: knowledgeAction,
        dbFile: options.db ? path.resolve(String(options.db)) : null,
        rootScopeId: options["root-scope-id"] ?? null,
        scopeId: options["scope-id"] ?? null,
        releaseId: options["release-id"] ?? null,
        outputFile: options.out ? path.resolve(String(options.out)) : null,
        backupFile: options.backup ? path.resolve(String(options.backup)) : null,
        classification: options.classification ?? null,
        assetRootDirectory: options["asset-root"]
          ? path.resolve(String(options["asset-root"]))
          : null,
        expectedActivationId: options["expected-activation-id"],
        itemId: options["item-id"] ?? null,
        operation: options.operation ?? null,
        expectedRevision: options["expected-revision"],
        expectedContentHash: options["expected-content-hash"] ?? null,
        evidenceIds: options["evidence-ids"] ?? null,
        inputFile: options.input ? path.resolve(String(options.input)) : null,
        limit: options.limit === undefined ? 5 : Number(options.limit),
        reason: options.reason ?? null,
        confirmHuman: options["confirm-human"] === undefined
          ? null
          : explicitBoolean(
              options["confirm-human"],
              "--confirm-human",
            ),
        coreRoot,
        actor: "local-cli",
      });
    }
    if (result.status === "fail") process.exitCode = 1;
    console.log(JSON.stringify(result, null, 2));
  }
}
