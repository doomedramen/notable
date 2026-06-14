//! Vault-wide note and folder icon assignments.

use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IconRef {
    pub pack_id: String,
    pub icon_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssignmentKind {
    Note,
    Folder,
}

impl AssignmentKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Folder => "folder",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IconAssignment {
    pub kind: AssignmentKind,
    pub path: String,
    pub icon: IconRef,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAssignment {
    pub kind: AssignmentKind,
    pub path: String,
    pub icon: Option<IconRef>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<IconAssignment>>, StatusCode> {
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT kind, path, pack_id, icon_id
         FROM icon_assignments
         ORDER BY kind, path",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let assignments = rows
        .into_iter()
        .filter_map(|(kind, path, pack_id, icon_id)| {
            let kind = match kind.as_str() {
                "note" => AssignmentKind::Note,
                "folder" => AssignmentKind::Folder,
                _ => return None,
            };
            Some(IconAssignment {
                kind,
                path,
                icon: IconRef { pack_id, icon_id },
            })
        })
        .collect();
    Ok(Json(assignments))
}

pub async fn set(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetAssignment>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    validate_path(&request.path)?;
    if let Some(icon) = request.icon {
        validate_identifier(&icon.pack_id, "pack id")?;
        validate_identifier(&icon.icon_id, "icon id")?;
        sqlx::query(
            "INSERT INTO icon_assignments
             (kind, path, pack_id, icon_id, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(kind, path) DO UPDATE SET
               pack_id = excluded.pack_id,
               icon_id = excluded.icon_id,
               updated_at = CURRENT_TIMESTAMP",
        )
        .bind(request.kind.as_str())
        .bind(request.path)
        .bind(icon.pack_id)
        .bind(icon.icon_id)
        .execute(&state.db)
        .await
        .map_err(internal_error)?;
    } else {
        sqlx::query("DELETE FROM icon_assignments WHERE kind = ? AND path = ?")
            .bind(request.kind.as_str())
            .bind(request.path)
            .execute(&state.db)
            .await
            .map_err(internal_error)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn move_path(
    state: &AppState,
    kind: AssignmentKind,
    from: &str,
    to: &str,
) -> Result<(), sqlx::Error> {
    let mut transaction = state.db.begin().await?;
    sqlx::query("DELETE FROM icon_assignments WHERE kind = ? AND path = ?")
        .bind(kind.as_str())
        .bind(to)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "UPDATE icon_assignments
         SET path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE kind = ? AND path = ?",
    )
    .bind(to)
    .bind(kind.as_str())
    .bind(from)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn remove_path(
    state: &AppState,
    kind: AssignmentKind,
    path: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM icon_assignments WHERE kind = ? AND path = ?")
        .bind(kind.as_str())
        .bind(path)
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn remove_folder_tree(state: &AppState, path: &str) -> Result<(), sqlx::Error> {
    let prefix = format!("{path}/%");
    sqlx::query(
        "DELETE FROM icon_assignments
         WHERE kind = 'folder' AND (path = ? OR path LIKE ?)",
    )
    .bind(path)
    .bind(prefix)
    .execute(&state.db)
    .await?;
    Ok(())
}

fn validate_path(path: &str) -> Result<(), (StatusCode, String)> {
    if path.trim().is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err((StatusCode::BAD_REQUEST, "invalid assignment path".into()));
    }
    Ok(())
}

fn validate_identifier(value: &str, name: &str) -> Result<(), (StatusCode, String)> {
    if value.is_empty()
        || value.len() > 160
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err((StatusCode::BAD_REQUEST, format!("invalid {name}")));
    }
    Ok(())
}

fn internal_error(error: sqlx::Error) -> (StatusCode, String) {
    tracing::error!("icon assignment database error: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not update icon assignment".into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{vault::Vault, AppState};
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn validates_assignment_paths_and_ids() {
        assert!(validate_path("Projects/Plan.md").is_ok());
        assert!(validate_path("../Plan.md").is_err());
        assert!(validate_path("/Plan.md").is_err());
        assert!(validate_identifier("icons-phosphor:phosphor", "pack id").is_ok());
        assert!(validate_identifier("<script>", "icon id").is_err());
    }

    #[tokio::test]
    async fn stores_moves_and_removes_assignments() {
        let temp = tempfile::tempdir().unwrap();
        let db = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE icon_assignments (
              kind TEXT NOT NULL,
              path TEXT NOT NULL,
              pack_id TEXT NOT NULL,
              icon_id TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (kind, path)
            )",
        )
        .execute(&db)
        .await
        .unwrap();
        let state = Arc::new(AppState {
            db,
            vault: Vault::new(temp.path().join("vault")).unwrap(),
            rooms: dashmap::DashMap::new(),
            core_plugins_dir: "/nonexistent".into(),
            plugins_dir: "/nonexistent".into(),
            plugin_registry_url: String::new(),
            themes_dir: "/nonexistent".into(),
            auth_password: None,
        });

        set(
            State(state.clone()),
            Json(SetAssignment {
                kind: AssignmentKind::Note,
                path: "Old.md".into(),
                icon: Some(IconRef {
                    pack_id: "icons:test".into(),
                    icon_id: "star".into(),
                }),
            }),
        )
        .await
        .unwrap();
        move_path(&state, AssignmentKind::Note, "Old.md", "New.md")
            .await
            .unwrap();

        let Json(assignments) = list(State(state.clone())).await.unwrap();
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].path, "New.md");

        remove_path(&state, AssignmentKind::Note, "New.md")
            .await
            .unwrap();
        let Json(assignments) = list(State(state)).await.unwrap();
        assert!(assignments.is_empty());
    }
}
