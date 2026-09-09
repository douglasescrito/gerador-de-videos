import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCreativeDirectionProposal, materializeCreativeDirection, editorialCoverage } from "../lib/media-pipeline/creative-direction.mjs";

function context(recent = [], preferences = { videoLikes: [] }) {
  return {
    schema: "mkt-videos/director-context@1",
    rootScopeId: "client:focus",
    projectScopeId: "project:focus:marketing-continuo",
    activeRelease: { id: "release:focus:v1", hash: "a".repeat(64), activationId: "activation:1", activationHash: "b".repeat(64) },
    profileFingerprint: "c".repeat(64),
    contextFingerprint: "d".repeat(64),
    profile: {
      clientId: "focus", projectId: "marketing-continuo",
      brand: { positioning: "Educação clara", requiredClosing: "Escola Aurora", forbiddenTerms: ["garantia"] },
      creative: { primaryStyle: "flat-2d@1" },
    },
    recentCreativeFingerprints: recent,
    preferenceEvidence: { ...preferences, authority: "suggestion-only", automaticPromotion: false, excludedFromPlanningFingerprint: true },
  };
}

const decision = {
  decisionId: "human:campaign-1",
  marketingObjective: "marca",
  audience: "adultos que trabalham",
  promise: "clareza para avançar",
  callToAction: "comece agora",
  axisOptions: {
    thesis: ["o futuro cabe na rotina"],
    arc: ["pergunta-resposta", "progressão"],
    keyVisual: ["módulos que se encaixam"],
    aestheticTerritory: ["flat editorial"],
    motionMechanism: ["reflow modular"],
    composition: ["grade assimétrica"],
    soundResolution: ["corte limpo"],
  },
};

test("editorial preserva cadeia causal sem promessa ou CTA e distingue legado", () => {
  const editorialChain = { theme: "atenção", question: "quando o alerta deixa de avisar?", thesis: "repetição esvazia o aviso", conflict: "urgência versus hábito", observableSituation: "o alerta toca outra vez", turn: "ninguém olha", ending: "o perigo real passa despercebido", visualMechanism: "pulso perde contraste", evidenceRefs: ["brief:approved"] };
  const editorial = { decisionId: "editorial:1", intent: "editorial", audience: "adultos", editorialChain, axisOptions: decision.axisOptions };
  const proposal = createCreativeDirectionProposal({ context: context(), decision: editorial });
  assert.deepEqual(proposal.envelope.editorialChain, editorialChain);
  assert.equal(proposal.envelope.selectedAxes.thesis, editorialChain.thesis);
  assert.equal(Object.hasOwn(proposal.envelope.preserved, "callToAction"), false);
  assert.equal(proposal.authority.humanDecisionRequired, true);
  assert.deepEqual(editorialCoverage([proposal, { title: "atenção" }]), { classified: 1, unclassified: 1, arguments: [{ theme: editorialChain.theme, thesis: editorialChain.thesis, conflict: editorialChain.conflict, count: 1 }], authority: "none", automaticPromotion: false });
  assert.throws(() => createCreativeDirectionProposal({ context: context(), decision: { ...editorial, editorialChain: { ...editorialChain, turn: "" } } }), /turn/);
});

test("direção é determinística, explica a variação e não repete combinação na release", () => {
  const first = createCreativeDirectionProposal({ context: context(), decision });
  const repeated = createCreativeDirectionProposal({ context: context(), decision });
  assert.deepEqual(first, repeated);
  assert.equal(first.authority.preferenceEvidenceUsedForSelection, false);
  assert.match(first.variation.reason, /Primeira combinação/);
  const next = createCreativeDirectionProposal({ context: context([{ productionId: "previous", fingerprint: first.fingerprint }]), decision });
  assert.notEqual(next.fingerprint.combinationHash, first.fingerprint.combinationHash);
  assert.deepEqual(next.variation.changedAxes, ["arc"]);
  assert.equal(next.variation.comparedWith, "previous");
});

test("like não altera plano sem promoção humana", () => {
  const noLikes = createCreativeDirectionProposal({ context: context([], { videoLikes: [] }), decision });
  const manyLikes = createCreativeDirectionProposal({ context: context([], { videoLikes: [{ relPath: "liked.mp4" }] }), decision });
  assert.equal(noLikes.planSeed, manyLikes.planSeed);
  assert.equal(noLikes.fingerprint.fingerprintHash, manyLikes.fingerprint.fingerprintHash);
});

test("decisão criativa materializa uma vez, hash-bound e sem gerar mídia", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "creative-direction-"));
  try {
    const proposal = createCreativeDirectionProposal({ context: context(), decision });
    await assert.rejects(materializeCreativeDirection({ proposal, expectedProposalHash: proposal.proposalHash, productionDir: root, productionId: "p1" }), /confirmação humana/);
    const materialized = await materializeCreativeDirection({ proposal, expectedProposalHash: proposal.proposalHash, confirmHuman: true, productionDir: root, productionId: "p1", now: new Date("2026-08-13T12:00:00Z") });
    assert.equal(materialized.decision.authority.providerCalls, 0);
    assert.equal(materialized.decision.authority.generationTriggered, false);
    assert.equal(JSON.parse(await readFile(materialized.file, "utf8")).fingerprint.schema, "mkt-videos/creative-fingerprint@1");
    assert.equal((await materializeCreativeDirection({ proposal, expectedProposalHash: proposal.proposalHash, confirmHuman: true, productionDir: root, productionId: "p1", now: new Date("2026-08-13T12:00:00Z") })).reused, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
