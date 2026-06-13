-- Vault-wide note and folder icon assignments. Pack availability is not
-- enforced here so assignments survive a temporarily disabled icon plugin.

CREATE TABLE icon_assignments (
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'folder')),
  path       TEXT NOT NULL,
  pack_id    TEXT NOT NULL,
  icon_id    TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, path)
);
