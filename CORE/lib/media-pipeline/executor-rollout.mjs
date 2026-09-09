import path from "node:path";
import { compileFilmSpec } from "./film-compiler.mjs";
import {
  materializeExecutionSnapshot,
  migrateLegacyStateToJournal,
  projectExecutionSnapshotForReplay,
  replayExecutionJournal,
} from "./execution-journal.mjs";
import { operationFingerprint } from "./pipeline-operation.mjs";

export const EXECUTOR_ROLLOUT_SCHEMA = "mkt-videos/executor-rollout@1";
export const EXECUTOR_REPLAY_CORPUS_SCHEMA = "mkt-videos/executor-replay-corpus@1";
export const EXECUTOR_MODES = new Set(["legacy", "shadow", "journal"]);

const LEGACY_SUPPORTED_NODE_KINDS = new Set([
  "narration-align",
  "timeline-lock",
  "keyframe",
  "animatic",
  "human-approval",
  "omni-video",
  "assembly",
  "audio-mix",
  "master-audio-video",
  "tts",
  "music-generate",
  "music-fit",
  "captions",
  "qa",
  "qa-scene",
  "delivery",
]);

export function resolveExecutorMode(value = process.env.MKT_VIDEO_EXECUTOR ?? "legacy") {
  const mode = String(value).trim().toLowerCase();
  if (!EXECUTOR_MODES.has(mode)) throw new Error(`Executor inválido: ${mode}. Use legacy, shadow ou journal.`);
  return mode;
}

export function assertNewExecutionUsesJournal({ plan, mode } = {}) {
  if (plan?.schema !== "mkt-videos/execution-plan@1") {
    throw new Error("Novas execuções exigem execution-plan@1.");
  }
  if (String(mode ?? "").trim().toLowerCase() !== "journal") {
    throw new Error("Novas execuções exigem promoção explícita para o journal.");
  }
  return {
    schema: "mkt-videos/executor-promotion@1",
    authority: "execution-journal",
    mode: "journal",
    planFingerprint: plan.fingerprint,
    explicit: true,
    mutationPerformed: false,
  };
}

export function normalizedLegacyPlanToSpec(plan) {
  const spec = plan?.spec;
  if (!spec?.draft?.scenes) throw new Error("Plano legado não contém spec.draft.scenes.");
  return {
    name: spec.name,
    aspect: spec.aspect,
    scenes: spec.draft.scenes.map((scene) => ({
      id: scene.id,
      prompt: scene.userPrompt,
      motionPrompt: scene.motionPrompt,
      style: scene.style,
      references: structuredClone(scene.references ?? []),
      imageModel: scene.imageModel,
      imageSize: scene.imageSize,
    })),
    ...(spec.narration ? { narration: structuredClone(spec.narration) } : {}),
    ...(spec.music ? { music: structuredClone(spec.music) } : {}),
    audio: structuredClone(spec.audio ?? {}),
    assembly: structuredClone(spec.assembly ?? {}),
    ...(spec.captions ? { captions: structuredClone(spec.captions) } : {}),
    ...(spec.delivery ? { delivery: structuredClone(spec.delivery) } : {}),
    qa: spec.qa ? structuredClone(spec.qa) : false,
    budget: structuredClone(spec.budget ?? {}),
  };
}

function expectedLegacyStage(nodeId) {
  if (nodeId.startsWith("keyframe:")) return "draft";
  if (nodeId.startsWith("video:")) return "video";
  return ({
    assembly: "assembly",
    "audio-mix": "audioMix",
    master: "audioMux",
    captions: "captions",
    "qa-master": "qa",
    delivery: "delivery",
  })[nodeId] ?? null;
}

function legacyStageForNode(node) {
  return expectedLegacyStage(node.id);
}

export function inspectLegacyExecutorCompatibility(plan) {
  if (!plan || plan.schema !== "mkt-videos/execution-plan@1") {
    throw new Error("Compatibilidade legada exige execution-plan@1.");
  }
  const unsupported = (plan.nodes ?? [])
    .filter((node) => !LEGACY_SUPPORTED_NODE_KINDS.has(node.kind))
    .map((node) => `${node.id}:${node.kind}`);
  return {
    compatible: unsupported.length === 0,
    unsupported,
  };
}

export function assertLegacyExecutorCompatibility(plan) {
  const compatibility = inspectLegacyExecutorCompatibility(plan);
  const unsupported = compatibility.unsupported;
  if (unsupported.length > 0) {
    throw new Error(
      `Executor legado não pode executar novos tipos de nó: ${unsupported.join(", ")}. Use o journal.`,
    );
  }
  return true;
}

export function projectLegacyStateForReplay(legacyState) {
  const stages = legacyState?.stages ?? {};
  return Object.fromEntries(
    Object.entries(stages).map(([stageName, stage]) => [stageName, {
      status: stage?.status ?? "planned",
      attempts: Number.isSafeInteger(Number(stage?.attempts)) ? Number(stage.attempts) : 0,
      output: stage?.outputFile ?? null,
      receipt: stage?.receiptFile ?? null,
      error: stage?.error ?? null,
      attemptId: stage?.attemptId ?? null,
      providerHandle: stage?.providerHandle ?? stage?.handle ?? null,
    }]),
  );
}

export function reconcileExecutorHandles({ legacyState, snapshot } = {}) {
  const discrepancies = [];
  for (const node of Object.values(snapshot?.nodes ?? {})) {
    const stageName = legacyStageForNode(node);
    const legacy = stageName ? legacyState?.stages?.[stageName] : null;
    const legacyHandle = legacy?.providerHandle ?? legacy?.handle ?? null;
    const journalHandle = node.providerHandle ?? null;
    if (JSON.stringify(legacyHandle) !== JSON.stringify(journalHandle)) {
      if (legacyHandle !== null || journalHandle !== null) {
        discrepancies.push({
          nodeId: node.id,
          code: "provider_handle_diverges",
          legacyHandle: legacyHandle === null ? null : "present",
          journalHandle: journalHandle === null ? null : "present",
        });
      }
    }
  }
  return {
    schema: "mkt-videos/executor-handle-reconciliation@1",
    status: discrepancies.length === 0 ? "equivalent" : "attention_required",
    discrepancies,
    mutationPerformed: false,
  };
}

export function compareExecutorState({ legacyState, snapshot } = {}) {
  const discrepancies = [];
  const historicalReferences = [];
  for (const node of Object.values(snapshot.nodes)) {
    const stageName = expectedLegacyStage(node.id);
    if (!stageName) continue;
    const legacy = legacyState.stages?.[stageName];
    if (!legacy) continue;
    const expectedStatus = legacy.status === "completed"
      ? "completed"
      : legacy.status === "skipped"
        ? "skipped"
        : ["running", "ambiguous", "attention_required", "failed"].includes(legacy.status)
          ? "attention_required"
          : legacy.status;
    if (expectedStatus !== node.status && !(expectedStatus === "blocked" && ["planned", "blocked", "ready"].includes(node.status))) {
      discrepancies.push({ nodeId: node.id, code: "status_diverges", legacyStatus: legacy.status, journalStatus: node.status });
    }
    if (Number(legacy.attempts ?? 0) !== Number(node.attempts ?? 0)) {
      discrepancies.push({ nodeId: node.id, code: "attempt_count_diverges", legacyAttempts: Number(legacy.attempts ?? 0), journalAttempts: Number(node.attempts ?? 0) });
    }
    if (legacy.error && legacy.error !== node.error) discrepancies.push({ nodeId: node.id, code: "error_not_preserved" });
    if (legacy.receiptFile || legacy.outputFile) historicalReferences.push({ nodeId: node.id, outputFile: legacy.outputFile ?? null, receiptFile: legacy.receiptFile ?? null, journalOutput: node.output ?? null, journalReceipt: node.receipt ?? null });
  }
  const handles = reconcileExecutorHandles({ legacyState, snapshot });
  discrepancies.push(...handles.discrepancies);
  return {
    equivalent: discrepancies.length === 0,
    discrepancies,
    historicalReferences,
    handleReconciliation: handles,
    legacyProjection: projectLegacyStateForReplay(legacyState),
    journalProjection: projectExecutionSnapshotForReplay(snapshot),
  };
}

export function buildExecutorReplayCorpus({ cases = [] } = {}) {
  if (!Array.isArray(cases) || cases.length > 256) {
    throw new Error("Corpus de replay deve conter entre 0 e 256 casos.");
  }
  const entries = cases.map((entry, index) => {
    if (!entry?.legacyState || !entry?.snapshot) {
      throw new Error(`Caso de replay ${index} exige legacyState e snapshot.`);
    }
    const equivalence = compareExecutorState({
      legacyState: entry.legacyState,
      snapshot: entry.snapshot,
    });
    return {
      id: String(entry.id ?? `case-${index + 1}`),
      inputFingerprint: operationFingerprint({
        legacy: projectLegacyStateForReplay(entry.legacyState),
        journal: projectExecutionSnapshotForReplay(entry.snapshot),
      }),
      equivalent: equivalence.equivalent,
      discrepancies: equivalence.discrepancies,
      handleReconciliation: equivalence.handleReconciliation,
    };
  });
  return {
    schema: EXECUTOR_REPLAY_CORPUS_SCHEMA,
    caseCount: entries.length,
    equivalent: entries.every((entry) => entry.equivalent),
    entries,
  };
}

export function prepareExecutorRollout({ legacyPlan, legacyState, journalFile = null, mode = "shadow" } = {}) {
  const selected = resolveExecutorMode(mode);
  const plan = compileFilmSpec(normalizedLegacyPlanToSpec(legacyPlan));
  const legacyCompatibility = inspectLegacyExecutorCompatibility(plan);
  if (selected === "journal") assertNewExecutionUsesJournal({ plan, mode });
  if (selected === "legacy") assertLegacyExecutorCompatibility(plan);
  if (selected === "legacy") return {
    schema: EXECUTOR_ROLLOUT_SCHEMA,
    mode: "legacy",
    execution: "legacy",
    journalFile: null,
    planFingerprint: plan.fingerprint,
    legacyCompatibility,
    equivalence: { equivalent: true, discrepancies: [], historicalReferences: [], handleReconciliation: { status: "not_applicable", discrepancies: [], mutationPerformed: false } },
    rollback: "already_legacy",
  };
  const target = path.resolve(journalFile ?? path.join(path.dirname(legacyState.stateFile), "execution-journal.sqlite"));
  const snapshot = migrateLegacyStateToJournal({ dbFile: target, plan, legacyState });
  const equivalence = compareExecutorState({ legacyState, snapshot });
  if (selected === "journal" && !equivalence.equivalent) throw new Error(`Rollout journal bloqueado por ${equivalence.discrepancies.length} divergência(s).`);
  const replay = replayExecutionJournal({ dbFile: target });
  return {
    schema: EXECUTOR_ROLLOUT_SCHEMA,
    mode: selected,
    execution: selected === "shadow" ? "legacy" : "journal",
    journalFile: target,
    planFingerprint: plan.fingerprint,
    snapshot,
    replay,
    equivalence,
    legacyCompatibility,
    promotionBlocked: selected === "shadow" && !legacyCompatibility.compatible,
    rollback: "switch_to_legacy_without_touching_receipts_or_handles",
    rollbackFingerprint: operationFingerprint({ planFingerprint: plan.fingerprint, mode: "legacy", receiptsMutated: false }),
  };
}

export function rollbackExecutor({ legacyState, journalFile = null } = {}) {
  let snapshot = null;
  if (journalFile) {
    try { snapshot = materializeExecutionSnapshot({ dbFile: journalFile }); }
    catch (error) {
      if (!String(error?.message ?? error).includes("Journal sem execution plan")) throw error;
    }
  }
  const handleReconciliation = snapshot
    ? reconcileExecutorHandles({ legacyState, snapshot })
    : { status: "not_available", discrepancies: [], mutationPerformed: false };
  return {
    schema: EXECUTOR_ROLLOUT_SCHEMA,
    mode: "legacy",
    execution: "legacy",
    stateFile: legacyState.stateFile,
    legacyState,
    journalSnapshot: snapshot,
    handleReconciliation,
    receiptsMutated: false,
    mutationPerformed: false,
    rollbackFingerprint: operationFingerprint({
      stateFile: legacyState.stateFile,
      journalPresent: Boolean(snapshot),
      receiptsMutated: false,
    }),
  };
}
