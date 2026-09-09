export const KNOWLEDGE_ACTION_VALUES = Object.freeze([
  "status",
  "packs",
  "init",
  "integrity",
  "export",
  "backup",
  "restore",
  "active-release",
  "activate-release",
  "rollback-release",
  "review-item",
  "provision-scopes",
  "register-asset-link",
  "import-candidate",
  "replay-release",
  "capture-feedback",
  "list-feedback",
  "replay-feedback",
  "create-feedback-interpretation-candidate",
  "list-feedback-interpretation-candidates",
  "replay-feedback-interpretation-candidates",
  "list-feedback-promotion-queue",
  "review-feedback-interpretation",
  "canonicalize-feedback-interpretation",
  "retrieval-shadow",
  "decision-shadow",
]);

export const KNOWLEDGE_CONFIRM_HUMAN_ACTION_VALUES = Object.freeze([
  "activate-release",
  "rollback-release",
  "review-item",
  "provision-scopes",
  "register-asset-link",
  "capture-feedback",
  "create-feedback-interpretation-candidate",
  "review-feedback-interpretation",
  "canonicalize-feedback-interpretation",
]);

export const KNOWLEDGE_INPUT_ACTION_VALUES = Object.freeze([
  "register-asset-link",
  "import-candidate",
  "capture-feedback",
  "create-feedback-interpretation-candidate",
  "review-feedback-interpretation",
  "canonicalize-feedback-interpretation",
  "retrieval-shadow",
  "decision-shadow",
]);

const KNOWLEDGE_ACTION_SET = new Set(KNOWLEDGE_ACTION_VALUES);

export function isKnowledgeAction(value) {
  return KNOWLEDGE_ACTION_SET.has(value);
}
