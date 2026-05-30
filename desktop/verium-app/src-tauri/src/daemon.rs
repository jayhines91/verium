use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::coin_profile::CoinId;
use crate::config::{app_config_base, sync_cfg_rpc_credentials_from_conf, sync_performance_overrides, verium_uses_legacy_flat, DaemonConfig};
use crate::error::{AppError, AppResult};

/// BIP14 user-agent comment appended to the bundled daemons' P2P subversion
/// string. Lets the network and block explorer peer lists identify nodes
/// running this alpha build (e.g. `/Vericonomy:1.0.0(alpha1)/`).
const DAEMON_UACOMMENT: &str = "alpha1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonBinarySource {
    Sidecar,
    Env,
    AdjacentToApp,
    Path,
    SystemDefault,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonBinaryStatus {
    pub found: bool,
    pub path: Option<String>,
    pub source: DaemonBinarySource,
    pub manageable: bool,
    pub runtime: String,
    pub coin: String,
    /// Sidecar file exists but is too small to execute (dev build placeholder).
    pub stub_sidecar: bool,
    pub missing_hint: Option<String>,
}

#[derive(Clone)]
pub struct DaemonManager {
    coin: CoinId,
    _app: AppHandle,
    child: Arc<Mutex<Option<Child>>>,
    managed: Arc<Mutex<bool>>,
}

impl DaemonManager {
    pub fn new(app: AppHandle, coin: CoinId) -> Self {
        Self {
            coin,
            _app: app,
            child: Arc::new(Mutex::new(None)),
            managed: Arc::new(Mutex::new(false)),
        }
    }

    pub fn coin(&self) -> CoinId {
        self.coin
    }

    pub async fn start(&self, cfg: &DaemonConfig, extra_args: &[&str]) -> AppResult<u32> {
        if self.child.lock().await.is_some() {
            tracing::debug!(
                "{}: child process already tracked for this session",
                self.coin.binary_base()
            );
            return Ok(0);
        }

        let bin = resolve_daemon_binary(self.coin)
            .ok_or_else(|| AppError::other(format!("could not locate {} binary", self.coin.binary_base())))?;
        let bin = stage_sidecar_for_spawn(&bin)?;
        let legacy_flat = self.coin == CoinId::Verium && verium_uses_legacy_flat(&cfg);
        if legacy_flat && binary_supports_unified_chain_selector(&bin, self.coin) {
            return Err(AppError::other(format!(
                "Refusing to start unified vericoin/veriumd for Verium mainnet ({}) — \
                 install the legacy verium-only v1.x sidecar (npm run fetch:veriumd).",
                bin.display()
            )));
        }
        let unified_chain =
            !legacy_flat && binary_supports_unified_chain_selector(&bin, self.coin);

        let mut spawn_cfg = cfg.clone();
        sync_cfg_rpc_credentials_from_conf(self.coin, &mut spawn_cfg)?;

        let mut std_cmd = std::process::Command::new(&bin);
        std_cmd
            .arg(format!("-datadir={}", spawn_cfg.datadir.display()))
            .arg("-server=1")
            .arg("-checklevel=0")
            .arg(format!("-rpcport={}", spawn_cfg.rpc_port))
            .arg(format!("-rpcbind={}", spawn_cfg.rpc_host))
            .arg("-rpcallowip=127.0.0.1")
            // Tag this build's P2P user agent so alpha nodes are identifiable
            // on the network/explorer peer list (e.g. /Vericonomy:1.0.0(alpha1)/).
            .arg(format!("-uacomment={}", DAEMON_UACOMMENT))
            .arg("-printtoconsole=0");
        for (key, value) in sync_performance_overrides() {
            std_cmd.arg(format!("-{key}={value}"));
        }
        if let Some(user) = spawn_cfg.rpc_user.as_deref().filter(|u| !u.is_empty()) {
            std_cmd.arg(format!("-rpcuser={user}"));
        }
        if let Some(pass) = spawn_cfg.rpc_password.as_deref().filter(|p| !p.is_empty()) {
            std_cmd.arg(format!("-rpcpassword={pass}"));
        }
        // Binarytest network selection (DACE isolated test network):
        // - DaemonConfig.chain == "binarytest-vericoin" or "binarytest-verium"
        //   means we are on the binarytest network. Pass -binarytest plus
        //   the appropriate -vericoin/-verium chain selector. See
        //   vericoin/src/util/system.cpp GetChainName() and
        //   vericoin/doc/dace/binarytest-network.md.
        let is_binarytest = spawn_cfg.chain == "binarytest-vericoin"
            || spawn_cfg.chain == "binarytest-verium";
        if is_binarytest {
            if !binary_supports_binarytest(&bin) {
                return Err(AppError::other(
                    dace_missing_hint().unwrap_or_else(|| {
                        format!(
                            "{} does not support -binarytest. Build DACE daemons from \
                             vericoin/ (see vericoin/build-dace.ps1) and run \
                             npm run fetch:sidecars:dace in the wallet directory.",
                            self.coin.binary_base()
                        )
                    }),
                ));
            }
            // Genesis on binarytest can be older than DEFAULT_MAX_TIP_AGE (24h).
            // Without this, a fresh datadir stays in IBD forever and blocks mining.
            std_cmd.arg("-maxtipage=31536000");
            std_cmd.arg("-binarytest");
            match self.coin {
                CoinId::Verium => {
                    std_cmd.arg("-verium");
                    // Pair veriumd with the local vericoind so DACE P2P
                    // (getxheaders/xheaders/ja/jasig) has a peer. binarytest
                    // VRC P2P is fixed at 41684.
                    std_cmd.arg("-addnode=127.0.0.1:41684");
                }
                CoinId::Vericoin => {
                    std_cmd.arg("-vericoin");
                    // Mirror: pair vericoind with the local veriumd at 41988.
                    std_cmd.arg("-addnode=127.0.0.1:41988");
                }
            }
        } else {
            if unified_chain {
                if let Some(chain_arg) = self.coin.chain_cli_arg() {
                    std_cmd.arg(chain_arg);
                }
            } else {
                tracing::debug!(
                    "{}: legacy single-chain binary — omitting {}",
                    self.coin.binary_base(),
                    self.coin.chain_cli_arg().unwrap_or("-chain")
                );
            }
            if spawn_cfg.chain == "test" {
                std_cmd.arg("-testnet");
            }
        }
        for arg in extra_args {
            if !arg.is_empty() {
                std_cmd.arg(*arg);
            }
        }
        std_cmd.current_dir(&spawn_cfg.datadir);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std_cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut cmd = Command::from(std_cmd);
        // Do not kill the daemon when the Child handle drops (e.g. tauri dev
        // rebuild). shutdown_daemon_on_app_exit stops managed nodes explicitly.
        cmd.kill_on_drop(false);
        let child = cmd
            .spawn()
            .map_err(|e| AppError::other(format!("failed to spawn {}: {e}", self.coin.binary_base())))?;
        let pid = child.id().unwrap_or(0);
        *self.child.lock().await = Some(child);
        *self.managed.lock().await = true;
        tracing::info!("{}: started managed node (pid {pid})", self.coin.binary_base());
        Ok(pid)
    }

    pub async fn mark_managed(&self) {
        *self.managed.lock().await = true;
    }

    pub async fn is_managed(&self) -> bool {
        *self.managed.lock().await
    }

    pub async fn clear_tracking(&self) {
        *self.managed.lock().await = false;
        *self.child.lock().await = None;
    }

    pub async fn record_pid(&self, pid: Option<u32>) {
        if pid.is_none() {
            self.clear_tracking().await;
        }
    }

    pub async fn wait_for_child_exit(&self, timeout: Duration) {
        let mut child = self.child.lock().await;
        if let Some(ref mut process) = *child {
            tokio::select! {
                _ = process.wait() => {}
                _ = tokio::time::sleep(timeout) => {}
            }
        }
    }

    pub async fn force_kill_child(&self) {
        if let Some(mut process) = self.child.lock().await.take() {
            let _ = process.start_kill();
            let _ = process.wait().await;
        }
    }

    /// True when this session spawned a child that is still running.
    pub async fn child_running(&self) -> bool {
        let mut child = self.child.lock().await;
        if let Some(ref mut process) = *child {
            match process.try_wait() {
                Ok(None) => return true,
                Ok(Some(_status)) => {
                    *child = None;
                    *self.managed.lock().await = false;
                    return false;
                }
                Err(_) => return false,
            }
        }
        false
    }
}

#[cfg(windows)]
pub fn pids_listening_on_port(port: u16) -> Vec<u32> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let needle = format!(":{port}");
    let output = match std::process::Command::new("netstat")
        .args(["-ano"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut pids = Vec::new();
    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&needle) {
            continue;
        }
        let Some(pid) = line.split_whitespace().last().and_then(|s| s.parse().ok()) else {
            continue;
        };
        if pid > 0 {
            pids.push(pid);
        }
    }
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg(not(windows))]
pub fn pids_listening_on_port(_port: u16) -> Vec<u32> {
    Vec::new()
}

/// Stop only processes listening on the RPC port (does not kill by image name).
pub fn kill_port_listeners(port: u16) {
    for pid in pids_listening_on_port(port) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Stdio;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            tracing::info!("freed RPC port {} by stopping pid {}", port, pid);
        }
    }
}

/// Poll until nothing is listening on the RPC port (or timeout).
pub async fn wait_for_rpc_port_free(port: u16, timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if pids_listening_on_port(port).is_empty() {
            return;
        }
        kill_port_listeners(port);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if !pids_listening_on_port(port).is_empty() {
        tracing::warn!("RPC port {} still in use after {:?}", port, timeout);
    }
}

/// Poll until no native daemon image is running (or timeout).
pub async fn wait_for_native_daemon_exit(coin: CoinId, timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if !native_daemon_image_running(coin) {
            return;
        }
        force_stop_native_daemon(coin);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if native_daemon_image_running(coin) {
        tracing::warn!(
            "{} still running after {:?}",
            coin.binary_base(),
            timeout
        );
    }
}

/// Stop stray veriumd/vericoind processes holding this coin's RPC port.
/// Used for explicit stop/restart flows, not during auto-ensure warmup.
pub fn free_rpc_port(coin: CoinId, cfg: &DaemonConfig) {
    kill_port_listeners(cfg.rpc_port);
    force_stop_native_daemon(coin);
}

#[cfg(windows)]
pub fn force_stop_native_daemon(coin: CoinId) {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let image = format!("{}.exe", coin.binary_base());
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", &image])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(windows))]
pub fn force_stop_native_daemon(_coin: CoinId) {}

/// True when a native daemon process for this coin is running (any datadir).
pub fn native_daemon_image_running(coin: CoinId) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let filter = format!("IMAGENAME eq {}.exe", coin.binary_base());
        let output = match std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(o) => o,
            Err(_) => return false,
        };
        if !output.status.success() {
            return false;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        return text.contains(&format!("{}.exe", coin.binary_base()));
    }
    #[cfg(not(windows))]
    {
        let _ = coin;
        false
    }
}

fn resolve_daemon_binary(coin: CoinId) -> Option<PathBuf> {
    detect_binary(coin).path.map(PathBuf::from)
}

/// True when the resolved daemon binary advertises `-binarytest` in its help
/// output. Production CDN sidecars predate DACE and fail with
/// "Invalid parameter -binarytest".
fn binary_help_output(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let mut cmd = std::process::Command::new(path);
    cmd.arg("-help");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Some(format!("{stdout}{stderr}"))
}

pub fn binary_supports_binarytest(path: &Path) -> bool {
    binary_help_output(path)
        .map(|help| help.contains("-binarytest"))
        .unwrap_or(false)
}

/// Unified vericoin/veriumd builds accept `-verium` / `-vericoin`. Legacy
/// verium-only v1.x binaries reject those flags and default to Verium mainnet.
pub fn binary_supports_unified_chain_selector(path: &Path, coin: CoinId) -> bool {
    let Some(help) = binary_help_output(path) else {
        return false;
    };
    match coin {
        CoinId::Verium => help.contains("-verium"),
        CoinId::Vericoin => help.contains("-vericoin"),
    }
}

fn pick_preferred_sidecar(coin: CoinId, mut candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.retain(|p| is_real_sidecar(p));
    if candidates.is_empty() {
        return None;
    }
    // Verium mainnet: legacy flat verium-only binary (no `-verium` selector). Unified
    // vericoin/veriumd builds use a `verium/` subdir and incompatible bootstrap index.
    if coin == CoinId::Verium {
        if let Some(path) = candidates
            .iter()
            .find(|p| !binary_supports_unified_chain_selector(p, coin))
        {
            return Some(path.clone());
        }
        return None;
    }
    if let Some(path) = candidates
        .iter()
        .find(|p| binary_supports_unified_chain_selector(p, coin))
    {
        return Some(path.clone());
    }
    candidates.into_iter().next()
}

pub fn sidecar_supports_binarytest(coin: CoinId) -> bool {
    resolve_daemon_binary(coin)
        .map(|p| binary_supports_binarytest(&p))
        .unwrap_or(false)
}

/// Both veriumd and vericoind sidecars must understand `-binarytest`.
pub fn dace_sidecars_ready() -> bool {
    CoinId::all()
        .iter()
        .all(|coin| sidecar_supports_binarytest(*coin))
}

pub fn dace_missing_hint() -> Option<String> {
    let mut missing = Vec::new();
    for coin in CoinId::all() {
        if !sidecar_supports_binarytest(*coin) {
            missing.push(coin.binary_base());
        }
    }
    if missing.is_empty() {
        return None;
    }
    Some(format!(
        "DACE-capable {} required. The bundled production sidecars do not support \
         -binarytest. On Windows run vericoin\\build-dace.ps1 (uses WSL), then \
         npm run fetch:sidecars:dace in verium/desktop/verium-app.",
        missing.join(" and ")
    ))
}

fn binary_name(coin: CoinId) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", coin.binary_base())
    } else {
        coin.binary_base().to_string()
    }
}

const MIN_REAL_SIDECAR_BYTES: u64 = 100_000;

fn is_real_sidecar(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() >= MIN_REAL_SIDECAR_BYTES)
        .unwrap_or(false)
}

/// True when `path` is a veriumd/vericoind sidecar that Tauri may overwrite on rebuild.
fn is_daemon_sidecar(path: &Path) -> bool {
    let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    fname == "veriumd"
        || fname == "veriumd.exe"
        || fname == "vericoind"
        || fname == "vericoind.exe"
        || fname.starts_with("veriumd-")
        || fname.starts_with("vericoind-")
        || path.to_string_lossy().contains("binaries")
}

/// Copy bundled sidecars into the app config dir before spawn so Tauri can
/// rebuild/hash `src-tauri/binaries/*` and `target/debug/{veriumd,vericoind}.exe`
/// while daemons are running.
fn stage_sidecar_for_spawn(source: &Path) -> AppResult<PathBuf> {
    if !is_daemon_sidecar(source) {
        return Ok(source.to_path_buf());
    }
    let Some(name) = source.file_name() else {
        return Ok(source.to_path_buf());
    };
    let run_dir = app_config_base().join("run");
    if source.starts_with(&run_dir) {
        return Ok(source.to_path_buf());
    }
    std::fs::create_dir_all(&run_dir)?;
    let dest = run_dir.join(name);
    if dest.is_file() {
        if let (Ok(src_meta), Ok(dst_meta)) = (source.metadata(), dest.metadata()) {
            if src_meta.len() == dst_meta.len() && dst_meta.modified().ok() >= src_meta.modified().ok() {
                return Ok(dest);
            }
        }
    }
    match std::fs::copy(source, &dest) {
        Ok(_) => Ok(dest),
        Err(e)
            if e.raw_os_error() == Some(32) && dest.is_file() =>
        {
            tracing::warn!(
                "stage: {} locked; reusing existing staged copy at {}",
                source.display(),
                dest.display()
            );
            Ok(dest)
        }
        Err(e) => Err(AppError::other(format!(
            "could not stage {} for spawn (stop {} and retry): {e}",
            source.display(),
            name.to_string_lossy()
        ))),
    }
}

fn sidecar_candidate(path: std::path::PathBuf) -> Option<std::path::PathBuf> {
    if path.is_file() && is_real_sidecar(&path) {
        Some(path)
    } else {
        None
    }
}

fn detect_sidecar_binary(coin: CoinId) -> Option<PathBuf> {
    let name = binary_name(coin);
    let base = coin.binary_base();
    let exe = std::env::current_exe().ok()?;
    let parent = exe.parent()?;
    let mut candidates: Vec<PathBuf> = Vec::new();

    let staged = app_config_base().join("run").join(&name);
    candidates.push(staged);

    candidates.push(parent.join(&name));

    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let matches_ext = if cfg!(target_os = "windows") {
                fname.ends_with(".exe")
            } else {
                !fname.contains('.') || fname.ends_with(".bin")
            };
            if fname.starts_with(&format!("{base}-")) && matches_ext && p.is_file() {
                candidates.push(p);
            }
        }
    }

    if let Ok(rustc_triple) = std::env::var("TARGET") {
        let triple_name = if cfg!(target_os = "windows") {
            format!("{base}-{rustc_triple}.exe")
        } else {
            format!("{base}-{rustc_triple}")
        };
        candidates.push(parent.join(&triple_name));
    }

    let workspace_candidates = [
        parent.join("..").join("..").join("..").join("binaries"),
        parent.join("..").join("..").join("binaries"),
        parent.join("binaries"),
    ];
    for dir in workspace_candidates {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                let want_prefix = format!("{base}-");
                let matches_ext = if cfg!(target_os = "windows") {
                    fname.ends_with(".exe")
                } else {
                    !fname.contains('.') || fname.ends_with(".bin")
                };
                if fname.starts_with(&want_prefix) && matches_ext && p.is_file() {
                    candidates.push(p);
                }
            }
        }
    }

    pick_preferred_sidecar(coin, candidates)
}

pub fn bundled_sidecar_available(coin: CoinId) -> bool {
    detect_sidecar_binary(coin).is_some()
}

pub fn sidecar_stub_present(coin: CoinId) -> bool {
    sidecar_stub_path(coin).is_some()
}

pub fn binary_missing_hint(coin: CoinId) -> Option<String> {
    if detect_binary(coin).found {
        return None;
    }
    let name = coin.binary_base();
    if coin == CoinId::Verium {
        return Some(format!(
            "{name} was not found. Verium mainnet requires the legacy flat-layout {name} \
             (verium-only v1.x — not the unified vericoin/veriumd build). Set VERIUMD_LOCAL \
             to a verium-only binary or build from verium-legacy/."
        ));
    }
    if sidecar_stub_present(coin) {
        let env_hint = match coin {
            CoinId::Verium => "VERIUMD_LOCAL or VERIUMD_PATH",
            CoinId::Vericoin => "VERICOIND_LOCAL or VERICOIND_PATH",
        };
        Some(format!(
            "The bundled {name} is a dev placeholder only — install a real {name} binary \
             (set {env_hint}, then npm run fetch:veriumd / fetch:vericoind)."
        ))
    } else {
        Some(format!(
            "{name} was not found on this system. Install the {name} node binary or set \
             {}_PATH to an existing build.",
            name.to_uppercase()
        ))
    }
}

fn sidecar_stub_path(coin: CoinId) -> Option<PathBuf> {
    let base = coin.binary_base();
    let exe = std::env::current_exe().ok()?;
    let parent = exe.parent()?;
    let mut candidates: Vec<PathBuf> = vec![parent.join(binary_name(coin))];
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let matches_ext = if cfg!(target_os = "windows") {
                fname.ends_with(".exe")
            } else {
                !fname.contains('.') || fname.ends_with(".bin")
            };
            if fname.starts_with(&format!("{base}-")) && matches_ext && p.is_file() {
                candidates.push(p);
            }
        }
    }
    for dir in [
        parent.join("binaries"),
        parent.join("..").join("..").join("binaries"),
        parent.join("..").join("..").join("..").join("binaries"),
    ] {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                let matches_ext = if cfg!(target_os = "windows") {
                    fname.ends_with(".exe")
                } else {
                    !fname.contains('.') || fname.ends_with(".bin")
                };
                if fname.starts_with(&format!("{base}-")) && matches_ext && p.is_file() {
                    candidates.push(p);
                }
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_file() && !is_real_sidecar(p))
}

fn unavailable_binary_status(coin: CoinId) -> DaemonBinaryStatus {
    let stub_sidecar = sidecar_stub_present(coin);
    DaemonBinaryStatus {
        found: false,
        path: sidecar_stub_path(coin).map(|p| p.display().to_string()),
        source: DaemonBinarySource::None,
        manageable: false,
        runtime: "none".into(),
        coin: coin.as_str().to_string(),
        stub_sidecar,
        missing_hint: binary_missing_hint(coin),
    }
}

pub fn detect_binary(coin: CoinId) -> DaemonBinaryStatus {
    if let Some(sidecar) = detect_sidecar_binary(coin) {
        return DaemonBinaryStatus {
            found: true,
            path: Some(sidecar.display().to_string()),
            source: DaemonBinarySource::Sidecar,
            manageable: true,
            runtime: "bundled".into(),
            coin: coin.as_str().to_string(),
            stub_sidecar: false,
            missing_hint: None,
        };
    }

    let native = detect_native_binary(coin);
    if native.found {
        return native;
    }

    unavailable_binary_status(coin)
}

fn detect_native_binary(coin: CoinId) -> DaemonBinaryStatus {
    let name = binary_name(coin);
    let env_var = match coin {
        CoinId::Verium => "VERIUMD_PATH",
        CoinId::Vericoin => "VERICOIND_PATH",
    };

    if let Ok(p) = std::env::var(env_var) {
        let path = PathBuf::from(p);
        if path.exists() {
            return DaemonBinaryStatus {
                found: true,
                path: Some(path.display().to_string()),
                source: DaemonBinarySource::Env,
                manageable: true,
                runtime: "native".into(),
                coin: coin.as_str().to_string(),
                stub_sidecar: false,
                missing_hint: None,
            };
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join(&name);
            if candidate.exists() {
                return DaemonBinaryStatus {
                    found: true,
                    path: Some(candidate.display().to_string()),
                    source: DaemonBinarySource::AdjacentToApp,
                    manageable: true,
                    runtime: "native".into(),
                    coin: coin.as_str().to_string(),
                    stub_sidecar: false,
                    missing_hint: None,
                };
            }
        }
    }

    if let Ok(p) = which::which(&name) {
        return DaemonBinaryStatus {
            found: true,
            path: Some(p.display().to_string()),
            source: DaemonBinarySource::Path,
            manageable: true,
            runtime: "native".into(),
            coin: coin.as_str().to_string(),
            stub_sidecar: false,
            missing_hint: None,
        };
    }

    #[cfg(target_os = "windows")]
    if coin == CoinId::Vericoin {
        if let Some(path) = detect_legacy_vericoind_binary() {
            return DaemonBinaryStatus {
                found: true,
                path: Some(path.display().to_string()),
                source: DaemonBinarySource::SystemDefault,
                manageable: true,
                runtime: "native".into(),
                coin: coin.as_str().to_string(),
                stub_sidecar: false,
                missing_hint: None,
            };
        }
    }

    DaemonBinaryStatus {
        found: false,
        path: None,
        source: DaemonBinarySource::None,
        manageable: false,
        runtime: "none".into(),
        coin: coin.as_str().to_string(),
        stub_sidecar: false,
        missing_hint: None,
    }
}

#[cfg(target_os = "windows")]
fn detect_legacy_vericoind_binary() -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        roots.push(PathBuf::from(pf));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        roots.push(PathBuf::from(pf86));
    }
    roots.push(PathBuf::from(r"C:\Program Files"));
    roots.push(PathBuf::from(r"C:\Program Files (x86)"));

    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        candidates.push(root.join("Vericoin").join("daemon").join("vericoind.exe"));
        candidates.push(root.join("Vericoin").join("vericoind.exe"));
    }
    candidates.dedup();

    candidates.into_iter().find(|p| is_real_sidecar(p))
}

mod which {
    use std::path::PathBuf;
    pub fn which(name: &str) -> Result<PathBuf, ()> {
        let path = std::env::var_os("PATH").ok_or(())?;
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            #[cfg(target_os = "windows")]
            {
                let candidate_exe = dir.join(format!("{name}.exe"));
                if candidate_exe.is_file() {
                    return Ok(candidate_exe);
                }
            }
        }
        Err(())
    }
}
