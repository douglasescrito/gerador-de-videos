import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  KNOWLEDGE_ITEM_SCHEMA,
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const FIXED_AT = FIXED_NOW.toISOString();
const GRANT_EXPIRY = "2026-07-24T13:00:00.000Z";
const ACTOR = "atomic-batch-test";
const ENTITY_SCHEMA = "mkt-videos/entity-profile@1";
const EVIDENCE_SCHEMA = "mkt-videos/evidence-link@1";
const REFERENCE_SCHEMA = "mkt-videos/knowledge-reference@1";

function normalizeJson(value) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(normalizeJson);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeJson(value[key])]),
  );
}

function hashJson(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeJson(value)), "utf8")
    .digest("hex");
}

function scopeGrant(rootScopeIds) {
  return createScopeGrant({
    rootScopeIds,
    permissions: ["read", "write", "integrity"],
    actor: ACTOR,
    purpose: "provider-free atomic Knowledge Store test",
    issuedAt: FIXED_NOW,
    expiresAt: GRANT_EXPIRY,
  });
}

function createRoot(repository, grant, rootScopeId) {
  return repository.createScope({
    grant,
    scope: {
      id: rootScopeId,
      rootScopeId,
      kind: "client",
      name: rootScopeId,
      createdAt: FIXED_NOW,
    },
  });
}

function governedEnvelope({
  rootScopeId,
  id,
  evidenceIds = [],
}) {
  return createKnowledgeRecordEnvelope({
    classification: "internal",
    owner: { type: "client", id: rootScopeId },
    provenance: [{
      sourceType: "test-fixture",
      sourceRef: `fixture:${rootScopeId}/${id}`,
      method: "manual",
      observedAt: FIXED_AT,
      contentHash: hashJson({ rootScopeId, id }),
    }],
    modality: "fact",
    evidenceIds,
    retention: { policy: "manual-review" },
    createdAt: FIXED_AT,
    createdBy: ACTOR,
  }, { expectedActor: ACTOR });
}

function canonicalItem({
  id,
  rootScopeId = "client:atomic",
  scopeId = rootScopeId,
  revision = 1,
  supersedesRevision = null,
  status = "candidate",
  recordType = "entity",
  schemaId = ENTITY_SCHEMA,
  payload = null,
  evidenceIds = [],
}) {
  const normalizedPayload = payload ?? {
    schema: ENTITY_SCHEMA,
    entityType: "reference-asset",
    name: id,
    aliases: [],
    attributes: {},
    evidenceRefs: [],
  };
  const body = {
    schema: KNOWLEDGE_ITEM_SCHEMA,
    id,
    revision,
    rootScopeId,
    scopeId,
    recordType,
    schemaId,
    schemaVersion: 1,
    status,
    governance: governedEnvelope({ rootScopeId, id, evidenceIds }),
    supersedesRevision,
    payload: normalizedPayload,
    createdAt: FIXED_AT,
    createdBy: ACTOR,
  };
  return {
    ...body,
    contentHash: hashJson(body),
  };
}

function itemReference(item) {
  return {
    schema: REFERENCE_SCHEMA,
    kind: "item",
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    recordType: item.recordType,
    contentHash: item.contentHash,
  };
}

function expectedHead(item, overrides = {}) {
  return {
    rootScopeId: item.rootScopeId,
    id: item.id,
    revision: item.revision,
    contentHash: item.contentHash,
    status: item.status,
    schemaId: item.schemaId,
    ...overrides,
  };
}

function eventCount(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return Number(
      db.prepare("SELECT COUNT(*) AS count FROM knowledge_events").get().count,
    );
  } finally {
    db.close();
  }
}

async function fixture() {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-atomic-batch-"),
  );
  const dbFile = path.join(temporaryRoot, "knowledge.sqlite");
  initializeKnowledgeStore({
    dbFile,
    clock: () => FIXED_NOW,
  });
  const repository = createKnowledgeStoreRepository({
    dbFile,
    clock: () => FIXED_NOW,
  });
  return { temporaryRoot, dbFile, repository };
}

test("appendKnowledgeItemsAtomic persiste lote e referências internas em uma transação", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const evidence = canonicalItem({
      id: "evidence:reference-a",
      recordType: "evidence",
      schemaId: EVIDENCE_SCHEMA,
      payload: {
        schema: EVIDENCE_SCHEMA,
        source: {
          sourceType: "test-fixture",
          sourceRef: "fixture:reference-a",
          contentHash: hashJson("reference-a"),
          method: "manual",
          observedAt: FIXED_AT,
          fragment: null,
        },
        relation: "documents",
        targetRefs: [],
        observation: "Evidência local provider-free.",
        confidence: 1,
        evidenceRefs: [],
      },
    });
    const entity = canonicalItem({
      id: "asset:reference-a",
      evidenceIds: [evidence.id],
      payload: {
        schema: ENTITY_SCHEMA,
        entityType: "reference-asset",
        name: "Reference A",
        aliases: [],
        attributes: {},
        evidenceRefs: [itemReference(evidence)],
      },
    });

    const written = repository.appendKnowledgeItemsAtomic({
      grant,
      items: [entity, evidence],
    });

    assert.deepEqual(
      written.map((item) => item.id),
      ["asset:reference-a", "evidence:reference-a"],
    );
    assert.deepEqual(
      repository.listKnowledgeItems({
        grant,
        rootScopeId: "client:atomic",
      }).map((item) => item.id),
      ["asset:reference-a", "evidence:reference-a"],
    );
    assert.equal(
      repository.checkIntegrity({
        grant,
        rootScopeId: "client:atomic",
      }).ok,
      true,
    );
    assert.equal(eventCount(dbFile), 3);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic reverte itens e eventos se qualquer revisão falhar", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const eventCountBefore = eventCount(dbFile);
    const valid = canonicalItem({ id: "asset:valid" });
    const invalidRevision = canonicalItem({
      id: "asset:missing-revision-one",
      revision: 2,
      supersedesRevision: 1,
    });

    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [valid, invalidRevision],
      }),
      /Primeira revisão deve ser 1/,
    );
    assert.deepEqual(
      repository.listKnowledgeItems({
        grant,
        rootScopeId: "client:atomic",
      }),
      [],
    );
    assert.equal(eventCount(dbFile), eventCountBefore);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic rejeita lote vazio, duplicatas e hash adulterado", async () => {
  const { temporaryRoot, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const item = canonicalItem({ id: "asset:one" });
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({ grant, items: [] }),
      /lote não vazio/,
    );
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [item, item],
      }),
      /item duplicado/,
    );
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [{ ...item, contentHash: "0".repeat(64) }],
      }),
      /contentHash diverge/,
    );
    assert.deepEqual(
      repository.listKnowledgeItems({
        grant,
        rootScopeId: "client:atomic",
      }),
      [],
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic rejeita roots e scopes divergentes", async () => {
  const { temporaryRoot, repository } = await fixture();
  const grant = scopeGrant(["client:atomic", "client:other"]);
  try {
    const item = canonicalItem({ id: "asset:one" });
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [
          item,
          canonicalItem({
            id: "asset:other",
            rootScopeId: "client:other",
          }),
        ],
      }),
      /rootScopeIds divergentes/,
    );
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [
          item,
          canonicalItem({
            id: "asset:child",
            scopeId: "project:child",
          }),
        ],
      }),
      /scopeIds divergentes/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic valida expectedHeads no mesmo lote transacional", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const source = canonicalItem({ id: "asset:source-head" });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [source],
    });
    const eventCountBefore = eventCount(dbFile);
    const derived = canonicalItem({ id: "technique:derived" });

    const written = repository.appendKnowledgeItemsAtomic({
      grant,
      items: [derived],
      expectedHeads: [expectedHead(source)],
    });

    assert.deepEqual(written.map((item) => item.id), [derived.id]);
    assert.deepEqual(
      repository.listKnowledgeItems({
        grant,
        rootScopeId: "client:atomic",
      }).map((item) => item.id),
      [source.id, derived.id].sort(),
    );
    assert.equal(eventCount(dbFile), eventCountBefore + 1);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic falha fechado se o head esperado foi revogado", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const sourceRevision1 = canonicalItem({ id: "asset:revoked-head" });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [sourceRevision1],
    });
    const sourceRevision2 = canonicalItem({
      id: sourceRevision1.id,
      revision: 2,
      supersedesRevision: 1,
      status: "revoked",
    });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [sourceRevision2],
    });
    const eventCountBefore = eventCount(dbFile);
    const derived = canonicalItem({ id: "technique:must-not-write-revoked" });

    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [derived],
        expectedHeads: [expectedHead(sourceRevision1)],
      }),
      /diverge do head canônico/,
    );
    assert.equal(
      repository.getKnowledgeItem({
        grant,
        rootScopeId: "client:atomic",
        id: derived.id,
      }),
      null,
    );
    assert.equal(eventCount(dbFile), eventCountBefore);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic falha fechado se uma revisão nova substituiu o target", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const targetRevision1 = canonicalItem({ id: "asset:new-head" });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [targetRevision1],
    });
    const targetRevision2 = canonicalItem({
      id: targetRevision1.id,
      revision: 2,
      supersedesRevision: 1,
      payload: {
        schema: ENTITY_SCHEMA,
        entityType: "reference-asset",
        name: targetRevision1.id,
        aliases: [],
        attributes: { changed: true },
        evidenceRefs: [],
      },
    });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [targetRevision2],
    });
    const eventCountBefore = eventCount(dbFile);
    const derived = canonicalItem({ id: "technique:must-not-write-stale" });

    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [derived],
        expectedHeads: [expectedHead(targetRevision1)],
      }),
      /diverge do head canônico/,
    );
    assert.equal(
      repository.getKnowledgeItem({
        grant,
        rootScopeId: "client:atomic",
        id: derived.id,
      }),
      null,
    );
    assert.equal(eventCount(dbFile), eventCountBefore);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("appendKnowledgeItemsAtomic rejeita expectedHeads ausentes, duplicados, fora do root ou no próprio lote", async () => {
  const { temporaryRoot, dbFile, repository } = await fixture();
  const grant = scopeGrant(["client:atomic"]);
  try {
    createRoot(repository, grant, "client:atomic");
    const source = canonicalItem({ id: "asset:precondition-source" });
    repository.appendKnowledgeItemsAtomic({
      grant,
      items: [source],
    });
    const eventCountBefore = eventCount(dbFile);
    const attemptedIds = [
      "technique:missing-head",
      "technique:duplicate-head",
      "technique:wrong-root",
      "technique:self-head",
    ];

    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [canonicalItem({ id: attemptedIds[0] })],
        expectedHeads: [expectedHead(
          canonicalItem({ id: "asset:not-persisted" }),
        )],
      }),
      /não resolve um head canônico persistido/,
    );
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [canonicalItem({ id: attemptedIds[1] })],
        expectedHeads: [expectedHead(source), expectedHead(source)],
      }),
      /head duplicado/,
    );
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [canonicalItem({ id: attemptedIds[2] })],
        expectedHeads: [expectedHead(source, {
          rootScopeId: "client:other",
        })],
      }),
      /rootScopeId diverge do lote atômico/,
    );
    const sameBatchHead = canonicalItem({ id: attemptedIds[3] });
    assert.throws(
      () => repository.appendKnowledgeItemsAtomic({
        grant,
        items: [sameBatchHead],
        expectedHeads: [expectedHead(sameBatchHead)],
      }),
      /estado prévio persistido/,
    );

    for (const id of attemptedIds) {
      assert.equal(
        repository.getKnowledgeItem({
          grant,
          rootScopeId: "client:atomic",
          id,
        }),
        null,
      );
    }
    assert.equal(eventCount(dbFile), eventCountBefore);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
