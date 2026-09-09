ALTER TABLE knowledge_events
  ADD COLUMN grant_json TEXT
  CHECK (
    grant_json IS NULL
    OR json_valid(grant_json)
  );

CREATE TRIGGER knowledge_events_require_grant_json
BEFORE INSERT ON knowledge_events
WHEN NEW.grant_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'new knowledge_events require canonical ScopeGrant evidence');
END;
