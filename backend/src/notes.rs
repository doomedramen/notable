//! Note metadata. Content lives in the Yjs update log (sync.rs);
//! this module only handles the note list, titles, and lifecycle.

use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Serialize, sqlx::FromRow)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct CreateNote {
    pub title: String,
    /// Client generates the UUID so notes created offline keep their
    /// identity when they first reach the server.
    pub id: Option<Uuid>,
}

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Note>>, StatusCode> {
    let notes = sqlx::query_as::<_, Note>(
        "SELECT id, title, created_at, updated_at FROM notes ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(notes))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateNote>,
) -> Result<Json<Note>, StatusCode> {
    let id = req.id.unwrap_or_else(Uuid::new_v4).to_string();
    // Idempotent: offline clients may retry the same create.
    sqlx::query(
        "INSERT INTO notes (id, title) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title",
    )
    .bind(&id)
    .bind(&req.title)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    get_note(&state, &id).await.map(Json)
}

pub async fn get_one(
    Path(id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Note>, StatusCode> {
    get_note(&state, &id.to_string()).await.map(Json)
}

pub async fn delete(
    Path(id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    state.rooms.remove(&id);
    let id = id.to_string();
    let _ = sqlx::query("DELETE FROM note_updates WHERE note_id = ?")
        .bind(&id)
        .execute(&state.db)
        .await;
    match sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

async fn get_note(state: &AppState, id: &str) -> Result<Note, StatusCode> {
    sqlx::query_as::<_, Note>(
        "SELECT id, title, created_at, updated_at FROM notes WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)
}
