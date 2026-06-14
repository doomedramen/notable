//! Optional single-password authentication.
//!
//! Off by default. When `--auth-password` is set, every `/api/*` request
//! (including the sync WebSocket upgrade) must carry a session cookie
//! issued by `POST /api/login`. This is LAN-protection for a self-hosted
//! single-user app, not a multi-user auth system: there is one shared
//! password and the session token is a signed expiry, not a revocable
//! server-side session.

use crate::AppState;
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

const COOKIE_NAME: &str = "notable_session";
const SESSION_TTL_SECS: u64 = 30 * 24 * 3600;

fn sign(password: &str, expires: u64) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(password.as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(expires.to_string().as_bytes());
    let sig = mac.finalize().into_bytes();
    format!("{expires}.{}", hex::encode(sig))
}

fn verify(password: &str, token: &str) -> bool {
    let Some((expires, _)) = token.split_once('.') else {
        return false;
    };
    let Ok(expires) = expires.parse::<u64>() else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if expires < now {
        return false;
    }
    // Constant-time-ish: recompute the full expected token and compare.
    sign(password, expires) == token
}

fn cookie_value(headers: &header::HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix(COOKIE_NAME)
            .and_then(|rest| rest.strip_prefix('='))
            .map(|v| v.to_string())
    })
}

/// Guards `/api/*` (except `/api/login`) when `auth_password` is configured.
pub async fn guard(State(state): State<Arc<AppState>>, req: Request<Body>, next: Next) -> Response {
    let Some(password) = &state.auth_password else {
        return next.run(req).await;
    };
    if req.uri().path() == "/api/login" {
        return next.run(req).await;
    }
    let authorized = cookie_value(req.headers()).is_some_and(|token| verify(password, &token));
    if authorized {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    password: String,
}

/// POST /api/login - exchange the shared password for a session cookie.
pub async fn login(State(state): State<Arc<AppState>>, Json(body): Json<LoginRequest>) -> Response {
    let Some(password) = &state.auth_password else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if body.password != *password {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let expires = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + SESSION_TTL_SECS;
    let token = sign(password, expires);
    let cookie = format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL_SECS}"
    );
    ([(header::SET_COOKIE, cookie)], StatusCode::NO_CONTENT).into_response()
}

/// POST /api/logout - clear the session cookie.
pub async fn logout() -> Response {
    let cookie = format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    ([(header::SET_COOKIE, cookie)], StatusCode::NO_CONTENT).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_token_for_correct_password_verifies() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = sign("hunter2", now + 60);
        assert!(verify("hunter2", &token));
    }

    #[test]
    fn token_signed_with_wrong_password_is_rejected() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = sign("hunter2", now + 60);
        assert!(!verify("other", &token));
    }

    #[test]
    fn expired_token_is_rejected() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = sign("hunter2", now.saturating_sub(1));
        assert!(!verify("hunter2", &token));
    }

    #[test]
    fn malformed_token_is_rejected() {
        assert!(!verify("hunter2", "not-a-token"));
    }

    async fn test_state(auth_password: Option<&str>) -> Arc<AppState> {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let dir = std::env::temp_dir().join(format!("notable-auth-test-{}", uuid::Uuid::new_v4()));
        Arc::new(AppState {
            db,
            vault: crate::vault::Vault::new(dir).unwrap(),
            rooms: dashmap::DashMap::new(),
            core_plugins_dir: "/nonexistent".into(),
            plugins_dir: "/nonexistent".into(),
            plugin_registry_url: String::new(),
            themes_dir: "/nonexistent".into(),
            auth_password: auth_password.map(String::from),
        })
    }

    fn test_app(state: Arc<AppState>) -> axum::Router {
        let protected = axum::Router::new()
            .route("/api/notes", axum::routing::get(|| async { "ok" }))
            .route_layer(axum::middleware::from_fn_with_state(state.clone(), guard));
        axum::Router::new()
            .merge(protected)
            .route("/api/login", axum::routing::post(login))
            .route("/api/logout", axum::routing::post(logout))
            .with_state(state)
    }

    #[tokio::test]
    async fn protected_route_requires_cookie_when_auth_enabled() {
        use tower::ServiceExt;

        let app = test_app(test_state(Some("secret")).await);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_disabled_allows_unauthenticated_access() {
        use tower::ServiceExt;

        let app = test_app(test_state(None).await);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn wrong_password_is_rejected() {
        use tower::ServiceExt;

        let app = test_app(test_state(Some("secret")).await);
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"wrong"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn correct_password_grants_a_session_cookie() {
        use tower::ServiceExt;

        let state = test_state(Some("secret")).await;
        let app = test_app(state);

        let login_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"secret"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_res.status(), StatusCode::NO_CONTENT);
        let set_cookie = login_res
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        let cookie = set_cookie.split(';').next().unwrap().to_string();

        let notes_res = app
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(notes_res.status(), StatusCode::OK);
    }
}
