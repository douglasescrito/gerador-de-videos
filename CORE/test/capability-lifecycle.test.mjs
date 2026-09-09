import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { activateCapabilityCandidate, appendCapabilityActivation, createCapabilityCandidate, loadCapabilityActivations, mergeActivatedCapabilities, proveCapabilityCandidate, proveCapabilityCandidateFromEvidence } from "../lib/media-pipeline/capability-lifecycle.mjs";
import { assertCapabilityExpiryWindow, buildEffectiveCapabilityMap, loadEffectiveProviderCapabilities, PROVIDER_CAPABILITIES, resolveCapabilityIntent } from "../lib/media-pipeline/provider-registry.mjs";

function candidate() {
  return createCapabilityCandidate({ id: "google-vids-multi-voice", adapterProvider: "google-vids", intents: ["narration.generate.segmented-multi-voice"], operations: ["segmented-text-to-speech"], authContract: "cookie-only-browser-session", reconcile: true, limitation: "prova obrigatória", actor: "human", now: new Date("2026-08-13T12:00:00Z") });
}

test("capability candidata fica bloqueada sem prova live e replay", () => {
  const resolution = resolveCapabilityIntent(PROVIDER_CAPABILITIES, { intent: "narration.generate.segmented-multi-voice", operation: "segmented-text-to-speech" });
  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.candidates[0].status, "pending");
  const value = candidate();
  assert.throws(() => proveCapabilityCandidate({ candidate: value, expectedCandidateHash: value.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0 }, liveEvidence: [], actor: "human" }), /evidência live/);
});

test("candidato passa por prova, ativação humana e expira sem fallback", () => {
  const value = candidate();
  const proof = proveCapabilityCandidate({ candidate: value, expectedCandidateHash: value.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0, replayHash: "b".repeat(64) }, liveEvidence: [{ id: "live:segment-1", sha256: "a".repeat(64) }], actor: "auditor", now: new Date("2026-08-13T12:10:00Z") });
  assert.throws(() => activateCapabilityCandidate({ candidate: value, proof, expectedProofHash: proof.proofHash, actor: "human" }), /confirmação humana/);
  const activation = activateCapabilityCandidate({ candidate: value, proof, expectedProofHash: proof.proofHash, confirmHuman: true, ttlSeconds: 3600, actor: "human", now: new Date("2026-08-13T12:20:00Z") });
  const active = mergeActivatedCapabilities(PROVIDER_CAPABILITIES, [activation], { now: new Date("2026-08-13T12:30:00Z") });
  assert.equal(resolveCapabilityIntent(active, { intent: "narration.generate.segmented-multi-voice", operation: "segmented-text-to-speech" }).status, "ready");
  const expired = mergeActivatedCapabilities(PROVIDER_CAPABILITIES, [activation], { now: new Date("2026-08-13T14:00:01Z") });
  assert.equal(resolveCapabilityIntent(expired, { intent: "narration.generate.segmented-multi-voice", operation: "segmented-text-to-speech" }).status, "blocked");
});

test("ledger operacional só ativa prova material re-hasheada e expira no planner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capability-ledger-"));
  try {
    const evidenceFile = path.join(root, "live.receipt.json");
    const bytes = Buffer.from("evidencia-live-autorizada");
    await writeFile(evidenceFile, bytes);
    const value = candidate();
    await assert.rejects(() => proveCapabilityCandidateFromEvidence({ candidate: value, expectedCandidateHash: value.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0 }, liveEvidence: [{ id: "live:1", file: evidenceFile, sha256: "0".repeat(64) }], adapterVersion: "vids@1", runtimeFingerprint: "runtime:test", actor: "auditor" }), /diverge dos bytes/);
    const proof = await proveCapabilityCandidateFromEvidence({ candidate: value, expectedCandidateHash: value.candidateHash, conformance: { status: "passed", providerCalls: 0 }, replay: { status: "passed", providerCalls: 0 }, liveEvidence: [{ id: "live:1", file: evidenceFile, sha256: createHash("sha256").update(bytes).digest("hex") }], adapterVersion: "vids@1", runtimeFingerprint: "runtime:test", actor: "auditor", now: new Date("2026-08-13T12:10:00Z") });
    const activation = activateCapabilityCandidate({ candidate: value, proof, expectedProofHash: proof.proofHash, confirmHuman: true, ttlSeconds: 3600, actor: "human", now: new Date("2026-08-13T12:20:00Z") });
    const storeFile = path.join(root, "activations.jsonl");
    await appendCapabilityActivation({ activation, storeFile });
    assert.equal((await loadCapabilityActivations({ storeFile })).length, 1);
    const active = await loadEffectiveProviderCapabilities({ storeFile, now: new Date("2026-08-13T12:30:00Z") });
    assert.equal(resolveCapabilityIntent(active, { intent: "narration.generate.segmented-multi-voice", operation: "segmented-text-to-speech" }).status, "ready");
    const expired = await loadEffectiveProviderCapabilities({ storeFile, now: new Date("2026-08-13T14:00:01Z") });
    assert.equal(resolveCapabilityIntent(expired, { intent: "narration.generate.segmented-multi-voice", operation: "segmented-text-to-speech" }).status, "blocked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mapa efetivo expõe validade e gate acusa cliff menor que sete dias", async () => {
  const storeFile = path.join(os.tmpdir(), "nonexistent-empty-capabilities.jsonl");
  const safe = await buildEffectiveCapabilityMap({ storeFile, now: new Date("2026-08-24T12:00:00Z") });
  const omni = safe.capabilities.find((entry) => entry.id === "gemini-omni");
  assert.equal(omni.expiresAt, "2026-09-23T12:00:00.000Z");
  assert.equal(omni.freshness.status, "valid");
  assert.equal(assertCapabilityExpiryWindow(safe, { minimumDays: 7, now: new Date("2026-08-24T12:00:00Z") }), true);

  const cliff = await buildEffectiveCapabilityMap({ storeFile, now: new Date("2026-09-17T12:00:00Z") });
  assert.equal(cliff.capabilities.find((entry) => entry.id === "gemini-omni").freshness.status, "expiring-soon");
  assert.throws(() => assertCapabilityExpiryWindow(cliff, { minimumDays: 7, now: new Date("2026-09-17T12:00:00Z") }), /gemini-omni/);

  const expired = await buildEffectiveCapabilityMap({ storeFile, now: new Date("2026-09-23T12:00:01Z") });
  assert.equal(expired.capabilities.find((entry) => entry.id === "gemini-omni").status, "blocked");
});

test("gate operacional falha se capability supported entrar na janela real de sete dias", async () => {
  const now = new Date();
  const effective = await buildEffectiveCapabilityMap({ now });
  assert.equal(assertCapabilityExpiryWindow(effective, { minimumDays: 7, now }), true);
});
