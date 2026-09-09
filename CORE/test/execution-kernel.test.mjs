import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeChangeImpact } from "../lib/media-pipeline/change-impact.mjs";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import {
  appendExecutionEvent, authorizeJournalNode, beginNodeAttempt,
  buildExecutionRightsDecision, initializeExecutionJournal,
  materializeExecutionSnapshot, migrateLegacyStateToJournal,
  consumeExecutionEffectAuthorization,
  persistJournalProviderHandle, recordNodeCompletion,
  recordExecutionNodeApproval,
  revokeExecutionArtifact,
} from "../lib/media-pipeline/execution-journal.mjs";
import {
  issueExecutionAuthorization,
} from "../lib/media-pipeline/execution-authorization.mjs";

function spec() {
  return {
    name: "kernel", scenes: [{ id: "a", prompt: "Cena A", motionPrompt: "Mover A", duration: 2 }],
    qa: false, budget: { image: 1, tts: 0, music: 0, omni: 1, semanticQa: 0 },
  };
}

function issueForJournal({ plan, nodeId, rightsDecision, now = new Date(), ttlMs } = {}) {
  return issueExecutionAuthorization({
    plan,
    nodeId,
    rightsDecision,
    confirmFingerprint: plan.governance.approval.fingerprint,
    source: "cli",
    actor: "human:execution-kernel-test",
    now,
    ...(ttlMs == null ? {} : { ttlMs }),
  });
}

function completeLocalJournalNode(dbFile, nodeId) {
  const attemptId = `local-${nodeId}`;
  beginNodeAttempt({ dbFile, nodeId, attemptId });
  return recordNodeCompletion({ dbFile, nodeId, attemptId });
}

function completeKeyframePrerequisites(dbFile) {
  completeLocalJournalNode(dbFile, "alignment");
  completeLocalJournalNode(dbFile, "timeline-lock");
}

test("journal reconstrói snapshot apenas por eventos e rollback não deixa evento parcial", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    const initial = initializeExecutionJournal({ dbFile, plan });
    assert.equal(initial.nodes["keyframe:a"].status, "planned");
    await assert.rejects(async () => beginNodeAttempt({ dbFile, nodeId: "keyframe:a", attemptId: "attempt-1" }), /autorização explícita/);
    completeKeyframePrerequisites(dbFile);
    const keyframeRights = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const keyframeAuthorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision: keyframeRights,
    });
    authorizeJournalNode({
      dbFile,
      nodeId: "keyframe:a",
      authorization: keyframeAuthorization,
    });
    assert.throws(
      () =>
        authorizeJournalNode({
          dbFile,
          nodeId: "video:a",
          authorization: { accessToken: "secret" },
        }),
      /não foi emitida pelo Execution Kernel/,
    );
    beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-1",
      authorization: keyframeAuthorization,
    });
    persistJournalProviderHandle({ dbFile, nodeId: "keyframe:a", attemptId: "attempt-1", handle: { fileId: "file-1" } });
    const afterCrash = materializeExecutionSnapshot({ dbFile });
    assert.equal(afterCrash.nodes["keyframe:a"].status, "provider_pending");
    assert.equal(afterCrash.nodes["keyframe:a"].providerHandle.fileId, "file-1");
    assert.throws(() => beginNodeAttempt({ dbFile, nodeId: "keyframe:a", attemptId: "attempt-2" }), /não autoriza nova tentativa/);
    assert.throws(() => appendExecutionEvent({ dbFile, event: { type: "diagnostic_test_event", nodeId: "assembly", data: { error: "x" } }, fault: "after_insert" }), /fault injection/);
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes.assembly.status, "planned");
    assert.throws(
      () => appendExecutionEvent({
        dbFile,
        event: {
          type: "node_authorized",
          nodeId: "video:a",
          data: { authorizationHash: "forged" },
        },
      }),
      /pertence ao Execution Kernel/,
    );
    recordNodeCompletion({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-1",
      output: "frame.png",
      receipt: "frame.receipt.json",
      artifacts: [{
        sha256: "a".repeat(64),
        bytes: 1024,
        mimeType: "image/png",
        receiptId: "receipt:keyframe-a",
        receiptSha256: "b".repeat(64),
      }],
    });
    const rebuilt = materializeExecutionSnapshot({ dbFile });
    assert.equal(rebuilt.nodes["keyframe:a"].status, "completed");
    assert.equal(rebuilt.nodes["keyframe:a"].attempts, 1);
    assert.equal(
      rebuilt.nodes["keyframe:a"].authorizationHash,
      keyframeAuthorization.authorizationHash,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nonce é consumido na mesma transação que marca o nó started", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-nonce-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    completeKeyframePrerequisites(dbFile);
    const rightsDecision = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const authorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision,
    });
    authorizeJournalNode({ dbFile, nodeId: "keyframe:a", authorization });
    const started = beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-atomic",
      authorization,
    });
    assert.equal(started.snapshot.nodes["keyframe:a"].status, "running");
    assert.equal(
      started.snapshot.nodes["keyframe:a"].authorizationHash,
      authorization.authorizationHash,
    );
    assert.equal(
      consumeExecutionEffectAuthorization(started.effectAuthorization, {
        provider: "gemini-image",
        operation: "image-generate",
        nodeId: "keyframe:a",
        attemptId: "attempt-atomic",
      }).authorizationHash,
      authorization.authorizationHash,
    );
    assert.throws(
      () =>
        consumeExecutionEffectAuthorization(started.effectAuthorization, {
          provider: "gemini-image",
          operation: "image-generate",
        }),
      /já foi consumida/,
    );
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "attempt-replay",
          authorization,
        }),
      /não autoriza nova tentativa|já consumido/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback entre consumo do nonce e node_started preserva os dois lados da transação", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-nonce-rollback-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    completeKeyframePrerequisites(dbFile);
    const rightsDecision = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const authorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision,
    });
    authorizeJournalNode({ dbFile, nodeId: "keyframe:a", authorization });
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "attempt-fault",
          authorization,
          fault: "after_authorization_consumed",
        }),
      /fault injection/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      0,
    );
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "attempt-effect-fault",
          authorization,
          fault: "after_effect_authorization_created",
        }),
      /fault injection after_effect_authorization_created/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      0,
    );
    const recovered = beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-after-rollback",
      authorization,
    });
    assert.equal(recovered.snapshot.nodes["keyframe:a"].attempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependências planejadas bloqueiam antes do nonce e a mesma autorização permanece utilizável", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-dependencies-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    const rightsDecision = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const authorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision,
    });
    authorizeJournalNode({ dbFile, nodeId: "keyframe:a", authorization });
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "attempt-before-dependencies",
          authorization,
        }),
      /dependências não concluídas: timeline-lock/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      0,
    );
    completeKeyframePrerequisites(dbFile);
    const started = beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-after-dependencies",
      authorization,
    });
    assert.equal(started.snapshot.nodes["keyframe:a"].status, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attemptId inválido falha antes do commit e não consome a autorização", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-attempt-id-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    completeKeyframePrerequisites(dbFile);
    const rightsDecision = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const authorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision,
    });
    authorizeJournalNode({ dbFile, nodeId: "keyframe:a", authorization });
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "   ",
          authorization,
        }),
      /attemptId é obrigatório/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      0,
    );
    const started = beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-after-invalid-id",
      authorization,
    });
    assert.equal(started.effectAuthorization.attemptId, "attempt-after-invalid-id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact da mesma execução materializa rights e revogação invalida autorização ainda não iniciada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-rights-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    completeKeyframePrerequisites(dbFile);
    const keyframeRights = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const keyframeAuthorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision: keyframeRights,
    });
    authorizeJournalNode({
      dbFile,
      nodeId: "keyframe:a",
      authorization: keyframeAuthorization,
    });
    beginNodeAttempt({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-keyframe",
      authorization: keyframeAuthorization,
    });
    recordNodeCompletion({
      dbFile,
      nodeId: "keyframe:a",
      attemptId: "attempt-keyframe",
      artifacts: [{
        artifactId: "artifact:keyframe-a",
        sha256: "c".repeat(64),
        bytes: 2048,
        mimeType: "image/png",
        receiptId: "receipt:keyframe-a",
        receiptSha256: "d".repeat(64),
      }],
    });
    completeLocalJournalNode(dbFile, "animatic");
    recordExecutionNodeApproval({
      dbFile,
      nodeId: "animatic-approval",
      targetHash: "e".repeat(64),
      actor: "human:execution-kernel-test",
      source: "approve-command",
      approvedAt: new Date(),
    });
    const videoRights = buildExecutionRightsDecision({
      dbFile,
      nodeId: "video:a",
    });
    assert.equal(videoRights.scope, "same-execution");
    assert.equal(videoRights.inputs.length, 1);
    assert.equal(videoRights.inputs[0].artifactId, "artifact:keyframe-a");
    assert.equal(videoRights.approvals.length, 1);
    assert.equal(videoRights.approvals[0].nodeId, "animatic-approval");
    const videoAuthorization = issueForJournal({
      plan,
      nodeId: "video:a",
      rightsDecision: videoRights,
    });
    authorizeJournalNode({
      dbFile,
      nodeId: "video:a",
      authorization: videoAuthorization,
    });
    const revoked = revokeExecutionArtifact({
      dbFile,
      artifactId: "artifact:keyframe-a",
      actor: "human:rights-owner",
      reason: "revogação de teste antes do POST",
    });
    assert.equal(revoked.status, "revoked");
    assert.equal(
      revoked.snapshot.nodes["video:a"].status,
      "reapproval_required",
    );
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "video:a",
          attemptId: "attempt-video",
          authorization: videoAuthorization,
        }),
      /autorização explícita|revogados/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["video:a"].attempts,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("autorização expirada deixa zero attempts e exige nova aprovação", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-expired-"));
  const dbFile = path.join(root, "journal.sqlite");
  try {
    const plan = compileFilmSpec(spec());
    initializeExecutionJournal({ dbFile, plan });
    completeKeyframePrerequisites(dbFile);
    const issuedAt = new Date();
    const rightsDecision = buildExecutionRightsDecision({
      dbFile,
      nodeId: "keyframe:a",
    });
    const authorization = issueForJournal({
      plan,
      nodeId: "keyframe:a",
      rightsDecision,
      now: issuedAt,
      ttlMs: 1_000,
    });
    authorizeJournalNode({
      dbFile,
      nodeId: "keyframe:a",
      authorization,
      now: issuedAt,
    });
    assert.throws(
      () =>
        beginNodeAttempt({
          dbFile,
          nodeId: "keyframe:a",
          attemptId: "attempt-expired",
          authorization,
          now: new Date(issuedAt.getTime() + 1_001),
        }),
      /expirada/,
    );
    assert.equal(
      materializeExecutionSnapshot({ dbFile }).nodes["keyframe:a"].attempts,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mudança apenas temporal invalida derivados locais e executa zero POST", () => {
  const before = compileFilmSpec(spec());
  const changed = spec();
  changed.scenes[0].duration = 3;
  const after = compileFilmSpec(changed);
  const impact = analyzeChangeImpact(before, after);
  assert.equal(impact.changed, true);
  assert.equal(impact.paidPostsRequired, 0);
  assert.equal(impact.changes.some((entry) => entry.nodeId === "timeline-lock" && entry.status === "stale_local"), true);
  assert.equal(impact.changes.some((entry) => entry.nodeId === "keyframe:a"), false);
  assert.equal(impact.changes.some((entry) => entry.nodeId === "video:a"), false);
  assert.equal(impact.changes.some((entry) => entry.status === "reapproval_required"), true);
});

test("mudança visual exige apenas os nós pagos afetados", () => {
  const before = compileFilmSpec(spec());
  const changed = spec();
  changed.scenes[0].prompt = "Cena B";
  const impact = analyzeChangeImpact(before, compileFilmSpec(changed));
  assert.deepEqual(impact.changes.filter((entry) => entry.status === "stale_paid").map((entry) => entry.nodeId).sort(), ["keyframe:a", "video:a"]);
});

test("estado legado migra para eventos e o snapshot reconstruído preserva conclusão", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-migrate-"));
  try {
    const dbFile = path.join(root, "journal.sqlite");
    const plan = compileFilmSpec(spec());
    const legacyState = { stages: { draft: { status: "completed", attempts: 1, outputFile: "draft.json" }, video: { status: "completed", attempts: 1 }, assembly: { status: "completed", attempts: 1, outputFile: "assembled.mp4" } } };
    migrateLegacyStateToJournal({ dbFile, plan, legacyState });
    const repeated = migrateLegacyStateToJournal({ dbFile, plan, legacyState });
    assert.equal(repeated.nodes.assembly.attempts, 1);
    const rebuilt = materializeExecutionSnapshot({ dbFile });
    assert.equal(rebuilt.nodes["keyframe:a"].status, "completed");
    assert.equal(rebuilt.nodes["video:a"].status, "completed");
    assert.equal(rebuilt.nodes.assembly.output, "assembled.mp4");
  } finally { await rm(root, { recursive: true, force: true }); }
});
