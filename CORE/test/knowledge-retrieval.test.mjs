import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertKnowledgeContext,
  assertKnowledgeRetrievalActionResult,
  assertKnowledgeRetrievalTrace,
  assertKnowledgeRetrievalEvaluation,
  buildRetrievalShadowEvaluation,
  buildKnowledgeRetrievalShadow,
  knowledgeContextHash,
  knowledgeRetrievalRequestHash,
  retrievalActionResultHash,
} from "../lib/media-pipeline/knowledge-retrieval.mjs";
import {
  KNOWLEDGE_ASSERTION_SCHEMA,
} from "../lib/media-pipeline/knowledge-record-contracts.mjs";
import {
  createKnowledgeRecordEnvelope,
} from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import { runKnowledgeAction } from "../lib/media-pipeline/knowledge-service.mjs";

const ACTOR = "retrieval-test";
const NOW = new Date("2026-07-27T12:00:00.000Z");

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function grant(rootScopeIds, permissions = ["read", "write", "release", "integrity"]) {
  return createScopeGrant({
    rootScopeIds,
    permissions,
    actor: ACTOR,
    purpose: "provider-free retrieval shadow test",
    issuedAt: "2026-07-27T11:00:00.000Z",
    expiresAt: "2026-07-27T13:00:00.000Z",
  });
}

function request(query, overrides = {}) {
  const value = {
    schema: "mkt-videos/knowledge-retrieval-request@1",
    rootScopeId: "client-a",
    query,
    scopeIds: [],
    releaseId: null,
    asOf: NOW.toISOString(),
    limit: 5,
    mode: "shadow",
    ...overrides,
  };
  return { ...value, hash: knowledgeRetrievalRequestHash(value) };
}

function assertionItem({
  id,
  rootScopeId = "client-a",
  scopeId = rootScopeId,
  ownerType = scopeId === rootScopeId ? "client" : "project",
  predicate = "style.direction",
  value = "cinematic luz",
  textualIndexing = "allowed",
  status = "active",
}) {
  const payload = {
    schema: KNOWLEDGE_ASSERTION_SCHEMA,
    subjectRef: {
      schema: "mkt-videos/knowledge-reference@1",
      kind: "scope",
      rootScopeId,
      id: rootScopeId,
    },
    predicate,
    value,
    polarity: "positive",
    applicability: { mode: "client", scopeId: rootScopeId },
    confidence: 1,
    evidenceRefs: [],
  };
  const governance = createKnowledgeRecordEnvelope({
    classification: "confidential",
    owner: { type: ownerType, id: scopeId },
    provenance: [{
      sourceType: "test-fixture",
      sourceRef: `fixture:${digest(id)}`,
      method: "manual",
      observedAt: NOW,
      contentHash: digest(id),
    }],
    modality: "preference",
    evidenceIds: [],
    retention: { policy: "manual-review" },
    rights: {
      inventory: "allowed",
      localAnalysis: "allowed",
      textualIndexing,
      embedding: "denied",
      training: "denied",
      providerInput: "denied",
      publication: "denied",
      reuse: "denied",
    },
    createdAt: NOW,
    createdBy: ACTOR,
  }, { expectedActor: ACTOR });
  const body = {
    schema: "mkt-videos/knowledge-item@1",
    id,
    revision: 1,
    rootScopeId,
    scopeId,
    recordType: "assertion",
    schemaId: KNOWLEDGE_ASSERTION_SCHEMA,
    schemaVersion: 1,
    status,
    governance,
    supersedesRevision: null,
    payload,
    createdAt: NOW.toISOString(),
    createdBy: ACTOR,
  };
  return { ...body, contentHash: digest(body) };
}

function fakeFtsSearch({ items, terms, limit }) {
  return items
    .filter((item) => terms.every((term) =>
      JSON.stringify(item.payload).toLocaleLowerCase("pt-BR").includes(term)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((item) => ({
      item_id: item.id,
      revision: item.revision,
      scope_id: item.scopeId,
      record_type: item.recordType,
      schema_id: item.schemaId,
      bm25: -1,
    }));
}

async function setup(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "knowledge-retrieval-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, "workspace");
  const coreRoot = path.join(workspace, "CORE");
  const dbFile = path.join(temp, "private", "knowledge.sqlite");
  await mkdir(coreRoot, { recursive: true });
  initializeKnowledgeStore({ dbFile, coreRoot, clock: () => NOW });
  const repository = createKnowledgeStoreRepository({ dbFile, coreRoot, clock: () => NOW });
  const scopeGrant = grant(["client-a"]);
  repository.createScope({
    grant: scopeGrant,
    scope: {
      id: "client-a",
      rootScopeId: "client-a",
      kind: "client",
      name: "Cliente A",
      createdAt: NOW,
    },
  });
  repository.createScope({
    grant: scopeGrant,
    scope: {
      id: "project-a",
      rootScopeId: "client-a",
      parentScopeId: "client-a",
      kind: "project",
      name: "Projeto A",
      createdAt: NOW,
    },
  });
  return { repository, scopeGrant, dbFile, coreRoot };
}

test("retrieval shadow usa FTS5, release ativa e devolve trace/contexto determinísticos", async (t) => {
  const golden = JSON.parse(await readFile(
    new URL("./fixtures/retrieval-golden-briefs@1.json", import.meta.url),
    "utf8",
  ));
  assert.equal(golden.schema, "mkt-videos/retrieval-golden-briefs@1");
  assert.equal(golden.cases.length, 2);
  const { repository, scopeGrant } = await setup(t);
  const allowed = assertionItem({ id: "direction-a", value: "cinematic luz" });
  const denied = assertionItem({
    id: "direction-denied",
    value: "cinematic segredo",
    textualIndexing: "denied",
  });
  repository.appendKnowledgeItem({ grant: scopeGrant, item: allowed });
  repository.appendKnowledgeItem({ grant: scopeGrant, item: denied });
  const release = repository.createRelease({
    grant: scopeGrant,
    rootScopeId: "client-a",
    label: "Retrieval gold",
  });
  repository.activateRelease({
    grant: scopeGrant,
    rootScopeId: "client-a",
    releaseId: release.id,
    expectedReleaseHash: release.hash,
    expectedCurrentActivationId: null,
    reason: "gold retrieval",
    createdAt: NOW,
  });
  const result = repository.retrieveKnowledgeShadow({
    grant: grant(["client-a"], ["read"]),
    request: request("cinematic luz", { releaseId: release.id }),
  });
  assertKnowledgeRetrievalTrace(result.trace);
  assertKnowledgeContext(result.context);
  assert.equal(result.trace.hits[0].itemId, "direction-a");
  assert.ok(result.trace.exclusions.some((entry) =>
    entry.itemId === "direction-denied"
    && entry.reason === "rights.textualIndexing-not-allowed"));
  assert.equal(result.context.authority, "none");
  assert.equal(result.context.plannerInfluence, "none");
  const second = repository.retrieveKnowledgeShadow({
    grant: grant(["client-a"], ["read"]),
    request: request("cinematic luz", { releaseId: release.id }),
  });
  assert.deepEqual(second, result);
  const evaluation = buildRetrievalShadowEvaluation({
    rootScopeId: "client-a",
    cases: [{
      id: "lexical-style-direction",
      expectedItemIds: ["direction-a"],
      trace: result.trace,
      context: result.context,
    }],
  });
  assertKnowledgeRetrievalEvaluation(evaluation);
  assert.equal(evaluation.zeroLeakage, true);
  assert.equal(evaluation.acceptanceRate, 1);
});

test("retrieval shadow resolve conflito por especificidade e nunca mistura scope", () => {
  const root = {
    id: "client-a",
    rootScopeId: "client-a",
    parentScopeId: null,
    status: "active",
  };
  const project = {
    id: "project-a",
    rootScopeId: "client-a",
    parentScopeId: "client-a",
    status: "active",
  };
  const broad = assertionItem({ id: "rule-broad", value: "cinematic luz" });
  const narrow = assertionItem({
    id: "rule-narrow",
    scopeId: "project-a",
    value: "flat 2d luz",
  });
  const release = {
    id: "release-a",
    rootScopeId: "client-a",
    hash: "a".repeat(64),
    members: [
      { id: broad.id, revision: 1 },
      { id: narrow.id, revision: 1 },
    ],
  };
  const result = buildKnowledgeRetrievalShadow({
    request: request("luz", { releaseId: release.id }),
    scopes: [root, project],
    items: [broad, narrow],
    activeRelease: release,
    ftsSearch: fakeFtsSearch,
  });
  assert.equal(result.trace.conflicts.length, 1);
  assert.equal(result.trace.conflicts[0].status, "resolved-override");
  assert.equal(result.trace.conflicts[0].winnerItemId, "rule-narrow");
  assert.ok(result.trace.exclusions.some((entry) =>
    entry.itemId === "rule-broad" && entry.reason === "conflict-override"));
  const projectOnly = buildKnowledgeRetrievalShadow({
    request: request("luz", { releaseId: release.id, scopeIds: ["project-a"] }),
    scopes: [root, project],
    items: [broad, narrow],
    activeRelease: release,
    ftsSearch: fakeFtsSearch,
  });
  assert.ok(projectOnly.trace.hits.every((hit) => hit.itemId === "rule-narrow"));
  assert.ok(projectOnly.trace.exclusions.some((entry) =>
    entry.itemId === "rule-broad" && entry.reason === "scope-filter"));
});

test("retrieval shadow falha fechado para release ausente e neutraliza sintaxe FTS", () => {
  const item = assertionItem({ id: "orphan", value: "foo OR segredo" });
  const result = buildKnowledgeRetrievalShadow({
    request: request("foo OR *"),
    scopes: [{
      id: "client-a",
      rootScopeId: "client-a",
      parentScopeId: null,
      status: "active",
    }],
    items: [item],
    activeRelease: null,
  });
  assert.equal(result.trace.hits.length, 0);
  assert.ok(result.trace.exclusions.some((entry) => entry.reason === "no-active-release"));
  const actionBody = {
    schema: "mkt-videos/knowledge-retrieval-action-result@1",
    action: "retrieval-shadow",
    status: "shadow",
    providerFree: true,
    readOnly: true,
    changed: false,
    humanConfirmed: false,
    rootScopeId: "client-a",
    planInfluence: "none",
    trace: result.trace,
    context: result.context,
  };
  const action = assertKnowledgeRetrievalActionResult({
    ...actionBody,
    hash: retrievalActionResultHash(actionBody),
  });
  assert.equal(action.context.authority, "none");
});

test("retrieval shadow não atravessa root mesmo quando o item é injetado na projeção", () => {
  const foreign = assertionItem({
    id: "foreign-item",
    rootScopeId: "other-client",
    scopeId: "other-client",
    ownerType: "client",
    value: "cinematic cliente errado",
  });
  const result = buildKnowledgeRetrievalShadow({
    request: request("cinematic", { releaseId: "release-a" }),
    scopes: [{
      id: "client-a",
      rootScopeId: "client-a",
      parentScopeId: null,
      status: "active",
    }],
    items: [foreign],
    activeRelease: {
      id: "release-a",
      rootScopeId: "client-a",
      hash: "a".repeat(64),
      members: [{ id: foreign.id, revision: 1 }],
    },
    ftsSearch: fakeFtsSearch,
  });
  assert.equal(result.trace.hits.length, 0);
  assert.ok(result.trace.exclusions.some((entry) =>
    entry.itemId === "foreign-item" && entry.reason === "root-filter"));
});

test("knowledge --action retrieval-shadow é read-only e usa o serviço único", async (t) => {
  const { repository, scopeGrant, dbFile, coreRoot } = await setup(t);
  const item = assertionItem({ id: "service-item", value: "documentário voz" });
  repository.appendKnowledgeItem({ grant: scopeGrant, item });
  const release = repository.createRelease({
    grant: scopeGrant,
    rootScopeId: "client-a",
    label: "Service gold",
  });
  repository.activateRelease({
    grant: scopeGrant,
    rootScopeId: "client-a",
    releaseId: release.id,
    expectedReleaseHash: release.hash,
    expectedCurrentActivationId: null,
    reason: "service retrieval",
    createdAt: NOW,
  });
  const input = request("documentário voz", { releaseId: release.id });
  const inputFile = path.join(path.dirname(dbFile), "retrieval-request.json");
  await writeFile(inputFile, JSON.stringify(input), "utf8");
  const result = await runKnowledgeAction({
    action: "retrieval-shadow",
    dbFile,
    rootScopeId: "client-a",
    inputFile,
    coreRoot,
    actor: ACTOR,
    clock: () => NOW,
  });
  assertKnowledgeRetrievalActionResult(result);
  assert.equal(result.action, "retrieval-shadow");
  assert.equal(result.readOnly, true);
  assert.equal(result.changed, false);
  assert.equal(result.context.appliedItems[0].id, "service-item");
});
