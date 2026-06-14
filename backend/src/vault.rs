//! The vault: a directory of plain markdown files — the canonical store.
//!
//! Identity model (Obsidian-style): a note's id IS its vault-relative
//! path ("Projects/Plan.md"); the filename (stem) is its title. Nothing
//! app-specific is ever written into user files.

use crate::AppState;
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use zip::write::FileOptions;

#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&root)?;
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a vault-relative note path to an absolute one, rejecting
    /// traversal, absolute paths, hidden segments and non-.md targets.
    pub fn resolve_note(&self, rel: &str) -> Result<PathBuf, StatusCode> {
        if !rel.ends_with(".md") {
            return Err(StatusCode::BAD_REQUEST);
        }
        self.resolve(rel)
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf, StatusCode> {
        let rel_path = Path::new(rel);
        for comp in rel_path.components() {
            match comp {
                Component::Normal(seg) => {
                    let s = seg.to_string_lossy();
                    if s.starts_with('.') {
                        // No hidden files/dirs (also blocks .trash, .git).
                        return Err(StatusCode::BAD_REQUEST);
                    }
                }
                _ => return Err(StatusCode::BAD_REQUEST), // "..", "/", "C:\"
            }
        }
        if rel_path.as_os_str().is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }
        Ok(self.root.join(rel_path))
    }

    /// Like `resolve_note`, but also allows paths rooted at `.trash/` —
    /// the only hidden folder users can address, used to soft-delete and
    /// restore notes (rename in/out of it).
    pub fn resolve_note_or_trash(&self, rel: &str) -> Result<PathBuf, StatusCode> {
        if !rel.ends_with(".md") {
            return Err(StatusCode::BAD_REQUEST);
        }
        let rel_path = Path::new(rel);
        for (i, comp) in rel_path.components().enumerate() {
            match comp {
                Component::Normal(seg) => {
                    let s = seg.to_string_lossy();
                    if s.starts_with('.') && !(i == 0 && s == ".trash") {
                        return Err(StatusCode::BAD_REQUEST);
                    }
                }
                _ => return Err(StatusCode::BAD_REQUEST),
            }
        }
        Ok(self.root.join(rel_path))
    }

    /// Read a note's text.
    pub fn read(&self, rel: &str) -> Result<String, StatusCode> {
        let abs = self.resolve_note(rel)?;
        std::fs::read_to_string(abs).map_err(|_| StatusCode::NOT_FOUND)
    }

    /// Write a note atomically (tmp file + rename), creating parent dirs.
    pub fn write(&self, rel: &str, text: &str) -> anyhow::Result<()> {
        let abs = self
            .resolve_note(rel)
            .map_err(|s| anyhow::anyhow!("bad path: {s}"))?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = abs.with_extension("md.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &abs)?;
        Ok(())
    }

    /// Vault-relative path for an absolute path inside the vault.
    pub fn relativize(&self, abs: &Path) -> Option<String> {
        abs.strip_prefix(&self.root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
    }
}

pub fn sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Serialize)]
pub struct NoteMeta {
    /// Vault-relative path — the note's identity.
    pub path: String,
    /// Filename stem — the note's title.
    pub name: String,
    /// Containing folder ("" for vault root).
    pub folder: String,
    /// Last modified, ms since epoch.
    pub modified: u64,
}

fn name_of(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file)
}

fn meta_for(rel: String, modified: SystemTime) -> NoteMeta {
    let (folder, file) = match rel.rsplit_once('/') {
        Some((dir, file)) => (dir.to_string(), file),
        None => (String::new(), rel.as_str()),
    };
    let name = file.strip_suffix(".md").unwrap_or(file).to_string();
    let modified = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    NoteMeta {
        path: rel,
        name,
        folder,
        modified,
    }
}

#[derive(Serialize)]
pub struct VaultListing {
    pub notes: Vec<NoteMeta>,
    /// Every folder in the vault (so empty folders show in the tree).
    pub folders: Vec<String>,
}

/// GET /api/notes — walk the vault.
pub async fn list(State(state): State<Arc<AppState>>) -> Json<VaultListing> {
    let vault = state.vault.clone();
    // Filesystem walk; cheap for personal vaults but keep it off the
    // async executor anyway.
    let listing = tokio::task::spawn_blocking(move || {
        let mut notes = Vec::new();
        let mut folders = Vec::new();
        let walker = walkdir::WalkDir::new(vault.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
        for entry in walker.flatten() {
            let Some(rel) = vault.relativize(entry.path()) else {
                continue;
            };
            if rel.is_empty() {
                continue;
            }
            if entry.file_type().is_dir() {
                folders.push(rel);
            } else if rel.ends_with(".md") {
                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                notes.push(meta_for(rel, modified));
            }
        }
        notes.sort_by(|a, b| b.modified.cmp(&a.modified));
        folders.sort();
        VaultListing { notes, folders }
    })
    .await
    .unwrap_or(VaultListing {
        notes: vec![],
        folders: vec![],
    });
    Json(listing)
}

#[derive(Deserialize)]
pub struct CreateNote {
    /// Explicit path (offline clients pick it so creation is idempotent).
    pub path: Option<String>,
    /// Or name (+ folder): server picks a free "Name N.md" path.
    pub name: Option<String>,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub content: String,
}

/// POST /api/notes — create a file. Idempotent: if `path` already exists
/// it is left untouched (offline retries, or two devices creating the
/// same "Untitled.md" — their edits then merge via CRDT).
pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateNote>,
) -> Result<Json<NoteMeta>, StatusCode> {
    let rel = match (&req.path, &req.name) {
        (Some(path), _) => path.clone(),
        (None, Some(name)) => {
            let name = sanitize_name(name)?;
            let mut candidate = join_folder(&req.folder, &format!("{name}.md"));
            let mut n = 1;
            while state.vault.resolve_note(&candidate)?.exists() {
                candidate = join_folder(&req.folder, &format!("{name} {n}.md"));
                n += 1;
            }
            candidate
        }
        (None, None) => return Err(StatusCode::BAD_REQUEST),
    };

    let abs = state.vault.resolve_note(&rel)?;
    if !abs.exists() {
        state
            .vault
            .write(&rel, &req.content)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        crate::indexer::index_note(&state, &rel, &req.content).await;
    }
    let modified = abs
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(Json(meta_for(rel, modified)))
}

/// GET /api/notes/{*path} — plain text body.
pub async fn read(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<String, StatusCode> {
    state.vault.read(&path)
}

/// GET /raw/{*path} — serve the file with its native MIME type (markdown).
pub async fn read_raw(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let content = state.vault.read(&path)?;
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        content,
    ))
}

#[derive(Deserialize)]
pub struct RenameNote {
    pub new_path: String,
}

/// PATCH /api/notes/{*path} — rename/move a note. Also used for
/// soft-delete (rename into `.trash/...`) and restore (rename out of it).
pub async fn rename(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RenameNote>,
) -> Result<Json<NoteMeta>, StatusCode> {
    let from = state.vault.resolve_note_or_trash(&path)?;
    let to = state.vault.resolve_note_or_trash(&req.new_path)?;
    if !from.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    if to.exists() {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Flush and close any live room first so no write-behind targets
    // the old path after the move.
    crate::sync::flush_and_evict(&state, &path).await;

    std::fs::rename(&from, &to).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if let Err(error) = crate::icon_assignments::move_path(
        &state,
        crate::icon_assignments::AssignmentKind::Note,
        &path,
        &req.new_path,
    )
    .await
    {
        tracing::warn!("could not move icon assignment after note rename: {error}");
    }

    let entering_trash = req.new_path.starts_with(".trash/");
    let leaving_trash = path.starts_with(".trash/");
    if entering_trash {
        // Trashed notes are excluded from search/links/tags until restored.
        let _ = sqlx::query("DELETE FROM doc_cache WHERE path = ?")
            .bind(&path)
            .execute(&state.db)
            .await;
        crate::indexer::remove_note(&state, &path).await;
    } else {
        let _ = sqlx::query("UPDATE doc_cache SET path = ? WHERE path = ?")
            .bind(&req.new_path)
            .bind(&path)
            .execute(&state.db)
            .await;
        if leaving_trash {
            if let Ok(body) = state.vault.read(&req.new_path) {
                crate::indexer::index_note(&state, &req.new_path, &body).await;
            }
        } else {
            crate::indexer::move_note(&state, &path, &req.new_path).await;
        }
    }

    let modified = to
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(Json(meta_for(req.new_path, modified)))
}

/// DELETE /api/notes/{*path} — permanently remove a note (including
/// permanent deletion from `.trash/...`).
pub async fn delete(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let Ok(abs) = state.vault.resolve_note_or_trash(&path) else {
        return StatusCode::BAD_REQUEST;
    };
    crate::sync::evict(&state, &path);
    let _ = sqlx::query("DELETE FROM doc_cache WHERE path = ?")
        .bind(&path)
        .execute(&state.db)
        .await;
    crate::indexer::remove_note(&state, &path).await;
    let status = match std::fs::remove_file(abs) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::NO_CONTENT {
        if let Err(error) = crate::icon_assignments::remove_path(
            &state,
            crate::icon_assignments::AssignmentKind::Note,
            &path,
        )
        .await
        {
            tracing::warn!("could not remove icon assignment after note delete: {error}");
        }
    }
    status
}

#[derive(Serialize)]
pub struct TrashedNote {
    /// Path within `.trash/`, e.g. ".trash/Projects/Foo.md".
    pub path: String,
    /// Original vault-relative path it will be restored to.
    pub original_path: String,
    pub name: String,
    /// When it was trashed (file mtime), ms since epoch.
    pub deleted_at: u64,
}

/// GET /api/trash — list notes sitting in `.trash/`, newest first.
pub async fn list_trash(State(state): State<Arc<AppState>>) -> Json<Vec<TrashedNote>> {
    let vault = state.vault.clone();
    let mut items = tokio::task::spawn_blocking(move || {
        let trash_root = vault.root().join(".trash");
        let mut items = Vec::new();
        if !trash_root.is_dir() {
            return items;
        }
        let walker = walkdir::WalkDir::new(&trash_root)
            .follow_links(false)
            .into_iter()
            .flatten();
        for entry in walker {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = vault.relativize(entry.path()) else {
                continue;
            };
            if !rel.ends_with(".md") {
                continue;
            }
            let original_path = rel.strip_prefix(".trash/").unwrap_or(&rel).to_string();
            let name = name_of(&original_path).to_string();
            let deleted_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            items.push(TrashedNote {
                path: rel,
                original_path,
                name,
                deleted_at,
            });
        }
        items
    })
    .await
    .unwrap_or_default();
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Json(items)
}

#[derive(Deserialize)]
pub struct CreateFolder {
    pub path: String,
}

/// POST /api/folders — create a directory (idempotent).
pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateFolder>,
) -> StatusCode {
    let Ok(abs) = state.vault.resolve(&req.path) else {
        return StatusCode::BAD_REQUEST;
    };
    match std::fs::create_dir_all(abs) {
        Ok(_) => StatusCode::CREATED,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// DELETE /api/folders/{*path} — remove a folder, but only if it (and
/// any subfolders) contain no notes. Refuses non-empty folders rather
/// than silently deleting notes.
pub async fn delete_folder(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let Ok(abs) = state.vault.resolve(&path) else {
        return StatusCode::BAD_REQUEST;
    };
    if !abs.is_dir() {
        return StatusCode::NOT_FOUND;
    }
    let has_notes = walkdir::WalkDir::new(&abs)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .flatten()
        .any(|e| e.file_type().is_file());
    if has_notes {
        return StatusCode::CONFLICT;
    }
    match std::fs::remove_dir_all(&abs) {
        Ok(_) => {
            if let Err(error) = crate::icon_assignments::remove_folder_tree(&state, &path).await {
                tracing::warn!("could not remove folder icon assignments: {error}");
            }
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn join_folder(folder: &str, file: &str) -> String {
    if folder.is_empty() {
        file.to_string()
    } else {
        format!("{folder}/{file}")
    }
}

/// Titles become filenames — keep them filesystem- and URL-safe.
fn sanitize_name(name: &str) -> Result<String, StatusCode> {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '%' => ' ',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() || cleaned.starts_with('.') {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(cleaned)
}

/// GET /api/download/{*path} — download a file or a folder (as ZIP).
pub async fn download(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let abs = state.vault.resolve(&path)?;
    if !abs.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    if abs.is_file() {
        let content = std::fs::read(&abs).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let filename = abs.file_name().unwrap_or_default().to_string_lossy();
        Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream"),
                (
                    header::CONTENT_DISPOSITION,
                    &format!("attachment; filename=\"{}\"", filename),
                ),
            ],
            content,
        )
            .into_response())
    } else if abs.is_dir() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = FileOptions::<()>::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(0o755);

            let walker = walkdir::WalkDir::new(&abs)
                .into_iter()
                .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
            for entry in walker.flatten() {
                let path = entry.path();
                let name = path
                    .strip_prefix(&abs)
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let name_str = name.to_string_lossy().replace('\\', "/");

                if name_str.is_empty() {
                    continue;
                }

                if path.is_file() {
                    zip.start_file(name_str, options)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                    let content =
                        std::fs::read(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                    zip.write_all(&content)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                } else if path.is_dir() {
                    zip.add_directory(name_str, options)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            zip.finish().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        let folder_name = abs.file_name().unwrap_or_default().to_string_lossy();
        Ok((
            [
                (header::CONTENT_TYPE, "application/zip"),
                (
                    header::CONTENT_DISPOSITION,
                    &format!("attachment; filename=\"{}.zip\"", folder_name),
                ),
            ],
            buf,
        )
            .into_response())
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    async fn test_state() -> Arc<crate::AppState> {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let dir = std::env::temp_dir().join(format!("notable-vault-test-{}", uuid::Uuid::new_v4()));
        let vault = Vault::new(dir.clone()).unwrap();
        vault.write("test.md", "hello world").unwrap();

        Arc::new(crate::AppState {
            db,
            vault,
            rooms: dashmap::DashMap::new(),
            core_plugins_dir: "/nonexistent".into(),
            plugins_dir: "/nonexistent".into(),
            plugin_registry_url: String::new(),
            themes_dir: "/nonexistent".into(),
            auth_password: None,
        })
    }

    #[tokio::test]
    async fn test_read_raw_returns_markdown_content_type() {
        let state = test_state().await;
        let app = axum::Router::new()
            .route("/raw/{*path}", axum::routing::get(read_raw))
            .with_state(state);

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/raw/test.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(axum::http::header::CONTENT_TYPE).unwrap(),
            "text/markdown; charset=utf-8"
        );

        let body = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
        assert_eq!(body, "hello world");
    }

    #[tokio::test]
    async fn test_download_file() {
        let state = test_state().await;
        let app = axum::Router::new()
            .route("/api/download/{*path}", axum::routing::get(download))
            .with_state(state);

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/download/test.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(axum::http::header::CONTENT_TYPE).unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            res.headers()
                .get(axum::http::header::CONTENT_DISPOSITION)
                .unwrap(),
            "attachment; filename=\"test.md\""
        );
    }

    #[tokio::test]
    async fn test_download_folder() {
        let state = test_state().await;
        std::fs::create_dir_all(state.vault.root().join("subdir")).unwrap();
        state.vault.write("subdir/inner.md", "inner content").unwrap();

        let app = axum::Router::new()
            .route("/api/download/{*path}", axum::routing::get(download))
            .with_state(state);

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/download/subdir")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(axum::http::header::CONTENT_TYPE).unwrap(),
            "application/zip"
        );
        assert_eq!(
            res.headers()
                .get(axum::http::header::CONTENT_DISPOSITION)
                .unwrap(),
            "attachment; filename=\"subdir.zip\""
        );
    }
}
