CREATE TABLE notes (
    id          TEXT PRIMARY KEY,           -- UUID, client-generated
    title       TEXT NOT NULL DEFAULT 'Untitled',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Append-only Yjs update log per note. Compact periodically by
-- replacing all rows with a single encoded snapshot.
CREATE TABLE note_updates (
    seq      INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id  TEXT NOT NULL REFERENCES notes(id),
    data     BLOB NOT NULL,
    ts       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_updates_note ON note_updates(note_id, seq);
