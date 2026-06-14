//! Per-note sync rooms, bridging CRDT sessions onto plain files.
//!
//! Protocol (per WebSocket):
//!   server -> client:  1 text frame {"guid"} (doc epoch), then the full
//!                      doc state, then updates from other peers
//!   client -> server:  raw Yjs updates
//!
//! Persistence model — the FILE is canonical:
//!   - incoming updates mutate the in-memory Doc and mark the room dirty
//!   - a sweeper flushes dirty rooms to disk (atomic write) after ~2s of
//!     idle, on last-disconnect, and before eviction
//!   - `doc_cache` (SQLite) stores the Yjs state per path so client docs
//!     keep shared history across server restarts; it is derived data
//!   - external file edits (watcher) are line-diffed into the live Doc
//!     and broadcast, so other editors play nicely with the vault

use crate::{vault::sha256_hex, AppState};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::broadcast;
use yrs::{updates::decoder::Decode, GetString, ReadTxn, StateVector, Text, Transact, Update};

pub struct Room {
    pub doc: tokio::sync::Mutex<yrs::Doc>,
    pub tx: broadcast::Sender<Vec<u8>>,
    pub guid: String,
    dirty: AtomicBool,
    last_change: StdMutex<Instant>,
    last_file_hash: StdMutex<String>,
}

impl Room {
    fn new(doc: yrs::Doc, guid: String, last_file_hash: String) -> Self {
        Self {
            doc: tokio::sync::Mutex::new(doc),
            tx: broadcast::channel(256).0,
            guid,
            dirty: AtomicBool::new(false),
            last_change: StdMutex::new(Instant::now()),
            last_file_hash: StdMutex::new(last_file_hash),
        }
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
        *self.last_change.lock().unwrap() = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        self.last_change.lock().unwrap().elapsed()
    }

    fn file_hash(&self) -> String {
        self.last_file_hash.lock().unwrap().clone()
    }

    fn set_file_hash(&self, hash: String) {
        *self.last_file_hash.lock().unwrap() = hash;
    }
}

fn doc_text(doc: &yrs::Doc) -> String {
    let text = doc.get_or_insert_text("content");
    let txn = doc.transact();
    text.get_string(&txn)
}

/// Apply a plain-text change to the doc as minimal line-level edits
/// (byte offsets — yrs' default offset kind).
fn apply_text_diff(doc: &yrs::Doc, old: &str, new: &str) {
    use similar::{ChangeTag, TextDiff};
    let text = doc.get_or_insert_text("content");
    let mut txn = doc.transact_mut();
    let diff = TextDiff::from_lines(old, new);
    let mut pos: usize = 0;
    for change in diff.iter_all_changes() {
        let value = change.value();
        match change.tag() {
            ChangeTag::Equal => pos += value.len(),
            ChangeTag::Delete => {
                text.remove_range(&mut txn, pos as u32, value.len() as u32);
            }
            ChangeTag::Insert => {
                text.insert(&mut txn, pos as u32, value);
                pos += value.len();
            }
        }
    }
}

/// Load (or reuse) the room for a note. The file must exist; the cached
/// CRDT state is reconciled against the file, file winning on content.
pub async fn load_room(state: &AppState, path: &str) -> Result<Arc<Room>, StatusCode> {
    if let Some(room) = state.rooms.get(path) {
        return Ok(room.clone());
    }

    let file_text = state.vault.read(path)?;
    let row: Option<(String, Vec<u8>)> =
        sqlx::query_as("SELECT guid, state FROM doc_cache WHERE path = ?")
            .bind(path)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let file_hash = sha256_hex(&file_text);
    let (doc, guid, cache_stale) = match row {
        Some((guid, blob)) => {
            let doc = yrs::Doc::new();
            {
                let mut txn = doc.transact_mut();
                if let Ok(update) = Update::decode_v1(&blob) {
                    let _ = txn.apply_update(update);
                }
            }
            let cached_text = doc_text(&doc);
            if cached_text != file_text {
                // External edit while the room was cold — diff it in so
                // existing client docs still share history.
                apply_text_diff(&doc, &cached_text, &file_text);
                (doc, guid, true)
            } else {
                (doc, guid, false)
            }
        }
        None => {
            // First time we see this file: fresh doc, fresh epoch.
            let doc = yrs::Doc::new();
            if !file_text.is_empty() {
                let text = doc.get_or_insert_text("content");
                let mut txn = doc.transact_mut();
                text.insert(&mut txn, 0, &file_text);
            }
            (doc, uuid::Uuid::new_v4().to_string(), true)
        }
    };

    let room = Arc::new(Room::new(doc, guid, file_hash));
    if cache_stale {
        update_cache(state, path, &room).await;
    }

    // A concurrent connect may have inserted meanwhile — reuse theirs.
    let entry = state
        .rooms
        .entry(path.to_string())
        .or_insert_with(|| room.clone());
    Ok(entry.clone())
}

/// Persist the room's text to its file (atomic) + refresh doc_cache.
///
/// This checked form is used by document API writes, whose completion means
/// the canonical Markdown file is durable. Background callers use
/// `flush_room`, which logs and retries failures on the next sweep.
async fn persist_room(state: &AppState, path: &str, room: &Room) -> anyhow::Result<()> {
    if !room.dirty.swap(false, Ordering::Relaxed) {
        return Ok(());
    }
    let text = {
        let doc = room.doc.lock().await;
        doc_text(&doc)
    };
    if let Err(e) = state.vault.write(path, &text) {
        room.dirty.store(true, Ordering::Relaxed); // retry next sweep
        return Err(e);
    }
    room.set_file_hash(sha256_hex(&text));
    update_cache(state, path, room).await;
    crate::indexer::index_note(state, path, &text).await;
    Ok(())
}

pub async fn flush_room(state: &AppState, path: &str, room: &Room) {
    if let Err(error) = persist_room(state, path, room).await {
        tracing::error!("failed to write {path}: {error}");
    }
}

async fn update_cache(state: &AppState, path: &str, room: &Room) {
    let (blob, hash) = {
        let doc = room.doc.lock().await;
        let txn = doc.transact();
        let blob = txn.encode_state_as_update_v1(&StateVector::default());
        drop(txn);
        let hash = sha256_hex(&doc_text(&doc));
        (blob, hash)
    };
    let _ = sqlx::query(
        "INSERT INTO doc_cache (path, guid, state, text_hash, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET
           guid = excluded.guid, state = excluded.state,
           text_hash = excluded.text_hash, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(path)
    .bind(&room.guid)
    .bind(&blob)
    .bind(&hash)
    .execute(&state.db)
    .await;
}

/// Drop a room without flushing (file already gone — delete path).
pub fn evict(state: &AppState, path: &str) {
    state.rooms.remove(path);
}

/// Flush then drop (rename/move path).
pub async fn flush_and_evict(state: &AppState, path: &str) {
    if let Some((_, room)) = state.rooms.remove(path) {
        flush_room(state, path, &room).await;
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, path, state))
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct DocumentSnapshot {
    pub path: String,
    pub text: String,
    pub revision: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceDocument {
    pub text: String,
    pub expected_revision: Option<String>,
}

/// Return the latest CRDT text, including edits not yet flushed to disk.
pub async fn read_document(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<DocumentSnapshot>, StatusCode> {
    Ok(Json(document_snapshot(&state, &path).await?))
}

/// Merge a plain-text replacement into the room as a Yjs update.
///
/// The room lock makes revision comparison and mutation atomic with respect to
/// WebSocket peers and concurrent API writers. The resulting update is
/// broadcast to every connected editor and flushed before the request returns.
pub async fn replace_document(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ReplaceDocument>,
) -> Result<Json<DocumentSnapshot>, StatusCode> {
    Ok(Json(
        replace_document_text(
            &state,
            &path,
            &request.text,
            request.expected_revision.as_deref(),
        )
        .await?,
    ))
}

async fn document_snapshot(state: &AppState, path: &str) -> Result<DocumentSnapshot, StatusCode> {
    let room = load_room(state, path).await?;
    let text = {
        let doc = room.doc.lock().await;
        doc_text(&doc)
    };
    Ok(DocumentSnapshot {
        path: path.to_string(),
        revision: sha256_hex(&text),
        text,
    })
}

async fn replace_document_text(
    state: &AppState,
    path: &str,
    next_text: &str,
    expected_revision: Option<&str>,
) -> Result<DocumentSnapshot, StatusCode> {
    let room = load_room(state, path).await?;
    let (update, snapshot) = {
        let doc = room.doc.lock().await;
        let current = doc_text(&doc);
        let current_revision = sha256_hex(&current);
        if expected_revision.is_some_and(|expected| expected != current_revision) {
            return Err(StatusCode::CONFLICT);
        }
        if current == next_text {
            return Ok(DocumentSnapshot {
                path: path.to_string(),
                text: current,
                revision: current_revision,
            });
        }

        let before = doc.transact().state_vector();
        apply_text_diff(&doc, &current, next_text);
        let transaction = doc.transact();
        let update = transaction.encode_state_as_update_v1(&before);
        (
            update,
            DocumentSnapshot {
                path: path.to_string(),
                text: next_text.to_string(),
                revision: sha256_hex(next_text),
            },
        )
    };

    room.mark_dirty();
    let _ = room.tx.send(update);
    persist_room(state, path, &room).await.map_err(|error| {
        tracing::error!("document API failed to persist {path}: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(snapshot)
}

async fn handle_socket(mut socket: WebSocket, path: String, state: Arc<AppState>) {
    let room = match load_room(&state, &path).await {
        Ok(r) => r,
        Err(_) => return,
    };

    // 1. Doc epoch: clients reset local state if it changed (e.g. the
    //    server DB was rebuilt and CRDT history restarted).
    let hello = format!("{{\"guid\":\"{}\"}}", room.guid);
    if socket.send(Message::Text(hello.into())).await.is_err() {
        return;
    }

    // 2. Full current state so a (re)connecting client catches up.
    let initial = {
        let doc = room.doc.lock().await;
        let txn = doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    };
    if socket.send(Message::Binary(initial.into())).await.is_err() {
        return;
    }

    let mut rx = room.tx.subscribe();

    loop {
        tokio::select! {
            // Fan-out: updates from other peers in this room
            Ok(update) = rx.recv() => {
                if socket.send(Message::Binary(update.into())).await.is_err() {
                    break;
                }
            }
            // Fan-in: updates from this peer
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        let data = data.to_vec();
                        if let Ok(update) = Update::decode_v1(&data) {
                            let doc = room.doc.lock().await;
                            let mut txn = doc.transact_mut();
                            if txn.apply_update(update).is_ok() {
                                drop(txn);
                                drop(doc);
                                room.mark_dirty();
                                let _ = room.tx.send(data);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    // Last client out flushes promptly (sweeper would too, later).
    drop(rx);
    if room.tx.receiver_count() == 0 {
        flush_room(&state, &path, &room).await;
    }
}

/// How long a note sits in `.trash/` before it's permanently purged.
const TRASH_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

/// Pure helper so the 30-day expiry rule is unit-testable without
/// waiting 30 days.
fn is_expired(modified: SystemTime, now: SystemTime, ttl: Duration) -> bool {
    now.duration_since(modified).is_ok_and(|age| age > ttl)
}

/// Background task: flush dirty rooms after idle, evict cold ones, and
/// (once an hour) purge notes that have sat in `.trash/` for 30+ days.
pub async fn sweeper(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut ticks: u64 = 0;
    loop {
        tick.tick().await;
        let snapshot: Vec<(String, Arc<Room>)> = state
            .rooms
            .iter()
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect();
        for (path, room) in snapshot {
            let idle = room.idle_for();
            if room.dirty.load(Ordering::Relaxed) && idle > Duration::from_secs(2) {
                flush_room(&state, &path, &room).await;
            }
            if room.tx.receiver_count() == 0 && idle > Duration::from_secs(60) {
                flush_room(&state, &path, &room).await;
                state.rooms.remove(&path);
            }
        }

        ticks += 1;
        if ticks.is_multiple_of(3600) {
            purge_expired_trash(&state).await;
        }
    }
}

/// Permanently remove `.trash/**/*.md` files older than `TRASH_TTL`.
async fn purge_expired_trash(state: &Arc<AppState>) {
    let vault = state.vault.clone();
    let expired = tokio::task::spawn_blocking(move || {
        let trash_root = vault.root().join(".trash");
        if !trash_root.is_dir() {
            return Vec::new();
        }
        let now = SystemTime::now();
        walkdir::WalkDir::new(&trash_root)
            .follow_links(false)
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let modified = e.metadata().ok()?.modified().ok()?;
                if is_expired(modified, now, TRASH_TTL) {
                    vault.relativize(e.path())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();

    for path in expired {
        if let Ok(abs) = state.vault.resolve_note_or_trash(&path) {
            let _ = std::fs::remove_file(abs);
        }
        let _ = sqlx::query("DELETE FROM doc_cache WHERE path = ?")
            .bind(&path)
            .execute(&state.db)
            .await;
    }
}

/// Background task: watch the vault for external edits and merge them
/// into live rooms (other tools editing the same files is a feature).
pub async fn watcher(state: Arc<AppState>) {
    use notify::{Event, RecursiveMode, Watcher};

    let (tx, mut rx) = tokio::sync::mpsc::channel::<notify::Result<Event>>(256);
    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.blocking_send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!("vault watcher unavailable: {e}");
            return;
        }
    };
    if let Err(e) = watcher.watch(state.vault.root(), RecursiveMode::Recursive) {
        tracing::warn!("vault watcher failed to start: {e}");
        return;
    }

    // Debounce per path: editors often emit bursts of events per save.
    let mut pending: std::collections::HashMap<String, Instant> = Default::default();
    let mut tick = tokio::time::interval(Duration::from_millis(300));

    loop {
        tokio::select! {
            Some(res) = rx.recv() => {
                let Ok(event) = res else { continue };
                for abs in event.paths {
                    if abs.extension().and_then(|e| e.to_str()) != Some("md") {
                        continue;
                    }
                    if let Some(rel) = state.vault.relativize(&abs) {
                        if rel.split('/').any(|seg| seg.starts_with('.')) {
                            continue;
                        }
                        pending.insert(rel, Instant::now());
                    }
                }
            }
            _ = tick.tick() => {
                let due: Vec<String> = pending
                    .iter()
                    .filter(|(_, t)| t.elapsed() > Duration::from_millis(400))
                    .map(|(p, _)| p.clone())
                    .collect();
                for path in due {
                    pending.remove(&path);
                    reconcile_external_change(&state, &path).await;
                }
            }
        }
    }
}

/// Merge an on-disk change into a live room, if one is open. Cold notes
/// need nothing: load_room reconciles when they're next opened.
async fn reconcile_external_change(state: &Arc<AppState>, path: &str) {
    let Ok(file_text) = state.vault.read(path) else {
        return; // deleted/moved — vault handlers manage room lifecycle
    };
    let Some(room) = state.rooms.get(path).map(|r| r.clone()) else {
        // No live session — just keep the search index fresh.
        crate::indexer::index_note(state, path, &file_text).await;
        return;
    };

    // The active room owns the authoritative last-seen file hash. The
    // SQLite cache is derived and may be absent or temporarily unwritable;
    // relying on it here can turn a stale watcher event into a deletion of
    // in-flight editor text.
    let file_hash = sha256_hex(&file_text);
    if room.file_hash() == file_hash {
        return;
    }

    let update = {
        let doc = room.doc.lock().await;
        let current = doc_text(&doc);
        if current == file_text {
            return; // our own write-behind, or no real change
        }
        let sv_before = doc.transact().state_vector();
        apply_text_diff(&doc, &current, &file_text);
        let txn = doc.transact();
        txn.encode_state_as_update_v1(&sv_before)
    };

    tracing::info!("external edit merged: {path}");
    room.set_file_hash(file_hash);
    let _ = room.tx.send(update);
    // Doc now matches the file — refresh cache, nothing to write back.
    room.dirty.store(false, Ordering::Relaxed);
    update_cache(state, path, &room).await;
    crate::indexer::index_note(state, path, &file_text).await;
}

/// Offline catch-up over plain HTTP: client POSTs its state vector,
/// server responds with the missing diff.
#[derive(serde::Deserialize)]
pub struct DiffReq {
    /// base64-encoded Yjs state vector
    pub state_vector: String,
}

#[derive(serde::Serialize)]
pub struct DiffResp {
    /// base64-encoded Yjs update containing everything the client lacks
    pub update: String,
    pub guid: String,
}

pub async fn diff(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<DiffReq>,
) -> Result<Json<DiffResp>, StatusCode> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let room = load_room(&state, &path).await?;
    let sv_bytes = B64
        .decode(&req.state_vector)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let sv = StateVector::decode_v1(&sv_bytes).map_err(|_| StatusCode::BAD_REQUEST)?;
    let doc = room.doc.lock().await;
    let txn = doc.transact();
    let update = txn.encode_state_as_update_v1(&sv);
    Ok(Json(DiffResp {
        update: B64.encode(update),
        guid: room.guid.clone(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_expired_before_ttl() {
        let now = SystemTime::now();
        let modified = now - Duration::from_secs(29 * 24 * 3600);
        assert!(!is_expired(modified, now, TRASH_TTL));
    }

    #[test]
    fn expired_after_ttl() {
        let now = SystemTime::now();
        let modified = now - Duration::from_secs(31 * 24 * 3600);
        assert!(is_expired(modified, now, TRASH_TTL));
    }

    async fn test_state() -> Arc<AppState> {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let directory =
            std::env::temp_dir().join(format!("notable-sync-test-{}", uuid::Uuid::new_v4()));
        Arc::new(AppState {
            db,
            vault: crate::vault::Vault::new(directory).unwrap(),
            rooms: dashmap::DashMap::new(),
            core_plugins_dir: "/nonexistent".into(),
            plugins_dir: "/nonexistent".into(),
            plugin_registry_url: String::new(),
            themes_dir: "/nonexistent".into(),
            auth_password: None,
        })
    }

    #[tokio::test]
    async fn document_api_updates_room_file_and_connected_peers() {
        let state = test_state().await;
        state.vault.write("Plan.md", "first").unwrap();
        let room = load_room(&state, "Plan.md").await.unwrap();
        let mut updates = room.tx.subscribe();
        let initial = document_snapshot(&state, "Plan.md").await.unwrap();

        let changed =
            replace_document_text(&state, "Plan.md", "first\nsecond", Some(&initial.revision))
                .await
                .unwrap();

        assert_eq!(changed.text, "first\nsecond");
        assert_eq!(state.vault.read("Plan.md").unwrap(), "first\nsecond");
        assert!(!updates.recv().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn document_api_rejects_stale_revisions_without_changing_text() {
        let state = test_state().await;
        state.vault.write("Plan.md", "current").unwrap();

        let result =
            replace_document_text(&state, "Plan.md", "stale write", Some("old-revision")).await;

        assert_eq!(result.unwrap_err(), StatusCode::CONFLICT);
        assert_eq!(
            document_snapshot(&state, "Plan.md").await.unwrap().text,
            "current"
        );
        assert_eq!(state.vault.read("Plan.md").unwrap(), "current");
    }
}
