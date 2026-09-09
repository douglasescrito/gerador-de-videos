import { withLocalAssetRuntime } from "../local-asset-runtime.mjs";

export async function executar(contexto) {
  const {
    path,
    recipeFromReceipt,
    readVerifiedReceipt,
    required,
    options,
  } = contexto;
  const action = options.action ?? "copy";
  if (!["copy", "prepare", "register"].includes(action)) throw new Error("reuse --action aceita copy, prepare ou register.");
  const allowed = action === "copy" ? ["action", "db", "source-receipt", "asset-context", "policy", "out", "receipt", "role", "help"]
    : action === "prepare" ? ["action", "asset-context", "source-receipt", "role", "root-alias", "scope-id", "classification", "reason", "db", "out", "help"]
    : ["action", "input", "expected-proposal-hash", "confirm-human", "out", "help"];
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error(`--${key} não pertence a reuse --action ${action}.`);
  if (action !== "copy") {
    const { prepareApprovedReuse, registerApprovedReuse, readReusePrivateJson, writeReusePrivateJson } = await import("../../media-pipeline/approved-reuse-registration.mjs");
    const { pathExists } = await import("../../media-pipeline/pipeline-operation.mjs");
    const { resolveKnowledgeExportFile } = await import("../../media-pipeline/knowledge-private-paths.mjs");
    const coreRoot = path.resolve(import.meta.dirname, "../../..");
    const out = await resolveKnowledgeExportFile(required(options.out, "--out"), coreRoot);
    if (await pathExists(out)) throw new Error("Saída privada já existe; informe um novo --out.");
    if (action === "prepare") {
      const context = await readReusePrivateJson(required(options["asset-context"], "--asset-context"), coreRoot);
      const proposal = await prepareApprovedReuse({ context, dbFile: options.db == null ? context.reuse?.dbFile : path.resolve(String(options.db)),
        sourceReceiptFile: path.resolve(required(options["source-receipt"], "--source-receipt")), artifactRole: required(options.role, "--role"),
        rootAlias: required(options["root-alias"], "--root-alias"), scopeId: options["scope-id"] ?? context.rootScopeId, classification: options.classification ?? "restricted", reason: required(options.reason, "--reason"), coreRoot });
      await writeReusePrivateJson(out, proposal, coreRoot);
      console.log(JSON.stringify({ schema: proposal.schema, status: "prepared", authority: "none", proposalFile: out, proposalHash: proposal.hash, rootScopeId: context.rootScopeId, consumer: proposal.source.binding.consumer, rightsProposed: proposal.registration.rights }, null, 2));
    } else {
      if (options["confirm-human"] !== "true") throw new Error("Registro de reuso exige --confirm-human true.");
      const proposal = await readReusePrivateJson(required(options.input, "--input"), coreRoot);
      const result = await registerApprovedReuse({ proposal, expectedProposalHash: required(options["expected-proposal-hash"], "--expected-proposal-hash"), confirmHuman: true, coreRoot });
      await writeReusePrivateJson(out, result.context, coreRoot);
      const { context: _context, ...summary } = result;
      console.log(JSON.stringify({ ...summary, assetContextFile: out }, null, 2));
    }
    return;
  }
  {
    const sourceReceiptFile = path.resolve(required(options["source-receipt"], "--source-receipt"));
    const sourceReceipt = await readVerifiedReceipt(sourceReceiptFile);
    const outputFile = path.resolve(required(options.out, "--out"));
    required(options["asset-context"], "--asset-context");
    const runtime = await withLocalAssetRuntime({}, options);
    if (!runtime.reuseApprovedArtifact) throw new Error("--asset-context exige reuse com índice e candidatos governados.");
    console.log(JSON.stringify(await runtime.reuseApprovedArtifact({ policy: options.policy ?? "prefer-approved", ...(options.db ? { dbFile: path.resolve(String(options.db)) } : {}),
      rootScopeId: runtime.reuseApprovedArtifact.rootScopeId, consumer: sourceReceipt.parameters?.consumer, recipe: recipeFromReceipt(sourceReceipt), outputFile,
      receiptFile: options.receipt ? path.resolve(String(options.receipt)) : `${outputFile}.receipt.json`, artifactRole: required(options.role, "--role") }), null, 2));
  }
}
