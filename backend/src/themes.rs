//! Custom theme discovery and serving.
//!
//! Themes are plain `*.css` files in `themes_dir`, overriding the design
//! tokens declared in `frontend/src/styles/tokens.css`. See docs/themes.md.

use crate::AppState;
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use std::{
    path::{Component, Path},
    sync::Arc,
};

#[derive(Debug, Serialize, Clone)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
}

/// GET /api/themes - list available `*.css` themes.
pub async fn list(State(state): State<Arc<AppState>>) -> Json<Vec<ThemeInfo>> {
    let mut themes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&state.themes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("css") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            themes.push(ThemeInfo {
                id: stem.to_string(),
                name: humanize(stem),
            });
        }
    }
    themes.sort_by(|a, b| a.name.cmp(&b.name));
    Json(themes)
}

fn humanize(stem: &str) -> String {
    stem.replace(['-', '_'], " ")
        .split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// GET /api/themes/{file} - serve a theme's CSS.
pub async fn serve_file(
    AxumPath(file): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let path = Path::new(&file);
    let safe = path.extension().and_then(|e| e.to_str()) == Some("css")
        && path.components().count() == 1
        && matches!(path.components().next(), Some(Component::Normal(_)));
    if !safe {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let Ok(base) = state.themes_dir.canonicalize() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(target) = base.join(&file).canonicalize() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !target.starts_with(&base) || !target.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }

    match tokio::fs::read(&target).await {
        Ok(data) => (
            [
                (header::CONTENT_TYPE, "text/css"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            data,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
