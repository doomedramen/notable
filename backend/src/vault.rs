//! The vault: a directory of plain markdown files — the canonical store.
//!
//! Identity model (Obsidian-style): a note's id IS its vault-relative
//! path ("Projects/Plan.md"); the filename (stem) is its title. Nothing
//! app-specific is ever written into user files.

use crate::AppState;
use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

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

    /// Read a note's text.
    pub fn read(&self, rel: &str) -> Result<String, StatusCode> {
        let abs = self.resolve_note(rel)?;
        std::fs::read_to_string(abs).map_err(|_| StatusCode::NOT_FOUND)
    }

    /// Write a note atomically (tmp file + rename), creating parent dirs.
    pub fn write(&self, rel: &str, text: &str) -> anyhow::Result<()> {
        let abs = self.resolve_note(rel).map_err(|s| anyhow::anyhow!("bad path: {s}"))?;
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

#[derive(Deserialize)]
pub struct RenameNote {
    pub new_path: String,
}

/// PATCH /api/notes/{*path} — rename/move a note.
pub async fn rename(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RenameNote>,
) -> Result<Json<NoteMeta>, StatusCode> {
    let from = state.vault.resolve_note(&path)?;
    let to = state.vault.resolve_note(&req.new_path)?;
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
    let _ = sqlx::query("UPDATE doc_cache SET path = ? WHERE path = ?")
        .bind(&req.new_path)
        .bind(&path)
        .execute(&state.db)
        .await;
    crate::indexer::move_note(&state, &path, &req.new_path).await;

    let modified = to
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(Json(meta_for(req.new_path, modified)))
}

/// DELETE /api/notes/{*path}
pub async fn delete(
    AxumPath(path): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let Ok(abs) = state.vault.resolve_note(&path) else {
        return StatusCode::BAD_REQUEST;
    };
    crate::sync::evict(&state, &path);
    let _ = sqlx::query("DELETE FROM doc_cache WHERE path = ?")
        .bind(&path)
        .execute(&state.db)
        .await;
    crate::indexer::remove_note(&state, &path).await;
    match std::fs::remove_file(abs) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
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
