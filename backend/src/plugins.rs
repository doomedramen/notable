//! Core and community plugin discovery, serving, and installation.
//!
//! Core plugins ship with the application in an immutable directory.
//! Community plugins are checksum-verified packages installed into the
//! writable plugins directory from a configurable registry.

use crate::{settings, AppState};
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use flate2::read::GzDecoder;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tar::Archive;
use uuid::Uuid;

const STATES_KEY: &str = "plugins.states";
const LEGACY_ENABLED_KEY: &str = "plugins.enabled";
const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 256;
const CURRENT_API_VERSION: u32 = 2;

type ApiError = (StatusCode, String);
type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub default_enabled: bool,
    #[serde(default = "default_api_version")]
    pub api_version: u32,
    #[serde(default)]
    pub categories: Vec<String>,
}

fn default_entry() -> String {
    "main.js".into()
}

fn default_api_version() -> u32 {
    1
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginSource {
    Core,
    Community,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub source: PluginSource,
    pub enabled: bool,
    pub user_managed: bool,
}

#[derive(Clone)]
struct DiscoveredPlugin {
    info: PluginInfo,
    root: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPackage {
    pub url: String,
    pub sha256: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorePlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default = "default_api_version")]
    pub api_version: u32,
    #[serde(default)]
    pub categories: Vec<String>,
    pub package: Option<RegistryPackage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreRegistry {
    pub plugins: Vec<StorePlugin>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePluginInfo {
    #[serde(flatten)]
    plugin: StorePlugin,
    installed: bool,
    enabled: bool,
    active_version: Option<String>,
    update_available: bool,
    installable: bool,
    compatible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreResponse {
    registry_url: String,
    plugins: Vec<StorePluginInfo>,
}

/// GET /api/plugins - list bundled and installed plugins.
pub async fn list(State(state): State<Arc<AppState>>) -> ApiResult<Json<Vec<PluginInfo>>> {
    let states = plugin_states(&state).await;
    Ok(Json(
        discover_plugins(&state.core_plugins_dir, &state.plugins_dir, &states)
            .into_iter()
            .map(|plugin| plugin.info)
            .collect(),
    ))
}

/// GET /api/plugins/store - list community plugins available from the registry.
pub async fn store(State(state): State<Arc<AppState>>) -> ApiResult<Json<StoreResponse>> {
    let registry = fetch_registry(&state.plugin_registry_url).await?;
    let states = plugin_states(&state).await;
    let installed = discover_plugins(&state.core_plugins_dir, &state.plugins_dir, &states)
        .into_iter()
        .map(|plugin| (plugin.info.manifest.id.clone(), plugin.info))
        .collect::<HashMap<_, _>>();

    let mut plugins = registry
        .plugins
        .into_iter()
        .filter(|plugin| valid_plugin_id(&plugin.id))
        .map(|plugin| {
            let current = installed.get(&plugin.id);
            let active_version = current.map(|item| item.manifest.version.clone());
            let compatible = plugin.api_version <= CURRENT_API_VERSION;
            StorePluginInfo {
                installed: current.is_some(),
                enabled: current.is_some_and(|item| item.enabled),
                update_available: active_version
                    .as_deref()
                    .is_some_and(|version| is_newer(&plugin.version, version)),
                installable: compatible
                    && plugin.package.is_some()
                    && !current.is_some_and(|item| item.source == PluginSource::Core),
                compatible,
                active_version,
                plugin,
            }
        })
        .collect::<Vec<_>>();
    plugins.sort_by_key(|plugin| plugin.plugin.name.to_lowercase());

    Ok(Json(StoreResponse {
        registry_url: state.plugin_registry_url.clone(),
        plugins,
    }))
}

/// POST /api/plugins/{id} - install or update a community plugin.
pub async fn install(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<StatusCode> {
    if !valid_plugin_id(&id) {
        return Err(bad_request("invalid plugin id"));
    }
    if find_plugin(&state.core_plugins_dir, PluginSource::Core, &id).is_some() {
        return Err((
            StatusCode::CONFLICT,
            "a core plugin already uses this id".into(),
        ));
    }

    let registry = fetch_registry(&state.plugin_registry_url).await?;
    let plugin = registry
        .plugins
        .into_iter()
        .find(|plugin| plugin.id == id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                "plugin is not in the registry".into(),
            )
        })?;
    validate_store_plugin(&plugin)?;
    let package = plugin
        .package
        .as_ref()
        .ok_or_else(|| bad_request("plugin does not have an installable package"))?;
    let bytes = download_package(package).await?;
    let plugins_dir = state.plugins_dir.clone();
    let expected = plugin.clone();

    tokio::task::spawn_blocking(move || install_package(&plugins_dir, &expected, &bytes))
        .await
        .map_err(|error| internal_error(format!("plugin install task failed: {error}")))??;

    Ok(StatusCode::CREATED)
}

/// DELETE /api/plugins/{id} - remove an installed community plugin.
pub async fn uninstall(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<StatusCode> {
    if !valid_plugin_id(&id) {
        return Err(bad_request("invalid plugin id"));
    }
    if find_plugin(&state.core_plugins_dir, PluginSource::Core, &id).is_some() {
        return Err((
            StatusCode::FORBIDDEN,
            "core plugins cannot be removed".into(),
        ));
    }

    let path = state.plugins_dir.join(&id);
    if !path.is_dir() {
        return Err((StatusCode::NOT_FOUND, "plugin is not installed".into()));
    }
    tokio::fs::remove_dir_all(&path)
        .await
        .map_err(|error| internal_error(format!("could not remove plugin: {error}")))?;

    let mut states = plugin_states(&state).await;
    states.remove(&id);
    save_plugin_states(&state, &states).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/plugins/{id}/{*file} - serve a plugin asset.
pub async fn serve_file(
    AxumPath((id, file)): AxumPath<(String, String)>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !valid_plugin_id(&id) || !safe_relative_path(Path::new(&file)) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let plugin = find_plugin(&state.core_plugins_dir, PluginSource::Core, &id)
        .or_else(|| find_plugin(&state.plugins_dir, PluginSource::Community, &id));
    let Some(plugin) = plugin else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(base) = plugin.root.canonicalize() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(path) = base.join(file).canonicalize() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !path.starts_with(&base) || !path.is_file() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match tokio::fs::read(&path).await {
        Ok(data) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
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

/// PUT /api/plugins/{id}/enabled - persist enablement for either plugin source.
pub async fn set_enabled(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetEnabled>,
) -> ApiResult<StatusCode> {
    let exists = find_plugin(&state.core_plugins_dir, PluginSource::Core, &id)
        .or_else(|| find_plugin(&state.plugins_dir, PluginSource::Community, &id))
        .is_some();
    if !exists {
        return Err((StatusCode::NOT_FOUND, "plugin is not installed".into()));
    }

    let mut states = plugin_states(&state).await;
    states.insert(id, request.enabled);
    save_plugin_states(&state, &states).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn discover_plugins(
    core_dir: &Path,
    community_dir: &Path,
    states: &HashMap<String, bool>,
) -> Vec<DiscoveredPlugin> {
    let mut seen = HashSet::new();
    let mut plugins = Vec::new();
    scan_plugins(
        core_dir,
        PluginSource::Core,
        states,
        &mut seen,
        &mut plugins,
    );
    scan_plugins(
        community_dir,
        PluginSource::Community,
        states,
        &mut seen,
        &mut plugins,
    );
    plugins.sort_by(|left, right| {
        source_rank(left.info.source)
            .cmp(&source_rank(right.info.source))
            .then_with(|| {
                left.info
                    .manifest
                    .name
                    .to_lowercase()
                    .cmp(&right.info.manifest.name.to_lowercase())
            })
    });
    plugins
}

fn scan_plugins(
    directory: &Path,
    source: PluginSource,
    states: &HashMap<String, bool>,
    seen: &mut HashSet<String>,
    plugins: &mut Vec<DiscoveredPlugin>,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let root = entry.path();
        if !root.is_dir() {
            continue;
        }
        let Some(manifest) = read_manifest(&root) else {
            continue;
        };
        if entry.file_name().to_string_lossy() != manifest.id {
            tracing::warn!(
                "plugin dir {} does not match manifest id {}",
                root.display(),
                manifest.id
            );
            continue;
        }
        if !seen.insert(manifest.id.clone()) {
            tracing::warn!("ignoring duplicate plugin id {}", manifest.id);
            continue;
        }
        let enabled = states
            .get(&manifest.id)
            .copied()
            .unwrap_or(source == PluginSource::Core && manifest.default_enabled);
        plugins.push(DiscoveredPlugin {
            info: PluginInfo {
                manifest,
                source,
                enabled,
                user_managed: source == PluginSource::Community,
            },
            root,
        });
    }
}

fn find_plugin(directory: &Path, source: PluginSource, id: &str) -> Option<DiscoveredPlugin> {
    if !valid_plugin_id(id) {
        return None;
    }
    let root = directory.join(id);
    let manifest = read_manifest(&root)?;
    (manifest.id == id).then_some(DiscoveredPlugin {
        info: PluginInfo {
            enabled: source == PluginSource::Core && manifest.default_enabled,
            user_managed: source == PluginSource::Community,
            source,
            manifest,
        },
        root,
    })
}

fn read_manifest(root: &Path) -> Option<PluginManifest> {
    let manifest_path = root.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path).ok()?;
    let manifest = serde_json::from_str::<PluginManifest>(&raw)
        .map_err(|error| {
            tracing::warn!(
                "invalid plugin manifest {}: {error}",
                manifest_path.display()
            )
        })
        .ok()?;
    if validate_manifest(&manifest).is_err() || !root.join(&manifest.entry).is_file() {
        tracing::warn!("invalid plugin contents: {}", root.display());
        return None;
    }
    Some(manifest)
}

fn validate_manifest(manifest: &PluginManifest) -> ApiResult<()> {
    if !valid_plugin_id(&manifest.id) {
        return Err(bad_request("manifest contains an invalid plugin id"));
    }
    if manifest.name.trim().is_empty() {
        return Err(bad_request("manifest name cannot be empty"));
    }
    Version::parse(&manifest.version)
        .map_err(|_| bad_request("manifest version must be valid semver"))?;
    if manifest.api_version == 0 || manifest.api_version > CURRENT_API_VERSION {
        return Err(bad_request("manifest requires an unsupported API version"));
    }
    if manifest.categories.iter().any(|category| !valid_category(category)) {
        return Err(bad_request("manifest contains an invalid category"));
    }
    if !safe_relative_path(Path::new(&manifest.entry)) {
        return Err(bad_request("manifest entry must be a relative path"));
    }
    Ok(())
}

fn validate_store_plugin(plugin: &StorePlugin) -> ApiResult<()> {
    if !valid_plugin_id(&plugin.id) || plugin.name.trim().is_empty() {
        return Err(bad_request("registry contains invalid plugin metadata"));
    }
    Version::parse(&plugin.version)
        .map_err(|_| bad_request("registry plugin version must be valid semver"))?;
    if plugin.api_version == 0 {
        return Err(bad_request("registry plugin API version must be positive"));
    }
    if plugin.categories.iter().any(|category| !valid_category(category)) {
        return Err(bad_request("registry plugin contains an invalid category"));
    }
    Ok(())
}

fn valid_plugin_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_category(category: &str) -> bool {
    !category.is_empty()
        && category.len() <= 32
        && category.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
        })
}

fn safe_relative_path(path: &Path) -> bool {
    path.components().next().is_some()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn source_rank(source: PluginSource) -> u8 {
    match source {
        PluginSource::Core => 0,
        PluginSource::Community => 1,
    }
}

fn is_newer(candidate: &str, installed: &str) -> bool {
    match (Version::parse(candidate), Version::parse(installed)) {
        (Ok(candidate), Ok(installed)) => candidate > installed,
        _ => false,
    }
}

async fn plugin_states(state: &AppState) -> HashMap<String, bool> {
    if let Some(states) = settings::read_value(state, STATES_KEY).await {
        return serde_json::from_value(states).unwrap_or_default();
    }
    settings::read_value(state, LEGACY_ENABLED_KEY)
        .await
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|id| (id, true))
        .collect()
}

async fn save_plugin_states(state: &AppState, states: &HashMap<String, bool>) -> ApiResult<()> {
    let value = serde_json::to_string(states)
        .map_err(|error| internal_error(format!("could not encode plugin settings: {error}")))?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(STATES_KEY)
    .bind(value)
    .execute(&state.db)
    .await
    .map_err(|error| internal_error(format!("could not save plugin settings: {error}")))?;
    Ok(())
}

async fn fetch_registry(registry_url: &str) -> ApiResult<StoreRegistry> {
    if registry_url.trim().is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "plugin registry is disabled".into(),
        ));
    }
    if let Some(path) = registry_url.strip_prefix("file://") {
        let raw = tokio::fs::read_to_string(path)
            .await
            .map_err(|error| upstream_error(format!("could not read plugin registry: {error}")))?;
        return serde_json::from_str(&raw)
            .map_err(|error| upstream_error(format!("plugin registry is invalid: {error}")));
    }

    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| internal_error(format!("could not create HTTP client: {error}")))?
        .get(registry_url)
        .send()
        .await
        .map_err(|error| upstream_error(format!("could not fetch plugin registry: {error}")))?
        .error_for_status()
        .map_err(|error| upstream_error(format!("plugin registry returned an error: {error}")))?
        .json::<StoreRegistry>()
        .await
        .map_err(|error| upstream_error(format!("plugin registry is invalid: {error}")))
}

async fn download_package(package: &RegistryPackage) -> ApiResult<Vec<u8>> {
    let bytes = if let Some(path) = package.url.strip_prefix("file://") {
        tokio::fs::read(path)
            .await
            .map_err(|error| upstream_error(format!("could not read plugin package: {error}")))?
    } else {
        let mut response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|error| internal_error(format!("could not create HTTP client: {error}")))?
            .get(&package.url)
            .send()
            .await
            .map_err(|error| upstream_error(format!("could not download plugin: {error}")))?
            .error_for_status()
            .map_err(|error| {
                upstream_error(format!("plugin download returned an error: {error}"))
            })?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PACKAGE_BYTES as u64)
        {
            return Err(bad_request("plugin package exceeds the 20 MiB limit"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| upstream_error(format!("plugin download failed: {error}")))?
        {
            if bytes.len() + chunk.len() > MAX_PACKAGE_BYTES {
                return Err(bad_request("plugin package exceeds the 20 MiB limit"));
            }
            bytes.extend_from_slice(&chunk);
        }
        bytes
    };

    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(bad_request("plugin package exceeds the 20 MiB limit"));
    }
    if package.size.is_some_and(|size| size != bytes.len() as u64) {
        return Err(bad_request(
            "plugin package size does not match the registry",
        ));
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if package.sha256.len() != 64
        || !package
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || actual != package.sha256.to_ascii_lowercase()
    {
        return Err(bad_request(
            "plugin package checksum does not match the registry",
        ));
    }
    Ok(bytes)
}

fn install_package(
    plugins_dir: &Path,
    expected: &StorePlugin,
    bytes: &[u8],
) -> ApiResult<PluginManifest> {
    fs::create_dir_all(plugins_dir)
        .map_err(|error| internal_error(format!("could not create plugins directory: {error}")))?;
    let staging = plugins_dir.join(format!(".install-{}", Uuid::new_v4()));
    fs::create_dir(&staging)
        .map_err(|error| internal_error(format!("could not create install directory: {error}")))?;

    let result = (|| {
        let decoder = GzDecoder::new(bytes);
        let mut archive = Archive::new(decoder);
        let mut files = HashSet::new();
        let mut total_size = 0_u64;

        for entry in archive
            .entries()
            .map_err(|error| bad_request(format!("invalid plugin package: {error}")))?
        {
            let mut entry =
                entry.map_err(|error| bad_request(format!("invalid plugin entry: {error}")))?;
            let path = entry
                .path()
                .map_err(|error| bad_request(format!("invalid plugin path: {error}")))?
                .into_owned();
            if !safe_relative_path(&path) {
                return Err(bad_request("plugin package contains an unsafe path"));
            }
            let destination = staging.join(&path);
            if entry.header().entry_type().is_dir() {
                fs::create_dir_all(&destination).map_err(|error| {
                    internal_error(format!("could not create plugin directory: {error}"))
                })?;
                continue;
            }
            if !entry.header().entry_type().is_file() {
                return Err(bad_request(
                    "plugin packages may contain regular files only",
                ));
            }
            if files.len() >= MAX_PACKAGE_FILES || !files.insert(path) {
                return Err(bad_request(
                    "plugin package has too many or duplicate files",
                ));
            }
            total_size = total_size.saturating_add(entry.size());
            if total_size > MAX_UNPACKED_BYTES {
                return Err(bad_request(
                    "plugin package exceeds the 100 MiB unpacked limit",
                ));
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    internal_error(format!("could not create plugin directory: {error}"))
                })?;
            }
            entry
                .unpack(&destination)
                .map_err(|error| bad_request(format!("could not unpack plugin: {error}")))?;
        }

        let manifest_path = staging.join("manifest.json");
        let manifest = serde_json::from_str::<PluginManifest>(
            &fs::read_to_string(&manifest_path)
                .map_err(|_| bad_request("plugin package is missing manifest.json"))?,
        )
        .map_err(|error| bad_request(format!("plugin manifest is invalid: {error}")))?;
        validate_manifest(&manifest)?;
        if manifest.id != expected.id
            || manifest.name != expected.name
            || manifest.version != expected.version
            || manifest.api_version != expected.api_version
            || manifest.categories != expected.categories
        {
            return Err(bad_request(
                "plugin manifest does not match the registry metadata",
            ));
        }
        if !staging.join(&manifest.entry).is_file() {
            return Err(bad_request("plugin package is missing its entry module"));
        }

        let target = plugins_dir.join(&expected.id);
        let backup = plugins_dir.join(format!(".backup-{}-{}", expected.id, Uuid::new_v4()));
        if target.exists() {
            fs::rename(&target, &backup).map_err(|error| {
                internal_error(format!("could not stage plugin update: {error}"))
            })?;
        }
        if let Err(error) = fs::rename(&staging, &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(internal_error(format!(
                "could not activate plugin: {error}"
            )));
        }
        if backup.exists() {
            let _ = fs::remove_dir_all(backup);
        }
        Ok(manifest)
    })();

    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}

fn bad_request(message: impl Into<String>) -> ApiError {
    (StatusCode::BAD_REQUEST, message.into())
}

fn internal_error(message: impl Into<String>) -> ApiError {
    tracing::error!("{}", message.into());
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal plugin error".into(),
    )
}

fn upstream_error(message: impl Into<String>) -> ApiError {
    (StatusCode::BAD_GATEWAY, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_plugin(root: &Path, id: &str, name: &str, default_enabled: bool) {
        let directory = root.join(id);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("main.js"), "export default { onload() {} };").unwrap();
        fs::write(
            directory.join("manifest.json"),
            serde_json::json!({
                "id": id,
                "name": name,
                "version": "1.0.0",
                "entry": "main.js",
                "defaultEnabled": default_enabled
            })
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn core_plugins_are_default_enabled_and_shadow_community_plugins() {
        let temp = tempfile::tempdir().unwrap();
        let core = temp.path().join("core");
        let community = temp.path().join("community");
        write_plugin(&core, "shared", "Core shared", true);
        write_plugin(&community, "shared", "Community shared", false);
        write_plugin(&community, "extra", "Extra", false);

        let plugins = discover_plugins(&core, &community, &HashMap::new());
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0].info.manifest.name, "Core shared");
        assert!(plugins[0].info.enabled);
        assert_eq!(plugins[1].info.source, PluginSource::Community);
        assert!(!plugins[1].info.enabled);
    }

    #[test]
    fn explicit_state_overrides_core_default() {
        let temp = tempfile::tempdir().unwrap();
        let core = temp.path().join("core");
        write_plugin(&core, "word-count", "Word count", true);
        let states = HashMap::from([("word-count".to_string(), false)]);

        let plugins = discover_plugins(&core, &temp.path().join("community"), &states);
        assert!(!plugins[0].info.enabled);
    }

    #[test]
    fn rejects_unsafe_asset_paths_and_invalid_ids() {
        assert!(safe_relative_path(Path::new("assets/icon.svg")));
        assert!(!safe_relative_path(Path::new("../secret")));
        assert!(!safe_relative_path(Path::new("/etc/passwd")));
        assert!(valid_plugin_id("reading-time"));
        assert!(!valid_plugin_id("Reading_Time"));
    }

    #[test]
    fn compares_versions_as_semver() {
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("not-semver", "1.0.0"));
    }
}
