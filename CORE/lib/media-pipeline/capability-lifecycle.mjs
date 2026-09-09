import { operationFingerprint } from "./pipeline-operation.mjs";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const CAPABILITY_CANDIDATE_SCHEMA = "mkt-videos/capability-candidate@1";
export const CAPABILITY_PROOF_SCHEMA = "mkt-videos/capability-proof@1";
export const CAPABILITY_ACTIVATION_SCHEMA = "mkt-videos/capability-activation@1";

function text(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function canonical(value, hashField, label) {
  const { [hashField]: hash, ...body } = value ?? {};
  if (hash !== operationFingerprint(body)) throw new Error(`${label} diverge do hash canônico.`);
  return body;
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export function defaultCapabilityActivationFile({ localAppData = process.env.LOCALAPPDATA } = {}) {
  if (!String(localAppData ?? "").trim()) throw new Error("LOCALAPPDATA é obrigatório para o store de capabilities.");
  return path.join(path.resolve(String(localAppData)), "GeradorDeVideos", "capabilities", "activations.jsonl");
}

export function createCapabilityCandidate({ id, adapterProvider = null, intents, operations, authContract, reconcile = false, limitation, actor, now = new Date() } = {}) {
  if (!Array.isArray(intents) || !intents.length || !Array.isArray(operations) || !operations.length) throw new Error("Capability candidata exige intents e operations.");
  const body = {
    schema: CAPABILITY_CANDIDATE_SCHEMA,
    id: text(id, "id"),
    adapterProvider: adapterProvider == null ? null : text(adapterProvider, "adapterProvider"),
    intents: [...new Set(intents.map((entry) => text(entry, "intents[]")))].sort(),
    operations: [...new Set(operations.map((entry) => text(entry, "operations[]")))].sort(),
    authContract: text(authContract, "authContract"),
    reconcile: Boolean(reconcile),
    limitation: text(limitation, "limitation"),
    status: "candidate",
    deliveryDependencyAllowed: false,
    createdAt: new Date(now).toISOString(),
    createdBy: text(actor, "actor"),
  };
  return Object.freeze({ ...body, candidateHash: operationFingerprint(body) });
}

export function proveCapabilityCandidate({ candidate, expectedCandidateHash, conformance, replay, liveEvidence, benchmark = null, actor, now = new Date() } = {}) {
  const candidateBody = canonical(candidate, "candidateHash", "Capability candidata");
  if (candidate.candidateHash !== expectedCandidateHash) throw new Error("Capability candidata diverge do hash esperado.");
  if (conformance?.status !== "passed" || conformance?.providerCalls !== 0) throw new Error("Prova exige conformance provider-free aprovada.");
  if (replay?.status !== "passed" || replay?.providerCalls !== 0) throw new Error("Prova exige replay provider-free aprovado.");
  if (!Array.isArray(liveEvidence) || liveEvidence.length === 0) throw new Error("Capability paga exige evidência live separadamente autorizada.");
  for (const [index, evidence] of liveEvidence.entries()) {
    if (!evidence?.id || !/^[a-f0-9]{64}$/u.test(String(evidence.sha256 ?? ""))) throw new Error(`liveEvidence[${index}] inválida.`);
  }
  const body = {
    schema: CAPABILITY_PROOF_SCHEMA,
    candidateHash: candidate.candidateHash,
    capabilityId: candidateBody.id,
    conformance: structuredClone(conformance),
    replay: structuredClone(replay),
    liveEvidence: structuredClone(liveEvidence),
    benchmark: benchmark == null ? null : structuredClone(benchmark),
    status: "proved",
    valid: true,
    provedAt: new Date(now).toISOString(),
    provedBy: text(actor, "actor"),
  };
  return Object.freeze({ ...body, proofHash: operationFingerprint(body) });
}

export async function proveCapabilityCandidateFromEvidence({ candidate, expectedCandidateHash, conformance, replay, liveEvidence, adapterVersion, runtimeFingerprint, benchmark = null, actor, now = new Date() } = {}) {
  const normalizedEvidence = [];
  for (const [index, evidence] of (liveEvidence ?? []).entries()) {
    const file = path.resolve(text(evidence.file, `liveEvidence[${index}].file`));
    const actual = await sha256File(file);
    if (actual !== String(evidence.sha256 ?? "")) throw new Error(`liveEvidence[${index}] diverge dos bytes em disco.`);
    normalizedEvidence.push({ id: text(evidence.id, `liveEvidence[${index}].id`), file, sha256: actual });
  }
  const proof = proveCapabilityCandidate({ candidate, expectedCandidateHash, conformance, replay, liveEvidence: normalizedEvidence, benchmark, actor, now });
  const { proofHash: _oldHash, ...body } = proof;
  const material = {
    ...body,
    adapterVersion: text(adapterVersion, "adapterVersion"),
    runtimeFingerprint: text(runtimeFingerprint, "runtimeFingerprint"),
    materialVerified: true,
  };
  return Object.freeze({ ...material, proofHash: operationFingerprint(material) });
}

export function activateCapabilityCandidate({ candidate, proof, expectedProofHash, confirmHuman = false, ttlSeconds = 2_592_000, actor, now = new Date() } = {}) {
  const candidateBody = canonical(candidate, "candidateHash", "Capability candidata");
  canonical(proof, "proofHash", "Prova da capability");
  if (proof.proofHash !== expectedProofHash || proof.candidateHash !== candidate.candidateHash || proof.valid !== true) throw new Error("Prova não corresponde à capability candidata.");
  if (confirmHuman !== true) throw new Error("Ativação de capability exige confirmação humana explícita.");
  const seconds = Number(ttlSeconds);
  if (!Number.isSafeInteger(seconds) || seconds < 60) throw new Error("ttlSeconds inválido.");
  const activatedAt = new Date(now);
  const capability = {
    id: candidateBody.id,
    ...(candidateBody.adapterProvider ? { adapterProvider: candidateBody.adapterProvider } : {}),
    intents: candidateBody.intents,
    operations: candidateBody.operations,
    auth: ["browser-session"],
    authContract: candidateBody.authContract,
    reconcile: candidateBody.reconcile,
    stability: "experimental",
    status: "supported",
    deliveryDependencyAllowed: true,
    evidence: proof.proofHash,
    checkedAt: activatedAt.toISOString(),
    evidenceAt: activatedAt.toISOString().slice(0, 10),
    ttlSeconds: seconds,
    expiresAt: new Date(activatedAt.getTime() + seconds * 1000).toISOString(),
    limitation: candidateBody.limitation,
    replacement: null,
    proof: { valid: true, hash: proof.proofHash },
  };
  const body = { schema: CAPABILITY_ACTIVATION_SCHEMA, candidateHash: candidate.candidateHash, proofHash: proof.proofHash, capability, activatedAt: activatedAt.toISOString(), activatedBy: text(actor, "actor"), humanConfirmed: true, materialVerified: proof.materialVerified === true, adapterVersion: proof.adapterVersion ?? null, runtimeFingerprint: proof.runtimeFingerprint ?? null };
  return Object.freeze({ ...body, activationHash: operationFingerprint(body) });
}

export async function appendCapabilityActivation({ activation, storeFile = defaultCapabilityActivationFile() } = {}) {
  canonical(activation, "activationHash", "Ativação de capability");
  if (activation.materialVerified !== true) throw new Error("Store operacional aceita somente ativação com evidência material verificada.");
  const file = path.resolve(String(storeFile));
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (existing.split(/\r?\n/u).filter(Boolean).some((line) => JSON.parse(line).activationHash === activation.activationHash)) {
    throw new Error("Ativação já existe no ledger append-only.");
  }
  await appendFile(file, `${JSON.stringify(activation)}\n`, { encoding: "utf8", flush: true });
  return { storeFile: file, activationHash: activation.activationHash };
}

export async function loadCapabilityActivations({ storeFile = defaultCapabilityActivationFile() } = {}) {
  const file = path.resolve(String(storeFile));
  const source = await readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  return source.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    const activation = JSON.parse(line);
    canonical(activation, "activationHash", `Ativação ${index + 1}`);
    if (activation.materialVerified !== true) throw new Error(`Ativação ${index + 1} não possui prova material.`);
    return activation;
  });
}

export function mergeActivatedCapabilities(base, activations, { now = new Date() } = {}) {
  const merged = Object.fromEntries(Object.entries(base ?? {}).map(([key, value]) => [key, structuredClone(value)]));
  for (const activation of activations ?? []) {
    canonical(activation, "activationHash", "Ativação de capability");
    if (activation.humanConfirmed !== true || Date.parse(activation.capability.expiresAt) <= new Date(now).getTime()) continue;
    merged[activation.capability.id] = structuredClone(activation.capability);
  }
  return Object.freeze(merged);
}
