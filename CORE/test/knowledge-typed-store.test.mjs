import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  KNOWLEDGE_ASSERTION_SCHEMA,
  KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
  KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
  KNOWLEDGE_REFERENCE_SCHEMA,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const ACTOR = "typed-store-test";
const ROOT_A = "client:typed-a";
const ROOT_B = "client:typed-b";

function canonicalValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function eventHashBody(row, payloadHash, previousEventHash) {
  const body = {
    id: row.event_id,
    rootScopeId: row.root_scope_id,
    scopeId: row.scope_id,
    type: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectRevision: row.subject_revision,
    at: row.at,
    grantId: row.grant_id,
    grantHash: row.grant_hash,
    policyId: row.policy_id,
    policyHash: row.policy_hash,
    actor: row.actor,
    grantPermission: row.grant_permission,
    grantIssuedAt: row.grant_issued_at,
    grantExpiresAt: row.grant_expires_at,
    payloadHash,
    previousEventHash,
  };
  if (row.grant_json != null) {
    body.grantBodyHash = digest(row.grant_json);
  }
  return body;
}

function rewriteReleaseAsHistorical({
  dbFile,
  rootScopeId,
  item,
  release,
}) {
  const historicalSchemaId = "mkt-videos/historical-principle@1";
  const direct = new DatabaseSync(dbFile);
  try {
    const triggerNames = [
      "knowledge_items_no_update",
      "knowledge_releases_no_update",
      "knowledge_release_members_no_update",
      "knowledge_events_no_update",
    ];
    const triggerSql = triggerNames.map((name) => direct.prepare(`
      SELECT sql
      FROM sqlite_schema
      WHERE type='trigger' AND name=?
    `).get(name).sql);
    triggerNames.forEach((name) => direct.exec(`DROP TRIGGER ${name}`));

    const itemRow = direct.prepare(`
      SELECT body_json
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=? AND revision=?
    `).get(rootScopeId, item.id, item.revision);
    const itemBody = JSON.parse(itemRow.body_json);
    itemBody.schemaId = historicalSchemaId;
    itemBody.payload = {
      legacyStatement: "Conhecimento anterior ao registry tipado.",
    };
    const itemBodyJson = canonicalJson(itemBody);
    const itemContentHash = digest(itemBodyJson);
    direct.prepare(`
      UPDATE knowledge_items
      SET schema_id=?,body_json=?,content_hash=?
      WHERE root_scope_id=? AND item_id=? AND revision=?
    `).run(
      historicalSchemaId,
      itemBodyJson,
      itemContentHash,
      rootScopeId,
      item.id,
      item.revision,
    );

    const releaseRow = direct.prepare(`
      SELECT manifest_json
      FROM knowledge_releases
      WHERE root_scope_id=? AND release_id=?
    `).get(rootScopeId, release.id);
    const releaseBody = JSON.parse(releaseRow.manifest_json);
    const member = releaseBody.members.find(({ id, revision }) =>
      id === item.id && revision === item.revision);
    member.schemaId = historicalSchemaId;
    member.contentHash = itemContentHash;
    const releaseManifestJson = canonicalJson(releaseBody);
    const releaseHash = digest(releaseManifestJson);
    direct.prepare(`
      UPDATE knowledge_release_members
      SET schema_id=?,content_hash=?
      WHERE root_scope_id=? AND release_id=? AND item_id=?
    `).run(
      historicalSchemaId,
      itemContentHash,
      rootScopeId,
      release.id,
      item.id,
    );
    direct.prepare(`
      UPDATE knowledge_releases
      SET manifest_json=?,release_hash=?
      WHERE root_scope_id=? AND release_id=?
    `).run(
      releaseManifestJson,
      releaseHash,
      rootScopeId,
      release.id,
    );

    const events = direct.prepare(`
      SELECT *
      FROM knowledge_events
      WHERE root_scope_id=?
      ORDER BY sequence
    `).all(rootScopeId);
    let previousEventHash = null;
    for (const event of events) {
      const payload = JSON.parse(event.payload_json);
      if (
        event.event_type === "knowledge-item.appended"
        && event.subject_id === item.id
      ) {
        payload.contentHash = itemContentHash;
        payload.schemaId = historicalSchemaId;
      }
      if (
        event.event_type === "knowledge-release.created"
        && event.subject_id === release.id
      ) {
        payload.releaseHash = releaseHash;
      }
      const payloadJson = canonicalJson(payload);
      const payloadHash = digest(payloadJson);
      const eventHash = digest(canonicalJson(
        eventHashBody(event, payloadHash, previousEventHash),
      ));
      direct.prepare(`
        UPDATE knowledge_events
        SET payload_json=?,payload_hash=?,previous_event_hash=?,event_hash=?
        WHERE sequence=?
      `).run(
        payloadJson,
        payloadHash,
        previousEventHash,
        eventHash,
        event.sequence,
      );
      previousEventHash = eventHash;
    }
    triggerSql.forEach((sql) => direct.exec(sql));
    return {
      historicalSchemaId,
      itemContentHash,
      releaseHash,
    };
  } finally {
    direct.close();
  }
}

function grant(rootScopeIds) {
  return createScopeGrant({
    rootScopeIds,
    permissions: ["read", "write", "release", "export", "integrity"],
    actor: ACTOR,
    purpose: "provider-free typed Knowledge Store adversarial tests",
    issuedAt: "2026-07-24T11:00:00.000Z",
    expiresAt: "2026-07-24T13:00:00.000Z",
  });
}

async function setup(context) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-typed-store-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const coreRoot = path.join(temporary, "workspace", "CORE");
  const dbFile = path.join(temporary, "private", "knowledge.sqlite");
  await Promise.all([
    mkdir(coreRoot, { recursive: true }),
    mkdir(path.dirname(dbFile), { recursive: true }),
  ]);
  initializeKnowledgeStore({
    dbFile,
    coreRoot,
    clock: () => FIXED_NOW,
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    coreRoot,
    clock: () => FIXED_NOW,
  });
  return { dbFile, repository };
}

function createScope(repository, scopeGrant, {
  id,
  rootScopeId,
  parentScopeId = null,
  kind,
} = {}) {
  return repository.createScope({
    grant: scopeGrant,
    scope: {
      id,
      rootScopeId,
      parentScopeId,
      kind,
      name: id,
      createdAt: FIXED_NOW,
    },
  });
}

function createTwoRoots(repository, { grantA, grantB }) {
  createScope(repository, grantA, {
    id: ROOT_A,
    rootScopeId: ROOT_A,
    kind: "client",
  });
  createScope(repository, grantB, {
    id: ROOT_B,
    rootScopeId: ROOT_B,
    kind: "client",
  });
  createScope(repository, grantA, {
    id: "project:typed-a",
    rootScopeId: ROOT_A,
    parentScopeId: ROOT_A,
    kind: "project",
  });
  createScope(repository, grantB, {
    id: "project:typed-b",
    rootScopeId: ROOT_B,
    parentScopeId: ROOT_B,
    kind: "project",
  });
}

function scopeRef(rootScopeId, id = rootScopeId) {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "scope",
    rootScopeId,
    id,
  };
}

function itemRef(item, overrides = {}) {
  return {
    schema: KNOWLEDGE_REFERENCE_SCHEMA,
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
    ...overrides,
  };
}

function entityPayload(name, evidenceRefs = []) {
  return {
    schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
    entityType: "brand",
    name,
    aliases: [],
    attributes: {},
    evidenceRefs,
  };
}

function evidencePayload({
  rootScopeId,
  targetRefs = [],
  evidenceRefs = [],
  suffix,
} = {}) {
  return {
    schema: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
    source: {
      sourceType: "human-review",
      sourceRef: `review:${suffix}`,
      contentHash: digest(`evidence:${rootScopeId}:${suffix}`),
      method: "manual",
      observedAt: FIXED_NOW.toISOString(),
      fragment: null,
    },
    relation: "supports",
    targetRefs,
    observation: `Observação ${suffix}`,
    confidence: 1,
    evidenceRefs,
  };
}

function assertionPayload({
  subjectRef,
  evidenceRefs = [],
  predicate = "motion.minimum-hold-frames",
} = {}) {
  return {
    schema: KNOWLEDGE_ASSERTION_SCHEMA,
    subjectRef,
    predicate,
    value: 24,
    polarity: "positive",
    applicability: {},
    confidence: 1,
    evidenceRefs,
  };
}

function envelope({
  id,
  revision = 1,
  rootScopeId,
  ownerId = rootScopeId,
  ownerType = "client",
  payload,
  evidenceIds = [],
} = {}) {
  return createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: ownerType, id: ownerId },
    provenance: [{
      sourceType: "test-fixture",
      sourceRef: `fixture:${rootScopeId}/${id}/${revision}`,
      method: "manual",
      observedAt: FIXED_NOW,
      contentHash: digest(canonicalJson(payload)),
    }],
    modality: "fact",
    evidenceIds,
    retention: { policy: "manual-review" },
    rights: { localAnalysis: "allowed" },
    createdAt: FIXED_NOW,
    createdBy: ACTOR,
  }, {
    expectedActor: ACTOR,
  });
}

function knowledgeItem({
  id,
  rootScopeId = ROOT_A,
  scopeId = rootScopeId,
  recordType,
  schemaId,
  payload,
  ownerId = rootScopeId,
  ownerType = "client",
  evidenceIds = [],
  revision = 1,
  supersedesRevision = null,
  status = "active",
} = {}) {
  return {
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType,
    schemaId,
    schemaVersion: 1,
    status,
    governance: envelope({
      id,
      revision,
      rootScopeId,
      ownerId,
      ownerType,
      payload,
      evidenceIds,
    }),
    supersedesRevision,
    payload,
    createdAt: FIXED_NOW.toISOString(),
    createdBy: ACTOR,
  };
}

function appendEntity(repository, scopeGrant, {
  id,
  rootScopeId = ROOT_A,
  name = id,
  evidenceRefs = [],
  evidenceIds = evidenceRefs.map((reference) => reference.id),
  ...overrides
} = {}) {
  return repository.appendKnowledgeItem({
    grant: scopeGrant,
    item: knowledgeItem({
      id,
      rootScopeId,
      recordType: "entity",
      schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      payload: entityPayload(name, evidenceRefs),
      evidenceIds,
      ...overrides,
    }),
  });
}

test("append novo falha fechado para schema, recordType e owner inválidos", async (context) => {
  const { repository } = await setup(context);
  const grantA = grant([ROOT_A]);
  const grantB = grant([ROOT_B]);
  createTwoRoots(repository, { grantA, grantB });

  assert.throws(
    () => repository.appendKnowledgeItem({
      grant: grantA,
      item: knowledgeItem({
        id: "assertion:historical",
        recordType: "assertion",
        schemaId: "mkt-videos/historical-note@1",
        payload: { note: "schema legado não entra por append novo" },
      }),
    }),
    /histórico, desconhecido ou não persistível/,
  );

  assert.throws(
    () => repository.appendKnowledgeItem({
      grant: grantA,
      item: knowledgeItem({
        id: "entity:wrong-record-type",
        recordType: "assertion",
        schemaId: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
        payload: entityPayload("RecordType divergente"),
      }),
    }),
    /pertence a recordType entity/,
  );

  assert.throws(
    () => appendEntity(repository, grantA, {
      id: "entity:cross-root-owner",
      ownerId: "project:typed-b",
      ownerType: "project",
    }),
    /owner que não pertence ao mesmo root/,
  );

  assert.throws(
    () => appendEntity(repository, grantA, {
      id: "entity:wrong-owner-kind",
      ownerId: ROOT_A,
      ownerType: "project",
    }),
    /owner\.type divergente/,
  );

  const stored = appendEntity(repository, grantA, {
    id: "entity:project-owned",
    scopeId: "project:typed-a",
    ownerId: "project:typed-a",
    ownerType: "project",
  });
  assert.equal(stored.governance.owner.id, "project:typed-a");
  assert.equal(stored.governance.owner.type, "project");
});

test("refs resolvem root, revisão, recordType e hash exatos; evidências não divergem", async (context) => {
  const { repository } = await setup(context);
  const grantA = grant([ROOT_A]);
  const grantB = grant([ROOT_B]);
  createTwoRoots(repository, { grantA, grantB });
  const entityA = appendEntity(repository, grantA, {
    id: "entity:shared",
    rootScopeId: ROOT_A,
    name: "Entidade A",
  });
  const entityB = appendEntity(repository, grantB, {
    id: "entity:shared",
    rootScopeId: ROOT_B,
    name: "Entidade B",
  });
  const entityOnlyB = appendEntity(repository, grantB, {
    id: "entity:only-b",
    rootScopeId: ROOT_B,
    name: "Somente B",
  });

  const appendAssertion = (id, subjectRef) =>
    repository.appendKnowledgeItem({
      grant: grantA,
      item: knowledgeItem({
        id,
        recordType: "assertion",
        schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
        payload: assertionPayload({ subjectRef }),
      }),
    });

  assert.throws(
    () => appendAssertion("assertion:cross-root", itemRef(entityB)),
    /referência fora do root/,
  );
  assert.throws(
    () => appendAssertion(
      "assertion:root-spoof",
      itemRef(entityOnlyB, { rootScopeId: ROOT_A }),
    ),
    /item-ref inexistente/,
  );
  assert.throws(
    () => appendAssertion(
      "assertion:wrong-revision",
      itemRef(entityA, { revision: 2 }),
    ),
    /item-ref inexistente/,
  );
  assert.throws(
    () => appendAssertion(
      "assertion:wrong-hash",
      itemRef(entityA, { contentHash: "f".repeat(64) }),
    ),
    /type\/hash divergente/,
  );

  assert.throws(
    () => repository.appendKnowledgeItem({
      grant: grantA,
      item: knowledgeItem({
        id: "evidence:wrong-target-type",
        recordType: "evidence",
        schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
        payload: evidencePayload({
          rootScopeId: ROOT_A,
          suffix: "wrong-target-type",
          targetRefs: [
            itemRef(entityA, { recordType: "assertion" }),
          ],
        }),
      }),
    }),
    /type\/hash divergente/,
  );

  const evidence = repository.appendKnowledgeItem({
    grant: grantA,
    item: knowledgeItem({
      id: "evidence:approved",
      recordType: "evidence",
      schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
      payload: evidencePayload({
        rootScopeId: ROOT_A,
        suffix: "approved",
        targetRefs: [scopeRef(ROOT_A)],
      }),
    }),
  });
  const evidenceRef = itemRef(evidence);
  assert.throws(
    () => appendEntity(repository, grantA, {
      id: "entity:evidence-mismatch",
      evidenceRefs: [evidenceRef],
      evidenceIds: [],
    }),
    /governance\.evidenceIds e payload\.evidenceRefs/,
  );
  const grounded = appendEntity(repository, grantA, {
    id: "entity:evidence-grounded",
    evidenceRefs: [evidenceRef],
  });
  assert.deepEqual(grounded.governance.evidenceIds, [evidence.id]);
});

test("release exige fechamento transitivo e a release completa pode ser ativada", async (context) => {
  const { repository } = await setup(context);
  const scopeGrant = grant([ROOT_A]);
  createScope(repository, scopeGrant, {
    id: ROOT_A,
    rootScopeId: ROOT_A,
    kind: "client",
  });
  const evidence = repository.appendKnowledgeItem({
    grant: scopeGrant,
    item: knowledgeItem({
      id: "evidence:release",
      recordType: "evidence",
      schemaId: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
      payload: evidencePayload({
        rootScopeId: ROOT_A,
        suffix: "release",
        targetRefs: [scopeRef(ROOT_A)],
      }),
    }),
  });
  const entity = appendEntity(repository, scopeGrant, {
    id: "entity:release",
    evidenceRefs: [itemRef(evidence)],
  });
  const assertion = repository.appendKnowledgeItem({
    grant: scopeGrant,
    item: knowledgeItem({
      id: "assertion:release",
      recordType: "assertion",
      schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
      payload: assertionPayload({
        subjectRef: itemRef(entity),
        evidenceRefs: [itemRef(evidence)],
      }),
      evidenceIds: [evidence.id],
    }),
  });

  assert.throws(
    () => repository.createRelease({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
      label: "Incompleta sem entidade e evidência",
      members: [{ id: assertion.id, revision: assertion.revision }],
    }),
    /não inclui a revisão referenciada/,
  );
  assert.throws(
    () => repository.createRelease({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
      label: "Incompleta sem evidência",
      members: [
        { id: assertion.id, revision: assertion.revision },
        { id: entity.id, revision: entity.revision },
      ],
    }),
    /não inclui a revisão referenciada/,
  );

  const release = repository.createRelease({
    grant: scopeGrant,
    rootScopeId: ROOT_A,
    label: "Grafo fechado",
    members: [
      { id: assertion.id, revision: assertion.revision },
      { id: entity.id, revision: entity.revision },
      { id: evidence.id, revision: evidence.revision },
    ],
  });
  assert.deepEqual(
    release.members.map(({ id }) => id),
    [assertion.id, entity.id, evidence.id].sort(),
  );
  const activation = repository.activateRelease({
    grant: scopeGrant,
    rootScopeId: ROOT_A,
    releaseId: release.id,
    expectedReleaseHash: release.hash,
    expectedCurrentActivationId: null,
    reason: "Grafo tipado validado em teste provider-free.",
  });
  assert.equal(activation.releaseId, release.id);
});

test("integrity reporta referência cross-root mesmo quando body/hash são adulterados juntos", async (context) => {
  const { dbFile, repository } = await setup(context);
  const grantA = grant([ROOT_A]);
  const grantB = grant([ROOT_B]);
  createTwoRoots(repository, { grantA, grantB });
  const entityA = appendEntity(repository, grantA, {
    id: "entity:integrity",
    rootScopeId: ROOT_A,
  });
  appendEntity(repository, grantB, {
    id: "entity:integrity",
    rootScopeId: ROOT_B,
  });
  const assertion = repository.appendKnowledgeItem({
    grant: grantA,
    item: knowledgeItem({
      id: "assertion:integrity",
      recordType: "assertion",
      schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
      payload: assertionPayload({ subjectRef: itemRef(entityA) }),
    }),
  });
  assert.equal(
    repository.checkIntegrity({
      grant: grantA,
      rootScopeId: ROOT_A,
    }).ok,
    true,
  );

  const direct = new DatabaseSync(dbFile);
  try {
    direct.exec("DROP TRIGGER knowledge_items_no_update");
    const row = direct.prepare(`
      SELECT body_json
      FROM knowledge_items
      WHERE root_scope_id=? AND item_id=? AND revision=?
    `).get(ROOT_A, assertion.id, assertion.revision);
    const body = JSON.parse(row.body_json);
    body.payload.subjectRef.rootScopeId = ROOT_B;
    const bodyJson = canonicalJson(body);
    direct.prepare(`
      UPDATE knowledge_items
      SET body_json=?,content_hash=?
      WHERE root_scope_id=? AND item_id=? AND revision=?
    `).run(
      bodyJson,
      digest(bodyJson),
      ROOT_A,
      assertion.id,
      assertion.revision,
    );
    direct.exec(`
      CREATE TRIGGER knowledge_items_no_update
      BEFORE UPDATE ON knowledge_items
      BEGIN
        SELECT RAISE(ABORT, 'knowledge_items is append-only');
      END
    `);
  } finally {
    direct.close();
  }

  const report = repository.checkIntegrity({
    grant: grantA,
    rootScopeId: ROOT_A,
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.issues.some(({ type }) => type === "item-reference-root"),
    true,
  );
});

test("ADR 0005 preserva leitura/export histórico, mas bloqueia release e autorização atuais", async (context) => {
  const { dbFile, repository } = await setup(context);
  const scopeGrant = grant([ROOT_A]);
  createScope(repository, scopeGrant, {
    id: ROOT_A,
    rootScopeId: ROOT_A,
    kind: "client",
  });
  const typedItem = repository.appendKnowledgeItem({
    grant: scopeGrant,
    item: knowledgeItem({
      id: "assertion:historical-release",
      recordType: "assertion",
      schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
      payload: assertionPayload({ subjectRef: scopeRef(ROOT_A) }),
    }),
  });
  const typedRelease = repository.createRelease({
    grant: scopeGrant,
    rootScopeId: ROOT_A,
    releaseId: "release:historical-v1",
    label: "Release criada antes do registry tipado",
    members: [{ id: typedItem.id, revision: typedItem.revision }],
  });
  const historical = rewriteReleaseAsHistorical({
    dbFile,
    rootScopeId: ROOT_A,
    item: typedItem,
    release: typedRelease,
  });

  assert.equal(
    repository.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
    }).ok,
    true,
  );
  const readable = repository.getKnowledgeItem({
    grant: scopeGrant,
    rootScopeId: ROOT_A,
    id: typedItem.id,
    revision: typedItem.revision,
  });
  assert.equal(readable.schemaId, historical.historicalSchemaId);
  assert.equal(
    readable.payload.legacyStatement,
    "Conhecimento anterior ao registry tipado.",
  );
  const exported = repository.exportKnowledge({
    grant: scopeGrant,
    rootScopeId: ROOT_A,
    releaseId: typedRelease.id,
  });
  assert.equal(exported.items[0].schemaId, historical.historicalSchemaId);
  assert.doesNotThrow(() => repository.serializeExport(exported));

  assert.throws(
    () => repository.createRelease({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
      label: "Release nova não pode reempacotar legado desconhecido",
      members: [{ id: typedItem.id, revision: typedItem.revision }],
    }),
    /histórico, desconhecido ou não persistível/,
  );
  assert.throws(
    () => repository.activateRelease({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
      releaseId: typedRelease.id,
      expectedReleaseHash: historical.releaseHash,
      expectedCurrentActivationId: null,
      reason: "Superfície atual deve falhar fechado.",
    }),
    /histórico, desconhecido ou não persistível/,
  );
  assert.throws(
    () => repository.authorizeReplay({
      grant: scopeGrant,
      rootScopeId: ROOT_A,
      releaseId: typedRelease.id,
    }),
    /histórico, desconhecido ou não persistível/,
  );
});
