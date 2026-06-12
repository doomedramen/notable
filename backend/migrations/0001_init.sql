-- Notable keeps notes as plain .md files in the vault directory — the
-- database holds ONLY derived or ephemeral data. Deleting it loses
-- settings and offline-merge fidelity, never notes.

-- Generic key/value settings (app settings, enabled plugins
-- "plugins.enabled", per-plugin settings "plugin:<id>").
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CRDT state cache, one row per note. Lets clients' offline Yjs edits
-- merge cleanly across server restarts: the cached doc state shares
-- history with client docs, while the file stays canonical (external
-- file edits are diffed into the doc on load).
CREATE TABLE doc_cache (
  path       TEXT PRIMARY KEY,  -- vault-relative, e.g. "Projects/Plan.md"
  guid       TEXT NOT NULL,     -- doc epoch; clients reset if it changes
  state      BLOB NOT NULL,     -- full Yjs state as update (v1 encoding)
  text_hash  TEXT NOT NULL,     -- sha256 hex of the text `state` encodes
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
