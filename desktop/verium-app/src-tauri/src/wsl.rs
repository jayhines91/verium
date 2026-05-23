use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const DEFAULT_WSL_REPO_ROOT: &str = "/root/verium";

/// Skip strict VerifyDB block checks on startup. Required for some WSL dev builds
/// whose timestamp rules reject valid mainnet blocks from the official bootstrap.
pub const MANAGED_VERIUMD_ARGS: &str = "-checklevel=0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VeriumdStartMode {
    Normal,
    ReindexChainstate,
    Reindex,
}

impl VeriumdStartMode {
    pub fn flag(self) -> &'static str {
        match self {
            Self::Normal => "",
            Self::ReindexChainstate => "-reindex-chainstate",
            Self::Reindex => "-reindex",
        }
    }
}

const WSL_REPO_CANDIDATES: &[&str] = &[
    "/root/verium",
    "/home/verium/verium",
];

/// WSL invocation context (distro + user) derived from paths under `/root/` or UNC.
#[derive(Debug, Clone)]
pub struct WslExec {
    distro: Option<String>,
    user: Option<String>,
}

impl WslExec {
    pub fn for_linux_path(linux_path: &str) -> Self {
        Self {
            distro: None,
            user: needs_root_user(linux_path).then(|| "root".to_string()),
        }
    }

    pub fn for_linux_datadir(linux_datadir: &str) -> Self {
        Self::for_linux_path(linux_datadir)
    }

    pub fn for_unc(unc: &str) -> Self {
        let mut ctx = Self::for_linux_path(&unc_to_linux_path(unc));
        ctx.distro = distro_from_unc(unc);
        ctx
    }

    fn base_command(&self) -> Command {
        let mut cmd = Command::new("wsl.exe");
        hide_console_window(&mut cmd);
        if let Some(d) = &self.distro {
            cmd.args(["-d", d.as_str()]);
        }
        if let Some(u) = &self.user {
            cmd.args(["-u", u.as_str()]);
        }
        cmd
    }

    pub fn exec(&self, program: &str, args: &[&str]) -> std::io::Result<Output> {
        let mut cmd = self.base_command();
        cmd.arg("-e").arg(program);
        cmd.args(args);
        cmd.output()
    }

    pub fn bash_lc(&self, script: &str) -> std::io::Result<Output> {
        self.exec("bash", &["-lc", script])
    }

    pub fn status(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::ExitStatus> {
        let mut cmd = self.base_command();
        cmd.arg("-e").arg(program);
        cmd.args(args);
        cmd.status()
    }
}

fn needs_root_user(linux_path: &str) -> bool {
    linux_path == "/root" || linux_path.starts_with("/root/")
}

fn distro_from_unc(unc: &str) -> Option<String> {
    let normalized = normalize_wsl_unc_path(unc);
    let prefix = r"\\wsl.localhost\";
    let rest = normalized.strip_prefix(prefix)?;
    let name = rest.split('\\').next()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Return the path to a runnable veriumd inside WSL, if present.
pub fn detect_wsl_veriumd_binary() -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    for repo in WSL_REPO_CANDIDATES {
        let candidate = format!("{repo}/src/veriumd");
        if wsl_executable_exists(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn wsl_executable_exists(linux_path: &str) -> bool {
    WslExec::for_linux_path(linux_path)
        .status("test", &["-x", linux_path])
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn is_wsl_unc_path(path: &Path) -> bool {
    path.to_string_lossy()
        .to_ascii_lowercase()
        .starts_with(r"\\wsl.localhost\")
}

/// Normalize WSL UNC paths to consistent Windows backslash form.
pub fn normalize_wsl_unc_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.to_ascii_lowercase().starts_with(r"\\wsl.localhost\") {
        trimmed.replace('/', "\\")
    } else {
        trimmed.to_string()
    }
}

pub fn unc_to_linux_path(unc: &str) -> String {
    let normalized = normalize_wsl_unc_path(unc);
    let lower = normalized.to_ascii_lowercase();
    let prefix = r"\\wsl.localhost\";
    if let Some(rest) = lower.strip_prefix(prefix) {
        if let Some(idx) = rest.find('\\') {
            let linux = rest[idx + 1..].replace('\\', "/");
            return format!("/{linux}");
        }
    }
    unc.trim().replace('\\', "/")
}

/// Map `C:\Users\...` to `/mnt/c/Users/...` for WSL commands.
pub fn windows_path_to_wsl_mnt(path: &Path) -> AppResult<String> {
    let resolved = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    let mut s = resolved.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    if let Some(unc) = s.strip_prefix("UNC\\") {
        s = format!(r"\\{unc}");
    }
    let normalized = s.replace('/', "\\");
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = normalized[2..].replace('\\', "/");
        return Ok(format!("/mnt/{drive}{rest}"));
    }
    Err(AppError::other(format!(
        "expected a Windows drive path, got {}",
        path.display()
    )))
}

#[derive(Debug, Clone, Serialize)]
pub struct WslDatadirCandidate {
    pub distro: String,
    pub unc_path: String,
    pub has_verium_conf: bool,
    pub has_blocks_dir: bool,
    pub has_cookie: bool,
    pub score: u8,
}

const LINUX_CANDIDATES: &[&str] = &[
    "/root/verium-main-dev",
    "/root/.verium",
    "/home/verium/.verium",
];

pub fn detect_wsl_datadirs() -> AppResult<Vec<WslDatadirCandidate>> {
    if !cfg!(target_os = "windows") {
        return Ok(Vec::new());
    }

    let distros = list_wsl_distros()?;
    let mut out = Vec::new();

    for distro in distros {
        for linux_path in LINUX_CANDIDATES {
            let unc = wsl_unc_path(&distro, linux_path);
            let path = PathBuf::from(&unc);
            if !path.exists() {
                continue;
            }
            let has_verium_conf = path.join("verium.conf").is_file();
            let has_blocks_dir = path.join("blocks").is_dir();
            let has_cookie = path.join(".cookie").is_file();
            let mut score = 0u8;
            if has_verium_conf {
                score += 3;
            }
            if has_blocks_dir {
                score += 2;
            }
            if has_cookie {
                score += 1;
            }
            if score == 0 {
                continue;
            }
            out.push(WslDatadirCandidate {
                distro: distro.clone(),
                unc_path: unc,
                has_verium_conf,
                has_blocks_dir,
                has_cookie,
                score,
            });
        }
    }

    out.sort_by(|a, b| b.score.cmp(&a.score).then(a.unc_path.cmp(&b.unc_path)));
    out.dedup_by(|a, b| a.unc_path == b.unc_path);
    Ok(out)
}

fn wsl_unc_path(distro: &str, linux_path: &str) -> String {
    let trimmed = linux_path.trim_start_matches('/');
    format!(r"\\wsl.localhost\{distro}\{trimmed}")
}

#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_cmd: &mut Command) {}

fn list_wsl_distros() -> AppResult<Vec<String>> {
    let mut cmd = Command::new("wsl.exe");
    hide_console_window(&mut cmd);
    let output = cmd
        .args(["-l", "-q"])
        .output()
        .map_err(|e| AppError::other(format!("failed to run wsl.exe: {e}")))?;

    if !output.status.success() {
        return Ok(fallback_distro_names());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut distros: Vec<String> = text
        .lines()
        .map(|line| line.trim().trim_end_matches('\0').trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.replace('\0', ""))
        .collect();

    if distros.is_empty() {
        distros = fallback_distro_names();
    }

    Ok(distros)
}

fn fallback_distro_names() -> Vec<String> {
    let base = Path::new(r"\\wsl.localhost");
    let Ok(entries) = std::fs::read_dir(base) else {
        return vec!["Ubuntu".to_string()];
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

pub fn wsl_restart_hint(linux_datadir: &str, repo_root: &str) -> String {
    let ctx = WslExec::for_linux_datadir(linux_datadir);
    let distro_flag = ctx
        .distro
        .as_ref()
        .map(|d| format!("-d {d} "))
        .unwrap_or_default();
    let user_flag = ctx
        .user
        .as_ref()
        .map(|u| format!("-u {u} "))
        .unwrap_or_default();
    format!(
        "wsl {distro_flag}{user_flag}-e bash -lc 'pkill -f \"veriumd.*-datadir={linux_datadir}\" 2>/dev/null || true; sleep 3; cd {repo_root} && ./src/veriumd -server=1 -datadir={linux_datadir} -daemon'"
    )
}

pub fn wsl_exec_for_datadir(datadir: &Path) -> WslExec {
    if is_wsl_unc_path(datadir) {
        WslExec::for_unc(&datadir.to_string_lossy())
    } else {
        WslExec::for_linux_path(&linux_datadir_from_path(datadir))
    }
}

pub fn linux_datadir_from_path(datadir: &Path) -> String {
    if is_wsl_unc_path(datadir) {
        unc_to_linux_path(&datadir.to_string_lossy())
    } else {
        datadir.to_string_lossy().replace('\\', "/")
    }
}

fn wsl_scope(datadir: &Path) -> (WslExec, String) {
    let linux = linux_datadir_from_path(datadir);
    (wsl_exec_for_datadir(datadir), linux)
}
/// Stop veriumd without RPC (needed when rpcuser/rpcpassword in conf no longer match the running process).
pub fn wsl_stop_veriumd_force_datadir(datadir: &Path) {
    let (ctx, linux_datadir) = wsl_scope(datadir);
    let pattern = format!("veriumd.*-datadir={linux_datadir}");
    for sig in ["-TERM", "-KILL"] {
        let _ = ctx.status("pkill", &[sig, "-f", &pattern]);
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
}

pub fn wsl_stop_veriumd_force(linux_datadir: &str) {
    wsl_stop_veriumd_force_datadir(Path::new(linux_datadir));
}

fn resolve_wsl_repo(repo_root: &str) -> String {
    if wsl_executable_exists(&format!("{repo_root}/src/veriumd")) {
        repo_root.to_string()
    } else if let Some(path) = detect_wsl_veriumd_binary() {
        path.trim_end_matches("/src/veriumd").to_string()
    } else {
        repo_root.to_string()
    }
}

pub fn start_wsl_veriumd_datadir(
    datadir: &Path,
    repo_root: &str,
    mode: VeriumdStartMode,
) -> AppResult<()> {
    wsl_stop_veriumd_force_datadir(datadir);
    let (ctx, linux_datadir) = wsl_scope(datadir);
    let repo = resolve_wsl_repo(repo_root);
    let extra = mode.flag();
    let managed = MANAGED_VERIUMD_ARGS;
    let start_script = if extra.is_empty() {
        format!(
            "cd {repo} && ./src/veriumd -server=1 -datadir={linux_datadir} {managed} -daemon"
        )
    } else {
        format!(
            "cd {repo} && ./src/veriumd -server=1 -datadir={linux_datadir} {extra} {managed} -daemon"
        )
    };
    let output = ctx
        .bash_lc(&start_script)
        .map_err(|e| AppError::other(format!("failed to start veriumd in WSL: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stderr}{stdout}");
        if combined.contains("Verium is probably already running") {
            wsl_stop_veriumd_force_datadir(datadir);
            let retry = ctx
                .bash_lc(&start_script)
                .map_err(|e| AppError::other(format!("failed to retry veriumd start: {e}")))?;
            if !retry.status.success() {
                let stderr = String::from_utf8_lossy(&retry.stderr);
                let stdout = String::from_utf8_lossy(&retry.stdout);
                return Err(AppError::other(format!(
                    "WSL veriumd start failed after retry: {stderr}{stdout}"
                )));
            }
        } else {
            return Err(AppError::other(format!(
                "WSL veriumd start failed: {combined}"
            )));
        }
    }
    Ok(())
}

pub fn restart_wsl_veriumd_datadir(datadir: &Path, repo_root: &str) -> AppResult<()> {
    start_wsl_veriumd_datadir(datadir, repo_root, VeriumdStartMode::Normal)
}

pub fn restart_wsl_veriumd(linux_datadir: &str, repo_root: &str) -> AppResult<()> {
    restart_wsl_veriumd_datadir(Path::new(linux_datadir), repo_root)
}

pub fn wsl_start_veriumd_if_stopped_datadir(datadir: &Path, repo_root: &str) -> AppResult<()> {
    if wsl_veriumd_running_datadir(datadir) {
        return Ok(());
    }
    start_wsl_veriumd_datadir(datadir, repo_root, VeriumdStartMode::Normal)
}

pub fn wsl_start_veriumd_if_stopped(linux_datadir: &str, repo_root: &str) -> AppResult<()> {
    wsl_start_veriumd_if_stopped_datadir(Path::new(linux_datadir), repo_root)
}

pub fn wsl_veriumd_running_datadir(datadir: &Path) -> bool {
    let (ctx, linux_datadir) = wsl_scope(datadir);
    let script = format!(
        r#"import subprocess, sys
datadir = {linux_datadir:?}
try:
    subprocess.check_call(
        ["pgrep", "-f", f"veriumd.*datadir={{datadir}}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
except subprocess.CalledProcessError:
    sys.exit(1)
"#
    );
    ctx.status("python3", &["-c", &script])
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn wsl_veriumd_running(linux_datadir: &str) -> bool {
    wsl_veriumd_running_datadir(Path::new(linux_datadir))
}

/// True when verium.conf was modified after the WSL veriumd for this datadir started.
pub fn wsl_rpc_credentials_stale_datadir(datadir: &Path) -> AppResult<bool> {
    let (ctx, linux_datadir) = wsl_scope(datadir);
    let script = format!(
        r#"import os, subprocess, sys
datadir = {linux_datadir:?}
conf = os.path.join(datadir, "verium.conf")
if not os.path.isfile(conf):
    sys.exit(0)
try:
    out = subprocess.check_output(["pgrep", "-af", f"veriumd.*datadir={{datadir}}"], text=True)
except subprocess.CalledProcessError:
    sys.exit(0)
pids = []
for line in out.strip().splitlines():
    parts = line.strip().split(None, 1)
    if parts:
        pids.append(parts[0])
if not pids:
    sys.exit(0)
pid = pids[0]
stat = os.stat(f"/proc/{{pid}}")
start_mtime = stat.st_mtime
conf_mtime = os.path.getmtime(conf)
print("1" if conf_mtime > start_mtime + 1 else "0")
"#
    );
    let output = ctx
        .exec("python3", &["-c", &script])
        .map_err(|e| AppError::other(format!("wsl stale check failed: {e}")))?;
    if !output.status.success() {
        return Ok(false);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "1")
}

pub fn wsl_rpc_credentials_stale(linux_datadir: &str) -> AppResult<bool> {
    wsl_rpc_credentials_stale_datadir(Path::new(linux_datadir))
}

/// Run a python3 script in WSL with the correct distro/user for a datadir.
pub fn wsl_python_for_datadir_path(datadir: &Path, script: &str, extra_args: &[&str]) -> AppResult<Output> {
    let ctx = wsl_exec_for_datadir(datadir);
    let mut args = vec!["-c", script];
    args.extend_from_slice(extra_args);
    ctx.exec("python3", &args)
        .map_err(|e| AppError::other(format!("wsl python failed: {e}")))
}

pub fn wsl_clear_debug_log_datadir(datadir: &Path) -> AppResult<()> {
    let path = datadir.join("debug.log");
    if path.exists() {
        std::fs::write(&path, "")?;
    }
    Ok(())
}

/// Locate the Verium source tree on Windows (for syncing validation.cpp into WSL).
pub fn find_verium_repo_root() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("VERIUM_REPO") {
        let path = std::path::PathBuf::from(p);
        if path.join("src/validation.cpp").is_file() {
            return Some(path);
        }
    }
    let mut dir = std::env::current_dir().ok()?;
    loop {
        if dir.join("src/validation.cpp").is_file() && dir.join("configure.ac").is_file() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Copy fixed validation.cpp from the Windows repo and rebuild veriumd in WSL.
pub fn rebuild_wsl_veriumd_validation_fix(
    datadir: &Path,
    wsl_repo: &str,
    windows_repo: &Path,
) -> AppResult<String> {
    let validation = windows_repo.join("src/validation.cpp");
    if !validation.is_file() {
        return Err(AppError::other(format!(
            "missing {} — set VERIUM_REPO to your Verium source tree",
            validation.display()
        )));
    }
    wsl_stop_veriumd_force_datadir(datadir);
    let wsl_validation = windows_path_to_wsl_mnt(&validation)?;
    let ctx = WslExec::for_linux_path(wsl_repo);
    let script = format!(
        "set -e
cp '{wsl_validation}' '{wsl_repo}/src/validation.cpp'
cd '{wsl_repo}' && make -j\"$(nproc)\" 2>&1"
    );
    let output = ctx
        .bash_lc(&script)
        .map_err(|e| AppError::other(format!("WSL rebuild failed to start: {e}")))?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(AppError::other(format!(
            "WSL rebuild failed:\n{}",
            combined.lines().rev().take(15).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        )));
    }
    start_wsl_veriumd_datadir(datadir, wsl_repo, VeriumdStartMode::Normal)?;
    Ok(combined
        .lines()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n"))
}
