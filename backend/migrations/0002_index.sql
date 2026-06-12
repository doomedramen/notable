-- Search & graph index — derived entirely from vault files. Rebuilt on
-- startup; safe to delete.

CREATE TABLE note_text (
  path       TEXT PRIMARY KEY,   -- vault-relative
  body       TEXT NOT NULL,
  indexed_at INTEGER NOT NULL    -- file mtime (unix ms) at index time
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  path UNINDEXED,
  name,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- [[wikilinks]]: target_name is the link as written, target_path the
-- resolved note (NULL = unresolved/new-note link).
CREATE TABLE links (
  source_path TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_path TEXT,
  PRIMARY KEY (source_path, target_name)
);
CREATE INDEX idx_links_target ON links(target_path);

CREATE TABLE tags (
  note_path TEXT NOT NULL,
  tag       TEXT NOT NULL,
  PRIMARY KEY (note_path, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);
