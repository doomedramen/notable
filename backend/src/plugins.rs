//! Runtime plugin serving.
//!
//! Plugins are directories under the configured plugins dir:
//!
//!   plugins/<id>/manifest.json   { "id", "name", "version", "description", "entry" }
//!   plugins/<id>/main.js         ES module, default-exports { onload, onunload }
//!
//! Trust model: anything in the plugins dir was put there by the server
//! admin and runs with full app privileges in the browser — same stance
//! as Obsidian. There is no sandbox; the only gate is filesystem access
//! to the server.

use crate::{settings, AppState};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const ENABLED_KEY: &str = "plugins.enabled";

#[derive(Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_entry")]
    pub entry: String,
}

fn default_entry() -> String {
    "main.js".into()
}

#[derive(Serialize)]
pub struct PluginInfo {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub enabled: bool,
}

/// GET /api/plugins — scan the plugins dir, join with the enabled set.
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<PluginInfo>>, StatusCode> {
    let enabled = enabled_set(&state).await;
    let mut plugins = Vec::new();

    let entries = match std::fs::read_dir(&state.plugins_dir) {
        Ok(entries) => entries,
        // Missing dir is not an error — just no plugins installed.
        Err(_) => return Ok(Json(plugins)),
    };

    for entry in entries.flatten() {
        let manifest_path = entry.path().join("manifest.json");
        let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<PluginManifest>(&raw) else {
            tracing::warn!("invalid plugin manifest: {}", manifest_path.display());
            continue;
        };
        // The directory name is the canonical id; reject mismatches so
        // a manifest can't impersonate another plugin's settings.
        if entry.file_name().to_string_lossy() != manifest.id {
            tracing::warn!(
                "plugin dir {} does not match manifest id {}",
                entry.file_name().to_string_lossy(),
                manifest.id
            );
            continue;
        }
        let enabled = enabled.contains(&manifest.id);
        plugins.push(PluginInfo { manifest, enabled });
    }
    plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(Json(plugins))
}

/// GET /api/plugins/{id}/{file} — serve a plugin asset (path-traversal guarded).
pub async fn serve_file(
    Path((id, file)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if id.contains(['/', '\\', '.']) || file.contains("..") || file.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let base = match state.plugins_dir.canonicalize() {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = match base.join(&id).join(&file).canonicalize() {
        Ok(p) => p,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    if !path.starts_with(&base) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match tokio::fs::read(&path).await {
        Ok(data) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
                    // Plugin code must never be cached stale.
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                data,
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
pub struct SetEnabled {
    pub enabled: bool,
}

/// PUT /api/plugins/{id}/enabled
pub async fn set_enabled(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<SetEnabled>,
) -> Result<StatusCode, StatusCode> {
    let mut enabled = enabled_set(&state).await;
    if req.enabled {
        if !enabled.contains(&id) {
            enabled.push(id);
        }
    } else {
        enabled.retain(|e| e != &id);
    }
    let value = serde_json::to_string(&enabled).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(ENABLED_KEY)
    .bind(&value)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enabled_set(state: &AppState) -> Vec<String> {
    settings::read_value(state, ENABLED_KEY)
        .await
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}
