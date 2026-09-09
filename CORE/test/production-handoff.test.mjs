import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { productionHandoff } from "../lib/media-pipeline/production-handoff.mjs";
import { planFilm } from "../lib/media-pipeline/film-orchestrator.mjs";
import { loadEffectiveProviderCapabilities } from '../lib/media-pipeline/provider-registry.mjs';
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { initializeExecutionJournal, beginNodeAttempt, materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";

test("handoff deriva do journal sem escrever ou repetir tentativa", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-"));
  try {
    const spec = { name: "handoff", scenes: [{ id: "a", prompt: "Cena", duration: 2 }], qa: false };
    const executionPlan = compileFilmSpec(spec, { providerCapabilities: await loadEffectiveProviderCapabilities() });
    const { state } = await planFilm({ spec, executionPlan, outputsRoot: root });
    const journalFile = path.join(path.dirname(state.stateFile), "execution-journal.sqlite");
    initializeExecutionJournal({ dbFile: journalFile, plan: executionPlan });
    const before = await readFile(state.stateFile);
    const ready = await productionHandoff({ stateFile: state.stateFile });
    assert.equal(ready.source, "execution-journal");
    assert.equal(ready.nextOperation.operation, "resume");
    assert.equal(ready.authority.authorizesResume, false);
    beginNodeAttempt({ dbFile: journalFile, nodeId: "alignment", attemptId: "local-active" });
    const active = materializeExecutionSnapshot({ dbFile: journalFile, readOnly: true });
    const pending = await productionHandoff({ stateFile: state.stateFile });
    assert.equal(pending.nextOperation.operation, "status/reconcile");
    assert.deepEqual(pending.nextOperation.nodeIds, ["alignment"]);
    assert.deepEqual(materializeExecutionSnapshot({ dbFile: journalFile, readOnly: true }), active);
    assert.deepEqual(await readFile(state.stateFile), before);
    const receiptFile = path.join(root, "legacy.json");
    await writeFile(receiptFile, JSON.stringify({ schema: "serie-a-materia/receita@1", id: "old" }));
    const legacy = await productionHandoff({ receiptFile });
    assert.equal(legacy.journal, null);
    assert.equal(legacy.nextOperation.operation, "inspect");
    assert.equal(legacy.evidence.mediaVerified, false);
    await assert.rejects(productionHandoff({ stateFile: state.stateFile, receiptFile }), /exatamente/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
