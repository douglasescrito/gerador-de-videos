import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_POLICY_HASH,
  KNOWLEDGE_POLICY_ID,
  assertKnowledgePolicyDocuments,
  knowledgePolicyRegistry,
  knownKnowledgePolicy,
} from "../lib/media-pipeline/knowledge-policy-registry.mjs";

test("registry fixa a política versionada e valida seu documento imutável", () => {
  assert.deepEqual(assertKnowledgePolicyDocuments(), [
    {
      policyId: KNOWLEDGE_POLICY_ID,
      policyHash: KNOWLEDGE_POLICY_HASH,
    },
  ]);
  assert.deepEqual(knowledgePolicyRegistry(), [
    {
      policyId: KNOWLEDGE_POLICY_ID,
      policyHash: KNOWLEDGE_POLICY_HASH,
    },
  ]);
  assert.equal(
    knownKnowledgePolicy(KNOWLEDGE_POLICY_ID, KNOWLEDGE_POLICY_HASH),
    true,
  );
  assert.equal(
    knownKnowledgePolicy(KNOWLEDGE_POLICY_ID, "0".repeat(64)),
    false,
  );
  assert.equal(
    knownKnowledgePolicy("knowledge-governance-policy@2", KNOWLEDGE_POLICY_HASH),
    false,
  );
});
