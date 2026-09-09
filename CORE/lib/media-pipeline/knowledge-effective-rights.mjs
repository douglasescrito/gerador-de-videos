import { createHash } from "node:crypto";
import {
  assertKnowledgeRecordPayloadContract,
} from "./knowledge-record-contracts.mjs";
import {
  assertKnowledgeRecordEnvelope,
} from "./knowledge-governance-envelope.mjs";
import {
  assertKnowledgeContract,
} from "./knowledge-schema-registry.mjs";
import {
  REFERENCE_RIGHT_KEYS,
} from "./knowledge-reference-inventory.mjs";

export const EFFECTIVE_RIGHTS_SCHEMA = "mkt-videos/effective-rights@1";
export const REFERENCE_ASSET_ENTITY_TYPE = "reference-asset";

const ITEM_SCHEMA = "mkt-videos/knowledge-item@1";
const ENTITY_SCHEMA = "mkt-videos/entity-profile@1";
const RIGHTS_SCHEMA = "mkt-videos/rights-record@1";
const STATE_PRECEDENCE = Object.freeze([
  "revoked",
  "expired",
  "denied",
  "unknown",
  "allowed",
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
      throw new Error("Projeção de direitos contém número não finito.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [
        key,
        canonicalize(value[key]),
      ]),
    );
  }
  throw new Error("Projeção de direitos deve conter somente valores JSON.");
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function normalizedIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} deve ser uma data válida.`);
  }
  return date.toISOString();
}

function assertReferenceAssetItem(item) {
  assertKnowledgeContract(item, {
    schemaId: ITEM_SCHEMA,
    label: "Reference asset item",
  });
  assertKnowledgeRecordPayloadContract({
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    payload: item.payload,
  });
  assertKnowledgeRecordEnvelope(item.governance);
  const { contentHash, ...body } = item;
  if (contentHash !== sha256Json(body)) {
    throw new Error("Reference asset item possui contentHash inválido.");
  }
  if (
    item.recordType !== "entity"
    || item.schemaId !== ENTITY_SCHEMA
    || item.payload.entityType !== REFERENCE_ASSET_ENTITY_TYPE
  ) {
    throw new Error("Target não é um reference-asset canônico.");
  }
  return item;
}

function assertRightsItem(item) {
  assertKnowledgeContract(item, {
    schemaId: ITEM_SCHEMA,
    label: "Rights item",
  });
  assertKnowledgeRecordPayloadContract({
    recordType: item.recordType,
    schemaId: item.schemaId,
    schemaVersion: item.schemaVersion,
    payload: item.payload,
  });
  assertKnowledgeRecordEnvelope(item.governance);
  const { contentHash, ...body } = item;
  if (contentHash !== sha256Json(body)) {
    throw new Error("Rights item possui contentHash inválido.");
  }
  if (item.recordType !== "rights" || item.schemaId !== RIGHTS_SCHEMA) {
    throw new Error("rightsItems contém item que não é rights-record@1.");
  }
  return item;
}

function targetReference(item) {
  return {
    schema: "mkt-videos/knowledge-reference@1",
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function referenceMatches(left, right) {
  return (
    left?.schema === right.schema
    && left?.kind === right.kind
    && left?.rootScopeId === right.rootScopeId
    && left?.id === right.id
    && left?.revision === right.revision
    && left?.recordType === right.recordType
    && left?.contentHash === right.contentHash
  );
}

export function referenceRightsItemId(targetItem) {
  const target = assertReferenceAssetItem(targetItem);
  return `krr_${sha256Json({
    rootScopeId: target.rootScopeId,
    targetId: target.id,
  }).slice(0, 32)}`;
}

function expirationState({
  target,
  rightsHead,
  at,
}) {
  const checkedAt = Date.parse(at);
  if (
    Date.parse(target.createdAt) > checkedAt
    || Date.parse(target.governance.createdAt) > checkedAt
  ) {
    return {
      state: "unknown",
      reason: "target-not-yet-effective",
    };
  }
  if (target.status === "revoked" || target.status === "quarantined") {
    return {
      state: "revoked",
      reason: `target-${target.status}`,
    };
  }
  if (target.status !== "active") {
    return {
      state: "unknown",
      reason: `target-${target.status}`,
    };
  }
  const targetExpiry = target.governance.retention.expiresAt;
  if (targetExpiry != null && Date.parse(targetExpiry) <= checkedAt) {
    return { state: "expired", reason: "target-retention-expired" };
  }
  if (rightsHead == null) {
    return { state: "unknown", reason: "rights-head-absent" };
  }
  if (
    Date.parse(rightsHead.createdAt) > checkedAt
    || Date.parse(rightsHead.governance.createdAt) > checkedAt
  ) {
    return {
      state: "unknown",
      reason: "rights-head-not-yet-effective",
    };
  }
  if (rightsHead.status === "revoked"
      || rightsHead.status === "quarantined") {
    return {
      state: "revoked",
      reason: `rights-head-${rightsHead.status}`,
    };
  }
  if (rightsHead.status !== "active") {
    return {
      state: "unknown",
      reason: `rights-head-${rightsHead.status}`,
    };
  }
  const governanceExpiry = rightsHead.governance.retention.expiresAt;
  if (
    governanceExpiry != null
    && Date.parse(governanceExpiry) <= checkedAt
  ) {
    return { state: "expired", reason: "rights-retention-expired" };
  }
  if (Date.parse(rightsHead.payload.validFrom) > checkedAt) {
    return { state: "unknown", reason: "rights-not-yet-valid" };
  }
  if (
    rightsHead.payload.expiresAt != null
    && Date.parse(rightsHead.payload.expiresAt) <= checkedAt
  ) {
    return { state: "expired", reason: "rights-expired" };
  }
  return null;
}

function intersectStates(left, right) {
  for (const state of STATE_PRECEDENCE) {
    if (left === state || right === state) return state;
  }
  return "unknown";
}

export function resolveEffectiveRights({
  targetItem,
  rightsItems = [],
  at = new Date(),
} = {}) {
  // Pure snapshot evaluator. Callers that require store authority must obtain
  // both heads atomically (for example via KnowledgeStoreRepository) before
  // invoking it; arbitrary caller-supplied items are not an authoritative read.
  const target = assertReferenceAssetItem(targetItem);
  const evaluatedAt = normalizedIso(at, "at");
  if (!Array.isArray(rightsItems)) {
    throw new Error("rightsItems deve ser uma lista.");
  }
  const expectedRightsId = referenceRightsItemId(target);
  const matchingLogicalItems = rightsItems
    .map(assertRightsItem)
    .filter((item) =>
      item.rootScopeId === target.rootScopeId
      && item.id === expectedRightsId)
    .sort((left, right) => left.revision - right.revision);
  const rightsHead = matchingLogicalItems.at(-1) ?? null;
  const expectedTargetRef = targetReference(target);
  const targetMatches = rightsHead == null
    ? false
    : referenceMatches(rightsHead.payload.targetRef, expectedTargetRef);
  const globalState = targetMatches
    ? expirationState({ target, rightsHead, at: evaluatedAt })
    : {
        state: "unknown",
        reason: rightsHead == null
          ? "rights-head-absent"
          : "rights-target-stale",
      };
  const permissions = Object.fromEntries(
    REFERENCE_RIGHT_KEYS.map((right) => {
      let state;
      let reason;
      if (globalState != null) {
        ({ state, reason } = globalState);
      } else {
        state = intersectStates(
          intersectStates(
            target.governance.rights[right],
            rightsHead.governance.rights[right],
          ),
          rightsHead.payload.permissions[right],
        );
        reason = state === "allowed"
          ? "target-envelope-rights-envelope-and-record-allow"
          : `intersection-${state}`;
      }
      return [
        right,
        {
          state,
          allowed: state === "allowed",
          reason,
        },
      ];
    }),
  );
  const body = {
    schema: EFFECTIVE_RIGHTS_SCHEMA,
    authority: "knowledge-store-head-only",
    evaluatedAt,
    target: {
      rootScopeId: target.rootScopeId,
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
      status: target.status,
    },
    rightsHead: rightsHead == null
      ? null
      : {
          id: rightsHead.id,
          revision: rightsHead.revision,
          contentHash: rightsHead.contentHash,
          status: rightsHead.status,
          targetMatches,
        },
    permissions,
    allAllowed: REFERENCE_RIGHT_KEYS.every((right) =>
      permissions[right].allowed),
  };
  const result = {
    ...body,
    decisionHash: sha256Json(body),
  };
  assertKnowledgeContract(result, {
    schemaId: EFFECTIVE_RIGHTS_SCHEMA,
    label: "Effective rights",
  });
  return result;
}

export function assertEffectiveRightAllowed({
  effectiveRights,
  right,
} = {}) {
  assertKnowledgeContract(effectiveRights, {
    schemaId: EFFECTIVE_RIGHTS_SCHEMA,
    label: "Effective rights",
  });
  if (!REFERENCE_RIGHT_KEYS.includes(right)) {
    throw new Error("Direito solicitado é inválido.");
  }
  const decision = effectiveRights.permissions[right];
  if (decision.allowed !== true || decision.state !== "allowed") {
    throw new Error(
      `Direito ${right} bloqueado: ${decision.state}/${decision.reason}.`,
    );
  }
  return decision;
}
