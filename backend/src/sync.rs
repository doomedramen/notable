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
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use yrs::{
    updates::decoder::Decode, GetString, ReadTxn, StateVector, Text, Transact, Update,
};

pub struct Room {
    pub doc: tokio::sync::Mutex<yrs::Doc>,
    pub tx: broadcast::Sender<Vec<u8>>,
    pub guid: String,
    dirty: AtomicBool,
    last_change: StdMutex<Instant>,
}

impl Room {
    fn new(doc: yrs::Doc, guid: String) -> Self {
        Self {
            doc: tokio::sync::Mutex::new(doc),
            tx: broadcast::channel(256).0,
            guid,
            dirty: AtomicBool::new(false),
            last_change: StdMutex::new(Instant::now()),
        }
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
        *self.last_change.lock().unwrap() = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        self.last_change.lock().unwrap().elapsed()
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

    let room = Arc::new(Room::new(doc, guid));
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
pub async fn flush_room(state: &AppState, path: &str, room: &Room) {
    if !room.dirty.swap(false, Ordering::Relaxed) {
        return;
    }
    let text = {
        let doc = room.doc.lock().await;
        doc_text(&doc)
    };
    if let Err(e) = state.vault.write(path, &text) {
        tracing::error!("failed to write {path}: {e}");
        room.dirty.store(true, Ordering::Relaxed); // retry next sweep
        return;
    }
    update_cache(state, path, room).await;
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

/// Background task: flush dirty rooms after idle, evict cold ones.
pub async fn sweeper(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
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
    let Some(room) = state.rooms.get(path).map(|r| r.clone()) else {
        return;
    };
    let Ok(file_text) = state.vault.read(path) else {
        return; // deleted/moved — vault handlers manage room lifecycle
    };

    // Only treat this as an external edit if the file differs from the
    // last state we wrote/knew (the cache hash). Comparing against the
    // LIVE doc would misfire: between flushes the doc legitimately runs
    // ahead of the file (in-flight typing), and "reconciling" a stale
    // event — e.g. the echo of our own create/flush — would diff that
    // typing away.
    let known: Option<(String,)> =
        sqlx::query_as("SELECT text_hash FROM doc_cache WHERE path = ?")
            .bind(path)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
    if known.map(|(h,)| h) == Some(sha256_hex(&file_text)) {
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
    let _ = room.tx.send(update);
    // Doc now matches the file — refresh cache, nothing to write back.
    room.dirty.store(false, Ordering::Relaxed);
    update_cache(state, path, &room).await;
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
