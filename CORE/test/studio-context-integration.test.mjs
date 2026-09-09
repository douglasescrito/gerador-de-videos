import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compileFilmSpec } from "../lib/media-pipeline/film-compiler.mjs";
import { knowledgeContextHash } from "../lib/media-pipeline/knowledge-retrieval.mjs";
import {
  assertKnowledgeContextBinding,
  assertStudioDecisionArtifactsForContext,
  createStudioBrief,
  studioReceiptContextMetadata,
} from "../lib/media-pipeline/studio-context.mjs";
import { createStudioDecisionArtifacts } from "../lib/media-pipeline/studio-decision-artifacts.mjs";
import { recipeFromReceipt } from "../lib/media-pipeline/recipe.mjs";
import { createStageReceipt } from "../lib/media-pipeline/pipeline-operation.mjs";

const execFileAsync = promisify(execFile);

function context() {
  const body = {
    schema: "mkt-videos/knowledge-context@1",
    rootScopeId: "root-client-a",
    releaseId: "release-a",
    releaseHash: "a".repeat(64),
    requestHash: "b".repeat(64),
    scope: { rootScopeId: "root-client-a", scopeIds: ["root-client-a"] },
    appliedItems: [],
    excludedItems: [],
    conflicts: [],
    overrides: [],
    retrievalTraceId: `rt_${"c".repeat(32)}`,
    rankerVersion: "lexical-ranker@1",
    rationale: "Contexto gold provider-free.",
    authority: "none",
    plannerInfluence: "none",
    contextId: `kc_${"d".repeat(32)}`,
  };
  return { ...body, hash: knowledgeContextHash(body) };
}

function brief() {
  return createStudioBrief({
    briefId: "brief-a",
    userBrief: "Um filme curto sobre luz e matéria.",
    objective: "Explicar a transformação de luz em matéria.",
    audience: "público geral",
    genre: "documentário",
    channel: "social",
    format: "16:9",
    preferences: ["ritmo contemplativo"],
  });
}

function spec() {
  const knowledgeContext = context();
  const studioBrief = brief();
  return {
    schema: "mkt-videos/film-spec@2",
    name: "context-integration",
    source: { request: "pedido original", directionPreset: null, effectiveDirection: null },
    brief: studioBrief,
    knowledgeContext,
    narration: { mode: "none", text: null, blocks: [] },
    music: { mode: "none", intent: null, fit: "none", tailSeconds: 0 },
    timeline: { fps: { numerator: 24, denominator: 1 }, holdInFrames: 0, holdOutFrames: 0, transition: "cut", transitionFrames: 0 },
    scenes: [{ id: "scene-1", role: "spectacle", objective: "luz", visualPrompt: "Uma luz suave atravessa um prisma.", motionPrompt: "Movimento lento e estável.", references: [], referenceAuthorizations: [], runtimeInputRoles: [], restrictions: [], image: { model: "gemini-3-pro-image", size: "2K" }, durationHint: 4 }],
    formats: { master: "16:9", variants: [] },
    brandKit: null,
    captions: { mode: "none" },
    qa: { enabled: false },
    reuse: { policy: "off" },
    execution: { concurrency: { draft: 1, video: 1, localCpu: 1 }, budget: {}, providers: {} },
  };
}

test("film-spec e execution-plan congelam brief/contexto e alteram o fingerprint", () => {
  const first = compileFilmSpec(spec());
  const second = compileFilmSpec(spec());
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.brief.hash, first.spec.brief.hash);
  assert.equal(first.knowledgeContextBinding.contextHash, first.spec.knowledgeContext.hash);
  assert.equal(first.knowledgeContextBinding.briefHash, first.spec.brief.hash);
  assertKnowledgeContextBinding(first.knowledgeContextBinding, { context: first.spec.knowledgeContext, briefHash: first.spec.brief.hash });
  const changed = spec();
  changed.knowledgeContext.rationale = "Outra decisão editorial.";
  assert.throws(() => compileFilmSpec(changed), /hash diverge/);
});

test("recibo e recipe carregam apenas o binding hash-bound, sem payload privado", () => {
  const value = spec();
  const metadata = studioReceiptContextMetadata({ brief: value.brief, knowledgeContext: value.knowledgeContext });
  const receipt = createStageReceipt({ operation: "provider-free-stage", provider: "ffmpeg", stage: "local", metadata });
  assert.equal(receipt.metadata.knowledgeContextHash, value.knowledgeContext.hash);
  assert.equal(receipt.metadata.knowledgeContext.contextHash, value.knowledgeContext.hash);
  assert.equal(Object.hasOwn(receipt.metadata.knowledgeContext, "appliedItems"), false);
  const recipe = recipeFromReceipt(receipt);
  assert.equal(recipe.briefHash, value.brief.hash);
  assert.equal(recipe.knowledgeContextHash, value.knowledgeContext.hash);
});

test("decision artifacts humanos entram no plano por hash e exigem o contexto exato", () => {
  const value = spec();
  value.decisionArtifacts = createStudioDecisionArtifacts({
    rootScopeId: value.knowledgeContext.rootScopeId,
    contextHash: value.knowledgeContext.hash,
    resolverRequestFingerprint: "a".repeat(64),
    resolutionFingerprint: "b".repeat(64),
    decisions: [{
      itemId: "decision:palette",
      revision: 1,
      contentHash: "c".repeat(64),
      selectedOptionId: "warm",
      approvedBy: "human-editor",
      decidedAt: "2026-07-27T12:00:00.000Z",
    }],
  });
  assertStudioDecisionArtifactsForContext(value.decisionArtifacts, { contextHash: value.knowledgeContext.hash });
  const plan = compileFilmSpec(value);
  assert.equal(plan.spec.decisionArtifacts.fingerprint, value.decisionArtifacts.fingerprint);
  assert.equal(plan.decisionArtifacts.fingerprint, value.decisionArtifacts.fingerprint);
  const changed = spec();
  changed.decisionArtifacts = value.decisionArtifacts;
  changed.knowledgeContext = context();
  changed.knowledgeContext.rationale = "contexto adulterado";
  assert.throws(() => compileFilmSpec(changed), /hash diverge/);
});

test("CLI aceita retrieval-shadow materializado sem consultar o Knowledge Store durante compile", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "studio-context-cli-"));
  try {
    const source = spec();
    delete source.knowledgeContext;
    delete source.knowledgeContextBinding;
    const specFile = path.join(temporary, "film-spec.json");
    const contextFile = path.join(temporary, "retrieval-result.json");
    await writeFile(specFile, JSON.stringify(source), "utf8");
    await writeFile(contextFile, JSON.stringify({ schema: "mkt-videos/knowledge-retrieval-action-result@1", context: context() }), "utf8");
    const { stdout } = await execFileAsync(process.execPath, ["scripts/omni-cli.mjs", "compile", "--spec", specFile, "--knowledge-context", contextFile, "--eta-root", path.join(temporary, "receipts")], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const plan = JSON.parse(stdout);
    assert.equal(plan.governance.eta.root, path.join(temporary, "receipts"));
    assert.equal(plan.governance.eta.scannedReceipts, 0);
    assert.equal(plan.schema, "mkt-videos/execution-plan@1");
    assert.equal(plan.spec.knowledgeContext.hash, context().hash);
    assert.equal(plan.knowledgeContextBinding.contextHash, context().hash);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
