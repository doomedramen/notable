mod auth;
mod icon_assignments;
mod indexer;
mod plugins;
mod settings;
mod sync;
mod themes;
mod vault;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
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

    /// The vault: a directory of markdown files — the canonical store.
    #[arg(long, env = "VAULT_DIR", default_value = "./vault")]
    vault_dir: std::path::PathBuf,

    /// SQLite for derived data only (settings, CRDT cache, search index).
    #[arg(long, env = "DATABASE_URL", default_value = "sqlite://notable.db")]
    database_url: String,

    /// Directory of installed community plugins (each a folder with manifest.json)
    #[arg(long, env = "PLUGINS_DIR", default_value = "./plugins")]
    plugins_dir: std::path::PathBuf,

    /// Directory of immutable plugins shipped with Notable
    #[arg(long, env = "CORE_PLUGINS_DIR", default_value = "./core-plugins")]
    core_plugins_dir: std::path::PathBuf,

    /// Community plugin registry JSON URL (http(s):// or file://)
    #[arg(
        long,
        env = "PLUGIN_REGISTRY_URL",
        default_value = "https://github.com/doomedramen/notable-plugins/releases/download/plugins-latest/plugins.json"
    )]
    plugin_registry_url: String,

    /// Directory of user themes (*.css files overriding design tokens)
    #[arg(long, env = "THEMES_DIR", default_value = "./themes")]
    themes_dir: std::path::PathBuf,

    /// Shared password protecting /api/* (off by default). LAN-protection,
    /// not multi-user auth: one password, one session cookie.
    #[arg(long, env = "AUTH_PASSWORD")]
    auth_password: Option<String>,
}

/// Frontend build output, embedded into the binary at compile time.
/// Run `npm run build` in ../frontend first (outputs to ../frontend/dist).
#[derive(RustEmbed)]
#[folder = "../frontend/dist/"]
struct FrontendAssets;

pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub vault: vault::Vault,
    /// In-memory Y.Doc rooms for notes with active editors, by path.
    pub rooms: dashmap::DashMap<String, Arc<sync::Room>>,
    pub core_plugins_dir: std::path::PathBuf,
    pub plugins_dir: std::path::PathBuf,
    pub plugin_registry_url: String,
    pub themes_dir: std::path::PathBuf,
    pub auth_password: Option<String>,
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
        vault: vault::Vault::new(args.vault_dir)?,
        rooms: dashmap::DashMap::new(),
        core_plugins_dir: args.core_plugins_dir,
        plugins_dir: args.plugins_dir,
        plugin_registry_url: args.plugin_registry_url,
        themes_dir: args.themes_dir,
        auth_password: args.auth_password,
    });

    // Write-behind flusher + cold-room eviction.
    tokio::spawn(sync::sweeper(state.clone()));
    // Merge external file edits into live sessions.
    tokio::spawn(sync::watcher(state.clone()));
    // Catch up the search index with files changed while we were down.
    tokio::spawn(indexer::reindex_vault(state.clone()));

    let api = Router::new()
        // Vault: note files & lifecycle (note id = vault-relative path)
        .route("/api/notes", get(vault::list).post(vault::create))
        .route(
            "/api/notes/{*path}",
            get(vault::read).patch(vault::rename).delete(vault::delete),
        )
        .route("/api/folders", post(vault::create_folder))
        .route("/api/folders/{*path}", delete(vault::delete_folder))
        .route("/api/download/{*path}", get(vault::download))
        .route("/api/trash", get(vault::list_trash))
        // Sync: one WebSocket per note (Yjs update protocol)
        .route("/api/sync/{*path}", get(sync::ws_handler))
        // Bulk pull for offline catch-up: state vector -> missing updates
        .route("/api/diff/{*path}", post(sync::diff))
        // Revisioned, CRDT-safe document reads and writes for plugins.
        .route(
            "/api/documents/{*path}",
            get(sync::read_document).put(sync::replace_document),
        )
        // Search & graph index (derived from vault files)
        .route("/api/search", get(indexer::search))
        .route("/api/backlinks/{*path}", get(indexer::backlinks))
        .route("/api/links/{*path}", get(indexer::outgoing_links))
        .route("/api/tags", get(indexer::tags))
        .route("/api/tags/{*tag}", get(indexer::notes_with_tag))
        .route(
            "/api/icon-assignments",
            get(icon_assignments::list).put(icon_assignments::set),
        )
        // Runtime plugins: manifests, code, enablement
        .route("/api/plugins", get(plugins::list))
        .route("/api/plugins/store", get(plugins::store))
        .route(
            "/api/plugins/{id}",
            post(plugins::install).delete(plugins::uninstall),
        )
        .route("/api/plugins/{id}/enabled", put(plugins::set_enabled))
        .route("/api/plugins/{id}/{*file}", get(plugins::serve_file))
        // Custom themes: list/serve *.css overriding design tokens
        .route("/api/themes", get(themes::list))
        .route("/api/themes/{file}", get(themes::serve_file))
        // Generic settings KV (also used for per-plugin settings)
        .route("/api/settings/{key}", get(settings::get).put(settings::put))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::guard,
        ));

    let app = Router::new()
        .merge(api)
        .route("/raw/{*path}", get(vault::read_raw))
        // Login/logout are exempt from the auth guard above.
        .route("/api/login", post(auth::login))
        .route("/api/logout", post(auth::logout))
        .with_state(state)
        .fallback(static_handler)
        // Imported notes are capped at 10 MiB in the frontend. Axum's
        // default 2 MiB JSON limit would otherwise reject valid replays.
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
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

    // Track which file we actually serve so the MIME type matches the
    // fallback (deep links like /note/<path> must come back as text/html).
    let (path, content) = match FrontendAssets::get(path) {
        Some(content) => (path, content),
        None => match FrontendAssets::get("index.html") {
            Some(content) => ("index.html", content),
            None => return (StatusCode::NOT_FOUND, "not found").into_response(),
        },
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
}
