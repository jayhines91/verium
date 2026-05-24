use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::coin_profile::CoinId;
use crate::config::DaemonConfig;
use crate::error::{AppError, AppResult};
#[cfg(target_os = "windows")]
use crate::wsl::detect_wsl_veriumd_binary;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonBinarySource {
    Sidecar,
    Env,
    AdjacentToApp,
    Path,
    SystemDefault,
    #[cfg(target_os = "windows")]
    Wsl,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonBinaryStatus {
    pub found: bool,
    pub path: Option<String>,
    pub source: DaemonBinarySource,
    pub wsl_found: bool,
    pub wsl_path: Option<String>,
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

        let mut std_cmd = std::process::Command::new(&bin);
        std_cmd
            .arg(format!("-datadir={}", cfg.datadir.display()))
            .arg("-server=1")
            .arg("-checklevel=0")
            .arg(format!("-rpcport={}", cfg.rpc_port))
            .arg(format!("-rpcbind={}", cfg.rpc_host))
            .arg("-printtoconsole=0");
        if let Some(chain_arg) = self.coin.chain_cli_arg() {
            std_cmd.arg(chain_arg);
        }
        if cfg.chain == "test" {
            std_cmd.arg("-testnet");
        }
        for arg in extra_args {
            if !arg.is_empty() {
                std_cmd.arg(*arg);
            }
        }
        std_cmd.current_dir(&cfg.datadir);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std_cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut cmd = Command::from(std_cmd);
        cmd.kill_on_drop(true);
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
pub fn force_stop_native_daemon(coin: CoinId) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let image = format!("{}.exe", coin.binary_base());
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", &image])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
pub fn force_stop_native_daemon(_coin: CoinId) {}

fn resolve_daemon_binary(coin: CoinId) -> Option<PathBuf> {
    detect_binary(coin).path.map(PathBuf::from)
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

    let adjacent = parent.join(&name);
    if let Some(p) = sidecar_candidate(adjacent) {
        return Some(p);
    }

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
                if let Some(p) = sidecar_candidate(p) {
                    return Some(p);
                }
            }
        }
    }

    if let Ok(rustc_triple) = std::env::var("TARGET") {
        let triple_name = if cfg!(target_os = "windows") {
            format!("{base}-{rustc_triple}.exe")
        } else {
            format!("{base}-{rustc_triple}")
        };
        if let Some(p) = sidecar_candidate(parent.join(&triple_name)) {
            return Some(p);
        }
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
                    if let Some(p) = sidecar_candidate(p) {
                        return Some(p);
                    }
                }
            }
        }
    }

    None
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
        wsl_found: false,
        wsl_path: None,
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
            wsl_found: false,
            wsl_path: None,
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

    #[cfg(target_os = "windows")]
    if coin == CoinId::Verium {
        if let Some(wsl_path) = detect_wsl_veriumd_binary() {
            return DaemonBinaryStatus {
                found: true,
                path: Some(wsl_path.clone()),
                source: DaemonBinarySource::Wsl,
                wsl_found: true,
                wsl_path: Some(wsl_path),
                manageable: true,
                runtime: "wsl".into(),
                coin: coin.as_str().to_string(),
                stub_sidecar: false,
                missing_hint: None,
            };
        }
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
                wsl_found: false,
                wsl_path: None,
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
                    wsl_found: false,
                    wsl_path: None,
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
            wsl_found: false,
            wsl_path: None,
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
                wsl_found: false,
                wsl_path: None,
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
        wsl_found: false,
        wsl_path: None,
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
