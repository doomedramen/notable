mod notes;
mod sync;

use axum::{
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use clap::Parser;
use rust_embed::RustEmbed;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{net::SocketAddr, str::FromStr, sync::Arc};

#[derive(Parser)]
#[command(name = "notable", about = "Self-hosted, offline-first notes")]
struct Args {
    /// Run as a pure server: don't open the app in a browser.
    #[arg(long)]
    headless: bool,

    /// Address to bind, e.g. 127.0.0.1:8080
    #[arg(long, env = "BIND", default_value = "127.0.0.1:8080")]
    bind: String,

    /// SQLite database location
    #[arg(long, env = "DATABASE_URL", default_value = "sqlite://notable.db")]
    database_url: String,
}

/// Frontend build output, embedded into the binary at compile time.
/// Run `npm run build` in ../frontend first (outputs to ../frontend/dist).
#[derive(RustEmbed)]
#[folder = "../frontend/dist/"]
struct FrontendAssets;

pub struct AppState {
    pub db: sqlx::SqlitePool,
    /// In-memory Y.Doc rooms for notes with active editors.
    pub rooms: dashmap::DashMap<uuid::Uuid, Arc<sync::Room>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    let opts = SqliteConnectOptions::from_str(&args.database_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let db = SqlitePoolOptions::new().connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&db).await?;

    let state = Arc::new(AppState {
        db,
        rooms: dashmap::DashMap::new(),
    });

    let app = Router::new()
        // REST: note metadata & lifecycle
        .route("/api/notes", get(notes::list).post(notes::create))
        .route("/api/notes/{id}", get(notes::get_one).delete(notes::delete))
        // Sync: one WebSocket per note (Yjs update protocol)
        .route("/api/sync/{id}", get(sync::ws_handler))
        // Bulk pull for offline catch-up: state vectors -> missing updates
        .route("/api/sync/{id}/diff", post(sync::diff))
        .with_state(state)
        .fallback(static_handler)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(tower_http::compression::CompressionLayer::new());

    let addr: SocketAddr = args.bind.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    tracing::info!("listening on http://{local}");

    if !args.headless {
        // Desktop mode: pop the app open in the default browser once
        // the port is actually bound. From there the user can "install"
        // it as a PWA for a windowed, dock-able experience.
        let url = format!("http://{local}");
        tokio::task::spawn_blocking(move || {
            if let Err(e) = open::that(&url) {
                tracing::warn!("could not open browser: {e}");
            }
        });
    }

    axum::serve(listener, app).await?;
    Ok(())
}

/// Serve the embedded SPA; unknown paths fall back to index.html
/// so client-side routing works.
async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match FrontendAssets::get(path).or_else(|| FrontendAssets::get("index.html")) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}
