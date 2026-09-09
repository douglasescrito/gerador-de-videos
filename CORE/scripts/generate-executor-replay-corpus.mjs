import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { operationFingerprint } from "../lib/media-pipeline/pipeline-operation.mjs";
import {
  prepareExecutorRollout,
  projectLegacyStateForReplay,
} from "../lib/media-pipeline/executor-rollout.mjs";

const CORPUS_REPORT_SCHEMA = "mkt-videos/executor-replay-corpus-report@1";

async function findFilmStates(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    const candidate = path.join(absolute, "metadados", "film-state.json");
    try {
      await readFile(candidate, "utf8");
      result.push(candidate);
    } catch {
      // A collection without a film-state is not part of this corpus.
    }
  }
  return result;
}

function stageSummary(state) {
  return Object.fromEntries(
    Object.entries(state?.stages ?? {}).map(([name, stage]) => [name, {
      status: stage?.status ?? null,
      attempts: Number(stage?.attempts ?? 0),
      hasOutput: Boolean(stage?.outputFile),
      hasReceipt: Boolean(stage?.receiptFile),
      hasHandle: Boolean(stage?.providerHandle ?? stage?.handle),
    }]),
  );
}

function summarizeRollout(rollout, legacyState, collection) {
  const equivalence = rollout.equivalence;
  return {
    collection,
    stateSchema: legacyState.schema ?? "unknown",
    stateId: legacyState.id ?? null,
    planFingerprint: rollout.planFingerprint,
    inputFingerprint: operationFingerprint({
      planFingerprint: rollout.planFingerprint,
      legacy: projectLegacyStateForReplay(legacyState),
    }),
    status: equivalence.equivalent ? "equivalent" : "attention_required",
    promotionBlocked: Boolean(rollout.promotionBlocked),
    legacyCompatibility: rollout.legacyCompatibility,
    legacyStages: stageSummary(legacyState),
    journalNodes: Object.fromEntries(
      Object.entries(rollout.snapshot.nodes ?? {}).map(([nodeId, node]) => [nodeId, {
        status: node.status,
        attempts: node.attempts,
        hasHandle: Boolean(node.providerHandle),
      }]),
    ),
    discrepancies: equivalence.discrepancies.map((entry) => ({
      nodeId: entry.nodeId ?? null,
      code: entry.code ?? "unknown",
      legacyStatus: entry.legacyStatus ?? null,
      journalStatus: entry.journalStatus ?? null,
    })),
    handleReconciliation: equivalence.handleReconciliation,
    replay: {
      schema: rollout.replay.schema,
      eventCount: rollout.replay.eventCount,
      eventHash: rollout.replay.eventHash,
      planFingerprint: rollout.replay.planFingerprint,
    },
  };
}

async function main() {
  const coreRoot = path.resolve(import.meta.dirname, "..");
  const outputsRoot = path.join(coreRoot, "outputs");
  const diagnosticsRoot = path.join(coreRoot, "diagnosticos", "governanca");
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  const outputFile = path.resolve(outArg ? outArg.slice("--out=".length) : path.join(diagnosticsRoot, "executor-replay-corpus.json"));
  const stateFiles = await findFilmStates(outputsRoot);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mkt-executor-replay-"));
  const cases = [];
  try {
    for (const stateFile of stateFiles) {
      const collection = path.relative(outputsRoot, path.dirname(path.dirname(stateFile))).replaceAll("\\", "/");
      const planFile = path.join(path.dirname(stateFile), "film-plan.json");
      try {
        const [legacyState, legacyPlan] = await Promise.all([
          readFile(stateFile, "utf8").then(JSON.parse),
          readFile(planFile, "utf8").then(JSON.parse),
        ]);
        const journalFile = path.join(tempRoot, `${cases.length}.sqlite`);
        const rollout = prepareExecutorRollout({
          legacyPlan,
          legacyState,
          journalFile,
          mode: "shadow",
        });
        cases.push(summarizeRollout(rollout, legacyState, collection));
      } catch (error) {
        cases.push({
          collection,
          status: "blocked",
          code: "replay_corpus_case_failed",
          message: String(error?.message ?? error).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 500),
        });
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  cases.sort((a, b) => a.collection.localeCompare(b.collection));
  const report = {
    schema: CORPUS_REPORT_SCHEMA,
    source: "CORE/outputs",
    providerFree: true,
    mutationPerformed: false,
    caseCount: cases.length,
    counts: {
      equivalent: cases.filter((entry) => entry.status === "equivalent").length,
      attentionRequired: cases.filter((entry) => entry.status === "attention_required").length,
      blocked: cases.filter((entry) => entry.status === "blocked").length,
      promotionBlocked: cases.filter((entry) => entry.promotionBlocked === true).length,
    },
    cases,
  };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputFile, caseCount: report.caseCount, counts: report.counts })}\n`);
}

await main();
