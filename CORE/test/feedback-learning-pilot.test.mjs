import assert from "node:assert/strict";
import test from "node:test";
import { assertFeedbackLearningPilotReport, FEEDBACK_LEARNING_PILOT_SCHEMA, runFeedbackLearningPilot } from "../lib/media-pipeline/feedback-learning-pilot.mjs";

test("Piloto D percorre feedback, promoção, release, retrieval e rollback sem provider", async () => {
  const report = await runFeedbackLearningPilot();
  assertFeedbackLearningPilotReport(report);
  assert.equal(report.schema, FEEDBACK_LEARNING_PILOT_SCHEMA);
  assert.equal(report.providerFree, true);
  assert.equal(report.providerCalls, 0);
  assert.equal(report.changed, false);
  assert.match(report.originalTextHash, /^[a-f0-9]{64}$/u);
  assert.equal(report.originalTextPreserved, true);
  assert.equal(report.promotion.action, "promote");
  assert.equal(report.promotion.humanConfirmed, true);
  assert.ok(report.retrieval.appliedItemIds.length >= 1);
  assert.equal(report.retrieval.plannerInfluence, "none");
  assert.equal(report.nextBrief.contextHash, report.retrieval.contextHash);
  assert.equal(report.rollbackVerified, true);
  assert.equal(report.integrity.ok, true);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/u);
});
