import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createKnowledgeStoreRepository, createScopeGrant, initializeKnowledgeStore } from "../../lib/media-pipeline/knowledge-store.mjs";
import { createKnowledgeRecordEnvelope } from "../../lib/media-pipeline/knowledge-governance-envelope.mjs";
import { referenceRightsItemId } from "../../lib/media-pipeline/knowledge-effective-rights.mjs";

// Banco e mídia pertencem exclusivamente ao diretório temporário do teste.
export const governedSfxFixture = governedLocalAssetFixture;

export async function governedLocalAssetFixture({ root, file, rootScopeId = "client:teste", reuse = "allowed", mediaType = "audio/wav", mediaKind = "audio", role = "sfx", approvedReuse = null }) {
  const now = new Date();
  const createdAt = now.toISOString();
  const coreRoot = path.join(root, "workspace", "CORE");
  const dbFile = path.join(root, "private", "knowledge.sqlite");
  await Promise.all([mkdir(coreRoot, { recursive: true }), mkdir(path.dirname(dbFile), { recursive: true })]);
  initializeKnowledgeStore({ dbFile, coreRoot });
  const repository = createKnowledgeStoreRepository({ dbFile, coreRoot });
  const grant = createScopeGrant({ rootScopeIds: [rootScopeId], permissions: ["read", "write"], actor: "human:test", purpose: "Fixture de reuso SFX", issuedAt: now });
  repository.createScope({ grant, scope: { id: rootScopeId, rootScopeId, parentScopeId: null, kind: "client", name: "Fixture", createdAt } });
  const rights = { inventory: "allowed", localAnalysis: "allowed", textualIndexing: "unknown", embedding: "denied", training: "denied", providerInput: "denied", publication: "unknown", reuse };
  const envelope = () => createKnowledgeRecordEnvelope({ classification: "confidential", owner: { type: "client", id: rootScopeId },
    provenance: [{ sourceType: "human-attestation", sourceRef: "fixture:sfx", method: "human-attestation", observedAt: createdAt, contentHash: "a".repeat(64) }],
    modality: "hard-constraint", evidenceIds: [], retention: { policy: "manual-review", expiresAt: null, basis: "Fixture isolada." },
    rights, createdAt, createdBy: "human:test" }, { expectedActor: "human:test" });
  const content = await readFile(file);
  const fileSha256 = createHash("sha256").update(content).digest("hex");
  const common = { schema: "mkt-videos/knowledge-item@1", revision: 1, rootScopeId, scopeId: rootScopeId, schemaVersion: 1, status: "active", supersedesRevision: null, createdAt, createdBy: "human:test" };
  const target = repository.appendKnowledgeItem({ grant, item: { ...common, id: "reference:effect", recordType: "entity", schemaId: "mkt-videos/entity-profile@1", governance: envelope(),
    payload: { schema: "mkt-videos/entity-profile@1", entityType: "reference-asset", name: "Effect", aliases: [],
      attributes: { rootAlias: "sfx", logicalPath: path.basename(file), fileSha256, bytes: content.length, mediaType, ...(approvedReuse ? { approvedReuse } : {}) }, evidenceRefs: [] } } });
  let rightsHead = repository.appendKnowledgeItem({ grant, item: { ...common, id: referenceRightsItemId(target), recordType: "rights", schemaId: "mkt-videos/rights-record@1", governance: envelope(),
    payload: { schema: "mkt-videos/rights-record@1", targetRef: { schema: "mkt-videos/knowledge-reference@1", kind: "item", rootScopeId, id: target.id, revision: target.revision, recordType: target.recordType, contentHash: target.contentHash },
      permissions: rights, basis: "Fixture local sem envio a provider.", validFrom: createdAt, expiresAt: null, evidenceRefs: [] } } });
  const asset = { id: "effect", mediaKind, role, source: { kind: "knowledge-core", locator: target.id }, bytes: content.length, sha256: fileSha256, mimeType: mediaType,
    rights: { providerInput: "denied", reuse: "allowed" }, authorization: { mode: "scope-grant", bindingHash: target.contentHash } };
  return { repository, grant, target, asset, context: { schema: "mkt-videos/local-asset-context@1", rootScopeId, dbFile, roots: { sfx: path.dirname(file) } },
    changeRights({ status = "active", permissions = {}, expiresAt = null } = {}) {
      rightsHead = repository.appendKnowledgeItem({ grant, item: { ...rightsHead, contentHash: undefined, revision: rightsHead.revision + 1, supersedesRevision: rightsHead.revision, status,
        payload: { ...rightsHead.payload, permissions: { ...rightsHead.payload.permissions, ...permissions }, expiresAt } } });
      return rightsHead;
    } };
}
