//! Per-note sync rooms.
//!
//! Protocol (binary frames):
//!   client -> server:  raw Yjs updates (Y.encodeStateAsUpdate / incremental)
//!   server -> client:  raw Yjs updates from other peers + initial state
//!
//! Persistence model: every incoming update is appended to `note_updates`.
//! Periodically (and on room close) the doc is compacted into a single
//! snapshot row to keep reads fast.

use crate::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;
use yrs::{
    updates::decoder::Decode, updates::encoder::Encode, Doc, ReadTxn, StateVector, Transact,
    Update,
};

pub struct Room {
    pub doc: tokio::sync::Mutex<Doc>,
    pub tx: broadcast::Sender<Vec<u8>>,
}

impl Room {
    fn new() -> Self {
        Self {
            doc: tokio::sync::Mutex::new(Doc::new()),
            tx: broadcast::channel(256).0,
        }
    }
}

/// Load all persisted updates for a note into a fresh Doc.
async fn load_room(state: &AppState, note_id: Uuid) -> anyhow::Result<Arc<Room>> {
    if let Some(room) = state.rooms.get(&note_id) {
        return Ok(room.clone());
    }
    let room = Arc::new(Room::new());
    let rows: Vec<(Vec<u8>,)> =
        sqlx::query_as("SELECT data FROM note_updates WHERE note_id = ? ORDER BY seq")
            .bind(note_id.to_string())
            .fetch_all(&state.db)
            .await?;
    {
        let doc = room.doc.lock().await;
        let mut txn = doc.transact_mut();
        for (data,) in rows {
            if let Ok(update) = Update::decode_v1(&data) {
                let _ = txn.apply_update(update);
            }
        }
    }
    state.rooms.insert(note_id, room.clone());
    Ok(room)
}

async fn persist_update(state: &AppState, note_id: Uuid, data: &[u8]) {
    let _ = sqlx::query("INSERT INTO note_updates (note_id, data) VALUES (?, ?)")
        .bind(note_id.to_string())
        .bind(data)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(note_id.to_string())
        .execute(&state.db)
        .await;
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(note_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, note_id, state))
}

async fn handle_socket(mut socket: WebSocket, note_id: Uuid, state: Arc<AppState>) {
    let room = match load_room(&state, note_id).await {
        Ok(r) => r,
        Err(_) => return,
    };

    // 1. Send full current state so a (re)connecting client catches up.
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
                        // Apply to authoritative doc
                        if let Ok(update) = Update::decode_v1(&data) {
                            let doc = room.doc.lock().await;
                            let mut txn = doc.transact_mut();
                            if txn.apply_update(update).is_ok() {
                                drop(txn);
                                drop(doc);
                                persist_update(&state, note_id, &data).await;
                                // Broadcast to everyone (sender filters dupes
                                // client-side; Yjs applies are idempotent)
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
}

/// Offline catch-up over plain HTTP: client POSTs its state vector,
/// server responds with the missing diff. Used by the sync worker
/// before/without opening a WebSocket.
#[derive(serde::Deserialize)]
pub struct DiffReq {
    /// base64-encoded Yjs state vector
    pub state_vector: String,
}

#[derive(serde::Serialize)]
pub struct DiffResp {
    /// base64-encoded Yjs update containing everything the client lacks
    pub update: String,
}

pub async fn diff(
    Path(note_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<DiffReq>,
) -> Result<Json<DiffResp>, axum::http::StatusCode> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let room = load_room(&state, note_id)
        .await
        .map_err(|_| axum::http::StatusCode::NOT_FOUND)?;
    let sv_bytes = B64
        .decode(&req.state_vector)
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?;
    let sv = StateVector::decode_v1(&sv_bytes)
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?;
    let doc = room.doc.lock().await;
    let txn = doc.transact();
    let update = txn.encode_state_as_update_v1(&sv);
    Ok(Json(DiffResp {
        update: B64.encode(update),
    }))
}
