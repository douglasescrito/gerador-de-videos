import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";
import { createKnowledgeRecordEnvelope } from "../lib/media-pipeline/knowledge-governance-envelope.mjs";
import {
  assertProductionRequest,
  createProductionRequest,
  newProductionRequestId,
} from "../lib/media-pipeline/production-request.mjs";

const ACTOR = "production-request-test";
const NOW = new Date("2026-08-12T12:00:00.000Z");
const REQUESTED_AT = "2026-08-12T11:59:00.000Z";

function grant(rootScopeIds, permissions = ["read", "write"]) {
  return createScopeGrant({
    rootScopeIds,
    permissions,
    actor: ACTOR,
    purpose: "production-request test",
    issuedAt: "2026-08-12T11:00:00.000Z",
    expiresAt: "2026-08-12T13:00:00.000Z",
  });
}

async function setup(context) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "production-request-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const workspaceRoot = path.join(temporary, "workspace");
  const coreRoot = path.join(workspaceRoot, "CORE");
  const privateRoot = path.join(temporary, "private");
  const dbFile = path.join(privateRoot, "knowledge.sqlite");
  await Promise.all([
    mkdir(path.join(workspaceRoot, ".git"), { recursive: true }),
    mkdir(path.join(coreRoot, "outputs"), { recursive: true }),
    mkdir(privateRoot, { recursive: true }),
  ]);
  initializeKnowledgeStore({ dbFile, coreRoot, clock: () => NOW });
  const repository = createKnowledgeStoreRepository({ dbFile, coreRoot, clock: () => NOW });
  return { temporary, coreRoot, dbFile, repository };
}

function governance({ actor = ACTOR } = {}) {
  return createKnowledgeRecordEnvelope({
    classification: "internal",
    owner: { type: "client", id: "client:pr-fixture" },
    provenance: [{
      sourceType: "production-request",
      sourceRef: "urn:test:production-request",
      method: "manual",
      observedAt: NOW,
      contentHash: "0".repeat(64),
    }],
    modality: "fact",
    evidenceIds: [],
    retention: { policy: "until-project-close" },
    rights: { inventory: "allowed" },
    createdAt: NOW,
    createdBy: actor,
  }, { expectedActor: actor });
}

async function fixture(context) {
  const state = await setup(context);
  const rootScopeId = "client:pr-fixture";
  const scopeGrant = grant([rootScopeId]);
  state.repository.createScope({
    grant: scopeGrant,
    scope: { id: rootScopeId, rootScopeId, parentScopeId: null, kind: "client", name: rootScopeId, createdAt: NOW },
  });
  return { ...state, rootScopeId, scopeGrant };
}

function baseRequest({ rootScopeId, requestId = newProductionRequestId(), idempotencyKey = requestId }) {
  return {
    requestId,
    rootScopeId,
    scopeId: rootScopeId,
    actor: ACTOR,
    origin: "human",
    requestedAt: REQUESTED_AT,
    deliverable: "video-instagram-reels-15s",
    objective: "Anunciar o novo curso.",
    idempotencyKey,
    governance: governance(),
  };
}

test("production-request@1 criado fica pending e projeta próxima ação", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  const projection = state.repository.createProductionRequest({
    grant: state.scopeGrant,
    request,
  });
  assert.equal(projection.status, "pending");
  assert.equal(projection.nextAction, "aguardando aceite");
  assert.equal(projection.linkedProductionId, null);
  assert.deepEqual(projection.history, []);

  const reread = state.repository.getProductionRequest({
    grant: state.scopeGrant,
    rootScopeId: state.rootScopeId,
    requestId: request.requestId,
  });
  assert.equal(reread.status, "pending");
  assert.equal(reread.request.idempotencyKey, request.idempotencyKey);
});

test("requestId reutilizado no mesmo root é rejeitado", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });
  const duplicate = createProductionRequest(
    baseRequest({ rootScopeId: state.rootScopeId, requestId: request.requestId, idempotencyKey: "outra-chave" }),
  );
  assert.throws(
    () => state.repository.createProductionRequest({ grant: state.scopeGrant, request: duplicate }),
    /requestId já foi usado/,
  );
});

test("chave idempotente duplicada é rejeitada mesmo com requestId novo", async (context) => {
  const state = await fixture(context);
  const first = createProductionRequest(baseRequest({ rootScopeId: state.rootScopeId, idempotencyKey: "campanha-agosto-2026" }));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request: first });
  const second = createProductionRequest(baseRequest({ rootScopeId: state.rootScopeId, idempotencyKey: "campanha-agosto-2026" }));
  assert.throws(
    () => state.repository.createProductionRequest({ grant: state.scopeGrant, request: second }),
    /chave idempotente/,
  );
});

test("ciclo de vida válido: pending -> accepted -> production-linked -> completed", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });

  const accepted = state.repository.appendProductionRequestLifecycleEvent({
    grant: state.scopeGrant,
    event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "accepted", actor: ACTOR, at: REQUESTED_AT },
  });
  assert.equal(accepted.status, "accepted");

  const linked = state.repository.appendProductionRequestLifecycleEvent({
    grant: state.scopeGrant,
    event: {
      requestId: request.requestId,
      rootScopeId: state.rootScopeId,
      kind: "production-linked",
      actor: ACTOR,
      at: REQUESTED_AT,
      productionId: "production:pr-fixture-1",
    },
  });
  assert.equal(linked.status, "linked");
  assert.equal(linked.linkedProductionId, "production:pr-fixture-1");

  const completed = state.repository.appendProductionRequestLifecycleEvent({
    grant: state.scopeGrant,
    event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "completed", actor: ACTOR, at: REQUESTED_AT },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.nextAction, "nenhuma (estado terminal)");
  assert.equal(completed.history.length, 3);
});

test("transição fora do mapa de estados falha fechado", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });

  assert.throws(
    () => state.repository.appendProductionRequestLifecycleEvent({
      grant: state.scopeGrant,
      event: {
        requestId: request.requestId,
        rootScopeId: state.rootScopeId,
        kind: "production-linked",
        actor: ACTOR,
        at: REQUESTED_AT,
        productionId: "production:skip-ahead",
      },
    }),
    /Transição inválida: pending -> production-linked/,
  );
});

test("evento de ciclo de vida após estado terminal falha fechado", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });
  state.repository.appendProductionRequestLifecycleEvent({
    grant: state.scopeGrant,
    event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "rejected", actor: ACTOR, at: REQUESTED_AT, reason: "fora de escopo" },
  });
  assert.throws(
    () => state.repository.appendProductionRequestLifecycleEvent({
      grant: state.scopeGrant,
      event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "accepted", actor: ACTOR, at: REQUESTED_AT },
    }),
    /Transição inválida: rejected -> accepted/,
  );
});

test("pedido com estrutura inválida é rejeitado antes de persistir", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  const tampered = { ...request, objective: "" };
  assert.throws(() => assertProductionRequest(tampered), /production-request@1 inválido/);
});

test("um byte alterado no recibo persistido nunca é aceito: o ledger é append-only na própria camada SQL", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });

  const db = new DatabaseSync(state.dbFile);
  try {
    const row = db.prepare(`
      SELECT event_id, payload_json FROM knowledge_events
      WHERE subject_id = ? ORDER BY sequence LIMIT 1
    `).get(request.requestId);
    const corrupted = row.payload_json.replace(
      request.deliverable,
      `${request.deliverable}-adulterado`,
    );
    assert.notEqual(corrupted, row.payload_json);
    assert.throws(
      () => db.prepare("UPDATE knowledge_events SET payload_json=? WHERE event_id=?")
        .run(corrupted, row.event_id),
      /append-only/,
    );
  } finally {
    db.close();
  }

  const reread = state.repository.getProductionRequest({
    grant: state.scopeGrant,
    rootScopeId: state.rootScopeId,
    requestId: request.requestId,
  });
  assert.equal(reread.request.deliverable, request.deliverable);
});

test("vínculo a produção sem productionId é rejeitado pelo schema", async (context) => {
  const state = await fixture(context);
  const request = createProductionRequest(baseRequest(state));
  state.repository.createProductionRequest({ grant: state.scopeGrant, request });
  state.repository.appendProductionRequestLifecycleEvent({
    grant: state.scopeGrant,
    event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "accepted", actor: ACTOR, at: REQUESTED_AT },
  });
  assert.throws(
    () => state.repository.appendProductionRequestLifecycleEvent({
      grant: state.scopeGrant,
      event: { requestId: request.requestId, rootScopeId: state.rootScopeId, kind: "production-linked", actor: ACTOR, at: REQUESTED_AT },
    }),
    /production-linked exige productionId/,
  );
});
