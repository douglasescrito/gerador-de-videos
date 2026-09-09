import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export function localSfxAssets(spec) {
  const audio = spec?.finishing?.audio;
  const cues = audio?.sfx?.cues ?? [];
  if (!Array.isArray(cues)) throw new Error("sfx.cues deve ser uma lista.");
  if (!cues.length) return [];
  if (!spec.source?.scope?.rootScopeId) throw new Error("SFX exige root congelado no plano canônico.");
  if (audio.sfx.module !== "local-sfx@1" || !Number.isFinite(audio.sfxGainDb) || audio.sfxGainDb < -96 || audio.sfxGainDb > 12) throw new Error("SFX exige local-sfx@1 e sfxGainDb entre -96 e 12.");
  const assets = [];
  const ids = new Set();
  for (const cue of cues) {
    if (!cue.id || ids.has(cue.id) || !Number.isSafeInteger(cue.atFrame) || cue.atFrame < 0 || !Number.isFinite(cue.gainDb) || cue.gainDb < -96 || cue.gainDb > 12) throw new Error("Cue SFX inválido: ID único, frame não negativo e ganho entre -96 e 12 são obrigatórios.");
    ids.add(cue.id);
    const matches = (spec.resources ?? []).filter((asset) => asset.id === cue.assetId);
    const asset = matches[0];
    if (matches.length !== 1 || asset.mediaKind !== "audio" || asset.role !== "sfx" || !asset.mimeType?.startsWith("audio/")) throw new Error("Cue SFX exige um único asset de áudio com role sfx.");
    if (asset.source?.kind !== "knowledge-core" || !asset.source.locator || asset.authorization?.mode !== "scope-grant" || !/^[a-f0-9]{64}$/.test(asset.authorization.bindingHash ?? "")) throw new Error("local-sfx-authorization-required: SFX exige asset knowledge-core e binding scope-grant.");
    if (asset.rights?.reuse !== "allowed" || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) throw new Error("SFX exige reuso permitido, SHA-256 e bytes congelados.");
    if (!assets.includes(asset)) assets.push(asset);
  }
  return assets;
}

/** Leitura vigente do mesmo repository; não promove itens nem persiste índice. */
export function localPostProductionAssets(spec) {
  const ids = [...new Set((spec?.finishing?.postProduction?.operations ?? []).filter(op => op.operation === "logo-overlay@1").map(op => op.assetId))];
  if (ids.length && !spec.source?.scope?.rootScopeId) throw new Error("Logo exige root congelado no plano canônico.");
  return ids.map(id => {
    const matches = (spec.resources ?? []).filter(asset => asset.id === id);
    const asset = matches[0];
    if (matches.length !== 1 || asset.mediaKind !== "image" || asset.role !== "logo" || !asset.mimeType?.startsWith("image/")) throw new Error("Logo exige um único asset image/logo.");
    if (asset.source?.kind !== "knowledge-core" || !asset.source.locator || asset.authorization?.mode !== "scope-grant" || !/^[a-f0-9]{64}$/.test(asset.authorization.bindingHash ?? "")) throw new Error("Logo exige asset knowledge-core e binding scope-grant.");
    if (asset.rights?.reuse !== "allowed" || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) throw new Error("Logo exige reuso permitido, SHA-256 e bytes congelados.");
    return asset;
  });
}

export function localHtmlAssets(spec) {
  const ids = [...new Set((spec?.scenes ?? []).filter(scene => scene.graphics?.renderer === "html-canvas@1").map(scene => scene.graphics.documentAssetId))];
  if (ids.length && !spec.source?.scope?.rootScopeId) throw new Error("HTML exige root congelado no plano canônico.");
  return ids.map(id => {
    const matches = (spec.resources ?? []).filter(asset => asset.id === id);
    const asset = matches[0];
    if (matches.length !== 1 || asset.mediaKind !== "document" || asset.role !== "graphics-document" || asset.mimeType !== "text/html") throw new Error("HTML exige um único asset document/graphics-document de MIME text/html.");
    if (asset.source?.kind !== "knowledge-core" || !asset.source.locator || asset.authorization?.mode !== "scope-grant" || !/^[a-f0-9]{64}$/.test(asset.authorization.bindingHash ?? "")) throw new Error("HTML exige asset knowledge-core e binding scope-grant.");
    if (asset.rights?.reuse !== "allowed" || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) throw new Error("HTML exige reuso permitido, SHA-256 e bytes congelados.");
    return asset;
  });
}

/** Leitura vigente do mesmo repository; não promove itens nem persiste índice. */
export async function authorizeStoredLocalAssets({ repository, grant, rootScopeId, assets, rootResolver, reuseBinding = null }) {
  if (!Array.isArray(assets)) throw new Error("assets deve ser uma lista.");
  if (typeof rootResolver !== "function") throw new Error("rootResolver deve ser uma função.");
  if (grant?.rootScopeIds?.length !== 1 || grant.rootScopeIds[0] !== rootScopeId) throw new Error("Reuso local exige ScopeGrant dedicado ao root da produção.");
  const [{ assertEffectiveRightAllowed }, { inspectReferenceAssetSnapshot }] = await Promise.all([
    import("./knowledge-effective-rights.mjs"), import("./knowledge-reference-inventory.mjs"),
  ]);
  const resolve = (asset) => {
    if (asset.source?.kind !== "knowledge-core" || asset.authorization?.mode !== "scope-grant") throw new Error("SFX externo exige source knowledge-core e autorização scope-grant.");
    if (asset.rights?.reuse !== "allowed") throw new Error("A receita não permite reuso desse asset.");
    const resolved = repository.resolveReferenceAssetEffectiveRights({ grant, rootScopeId, referenceAssetId: asset.source.locator });
    const target = resolved.targetItem;
    if (target.rootScopeId !== rootScopeId || target.contentHash !== asset.authorization.bindingHash) throw new Error("Asset governado diverge do root ou binding congelado na receita.");
    if (reuseBinding != null && !isDeepStrictEqual(target.payload.attributes.approvedReuse, reuseBinding)) throw new Error("Registro governado não aprova esse recibo, receita, papel e versão do consumidor.");
    for (const right of ["localAnalysis", "reuse"]) assertEffectiveRightAllowed({ effectiveRights: resolved.effectiveRights, right });
    return resolved;
  };
  const result = [];
  for (const asset of assets) {
    const resolved = resolve(asset);
    const attributes = resolved.targetItem.payload.attributes;
    const root = await rootResolver(attributes.rootAlias);
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Alias do asset exige raiz local absoluta.");
    const physical = await inspectReferenceAssetSnapshot({ root, logicalPath: attributes.logicalPath });
    if (physical.fileSha256 !== asset.sha256 || physical.fileSha256 !== attributes.fileSha256 || physical.bytes !== asset.bytes || physical.bytes !== attributes.bytes || attributes.mediaType !== asset.mimeType) throw new Error("Bytes ou MIME do asset divergem da receita e do registro governado.");
    const refreshed = resolve(asset);
    result.push({ assetId: asset.id, file: path.resolve(root, ...attributes.logicalPath.split("/")),
      evidence: { rootScopeId, itemId: refreshed.targetItem.id, itemHash: refreshed.targetItem.contentHash, rightsHash: refreshed.effectiveRights.decisionHash,
        grantHash: grant.hash, sha256: physical.fileSha256, bytes: physical.bytes } });
  }
  // Um asset pode ser revogado enquanto outro é inspecionado.
  for (const asset of assets) resolve(asset);
  return result;
}

export async function createLocalAssetRuntime(context, { coreRoot, clock = () => new Date() } = {}) {
  if (!context || context.schema !== "mkt-videos/local-asset-context@1" || typeof context.rootScopeId !== "string" || !context.rootScopeId.trim() || !context.roots || typeof context.roots !== "object" || Array.isArray(context.roots) ||
      Object.keys(context).some((key) => !["schema", "rootScopeId", "dbFile", "roots", "reuse"].includes(key))) throw new Error("--asset-context exige local-asset-context@1 com rootScopeId e roots.");
  for (const root of Object.values(context.roots)) if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("roots deve mapear aliases para caminhos absolutos.");
  if (context.dbFile != null && (typeof context.dbFile !== "string" || !path.isAbsolute(context.dbFile))) throw new Error("dbFile deve ser absoluto.");
  const configuration = structuredClone(context);
  const { createKnowledgeStoreRepository, createScopeGrant } = await import("./knowledge-store.mjs");
  const repository = createKnowledgeStoreRepository({ dbFile: configuration.dbFile ?? null, coreRoot, clock });
  return async ({ rootScopeId, assets, reuseBinding = null }) => {
    if (rootScopeId !== configuration.rootScopeId) throw new Error("--asset-context diverge do root da produção.");
    const now = clock();
    const grant = createScopeGrant({ rootScopeIds: [rootScopeId], permissions: ["read"], actor: "local-cli-production", purpose: "Revalidar análise local e reuso dos assets congelados na produção.", issuedAt: now, expiresAt: new Date(new Date(now).getTime() + 5 * 60 * 1000) });
    return authorizeStoredLocalAssets({ repository, grant, rootScopeId, assets, reuseBinding, rootResolver: (alias) => Object.hasOwn(configuration.roots, alias) ? configuration.roots[alias] : null });
  };
}
