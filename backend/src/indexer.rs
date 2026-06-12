//! Search & graph index, derived from vault files.
//!
//! One row per note in `note_text` + an FTS5 mirror, plus extracted
//! [[wikilinks]] and #tags. Everything here is disposable — `reindex_all`
//! rebuilds it from the files on startup.

use crate::AppState;
use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

static WIKILINK: Lazy<Regex> =
    // [[target]] / [[target#heading]] / [[target|alias]]
    Lazy::new(|| Regex::new(r"\[\[([^\[\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]").unwrap());
static TAG: Lazy<Regex> =
    // #tag, #nested/tag — must not match "# heading" (space after #)
    Lazy::new(|| Regex::new(r"(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)").unwrap());

pub struct Extracted {
    pub links: Vec<String>,
    pub tags: Vec<String>,
}

/// Pull wikilinks and tags out of a markdown body, skipping fenced code
/// blocks (a ``` line toggles; close fences may carry trailing spaces).
pub fn extract(body: &str) -> Extracted {
    let mut links = Vec::new();
    let mut tags = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for cap in WIKILINK.captures_iter(line) {
            let target = cap[1].trim().to_string();
            if !target.is_empty() && !links.contains(&target) {
                links.push(target);
            }
        }
        for cap in TAG.captures_iter(line) {
            let tag = cap[1].trim_end_matches('/').to_string();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }
    Extracted { links, tags }
}

fn name_of(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file)
}

/// Resolve a wikilink target (as written) to a vault path, Obsidian-style:
/// an explicit path wins; otherwise match by filename stem
/// (case-insensitive), preferring the shortest path.
async fn resolve_target(db: &sqlx::SqlitePool, target: &str) -> Option<String> {
    if target.contains('/') {
        let candidate = format!("{target}.md");
        let row: Option<(String,)> =
            sqlx::query_as("SELECT path FROM note_text WHERE path = ? COLLATE NOCASE")
                .bind(&candidate)
                .fetch_optional(db)
                .await
                .ok()?;
        return row.map(|(p,)| p);
    }
    let pattern = format!("{target}.md");
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT path FROM note_text
         WHERE (path = ? COLLATE NOCASE) OR (path LIKE ? COLLATE NOCASE)
         ORDER BY length(path) LIMIT 1",
    )
    .bind(&pattern)
    .bind(format!("%/{pattern}"))
    .fetch_optional(db)
    .await
    .ok()?;
    row.map(|(p,)| p)
}

/// (Re)index one note. Single transaction; replaces all derived rows.
pub async fn index_note(state: &AppState, path: &str, body: &str) {
    let extracted = extract(body);
    let name = name_of(path).to_string();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Resolve link targets before opening the transaction.
    let mut resolved: Vec<(String, Option<String>)> = Vec::new();
    for target in &extracted.links {
        resolved.push((target.clone(), resolve_target(&state.db, target).await));
    }

    let mut txn = match state.db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("index {path}: {e}");
            return;
        }
    };
    let result: Result<(), sqlx::Error> = async {
        sqlx::query(
            "INSERT INTO note_text (path, body, indexed_at) VALUES (?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET body = excluded.body, indexed_at = excluded.indexed_at",
        )
        .bind(path)
        .bind(body)
        .bind(now_ms)
        .execute(&mut *txn)
        .await?;

        sqlx::query("DELETE FROM notes_fts WHERE path = ?")
            .bind(path)
            .execute(&mut *txn)
            .await?;
        sqlx::query("INSERT INTO notes_fts (path, name, body) VALUES (?, ?, ?)")
            .bind(path)
            .bind(&name)
            .bind(body)
            .execute(&mut *txn)
            .await?;

        sqlx::query("DELETE FROM links WHERE source_path = ?")
            .bind(path)
            .execute(&mut *txn)
            .await?;
        for (target, target_path) in &resolved {
            sqlx::query(
                "INSERT OR IGNORE INTO links (source_path, target_name, target_path) VALUES (?, ?, ?)",
            )
            .bind(path)
            .bind(target)
            .bind(target_path)
            .execute(&mut *txn)
            .await?;
        }

        sqlx::query("DELETE FROM tags WHERE note_path = ?")
            .bind(path)
            .execute(&mut *txn)
            .await?;
        for tag in &extracted.tags {
            sqlx::query("INSERT OR IGNORE INTO tags (note_path, tag) VALUES (?, ?)")
                .bind(path)
                .bind(tag)
                .execute(&mut *txn)
                .await?;
        }

        // This note may satisfy links that were unresolved until now.
        sqlx::query(
            "UPDATE links SET target_path = ?
             WHERE target_path IS NULL AND (
               target_name = ? COLLATE NOCASE OR
               target_name || '.md' = ? COLLATE NOCASE
             )",
        )
        .bind(path)
        .bind(&name)
        .bind(path)
        .execute(&mut *txn)
        .await?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            let _ = txn.commit().await;
        }
        Err(e) => tracing::error!("index {path}: {e}"),
    }
}

/// Drop a deleted note from the index (links pointing at it go unresolved).
pub async fn remove_note(state: &AppState, path: &str) {
    for sql in [
        "DELETE FROM note_text WHERE path = ?",
        "DELETE FROM notes_fts WHERE path = ?",
        "DELETE FROM links WHERE source_path = ?",
        "DELETE FROM tags WHERE note_path = ?",
        "UPDATE links SET target_path = NULL WHERE target_path = ?",
    ] {
        let _ = sqlx::query(sql).bind(path).execute(&state.db).await;
    }
}

/// Keep index rows pointing at the right path after a rename/move.
pub async fn move_note(state: &AppState, from: &str, to: &str) {
    for sql in [
        "UPDATE note_text SET path = ? WHERE path = ?",
        "UPDATE notes_fts SET path = ? WHERE path = ?",
        "UPDATE links SET source_path = ? WHERE source_path = ?",
        "UPDATE links SET target_path = ? WHERE target_path = ?",
        "UPDATE tags SET note_path = ? WHERE note_path = ?",
    ] {
        let _ = sqlx::query(sql)
            .bind(to)
            .bind(from)
            .execute(&state.db)
            .await;
    }
    // The filename (= link name + FTS name column) may have changed.
    if let Ok(body) = state.vault.read(to) {
        index_note(state, to, &body).await;
    }
}

/// Walk the vault and (re)index files newer than their index row.
/// Cheap enough to run at every startup; prunes deleted files too.
pub async fn reindex_vault(state: Arc<AppState>) {
    let vault = state.vault.clone();
    let files = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let walker = walkdir::WalkDir::new(vault.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
        for entry in walker.flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = vault.relativize(entry.path()) else {
                continue;
            };
            if !rel.ends_with(".md") {
                continue;
            }
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            files.push((rel, mtime));
        }
        files
    })
    .await
    .unwrap_or_default();

    // Prune rows whose file vanished while the server was down.
    let known: Vec<(String,)> = sqlx::query_as("SELECT path FROM note_text")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let live: std::collections::HashSet<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
    for (path,) in &known {
        if !live.contains(path.as_str()) {
            remove_note(&state, path).await;
        }
    }

    let mut indexed = 0u32;
    for (path, mtime) in files {
        let row: Option<(i64,)> = sqlx::query_as("SELECT indexed_at FROM note_text WHERE path = ?")
            .bind(&path)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
        if row.is_some_and(|(at,)| at >= mtime) {
            continue;
        }
        if let Ok(body) = state.vault.read(&path) {
            index_note(&state, &path, &body).await;
            indexed += 1;
        }
    }
    if indexed > 0 {
        tracing::info!("indexed {indexed} notes");
    }
}

/* ---------------------------- HTTP API ---------------------------- */

// Snippet match markers — control chars that can't appear in markdown;
// the client splits on them to render highlights safely (no HTML).
const MARK_OPEN: &str = "\u{1}";
const MARK_CLOSE: &str = "\u{2}";

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    /// Body excerpt with … around matched terms.
    pub snippet: String,
}

/// Turn free text into an FTS5 prefix query: each term quoted + starred.
fn fts_query(q: &str) -> String {
    q.split_whitespace()
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// GET /api/search?q=
pub async fn search(
    Query(params): Query<SearchParams>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<SearchHit>>, StatusCode> {
    let q = params.q.trim();
    if q.is_empty() {
        return Ok(Json(vec![]));
    }
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT path, name, snippet(notes_fts, 2, ?, ?, '…', 12)
         FROM notes_fts WHERE notes_fts MATCH ?
         ORDER BY bm25(notes_fts, 0.0, 2.0, 1.0) LIMIT 20",
    )
    .bind(MARK_OPEN)
    .bind(MARK_CLOSE)
    .bind(fts_query(q))
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        rows.into_iter()
            .map(|(path, name, snippet)| SearchHit {
                path,
                name,
                snippet,
            })
            .collect(),
    ))
}

#[derive(Serialize)]
pub struct Backlink {
    pub source_path: String,
    pub source_name: String,
    /// First line containing the link, for context.
    pub context: String,
}

/// GET /api/backlinks/{*path}
pub async fn backlinks(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Backlink>>, StatusCode> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT l.source_path, COALESCE(t.body, '')
         FROM links l LEFT JOIN note_text t ON t.path = l.source_path
         WHERE l.target_path = ? ORDER BY l.source_path",
    )
    .bind(&path)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let backlinks = rows
        .into_iter()
        .map(|(source_path, body)| {
            let context = body
                .lines()
                .find(|l| l.contains("[["))
                .unwrap_or("")
                .trim()
                .chars()
                .take(200)
                .collect();
            Backlink {
                source_name: name_of(&source_path).to_string(),
                source_path,
                context,
            }
        })
        .collect();
    Ok(Json(backlinks))
}

#[derive(Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

/// GET /api/tags
pub async fn tags(State(state): State<Arc<AppState>>) -> Result<Json<Vec<TagCount>>, StatusCode> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY COUNT(*) DESC, tag")
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        rows.into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect(),
    ))
}

#[derive(Serialize)]
pub struct TaggedNote {
    pub path: String,
    pub name: String,
}

/// GET /api/tags/{*tag}
pub async fn notes_with_tag(
    AxumPath(tag): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TaggedNote>>, StatusCode> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT note_path FROM tags WHERE tag = ? ORDER BY note_path")
            .bind(&tag)
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        rows.into_iter()
            .map(|(path,)| TaggedNote {
                name: name_of(&path).to_string(),
                path,
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_wikilinks_with_aliases_and_headings() {
        let e = extract("See [[Plan]] and [[Projects/Work|the work note]] and [[Roadmap#Q3]].");
        assert_eq!(e.links, vec!["Plan", "Projects/Work", "Roadmap"]);
    }

    #[test]
    fn extracts_tags_but_not_headings() {
        let e = extract("# Heading\n\nTagged #alpha and #nested/tag, not#this.\n#beta");
        assert_eq!(e.tags, vec!["alpha", "nested/tag", "beta"]);
    }

    #[test]
    fn skips_fenced_code_blocks() {
        let e = extract("```\n[[NotALink]] #notatag\n```\nReal [[Link]] #real");
        assert_eq!(e.links, vec!["Link"]);
        assert_eq!(e.tags, vec!["real"]);
    }

    #[test]
    fn dedupes_links_and_tags() {
        let e = extract("[[A]] [[A]] #t #t");
        assert_eq!(e.links, vec!["A"]);
        assert_eq!(e.tags, vec!["t"]);
    }

    #[test]
    fn fts_query_quotes_and_prefixes() {
        assert_eq!(fts_query("hello wor"), "\"hello\"* \"wor\"*");
        assert_eq!(fts_query("a\"b"), "\"a\"\"b\"*");
    }

    async fn test_state() -> Arc<AppState> {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let dir = std::env::temp_dir().join(format!("notable-test-{}", uuid::Uuid::new_v4()));
        Arc::new(AppState {
            db,
            vault: crate::vault::Vault::new(dir).unwrap(),
            rooms: dashmap::DashMap::new(),
            core_plugins_dir: "/nonexistent".into(),
            plugins_dir: "/nonexistent".into(),
            plugin_registry_url: String::new(),
            themes_dir: "/nonexistent".into(),
        })
    }

    #[tokio::test]
    async fn index_search_backlinks_round_trip() {
        let state = test_state().await;

        index_note(
            &state,
            "Plan.md",
            "# The plan\n\nShip the search feature #roadmap",
        )
        .await;
        index_note(&state, "Journal/Today.md", "Working on [[Plan]] today #log").await;

        // Full-text search finds by body, ranked, with match markers.
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT path, snippet(notes_fts, 2, '<', '>', '…', 12)
             FROM notes_fts WHERE notes_fts MATCH ?",
        )
        .bind(fts_query("search feat"))
        .fetch_all(&state.db)
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "Plan.md");
        assert!(rows[0].1.contains("<search>"), "snippet: {}", rows[0].1);

        // The wikilink resolved by filename stem.
        let link: (String, Option<String>) =
            sqlx::query_as("SELECT source_path, target_path FROM links WHERE target_name = 'Plan'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(link.0, "Journal/Today.md");
        assert_eq!(link.1.as_deref(), Some("Plan.md"));

        // Tags extracted per note.
        let tags: Vec<(String,)> =
            sqlx::query_as("SELECT tag FROM tags WHERE note_path = 'Plan.md'")
                .fetch_all(&state.db)
                .await
                .unwrap();
        assert_eq!(tags, vec![("roadmap".to_string(),)]);
    }

    #[tokio::test]
    async fn rename_keeps_links_and_unresolved_links_resolve_later() {
        let state = test_state().await;

        // Link to a note that doesn't exist yet -> unresolved.
        index_note(&state, "A.md", "see [[Future Note]]").await;
        let unresolved: (Option<String>,) =
            sqlx::query_as("SELECT target_path FROM links WHERE source_path = 'A.md'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(unresolved.0, None);

        // Creating the note resolves the dangling link.
        index_note(&state, "Future Note.md", "now I exist").await;
        let resolved: (Option<String>,) =
            sqlx::query_as("SELECT target_path FROM links WHERE source_path = 'A.md'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(resolved.0.as_deref(), Some("Future Note.md"));

        // Deleting it un-resolves again.
        remove_note(&state, "Future Note.md").await;
        let gone: (Option<String>,) =
            sqlx::query_as("SELECT target_path FROM links WHERE source_path = 'A.md'")
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(gone.0, None);
    }
}
