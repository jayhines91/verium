use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;
use zip::read::ZipArchive;

use crate::daemon::detect_binary;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::wsl::{
    is_wsl_unc_path, unc_to_linux_path, windows_path_to_wsl_mnt, wsl_restart_hint,
    restart_wsl_veriumd_datadir, wsl_stop_veriumd_force_datadir, wsl_python_for_datadir_path,
    wsl_clear_debug_log_datadir, DEFAULT_WSL_REPO_ROOT,
};

const BOOTSTRAP_BASE: &str = "https://files.vericonomy.com/vrm/bootstrap/";
const BOOTSTRAP_CANONICAL: &str =
    "https://files.vericonomy.com/vrm/bootstrap/verium-bootstrap.zip";
const USER_AGENT: &str = "Verium-Desktop/0.1";
const ZIP_LOCAL_MAGIC: [u8; 4] = [0x50, 0x4B, 0x03, 0x04];

#[derive(Debug, Clone, Serialize)]
pub struct BootstrapResult {
    pub success: bool,
    pub message: String,
    pub restart_hint: Option<String>,
}

/// Download the official chain snapshot, extract it into the configured datadir,
/// and restart (or return a WSL restart command when veriumd runs under Linux).
pub async fn import_bootstrap(state: &AppState) -> AppResult<BootstrapResult> {
    let cfg = state.config_fresh().await?;
    let datadir = cfg.datadir.clone();

    stop_daemon_for_bootstrap(state, &datadir).await;

    // Remove any stale/corrupt zip left from earlier attempts (e.g. daemon 404 HTML).
    let stale_zip = datadir.join("bootstrap_VRM.zip");
    if stale_zip.is_file() {
        let _ = std::fs::remove_file(&stale_zip);
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60 * 60))
        .build()?;

    let url = resolve_bootstrap_url(&client).await?;
    tracing::info!("bootstrap: downloading from {url}");

    let temp_zip = temp_bootstrap_path();
    download_bootstrap_zip(&client, &url, &temp_zip).await?;
    validate_zip_download(&temp_zip)?;

    if is_wsl_unc_path(&datadir) {
        extract_and_apply_bootstrap_wsl(&temp_zip, &datadir)?;
    } else {
        extract_bootstrap_zip(&temp_zip, &datadir)?;
        apply_bootstrap(&datadir)?;
    }

    let _ = std::fs::remove_file(&temp_zip);

    finish_restart(state, &cfg).await
}

fn temp_bootstrap_path() -> PathBuf {
    std::env::temp_dir().join(format!("verium-bootstrap-{}.zip", Uuid::new_v4()))
}

async fn stop_daemon_for_bootstrap(state: &AppState, datadir: &Path) {
    if is_wsl_unc_path(datadir) {
        wsl_stop_veriumd_force_datadir(datadir);
        tokio::time::sleep(Duration::from_secs(3)).await;
        return;
    }
    let _ = stop_daemon_gracefully(state).await;
}

async fn stop_daemon_gracefully(state: &AppState) -> AppResult<()> {
    if let Ok(client) = state.rpc_client().await {
        let _ = client.call_no_result("stop", json!([])).await;
        tokio::time::sleep(Duration::from_secs(4)).await;
    }
    Ok(())
}

async fn resolve_bootstrap_url(client: &reqwest::Client) -> AppResult<String> {
    let mut candidates = vec![BOOTSTRAP_CANONICAL.to_string()];

    let today = Utc::now().date_naive();
    for days_back in 0..14 {
        let date = today - ChronoDuration::days(days_back);
        candidates.push(format!("{BOOTSTRAP_BASE}verium-bootstrap-{date}.zip"));
    }

    for url in candidates {
        if url_available(client, &url).await? {
            return Ok(url);
        }
    }

    Err(AppError::other(
        "No bootstrap archive found on files.vericonomy.com (tried canonical and recent dated zips).",
    ))
}

async fn url_available(client: &reqwest::Client, url: &str) -> AppResult<bool> {
    let resp = client.head(url).send().await?;
    Ok(resp.status().is_success())
}

async fn download_bootstrap_zip(
    client: &reqwest::Client,
    url: &str,
    target: &Path,
) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::other(format!(
            "Download failed: server responded with HTTP {}",
            resp.status()
        )));
    }

    let expected_len = resp.content_length();

    let mut file = std::fs::File::create(target)?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if downloaded.is_multiple_of(50 * 1024 * 1024) {
            tracing::info!("bootstrap: downloaded {} MB", downloaded / (1024 * 1024));
        }
    }
    file.sync_all()?;

    if let Some(expected) = expected_len {
        if downloaded != expected {
            let _ = std::fs::remove_file(target);
            return Err(AppError::other(format!(
                "Download incomplete: expected {expected} bytes, got {downloaded}"
            )));
        }
    }

    tracing::info!(
        "bootstrap: saved {} bytes to {}",
        downloaded,
        target.display()
    );
    Ok(())
}

fn validate_zip_download(path: &Path) -> AppResult<()> {
    let mut file = std::fs::File::open(path)?;
    let mut header = [0u8; 4];
    file.read_exact(&mut header)?;
    if header != ZIP_LOCAL_MAGIC {
        let preview = String::from_utf8_lossy(&header);
        let _ = std::fs::remove_file(path);
        return Err(AppError::other(format!(
            "Download is not a valid zip archive (header {preview:?}). \
             The CDN may have returned an error page — try again in a minute."
        )));
    }
    Ok(())
}

/// Extract and apply inside WSL via python3 (avoids corrupting large zips on UNC paths).
fn extract_and_apply_bootstrap_wsl(temp_zip: &Path, unc_datadir: &Path) -> AppResult<()> {
    let linux_datadir = unc_to_linux_path(&unc_datadir.to_string_lossy());
    let wsl_zip = windows_path_to_wsl_mnt(temp_zip)?;

    let script = r#"
import os
import shutil
import sys
import zipfile

zip_path, datadir = sys.argv[1], sys.argv[2]
staging = os.path.join(datadir, "bootstrap")

for name in ("bootstrap", "blocks", "chainstate"):
    path = os.path.join(datadir, name)
    if os.path.isdir(path):
        shutil.rmtree(path)

os.makedirs(staging, exist_ok=True)

with zipfile.ZipFile(zip_path) as zf:
    names = [n for n in zf.namelist() if n]
    first = names[0] if names else ""
    if first.startswith("blocks/") or first == "blocks":
        zf.extractall(staging)
    elif any(n.startswith("bootstrap/") for n in names):
        zf.extractall(datadir)
        staging = os.path.join(datadir, "bootstrap")
    else:
        zf.extractall(staging)

blocks = os.path.join(staging, "blocks")
chainstate = os.path.join(staging, "chainstate")
if not (os.path.isdir(blocks) and os.path.isdir(chainstate)):
    raise SystemExit("bootstrap zip missing blocks/ and chainstate/")

shutil.move(blocks, os.path.join(datadir, "blocks"))
shutil.move(chainstate, os.path.join(datadir, "chainstate"))
shutil.rmtree(staging, ignore_errors=True)
"#;

    tracing::info!(
        "bootstrap: extracting via WSL python3 into {linux_datadir}"
    );

    let output = wsl_python_for_datadir_path(unc_datadir, script, &[&wsl_zip, &linux_datadir])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(AppError::other(format!(
            "WSL bootstrap extract failed: {stderr}{stdout}"
        )));
    }

    tracing::info!("bootstrap: applied new chain data under {linux_datadir}");
    Ok(())
}

fn extract_bootstrap_zip(zip_path: &Path, datadir: &Path) -> AppResult<()> {
    let staging = datadir.join("bootstrap");
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    std::fs::create_dir_all(&staging)?;

    let file = std::fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::other(format!("invalid zip: {e}")))?;

    let first_name = (0..archive.len())
        .find_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()));

    let top_level_blocks = first_name
        .as_deref()
        .is_some_and(|n| n.starts_with("blocks/") || n == "blocks");

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::other(format!("zip entry {i}: {e}")))?;
        let raw_name = entry.name().to_string();
        if raw_name.ends_with('/') {
            continue;
        }

        let relative = if top_level_blocks {
            PathBuf::from(&raw_name)
        } else if let Some(stripped) = raw_name.strip_prefix("bootstrap/") {
            PathBuf::from(stripped)
        } else {
            PathBuf::from(&raw_name)
        };

        let out_path = staging.join(relative);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }

        let mut out = std::fs::File::create(&out_path)?;
        std::io::copy(&mut entry, &mut out)?;
    }

    tracing::info!("bootstrap: extracted archive into {}", staging.display());
    Ok(())
}

fn validate_bootstrap_content(staging: &Path) -> AppResult<()> {
    if !staging.join("blocks").is_dir() || !staging.join("chainstate").is_dir() {
        return Err(AppError::other(
            "Downloaded bootstrap zip did not contain blocks/ and chainstate/ directories.",
        ));
    }
    Ok(())
}

fn apply_bootstrap(datadir: &Path) -> AppResult<()> {
    let staging = datadir.join("bootstrap");
    validate_bootstrap_content(&staging)?;

    for name in ["blocks", "chainstate"] {
        let target = datadir.join(name);
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        std::fs::rename(staging.join(name), &target)?;
    }

    let _ = std::fs::remove_dir_all(&staging);

    tracing::info!("bootstrap: applied new chain data under {}", datadir.display());
    Ok(())
}

async fn finish_restart(
    state: &AppState,
    cfg: &crate::config::DaemonConfig,
) -> AppResult<BootstrapResult> {
    state.daemon().record_pid(None).await;
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let wsl_datadir = is_wsl_unc_path(&cfg.datadir);
    let binary_found = detect_binary().found;

    if wsl_datadir {
        let _ = wsl_clear_debug_log_datadir(&cfg.datadir);
        let linux_datadir = unc_to_linux_path(&cfg.datadir.to_string_lossy());
        match restart_wsl_veriumd_datadir(&cfg.datadir, DEFAULT_WSL_REPO_ROOT) {
            Ok(()) => {
                tokio::time::sleep(Duration::from_secs(8)).await;
                return Ok(BootstrapResult {
                    success: true,
                    message:
                        "Bootstrap applied. veriumd was restarted and is loading the new chain."
                            .to_string(),
                    restart_hint: None,
                });
            }
            Err(e) => {
                let hint = wsl_restart_hint(&linux_datadir, DEFAULT_WSL_REPO_ROOT);
                return Ok(BootstrapResult {
                    success: true,
                    message: format!(
                        "Bootstrap applied, but automatic restart failed: {e}. Try Restart WSL veriumd in Settings."
                    ),
                    restart_hint: Some(hint),
                });
            }
        }
    }

    if binary_found {
        match state.daemon().start(cfg).await {
            Ok(_) => {
                return Ok(BootstrapResult {
                    success: true,
                    message: "Bootstrap applied and veriumd was restarted.".to_string(),
                    restart_hint: None,
                });
            }
            Err(e) => {
                return Ok(BootstrapResult {
                    success: true,
                    message: format!(
                        "Bootstrap applied, but automatic restart failed: {e}. Start veriumd manually."
                    ),
                    restart_hint: None,
                });
            }
        }
    }

    Ok(BootstrapResult {
        success: true,
        message: "Bootstrap applied. Start veriumd manually to continue.".to_string(),
        restart_hint: None,
    })
}
