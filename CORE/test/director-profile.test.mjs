import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDirectorProduction, discoverDirectorProjects, readDirectorContext, registerDirectorProfile, validateDirectorProduction } from "../lib/media-pipeline/director-profile.mjs";
import { createCreativeDirectionProposal, materializeCreativeDirection } from "../lib/media-pipeline/creative-direction.mjs";

const profile = {
  schema: "mkt-videos/client-director-profile@1", clientId: "aurora", clientName: "Escola Aurora", projectId: "continuo", projectName: "Marketing contínuo", directorName: "Diretor Aurora", status: "active", cadenceMinutes: 30, outputCollection: "aurora-autonomos-30min",
  brand: { positioning: "educação moderna", palette: ["navy", "white"], logoPolicy: "somente assinatura", forbiddenTerms: ["focar"], requiredClosing: "Escola Aurora" },
  creative: { primaryStyle: "flat-2d@1", allowedStyles: ["flat-2d@1"], advertisingArchetypes: ["manifesto", "problema-beneficio"], narrationModes: ["entrecortada", "continua"], transitionTechniques: ["shape-continuity-transition@1"], motionTechniqueIds: ["semantic-hero-type@1"], motionCombinationIds: ["high-impact-manifesto@1"], motionBankSha256: "a".repeat(64), visualPrinciples: ["limpo"], avoid: ["3D"], sceneCount: 2, sceneDurationSeconds: 10 },
  audio: { narrationProvider: "google-vids", preferredVoice: "Nyla", whisperModel: "small", textAuthority: "approved-script-only", timestampAuthority: "whisper-measured-only", allowIntercutNarration: true, musicProvider: "flow-music", fadeOutSeconds: 0 },
  feedback: { videoLikes: "evidence", recipeLikes: "evidence", automaticPromotion: false, influence: "suggestion-only" }, governance: { humanApprovalRequired: true, rawModeInfluence: "none", providerCallsDuringPlanning: 0 },
};

test("perfil diretor vive no Knowledge Core, congela contexto e valida receita", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "director-profile-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, "CORE"); const dbFile = path.join(root, "knowledge.sqlite"); const outputsRoot = path.join(coreRoot, "outputs");
  await mkdir(outputsRoot, { recursive: true });
  const registration = registerDirectorProfile({ profile, dbFile, coreRoot, actor: "human", now: new Date("2026-08-12T12:00:00Z") });
  assert.equal(registration.providerCalls, 0);
  const revision = registerDirectorProfile({ profile, dbFile, coreRoot, actor: "human", now: new Date("2026-08-12T12:01:00Z") });
  assert.equal(revision.item.revision, 2);
  const directorContext = await readDirectorContext({ clientId: "aurora", projectId: "continuo", dbFile, coreRoot, outputsRoot });
  assert.equal(directorContext.profile.creative.primaryStyle, "flat-2d@1");
  assert.deepEqual(discoverDirectorProjects({ dbFile, coreRoot, rootScopeId: "client:aurora" }), [{ clientId: "aurora", projectId: "continuo" }]);
  const brief = { schema: "mkt-videos/director-brief@1", clientId: "aurora", projectId: "continuo", profileFingerprint: directorContext.profileFingerprint, marketingObjective: "marca", audience: "adultos", promise: "clareza", hook: "uma pergunta", callToAction: "estude", advertisingArchetype: "manifesto", narrationMode: "entrecortada", motionTechniqueIds: ["semantic-hero-type@1"], transitionTechniques: ["shape-continuity-transition@1"], novelty: { thesis: "t", arc: "a", keyVisual: "k", aestheticTerritory: "e", motionMechanism: "m", composition: "c", soundResolution: "s" } };
  const recipe = { schema: "gerador-de-videos/receita@1", id: "teste", label: "Teste", kind: "filme", aspect: "16:9", style: "flat-2d@1", collection: "teste", targetDurationSeconds: 20, scenes: [
    { id: "s1", duration: 10, prompt: "flat 2D", generationTask: "text_to_video", narrationBlockId: "b1", onScreenText: "CLAREZA" },
    { id: "s2", duration: 10, prompt: "logo", generationTask: "reference_to_video", narrationBlockId: "b2", references: [{ source: "assets", relPath: "logo.png", role: "reference-image" }] },
  ], audio: { narration: { provider: "google-vids", documentUrl: "https://docs.google.com/videos/d/test/edit", voice: "Nyla", text: "Uma ideia. Escola Aurora.", blocks: [{ id: "b1", text: "Uma ideia." }, { id: "b2", text: "Escola Aurora." }] }, music: true, musicPreset: "institucional", musicDurationSeconds: 20, musicFadeOutSeconds: 0 }, workflow: { narrationTextAuthority: "approved-script-only", narrationTimestampAuthority: "whisper-measured-only", authorizationMode: "production-once", completionMode: "complete", automaticRetry: true, retryPolicy: "bounded-reconciled@1", maxAttempts: 2, automaticCorrections: true, humanReview: false } };
  assert.equal(validateDirectorProduction({ context: directorContext, brief, recipe }).valid, true);
  const proposal = createCreativeDirectionProposal({
    context: directorContext,
    decision: {
      decisionId: "human:test",
      marketingObjective: brief.marketingObjective,
      audience: brief.audience,
      promise: brief.promise,
      callToAction: brief.callToAction,
      axisOptions: Object.fromEntries(Object.entries(brief.novelty).map(([axis, value]) => [axis, [value]])),
    },
  });
  const { decision } = await materializeCreativeDirection({ proposal, expectedProposalHash: proposal.proposalHash, confirmHuman: true, productionDir: path.join(root, "production"), productionId: "p1", now: new Date("2026-08-12T12:02:00Z") });
  const directed = compileDirectorProduction({ context: directorContext, brief, recipe, creativeDirection: decision });
  const replay = compileDirectorProduction({ context: { ...directorContext, preferenceEvidence: { videoLikes: [{ relPath: "liked.mp4" }], excludedFromPlanningFingerprint: true } }, brief, recipe, creativeDirection: decision });
  assert.equal(directed.executionPlan.spec.creativeDirection.decisionHash, decision.decisionHash);
  assert.equal(directed.executionPlan.fingerprint, replay.executionPlan.fingerprint);
  assert.match(directed.variation.reason, /Primeira combinação/);
});
