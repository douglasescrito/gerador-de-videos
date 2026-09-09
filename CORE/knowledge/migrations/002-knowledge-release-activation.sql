CREATE TABLE knowledge_release_activations (
  root_scope_id TEXT NOT NULL,
  activation_sequence INTEGER NOT NULL CHECK (activation_sequence >= 1),
  activation_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  previous_activation_id TEXT,
  previous_active_release_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('activate', 'rollback')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  eligibility_hash TEXT NOT NULL CHECK (
    length(eligibility_hash) = 64
    AND eligibility_hash NOT GLOB '*[^0-9a-f]*'
  ),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  activation_hash TEXT NOT NULL CHECK (
    length(activation_hash) = 64
    AND activation_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (root_scope_id, activation_id),
  UNIQUE (root_scope_id, activation_sequence),
  FOREIGN KEY (root_scope_id, root_scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id),
  FOREIGN KEY (root_scope_id, release_id)
    REFERENCES knowledge_releases(root_scope_id, release_id),
  FOREIGN KEY (root_scope_id, previous_activation_id)
    REFERENCES knowledge_release_activations(root_scope_id, activation_id),
  FOREIGN KEY (root_scope_id, previous_active_release_id)
    REFERENCES knowledge_releases(root_scope_id, release_id),
  CHECK (
    (
      activation_sequence = 1
      AND previous_activation_id IS NULL
      AND previous_active_release_id IS NULL
      AND mode = 'activate'
    )
    OR
    (
      activation_sequence > 1
      AND previous_activation_id IS NOT NULL
      AND previous_active_release_id IS NOT NULL
    )
  )
) STRICT;

CREATE INDEX knowledge_release_activations_root_sequence_idx
  ON knowledge_release_activations(root_scope_id, activation_sequence);

CREATE TRIGGER knowledge_release_activations_no_update
BEFORE UPDATE ON knowledge_release_activations
BEGIN
  SELECT RAISE(ABORT, 'knowledge_release_activations is append-only');
END;

CREATE TRIGGER knowledge_release_activations_no_delete
BEFORE DELETE ON knowledge_release_activations
BEGIN
  SELECT RAISE(ABORT, 'knowledge_release_activations is append-only');
END;
