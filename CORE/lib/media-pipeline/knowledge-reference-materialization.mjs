import { createHash } from "node:crypto";
import {
  referenceRightsItemId,
} from "./knowledge-effective-rights.mjs";
import {
  createKnowledgeRecordEnvelope,
  assertKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import {
  assertKnowledgeRecordPayloadContract,
} from "./knowledge-record-contracts.mjs";
import {
  validateReferenceInventory,
} from "./knowledge-reference-inventory.mjs";
import {
  validateCohortRightsAttestation,
  validateReferenceCohortManifest,
} from "./knowledge-reference-rights.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";

export const KNOWLEDGE_ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
export const KNOWLEDGE_REFERENCE_SCHEMA =
  "mkt-videos/knowledge-reference@1";
export const KNOWLEDGE_EVIDENCE_LINK_SCHEMA =
  "mkt-videos/evidence-link@1";
export const KNOWLEDGE_ENTITY_PROFILE_SCHEMA =
  "mkt-videos/entity-profile@1";
export const KNOWLEDGE_CREATIVE_DECISION_SCHEMA =
  "mkt-videos/creative-decision-record@1";
export const KNOWLEDGE_RIGHTS_RECORD_SCHEMA =
  "mkt-videos/rights-record@1";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UNKNOWN_RIGHTS = Object.freeze({
  inventory: "unknown",
  localAnalysis: "unknown",
  textualIndexing: "unknown",
  embedding: "unknown",
  training: "unknown",
  providerInput: "unknown",
  publication: "unknown",
  reuse: "unknown",
});
const EXACT_ENTRY_FIELDS = Object.freeze([
  ["revision", "revision"],
  ["assetContentHash", "contentHash"],
  ["logicalPath", "logicalPath"],
  ["fileSha256", "fileSha256"],
  ["bytes", "bytes"],
  ["mediaType", "mediaType"],
]);

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Materialização contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        "Materialização deve conter somente valores JSON.",
      );
    }
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error("Materialização deve conter somente valores JSON.");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function requiredIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} é inválido.`);
  }
  return normalized;
}

function requiredHash(value, label) {
  const normalized = String(value ?? "").trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} deve ser SHA-256.`);
  }
  return normalized;
}

function normalizedIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} deve ser uma data válida.`);
  }
  return date.toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function itemReference(item) {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function scopeReference(rootScopeId, scopeId) {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "scope",
    rootScopeId,
    id: scopeId,
  };
}

function unknownRights() {
  return { ...UNKNOWN_RIGHTS };
}

function assertSameJson(left, right, message) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(message);
  }
}

function assertExactManifestInventory(inventory, manifest) {
  if (
    manifest.rootScopeId !== inventory.rootScopeId
    || manifest.scopeId !== inventory.scopeId
    || manifest.rootAlias !== inventory.rootAlias
    || manifest.sourceInventoryFingerprint !== inventory.fingerprint
  ) {
    throw new Error("Manifest diverge do inventário exato.");
  }
  assertSameJson(
    manifest.owner,
    inventory.owner,
    "Manifest diverge do owner do inventário exato.",
  );
  const assetById = new Map(
    inventory.assets.map((asset) => [asset.id, asset]),
  );
  for (const entry of manifest.entries) {
    const asset = assetById.get(entry.assetId);
    if (!asset) {
      throw new Error("Manifest contém asset fora do inventário exato.");
    }
    for (const [entryField, assetField] of EXACT_ENTRY_FIELDS) {
      if (entry[entryField] !== asset[assetField]) {
        throw new Error(
          "Manifest contém entry divergente do inventário exato.",
        );
      }
    }
  }
}

function retentionFor(attestation, createdAt) {
  if (
    attestation.expiresAt != null
    && Date.parse(attestation.expiresAt) <= Date.parse(createdAt)
  ) {
    throw new Error(
      "Atestação expirada não pode ser materializada como item active.",
    );
  }
  return attestation.expiresAt == null
    ? {
        policy: "manual-review",
        expiresAt: null,
        basis: "Atestação humana exata e revisão manual.",
      }
    : {
        policy: "until-rights-expire",
        expiresAt: attestation.expiresAt,
        basis: "Retenção limitada pela validade da atestação humana.",
      };
}

function provenanceEntry({
  sourceType,
  sourceRef,
  contentHash,
  observedAt,
  method = "deterministic-materialization",
}) {
  return {
    sourceType,
    sourceRef,
    method,
    observedAt,
    contentHash,
  };
}

function makeEnvelope({
  classification,
  owner,
  provenance,
  modality,
  evidenceIds,
  retention,
  rights,
  createdAt,
  createdBy,
}) {
  return createKnowledgeRecordEnvelope({
    classification,
    owner,
    provenance,
    modality,
    evidenceIds,
    retention,
    rights,
    createdAt,
    createdBy,
  }, {
    expectedActor: createdBy,
  });
}

function makeKnowledgeItem({
  id,
  rootScopeId,
  scopeId,
  recordType,
  schemaId,
  governance,
  payload,
  createdAt,
  createdBy,
}) {
  assertKnowledgeRecordPayloadContract({
    recordType,
    schemaId,
    schemaVersion: 1,
    payload,
  });
  assertKnowledgeRecordEnvelope(governance, {
    expectedActor: createdBy,
  });
  const body = {
    schema: KNOWLEDGE_ITEM_SCHEMA,
    id: requiredIdentifier(id, "item.id"),
    revision: 1,
    rootScopeId,
    scopeId,
    recordType,
    schemaId,
    schemaVersion: 1,
    status: "active",
    governance: structuredClone(governance),
    supersedesRevision: null,
    payload: structuredClone(payload),
    createdAt,
    createdBy,
  };
  const item = {
    ...body,
    contentHash: sha256Json(body),
  };
  assertKnowledgeContract(item, {
    schemaId: KNOWLEDGE_ITEM_SCHEMA,
    label: "Knowledge item materializado",
  });
  return item;
}

function assertExactItem(item, {
  rootScopeId,
  scopeId,
  owner,
} = {}) {
  assertKnowledgeContract(item, {
    schemaId: KNOWLEDGE_ITEM_SCHEMA,
    label: "Knowledge item materializado",
  });
  assertKnowledgeRecordPayloadContract({
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    payload: item.payload,
  });
  assertKnowledgeRecordEnvelope(item.governance, {
    expectedActor: item.createdBy,
  });
  const { contentHash, ...body } = item;
  if (contentHash !== sha256Json(body)) {
    throw new Error("Knowledge item materializado possui hash divergente.");
  }
  if (
    item.rootScopeId !== rootScopeId
    || item.scopeId !== scopeId
  ) {
    throw new Error("Knowledge item materializado escapou do root/scope.");
  }
  assertSameJson(
    item.governance.owner,
    owner,
    "Knowledge item materializado diverge do owner.",
  );
  if (item.status !== "active") {
    throw new Error("Knowledge item materializado deve permanecer active.");
  }
  return item;
}

function attestationSource(attestation) {
  return provenanceEntry({
    sourceType: "human-attestation",
    sourceRef: `attestation:${attestation.id}`,
    method: "human-attestation",
    observedAt: attestation.approvedAt,
    contentHash: attestation.contentHash,
  });
}

function manifestSource(manifest, observedAt) {
  return provenanceEntry({
    sourceType: "cohort-manifest",
    sourceRef: `manifest:${manifest.id}`,
    observedAt,
    contentHash: manifest.contentHash,
  });
}

function inventorySource(inventory, asset, observedAt) {
  return provenanceEntry({
    sourceType: "reference-inventory",
    sourceRef: `inventory:${inventory.fingerprint}`,
    observedAt,
    contentHash: asset.contentHash,
  });
}

function assertEvidenceReference(item, evidenceItem) {
  const expected = itemReference(evidenceItem);
  for (const reference of item.payload.evidenceRefs ?? []) {
    assertSameJson(
      reference,
      expected,
      "Materialização contém evidenceRef divergente.",
    );
  }
  const expectedIds = (item.payload.evidenceRefs ?? [])
    .map((reference) => reference.id)
    .sort(compareText);
  const actualIds = [...item.governance.evidenceIds].sort(compareText);
  assertSameJson(
    actualIds,
    expectedIds,
    "Materialização diverge entre evidenceRefs e governance.",
  );
}

export function validateReferenceKnowledgeMaterialization(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Materialização deve ser um objeto.");
  }
  if (
    result.providerFree !== true
    || result.persisted !== false
    || result.rootScopeId == null
    || result.scopeId == null
  ) {
    throw new Error("Materialização perdeu suas garantias provider-free.");
  }
  const expectedOrder = [
    result.evidenceItem,
    ...result.entityItems,
    result.decisionItem,
    ...result.rightsItems,
  ];
  assertSameJson(
    result.items,
    expectedOrder,
    "items diverge da ordem canônica da materialização.",
  );
  for (const item of result.items) {
    assertExactItem(item, {
      rootScopeId: result.rootScopeId,
      scopeId: result.scopeId,
      owner: result.owner,
    });
  }
  const itemIds = result.items.map(({ id }) => id);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("Materialização contém item IDs duplicados.");
  }
  const evidenceRef = itemReference(result.evidenceItem);
  for (const item of [
    ...result.entityItems,
    result.decisionItem,
    ...result.rightsItems,
  ]) {
    assertEvidenceReference(item, result.evidenceItem);
  }
  const entityByEntryId = new Map(
    result.entityItems.map((item) => [
      item.payload.attributes.cohortEntryId,
      item,
    ]),
  );
  const included = new Set(result.includedEntryIds);
  const excluded = new Set(result.excludedEntryIds);
  for (const [entryId, entity] of entityByEntryId) {
    const expectedRights = included.has(entryId)
      ? result.permissions
      : UNKNOWN_RIGHTS;
    assertSameJson(
      entity.governance.rights,
      expectedRights,
      "Entity materializada possui rights divergentes da partição.",
    );
    if (!included.has(entryId) && !excluded.has(entryId)) {
      throw new Error("Entity materializada escapou da partição atestada.");
    }
  }
  if (
    result.entityItems.length
    !== result.includedEntryIds.length + result.excludedEntryIds.length
  ) {
    throw new Error("Materialização não cobre a partição exata.");
  }
  if (result.rightsItems.length !== result.includedEntryIds.length) {
    throw new Error(
      "Rights records devem existir somente para entries incluídas.",
    );
  }
  const rightsTargetIds = new Set();
  for (const rightsItem of result.rightsItems) {
    const target = rightsItem.payload.targetRef;
    const targetItem = [...entityByEntryId.values()]
      .find((entity) => entity.id === target.id);
    if (!targetItem) {
      throw new Error("Rights record referencia target desconhecido.");
    }
    const entryId = targetItem.payload.attributes.cohortEntryId;
    if (!included.has(entryId)) {
      throw new Error("Entry excluída recebeu rights record.");
    }
    assertSameJson(
      target,
      itemReference(targetItem),
      "Rights record possui targetRef divergente.",
    );
    if (rightsItem.id !== referenceRightsItemId(targetItem)) {
      throw new Error("Rights record possui ID não canônico.");
    }
    assertSameJson(
      rightsItem.payload.permissions,
      result.permissions,
      "Rights record diverge da atestação.",
    );
    rightsTargetIds.add(target.id);
  }
  if (rightsTargetIds.size !== result.rightsItems.length) {
    throw new Error("Materialização contém rights target duplicado.");
  }
  const expectedDecisionContexts = result.entityItems.map(itemReference);
  assertSameJson(
    result.decisionItem.payload.contextRefs,
    expectedDecisionContexts,
    "Decisão não referencia os assets exatos.",
  );
  assertSameJson(
    result.decisionItem.payload.evidenceRefs,
    [evidenceRef],
    "Decisão não referencia a evidência exata.",
  );
  const { materializationHash, ...body } = result;
  if (materializationHash !== sha256Json(body)) {
    throw new Error("Materialização possui hash divergente.");
  }
  return result;
}

export function buildReferenceKnowledgeMaterialization({
  inventory,
  manifest,
  attestation,
  rootScopeId,
  confirmHuman = false,
  expectedAttestationHash,
  classification = "confidential",
  materializedAt = null,
  materializedBy = null,
} = {}) {
  validateReferenceInventory(inventory);
  validateReferenceCohortManifest(manifest);
  validateCohortRightsAttestation(attestation, { manifest });
  if (confirmHuman !== true) {
    throw new Error(
      "Materialização exige confirmação humana explícita.",
    );
  }
  if (
    requiredHash(expectedAttestationHash, "expectedAttestationHash")
    !== attestation.contentHash
  ) {
    throw new Error(
      "expectedAttestationHash diverge da atestação apresentada.",
    );
  }
  const expectedRootScopeId = requiredIdentifier(
    rootScopeId,
    "rootScopeId",
  );
  if (
    expectedRootScopeId !== inventory.rootScopeId
    || manifest.rootScopeId !== expectedRootScopeId
    || attestation.manifest.rootScopeId !== expectedRootScopeId
  ) {
    throw new Error("Materialização exige igualdade exata de rootScopeId.");
  }
  assertExactManifestInventory(inventory, manifest);
  const createdAt = normalizedIso(
    materializedAt ?? attestation.approvedAt,
    "materializedAt",
  );
  if (Date.parse(createdAt) < Date.parse(attestation.approvedAt)) {
    throw new Error(
      "materializedAt não pode preceder a aprovação da atestação.",
    );
  }
  const createdBy = String(
    materializedBy ?? attestation.approvedBy,
  ).trim();
  if (!createdBy || createdBy !== attestation.approvedBy) {
    throw new Error(
      "materializedBy deve ser o approvedBy da atestação exata.",
    );
  }
  const retention = retentionFor(attestation, createdAt);
  const owner = structuredClone(manifest.owner);
  const permissions = structuredClone(attestation.permissions);
  const includedEntryIds = [...attestation.includedEntryIds];
  const excludedEntryIds = [...attestation.excludedEntryIds];
  const included = new Set(includedEntryIds);
  const evidenceId =
    `reference-attestation-evidence:${attestation.id}`;
  const evidencePayload = {
    schema: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
    source: {
      sourceType: "human-attestation",
      sourceRef: `attestation:${attestation.id}`,
      contentHash: attestation.contentHash,
      method: "human-attestation",
      observedAt: attestation.approvedAt,
      fragment: null,
    },
    relation: "documents",
    targetRefs: [
      scopeReference(expectedRootScopeId, manifest.scopeId),
    ],
    observation:
      "Atestação humana da partição exata do cohort de referências.",
    confidence: 1,
    evidenceRefs: [],
  };
  const evidenceItem = makeKnowledgeItem({
    id: evidenceId,
    rootScopeId: expectedRootScopeId,
    scopeId: manifest.scopeId,
    recordType: "evidence",
    schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
    governance: makeEnvelope({
      classification,
      owner,
      provenance: [attestationSource(attestation)],
      modality: "fact",
      evidenceIds: [],
      retention,
      rights: unknownRights(),
      createdAt,
      createdBy,
    }),
    payload: evidencePayload,
    createdAt,
    createdBy,
  });
  const evidenceRef = itemReference(evidenceItem);
  const assetById = new Map(
    inventory.assets.map((asset) => [asset.id, asset]),
  );
  const entityItems = manifest.entries.map((entry) => {
    const asset = assetById.get(entry.assetId);
    const isIncluded = included.has(entry.id);
    const payload = {
      schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      entityType: "reference-asset",
      name: entry.logicalPath,
      aliases: [],
      attributes: {
        cohortEntryId: entry.id,
        inventoryAssetId: entry.assetId,
        inventoryAssetRevision: entry.revision,
        inventoryAssetContentHash: entry.assetContentHash,
        sourceInventoryFingerprint: inventory.fingerprint,
        manifestId: manifest.id,
        manifestContentHash: manifest.contentHash,
        attestationId: attestation.id,
        attestationContentHash: attestation.contentHash,
        attestationDisposition: isIncluded ? "included" : "excluded",
        rootAlias: manifest.rootAlias,
        logicalPath: entry.logicalPath,
        fileSha256: entry.fileSha256,
        bytes: entry.bytes,
        mediaType: entry.mediaType,
        claimedProvenance: structuredClone(manifest.claimedProvenance),
      },
      evidenceRefs: [evidenceRef],
    };
    return makeKnowledgeItem({
      id: `reference-asset:${entry.assetId}`,
      rootScopeId: expectedRootScopeId,
      scopeId: manifest.scopeId,
      recordType: "entity",
      schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      governance: makeEnvelope({
        classification,
        owner,
        provenance: [
          inventorySource(inventory, asset, manifest.generatedAt),
          manifestSource(manifest, manifest.generatedAt),
          attestationSource(attestation),
        ],
        modality: "fact",
        evidenceIds: [evidenceItem.id],
        retention,
        rights: isIncluded ? permissions : unknownRights(),
        createdAt,
        createdBy,
      }),
      payload,
      createdAt,
      createdBy,
    });
  });
  const decisionPayload = {
    schema: KNOWLEDGE_CREATIVE_DECISION_SCHEMA,
    question:
      "Materializar a partição humana exata deste cohort de referências?",
    options: [
      {
        id: "accept-attested-partition",
        label: "Materializar a partição atestada exata",
      },
      {
        id: "reject-attested-partition",
        label: "Não materializar o cohort",
      },
    ],
    selectedOptionId: "accept-attested-partition",
    rationale: attestation.basis,
    contextRefs: entityItems.map(itemReference),
    evidenceRefs: [evidenceRef],
    confidence: 1,
    impact: {
      inventoryFingerprint: inventory.fingerprint,
      manifestId: manifest.id,
      manifestContentHash: manifest.contentHash,
      attestationId: attestation.id,
      attestationContentHash: attestation.contentHash,
      includedEntryIds,
      excludedEntryIds,
      rightsRecordsCreatedForIncludedOnly: true,
      providerCalls: 0,
    },
    humanConfirmed: true,
    approvedBy: attestation.approvedBy,
    decidedAt: createdAt,
  };
  const decisionItem = makeKnowledgeItem({
    id: `reference-cohort-decision:${attestation.id}`,
    rootScopeId: expectedRootScopeId,
    scopeId: manifest.scopeId,
    recordType: "decision",
    schemaId: KNOWLEDGE_CREATIVE_DECISION_SCHEMA,
    governance: makeEnvelope({
      classification,
      owner,
      provenance: [attestationSource(attestation)],
      modality: "hard-constraint",
      evidenceIds: [evidenceItem.id],
      retention,
      rights: unknownRights(),
      createdAt,
      createdBy,
    }),
    payload: decisionPayload,
    createdAt,
    createdBy,
  });
  const rightsItems = entityItems
    .filter((item) =>
      included.has(item.payload.attributes.cohortEntryId))
    .map((targetItem) => {
      const payload = {
        schema: KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
        targetRef: itemReference(targetItem),
        permissions: structuredClone(permissions),
        basis: attestation.basis,
        validFrom: attestation.validFrom,
        expiresAt: attestation.expiresAt,
        evidenceRefs: [evidenceRef],
      };
      return makeKnowledgeItem({
        id: referenceRightsItemId(targetItem),
        rootScopeId: expectedRootScopeId,
        scopeId: manifest.scopeId,
        recordType: "rights",
        schemaId: KNOWLEDGE_RIGHTS_RECORD_SCHEMA,
        governance: makeEnvelope({
          classification,
          owner,
          provenance: [
            attestationSource(attestation),
            provenanceEntry({
              sourceType: "human-decision",
              sourceRef: `decision:${decisionItem.id}`,
              observedAt: createdAt,
              contentHash: decisionItem.contentHash,
            }),
          ],
          modality: "hard-constraint",
          evidenceIds: [evidenceItem.id],
          retention,
          rights: permissions,
          createdAt,
          createdBy,
        }),
        payload,
        createdAt,
        createdBy,
      });
    });
  const body = {
    providerFree: true,
    persisted: false,
    rootScopeId: expectedRootScopeId,
    scopeId: manifest.scopeId,
    owner,
    inventoryFingerprint: inventory.fingerprint,
    manifest: {
      id: manifest.id,
      contentHash: manifest.contentHash,
    },
    attestation: {
      id: attestation.id,
      contentHash: attestation.contentHash,
    },
    permissions,
    includedEntryIds,
    excludedEntryIds,
    evidenceItem,
    entityItems,
    decisionItem,
    rightsItems,
    items: [
      evidenceItem,
      ...entityItems,
      decisionItem,
      ...rightsItems,
    ],
  };
  const result = {
    ...body,
    materializationHash: sha256Json(body),
  };
  validateReferenceKnowledgeMaterialization(result);
  return deepFreeze(result);
}
