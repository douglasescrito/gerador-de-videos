import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createKnowledgeStoreRepository,
  createScopeGrant,
  initializeKnowledgeStore,
} from "../lib/media-pipeline/knowledge-store.mjs";

const ACTOR = "video-decisions-test";
const NOW = new Date("2026-08-13T12:00:00.000Z");
const AT = "2026-08-13T11:59:00.000Z";
const TARGET_HASH = "a".repeat(64);

function grant(rootScopeIds, permissions = ["read", "write"]) {
  return createScopeGrant({
    rootScopeIds,
    permissions,
    actor: ACTOR,
    purpose: "video-decisions test",
    issuedAt: "2026-08-13T11:00:00.000Z",
    expiresAt: "2026-08-13T13:00:00.000Z",
  });
}

async function setup(context) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "video-decisions-"));
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

async function fixture(context, { rootScopeId = "client:focus" } = {}) {
  const state = await setup(context);
  const scopeGrant = grant([rootScopeId]);
  state.repository.createScope({
    grant: scopeGrant,
    scope: { id: rootScopeId, rootScopeId, parentScopeId: null, kind: "client", name: rootScopeId, createdAt: NOW },
  });
  return { ...state, rootScopeId, scopeGrant };
}

test("curtir cria um evento e a projeção mostra liked true", async (context) => {
  const state = await fixture(context);
  const result = state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", liked: true },
  });
  assert.equal(result.liked, true);
  assert.equal(result.history.length, 1);
});

test("curtir e descurtir cria dois eventos preservados, nunca sobrescreve", async (context) => {
  const state = await fixture(context);
  state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", liked: true },
  });
  const unliked = state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", liked: false },
  });
  assert.equal(unliked.liked, false);
  assert.equal(unliked.history.length, 2);
  assert.equal(unliked.history[0].liked, true);
  assert.equal(unliked.history[1].liked, false);

  const reread = state.repository.getVideoPreferenceState({
    grant: state.scopeGrant,
    rootScopeId: state.rootScopeId,
    targetHash: TARGET_HASH,
  });
  assert.equal(reread.liked, false);
  assert.equal(reread.history.length, 2);
});

test("reavaliar um vídeo cria novo evento de review, histórico completo preservado", async (context) => {
  const state = await fixture(context);
  state.repository.recordVideoReview({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", status: "needs-review", reason: "conferir CTA" },
  });
  const second = state.repository.recordVideoReview({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", status: "approved", reason: "CTA revisado e aprovado" },
  });
  assert.equal(second.status, "approved");
  assert.equal(second.history.length, 2);
  assert.equal(second.history[0].status, "needs-review");
});

test("reindexar/remover o MP4 não apaga a evidência: eventos não têm FK para assets", async (context) => {
  // O evento é identificado só por targetHash (produção-manifest@1), nunca
  // por rel_path ou por um relacionamento com uma tabela de assets — não há
  // como uma reindexação de catálogo (Rust ou Express) apagar isto em
  // cascata, porque o Knowledge Core não conhece a tabela assets.
  const state = await fixture(context);
  const result = state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master-antigo.mp4", liked: true },
  });
  assert.equal(result.liked, true);
  const reread = state.repository.getVideoPreferenceState({
    grant: state.scopeGrant,
    rootScopeId: state.rootScopeId,
    targetHash: TARGET_HASH,
  });
  assert.equal(reread.liked, true);
  assert.equal(reread.history[0].relPath, "focus/master-antigo.mp4");
});

test("Focus nunca recebe like de outro root: ScopeGrant de um root não lê nem escreve em outro", async (context) => {
  const state = await fixture(context, { rootScopeId: "client:focus" });
  const otherRoot = "client:outro-cliente";
  const otherGrant = grant([otherRoot]);
  state.repository.createScope({
    grant: otherGrant,
    scope: { id: otherRoot, rootScopeId: otherRoot, parentScopeId: null, kind: "client", name: otherRoot, createdAt: NOW },
  });
  state.repository.recordVideoPreference({
    grant: otherGrant,
    event: { rootScopeId: otherRoot, scopeId: otherRoot, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "outro/master.mp4", liked: true },
  });

  const focusState = state.repository.getVideoPreferenceState({
    grant: state.scopeGrant,
    rootScopeId: state.rootScopeId,
    targetHash: TARGET_HASH,
  });
  assert.equal(focusState.liked, false, "Focus não pode ver o like gravado no outro root");
  assert.equal(focusState.history.length, 0);

  assert.throws(
    () => state.repository.recordVideoPreference({
      grant: state.scopeGrant,
      event: { rootScopeId: otherRoot, scopeId: otherRoot, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "outro/master.mp4", liked: true },
    }),
    /ScopeGrant/,
  );
});

test("replay produz o mesmo estado e hash de forma determinística", async (context) => {
  const state = await fixture(context);
  state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", liked: true },
  });
  state.repository.recordVideoPreference({
    grant: state.scopeGrant,
    event: { rootScopeId: state.rootScopeId, scopeId: state.rootScopeId, actor: ACTOR, at: AT, targetHash: TARGET_HASH, relPath: "focus/master.mp4", liked: false },
  });

  const first = state.repository.replayVideoPreferenceEvents({ grant: state.scopeGrant, rootScopeId: state.rootScopeId });
  const second = state.repository.replayVideoPreferenceEvents({ grant: state.scopeGrant, rootScopeId: state.rootScopeId });
  assert.equal(first.eventCount, 2);
  assert.equal(first.aggregateHash, second.aggregateHash);
  assert.deepEqual(first.entries, second.entries);
});
