use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const VERSION_FEED_URL: &str = "https://files.vericonomy.com/vrm/VERSION_VRM.json";

const BUNDLED_MANIFEST_JSON: &str = include_str!("../../src/lib/releases-manifest.json");

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub update_available: bool,
    pub source: UpdateSource,
    pub download_url: Option<String>,
    pub release_notes_url: Option<String>,
    pub cdn_version: Option<String>,
    pub manifest_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateSource {
    Cdn,
    Manifest,
    None,
}

#[derive(Debug, Deserialize)]
struct VersionFeed {
    version: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestRoot {
    latest: ManifestEntry,
}

#[derive(Debug, Deserialize)]
struct ManifestEntry {
    version: String,
    #[serde(default)]
    notes_url: Option<String>,
    #[serde(default)]
    downloads: ManifestDownloads,
}

#[derive(Debug, Default, Deserialize)]
struct ManifestDownloads {
    #[serde(default)]
    windows_x64_setup: Option<String>,
    #[serde(default)]
    windows_x64_zip: Option<String>,
    #[serde(default)]
    macos: Option<String>,
    #[serde(default)]
    macos_intel: Option<String>,
    #[serde(default)]
    macos_apple_silicon: Option<String>,
    #[serde(default)]
    linux_x64: Option<String>,
    #[serde(default)]
    linux_arm64: Option<String>,
}

fn platform_download_url(d: &ManifestDownloads) -> Option<String> {
    if cfg!(target_os = "windows") {
        d.windows_x64_setup
            .clone()
            .or_else(|| d.windows_x64_zip.clone())
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            d.macos_apple_silicon
                .clone()
                .or_else(|| d.macos.clone())
        } else {
            d.macos_intel.clone().or_else(|| d.macos.clone())
        }
    } else if cfg!(target_arch = "aarch64") {
        d.linux_arm64.clone().or_else(|| d.linux_x64.clone())
    } else {
        d.linux_x64.clone()
    }
}

pub async fn check_for_updates(current_version: &str) -> AppResult<UpdateInfo> {
    let cdn = fetch_cdn_version().await.ok();
    let manifest = parse_bundled_manifest().ok();

    let cdn_version = cdn.clone();
    let manifest_version = manifest.as_ref().map(|m| m.latest.version.clone());

    // Prefer the higher of the two versions so we don't show stale data
    // when the CDN feed lags behind the curated manifest.
    let (latest, source, download_url, release_notes_url) =
        match (cdn_version.as_deref(), manifest.as_ref()) {
            (Some(c), Some(m)) => {
                if is_newer(&m.latest.version, c) {
                    (
                        Some(m.latest.version.clone()),
                        UpdateSource::Manifest,
                        platform_download_url(&m.latest.downloads),
                        m.latest.notes_url.clone(),
                    )
                } else {
                    (
                        Some(c.to_string()),
                        UpdateSource::Cdn,
                        None,
                        None,
                    )
                }
            }
            (Some(c), None) => (Some(c.to_string()), UpdateSource::Cdn, None, None),
            (None, Some(m)) => (
                Some(m.latest.version.clone()),
                UpdateSource::Manifest,
                platform_download_url(&m.latest.downloads),
                m.latest.notes_url.clone(),
            ),
            (None, None) => (None, UpdateSource::None, None, None),
        };

    let update_available = match latest.as_deref() {
        Some(v) => is_newer(v, current_version),
        None => false,
    };

    Ok(UpdateInfo {
        current: current_version.to_string(),
        latest,
        update_available,
        source,
        download_url,
        release_notes_url,
        cdn_version,
        manifest_version,
    })
}

async fn fetch_cdn_version() -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;
    let resp = client.get(VERSION_FEED_URL).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::other(format!(
            "version feed returned http {}",
            resp.status()
        )));
    }
    let feed: VersionFeed = resp.json().await?;
    feed.version
        .or(feed.title)
        .ok_or_else(|| AppError::other("version feed missing version"))
}

fn parse_bundled_manifest() -> AppResult<ManifestRoot> {
    serde_json::from_str::<ManifestRoot>(BUNDLED_MANIFEST_JSON)
        .map_err(|e| AppError::other(format!("invalid bundled manifest: {e}")))
}

fn is_newer(remote: &str, current: &str) -> bool {
    fn parse(v: &str) -> Vec<u32> {
        v.split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect()
    }
    let a = parse(remote);
    let b = parse(current);
    let len = a.len().max(b.len());
    for i in 0..len {
        let ai = a.get(i).copied().unwrap_or(0);
        let bi = b.get(i).copied().unwrap_or(0);
        if ai != bi {
            return ai > bi;
        }
    }
    false
}
