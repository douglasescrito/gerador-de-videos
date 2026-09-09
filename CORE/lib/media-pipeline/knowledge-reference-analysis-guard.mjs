import path from "node:path";
import {
  assertEffectiveRightAllowed,
  resolveEffectiveRights,
} from "./knowledge-effective-rights.mjs";
import {
  inspectReferenceAssetSnapshot,
} from "./knowledge-reference-inventory.mjs";

function requiredText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    throw new Error(`${label} é obrigatório.`);
  }
  return normalized;
}

function assertLocalAdapter(adapter) {
  if (
    adapter == null
    || typeof adapter !== "object"
    || adapter.kind !== "local-deterministic"
    || adapter.providerFree !== true
    || typeof adapter.analyze !== "function"
  ) {
    throw new Error(
      "Análise exige adapter local-deterministic explicitamente provider-free.",
    );
  }
  return adapter;
}

function targetLocation(targetItem) {
  const attributes = targetItem?.payload?.attributes;
  const rootAlias = requiredText(attributes?.rootAlias, "rootAlias");
  const logicalPath = requiredText(attributes?.logicalPath, "logicalPath");
  const fileSha256 = requiredText(
    attributes?.fileSha256,
    "fileSha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(fileSha256)) {
    throw new Error("fileSha256 do reference-asset é inválido.");
  }
  const bytes = Number(attributes?.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("bytes do reference-asset é inválido.");
  }
  return {
    rootAlias,
    logicalPath,
    fileSha256,
    bytes,
  };
}

function assertSameReferenceAssetHead(initialTarget, refreshedTarget) {
  if (
    refreshedTarget?.rootScopeId !== initialTarget.rootScopeId
    || refreshedTarget?.id !== initialTarget.id
    || refreshedTarget?.revision !== initialTarget.revision
    || refreshedTarget?.contentHash !== initialTarget.contentHash
  ) {
    throw new Error(
      "Reference asset mudou durante a análise; execução bloqueada.",
    );
  }
}

async function executeResolvedReferenceAnalysis({
  targetItem,
  effectiveRights,
  rootResolver,
  adapter,
  refreshAuthorization = null,
} = {}) {
  assertEffectiveRightAllowed({
    effectiveRights,
    right: "localAnalysis",
  });
  const localAdapter = assertLocalAdapter(adapter);
  if (typeof rootResolver !== "function") {
    throw new Error("rootResolver é obrigatório.");
  }
  const location = targetLocation(targetItem);
  const root = await rootResolver(location.rootAlias);
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("rootResolver deve retornar caminho absoluto.");
  }
  const snapshot = await inspectReferenceAssetSnapshot({
    root,
    logicalPath: location.logicalPath,
  });
  if (
    snapshot.fileSha256 !== location.fileSha256
    || snapshot.bytes !== location.bytes
  ) {
    throw new Error(
      "Asset físico diverge do reference-asset aprovado; análise bloqueada.",
    );
  }
  const absoluteFile = path.resolve(
    root,
    ...location.logicalPath.split("/"),
  );
  const target = Object.freeze({
    rootScopeId: targetItem.rootScopeId,
    id: targetItem.id,
    revision: targetItem.revision,
    contentHash: targetItem.contentHash,
  });
  let activeEffectiveRights = effectiveRights;
  if (refreshAuthorization != null) {
    if (typeof refreshAuthorization !== "function") {
      throw new Error("refreshAuthorization deve ser uma função.");
    }
    const refreshed = refreshAuthorization();
    assertSameReferenceAssetHead(targetItem, refreshed?.targetItem);
    assertEffectiveRightAllowed({
      effectiveRights: refreshed?.effectiveRights,
      right: "localAnalysis",
    });
    activeEffectiveRights = refreshed.effectiveRights;
  }
  const result = await localAdapter.analyze({
    file: absoluteFile,
    target,
    effectiveRights: activeEffectiveRights,
  });
  return Object.freeze({
    providerFree: true,
    target,
    physicalSnapshot: snapshot,
    effectiveRights: activeEffectiveRights,
    result,
  });
}

export async function executeStoredReferenceAnalysis({
  repository,
  grant,
  rootScopeId,
  referenceAssetId,
  rootResolver,
  adapter,
} = {}) {
  if (
    repository == null
    || typeof repository.resolveReferenceAssetEffectiveRights !== "function"
  ) {
    throw new Error(
      "repository com resolveReferenceAssetEffectiveRights é obrigatório.",
    );
  }
  const {
    targetItem,
    effectiveRights,
  } = repository.resolveReferenceAssetEffectiveRights({
    grant,
    rootScopeId,
    referenceAssetId,
  });
  return executeResolvedReferenceAnalysis({
    targetItem,
    effectiveRights,
    rootResolver,
    adapter,
    refreshAuthorization: () =>
      repository.resolveReferenceAssetEffectiveRights({
        grant,
        rootScopeId,
        referenceAssetId,
      }),
  });
}

/**
 * Superfície de snapshot para testes provider-free. O runtime deve usar
 * executeStoredReferenceAnalysis, que resolve target e rights head no
 * repositório autoritativo dentro do mesmo snapshot de leitura.
 *
 * @deprecated Snapshot/test-only; não usar como autoridade de runtime.
 */
export async function executeGovernedReferenceAnalysis({
  targetItem,
  rightsItems = [],
  rootResolver,
  adapter,
  at = new Date(),
} = {}) {
  const effectiveRights = resolveEffectiveRights({
    targetItem,
    rightsItems,
    at,
  });
  return executeResolvedReferenceAnalysis({
    targetItem,
    effectiveRights,
    rootResolver,
    adapter,
  });
}
