import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertKnowledgeDecisionResolution,
  buildKnowledgeDecisionResolutionRequest,
  resolveKnowledgeDecision,
} from "../lib/media-pipeline/knowledge-decision-resolver.mjs";
import {
  assertPreferenceRankerShadow,
  buildPreferenceRankerShadow,
} from "../lib/media-pipeline/preference-ranker-shadow.mjs";
import { runKnowledgeAction } from "../lib/media-pipeline/knowledge-service.mjs";
import { assertKnowledgeContract } from "../lib/media-pipeline/knowledge-schema-registry.mjs";

const NOW = "2026-07-27T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function option(id, overrides = {}) {
  return {
    id,
    admissibility: { status: "allowed", reasons: ["rights-current"] },
    preference: {
      authority: "model-suggestion",
      scopeDepth: 0,
      supersedes: false,
      revision: 1,
      evidenceStrength: 0,
      conflictSet: null,
      valueHash: null,
    },
    viability: { status: "available", reasons: ["local-capability"] },
    ...overrides,
  };
}

function request(options) {
  return buildKnowledgeDecisionResolutionRequest({
    rootScopeId: "client-a",
    decisionId: "direction-choice",
    asOf: NOW,
    options,
  });
}

test("resolver aplica admissibilidade, preferência e viabilidade em eixos separados", () => {
  const value = resolveKnowledgeDecision(request([
    option("model", { preference: { ...option("x").preference, authority: "model-suggestion" } }),
    option("client", { preference: { ...option("x").preference, authority: "client-preference", scopeDepth: 1 } }),
    option("blocked-explicit", { admissibility: { status: "blocked", reasons: ["rights-revoked"] }, preference: { ...option("x").preference, authority: "explicit-request" } }),
  ]));
  assert.equal(value.status, "selected");
  assert.equal(value.selectedOptionId, "client");
  assert.equal(value.requiresHumanDecision, false);
  assert.equal(value.changed, false);
  assert.equal(value.providerCalls, 0);
  assertKnowledgeDecisionResolution(value);
});

test("hard block vence sugestão viável e não produz fallback silencioso", () => {
  const value = resolveKnowledgeDecision(request([
    option("only-option", { admissibility: { status: "blocked", reasons: ["consent-missing"] } }),
  ]));
  assert.equal(value.status, "no-admissible-option");
  assert.equal(value.selectedOptionId, null);
  assert.equal(value.requiresHumanDecision, true);
  assert.equal(value.requiresReplan, false);
});

test("inviabilidade da opção preferida bloqueia e exige replan explícito", () => {
  const value = resolveKnowledgeDecision(request([
    option("tts", { preference: { ...option("x").preference, authority: "explicit-request" }, viability: { status: "unavailable", reasons: ["capability-pending"] } }),
    option("local-caption", { preference: { ...option("x").preference, authority: "genre-foundation" } }),
  ]));
  assert.equal(value.status, "blocked-viability");
  assert.equal(value.selectedOptionId, null);
  assert.deepEqual(value.viableAlternativeIds, ["local-caption"]);
  assert.equal(value.requiresReplan, true);
});

test("conflito da mesma autoridade e scope não é resolvido por média", () => {
  const value = resolveKnowledgeDecision(request([
    option("warm", { preference: { ...option("x").preference, authority: "client-preference", scopeDepth: 2, conflictSet: "palette", valueHash: HASH_A } }),
    option("cool", { preference: { ...option("x").preference, authority: "client-preference", scopeDepth: 2, conflictSet: "palette", valueHash: HASH_B } }),
  ]));
  assert.equal(value.status, "unresolved-conflict");
  assert.equal(value.selectedOptionId, null);
  assert.equal(value.requiresHumanDecision, true);
});

test("request e resolução adulterados falham fechado", () => {
  const value = resolveKnowledgeDecision(request([option("safe")]));
  assert.throws(() => resolveKnowledgeDecision({ ...request([option("safe")]), requestFingerprint: "0".repeat(64) }), /requestFingerprint/);
  assert.throws(() => assertKnowledgeDecisionResolution({ ...value, providerCalls: 1 }), /provider/);
  assert.throws(() => assertKnowledgeDecisionResolution({ ...value, fingerprint: "0".repeat(64) }), /fingerprint/);
});

test("preference ranker shadow reutiliza a resolução sem autoridade ou provider", () => {
  const decisionRequest = request([
    option("model"),
    option("client", {
      preference: {
        ...option("x").preference,
        authority: "client-preference",
        scopeDepth: 1,
      },
    }),
  ]);
  const resolution = resolveKnowledgeDecision(decisionRequest);
  const report = buildPreferenceRankerShadow({
    request: decisionRequest,
    resolution,
  });
  assert.equal(report.rankerVersion, "precedence-ranker@1");
  assert.deepEqual(report.rankedOptionIds, ["client", "model"]);
  assert.equal(report.selectedOptionId, "client");
  assert.equal(report.authority, "none");
  assert.equal(report.plannerInfluence, "none");
  assert.equal(report.changed, false);
  assert.equal(report.providerCalls, 0);
  assertPreferenceRankerShadow(report);
});

test("preference ranker shadow rejeita resolution de request diferente", () => {
  const first = request([option("one")]);
  const second = request([option("two")]);
  const resolution = resolveKnowledgeDecision(first);
  assert.throws(
    () => buildPreferenceRankerShadow({ request: second, resolution }),
    /mesmo fingerprint/,
  );
});

test("knowledge --action decision-shadow usa a família CLI sem abrir SQLite", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "decision-shadow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputFile = path.join(directory, "request.json");
  await writeFile(inputFile, JSON.stringify(request([option("local")])), "utf8");
  const result = await runKnowledgeAction({
    action: "decision-shadow",
    rootScopeId: "client-a",
    inputFile,
    coreRoot: fileURLToPath(new URL("..", import.meta.url)),
  });
  assertKnowledgeContract(result, { schemaId: "mkt-videos/knowledge-decision-shadow-action-result@1" });
  assert.equal(result.readOnly, true);
  assert.equal(result.changed, false);
  assert.equal(result.planInfluence, "none");
  assert.equal(result.resolution.selectedOptionId, "local");
  assert.equal(await readFile(inputFile, "utf8") !== "", true);
});
