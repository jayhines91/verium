use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use zip::read::ZipArchive;

use crate::coin_profile::CoinId;
use crate::config::{
    bootstrap_chain_datadir, chain_snapshot_needs_reindex, ensure_daemon_conf_complete,
    migrate_legacy_root_chain_data, promote_subdir_chain_data_for_legacy,
    recover_split_chain_layout, validate_bootstrap_staging,
};
use crate::daemon::{
    binary_supports_unified_chain_selector, detect_binary, force_stop_native_daemon,
    free_rpc_port, wait_for_native_daemon_exit, wait_for_rpc_port_free,
};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, BOOTSTRAP_LOADING_GRACE};

const USER_AGENT: &str = "Vericonomy-Desktop/0.1";
const ZIP_LOCAL_MAGIC: [u8; 4] = [0x50, 0x4B, 0x03, 0x04];
const PROGRESS_EVENT: &str = "bootstrap-progress";
pub const BOOTSTRAP_CANCELLED: &str = "Bootstrap cancelled by user.";

const MIN_BOOTSTRAP_BYTES: u64 = 1_000_000;
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(180);

const STOP_END: f64 = 5.0;
const RESOLVE_END: f64 = 7.0;
const DOWNLOAD_END: f64 = 67.0;
const VALIDATE_END: f64 = 70.0;
const EXTRACT_END: f64 = 95.0;
const APPLY_END: f64 = 98.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapProgress {
    pub coin: String,
    pub phase: String,
    pub percent: f64,
    pub phase_percent: Option<f64>,
    pub message: String,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub extracted_files: Option<u64>,
    pub total_files: Option<u64>,
    pub source_url: Option<String>,
    pub eta_seconds: Option<u64>,
    pub cancellable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BootstrapResult {
    pub success: bool,
    pub message: String,
    pub restart_hint: Option<String>,
}

struct PhaseRateTracker {
    started: Instant,
    smoothed_rate: f64,
}

impl PhaseRateTracker {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            smoothed_rate: 0.0,
        }
    }

    fn eta_seconds(&mut self, completed: u64, total: Option<u64>, min_elapsed_secs: f64) -> Option<u64> {
        let Some(total) = total.filter(|t| *t > completed) else {
            return None;
        };
        let elapsed = self.started.elapsed().as_secs_f64();
        if elapsed < min_elapsed_secs || completed == 0 {
            return None;
        }

        let instant_rate = completed as f64 / elapsed;
        self.smoothed_rate = if self.smoothed_rate <= 0.0 {
            instant_rate
        } else {
            self.smoothed_rate * 0.85 + instant_rate * 0.15
        };

        if self.smoothed_rate < 1.0 {
            return None;
        }

        let remaining = (total - completed) as f64;
        Some((remaining / self.smoothed_rate).ceil().max(1.0) as u64)
    }
}

fn is_cancellable_phase(phase: &str) -> bool {
    matches!(phase, "stopping" | "resolving" | "downloading")
}

pub fn is_bootstrap_cancelled(err: &AppError) -> bool {
    matches!(err, AppError::Other(msg) if msg.as_str() == BOOTSTRAP_CANCELLED)
}

pub fn cancel_bootstrap(state: &AppState, coin: CoinId) {
    state.bootstrap_request_cancel(coin);
}

struct BootstrapReporter {
    app: AppHandle,
    coin: CoinId,
    last_emit: Instant,
}

impl BootstrapReporter {
    fn new(app: AppHandle, coin: CoinId) -> Self {
        Self {
            app,
            coin,
            last_emit: Instant::now() - Duration::from_secs(1),
        }
    }

    fn lerp(start: f64, end: f64, phase_percent: f64) -> f64 {
        start + (end - start) * (phase_percent / 100.0).clamp(0.0, 1.0)
    }

    fn emit(&mut self, payload: BootstrapProgress, force: bool) {
        let now = Instant::now();
        if !force && now.duration_since(self.last_emit) < Duration::from_millis(200) {
            return;
        }
        self.last_emit = now;
        let _ = self.app.emit(PROGRESS_EVENT, payload);
    }

    fn emit_phase(
        &mut self,
        phase: &str,
        percent: f64,
        phase_percent: Option<f64>,
        message: impl Into<String>,
        eta_seconds: Option<u64>,
        force: bool,
    ) {
        self.emit(
            BootstrapProgress {
                coin: self.coin.as_str().to_string(),
                phase: phase.into(),
                percent: percent.clamp(0.0, 100.0),
                phase_percent,
                message: message.into(),
                downloaded_bytes: None,
                total_bytes: None,
                extracted_files: None,
                total_files: None,
                source_url: None,
                eta_seconds,
                cancellable: is_cancellable_phase(phase),
            },
            force,
        );
    }

    fn stopping(&mut self, binary_name: &str) {
        self.emit_phase(
            "stopping",
            STOP_END * 0.5,
            Some(50.0),
            format!("Stopping {binary_name} before replacing chain data…"),
            None,
            true,
        );
    }

    fn resolving(&mut self) {
        self.emit_phase(
            "resolving",
            Self::lerp(STOP_END, RESOLVE_END, 50.0),
            Some(50.0),
            format!(
                "Finding the latest {} bootstrap on files.vericonomy.com…",
                self.coin.display_name()
            ),
            None,
            true,
        );
    }

    fn resolved(&mut self, url: &str) {
        self.emit(
            BootstrapProgress {
                coin: self.coin.as_str().to_string(),
                phase: "resolving".into(),
                percent: RESOLVE_END,
                phase_percent: Some(100.0),
                message: format!("Using bootstrap archive: {url}"),
                downloaded_bytes: None,
                total_bytes: None,
                extracted_files: None,
                total_files: None,
                source_url: Some(url.to_string()),
                eta_seconds: None,
                cancellable: true,
            },
            true,
        );
    }

    fn using_local(&mut self, path: &Path) {
        self.emit(
            BootstrapProgress {
                coin: self.coin.as_str().to_string(),
                phase: "local".into(),
                percent: RESOLVE_END,
                phase_percent: Some(100.0),
                message: format!("Using local bootstrap archive: {}", path.display()),
                downloaded_bytes: None,
                total_bytes: std::fs::metadata(path).ok().map(|m| m.len()),
                extracted_files: None,
                total_files: None,
                source_url: None,
                eta_seconds: None,
                cancellable: false,
            },
            true,
        );
    }

    fn downloading(
        &mut self,
        downloaded: u64,
        total: Option<u64>,
        source_url: Option<&str>,
        eta_seconds: Option<u64>,
        force: bool,
    ) {
        let phase_percent = total.map(|t| {
            if t == 0 {
                0.0
            } else {
                (downloaded as f64 / t as f64) * 100.0
            }
        });
        let overall = phase_percent
            .map(|p| Self::lerp(RESOLVE_END, DOWNLOAD_END, p))
            .unwrap_or(Self::lerp(RESOLVE_END, DOWNLOAD_END, 0.0));

        let message = match total {
            Some(total) if total > 0 => format!(
                "Downloading chain snapshot… {} of {}",
                format_bytes(downloaded),
                format_bytes(total)
            ),
            _ => format!(
                "Downloading chain snapshot… {} received",
                format_bytes(downloaded)
            ),
        };

        self.emit(
            BootstrapProgress {
                coin: self.coin.as_str().to_string(),
                phase: "downloading".into(),
                percent: overall,
                phase_percent,
                message,
                downloaded_bytes: Some(downloaded),
                total_bytes: total,
                extracted_files: None,
                total_files: None,
                source_url: source_url.map(str::to_string),
                eta_seconds,
                cancellable: true,
            },
            force,
        );
    }

    fn validating(&mut self) {
        self.emit_phase(
            "validating",
            Self::lerp(DOWNLOAD_END, VALIDATE_END, 50.0),
            Some(50.0),
            "Validating downloaded archive…",
            None,
            true,
        );
    }

    fn extracting(
        &mut self,
        extracted: u64,
        total: Option<u64>,
        indeterminate: bool,
        eta_seconds: Option<u64>,
        force: bool,
    ) {
        let phase_percent = if indeterminate {
            None
        } else {
            total.map(|t| {
                if t == 0 {
                    0.0
                } else {
                    (extracted as f64 / t as f64) * 100.0
                }
            })
        };
        let overall = phase_percent
            .map(|p| Self::lerp(VALIDATE_END, EXTRACT_END, p))
            .unwrap_or(Self::lerp(VALIDATE_END, EXTRACT_END, 35.0));

        let message = match (indeterminate, total) {
            (true, _) => {
                "Extracting blocks and chainstate (this may take several minutes)…".into()
            }
            (_, Some(total)) if total > 0 => format!(
                "Extracting blocks and chainstate… {extracted} / {total} files"
            ),
            _ => format!("Extracting blocks and chainstate… {extracted} files"),
        };

        self.emit(
            BootstrapProgress {
                coin: self.coin.as_str().to_string(),
                phase: "extracting".into(),
                percent: overall,
                phase_percent,
                message,
                downloaded_bytes: None,
                total_bytes: None,
                extracted_files: Some(extracted),
                total_files: total,
                source_url: None,
                eta_seconds,
                cancellable: false,
            },
            force,
        );
    }

    fn applying(&mut self, step: u8) {
        let phase_percent = match step {
            0 => 20.0,
            1 => 60.0,
            _ => 100.0,
        };
        let message: String = match step {
            0 => "Replacing existing blocks/ directory…".into(),
            1 => "Replacing existing chainstate/ directory…".into(),
            _ => "Finalizing chain data in your datadir…".into(),
        };
        self.emit_phase(
            "applying",
            Self::lerp(EXTRACT_END, APPLY_END, phase_percent),
            Some(phase_percent),
            message,
            None,
            true,
        );
    }

    fn restarting(&mut self, binary_name: &str) {
        self.emit_phase(
            "restarting",
            Self::lerp(APPLY_END, 100.0, 50.0),
            Some(50.0),
            format!("Restarting {binary_name} with the new chain data…"),
            None,
            true,
        );
    }

    fn done(&mut self, message: impl Into<String>) {
        self.emit_phase("done", 100.0, Some(100.0), message, None, true);
    }

    fn failed(&mut self, message: impl Into<String>) {
        self.emit_phase("error", 0.0, None, message, None, true);
    }

    fn cancelled(&mut self) {
        self.emit_phase("cancelled", 0.0, None, BOOTSTRAP_CANCELLED, None, true);
    }
}

fn format_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.2} GB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.1} MB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.0} KB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> AppResult<()> {
    if AppState::bootstrap_is_cancelled(cancel) {
        return Err(AppError::other(BOOTSTRAP_CANCELLED));
    }
    Ok(())
}

async fn cancellable_sleep(duration: Duration, cancel: &AtomicBool) -> bool {
    let started = Instant::now();
    while started.elapsed() < duration {
        if AppState::bootstrap_is_cancelled(cancel) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

/// Download the official chain snapshot, extract it into the configured datadir,
/// and restart (or return a WSL restart command when the daemon runs under Linux).
pub async fn import_bootstrap(
    state: &AppState,
    coin: CoinId,
    app: AppHandle,
    local_path: Option<PathBuf>,
) -> AppResult<BootstrapResult> {
    // Binarytest (DACE) has no canonical snapshot — refuse to import the mainnet
    // bootstrap into a binarytest datadir, which would mix incompatible chain
    // state (magic, ports, address prefixes, activation heights all differ).
    let prefs = crate::prefs::load().await.unwrap_or_default();
    if prefs.network_mode.is_test() {
        return Err(AppError::other(
            "Bootstrap import is not available on the Binary Chain (binarytest) network. \
             Switch to Mainnet in Settings to import the official snapshot.",
        ));
    }

    let cancel = state.bootstrap_begin(coin);
    let mut reporter = BootstrapReporter::new(app, coin);
    let result = import_bootstrap_inner(state, coin, &cancel, local_path, &mut reporter).await;
    state.bootstrap_end(coin);
    if let Err(ref e) = result {
        if is_bootstrap_cancelled(e) {
            reporter.cancelled();
        } else {
            reporter.failed(e.to_string());
        }
    }
    result
}

async fn import_bootstrap_inner(
    state: &AppState,
    coin: CoinId,
    cancel: &AtomicBool,
    local_path: Option<PathBuf>,
    reporter: &mut BootstrapReporter,
) -> AppResult<BootstrapResult> {
    let cfg = state.config_fresh(coin).await?;
    let unified_chain = detect_binary(coin)
        .path
        .map(|p| binary_supports_unified_chain_selector(Path::new(&p), coin))
        .unwrap_or(false);
    // Unified builds read …/verium/blocks; legacy v1.x reads …/Verium/blocks at the -datadir root.
    let datadir = bootstrap_chain_datadir(coin, &cfg, unified_chain);
    let binary_name = coin.binary_base();

    reporter.stopping(binary_name);
    stop_daemon_for_bootstrap(state, coin, &cfg.datadir, cancel).await;
    ensure_not_cancelled(cancel)?;

    if unified_chain {
        if recover_split_chain_layout(coin, &cfg)? {
            reporter.applying(0);
        } else if migrate_legacy_root_chain_data(coin, &cfg)? {
            reporter.applying(0);
        }
    } else if promote_subdir_chain_data_for_legacy(coin, &cfg)? {
        reporter.applying(0);
    }

    let stale_zip = datadir.join(format!("bootstrap_{}.zip", coin.symbol()));
    if stale_zip.is_file() {
        let _ = std::fs::remove_file(&stale_zip);
    }

    let (archive_path, temp_download) = resolve_bootstrap_archive(coin, cancel, local_path, reporter).await?;
    validate_zip_download(&archive_path)?;
    reporter.validating();

    extract_bootstrap_zip(&archive_path, &datadir, reporter)?;
    apply_bootstrap(&datadir, reporter)?;
    if unified_chain {
        strip_unified_incompatible_bootstrap_index(&datadir)?;
    }

    if temp_download {
        let _ = std::fs::remove_file(&archive_path);
    }

    let result = finish_restart(state, coin, &cfg, binary_name, reporter).await?;
    reporter.done(&result.message);
    Ok(result)
}

async fn resolve_bootstrap_archive(
    coin: CoinId,
    cancel: &AtomicBool,
    local_path: Option<PathBuf>,
    reporter: &mut BootstrapReporter,
) -> AppResult<(PathBuf, bool)> {
    if let Some(path) = resolve_local_bootstrap(coin, local_path)? {
        reporter.using_local(&path);
        return Ok((path, false));
    }

    let client = build_bootstrap_http_client()?;
    reporter.resolving();
    let url = resolve_bootstrap_url(coin, &client, cancel).await?;
    reporter.resolved(&url);
    tracing::info!("bootstrap ({}): downloading from {url}", coin.as_str());

    let temp_zip = temp_bootstrap_path(coin);
    download_bootstrap_zip(&client, &url, &temp_zip, cancel, reporter).await?;
    Ok((temp_zip, true))
}

fn build_bootstrap_http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(60))
        .read_timeout(DOWNLOAD_READ_TIMEOUT)
        .tcp_keepalive(Duration::from_secs(60))
        .http1_only()
        .build()
        .map_err(Into::into)
}

fn resolve_local_bootstrap(
    coin: CoinId,
    explicit: Option<PathBuf>,
) -> AppResult<Option<PathBuf>> {
    if let Some(path) = explicit {
        if is_valid_bootstrap_zip(&path) {
            return Ok(Some(path));
        }
        return Err(AppError::other(format!(
            "Local bootstrap is missing or not a valid zip archive: {}",
            path.display()
        )));
    }

    for key in local_bootstrap_env_keys(coin) {
        if let Ok(raw) = std::env::var(key) {
            let path = PathBuf::from(raw.trim());
            if is_valid_bootstrap_zip(&path) {
                tracing::info!(
                    "bootstrap ({}): using {}={}",
                    coin.as_str(),
                    key,
                    path.display()
                );
                return Ok(Some(path));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join("Downloads").join(local_bootstrap_filename(coin)),
            home.join("Desktop").join(local_bootstrap_filename(coin)),
        ];
        for path in candidates {
            if is_valid_bootstrap_zip(&path) {
                tracing::info!(
                    "bootstrap ({}): auto-detected local archive at {}",
                    coin.as_str(),
                    path.display()
                );
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn local_bootstrap_env_keys(coin: CoinId) -> &'static [&'static str] {
    match coin {
        CoinId::Verium => &["VERIUM_BOOTSTRAP_LOCAL"],
        CoinId::Vericoin => &["VERICOIN_BOOTSTRAP_LOCAL", "VERICOIND_BOOTSTRAP_LOCAL"],
    }
}

fn local_bootstrap_filename(coin: CoinId) -> String {
    match coin {
        CoinId::Verium => "verium-bootstrap.zip".into(),
        CoinId::Vericoin => "vericoin-bootstrap.zip".into(),
    }
}

fn is_valid_bootstrap_zip(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() < MIN_BOOTSTRAP_BYTES {
        return false;
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut header = [0u8; 4];
    file.read_exact(&mut header).is_ok() && header == ZIP_LOCAL_MAGIC
}

fn temp_bootstrap_path(coin: CoinId) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{}-bootstrap-{}.zip",
        coin.as_str(),
        Uuid::new_v4()
    ))
}

async fn stop_daemon_for_bootstrap(
    state: &AppState,
    coin: CoinId,
    datadir: &Path,
    cancel: &AtomicBool,
) {
    // Stop both daemons so nothing holds files open under AppData during apply.
    for target in CoinId::all() {
        stop_single_daemon_for_bootstrap(state, *target, cancel).await;
    }

    for target in CoinId::all() {
        if let Ok(cfg) = state.config_fresh(*target).await {
            let unified = detect_binary(*target)
                .path
                .map(|p| binary_supports_unified_chain_selector(Path::new(&p), *target))
                .unwrap_or(false);
            clear_datadir_lock_file(&bootstrap_chain_datadir(*target, &cfg, unified));
        }
    }
    cancellable_sleep(Duration::from_secs(1), cancel).await;
}

async fn stop_single_daemon_for_bootstrap(
    state: &AppState,
    coin: CoinId,
    cancel: &AtomicBool,
) {
    let Ok(cfg) = state.config_fresh(coin).await else {
        force_stop_native_daemon(coin);
        return;
    };

    if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("stop", json!([])).await;
    }
    cancellable_sleep(Duration::from_millis(800), cancel).await;

    if let Ok(daemon) = state.daemon(coin) {
        daemon.wait_for_child_exit(Duration::from_secs(5)).await;
        daemon.force_kill_child().await;
        daemon.clear_tracking().await;
    }

    free_rpc_port(coin, &cfg);
    force_stop_native_daemon(coin);
}

fn clear_datadir_lock_file(datadir: &Path) {
    let lock = datadir.join(".lock");
    if lock.is_file() {
        let _ = std::fs::remove_file(&lock);
        tracing::info!("bootstrap: removed stale lock {}", lock.display());
    }
}

fn remove_dir_all_with_retry(path: &Path, label: &str) -> AppResult<()> {
    for attempt in 0..5 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(32) && attempt + 1 < 5 => {
                tracing::warn!(
                    "bootstrap: {label} locked (attempt {}); retrying…",
                    attempt + 1
                );
                force_stop_native_daemon(CoinId::Verium);
                force_stop_native_daemon(CoinId::Vericoin);
                std::thread::sleep(Duration::from_secs(2));
            }
            Err(e) if !path.exists() => return Ok(()),
            Err(e) => {
                return Err(AppError::other(format!(
                    "could not remove {label} at {}: {e}. \
                     Quit the wallet, stop veriumd/vericoind in Task Manager, then retry bootstrap.",
                    path.display()
                )));
            }
        }
    }
    Err(AppError::other(format!(
        "could not remove {label} at {} after several attempts (file in use). \
         Quit the wallet, stop veriumd/vericoind in Task Manager, then retry bootstrap.",
        path.display()
    )))
}

async fn stop_daemon_gracefully(
    state: &AppState,
    coin: CoinId,
    cancel: &AtomicBool,
) -> AppResult<()> {
    if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("stop", json!([])).await;
        cancellable_sleep(Duration::from_secs(4), cancel).await;
    }
    Ok(())
}

async fn resolve_bootstrap_url(
    coin: CoinId,
    client: &reqwest::Client,
    cancel: &AtomicBool,
) -> AppResult<String> {
    let base = coin.bootstrap_cdn_base();
    let archive_name = match coin {
        CoinId::Verium => "verium-bootstrap.zip",
        CoinId::Vericoin => "vericoin-bootstrap.zip",
    };
    let canonical = format!("{base}/{archive_name}");
    let mut candidates = vec![canonical.clone()];

    let today = Utc::now().date_naive();
    let dated_prefix = match coin {
        CoinId::Verium => "verium-bootstrap",
        CoinId::Vericoin => "vericoin-bootstrap",
    };
    for days_back in 0..14 {
        let date = today - ChronoDuration::days(days_back);
        candidates.push(format!("{base}/{dated_prefix}-{date}.zip"));
    }

    for url in candidates {
        if AppState::bootstrap_is_cancelled(cancel) {
            return Err(AppError::other(BOOTSTRAP_CANCELLED));
        }
        if url_available(client, &url).await? {
            return Ok(url);
        }
    }

    Err(AppError::other(format!(
        "No bootstrap archive found on files.vericonomy.com for {} (tried canonical and recent dated zips).",
        coin.display_name()
    )))
}

async fn url_available(client: &reqwest::Client, url: &str) -> AppResult<bool> {
    let probe = client
        .get(url)
        .header("Range", "bytes=0-0")
        .header("Accept-Encoding", "identity")
        .send()
        .await;
    match probe {
        Ok(resp) => Ok(resp.status().is_success() || resp.status().as_u16() == 206),
        Err(e) => {
            tracing::debug!("bootstrap probe failed for {url}: {e}");
            Ok(false)
        }
    }
}

fn map_download_error(url: &str, err: reqwest::Error) -> AppError {
    let detail = err.to_string();
    let hint = if detail.contains("decoding response body") || detail.contains("connection") {
        " The CDN connection dropped during download — use “Choose local zip…” if you already \
         downloaded vericoin-bootstrap.zip, or retry to resume."
    } else {
        ""
    };
    AppError::other(format!("Failed downloading bootstrap from {url}: {detail}.{hint}"))
}

async fn download_bootstrap_zip(
    client: &reqwest::Client,
    url: &str,
    target: &Path,
    cancel: &AtomicBool,
    reporter: &mut BootstrapReporter,
) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut downloaded = if target.is_file() {
        std::fs::metadata(target).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    reporter.downloading(downloaded, None, Some(url), None, true);
    ensure_not_cancelled(cancel)?;

    let mut request = client
        .get(url)
        .header("Accept-Encoding", "identity");
    if downloaded > 0 {
        request = request.header("Range", format!("bytes={downloaded}-"));
        tracing::info!("bootstrap: resuming download at byte {downloaded}");
    }

    let mut resp = request.send().await.map_err(|e| map_download_error(url, e))?;
    let status = resp.status();

    if downloaded > 0 && status == reqwest::StatusCode::OK {
        tracing::warn!("bootstrap: server ignored Range request; restarting download");
        downloaded = 0;
        let _ = std::fs::remove_file(target);
    }

    if !status.is_success() {
        return Err(AppError::other(format!(
            "Download failed: server responded with HTTP {status} for {url}"
        )));
    }

    let expected_len = if status.as_u16() == 206 {
        resp.content_length().map(|n| downloaded + n)
    } else {
        resp.content_length()
    };

    let mut rate = PhaseRateTracker::new();
    let mut file = if downloaded == 0 {
        std::fs::File::create(target)?
    } else {
        OpenOptions::new().append(true).open(target)?
    };
    let mut last_logged_mb = downloaded / (1024 * 1024);

    while let Some(chunk) = resp.chunk().await.map_err(|e| map_download_error(url, e))? {
        if AppState::bootstrap_is_cancelled(cancel) {
            drop(file);
            return Err(AppError::other(BOOTSTRAP_CANCELLED));
        }

        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let eta = rate.eta_seconds(downloaded, expected_len, 2.0);
        let force = downloaded < 512 * 1024
            || downloaded.is_multiple_of(512 * 1024)
            || expected_len.is_some_and(|t| downloaded >= t);
        reporter.downloading(downloaded, expected_len, Some(url), eta, force);

        let mb = downloaded / (1024 * 1024);
        if mb > last_logged_mb && mb.is_multiple_of(50) {
            tracing::info!("bootstrap: downloaded {} MB", mb);
            last_logged_mb = mb;
        }
    }
    file.sync_all()?;

    if let Some(expected) = expected_len {
        if downloaded != expected {
            return Err(AppError::other(format!(
                "Download incomplete: expected {expected} bytes, got {downloaded}. \
                 Retry to resume, or choose a local bootstrap zip."
            )));
        }
    }

    reporter.downloading(downloaded, Some(downloaded), Some(url), Some(0), true);
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

fn count_zip_files(archive: &mut ZipArchive<std::fs::File>) -> AppResult<u64> {
    let mut count = 0u64;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| AppError::other(format!("zip entry {i}: {e}")))?;
        let name = entry.name();
        if name.ends_with('/') || entry.is_dir() {
            continue;
        }
        count += 1;
    }
    Ok(count)
}

fn extract_bootstrap_zip(
    zip_path: &Path,
    datadir: &Path,
    reporter: &mut BootstrapReporter,
) -> AppResult<()> {
    let staging = datadir.join("bootstrap");
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    std::fs::create_dir_all(&staging)?;

    let file = std::fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::other(format!("invalid zip: {e}")))?;

    let total_files = count_zip_files(&mut archive)?;
    reporter.extracting(0, Some(total_files), false, None, true);

    let first_name = (0..archive.len())
        .find_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()));

    let top_level_blocks = first_name
        .as_deref()
        .is_some_and(|n| n.starts_with("blocks/") || n == "blocks");

    let mut extracted = 0u64;
    let mut rate = PhaseRateTracker::new();
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
        extracted += 1;
        let eta = rate.eta_seconds(extracted, Some(total_files), 3.0);
        let force = extracted == 1
            || extracted == total_files
            || extracted.is_multiple_of(25);
        reporter.extracting(extracted, Some(total_files), false, eta, force);
    }

    reporter.extracting(extracted, Some(total_files), false, Some(0), true);
    tracing::info!("bootstrap: extracted archive into {}", staging.display());
    Ok(())
}

fn apply_bootstrap(datadir: &Path, reporter: &mut BootstrapReporter) -> AppResult<()> {
    let staging = datadir.join("bootstrap");
    validate_bootstrap_staging(&staging)?;

    reporter.applying(0);
    clear_datadir_lock_file(datadir);

    // Remove live chain dirs only after staging is validated.
    for name in ["blocks", "chainstate"] {
        let target = datadir.join(name);
        if target.exists() {
            remove_dir_all_with_retry(&target, name)?;
        }
    }

    for (idx, name) in ["blocks", "chainstate"].iter().enumerate() {
        let from = staging.join(name);
        let target = datadir.join(name);
        std::fs::rename(&from, &target).map_err(|e| {
            AppError::other(format!(
                "could not install bootstrap {name}/ into {}: {e}",
                datadir.display()
            ))
        })?;
        reporter.applying((idx + 1) as u8);
    }

    if chain_snapshot_needs_reindex(datadir) {
        return Err(AppError::other(
            "Bootstrap chainstate failed to install (blocks present but index is empty). \
             Quit the wallet, delete any veriumd processes, and retry import.",
        ));
    }

    let peers = staging.join("peers.dat");
    if peers.is_file() {
        let _ = std::fs::copy(&peers, datadir.join("peers.dat"));
    }

    let _ = std::fs::remove_dir_all(&staging);

    reporter.applying(2);
    tracing::info!("bootstrap: applied new chain data under {}", datadir.display());
    Ok(())
}

/// Legacy bootstrap zips ship a `blocks/index` built for v1.x single-chain veriumd.
/// Unified v2 `veriumd -verium` cannot read it (`LoadBlockIndexGuts: failed to read value`).
fn strip_unified_incompatible_bootstrap_index(datadir: &Path) -> AppResult<()> {
    let index = datadir.join("blocks/index");
    if index.exists() {
        remove_dir_all_with_retry(&index, "blocks/index")?;
        tracing::info!(
            "bootstrap: removed legacy blocks/index under {} (unified veriumd rebuilds from blk*.dat)",
            datadir.display()
        );
    }
    Ok(())
}

async fn poll_chain_height_after_restart(
    state: &AppState,
    coin: CoinId,
    cfg: &crate::config::DaemonConfig,
    max_wait: Duration,
) -> Option<u64> {
    let deadline = Instant::now() + max_wait;
    let mut best = 0u64;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if let Ok(client) = state.rpc_client(coin).await {
            if let Ok(info) = client
                .call::<Value>("getblockchaininfo", json!([]))
                .await
            {
                state.clear_bootstrap_loading(coin);
                if let Some(blocks) = info.get("blocks").and_then(Value::as_u64) {
                    best = best.max(blocks);
                    if blocks > 10_000 {
                        return Some(blocks);
                    }
                }
            }
        }
    }
    if best > 0 {
        Some(best)
    } else if rpc_reachable_after_restart(state, coin, cfg).await {
        state.clear_bootstrap_loading(coin);
        None
    } else {
        None
    }
}

async fn rpc_reachable_after_restart(
    state: &AppState,
    coin: CoinId,
    cfg: &crate::config::DaemonConfig,
) -> bool {
    let Ok(client) = state.rpc_client(coin).await else {
        return false;
    };
    matches!(
        client.call::<Value>("getblockchaininfo", json!([])).await,
        Ok(_) | Err(AppError::Rpc { .. })
    )
}

fn bootstrap_success_message(binary_name: &str, blocks: Option<u64>) -> String {
    match blocks {
        Some(height) if height > 10_000 => format!(
            "Bootstrap applied and {binary_name} was restarted at block #{height}. \
             Your node will continue syncing the remaining blocks from the network."
        ),
        Some(height) => format!(
            "Bootstrap applied and {binary_name} was restarted (currently at block #{height}). \
             The node will keep syncing from the network."
        ),
        None => format!(
            "Bootstrap applied and {binary_name} was restarted. \
             Chain data is loading — block height should appear within a few minutes."
        ),
    }
}

async fn finish_restart(
    state: &AppState,
    coin: CoinId,
    cfg: &crate::config::DaemonConfig,
    binary_name: &str,
    reporter: &mut BootstrapReporter,
) -> AppResult<BootstrapResult> {
    reporter.restarting(binary_name);
    state.clear_auto_reindex_attempt(coin);
    state.mark_bootstrap_loading(coin, BOOTSTRAP_LOADING_GRACE);
    state.daemon(coin)?.record_pid(None).await;

    let mut restart_cfg = cfg.clone();
    if let Err(e) = ensure_daemon_conf_complete(coin, &mut restart_cfg) {
        tracing::warn!(
            "bootstrap ({}): could not refresh vericonomy.conf before restart: {e}",
            coin.as_str()
        );
    } else {
        state.replace_config(coin, restart_cfg.clone()).await?;
    }

    tokio::time::sleep(Duration::from_millis(1500)).await;

    let restart_cfg = state.config_fresh(coin).await?;
    let unified_chain = detect_binary(coin)
        .path
        .as_ref()
        .map(|p| binary_supports_unified_chain_selector(Path::new(p), coin))
        .unwrap_or(false);
    let datadir = bootstrap_chain_datadir(coin, &restart_cfg, unified_chain);

    let binary_found = detect_binary(coin).found;

    if binary_found {
        // Mirror Settings → Restart daemon: stop anything still bound to the datadir/port,
        // then start fresh so veriumd reads the updated vericonomy.conf and new chain data.
        // Bootstrap staging was validated (blocks + chainstate); start normally — never -reindex.
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("stop", json!([])).await;
        }
        if let Ok(daemon) = state.daemon(coin) {
            daemon.wait_for_child_exit(Duration::from_secs(5)).await;
            daemon.force_kill_child().await;
            daemon.clear_tracking().await;
        }
        free_rpc_port(coin, &restart_cfg);
        force_stop_native_daemon(coin);
        wait_for_rpc_port_free(restart_cfg.rpc_port, Duration::from_secs(30)).await;
        wait_for_native_daemon_exit(coin, Duration::from_secs(15)).await;

        if chain_snapshot_needs_reindex(&datadir) {
            tracing::error!(
                "bootstrap ({}): chainstate still missing after apply under {} — import may have failed",
                coin.as_str(),
                datadir.display()
            );
            state.clear_bootstrap_loading(coin);
            return Ok(BootstrapResult {
                success: false,
                message: "Bootstrap did not install a complete chainstate. \
                          Quit the wallet, stop all veriumd processes, and try Download snapshot again."
                    .into(),
                restart_hint: None,
            });
        }

        let start_args: &[&str] = if unified_chain { &["-reindex"] } else { &[] };
        match state.daemon(coin)?.start(&restart_cfg, start_args).await {
            Ok(_) => {
                let blocks = poll_chain_height_after_restart(
                    state,
                    coin,
                    &restart_cfg,
                    Duration::from_secs(90),
                )
                .await;
                return Ok(BootstrapResult {
                    success: true,
                    message: if unified_chain {
                        format!(
                            "Bootstrap block files installed and {binary_name} is rebuilding the chain index \
                             from local data. This can take several hours — leave the wallet open and do not \
                             click Repair until sync progress advances."
                        )
                    } else {
                        bootstrap_success_message(binary_name, blocks)
                    },
                    restart_hint: None,
                });
            }
            Err(e) => {
                state.clear_bootstrap_loading(coin);
                return Ok(BootstrapResult {
                    success: true,
                    message: format!(
                        "Bootstrap applied, but automatic restart failed: {e}. Start {binary_name} manually."
                    ),
                    restart_hint: None,
                });
            }
        }
    }

    state.clear_bootstrap_loading(coin);

    Ok(BootstrapResult {
        success: true,
        message: format!("Bootstrap applied. Start {binary_name} manually to continue."),
        restart_hint: None,
    })
}
