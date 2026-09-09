import assert from "node:assert/strict";
import test from "node:test";
import { classifyRetryReconcile } from "../lib/media-pipeline/retry-reconcile-policy.mjs";

const now = new Date("2026-08-13T12:00:00.000Z");

test("classificador único nunca submete estado ambíguo, persistência local ou falha estética", () => {
  assert.equal(classifyRetryReconcile({ state: "ambiguous", now }).action, "reconcile");
  assert.equal(classifyRetryReconcile({ state: "local_persist_failed", now }).action, "recover-artifact");
  assert.equal(classifyRetryReconcile({ state: "aesthetic_failure", now }).action, "preserve-original");
  for (const state of ["ambiguous", "local_persist_failed", "aesthetic_failure"]) {
    assert.equal(classifyRetryReconcile({ state, now }).createsNewAttempt, false);
  }
});

test("retry só nasce de ausência de efeito ou rejeição comprovadamente transitória e recebe dueAt determinístico", () => {
  const preEffect = classifyRetryReconcile({ state: "pre_effect_failed", attemptNumber: 1, maxAttempts: 3, seed: "same", now });
  const repeated = classifyRetryReconcile({ state: "pre_effect_failed", attemptNumber: 1, maxAttempts: 3, seed: "same", now });
  assert.equal(preEffect.action, "retry-when-due");
  assert.equal(preEffect.dueAt, repeated.dueAt);
  assert.ok(Date.parse(preEffect.dueAt) > now.getTime());
  assert.equal(classifyRetryReconcile({ state: "provider_rejected", terminalRejectionProved: false, maxAttempts: 3, now }).createsNewAttempt, false);
  assert.equal(classifyRetryReconcile({ state: "provider_rejected", terminalRejectionProved: true, maxAttempts: 3, now }).createsNewAttempt, false);
  assert.equal(classifyRetryReconcile({ state: "provider_rejected", terminalRejectionProved: true, rejectionRetryable: true, maxAttempts: 3, now }).createsNewAttempt, true);
  assert.equal(classifyRetryReconcile({ state: "pre_effect_failed", attemptNumber: 3, maxAttempts: 3, now }).reason, "max_attempts_reached");
});

test("Retry-After passado ou gigante nunca ultrapassa o teto", () => {
  const past = classifyRetryReconcile({ state: "pre_effect_failed", attemptNumber: 1, maxAttempts: 3, retryAfter: "Thu, 13 Aug 2026 11:59:00 GMT", baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0, now });
  assert.equal(Date.parse(past.dueAt), now.getTime() + 1_000);
  const huge = classifyRetryReconcile({ state: "pre_effect_failed", attemptNumber: 1, maxAttempts: 3, retryAfter: "999999999", baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0, now });
  assert.equal(Date.parse(huge.dueAt), now.getTime() + 60_000);
});

test("provider pending exige handle e somente reconcilia", () => {
  assert.throws(() => classifyRetryReconcile({ state: "provider_pending", now }), /exige handle/);
  const decision = classifyRetryReconcile({ state: "provider_pending", providerHandle: "remote:1", now });
  assert.equal(decision.action, "reconcile");
  assert.equal(decision.createsNewAttempt, false);
});
