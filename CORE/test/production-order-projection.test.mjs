import assert from "node:assert/strict";
import test from "node:test";
import { createBatchJob } from "../lib/media-pipeline/omni-batch-runner.mjs";
import { projectBatchAudit } from "../lib/media-pipeline/production-order-projection.mjs";

test("auditoria projeta ordem, tentativas e recovery sem prompt", () => {
  const job = createBatchJob({
    collection: "campanha",
    items: [{ prompt: "conteúdo privado", templateBinding: { templateId: "t", templateRevision: 1, templateHash: "a".repeat(64) } }],
    parallel: 1,
    id: "batch:audit",
  });
  job.items[0].state = "ambiguous";
  job.items[0].attemptId = "attempt:a";
  job.items[0].attemptNumber = 1;
  job.items[0].effectBoundaryReached = null;
  const audit = projectBatchAudit(job);
  assert.equal(audit.order.maximumProviderCalls, 1);
  assert.equal(audit.attempts[0].state, "ambiguous");
  assert.equal(audit.recovery[0].providerPostAllowed, false);
  assert.deepEqual(audit.recovery[0].actions, ["investigate", "reconcile"]);
  assert.equal(audit.promptContentIncluded, false);
  assert.doesNotMatch(JSON.stringify(audit), /conteúdo privado/);
});
