import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { operationFingerprint, readVerifiedReceipt, writeJsonAtomic } from "./pipeline-operation.mjs";
import { recipeFromReceipt } from "./recipe.mjs";
import { createKnowledgeStoreRepository, createScopeGrant } from "./knowledge-store.mjs";
import { createKnowledgeRecordEnvelope } from "./knowledge-governance-envelope.mjs";
import { referenceRightsItemId } from "./knowledge-effective-rights.mjs";
import { inspectReferenceAssetSnapshot } from "./knowledge-reference-inventory.mjs";
import { createLocalAssetRuntime } from "./local-asset-use.mjs";
import { createApprovedReuseRuntime } from "./approved-reuse.mjs";
import { readArchiveReview, setArchiveReview, upsertArchiveReceipt } from "./archive-index.mjs";
import { isPathWithin, resolveKnowledgeExportFile } from "./knowledge-private-paths.mjs";

const SCHEMA = "mkt-videos/approved-reuse-proposal@1";
const ACTOR = "human:cli-reuse";
const RIGHTS = Object.freeze({ inventory: "allowed", localAnalysis: "allowed", textualIndexing: "denied", embedding: "denied", training: "denied", providerInput: "denied", publication: "unknown", reuse: "allowed" });
const hashBody = (body) => ({ ...body, hash: operationFingerprint(body) });
function grantFor(rootScopeId, permissions, now) {
  return createScopeGrant({ rootScopeIds: [rootScopeId], permissions, actor: ACTOR, purpose: "Registrar decisão humana exata de reuso local.", issuedAt: now, expiresAt: new Date(new Date(now).getTime() + 5 * 60 * 1000) });
}

export async function readReusePrivateJson(file, coreRoot) {
  const resolved = await resolveKnowledgeExportFile(file, coreRoot);
  if (resolved.toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("Documento privado não pode usar link ou junction.");
  const info = await lstat(resolved);
  if (!info.isFile() || info.nlink > 1 || info.size > 1024 * 1024) throw new Error("Documento privado exige arquivo regular de até 1 MiB, sem hardlink.");
  return JSON.parse(await readFile(resolved, "utf8"));
}

export async function writeReusePrivateJson(file, value, coreRoot) {
  return writeJsonAtomic(await resolveKnowledgeExportFile(file, coreRoot), value, { label: "Documento privado de reuso" });
}

async function inspectSource(context, source) {
  const root = context.roots[source.rootAlias];
  if (!root) throw new Error("Alias da origem de reuso ausente.");
  const physical = await inspectReferenceAssetSnapshot({ root, logicalPath: source.logicalPath });
  if (physical.fileSha256 !== source.sha256 || physical.bytes !== source.bytes) throw new Error("Bytes da origem mudaram desde a preparação.");
  const receipt = await readVerifiedReceipt(source.receiptFile);
  const recipe = recipeFromReceipt(receipt);
  if (receipt.hash.value !== source.binding.receiptHash || recipe.hash !== source.binding.recipeHash || !isDeepStrictEqual(receipt.parameters?.consumer, source.binding.consumer)) throw new Error("Recibo, receita ou consumidor mudou desde a preparação.");
  const matches = receipt.artifacts.filter((artifact) => artifact.id === source.artifactId && artifact.role === source.binding.artifactRole && artifact.hash?.value === source.sha256 && artifact.bytes === source.bytes && artifact.mimeType === source.mimeType);
  if (matches.length !== 1) throw new Error("Recibo não cobre a origem exata de reuso.");
  return receipt;
}

function registrationIdentity({ context, scopeId, source, registration }) {
  return operationFingerprint({ rootScopeId: context.rootScopeId, scopeId, source, registration });
}

export async function prepareApprovedReuse({ context, dbFile = context?.reuse?.dbFile, sourceReceiptFile, artifactRole, rootAlias, scopeId = context?.rootScopeId, classification = "restricted", reason, coreRoot, clock = () => new Date() }) {
  context = structuredClone(context);
  await createLocalAssetRuntime(context, { coreRoot, clock });
  if (!context.dbFile || !path.isAbsolute(String(dbFile ?? ""))) throw new Error("Preparação exige banco Knowledge e --db absoluto para o índice editorial.");
  if (!String(reason ?? "").trim()) throw new Error("Informe --reason para a decisão revisável.");
  if (!context.roots[rootAlias]) throw new Error("Informe --root-alias declarado no asset-context.");
  const receipt = await readVerifiedReceipt(sourceReceiptFile);
  const artifacts = (receipt.artifacts ?? []).filter((artifact) => artifact.role === artifactRole);
  if (artifacts.length !== 1) throw new Error("--role deve selecionar exatamente um artefato no recibo.");
  const artifact = artifacts[0];
  const consumer = receipt.parameters?.consumer;
  if (!consumer?.id || !consumer?.version || Object.keys(consumer).some((key) => !["id", "version"].includes(key))) throw new Error("Recibo exige consumidor versionado.");
  if (!/^(video|audio|image)\//.test(artifact.mimeType ?? "")) throw new Error("Reuso exige um artefato audiovisual.");
  const absoluteSource = path.resolve(artifact.file);
  if (!isPathWithin(context.roots[rootAlias], absoluteSource)) throw new Error("Artefato não pertence ao alias declarado.");
  const source = { receiptFile: path.resolve(sourceReceiptFile), rootAlias, logicalPath: path.relative(context.roots[rootAlias], absoluteSource).split(path.sep).join("/"),
    sha256: artifact.hash.value, bytes: artifact.bytes, mimeType: artifact.mimeType, mediaKind: artifact.mimeType.split("/")[0], artifactId: artifact.id,
    binding: { schema: "mkt-videos/approved-reuse-binding@1", recipeHash: recipeFromReceipt(receipt).hash, receiptHash: receipt.hash.value, artifactRole, consumer } };
  await inspectSource(context, source);
  const now = clock();
  const repository = createKnowledgeStoreRepository({ dbFile: context.dbFile, coreRoot, clock });
  const grant = grantFor(context.rootScopeId, ["read"], now);
  const scope = repository.getScope({ grant, rootScopeId: context.rootScopeId, scopeId });
  if (!scope) throw new Error("Scope da autorização não existe no root declarado.");
  const registration = { classification, reason: String(reason).trim(), owner: { type: scope.kind, id: scope.id }, rights: RIGHTS, retention: { policy: "manual-review", expiresAt: null, basis: String(reason).trim() } };
  // Valida a proposta de envelope sem persistir nem conceder seus direitos.
  const governance = envelope(registration, source, new Date(now).toISOString(), { proposal: true });
  const config = { ...structuredClone(context), reuse: { dbFile: path.resolve(dbFile), candidates: structuredClone(context.reuse?.candidates ?? []) } };
  createApprovedReuseRuntime({ context: config, authorizeLocalAssets: await createLocalAssetRuntime(config, { coreRoot, clock }) });
  const identity = registrationIdentity({ context: config, scopeId, source, registration });
  const itemId = `reuse_${operationFingerprint({ root: config.rootScopeId, scopeId, binding: source.binding, rootAlias, logicalPath: source.logicalPath }).slice(0, 40)}`;
  const head = repository.getKnowledgeItem({ grant, rootScopeId: context.rootScopeId, id: itemId });
  return hashBody({ schema: SCHEMA, authority: "none", governance, preparedAt: new Date(now).toISOString(), context: config, scopeId, itemId, identity, source, registration,
    expectedHead: head ? { revision: head.revision, contentHash: head.contentHash } : null, editorialReviewHash: readArchiveReview({ dbFile, receiptPath: source.receiptFile }).hash });
}

function envelope(registration, source, createdAt, { proposal = false } = {}) {
  const actor = proposal ? "cli:reuse-proposal" : ACTOR;
  return createKnowledgeRecordEnvelope({ classification: registration.classification, owner: registration.owner,
    provenance: [{ sourceType: proposal ? "receipt-metadata" : "human-attestation", sourceRef: `receipt:${source.binding.receiptHash}`, method: proposal ? "receipt-inspection" : "human-attestation", observedAt: createdAt, contentHash: source.binding.receiptHash }],
    modality: proposal ? "observation" : "hard-constraint", evidenceIds: [], retention: registration.retention, rights: proposal ? { ...registration.rights, reuse: "denied" } : registration.rights, createdAt, createdBy: actor }, { expectedActor: actor });
}

export async function registerApprovedReuse({ proposal, expectedProposalHash, confirmHuman, coreRoot, clock = () => new Date() }) {
  if (confirmHuman !== true) throw new Error("Registro de reuso exige --confirm-human true para aprovar os direitos e o recibo apresentados.");
  const { hash, ...body } = structuredClone(proposal ?? {});
  if (Object.keys(body).some((key) => !["schema", "authority", "governance", "preparedAt", "context", "scopeId", "itemId", "identity", "source", "registration", "expectedHead", "editorialReviewHash"].includes(key))) throw new Error("Proposta de reuso contém campos desconhecidos.");
  if (body.schema !== SCHEMA || body.authority !== "none" || !expectedProposalHash || expectedProposalHash !== hash || hash !== operationFingerprint(body)) throw new Error("Proposta diverge de --expected-proposal-hash.");
  if (!isDeepStrictEqual(body.registration?.rights, RIGHTS) || registrationIdentity(body) !== body.identity) throw new Error("Proposta altera o contrato de autorização local.");
  if (!isDeepStrictEqual(body.governance, envelope(body.registration, body.source, body.preparedAt, { proposal: true }))) throw new Error("Envelope governado da proposta diverge do conteúdo revisável.");
  const { context, source, registration, itemId, scopeId, identity } = body;
  const expectedId = `reuse_${operationFingerprint({ root: context.rootScopeId, scopeId, binding: source.binding, rootAlias: source.rootAlias, logicalPath: source.logicalPath }).slice(0, 40)}`;
  if (itemId !== expectedId) throw new Error("Identidade do asset diverge da origem aprovada.");
  const authorize = await createLocalAssetRuntime(context, { coreRoot, clock });
  createApprovedReuseRuntime({ context, authorizeLocalAssets: authorize });
  if (context.reuse.candidates.filter((entry) => entry.asset.id !== itemId).length >= 256) throw new Error("Contexto de reuso excederia 256 candidatos; nenhum registro foi feito.");
  const receipt = await inspectSource(context, source);
  const now = clock();
  const repository = createKnowledgeStoreRepository({ dbFile: context.dbFile, coreRoot, clock });
  const grant = grantFor(context.rootScopeId, ["read", "write"], now);
  const scope = repository.getScope({ grant, rootScopeId: context.rootScopeId, scopeId });
  if (!scope || scope.id !== registration.owner.id || scope.kind !== registration.owner.type) throw new Error("Owner/scope da proposta diverge do root vigente.");
  const payload = { schema: "mkt-videos/entity-profile@1", entityType: "reference-asset", name: `Reuso ${source.binding.artifactRole}`, aliases: [], evidenceRefs: [],
    attributes: { rootAlias: source.rootAlias, logicalPath: source.logicalPath, fileSha256: source.sha256, bytes: source.bytes, mediaType: source.mimeType, approvedReuse: source.binding, registrationFingerprint: identity } };
  let target = repository.getKnowledgeItem({ grant, rootScopeId: context.rootScopeId, id: itemId });
  const tag = `reuse-registration:${identity}`;
  const review = readArchiveReview({ dbFile: context.reuse.dbFile, receiptPath: source.receiptFile });
  const alreadyReviewed = review.review?.status === "approved" && review.review.receipt_id === receipt.id && JSON.parse(review.review.tags).includes(tag);
  if (!alreadyReviewed && review.hash !== body.editorialReviewHash) throw new Error("A revisão editorial mudou desde a preparação; prepare uma nova decisão.");
  if (target) {
    if (target.status !== "active" || target.scopeId !== scopeId || !isDeepStrictEqual(target.payload, payload) || (!body.expectedHead && target.revision !== 1) ||
        !["classification", "owner", "retention", "rights"].every((key) => isDeepStrictEqual(target.governance[key], registration[key])) ||
        (body.expectedHead && (target.revision !== body.expectedHead.revision || target.contentHash !== body.expectedHead.contentHash))) throw new Error("O item de reuso já existe com decisão divergente; revisão humana necessária.");
  } else {
    if (body.expectedHead) throw new Error("O item observado na preparação não existe mais.");
    const createdAt = new Date(now).toISOString();
    const governance = envelope(registration, source, createdAt);
    const common = { schema: "mkt-videos/knowledge-item@1", revision: 1, rootScopeId: context.rootScopeId, scopeId, schemaVersion: 1, status: "active", governance, supersedesRevision: null, createdAt, createdBy: ACTOR };
    const targetBody = { ...common, id: itemId, recordType: "entity", schemaId: payload.schema, payload };
    target = { ...targetBody, contentHash: operationFingerprint(targetBody) };
    const rightsBody = { ...common, id: referenceRightsItemId(target), recordType: "rights", schemaId: "mkt-videos/rights-record@1", payload: {
      schema: "mkt-videos/rights-record@1", targetRef: { schema: "mkt-videos/knowledge-reference@1", kind: "item", rootScopeId: context.rootScopeId, id: target.id, revision: target.revision, recordType: target.recordType, contentHash: target.contentHash },
      permissions: registration.rights, basis: registration.reason, validFrom: createdAt, expiresAt: null, evidenceRefs: [] } };
    repository.appendKnowledgeItemsAtomic({ grant, items: [target, { ...rightsBody, contentHash: operationFingerprint(rightsBody) }] });
  }
  const asset = { id: target.id, mediaKind: source.mediaKind, role: source.binding.artifactRole, source: { kind: "knowledge-core", locator: target.id }, sha256: source.sha256, bytes: source.bytes, mimeType: source.mimeType,
    rights: { providerInput: "denied", reuse: "allowed" }, authorization: { mode: "scope-grant", bindingHash: target.contentHash } };
  await authorize({ rootScopeId: context.rootScopeId, assets: [asset], reuseBinding: source.binding });
  // O índice é uma projeção separada. Uma falha aqui preserva o registro
  // atômico e pode retomar a mesma proposta; nunca reaplica direitos revogados.
  try {
    await inspectSource(context, source);
    await upsertArchiveReceipt({ root: context.roots[source.rootAlias], dbFile: context.reuse.dbFile, receiptFile: source.receiptFile, preserveRoot: true });
    if (!alreadyReviewed) setArchiveReview({ dbFile: context.reuse.dbFile, receiptPath: source.receiptFile, receiptId: receipt.id, status: "approved", tags: [tag], notes: registration.reason, expectedReviewHash: body.editorialReviewHash });
    await authorize({ rootScopeId: context.rootScopeId, assets: [asset], reuseBinding: source.binding });
    await inspectSource(context, source);
    const finalReview = readArchiveReview({ dbFile: context.reuse.dbFile, receiptPath: source.receiptFile }).review;
    if (finalReview?.status !== "approved" || finalReview.receipt_id !== receipt.id || !JSON.parse(finalReview.tags).includes(tag)) throw new Error("Revisão editorial mudou antes da conclusão.");
  } catch (error) {
    throw new Error(`Registro Knowledge preservado; conclusão editorial pendente para ${itemId}. Retome a mesma proposta após resolver a causa: ${error.message}`, { cause: error });
  }
  const candidate = { receiptFile: source.receiptFile, asset, binding: source.binding };
  const resultContext = { ...context, reuse: { ...context.reuse, candidates: [...context.reuse.candidates.filter((entry) => entry.asset.id !== asset.id), candidate] } };
  createApprovedReuseRuntime({ context: resultContext, authorizeLocalAssets: authorize });
  return { schema: "mkt-videos/approved-reuse-registration@1", status: "registered", proposalHash: hash, rootScopeId: context.rootScopeId, itemId: target.id, itemHash: target.contentHash, context: resultContext };
}
