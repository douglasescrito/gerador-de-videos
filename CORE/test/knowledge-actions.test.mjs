import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_ACTION_VALUES,
  KNOWLEDGE_CONFIRM_HUMAN_ACTION_VALUES,
  KNOWLEDGE_INPUT_ACTION_VALUES,
  isKnowledgeAction,
} from "../lib/knowledge-actions.mjs";

test("registry leve de ações knowledge é único, fechado e coerente", () => {
  assert.equal(new Set(KNOWLEDGE_ACTION_VALUES).size, KNOWLEDGE_ACTION_VALUES.length);
  for (const action of KNOWLEDGE_CONFIRM_HUMAN_ACTION_VALUES) {
    assert.equal(isKnowledgeAction(action), true);
  }
  for (const action of KNOWLEDGE_INPUT_ACTION_VALUES) {
    assert.equal(isKnowledgeAction(action), true);
  }
  assert.equal(isKnowledgeAction("create-feedback-interpretation-candidate"), true);
  assert.equal(isKnowledgeAction("unknown-action"), false);
});
