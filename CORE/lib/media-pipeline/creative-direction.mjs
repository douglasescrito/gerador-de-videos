import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { operationFingerprint, writeJsonAtomic } from "./pipeline-operation.mjs";

export const CREATIVE_ENVELOPE_SCHEMA = "mkt-videos/creative-envelope@1";
export const CREATIVE_FINGERPRINT_SCHEMA = "mkt-videos/creative-fingerprint@1";
export const CREATIVE_DIRECTION_PROPOSAL_SCHEMA = "mkt-videos/creative-direction-proposal@1";
export const CREATIVE_DIRECTION_DECISION_SCHEMA = "mkt-videos/creative-direction-decision@1";

export const CREATIVE_AXES = Object.freeze([
  "thesis",
  "arc",
  "keyVisual",
  "aestheticTerritory",
  "motionMechanism",
  "composition",
  "soundResolution",
]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function uniqueOptions(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} deve conter opções.`);
  return [...new Set(value.map((entry) => requiredText(entry, `${label}[]`)))];
}

function rotate(values, seed) {
  if (values.length < 2) return [...values];
  const offset = createHash("sha256").update(seed).digest().readUInt32BE(0) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function cartesianAxes(options, seed, limit = 10_000) {
  let combinations = [{}];
  for (const axis of CREATIVE_AXES) {
    const values = rotate(options[axis], `${seed}:${axis}`);
    const next = [];
    for (const combination of combinations) {
      for (const value of values) {
        next.push({ ...combination, [axis]: value });
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    combinations = next;
  }
  return combinations;
}

function fingerprintAxes(value) {
  if (value?.schema === CREATIVE_FINGERPRINT_SCHEMA) return value.axes;
  if (value?.axes) return value.axes;
  if (value && CREATIVE_AXES.every((axis) => typeof value[axis] === "string")) return Object.fromEntries(CREATIVE_AXES.map((axis) => [axis, value[axis]]));
  return null;
}

function combinationHash(axes) {
  return operationFingerprint(Object.fromEntries(CREATIVE_AXES.map((axis) => [axis, axes[axis]])));
}

export function editorialCoverage(entries = []) {
  const counts = new Map();
  let unclassified = 0;
  for (const entry of entries) {
    const chain = entry?.envelope?.editorialChain ?? entry?.editorialChain;
    if (!chain?.theme || !chain?.thesis || !chain?.conflict) { unclassified++; continue; }
    const key = operationFingerprint({ theme: chain.theme, thesis: chain.thesis, conflict: chain.conflict });
    const prior = counts.get(key) ?? { theme: chain.theme, thesis: chain.thesis, conflict: chain.conflict, count: 0 };
    prior.count++;
    counts.set(key, prior);
  }
  return { classified: entries.length - unclassified, unclassified, arguments: [...counts.values()], authority: "none", automaticPromotion: false };
}

function normalizeEditorialChain(value) {
  const fields = ["theme", "question", "thesis", "conflict", "observableSituation", "turn", "ending", "visualMechanism"];
  const chain = Object.fromEntries(fields.map((field) => [field, requiredText(value?.[field], `decision.editorialChain.${field}`)]));
  chain.evidenceRefs = uniqueOptions(value?.evidenceRefs, "decision.editorialChain.evidenceRefs");
  return chain;
}

export function assertCreativeDirectionDecision(value, { context = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Decisão criativa inválida.");
  if (value.schema !== CREATIVE_DIRECTION_DECISION_SCHEMA) throw new Error(`Decisão criativa deve usar ${CREATIVE_DIRECTION_DECISION_SCHEMA}.`);
  const { decisionHash, ...body } = value;
  if (decisionHash !== operationFingerprint(body)) throw new Error("Decisão criativa diverge do hash canônico.");
  if (value.authority?.humanConfirmed !== true) throw new Error("Decisão criativa exige confirmação humana.");
  if (value.authority?.providerCalls !== 0 || value.authority?.generationTriggered !== false) throw new Error("Decisão criativa materializada deve ser provider-free.");
  if (value.envelope?.schema !== CREATIVE_ENVELOPE_SCHEMA || value.fingerprint?.schema !== CREATIVE_FINGERPRINT_SCHEMA) throw new Error("Envelope ou fingerprint criativo inválido.");
  if (context != null) {
    if (value.envelope.rootScopeId !== context.rootScopeId || value.envelope.projectScopeId !== context.projectScopeId) throw new Error("Decisão criativa atravessa root ou projeto do contexto diretor.");
    if (value.envelope.contextFingerprint !== context.contextFingerprint) throw new Error("Decisão criativa foi criada para outro contexto diretor.");
    if (value.envelope.profileFingerprint !== context.profileFingerprint) throw new Error("Decisão criativa foi criada para outro perfil diretor.");
    if (value.fingerprint.releaseHash !== context.activeRelease.hash) throw new Error("Decisão criativa foi criada para outra release ativa.");
  }
  return Object.freeze(structuredClone(value));
}

export function createCreativeDirectionProposal({ context, decision, recentWindow = 12 } = {}) {
  if (context?.schema !== "mkt-videos/director-context@1") throw new Error("Contexto diretor inválido.");
  const profile = context.profile;
  const intent = decision?.intent ?? "marketing";
  if (!["marketing", "editorial"].includes(intent)) throw new Error("decision.intent deve ser marketing ou editorial.");
  const editorialChain = intent === "editorial" ? normalizeEditorialChain(decision?.editorialChain) : null;
  const axisOptions = editorialChain ? {
    ...decision?.axisOptions,
    thesis: [editorialChain.thesis],
    arc: [`${editorialChain.observableSituation} → ${editorialChain.conflict} → ${editorialChain.turn} → ${editorialChain.ending}`],
    keyVisual: [editorialChain.visualMechanism],
  } : decision?.axisOptions;
  const decisionBody = {
    decisionId: requiredText(decision?.decisionId, "decision.decisionId"),
    ...(editorialChain ? { intent, editorialChain } : { marketingObjective: requiredText(decision?.marketingObjective, "decision.marketingObjective") }),
    audience: requiredText(decision?.audience, "decision.audience"),
    ...(editorialChain ? {} : { promise: requiredText(decision?.promise, "decision.promise"), callToAction: requiredText(decision?.callToAction, "decision.callToAction") }),
    axisOptions: Object.fromEntries(CREATIVE_AXES.map((axis) => [axis, uniqueOptions(axisOptions?.[axis], `decision.axisOptions.${axis}`)])),
  };
  const windowSize = Math.max(1, Math.min(100, Number(recentWindow) || 12));
  const recent = (context.recentCreativeFingerprints ?? []).slice(0, windowSize);
  const recentHashes = new Set(recent.map((entry) => {
    const priorAxes = fingerprintAxes(entry?.fingerprint ?? entry);
    return entry?.fingerprint?.combinationHash ?? entry?.combinationHash ?? (priorAxes ? combinationHash(priorAxes) : null);
  }).filter(Boolean));
  const decisionHash = operationFingerprint(decisionBody);
  const seed = operationFingerprint({ contextFingerprint: context.contextFingerprint, decisionHash, releaseHash: context.activeRelease.hash });
  const combinations = cartesianAxes(decisionBody.axisOptions, seed);
  const axes = combinations.find((candidate) => !recentHashes.has(combinationHash(candidate)));
  if (!axes) throw new Error(`Release ativa esgotou as ${combinations.length} combinações permitidas dentro da janela de não repetição.`);
  const previousAxes = fingerprintAxes(recent[0]?.fingerprint ?? recent[0]);
  const preservedAxes = previousAxes == null ? [] : CREATIVE_AXES.filter((axis) => previousAxes[axis] === axes[axis]);
  const changedAxes = previousAxes == null ? [...CREATIVE_AXES] : CREATIVE_AXES.filter((axis) => previousAxes[axis] !== axes[axis]);
  const envelopeBody = {
    schema: CREATIVE_ENVELOPE_SCHEMA,
    clientId: profile.clientId,
    projectId: profile.projectId,
    rootScopeId: context.rootScopeId,
    projectScopeId: context.projectScopeId,
    activeRelease: context.activeRelease,
    profileFingerprint: context.profileFingerprint,
    contextFingerprint: context.contextFingerprint,
    decisionId: decisionBody.decisionId,
    decisionHash,
    ...(editorialChain ? { intent, editorialChain } : {}),
    preserved: {
      brandPositioning: profile.brand.positioning,
      requiredClosing: profile.brand.requiredClosing,
      forbiddenTerms: [...profile.brand.forbiddenTerms],
      style: profile.creative.primaryStyle,
      audience: decisionBody.audience,
      ...(editorialChain ? {} : { promise: decisionBody.promise, callToAction: decisionBody.callToAction }),
    },
    selectedAxes: axes,
  };
  const envelope = Object.freeze({ ...envelopeBody, envelopeHash: operationFingerprint(envelopeBody) });
  const fingerprintBody = {
    schema: CREATIVE_FINGERPRINT_SCHEMA,
    releaseId: context.activeRelease.id,
    releaseHash: context.activeRelease.hash,
    profileFingerprint: context.profileFingerprint,
    decisionHash,
    axes,
    combinationHash: combinationHash(axes),
  };
  const fingerprint = Object.freeze({ ...fingerprintBody, fingerprintHash: operationFingerprint(fingerprintBody) });
  const variationReason = previousAxes == null
    ? "Primeira combinação factual registrada nesta janela da release ativa."
    : `Mantidos ${preservedAxes.length} eixo(s) e alterados ${changedAxes.length}: ${changedAxes.join(", ")}.`;
  const body = {
    schema: CREATIVE_DIRECTION_PROPOSAL_SCHEMA,
    envelope,
    fingerprint,
    variation: {
      ...(editorialChain ? { editorialCoverage: editorialCoverage(context.recentCreativeFingerprints ?? []) } : {}),
      reason: variationReason,
      preservedAxes,
      changedAxes,
      comparedWith: recent[0]?.productionId ?? null,
      recentWindow: windowSize,
      repeatedCombination: false,
    },
    planSeed: operationFingerprint({ envelopeHash: envelope.envelopeHash, fingerprintHash: fingerprint.fingerprintHash }),
    authority: {
      status: "proposal",
      providerCalls: 0,
      generationTriggered: false,
      preferenceEvidenceUsedForSelection: false,
      automaticPromotion: false,
      humanDecisionRequired: true,
    },
  };
  return Object.freeze({ ...body, proposalHash: operationFingerprint(body) });
}

export async function materializeCreativeDirection({ proposal, expectedProposalHash, confirmHuman = false, productionDir, productionId, actor = "local-human", now = new Date() } = {}) {
  if (proposal?.schema !== CREATIVE_DIRECTION_PROPOSAL_SCHEMA) throw new Error("Proposta de direção inválida.");
  const { proposalHash, ...proposalBody } = proposal;
  if (proposalHash !== expectedProposalHash || operationFingerprint(proposalBody) !== proposalHash) throw new Error("Proposta de direção diverge do hash esperado.");
  if (confirmHuman !== true) throw new Error("Materializar direção exige confirmação humana explícita.");
  const target = path.resolve(requiredText(productionDir, "productionDir"));
  const id = requiredText(productionId, "productionId");
  await mkdir(target, { recursive: true });
  const body = {
    schema: CREATIVE_DIRECTION_DECISION_SCHEMA,
    productionId: id,
    decidedAt: new Date(now).toISOString(),
    actor: requiredText(actor, "actor"),
    proposalHash: proposal.proposalHash,
    envelope: proposal.envelope,
    fingerprint: proposal.fingerprint,
    variation: proposal.variation,
    planSeed: proposal.planSeed,
    authority: { humanConfirmed: true, providerCalls: 0, generationTriggered: false, promotesKnowledge: false },
  };
  const decision = { ...body, decisionHash: operationFingerprint(body) };
  const file = path.join(target, "creative-direction.json");
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (existing.decisionHash !== decision.decisionHash) throw new Error("Produção já possui outra decisão criativa materializada.");
    return { file, decision: existing, reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeJsonAtomic(file, decision, { label: "Decisão criativa" });
  return { file, decision, reused: false };
}
