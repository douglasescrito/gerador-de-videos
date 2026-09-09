CREATE TABLE knowledge_scopes (
  root_scope_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  parent_scope_id TEXT,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'global',
      'domain',
      'client',
      'brand',
      'person',
      'project',
      'production',
      'deliverable',
      'campaign'
    )
  ),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (root_scope_id, scope_id),
  FOREIGN KEY (root_scope_id, parent_scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id),
  CHECK (
    (
      scope_id = root_scope_id
      AND parent_scope_id IS NULL
    )
    OR (
      scope_id <> root_scope_id
      AND parent_scope_id IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE knowledge_items (
  root_scope_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  scope_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'entity',
      'relation',
      'assertion',
      'evidence',
      'rights',
      'decision'
    )
  ),
  schema_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  status TEXT NOT NULL CHECK (
    status IN (
      'active',
      'candidate',
      'superseded',
      'revoked',
      'quarantined'
    )
  ),
  classification TEXT NOT NULL CHECK (
    classification IN (
      'public',
      'internal',
      'confidential',
      'restricted'
    )
  ),
  owner_type TEXT NOT NULL CHECK (
    owner_type IN (
      'global',
      'domain',
      'organization',
      'client',
      'brand',
      'person',
      'project',
      'production',
      'deliverable',
      'campaign',
      'system'
    )
  ),
  owner_id TEXT NOT NULL,
  modality TEXT NOT NULL CHECK (
    modality IN (
      'fact',
      'capability',
      'hard-constraint',
      'preference',
      'heuristic',
      'observation',
      'hypothesis',
      'anti-pattern'
    )
  ),
  governance_json TEXT NOT NULL CHECK (json_valid(governance_json)),
  governance_hash TEXT NOT NULL CHECK (
    length(governance_hash) = 64
    AND governance_hash NOT GLOB '*[^0-9a-f]*'
  ),
  supersedes_revision INTEGER,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (root_scope_id, item_id, revision),
  FOREIGN KEY (root_scope_id, scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id),
  FOREIGN KEY (root_scope_id, item_id, supersedes_revision)
    REFERENCES knowledge_items(root_scope_id, item_id, revision),
  CHECK (
    (revision = 1 AND supersedes_revision IS NULL)
    OR
    (revision > 1 AND supersedes_revision = revision - 1)
  )
) STRICT;

CREATE INDEX knowledge_items_scope_idx
  ON knowledge_items(root_scope_id, scope_id, item_id, revision);

CREATE INDEX knowledge_items_type_idx
  ON knowledge_items(root_scope_id, record_type, item_id, revision);

CREATE TABLE knowledge_releases (
  root_scope_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  previous_release_id TEXT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 240),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  release_hash TEXT NOT NULL CHECK (
    length(release_hash) = 64
    AND release_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (root_scope_id, release_id),
  FOREIGN KEY (root_scope_id, root_scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id),
  FOREIGN KEY (root_scope_id, previous_release_id)
    REFERENCES knowledge_releases(root_scope_id, release_id)
) STRICT;

CREATE TABLE knowledge_release_members (
  root_scope_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  record_type TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (root_scope_id, release_id, item_id),
  UNIQUE (root_scope_id, release_id, ordinal),
  FOREIGN KEY (root_scope_id, release_id)
    REFERENCES knowledge_releases(root_scope_id, release_id),
  FOREIGN KEY (root_scope_id, item_id, revision)
    REFERENCES knowledge_items(root_scope_id, item_id, revision)
) STRICT;

CREATE TABLE knowledge_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  root_scope_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_revision INTEGER,
  at TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_hash TEXT NOT NULL CHECK (
    length(grant_hash) = 64
    AND grant_hash NOT GLOB '*[^0-9a-f]*'
  ),
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (
    length(policy_hash) = 64
    AND policy_hash NOT GLOB '*[^0-9a-f]*'
  ),
  actor TEXT NOT NULL,
  grant_permission TEXT NOT NULL CHECK (
    grant_permission IN ('write', 'release')
  ),
  grant_issued_at TEXT NOT NULL,
  grant_expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64
    AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE CHECK (
    length(event_hash) = 64
    AND event_hash NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (root_scope_id, scope_id)
    REFERENCES knowledge_scopes(root_scope_id, scope_id)
) STRICT;

CREATE INDEX knowledge_events_root_sequence_idx
  ON knowledge_events(root_scope_id, sequence);

CREATE TRIGGER knowledge_scopes_no_update
BEFORE UPDATE ON knowledge_scopes
BEGIN
  SELECT RAISE(ABORT, 'knowledge_scopes is append-only');
END;

CREATE TRIGGER knowledge_scopes_no_delete
BEFORE DELETE ON knowledge_scopes
BEGIN
  SELECT RAISE(ABORT, 'knowledge_scopes is append-only');
END;

CREATE TRIGGER knowledge_items_no_update
BEFORE UPDATE ON knowledge_items
BEGIN
  SELECT RAISE(ABORT, 'knowledge_items is append-only');
END;

CREATE TRIGGER knowledge_items_no_delete
BEFORE DELETE ON knowledge_items
BEGIN
  SELECT RAISE(ABORT, 'knowledge_items is append-only');
END;

CREATE TRIGGER knowledge_releases_no_update
BEFORE UPDATE ON knowledge_releases
BEGIN
  SELECT RAISE(ABORT, 'knowledge_releases is append-only');
END;

CREATE TRIGGER knowledge_releases_no_delete
BEFORE DELETE ON knowledge_releases
BEGIN
  SELECT RAISE(ABORT, 'knowledge_releases is append-only');
END;

CREATE TRIGGER knowledge_release_members_no_update
BEFORE UPDATE ON knowledge_release_members
BEGIN
  SELECT RAISE(ABORT, 'knowledge_release_members is append-only');
END;

CREATE TRIGGER knowledge_release_members_no_delete
BEFORE DELETE ON knowledge_release_members
BEGIN
  SELECT RAISE(ABORT, 'knowledge_release_members is append-only');
END;

CREATE TRIGGER knowledge_events_no_update
BEFORE UPDATE ON knowledge_events
BEGIN
  SELECT RAISE(ABORT, 'knowledge_events is append-only');
END;

CREATE TRIGGER knowledge_events_no_delete
BEFORE DELETE ON knowledge_events
BEGIN
  SELECT RAISE(ABORT, 'knowledge_events is append-only');
END;

CREATE TRIGGER knowledge_migrations_no_update
BEFORE UPDATE ON knowledge_migrations
BEGIN
  SELECT RAISE(ABORT, 'knowledge_migrations is append-only');
END;

CREATE TRIGGER knowledge_migrations_no_delete
BEFORE DELETE ON knowledge_migrations
BEGIN
  SELECT RAISE(ABORT, 'knowledge_migrations is append-only');
END;
