import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFilmPlan, createFilmState, validateFilmSpec } from "../lib/media-pipeline/film-orchestrator.mjs";
import {
  assertLegacyExecutorCompatibility,
  assertNewExecutionUsesJournal,
  buildExecutorReplayCorpus,
  prepareExecutorRollout,
  resolveExecutorMode,
  rollbackExecutor,
} from "../lib/media-pipeline/executor-rollout.mjs";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { migrateLegacyStateToJournal, replayExecutionJournal } from "../lib/media-pipeline/execution-journal.mjs";

test("shadow migra e rollback preserva bytes de receipts históricos", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "executor-rollout-"));
  try {
    const spec = validateFilmSpec({ name: "rollout", scenes: [{ id: "a", prompt: "Cena" }], qa: false }, { outputsRoot: path.join(root, "film") });
    const legacyPlan = createFilmPlan(spec);
    const legacyState = createFilmState(legacyPlan);
    const receiptFile = path.join(root, "historical.receipt.json");
    await writeFile(receiptFile, "historical-immutable", "utf8");
    legacyState.stages.draft.status = "completed";
    legacyState.stages.draft.attempts = 1;
    legacyState.stages.draft.receiptFile = receiptFile;
    legacyState.stages.video.status = "completed";
    legacyState.stages.video.attempts = 1;
    const before = await readFile(receiptFile, "utf8");
    const journalFile = path.join(root, "journal.sqlite");
    const rollout = prepareExecutorRollout({ legacyPlan, legacyState, journalFile, mode: "shadow" });
    assert.equal(rollout.execution, "legacy");
    assert.equal(rollout.equivalence.equivalent, true);
    assert.equal(rollout.snapshot.nodes["keyframe:a"].status, "completed");
    const rollback = rollbackExecutor({ legacyState, journalFile });
    assert.equal(rollback.execution, "legacy");
    assert.equal(rollback.receiptsMutated, false);
    assert.equal(await readFile(receiptFile, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("feature flag só aceita legacy, shadow e journal", () => {
  assert.equal(resolveExecutorMode("legacy"), "legacy");
  assert.equal(resolveExecutorMode("shadow"), "shadow");
  assert.equal(resolveExecutorMode("journal"), "journal");
  assert.throws(() => resolveExecutorMode("turbo"), /Executor inválido/);
});

test("promoção de nova execução exige journal explícito e não muta estado", () => {
  const plan = compileFilmSpec({ name: "promotion", scenes: [{ id: "a", prompt: "Cena" }], qa: false });
  assert.throws(() => assertNewExecutionUsesJournal({ plan, mode: "shadow" }), /promoção explícita/);
  assert.deepEqual(assertNewExecutionUsesJournal({ plan, mode: "journal" }), {
    schema: "mkt-videos/executor-promotion@1",
    authority: "execution-journal",
    mode: "journal",
    planFingerprint: plan.fingerprint,
    explicit: true,
    mutationPerformed: false,
  });
});

test("ponte legada preserva skipped, handle e replay determinístico sem sobrescrever receipt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "executor-replay-"));
  try {
    const rawSpec = { name: "replay", scenes: [{ id: "a", prompt: "Cena" }], captions: { enabled: true, wordsFile: path.join(root, "words.json") }, qa: false };
    const spec = validateFilmSpec(rawSpec, { outputsRoot: path.join(root, "film") });
    const plan = compileFilmSpec(rawSpec);
    const legacyState = createFilmState(createFilmPlan(spec));
    legacyState.stages.draft.status = "completed";
    legacyState.stages.draft.attempts = 1;
    legacyState.stages.draft.receiptFile = path.join(root, "historical.receipt.json");
    legacyState.stages.video.status = "running";
    legacyState.stages.video.attempts = 1;
    legacyState.stages.video.attemptId = "legacy-attempt-1";
    legacyState.stages.video.providerHandle = { fileId: "pending-1" };
    legacyState.stages.captions.status = "skipped";
    await writeFile(legacyState.stages.draft.receiptFile, "immutable", "utf8");
    const firstDb = path.join(root, "first.sqlite");
    const secondDb = path.join(root, "second.sqlite");
    migrateLegacyStateToJournal({ dbFile: firstDb, plan, legacyState });
    migrateLegacyStateToJournal({ dbFile: secondDb, plan, legacyState });
    const firstReplay = replayExecutionJournal({ dbFile: firstDb });
    const secondReplay = replayExecutionJournal({ dbFile: secondDb });
    assert.equal(firstReplay.eventHash, secondReplay.eventHash);
    assert.deepEqual(firstReplay.projection, secondReplay.projection);
    assert.equal(firstReplay.projection.nodes["video:a"].status, "attention_required");
    assert.deepEqual(firstReplay.projection.nodes["video:a"].providerHandle, { fileId: "pending-1" });
    assert.equal(firstReplay.projection.nodes["video:a"].attemptId, "legacy-attempt-1");
    assert.equal(firstReplay.projection.nodes.captions.status, "skipped");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corpus de replay é hash-bound e reporta divergência sem reparar estado", () => {
  const snapshot = {
    schema: "mkt-videos/execution-snapshot@1",
    planFingerprint: "a".repeat(64),
    status: "completed",
    nodes: {
      "keyframe:a": {
        id: "keyframe:a", fingerprint: "b".repeat(64), costClass: "paid", status: "completed", attempts: 1,
        attemptId: null, providerHandle: null, output: "frame.png", receipt: "frame.receipt.json", error: null,
        authorizationHash: null, capabilitySnapshotHash: null, rightsDecisionHash: null,
      },
    },
  };
  const legacyState = { stages: { draft: { status: "completed", attempts: 1, outputFile: "frame.png", receiptFile: "frame.receipt.json" } } };
  const corpus = buildExecutorReplayCorpus({ cases: [{ id: "fixture-complete", legacyState, snapshot }] });
  assert.equal(corpus.schema, "mkt-videos/executor-replay-corpus@1");
  assert.equal(corpus.equivalent, true);
  assert.equal(corpus.entries[0].discrepancies.length, 0);
  const divergent = buildExecutorReplayCorpus({ cases: [{ id: "fixture-divergent", legacyState, snapshot: { ...snapshot, nodes: { ...snapshot.nodes, "keyframe:a": { ...snapshot.nodes["keyframe:a"], attempts: 2 } } } }] });
  assert.equal(divergent.equivalent, false);
  assert.equal(divergent.entries[0].discrepancies[0].code, "attempt_count_diverges");
  assert.equal(divergent.entries[0].handleReconciliation.mutationPerformed, false);
});

test("executor legado falha fechado para tipo de nó novo", () => {
  const plan = compileFilmSpec({ name: "unsupported", scenes: [{ id: "a", prompt: "Cena" }], qa: false });
  const future = structuredClone(plan);
  future.nodes.push({ id: "html:a", kind: "html-motion", costClass: "local", dependencies: [], fingerprint: "c".repeat(64) });
  assert.throws(() => assertLegacyExecutorCompatibility(future), /novos tipos de nó/);
});

test("shadow migra tipo novo para auditoria, mas marca promoção legada como bloqueada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "executor-shadow-future-"));
  try {
    const spec = validateFilmSpec({
      name: "future",
      scenes: [{ id: "a", prompt: "Cena" }],
      narration: {
        provider: "google-vids",
        documentUrl: "https://docs.google.com/videos/d/test/edit",
        text: "Uma voz",
        voice: "Nyla",
        blocks: [{ id: "narration-1", text: "Uma voz" }],
      },
      qa: false,
    }, { outputsRoot: path.join(root, "film") });
    const legacyPlan = createFilmPlan(spec);
    const legacyState = createFilmState(legacyPlan);
    const rollout = prepareExecutorRollout({ legacyPlan, legacyState, journalFile: path.join(root, "journal.sqlite"), mode: "shadow" });
    assert.equal(rollout.promotionBlocked, true);
    assert.equal(rollout.legacyCompatibility.compatible, false);
    assert.equal(rollout.execution, "legacy");
    assert.ok(rollout.replay.eventHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});
