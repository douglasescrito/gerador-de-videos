export async function executar(contexto) {
  const {
    path,
    writeJsonAtomic,
    coreRoot,
    required,
    explicitBoolean,
    readJsonFile,
    options,
  } = contexto;
  {
    // Knowledge Core permanece fora do bootstrap de raw/packs. O perfil diretor
    // só é carregado quando o comando explícito entra nesta superfície.
    const { compileDirectorProduction, defaultKnowledgeDbFile, discoverDirectorProjects, readDirectorContext, registerDirectorProfile, validateDirectorBrief, validateDirectorProduction } = await import("../../media-pipeline/director-profile.mjs");
    const { createCreativeDirectionProposal, materializeCreativeDirection } = await import("../../media-pipeline/creative-direction.mjs");
    const { defaultDesktopCatalogFile, syncDesktopFavoriteEvents } = await import("../../media-pipeline/desktop-favorite-bridge.mjs");
    const action = String(options.action ?? "context").trim().toLowerCase();
    const dbFile = path.resolve(String(options.db ?? defaultKnowledgeDbFile()));
    const preferencesDbFile = path.resolve(String(options["preferences-db"] ?? path.join(coreRoot, ".cache", "archive-index.sqlite")));
    const outputsRoot = path.resolve(String(options["outputs-root"] ?? path.join(coreRoot, "outputs")));
    let result;
    if (action === "sync-preferences") {
      result = syncDesktopFavoriteEvents({
        catalogFile: path.resolve(String(options["desktop-catalog"] ?? defaultDesktopCatalogFile())),
        preferencesDbFile,
      });
    } else if (action === "register") {
      if (!explicitBoolean(options["confirm-human"], "--confirm-human", false)) throw new Error("director --action register exige --confirm-human true.");
      const source = await readJsonFile(options.input, "--input");
      result = registerDirectorProfile({ profile: source.value, dbFile, coreRoot, actor: "local-human" });
    } else if (action === "catalog") {
      const rootScopeId = required(options["root-scope-id"], "--root-scope-id");
      const projects = discoverDirectorProjects({ dbFile, coreRoot, rootScopeId, actor: "local-cli-director-discovery" });
      const preferenceSync = syncDesktopFavoriteEvents({
        catalogFile: path.resolve(String(options["desktop-catalog"] ?? defaultDesktopCatalogFile())),
        preferencesDbFile,
      });
      const directors = [];
      const errors = [];
      for (const project of projects) {
        try {
          directors.push(await readDirectorContext({ ...project, dbFile, coreRoot, preferencesDbFile, outputsRoot }));
        } catch (error) {
          errors.push({ ...project, message: String(error?.message ?? error) });
        }
      }
      result = {
        schema: "mkt-videos/director-catalog@1",
        directors,
        errors,
        preferenceSync,
        boundaries: { providerCalls: 0, generationTriggered: false, automaticPromotion: false },
      };
    } else if (action === "materialize") {
      const proposal = (await readJsonFile(options.input, "--input")).value;
      result = await materializeCreativeDirection({
        proposal,
        expectedProposalHash: required(options["expected-proposal-hash"], "--expected-proposal-hash"),
        confirmHuman: explicitBoolean(options["confirm-human"], "--confirm-human", false),
        productionDir: path.resolve(required(options["production-dir"], "--production-dir")),
        productionId: required(options["production-id"], "--production-id"),
        actor: "local-human",
      });
    } else if (action === "explain") {
      const decision = (await readJsonFile(options.input, "--input")).value;
      if (decision?.schema !== "mkt-videos/creative-direction-decision@1") throw new Error("--input não contém decisão criativa materializada.");
      result = { schema: "mkt-videos/creative-direction-explanation@1", productionId: decision.productionId, variation: decision.variation, fingerprint: decision.fingerprint, preserved: decision.envelope.preserved, planSeed: decision.planSeed, decisionHash: decision.decisionHash, readOnly: true, providerCalls: 0 };
    } else {
      const clientId = required(options.client, "--client");
      const projectId = required(options.project, "--project");
      const preferenceSync = syncDesktopFavoriteEvents({
        catalogFile: path.resolve(String(options["desktop-catalog"] ?? defaultDesktopCatalogFile())),
        preferencesDbFile,
      });
      const context = await readDirectorContext({ clientId, projectId, dbFile, coreRoot, preferencesDbFile, outputsRoot });
      if (action === "context") result = { ...context, preferenceSync };
      else if (action === "propose") {
        const decision = (await readJsonFile(options.input, "--input")).value;
        result = createCreativeDirectionProposal({ context, decision, recentWindow: Number(options["recent-window"] ?? 12) });
      }
      else if (action === "validate" || action === "compile") {
        const brief = (await readJsonFile(options.brief, "--brief")).value;
        const recipe = (await readJsonFile(options.recipe, "--recipe")).value;
        const validatedBrief = validateDirectorBrief(brief, context);
        const creativeDirection = options.direction == null ? null : (await readJsonFile(options.direction, "--direction")).value;
        result = action === "compile"
          ? compileDirectorProduction({ context, brief: validatedBrief, recipe, creativeDirection })
          : validateDirectorProduction({ context, brief: validatedBrief, recipe, creativeDirection });
        if (action === "validate" && !result.valid) process.exitCode = 1;
      } else throw new Error("director --action deve ser register, catalog, context, propose, materialize, explain, validate, compile ou sync-preferences.");
    }
    if (options.out) await writeJsonAtomic(path.resolve(String(options.out)), result, { label: "Resultado do diretor" });
    const format = String(options.format ?? "json").toLowerCase();
    if (format !== "json") throw new Error("--format deve ser json.");
    console.log(JSON.stringify(result, null, 2));
  }
}
