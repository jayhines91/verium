use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::config::DaemonConfig;
use crate::error::{AppError, AppResult};
use crate::wsl::detect_wsl_veriumd_binary;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonBinarySource {
    /// Tauri sidecar bundled inside the installer (default for shipped builds).
    Sidecar,
    Env,
    AdjacentToApp,
    Path,
    SystemDefault,
    Wsl,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonBinaryStatus {
    pub found: bool,
    pub path: Option<String>,
    pub source: DaemonBinarySource,
    /// veriumd exists inside WSL (typical legacy dev/WSL setup on Windows).
    pub wsl_found: bool,
    pub wsl_path: Option<String>,
    /// The app can start/stop the node without manual terminal commands.
    pub manageable: bool,
    /// `bundled`, `windows`, `wsl`, or `none`
    pub runtime: String,
}

#[derive(Clone)]
pub struct DaemonManager {
    _app: AppHandle,
    child_pid: Arc<Mutex<Option<u32>>>,
}

impl DaemonManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            _app: app,
            child_pid: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start(&self, cfg: &DaemonConfig) -> AppResult<u32> {
        let bin = resolve_daemon_binary()
            .ok_or_else(|| AppError::other("could not locate veriumd binary"))?;
        let mut cmd = Command::new(bin);
        cmd.arg(format!("-datadir={}", cfg.datadir.display()))
            .arg("-server=1")
            .arg("-checklevel=0")
            .arg(format!("-rpcport={}", cfg.rpc_port))
            .arg(format!("-rpcbind={}", cfg.rpc_host));
        if cfg.chain == "test" {
            cmd.arg("-testnet");
        }
        let child = cmd
            .spawn()
            .map_err(|e| AppError::other(format!("failed to spawn veriumd: {e}")))?;
        let pid = child.id().unwrap_or(0);
        *self.child_pid.lock().await = Some(pid);
        Ok(pid)
    }

    pub async fn record_pid(&self, pid: Option<u32>) {
        *self.child_pid.lock().await = pid;
    }

    pub async fn pid(&self) -> Option<u32> {
        *self.child_pid.lock().await
    }
}

fn resolve_daemon_binary() -> Option<PathBuf> {
    detect_binary().path.map(PathBuf::from)
}

fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "veriumd.exe"
    } else {
        "veriumd"
    }
}

/// Tauri sidecar binaries are installed next to the host binary using the
/// `-<target-triple>` naming scheme during development, but at install time
/// they live next to the application executable under their plain name.
fn detect_sidecar_binary() -> Option<PathBuf> {
    let name = binary_name();
    let exe = std::env::current_exe().ok()?;
    let parent = exe.parent()?;

    // Production install: sidecar lives next to the host binary.
    let adjacent = parent.join(name);
    if adjacent.exists() {
        return Some(adjacent);
    }

    // Some installs keep the triple-suffixed name next to the host binary.
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let matches_ext = if cfg!(target_os = "windows") {
                fname.ends_with(".exe")
            } else {
                !fname.contains('.') || fname.ends_with(".bin")
            };
            if fname.starts_with("veriumd-") && matches_ext && p.is_file() {
                return Some(p);
            }
        }
    }

    // Dev runs: Tauri's `dev`/`build --debug` pipeline keeps the triple suffix.
    if let Ok(rustc_triple) = std::env::var("TARGET") {
        let triple_name = if cfg!(target_os = "windows") {
            format!("veriumd-{rustc_triple}.exe")
        } else {
            format!("veriumd-{rustc_triple}")
        };
        let candidate = parent.join(&triple_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // Try common triples relative to the workspace `src-tauri/binaries/` (dev).
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
                let want_prefix = "veriumd-";
                let matches_ext = if cfg!(target_os = "windows") {
                    fname.ends_with(".exe")
                } else {
                    !fname.contains('.')
                        || fname.ends_with(".bin")
                };
                if fname.starts_with(want_prefix) && matches_ext && p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// True when the installer shipped a bundled `veriumd` next to this executable.
pub fn bundled_sidecar_available() -> bool {
    detect_sidecar_binary().is_some()
}

pub fn detect_binary() -> DaemonBinaryStatus {
    // Sidecar wins — that's the shipped configuration.
    if let Some(sidecar) = detect_sidecar_binary() {
        return DaemonBinaryStatus {
            found: true,
            path: Some(sidecar.display().to_string()),
            source: DaemonBinarySource::Sidecar,
            wsl_found: false,
            wsl_path: None,
            manageable: true,
            runtime: "bundled".into(),
        };
    }

    let windows = detect_windows_binary();
    if windows.found {
        return DaemonBinaryStatus {
            wsl_found: false,
            wsl_path: None,
            manageable: true,
            runtime: "windows".into(),
            ..windows
        };
    }

    // WSL is a dev-only fallback — never probe it on every Settings poll when
    // a native binary is already in use (avoids flashing wsl.exe consoles).
    #[cfg(target_os = "windows")]
    if let Some(wsl_path) = detect_wsl_veriumd_binary() {
        return DaemonBinaryStatus {
            found: true,
            path: Some(wsl_path.clone()),
            source: DaemonBinarySource::Wsl,
            wsl_found: true,
            wsl_path: Some(wsl_path),
            manageable: true,
            runtime: "wsl".into(),
        };
    }

    DaemonBinaryStatus {
        found: false,
        path: None,
        source: DaemonBinarySource::None,
        wsl_found: false,
        wsl_path: None,
        manageable: false,
        runtime: "none".into(),
    }
}

fn detect_windows_binary() -> DaemonBinaryStatus {
    let name = binary_name();

    if let Ok(p) = std::env::var("VERIUMD_PATH") {
        let path = PathBuf::from(p);
        if path.exists() {
            return DaemonBinaryStatus {
                found: true,
                path: Some(path.display().to_string()),
                source: DaemonBinarySource::Env,
                wsl_found: false,
                wsl_path: None,
                manageable: true,
                runtime: "windows".into(),
            };
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join(name);
            if candidate.exists() {
                return DaemonBinaryStatus {
                    found: true,
                    path: Some(candidate.display().to_string()),
                    source: DaemonBinarySource::AdjacentToApp,
                    wsl_found: false,
                    wsl_path: None,
                    manageable: true,
                    runtime: "windows".into(),
                };
            }
        }
    }

    if let Ok(p) = which::which(name) {
        return DaemonBinaryStatus {
            found: true,
            path: Some(p.display().to_string()),
            source: DaemonBinarySource::Path,
            wsl_found: false,
            wsl_path: None,
            manageable: true,
            runtime: "windows".into(),
        };
    }

    if !cfg!(target_os = "windows") {
        let p = PathBuf::from(format!("/usr/local/bin/{name}"));
        if p.exists() {
            return DaemonBinaryStatus {
                found: true,
                path: Some(p.display().to_string()),
                source: DaemonBinarySource::SystemDefault,
                wsl_found: false,
                wsl_path: None,
                manageable: true,
                runtime: "windows".into(),
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
    }
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
