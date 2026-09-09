CREATE TABLE knowledge_review_decisions (
  root_scope_id TEXT NOT NULL,
  decision_sequence INTEGER NOT NULL CHECK (decision_sequence >= 1),
  decision_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  result_revision INTEGER NOT NULL CHECK (
    result_revision = source_revision + 1
  ),
  action TEXT NOT NULL CHECK (action IN ('promote', 'quarantine')),
  source_status TEXT NOT NULL,
  result_status TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (
    length(source_content_hash) = 64
    AND source_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result_content_hash TEXT NOT NULL CHECK (
    length(result_content_hash) = 64
    AND result_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (
    length(policy_hash) = 64
    AND policy_hash NOT GLOB '*[^0-9a-f]*'
  ),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  decision_hash TEXT NOT NULL CHECK (
    length(decision_hash) = 64
    AND decision_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reviewed_at TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  PRIMARY KEY (root_scope_id, decision_id),
  UNIQUE (root_scope_id, decision_sequence),
  UNIQUE (root_scope_id, item_id, source_revision),
  UNIQUE (root_scope_id, item_id, result_revision),
  FOREIGN KEY (root_scope_id, scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id),
  FOREIGN KEY (root_scope_id, item_id, source_revision)
    REFERENCES knowledge_items(root_scope_id, item_id, revision),
  FOREIGN KEY (root_scope_id, item_id, result_revision)
    REFERENCES knowledge_items(root_scope_id, item_id, revision),
  CHECK (
    (
      action = 'promote'
      AND source_status = 'candidate'
      AND result_status = 'active'
    )
    OR
    (
      action = 'quarantine'
      AND source_status IN ('candidate', 'active')
      AND result_status = 'quarantined'
    )
  )
) STRICT;

CREATE INDEX knowledge_review_decisions_root_sequence_idx
  ON knowledge_review_decisions(root_scope_id, decision_sequence);

CREATE TRIGGER knowledge_review_decisions_no_update
BEFORE UPDATE ON knowledge_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'knowledge_review_decisions is append-only');
END;

CREATE TRIGGER knowledge_review_decisions_no_delete
BEFORE DELETE ON knowledge_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'knowledge_review_decisions is append-only');
END;
