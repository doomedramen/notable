//! Generic key/value settings, persisted in SQLite. Values are opaque
//! JSON — the frontend owns their shape. Used for app settings, the
//! enabled-plugin set and per-plugin settings.

use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;

pub async fn get(
    Path(key): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match row {
        Some((value,)) => {
            let parsed =
                serde_json::from_str(&value).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(Json(parsed))
        }
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn put(
    Path(key): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(value): Json<serde_json::Value>,
) -> Result<StatusCode, StatusCode> {
    let serialized = value.to_string();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&key)
    .bind(&serialized)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Read a settings value directly (server-internal use).
pub async fn read_value(state: &AppState, key: &str) -> Option<serde_json::Value> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.db)
        .await
        .ok()?;
    serde_json::from_str(&row?.0).ok()
}
