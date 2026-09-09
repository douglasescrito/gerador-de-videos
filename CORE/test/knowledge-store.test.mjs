import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  KNOWLEDGE_EXPORT_SCHEMA,
  KNOWLEDGE_ITEM_SCHEMA,
  KNOWLEDGE_POLICY_HASH,
  KNOWLEDGE_POLICY_ID,
  KNOWLEDGE_RELEASE_SCHEMA,
  KNOWLEDGE_REVIEW_DECISION_SCHEMA,
  SCOPE_GRANT_SCHEMA,
  createKnowledgeStoreRepository,
  createScopeGrant,
  checkKnowledgeStoreIntegrity,
  initializeKnowledgeStore,
  readKnowledgeStoreStatus,
  resolveKnowledgeStorePath,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  KNOWLEDGE_ASSERTION_SCHEMA,
  KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
  KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
  KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
  KNOWLEDGE_REFERENCE_SCHEMA,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";

const FIXED_NOW = new Date("2026-07-23T18:00:00.000Z");
const GRANT_EXPIRY = "2026-07-23T19:00:00.000Z";
const ALL_PERMISSIONS = ["read", "write", "release", "export", "integrity"];

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

function legacyEventHashBody(row, previousEventHash) {
  return {
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
    payloadHash: row.payload_hash,
    previousEventHash,
  };
}

function grant(rootScopeIds, permissions = ALL_PERMISSIONS) {
  return createScopeGrant({
    rootScopeIds,
    permissions,
    actor: "test-suite",
    purpose: "provider-free Knowledge Store contract test",
    issuedAt: FIXED_NOW,
    expiresAt: GRANT_EXPIRY,
  });
}

function repository(dbFile) {
  const options = {
    dbFile,
    clock: () => FIXED_NOW,
  };
  initializeKnowledgeStore(options);
  return createKnowledgeStoreRepository(options);
}

function createRoot(repositoryInstance, scopeGrant, id, name) {
  return repositoryInstance.createScope({
    grant: scopeGrant,
    scope: {
      id,
      rootScopeId: id,
      kind: "client",
      name,
      createdAt: FIXED_NOW,
    },
  });
}

function governedItem(item, {
  actor = "test-suite",
  governance = {},
} = {}) {
  const createdAt = new Date(item.createdAt ?? FIXED_NOW).toISOString();
  const createdBy = item.createdBy ?? actor;
  const originalPayload = item.payload ?? {};
  let schemaId;
  let payload;
  if (
    item.recordType === "assertion"
    && originalPayload.schema === KNOWLEDGE_ASSERTION_SCHEMA
  ) {
    schemaId = KNOWLEDGE_ASSERTION_SCHEMA;
    payload = originalPayload;
  } else if (item.recordType === "assertion") {
    schemaId = KNOWLEDGE_ASSERTION_SCHEMA;
    payload = {
      schema: KNOWLEDGE_ASSERTION_SCHEMA,
      subjectRef: {
        schema: KNOWLEDGE_REFERENCE_SCHEMA,
        kind: "scope",
        rootScopeId: item.rootScopeId,
        id: item.scopeId,
      },
      predicate: "fixture.value",
      value: Object.hasOwn(originalPayload, "value")
        ? originalPayload.value
        : originalPayload,
      polarity: "positive",
      applicability: originalPayload,
      confidence: 1,
      evidenceRefs: [],
    };
  } else if (
    item.recordType === "evidence"
    && originalPayload.schema === KNOWLEDGE_EVIDENCE_LINK_SCHEMA
  ) {
    schemaId = KNOWLEDGE_EVIDENCE_LINK_SCHEMA;
    payload = originalPayload;
  } else if (item.recordType === "evidence") {
    schemaId = KNOWLEDGE_EVIDENCE_LINK_SCHEMA;
    payload = {
      schema: KNOWLEDGE_EVIDENCE_LINK_SCHEMA,
      source: {
        sourceType: "test-fixture",
        sourceRef: `fixture:${item.rootScopeId}/${item.id}/${item.revision}`,
        contentHash: createHash("sha256")
          .update(JSON.stringify(originalPayload), "utf8")
          .digest("hex"),
        method: "manual",
        observedAt: createdAt,
        fragment: null,
      },
      relation: "documents",
      targetRefs: [],
      observation: originalPayload.observation ?? "Evidência sintética.",
      confidence: 1,
      evidenceRefs: [],
    };
  } else if (
    item.recordType === "decision"
    && originalPayload.schema === KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA
  ) {
    schemaId = KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA;
    payload = originalPayload;
  } else if (item.recordType === "decision") {
    schemaId = KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA;
    payload = {
      schema: KNOWLEDGE_CREATIVE_DECISION_RECORD_SCHEMA,
      question: originalPayload.decision ?? "Qual direção aprovar?",
      options: [
        { id: "option:approve", label: "Aprovar" },
        { id: "option:reject", label: "Rejeitar" },
      ],
      selectedOptionId: "option:approve",
      rationale: "Fixture humana explícita.",
      contextRefs: [{
        schema: KNOWLEDGE_REFERENCE_SCHEMA,
        kind: "scope",
        rootScopeId: item.rootScopeId,
        id: item.scopeId,
      }],
      evidenceRefs: [],
      confidence: 1,
      impact: originalPayload,
      humanConfirmed: true,
      approvedBy: actor,
      decidedAt: createdAt,
    };
  } else if (
    item.recordType === "entity"
    && originalPayload.schema === KNOWLEDGE_ENTITY_PROFILE_SCHEMA
  ) {
    schemaId = KNOWLEDGE_ENTITY_PROFILE_SCHEMA;
    payload = originalPayload;
  } else if (item.recordType === "entity") {
    schemaId = KNOWLEDGE_ENTITY_PROFILE_SCHEMA;
    payload = {
      schema: KNOWLEDGE_ENTITY_PROFILE_SCHEMA,
      entityType: "test-fixture",
      name: item.id,
      aliases: [],
      attributes: originalPayload,
      evidenceRefs: [],
    };
  } else {
    throw new Error(`Fixture sem payload canônico para ${item.recordType}.`);
  }
  const payloadBytes = JSON.stringify(payload);
  const envelope = createKnowledgeRecordEnvelope({
    classification: "internal",
    owner: {
      type: "client",
      id: item.rootScopeId,
    },
    provenance: [{
      sourceType: "test-fixture",
      sourceRef: `fixture:${item.rootScopeId}/${item.id}/${item.revision}`,
      method: "manual",
      observedAt: createdAt,
      contentHash: createHash("sha256").update(payloadBytes, "utf8").digest("hex"),
    }],
    modality: item.payload?.modality ?? "fact",
    evidenceIds: [],
    retention: { policy: "manual-review" },
    createdAt,
    createdBy,
    ...governance,
  }, { expectedActor: actor });
  return {
    ...item,
    schemaId,
    schemaVersion: 1,
    payload,
    governance: envelope,
    createdAt,
    createdBy,
  };
}

test("resolver mantém knowledge.sqlite fora de CORE e usa LOCALAPPDATA por padrão", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-path-"));
  try {
    const coreRoot = path.join(root, "CORE");
    const localAppData = path.join(root, "LocalAppData");
    assert.equal(
      resolveKnowledgeStorePath({ localAppData, coreRoot }),
      path.join(localAppData, "GeradorDeVideos", "Knowledge", "knowledge.sqlite"),
    );
    assert.throws(
      () => resolveKnowledgeStorePath({
        dbFile: path.join(coreRoot, "knowledge.sqlite"),
        coreRoot,
      }),
      /não pode ficar dentro do workspace/,
    );
    assert.throws(
      () => resolveKnowledgeStorePath({
        dbFile: path.join(root, "knowledge.db"),
        coreRoot,
      }),
      /extensão \.sqlite/,
    );
    const missingDb = path.join(root, "missing", "knowledge.sqlite");
    const uninitializedRepository = createKnowledgeStoreRepository({
      dbFile: missingDb,
      clock: () => FIXED_NOW,
    });
    assert.equal(uninitializedRepository.dbFile, missingDb);
    await assert.rejects(() => stat(missingDb), /ENOENT/);
    const missingStatus = readKnowledgeStoreStatus({
      dbFile: missingDb,
      coreRoot,
    });
    assert.equal(missingStatus.exists, false);
    assert.equal(missingStatus.initialized, false);
    const missingIntegrity = checkKnowledgeStoreIntegrity({
      dbFile: missingDb,
      coreRoot,
    });
    assert.equal(missingIntegrity.exists, false);
    assert.equal(missingIntegrity.ok, false);
    await assert.rejects(() => stat(missingDb), /ENOENT/);
    const initialized = initializeKnowledgeStore({
      dbFile: missingDb,
      coreRoot,
      clock: () => FIXED_NOW,
    });
    assert.equal(initialized.exists, true);
    assert.equal(initialized.initialized, true);
    assert.equal(initialized.userVersion, 4);
    const emptyIntegrity = checkKnowledgeStoreIntegrity({
      dbFile: missingDb,
      coreRoot,
    });
    assert.equal(emptyIntegrity.ok, true);
    assert.equal(emptyIntegrity.initialized, true);
    assert.deepEqual(emptyIntegrity.appendOnlyTriggers.missing, []);
    assert.equal("rootScopeId" in emptyIntegrity, false);
    const repeated = initializeKnowledgeStore({
      dbFile: missingDb,
      coreRoot,
      clock: () => FIXED_NOW,
    });
    assert.deepEqual(repeated.migrations, initialized.migrations);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ScopeGrant é explícito, expirável, não forjável e isola roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-scope-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const grantA = grant(["client:a"]);
    const grantB = grant(["client:b"]);
    const grantC = grant(["client:c"]);
    const multiRootReadGrant = grant(["client:a", "client:b"]);
    assert.equal(grantA.schema, SCOPE_GRANT_SCHEMA);
    assert.match(grantA.id, /^sg_[a-f0-9]{32}$/);
    assert.equal(grantA.policyId, KNOWLEDGE_POLICY_ID);
    assert.equal(grantA.policyHash, KNOWLEDGE_POLICY_HASH);
    assert.equal(Object.isFrozen(grantA), true);
    assert.equal(Object.isFrozen(grantA.rootScopeIds), true);
    createRoot(store, grantA, "client:a", "Cliente A");
    createRoot(store, grantB, "client:b", "Cliente B");
    store.createScope({
      grant: grantA,
      scope: {
        id: "project:a-1",
        rootScopeId: "client:a",
        parentScopeId: "client:a",
        kind: "project",
        name: "Projeto A",
        createdAt: FIXED_NOW,
      },
    });
    for (const [scopeGrant, rootScopeId] of [
      [grantA, "client:a"],
      [grantB, "client:b"],
    ]) {
      store.createScope({
        grant: scopeGrant,
        scope: {
          id: "project:shared",
          rootScopeId,
          parentScopeId: rootScopeId,
          kind: "project",
          name: `Projeto compartilhado em ${rootScopeId}`,
          createdAt: FIXED_NOW,
        },
      });
    }
    store.createScope({
      grant: grantA,
      scope: {
        id: "client:c",
        rootScopeId: "client:a",
        parentScopeId: "client:a",
        kind: "project",
        name: "ID que também será root de outro tenant",
        createdAt: FIXED_NOW,
      },
    });
    createRoot(store, grantC, "client:c", "Cliente C");
    assert.throws(
      () => store.createScope({
        grant: grantA,
        scope: {
          id: "project:forged-author",
          rootScopeId: "client:a",
          parentScopeId: "client:a",
          kind: "project",
          name: "Autoria inválida",
          createdBy: "outro-ator",
        },
      }),
      /deve corresponder ao actor do ScopeGrant/,
    );
    assert.throws(
      () => store.createScope({
        grant: grantA,
        scope: {
          id: "project:retroactive",
          rootScopeId: "client:a",
          parentScopeId: "client:a",
          kind: "project",
          name: "Timestamp retroativo",
          createdAt: "2026-07-23T17:59:59.999Z",
        },
      }),
      /janela issuedAt\.\.expiresAt/,
    );
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: grantA,
        item: governedItem({
          id: "fact:expired",
          revision: 1,
          rootScopeId: "client:a",
          scopeId: "client:a",
          recordType: "assertion",
          payload: {},
          createdAt: GRANT_EXPIRY,
        }),
      }),
      /janela issuedAt\.\.expiresAt/,
    );
    assert.throws(
      () => store.createRelease({
        grant: grantA,
        rootScopeId: "client:a",
        label: "release retroativa",
        createdAt: "2026-07-23T17:59:59.999Z",
      }),
      /janela issuedAt\.\.expiresAt/,
    );
    assert.equal(
      store.getScope({
        grant: grantA,
        rootScopeId: "client:a",
        scopeId: "project:shared",
      }).rootScopeId,
      "client:a",
    );
    assert.equal(
      store.getScope({
        grant: grantB,
        rootScopeId: "client:b",
        scopeId: "project:shared",
      }).rootScopeId,
      "client:b",
    );
    assert.equal(
      store.getScope({
        grant: multiRootReadGrant,
        rootScopeId: "client:a",
        scopeId: "client:a",
      }).rootScopeId,
      "client:a",
    );
    const ledgerHeadBeforeRejectedWrite = store.checkIntegrity({
      grant: grantA,
      rootScopeId: "client:a",
    }).ledgerHead;
    assert.throws(
      () => store.createScope({
        grant: multiRootReadGrant,
        scope: {
          id: "project:multi-root-write",
          rootScopeId: "client:a",
          parentScopeId: "client:a",
          kind: "project",
          name: "Não deve persistir capability de outro root",
          createdAt: FIXED_NOW,
        },
      }),
      /dedicado a um único root/,
    );
    assert.equal(
      store.getScope({
        grant: grantA,
        rootScopeId: "client:a",
        scopeId: "project:multi-root-write",
      }),
      null,
    );
    assert.equal(
      store.checkIntegrity({
        grant: grantA,
        rootScopeId: "client:a",
      }).ledgerHead,
      ledgerHeadBeforeRejectedWrite,
    );
    assert.equal(
      store.getScope({
        grant: grantA,
        rootScopeId: "client:a",
        scopeId: "project:a-1",
      }).name,
      "Projeto A",
    );
    assert.throws(
      () => store.getScope({
        grant: grantA,
        rootScopeId: "client:b",
        scopeId: "client:b",
      }),
      /não autoriza o root scope/,
    );
    assert.throws(
      () => store.getScope({
        grant: structuredClone(grantA),
        rootScopeId: "client:a",
        scopeId: "client:a",
      }),
      /não emitido por este runtime/,
    );
    assert.throws(
      () => createScopeGrant({
        rootScopeIds: ["client:a"],
        permissions: ["read"],
        actor: "test-suite",
        purpose: "expired",
        issuedAt: "2026-07-23T16:00:00.000Z",
        expiresAt: "2026-07-23T17:00:00.000Z",
      }) && store.getScope({
        grant: createScopeGrant({
          rootScopeIds: ["client:a"],
          permissions: ["read"],
          actor: "test-suite",
          purpose: "expired",
          issuedAt: "2026-07-23T16:00:00.000Z",
          expiresAt: "2026-07-23T17:00:00.000Z",
        }),
        rootScopeId: "client:a",
        scopeId: "client:a",
      }),
      /expirado/,
    );
    const futureGrant = createScopeGrant({
      rootScopeIds: ["client:a"],
      permissions: ["read"],
      actor: "test-suite",
      purpose: "not valid yet",
      issuedAt: "2026-07-23T18:30:00.000Z",
      expiresAt: "2026-07-23T19:30:00.000Z",
    });
    assert.throws(
      () => store.getScope({
        grant: futureGrant,
        rootScopeId: "client:a",
        scopeId: "client:a",
      }),
      /ainda não é válido/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("item exige envelope íntegro, autoria coerente e não confunde rights com autorização", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-envelope-gate-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const writeGrant = grant(["client:a"]);
    createRoot(store, writeGrant, "client:a", "Cliente A");
    const baseItem = {
      id: "fact:governed",
      revision: 1,
      rootScopeId: "client:a",
      scopeId: "client:a",
      recordType: "assertion",
      payload: { statement: "gate obrigatório" },
      createdAt: "2026-07-23T18:01:00.000Z",
      createdBy: "test-suite",
    };

    assert.throws(
      () => store.appendKnowledgeItem({
        grant: writeGrant,
        item: baseItem,
      }),
      /item\.governance é obrigatório/,
    );

    const accepted = store.appendKnowledgeItem({
      grant: writeGrant,
      item: governedItem(baseItem),
    });
    assert.deepEqual(
      Object.values(accepted.governance.rights),
      Array(8).fill("unknown"),
    );
    assert.equal(accepted.createdAt, accepted.governance.createdAt);
    assert.equal(accepted.createdBy, accepted.governance.createdBy);

    const tampered = structuredClone(governedItem({
      ...baseItem,
      id: "fact:tampered-envelope",
    }));
    tampered.governance.hash = "0".repeat(64);
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: writeGrant,
        item: tampered,
      }),
      /hash inválido/,
    );

    const divergentActor = governedItem({
      ...baseItem,
      id: "fact:divergent-actor",
      createdBy: "other-actor",
    }, { actor: "other-actor" });
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: writeGrant,
        item: divergentActor,
      }),
      /createdBy diverge do actor esperado/,
    );

    const divergentTimestamp = {
      ...governedItem({
        ...baseItem,
        id: "fact:divergent-timestamp",
      }),
      createdAt: "2026-07-23T18:02:00.000Z",
    };
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: writeGrant,
        item: divergentTimestamp,
      }),
      /devem corresponder ao item\.governance/,
    );

    const readOnlyGrant = grant(["client:a"], ["read"]);
    const rightsAllowed = Object.fromEntries([
      "inventory",
      "localAnalysis",
      "textualIndexing",
      "embedding",
      "training",
      "providerInput",
      "publication",
      "reuse",
    ].map((right) => [right, "allowed"]));
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: readOnlyGrant,
        item: governedItem({
          ...baseItem,
          id: "fact:rights-are-not-grant",
        }, {
          governance: { rights: rightsAllowed },
        }),
      }),
      /não autoriza write/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revisões e ledger são append-only e preservam payload histórico", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-ledger-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    const first = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "preference:cta-hold",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: {
          modality: "preference",
          predicate: "cta.minimumHoldFrames",
          value: 24,
        },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    assert.equal(first.schema, KNOWLEDGE_ITEM_SCHEMA);
    assert.equal(first.revision, 1);
    const second = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: first.id,
        revision: 2,
        supersedesRevision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: {
          modality: "preference",
          predicate: "cta.minimumHoldFrames",
          value: 36,
        },
        createdAt: "2026-07-23T18:02:00.000Z",
      }),
    });
    assert.equal(second.revision, 2);
    assert.equal(
      store.getKnowledgeItem({
        grant: scopeGrant,
        rootScopeId: "client:a",
        id: first.id,
        revision: 1,
      }).payload.value,
      24,
    );
    assert.equal(
      store.getKnowledgeItem({
        grant: scopeGrant,
        rootScopeId: "client:a",
        id: first.id,
      }).payload.value,
      36,
    );
    assert.deepEqual(
      store.listKnowledgeItems({
        grant: scopeGrant,
        rootScopeId: "client:a",
        history: true,
      }).map((item) => item.revision),
      [1, 2],
    );
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: scopeGrant,
        item: governedItem({
          id: first.id,
          revision: 4,
          supersedesRevision: 2,
          rootScopeId: "client:a",
          scopeId: "client:a",
          recordType: "assertion",
          payload: {},
        }),
      }),
      /Nova revisão deve ser 3/,
    );

    const direct = new DatabaseSync(dbFile);
    try {
      const eventRows = direct.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE root_scope_id=?
        ORDER BY sequence
      `).all("client:a");
      assert.equal(eventRows.length, 3);
      for (const event of eventRows) {
        assert.equal(event.grant_id, scopeGrant.id);
        assert.equal(event.grant_hash, scopeGrant.hash);
        assert.equal(event.policy_id, scopeGrant.policyId);
        assert.equal(event.policy_hash, scopeGrant.policyHash);
        assert.equal(event.actor, scopeGrant.actor);
        assert.equal(event.grant_permission, "write");
        assert.equal(event.grant_issued_at, scopeGrant.issuedAt);
        assert.equal(event.grant_expires_at, scopeGrant.expiresAt);
        assert.equal(event.grant_json, canonicalJson(scopeGrant));
      }
      assert.throws(
        () => direct.prepare(`
          UPDATE knowledge_items
          SET status='revoked'
          WHERE root_scope_id='client:a'
        `).run(),
        /append-only/,
      );
      assert.throws(
        () => direct.prepare(`
          DELETE FROM knowledge_events
          WHERE root_scope_id='client:a'
        `).run(),
        /append-only/,
      );
    } finally {
      direct.close();
    }
    const integrity = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(integrity.ok, true);
    assert.match(integrity.ledgerHead, /^[a-f0-9]{64}$/);
    assert.deepEqual(integrity.issues, []);
    const globalIntegrity = checkKnowledgeStoreIntegrity({ dbFile });
    assert.deepEqual(globalIntegrity.grantEvidence, {
      canonicalEventCount: 3,
      legacyEventCount: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release congela revisões exatas e export permanece byte a byte determinístico", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-release-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const grantA = grant(["client:a"]);
    const grantB = grant(["client:b"]);
    createRoot(store, grantA, "client:a", "Cliente A");
    createRoot(store, grantB, "client:b", "Cliente B");
    const first = store.appendKnowledgeItem({
      grant: grantA,
      item: governedItem({
        id: "rule:brand-color",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { value: "#112233", privateText: "somente-A" },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    store.appendKnowledgeItem({
      grant: grantB,
      item: governedItem({
        id: "rule:secret-b",
        revision: 1,
        rootScopeId: "client:b",
        scopeId: "client:b",
        recordType: "assertion",
        payload: { privateText: "segredo-do-cliente-B" },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const release = store.createRelease({
      grant: grantA,
      rootScopeId: "client:a",
      label: "baseline aprovado",
      members: [{ id: first.id, revision: first.revision }],
      createdAt: "2026-07-23T18:03:00.000Z",
    });
    assert.equal(release.schema, KNOWLEDGE_RELEASE_SCHEMA);
    assert.deepEqual(release.members.map((member) => member.revision), [1]);
    const exportBefore = store.exportKnowledge({
      grant: grantA,
      rootScopeId: "client:a",
      releaseId: release.id,
    });
    assert.equal(exportBefore.schema, KNOWLEDGE_EXPORT_SCHEMA);
    const bytesBefore = store.serializeExport(exportBefore);

    store.appendKnowledgeItem({
      grant: grantA,
      item: governedItem({
        id: first.id,
        revision: 2,
        supersedesRevision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { value: "#445566", privateText: "somente-A" },
        createdAt: "2026-07-23T18:04:00.000Z",
      }),
    });
    const reopened = repository(dbFile);
    const exportAfter = reopened.exportKnowledge({
      grant: grantA,
      rootScopeId: "client:a",
      releaseId: release.id,
    });
    assert.equal(reopened.serializeExport(exportAfter), bytesBefore);
    assert.equal(exportAfter.items[0].payload.value, "#112233");

    const scopeBytes = reopened.serializeExport(reopened.exportKnowledge({
      grant: grantA,
      rootScopeId: "client:a",
    }));
    assert.equal(scopeBytes.includes("somente-A"), true);
    assert.equal(scopeBytes.includes("segredo-do-cliente-B"), false);
    assert.equal(scopeBytes.includes("client:b"), false);
    assert.equal(
      reopened.checkIntegrity({
        grant: grantA,
        rootScopeId: "client:a",
      }).ok,
      true,
    );

    const filesBeforeReadOnlyChecks = (await readdir(root)).sort();
    const mtimeBeforeReadOnlyChecks = (await stat(dbFile)).mtimeMs;
    const scopeExportBeforeReadOnlyChecks = reopened.serializeExport(
      reopened.exportKnowledge({
        grant: grantA,
        rootScopeId: "client:a",
      }),
    );
    const status = readKnowledgeStoreStatus({ dbFile });
    assert.equal(status.initialized, true);
    assert.deepEqual(status.ledgerHeads, []);
    assert.equal(status.ledgerSummary.rootCount, 2);
    assert.equal(status.ledgerSummary.eventCount, 6);
    assert.match(status.ledgerSummary.headsAggregateHash, /^[a-f0-9]{64}$/);
    const storeIntegrity = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(storeIntegrity.ok, true);
    assert.equal("rootScopeId" in storeIntegrity, false);
    assert.equal(
      reopened.checkIntegrity({
        grant: grantA,
        rootScopeId: "client:a",
      }).ok,
      true,
    );
    const scopeExportAfterReadOnlyChecks = reopened.serializeExport(
      reopened.exportKnowledge({
        grant: grantA,
        rootScopeId: "client:a",
      }),
    );
    assert.equal(
      scopeExportAfterReadOnlyChecks,
      scopeExportBeforeReadOnlyChecks,
    );
    assert.deepEqual(
      (await readdir(root)).sort(),
      filesBeforeReadOnlyChecks,
    );
    assert.equal((await stat(dbFile)).mtimeMs, mtimeBeforeReadOnlyChecks);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("autorização de replay revalida rights, retenção e head atual", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-replay-auth-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    const item = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "principle:timing",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { timing: "preciso" },
        createdAt: FIXED_NOW,
      }, {
        governance: {
          rights: {
            localAnalysis: "allowed",
          },
        },
      }),
    });
    const release = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      label: "release replay autorizada",
      members: [{ id: item.id, revision: item.revision }],
      createdAt: FIXED_NOW,
    });
    const authorization = store.authorizeReplay({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: release.id,
    });
    assert.equal(
      authorization.schema,
      "mkt-videos/knowledge-replay-authorization@1",
    );
    assert.equal(Object.isFrozen(authorization), true);
    assert.equal(authorization.releaseHash, release.hash);
    assert.match(authorization.rightsHeadHash, /^[a-f0-9]{64}$/);
    assert.equal("rootScopeId" in authorization, false);

    assert.throws(
      () => store.authorizeReplay({
        grant: grant(["client:a"], ["read"]),
        rootScopeId: "client:a",
        releaseId: release.id,
      }),
      /não autoriza integrity/,
    );

    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: item.id,
        revision: 2,
        supersedesRevision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        status: "revoked",
        payload: { timing: "revogado" },
        createdAt: FIXED_NOW,
      }, {
        governance: {
          rights: {
            localAnalysis: "revoked",
          },
        },
      }),
    });
    assert.throws(
      () => store.authorizeReplay({
        grant: scopeGrant,
        rootScopeId: "client:a",
        releaseId: release.id,
      }),
      /Current head 0 não está active|não autoriza localAnalysis/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ativação e rollback de release são append-only, CAS e revalidam elegibilidade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-activation-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    const item = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "principle:active-release",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { rule: "movimento legível" },
        createdAt: FIXED_NOW,
      }, {
        governance: {
          rights: {
            localAnalysis: "allowed",
          },
        },
      }),
    });
    const release1 = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: "release:a-v1",
      label: "Release A v1",
      members: [{ id: item.id, revision: item.revision }],
      createdAt: "2026-07-23T18:01:00.000Z",
    });
    const release2 = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: "release:a-v2",
      label: "Release A v2",
      previousReleaseId: release1.id,
      members: [{ id: item.id, revision: item.revision }],
      createdAt: "2026-07-23T18:02:00.000Z",
    });
    const releaseOutsideLineage = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: "release:a-other",
      label: "Outra raiz",
      members: [{ id: item.id, revision: item.revision }],
      createdAt: "2026-07-23T18:02:30.000Z",
    });

    const activation1 = store.activateRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: release1.id,
      expectedReleaseHash: release1.hash,
      expectedCurrentActivationId: null,
      reason: "aprovação humana inicial",
      createdAt: "2026-07-23T18:03:00.000Z",
    });
    assert.equal(activation1.sequence, 1);
    assert.equal(activation1.mode, "activate");
    assert.equal(activation1.previousActivationId, null);

    const activation2 = store.activateRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: release2.id,
      expectedReleaseHash: release2.hash,
      expectedCurrentActivationId: activation1.id,
      reason: "aprovação humana da sucessora",
      createdAt: "2026-07-23T18:04:00.000Z",
    });
    assert.equal(activation2.sequence, 2);
    assert.equal(activation2.previousActiveReleaseId, release1.id);
    assert.throws(
      () => store.activateRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
        releaseId: release2.id,
        expectedReleaseHash: release2.hash,
        expectedCurrentActivationId: activation1.id,
        reason: "CAS obsoleto",
        createdAt: "2026-07-23T18:04:30.000Z",
      }),
      /Ativação corrente diverge/,
    );
    assert.throws(
      () => store.rollbackRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
        releaseId: releaseOutsideLineage.id,
        expectedReleaseHash: releaseOutsideLineage.hash,
        expectedCurrentActivationId: activation2.id,
        reason: "não é ancestral",
        createdAt: "2026-07-23T18:04:30.000Z",
      }),
      /release ancestral/,
    );

    const rollback = store.rollbackRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: release1.id,
      expectedReleaseHash: release1.hash,
      expectedCurrentActivationId: activation2.id,
      reason: "rollback humano comprovado",
      createdAt: "2026-07-23T18:05:00.000Z",
    });
    assert.equal(rollback.sequence, 3);
    assert.equal(rollback.mode, "rollback");
    assert.equal(rollback.previousActiveReleaseId, release2.id);
    const active = store.getActiveRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(active.release.id, release1.id);
    assert.equal(active.release.hash, release1.hash);
    assert.deepEqual(
      store.listReleaseActivations({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }).map(({ id, sequence }) => ({ id, sequence })),
      [
        { id: activation1.id, sequence: 1 },
        { id: activation2.id, sequence: 2 },
        { id: rollback.id, sequence: 3 },
      ],
    );
    assert.equal(
      store.inspectActiveRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }).eligible,
      true,
    );

    const direct = new DatabaseSync(dbFile);
    try {
      assert.throws(
        () => direct.prepare(`
          UPDATE knowledge_release_activations
          SET reason='alterado'
          WHERE root_scope_id='client:a'
        `).run(),
        /append-only/,
      );
      assert.throws(
        () => direct.prepare(`
          DELETE FROM knowledge_release_activations
          WHERE root_scope_id='client:a'
        `).run(),
        /append-only/,
      );
    } finally {
      direct.close();
    }

    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: item.id,
        revision: 2,
        supersedesRevision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        status: "revoked",
        payload: { rule: "revogado" },
        createdAt: "2026-07-23T18:06:00.000Z",
      }, {
        governance: {
          rights: {
            localAnalysis: "revoked",
          },
        },
      }),
    });
    const invalidated = store.inspectActiveRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(invalidated.active, true);
    assert.equal(invalidated.eligible, false);
    assert.deepEqual(
      invalidated.issues,
      [{ type: "active-release-ineligible" }],
    );
    assert.equal(
      store.checkIntegrity({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }).ok,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promoção e quarentena exigem decisão humana append-only e bloqueiam release ativa", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-review-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const grantA = grant(["client:a"]);
    const grantB = grant(["client:b"]);
    const multiRootGrant = grant(["client:a", "client:b"]);
    createRoot(store, grantA, "client:a", "Cliente A");
    createRoot(store, grantB, "client:b", "Cliente B");
    const evidenceA = store.appendKnowledgeItem({
      grant: grantA,
      item: governedItem({
        id: "evidence:a",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "evidence",
        payload: { observation: "aprovação documentada" },
        createdAt: FIXED_NOW,
      }),
    });
    store.appendKnowledgeItem({
      grant: grantB,
      item: governedItem({
        id: "evidence:b-only",
        revision: 1,
        rootScopeId: "client:b",
        scopeId: "client:b",
        recordType: "evidence",
        payload: { observation: "não pertence ao cliente A" },
        createdAt: FIXED_NOW,
      }),
    });
    const candidate = store.appendKnowledgeItem({
      grant: grantA,
      item: governedItem({
        id: "decision:reviewed",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "decision",
        status: "candidate",
        payload: { decision: "direção a aprovar" },
        createdAt: FIXED_NOW,
      }, {
        governance: {
          rights: { localAnalysis: "allowed" },
        },
      }),
    });

    assert.throws(
      () => store.appendKnowledgeItem({
        grant: grantA,
        item: governedItem({
          id: candidate.id,
          revision: 2,
          supersedesRevision: 1,
          rootScopeId: "client:a",
          scopeId: "client:a",
          recordType: "decision",
          status: "active",
          payload: candidate.payload,
          createdAt: FIXED_NOW,
        }),
      }),
      /exige reviewKnowledgeItem/,
    );
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: grantA,
        item: governedItem({
          id: candidate.id,
          revision: 2,
          supersedesRevision: 1,
          rootScopeId: "client:a",
          scopeId: "client:a",
          recordType: "decision",
          status: "quarantined",
          payload: candidate.payload,
          createdAt: FIXED_NOW,
        }),
      }),
      /decisão humana/,
    );
    assert.throws(
      () => store.reviewKnowledgeItem({
        grant: multiRootGrant,
        rootScopeId: "client:a",
        itemId: candidate.id,
        expectedRevision: candidate.revision,
        expectedContentHash: candidate.contentHash,
        action: "promote",
        reason: "evidência cross-root deve falhar",
        evidenceIds: ["evidence:b-only"],
        reviewedAt: FIXED_NOW,
      }),
      /não pertence ao root autorizado/,
    );
    assert.throws(
      () => store.reviewKnowledgeItem({
        grant: grantA,
        rootScopeId: "client:a",
        itemId: candidate.id,
        expectedRevision: candidate.revision,
        expectedContentHash: "0".repeat(64),
        action: "promote",
        reason: "CAS obsoleto",
        evidenceIds: [],
        reviewedAt: FIXED_NOW,
      }),
      /diverge de expectedRevision\/expectedContentHash/,
    );
    assert.deepEqual(
      store.listReviewDecisions({
        grant: grantA,
        rootScopeId: "client:a",
      }),
      [],
    );

    const promoted = store.reviewKnowledgeItem({
      grant: grantA,
      rootScopeId: "client:a",
      itemId: candidate.id,
      expectedRevision: candidate.revision,
      expectedContentHash: candidate.contentHash,
      action: "promote",
      reason: "aprovação humana explícita",
      evidenceIds: [evidenceA.id],
      reviewedAt: FIXED_NOW,
    });
    assert.equal(
      promoted.decision.schema,
      KNOWLEDGE_REVIEW_DECISION_SCHEMA,
    );
    assert.equal(promoted.decision.action, "promote");
    assert.equal(promoted.item.status, "active");
    assert.equal(promoted.item.revision, 2);
    assert.deepEqual(promoted.item.payload, candidate.payload);
    assert.deepEqual(
      promoted.item.governance.owner,
      candidate.governance.owner,
    );
    assert.deepEqual(
      promoted.item.governance.rights,
      candidate.governance.rights,
    );
    assert.deepEqual(
      promoted.item.governance.retention,
      candidate.governance.retention,
    );
    assert.deepEqual(
      promoted.item.governance.evidenceIds,
      [],
    );
    assert.equal(
      store.getReviewDecision({
        grant: grantA,
        rootScopeId: "client:a",
        decisionId: promoted.decision.id,
      }).hash,
      promoted.decision.hash,
    );
    assert.throws(
      () => store.reviewKnowledgeItem({
        grant: grantA,
        rootScopeId: "client:a",
        itemId: candidate.id,
        expectedRevision: promoted.item.revision,
        expectedContentHash: promoted.item.contentHash,
        action: "promote",
        reason: "não pode promover duas vezes",
        evidenceIds: [],
        reviewedAt: FIXED_NOW,
      }),
      /head candidate/,
    );

    const release = store.createRelease({
      grant: grantA,
      rootScopeId: "client:a",
      label: "Release antes da quarentena",
      members: [{
        id: promoted.item.id,
        revision: promoted.item.revision,
      }],
      createdAt: FIXED_NOW,
    });
    const activation = store.activateRelease({
      grant: grantA,
      rootScopeId: "client:a",
      releaseId: release.id,
      expectedReleaseHash: release.hash,
      expectedCurrentActivationId: null,
      reason: "ativação humana antes da quarentena",
      createdAt: FIXED_NOW,
    });
    const quarantined = store.reviewKnowledgeItem({
      grant: grantA,
      rootScopeId: "client:a",
      itemId: promoted.item.id,
      expectedRevision: promoted.item.revision,
      expectedContentHash: promoted.item.contentHash,
      action: "quarantine",
      reason: "revisão humana retirou o conhecimento de uso",
      evidenceIds: [],
      reviewedAt: FIXED_NOW,
    });
    assert.equal(quarantined.decision.action, "quarantine");
    assert.equal(quarantined.item.status, "quarantined");
    assert.equal(quarantined.item.revision, 3);
    assert.deepEqual(quarantined.item.payload, promoted.item.payload);
    assert.equal(
      store.inspectActiveRelease({
        grant: grantA,
        rootScopeId: "client:a",
        at: FIXED_NOW,
      }).eligible,
      false,
    );
    assert.throws(
      () => store.authorizeReplay({
        grant: grantA,
        rootScopeId: "client:a",
        releaseId: release.id,
        expectedReleaseHash: release.hash,
        at: FIXED_NOW,
      }),
      /não está active/,
    );
    assert.equal(
      store.listReviewDecisions({
        grant: grantA,
        rootScopeId: "client:a",
      }).length,
      2,
    );
    assert.equal(
      store.getActiveRelease({
        grant: grantA,
        rootScopeId: "client:a",
      }).activation.id,
      activation.id,
    );
    const scopeExport = store.exportKnowledge({
      grant: grantA,
      rootScopeId: "client:a",
    });
    assert.equal(scopeExport.reviewDecisions.length, 2);
    assert.equal(scopeExport.releaseActivations.length, 1);
    const releaseExport = store.exportKnowledge({
      grant: grantA,
      rootScopeId: "client:a",
      releaseId: release.id,
    });
    assert.equal(releaseExport.reviewDecisions.length, 1);
    assert.equal(
      releaseExport.reviewDecisions[0].id,
      promoted.decision.id,
    );
    assert.equal(releaseExport.releaseActivations.length, 1);
    assert.equal(
      releaseExport.releaseActivations[0].id,
      activation.id,
    );
    assert.equal(
      store.checkIntegrity({
        grant: grantA,
        rootScopeId: "client:a",
      }).ok,
      true,
    );

    const direct = new DatabaseSync(dbFile);
    try {
      assert.throws(
        () => direct.prepare(`
          UPDATE knowledge_review_decisions
          SET reason='adulterado'
          WHERE root_scope_id=? AND decision_id=?
        `).run("client:a", promoted.decision.id),
        /append-only/,
      );
      assert.throws(
        () => direct.prepare(`
          DELETE FROM knowledge_review_decisions
          WHERE root_scope_id=? AND decision_id=?
        `).run("client:a", promoted.decision.id),
        /append-only/,
      );
    } finally {
      direct.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integrity detecta adulteração sem reparar ou apagar evidência", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-integrity-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:duration",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { seconds: 8 },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const direct = new DatabaseSync(dbFile);
    try {
      direct.exec("DROP TRIGGER knowledge_items_no_update");
      direct.prepare(`
        UPDATE knowledge_items
        SET body_json=?
        WHERE root_scope_id=? AND item_id=? AND revision=?
      `).run(
        JSON.stringify({
          schema: KNOWLEDGE_ITEM_SCHEMA,
          id: "fact:duration",
          revision: 1,
          rootScopeId: "client:a",
          scopeId: "client:a",
          recordType: "assertion",
          schemaId: KNOWLEDGE_ITEM_SCHEMA,
          schemaVersion: 1,
          status: "active",
          supersedesRevision: null,
          payload: { seconds: 999 },
          createdAt: "2026-07-23T18:01:00.000Z",
          createdBy: "test-suite",
        }),
        "client:a",
        "fact:duration",
        1,
      );
    } finally {
      direct.close();
    }
    const report = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(report.ok, false);
    assert.equal(
      report.issues.some((issue) => issue.type === "item-hash"),
      true,
    );
    const globalReport = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(globalReport.ok, false);
    assert.equal(
      globalReport.issues.some(
        (issue) => issue.type === "append-only-boundary",
      ),
      true,
    );
    assert.equal(JSON.stringify(globalReport).includes("client:a"), false);
    assert.equal(JSON.stringify(globalReport).includes("fact:duration"), false);
    assert.throws(
      () => store.getKnowledgeItem({
        grant: scopeGrant,
        rootScopeId: "client:a",
        id: "fact:duration",
        revision: 1,
      }),
      /fail-closed/,
    );
    const preserved = new DatabaseSync(dbFile, { readOnly: true });
    try {
      assert.equal(
        JSON.parse(preserved.prepare(`
          SELECT body_json
          FROM knowledge_items
          WHERE root_scope_id=? AND item_id=? AND revision=1
        `).get("client:a", "fact:duration").body_json).payload.seconds,
        999,
      );
    } finally {
      preserved.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolver protege todo o workspace e rejeita symlink e hardlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-path-hardening-"));
  try {
    const workspace = path.join(root, "workspace");
    const coreRoot = path.join(workspace, "CORE");
    const external = path.join(root, "external");
    await mkdir(path.join(workspace, ".git"), { recursive: true });
    await mkdir(coreRoot, { recursive: true });
    await mkdir(external, { recursive: true });
    assert.throws(
      () => resolveKnowledgeStorePath({
        dbFile: path.join(workspace, "private", "knowledge.sqlite"),
        coreRoot,
      }),
      /dentro do workspace/,
    );

    const source = path.join(external, "source.sqlite");
    const sourceDb = new DatabaseSync(source);
    sourceDb.close();
    const hardlink = path.join(external, "hardlink.sqlite");
    await link(source, hardlink);
    assert.throws(
      () => resolveKnowledgeStorePath({ dbFile: hardlink, coreRoot }),
      /hardlink/,
    );

    const actualDirectory = path.join(external, "actual");
    const linkedDirectory = path.join(external, "linked");
    await mkdir(actualDirectory);
    await symlink(actualDirectory, linkedDirectory, "junction");
    assert.throws(
      () => resolveKnowledgeStorePath({
        dbFile: path.join(linkedDirectory, "knowledge.sqlite"),
        coreRoot,
      }),
      /links simbólicos/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes não inicializam implicitamente e init recusa SQLite desconhecido", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-explicit-init-"));
  try {
    const coreRoot = path.join(root, "CORE");
    const missingDb = path.join(root, "missing", "knowledge.sqlite");
    const missingStore = createKnowledgeStoreRepository({
      dbFile: missingDb,
      coreRoot,
      clock: () => FIXED_NOW,
    });
    assert.throws(
      () => createRoot(
        missingStore,
        grant(["client:a"]),
        "client:a",
        "Cliente A",
      ),
      /não inicializado/,
    );
    await assert.rejects(() => stat(missingDb), /ENOENT/);

    const unknownDbFile = path.join(root, "unknown.sqlite");
    const unknownDb = new DatabaseSync(unknownDbFile);
    unknownDb.exec("CREATE TABLE unrelated(value TEXT) STRICT;");
    unknownDb.prepare("INSERT INTO unrelated(value) VALUES (?)").run("preservar");
    unknownDb.close();
    assert.throws(
      () => initializeKnowledgeStore({
        dbFile: unknownDbFile,
        coreRoot,
        clock: () => FIXED_NOW,
      }),
      /não pertence ao Knowledge Store/,
    );
    const reopened = new DatabaseSync(unknownDbFile, { readOnly: true });
    try {
      assert.equal(
        reopened.prepare("SELECT value FROM unrelated").get().value,
        "preservar",
      );
      assert.equal(
        reopened.prepare(`
          SELECT COUNT(*) AS count
          FROM sqlite_schema
          WHERE name='knowledge_migrations'
        `).get().count,
        0,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrations exigem versão exata, sequência contínua e hash normalizado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-migrations-"));
  try {
    const coreRoot = path.join(root, "CORE");
    const cases = [
      {
        name: "future-user-version",
        mutate(db) {
          db.exec("PRAGMA user_version=5");
        },
      },
      {
        name: "unknown",
        mutate(db) {
          db.prepare(`
            INSERT INTO knowledge_migrations(
              version,migration_id,migration_hash,applied_at
            ) VALUES (5,'005-unknown',?,?)
          `).run("a".repeat(64), FIXED_NOW.toISOString());
          db.exec("PRAGMA user_version=5");
        },
      },
      {
        name: "divergent-hash",
        mutate(db) {
          db.exec("DROP TRIGGER knowledge_migrations_no_update");
          db.prepare(`
            UPDATE knowledge_migrations
            SET migration_hash=?
            WHERE version=1
          `).run("b".repeat(64));
        },
      },
      {
        name: "gap",
        mutate(db) {
          db.exec("DROP TRIGGER knowledge_migrations_no_delete");
          db.prepare("DELETE FROM knowledge_migrations WHERE version=1").run();
          db.exec("PRAGMA user_version=4");
        },
      },
    ];
    for (const migrationCase of cases) {
      const dbFile = path.join(root, `${migrationCase.name}.sqlite`);
      initializeKnowledgeStore({
        dbFile,
        coreRoot,
        clock: () => FIXED_NOW,
      });
      if (migrationCase.name === "future-user-version") {
        const applied = new DatabaseSync(dbFile, { readOnly: true });
        try {
          const storedHash = applied.prepare(`
            SELECT migration_hash
            FROM knowledge_migrations
            WHERE version=1
          `).get().migration_hash;
          const normalizedSql = (await readFile(
            new URL("../knowledge/migrations/001-knowledge-store.sql", import.meta.url),
            "utf8",
          ))
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?/g, "\n");
          assert.equal(
            storedHash,
            createHash("sha256").update(normalizedSql, "utf8").digest("hex"),
          );
        } finally {
          applied.close();
        }
      }
      const direct = new DatabaseSync(dbFile);
      try {
        migrationCase.mutate(direct);
      } finally {
        direct.close();
      }
      const status = readKnowledgeStoreStatus({ dbFile, coreRoot });
      assert.equal(status.issues.length > 0, true, migrationCase.name);
      assert.throws(
        () => initializeKnowledgeStore({
          dbFile,
          coreRoot,
          clock: () => FIXED_NOW,
        }),
        /migration|user_version|histórico/,
        migrationCase.name,
      );
      const store = createKnowledgeStoreRepository({
        dbFile,
        coreRoot,
        clock: () => FIXED_NOW,
      });
      assert.throws(
        () => createRoot(
          store,
          grant(["client:new"]),
          "client:new",
          "Não deve ser escrito",
        ),
        /histórico de migrations/,
        migrationCase.name,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration v1→v4 preserva itens, ledger e release históricos", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-v1-v2-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    const item = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:migration-preserved",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { preserved: true },
        createdAt: FIXED_NOW,
      }),
    });
    const release = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: "release:migration-v1",
      label: "Release anterior à activation",
      members: [{ id: item.id, revision: item.revision }],
      createdAt: FIXED_NOW,
    });
    const direct = new DatabaseSync(dbFile);
    try {
      const eventUpdateTrigger = direct.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type='trigger' AND name='knowledge_events_no_update'
      `).get().sql;
      direct.exec("DROP TRIGGER knowledge_events_no_update");
      let previousEventHash = null;
      for (const row of direct.prepare(`
        SELECT *
        FROM knowledge_events
        ORDER BY sequence
      `).all()) {
        const eventHash = digest(canonicalJson(
          legacyEventHashBody(row, previousEventHash),
        ));
        direct.prepare(`
          UPDATE knowledge_events
          SET previous_event_hash=?,event_hash=?
          WHERE sequence=?
        `).run(previousEventHash, eventHash, row.sequence);
        previousEventHash = eventHash;
      }
      direct.exec("DROP TRIGGER knowledge_events_require_grant_json");
      direct.exec("ALTER TABLE knowledge_events DROP COLUMN grant_json");
      direct.exec(eventUpdateTrigger);
      direct.exec(`
        DROP TRIGGER knowledge_review_decisions_no_update;
        DROP TRIGGER knowledge_review_decisions_no_delete;
        DROP TABLE knowledge_review_decisions;
        DROP TRIGGER knowledge_release_activations_no_update;
        DROP TRIGGER knowledge_release_activations_no_delete;
        DROP TABLE knowledge_release_activations;
        DROP TRIGGER knowledge_migrations_no_update;
        DROP TRIGGER knowledge_migrations_no_delete;
        DELETE FROM knowledge_migrations WHERE version IN (2,3,4);
        CREATE TRIGGER knowledge_migrations_no_update
        BEFORE UPDATE ON knowledge_migrations
        BEGIN
          SELECT RAISE(ABORT, 'knowledge_migrations is append-only');
        END;
        CREATE TRIGGER knowledge_migrations_no_delete
        BEFORE DELETE ON knowledge_migrations
        BEGIN
          SELECT RAISE(ABORT, 'knowledge_migrations is append-only');
        END;
        PRAGMA user_version=1;
      `);
    } finally {
      direct.close();
    }

    const migrated = initializeKnowledgeStore({
      dbFile,
      clock: () => FIXED_NOW,
    });
    assert.equal(migrated.userVersion, 4);
    assert.equal(migrated.migrations.length, 4);
    const reopened = createKnowledgeStoreRepository({
      dbFile,
      clock: () => FIXED_NOW,
    });
    const after = reopened.exportKnowledge({
      grant: scopeGrant,
      rootScopeId: "client:a",
      releaseId: release.id,
    });
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0].id, item.id);
    assert.equal(after.releases.length, 1);
    assert.equal(after.releases[0].id, release.id);
    assert.equal(after.events.length, 0);
    const migratedIntegrity = checkKnowledgeStoreIntegrity({ dbFile });
    assert.deepEqual(migratedIntegrity.grantEvidence, {
      canonicalEventCount: 0,
      legacyEventCount: 3,
    });
    assert.equal(
      reopened.checkIntegrity({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }).ok,
      true,
    );
    assert.equal(
      reopened.getActiveRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integridade global valida definição e conteúdo sem vazar IDs privados", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-global-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:private"]);
    createRoot(store, scopeGrant, "client:private", "Cliente sigiloso");
    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:private-duration",
        revision: 1,
        rootScopeId: "client:private",
        scopeId: "client:private",
        recordType: "assertion",
        payload: { seconds: 8, secret: "nao-vazar-este-payload" },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const direct = new DatabaseSync(dbFile);
    try {
      direct.exec("DROP TRIGGER knowledge_items_no_update");
      direct.exec(`
        CREATE TRIGGER knowledge_items_no_update
        BEFORE UPDATE ON knowledge_items
        BEGIN
          SELECT 1;
        END
      `);
      const row = direct.prepare(`
        SELECT body_json
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).get("client:private", "fact:private-duration");
      const body = JSON.parse(row.body_json);
      body.payload.applicability.seconds = 999;
      direct.prepare(`
        UPDATE knowledge_items
        SET body_json=?
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).run(
        JSON.stringify(body),
        "client:private",
        "fact:private-duration",
      );
    } finally {
      direct.close();
    }
    const report = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(report.ok, false);
    assert.equal(
      report.issues.some(
        (issue) => issue.type === "append-only-boundary"
          && issue.reason === "definition",
      ),
      true,
    );
    assert.equal(
      report.issues.some(
        (issue) => issue.type === "root-data:item-hash",
      ),
      true,
    );
    const serializedReport = JSON.stringify(report);
    assert.equal(serializedReport.includes("client:private"), false);
    assert.equal(serializedReport.includes("fact:private-duration"), false);
    assert.equal(serializedReport.includes("nao-vazar-este-payload"), false);
    const status = readKnowledgeStoreStatus({ dbFile });
    assert.equal(status.issues.length > 0, true);
    assert.deepEqual(status.ledgerHeads, []);
    assert.throws(
      () => store.exportKnowledge({
        grant: scopeGrant,
        rootScopeId: "client:private",
      }),
      /validação estrutural|integridade/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integridade detecta schema, hash e projeções de governance adulterados", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-governance-integrity-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:private"]);
    createRoot(store, scopeGrant, "client:private", "Cliente privado");
    for (const id of [
      "fact:governance-schema",
      "fact:governance-hash",
      "fact:governance-projection",
    ]) {
      store.appendKnowledgeItem({
        grant: scopeGrant,
        item: governedItem({
          id,
          revision: 1,
          rootScopeId: "client:private",
          scopeId: "client:private",
          recordType: "assertion",
          payload: { value: id },
          createdAt: "2026-07-23T18:01:00.000Z",
        }),
      });
    }

    const direct = new DatabaseSync(dbFile);
    try {
      const updateTrigger = direct.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type='trigger' AND name='knowledge_items_no_update'
      `).get().sql;
      direct.exec("DROP TRIGGER knowledge_items_no_update");
      const schemaRow = direct.prepare(`
        SELECT governance_json
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).get("client:private", "fact:governance-schema");
      const invalidSchema = JSON.parse(schemaRow.governance_json);
      invalidSchema.schema = "mkt-videos/knowledge-record-envelope@999";
      direct.prepare(`
        UPDATE knowledge_items
        SET governance_json=?
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).run(
        JSON.stringify(invalidSchema),
        "client:private",
        "fact:governance-schema",
      );
      direct.prepare(`
        UPDATE knowledge_items
        SET governance_hash=?
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).run(
        "0".repeat(64),
        "client:private",
        "fact:governance-hash",
      );
      direct.prepare(`
        UPDATE knowledge_items
        SET classification='public',
            owner_type='brand',
            owner_id='brand:forged',
            modality='heuristic'
        WHERE root_scope_id=? AND item_id=? AND revision=1
      `).run("client:private", "fact:governance-projection");
      direct.exec(updateTrigger);
    } finally {
      direct.close();
    }

    const scoped = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:private",
    });
    assert.equal(scoped.ok, false);
    assert.equal(
      scoped.issues.some((issue) => issue.type === "item-governance-schema"),
      true,
    );
    assert.equal(
      scoped.issues.some((issue) => issue.type === "item-governance-hash"),
      true,
    );
    assert.equal(
      scoped.issues.some((issue) => issue.type === "item-governance-projection"),
      true,
    );
    const global = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(global.ok, false);
    assert.equal(JSON.stringify(global).includes("client:private"), false);
    assert.equal(JSON.stringify(global).includes("fact:governance"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evento vincula grant, política, autoria e janela no hash-chain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-event-grant-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:duration",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { seconds: 8 },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const direct = new DatabaseSync(dbFile);
    try {
      const updateTrigger = direct.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type='trigger' AND name='knowledge_events_no_update'
      `).get().sql;
      direct.exec("DROP TRIGGER knowledge_events_no_update");
      direct.prepare(`
        UPDATE knowledge_events
        SET actor=?,
            policy_hash=?,
            grant_issued_at=?
        WHERE root_scope_id=?
          AND subject_id=?
          AND subject_revision=1
      `).run(
        "forged-actor",
        "0".repeat(64),
        "2026-07-23T18:30:00.000Z",
        "client:a",
        "fact:duration",
      );
      direct.exec(updateTrigger);
    } finally {
      direct.close();
    }
    const scoped = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(scoped.ok, false);
    assert.equal(
      scoped.issues.some((issue) => issue.type === "event-hash"),
      true,
    );
    assert.equal(
      scoped.issues.some((issue) => issue.type === "event-policy"),
      true,
    );
    assert.equal(
      scoped.issues.some((issue) => issue.type === "event-grant-window"),
      true,
    );
    assert.equal(
      scoped.issues.some((issue) => issue.type === "event-projection"),
      true,
    );
    const global = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(global.ok, false);
    const serializedGlobal = JSON.stringify(global);
    assert.equal(serializedGlobal.includes("client:a"), false);
    assert.equal(serializedGlobal.includes("fact:duration"), false);
    assert.equal(serializedGlobal.includes("forged-actor"), false);
    assert.throws(
      () => store.exportKnowledge({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }),
      /integridade/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grant_json novo é obrigatório, canônico e não pode ser rebaixado a legado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-event-grant-v4-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:grant-attestation",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { preserved: true },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });

    const direct = new DatabaseSync(dbFile);
    try {
      const source = direct.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE subject_id='fact:grant-attestation'
      `).get();
      assert.equal(source.grant_json, canonicalJson(scopeGrant));
      assert.throws(
        () => direct.prepare(`
          INSERT INTO knowledge_events(
            event_id,root_scope_id,scope_id,event_type,subject_type,subject_id,
            subject_revision,at,grant_id,grant_hash,policy_id,policy_hash,actor,
            grant_permission,grant_issued_at,grant_expires_at,payload_json,
            payload_hash,previous_event_hash,event_hash
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          "ke_missing-grant-evidence",
          source.root_scope_id,
          source.scope_id,
          "knowledge-item.appended",
          source.subject_type,
          "fact:missing-grant-evidence",
          1,
          source.at,
          source.grant_id,
          source.grant_hash,
          source.policy_id,
          source.policy_hash,
          source.actor,
          source.grant_permission,
          source.grant_issued_at,
          source.grant_expires_at,
          "{}",
          digest("{}"),
          source.event_hash,
          "f".repeat(64),
        ),
        /canonical ScopeGrant evidence/,
      );

      const updateTrigger = direct.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type='trigger' AND name='knowledge_events_no_update'
      `).get().sql;
      direct.exec("DROP TRIGGER knowledge_events_no_update");
      direct.prepare(`
        UPDATE knowledge_events
        SET grant_json=NULL
        WHERE sequence=?
      `).run(source.sequence);
      direct.exec(updateTrigger);
    } finally {
      direct.close();
    }

    const scoped = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(scoped.ok, false);
    assert.equal(
      scoped.issues.some((issue) => issue.type === "event-hash"),
      true,
    );
    const global = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(global.ok, false);
    assert.deepEqual(global.grantEvidence, {
      canonicalEventCount: 1,
      legacyEventCount: 1,
    });
    assert.throws(
      () => store.exportKnowledge({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }),
      /integridade/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integridade scoped reconcilia eventos ausentes, órfãos e duplicados", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-events-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "fact:duration",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { seconds: 8 },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const direct = new DatabaseSync(dbFile);
    try {
      const deleteTrigger = direct.prepare(`
        SELECT sql
        FROM sqlite_schema
        WHERE type='trigger' AND name='knowledge_events_no_delete'
      `).get().sql;
      direct.exec("DROP TRIGGER knowledge_events_no_delete");
      direct.prepare(`
        DELETE FROM knowledge_events
        WHERE root_scope_id=?
          AND subject_id=?
          AND subject_revision=1
      `).run("client:a", "fact:duration");
      direct.exec(deleteTrigger);

      const rootEvent = direct.prepare(`
        SELECT *
        FROM knowledge_events
        WHERE root_scope_id=? AND event_type='scope.created'
      `).get("client:a");
      const lastHash = direct.prepare(`
        SELECT event_hash
        FROM knowledge_events
        WHERE root_scope_id=?
        ORDER BY sequence DESC
        LIMIT 1
      `).get("client:a").event_hash;
      direct.prepare(`
        INSERT INTO knowledge_events(
          event_id,root_scope_id,scope_id,event_type,subject_type,subject_id,
          subject_revision,at,grant_id,grant_hash,policy_id,policy_hash,actor,
          grant_permission,grant_issued_at,grant_expires_at,payload_json,
          payload_hash,previous_event_hash,event_hash,grant_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        "ke_orphan_test",
        "client:a",
        "client:a",
        "test.orphan",
        "assertion",
        "fact:orphan",
        1,
        "2026-07-23T18:02:00.000Z",
        rootEvent.grant_id,
        rootEvent.grant_hash,
        rootEvent.policy_id,
        rootEvent.policy_hash,
        rootEvent.actor,
        "write",
        rootEvent.grant_issued_at,
        rootEvent.grant_expires_at,
        "{}",
        createHash("sha256").update("{}", "utf8").digest("hex"),
        lastHash,
        "a".repeat(64),
        rootEvent.grant_json,
      );
      direct.prepare(`
        INSERT INTO knowledge_events(
          event_id,root_scope_id,scope_id,event_type,subject_type,subject_id,
          subject_revision,at,grant_id,grant_hash,policy_id,policy_hash,actor,
          grant_permission,grant_issued_at,grant_expires_at,payload_json,
          payload_hash,previous_event_hash,event_hash,grant_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        "ke_duplicate_test",
        rootEvent.root_scope_id,
        rootEvent.scope_id,
        rootEvent.event_type,
        rootEvent.subject_type,
        rootEvent.subject_id,
        rootEvent.subject_revision,
        rootEvent.at,
        rootEvent.grant_id,
        rootEvent.grant_hash,
        rootEvent.policy_id,
        rootEvent.policy_hash,
        rootEvent.actor,
        rootEvent.grant_permission,
        rootEvent.grant_issued_at,
        rootEvent.grant_expires_at,
        rootEvent.payload_json,
        rootEvent.payload_hash,
        "a".repeat(64),
        "b".repeat(64),
        rootEvent.grant_json,
      );
    } finally {
      direct.close();
    }
    const report = store.checkIntegrity({
      grant: scopeGrant,
      rootScopeId: "client:a",
    });
    assert.equal(report.ok, false);
    assert.equal(
      report.issues.some((issue) => issue.type === "event-missing"),
      true,
    );
    assert.equal(
      report.issues.some((issue) => issue.type === "event-orphan"),
      true,
    );
    assert.equal(
      report.issues.some((issue) => issue.type === "event-duplicate"),
      true,
    );
    const globalReport = checkKnowledgeStoreIntegrity({ dbFile });
    assert.equal(globalReport.ok, false);
    assert.equal(JSON.stringify(globalReport).includes("fact:duration"), false);
    assert.throws(
      () => store.exportKnowledge({
        grant: scopeGrant,
        rootScopeId: "client:a",
      }),
      /integridade/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release explícita aceita no máximo uma revisão por item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-release-one-revision-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:a"]);
    createRoot(store, scopeGrant, "client:a", "Cliente A");
    const first = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "rule:color",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { color: "#111111" },
        createdAt: "2026-07-23T18:01:00.000Z",
      }),
    });
    const second = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: first.id,
        revision: 2,
        supersedesRevision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        payload: { color: "#222222" },
        createdAt: "2026-07-23T18:02:00.000Z",
      }),
    });
    assert.throws(
      () => store.createRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
        label: "inválida",
        members: [
          { id: first.id, revision: first.revision },
          { id: second.id, revision: second.revision },
        ],
        createdAt: "2026-07-23T18:03:00.000Z",
      }),
      /mais de uma revisão/,
    );
    const candidate = store.appendKnowledgeItem({
      grant: scopeGrant,
      item: governedItem({
        id: "rule:candidate",
        revision: 1,
        rootScopeId: "client:a",
        scopeId: "client:a",
        recordType: "assertion",
        status: "candidate",
        payload: { color: "#333333" },
      }),
    });
    assert.throws(
      () => store.createRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
        label: "candidata",
        members: [{ id: candidate.id, revision: candidate.revision }],
      }),
      /somente revisões active/,
    );
    assert.throws(
      () => store.createRelease({
        grant: scopeGrant,
        rootScopeId: "client:a",
        label: "default com candidata",
      }),
      /somente revisões active/,
    );
    const release = store.createRelease({
      grant: scopeGrant,
      rootScopeId: "client:a",
      label: "válida",
      members: [{ id: first.id, revision: first.revision }],
      createdAt: "2026-07-23T18:03:00.000Z",
    });
    const direct = new DatabaseSync(dbFile);
    try {
      const secondRow = direct.prepare(`
        SELECT *
        FROM knowledge_items
        WHERE root_scope_id=? AND item_id=? AND revision=2
      `).get("client:a", first.id);
      assert.throws(
        () => direct.prepare(`
          INSERT INTO knowledge_release_members(
            root_scope_id,release_id,ordinal,item_id,revision,record_type,
            schema_id,schema_version,content_hash
          ) VALUES (?,?,?,?,?,?,?,?,?)
        `).run(
          "client:a",
          release.id,
          1,
          secondRow.item_id,
          secondRow.revision,
          secondRow.record_type,
          secondRow.schema_id,
          secondRow.schema_version,
          secondRow.content_hash,
        ),
        /UNIQUE constraint failed/,
      );
    } finally {
      direct.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export agregado pode exceder 1 MiB sem ampliar o limite por item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-large-export-"));
  try {
    const dbFile = path.join(root, "knowledge.sqlite");
    const store = repository(dbFile);
    const scopeGrant = grant(["client:large"]);
    createRoot(store, scopeGrant, "client:large", "Cliente grande");
    const payload = "x".repeat(600 * 1024);
    for (const id of ["evidence:large-a", "evidence:large-b"]) {
      store.appendKnowledgeItem({
        grant: scopeGrant,
        item: governedItem({
          id,
          revision: 1,
          rootScopeId: "client:large",
          scopeId: "client:large",
          recordType: "entity",
          payload: { synthetic: true, value: payload },
        }),
      });
    }
    const exported = store.exportKnowledge({
      grant: scopeGrant,
      rootScopeId: "client:large",
    });
    const serialized = store.serializeExport(exported);
    assert.ok(Buffer.byteLength(serialized, "utf8") > 1024 * 1024);
    assert.throws(
      () => store.appendKnowledgeItem({
        grant: scopeGrant,
        item: governedItem({
          id: "evidence:too-large",
          revision: 1,
          rootScopeId: "client:large",
          scopeId: "client:large",
          recordType: "entity",
          payload: { value: "y".repeat(1024 * 1024) },
        }),
      }),
      /excede o limite/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
