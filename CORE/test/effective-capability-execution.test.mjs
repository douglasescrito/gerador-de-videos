import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateCapabilityCandidate, appendCapabilityActivation, createCapabilityCandidate, proveCapabilityCandidateFromEvidence } from "../lib/media-pipeline/capability-lifecycle.mjs";
import { loadEffectiveProviderCapabilities, PROVIDER_CAPABILITIES } from "../lib/media-pipeline/provider-registry.mjs";
import { adaptExecutionPlanToLegacy, compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { planFilm, readFilmPlan } from "../lib/media-pipeline/film-orchestrator.mjs";
import { assertExecutionPlanIntegrity, assertPaidExecutionAuthorized } from "../lib/media-pipeline/studio-governance.mjs";
import { createExecutionKernel } from "../lib/media-pipeline/execution-kernel.mjs";
import { buildExecutionRightsDecision, initializeExecutionJournal, materializeExecutionSnapshot } from "../lib/media-pipeline/execution-journal.mjs";
import { assertExecutionAuthorizationRuntime, issueExecutionAuthorization } from "../lib/media-pipeline/execution-authorization.mjs";

test("capability renovada no ledger atravessa leitura e kernel sem reescrever o plano; divergência e expiração bloqueiam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "effective-capability-execution-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    const now = new Date();
    const base = PROVIDER_CAPABILITIES["google-vids"];
    const candidate = createCapabilityCandidate({ id: base.id, intents: base.intents, operations: base.operations, authContract: base.authContract, reconcile: base.reconcile, limitation: "Provider-free fixture", actor: "fixture", now });
    const evidenceFile = path.join(root, "fixture-evidence.json");
    const evidence = "provider-free fixture, never production evidence";
    await writeFile(evidenceFile, evidence);
    const proof = await proveCapabilityCandidateFromEvidence({ candidate, expectedCandidateHash: candidate.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0 }, liveEvidence: [{ id: "fixture", file: evidenceFile, sha256: createHash("sha256").update(evidence).digest("hex") }], adapterVersion: "fixture@1", runtimeFingerprint: "fixture", actor: "fixture", now });
    const activation = activateCapabilityCandidate({ candidate, proof, expectedProofHash: proof.proofHash, confirmHuman: true, ttlSeconds: 600, actor: "fixture", now });
    await appendCapabilityActivation({ activation });
    const providerCapabilities = await loadEffectiveProviderCapabilities({ now });
    const executionPlan = compileFilmSpec({ name: "effective-capability", scenes: [{ id: "a", prompt: "Geometria em movimento.", generationTask: "text_to_video", duration: 2 }], narration: { provider: "google-vids", voice: "Jett", text: "Uma ideia em movimento.", documentUrl: "https://docs.google.com/videos/d/fixture/edit" }, qa: false }, { providerCapabilities });
    const confirmFingerprint = executionPlan.governance.approval.fingerprint;
    const planned = await planFilm({ spec: adaptExecutionPlanToLegacy(executionPlan), executionPlan, outputsRoot: path.join(root, "outputs") });
    const originalBytes = await readFile(planned.plan.files.planFile);
    assert.equal((await readFilmPlan(planned.plan.files.planFile)).executionPlan.fingerprint, executionPlan.fingerprint);
    assert.throws(() => assertExecutionPlanIntegrity(executionPlan), /capabilitySnapshotHash/);
    assert.equal(assertPaidExecutionAuthorized(executionPlan, { confirmFingerprint, providerCapabilities, now }).fingerprint, confirmFingerprint);

    const dbFile = path.join(root, "journal.sqlite");
    initializeExecutionJournal({ dbFile, plan: executionPlan });
    const rightsDecision = buildExecutionRightsDecision({ dbFile, nodeId: "voice-master" });
    const authorization = issueExecutionAuthorization({ plan: executionPlan, nodeId: "voice-master", rightsDecision, confirmFingerprint, providerCapabilities, now });
    assert.equal(assertExecutionAuthorizationRuntime(authorization, { plan: executionPlan, nodeId: "voice-master", rightsDecision, providerCapabilities, now }), authorization);
    const changed = structuredClone(providerCapabilities);
    changed["google-vids"].evidence = "changed-after-approval";
    assert.throws(() => assertExecutionPlanIntegrity(executionPlan, { providerCapabilities: changed, now }), /capabilitySnapshotHash/);
    assert.throws(() => assertExecutionAuthorizationRuntime(authorization, { plan: executionPlan, nodeId: "voice-master", rightsDecision, providerCapabilities: changed, now }), /Capability mudou/);
    const later = new Date(now.getTime() + 601_000);
    const expired = await loadEffectiveProviderCapabilities({ now: later });
    assert.throws(() => assertPaidExecutionAuthorized(executionPlan, { confirmFingerprint, providerCapabilities: expired, now: later }), /capabilitySnapshotHash/);

    let adapterCalls = 0;
    const kernel = createExecutionKernel({ dbFile, plan: executionPlan, confirmFingerprint, clock: () => now });
    await assert.rejects(kernel.executePaidNode({ nodeId: "voice-master", execute: async () => { adapterCalls++; throw new Error("fixture reached adapter without provider"); } }), /fixture reached adapter/);
    assert.equal(adapterCalls, 1);
    assert.equal(materializeExecutionSnapshot({ dbFile }).nodes["voice-master"].attempts, 1);
    assert.deepEqual(await readFile(planned.plan.files.planFile), originalBytes);
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    await rm(root, { recursive: true, force: true });
  }
});
