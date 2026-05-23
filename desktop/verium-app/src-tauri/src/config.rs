use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::wsl::{detect_wsl_datadirs, normalize_wsl_unc_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub datadir: PathBuf,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub chain: String,
    #[serde(default)]
    pub rpc_user: Option<String>,
    #[serde(skip_serializing, default)]
    pub rpc_password: Option<String>,
    #[serde(default)]
    pub rpc_password_set: bool,
    #[serde(default)]
    pub cookie_path: Option<PathBuf>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let datadir = default_datadir();
        let cookie_path = Some(datadir.join(".cookie"));
        Self {
            datadir,
            rpc_host: "127.0.0.1".to_string(),
            rpc_port: 33987,
            chain: "main".to_string(),
            rpc_user: None,
            rpc_password: None,
            rpc_password_set: false,
            cookie_path,
        }
    }
}

pub fn default_datadir() -> PathBuf {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if let Some(d) = dirs::data_dir() {
            return d.join("Verium");
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(h) = dirs::home_dir() {
            return h.join(".verium");
        }
    }
    PathBuf::from(".")
}

/// App-level daemon settings persisted between wallet restarts (no secrets on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedDaemonConfig {
    pub datadir: PathBuf,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub chain: String,
    #[serde(default)]
    pub rpc_user: Option<String>,
}

pub fn app_daemon_config_path() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Verium").join("desktop-app").join("daemon.json")
}

pub fn save_app_daemon_config(cfg: &DaemonConfig) -> AppResult<()> {
    let saved = SavedDaemonConfig {
        datadir: cfg.datadir.clone(),
        rpc_host: cfg.rpc_host.clone(),
        rpc_port: cfg.rpc_port,
        chain: cfg.chain.clone(),
        rpc_user: cfg.rpc_user.clone(),
    };
    let path = app_daemon_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&saved)?;
    fs::write(&path, json)?;
    tracing::info!("saved daemon config to {}", path.display());
    Ok(())
}

fn load_saved_daemon_config() -> AppResult<Option<SavedDaemonConfig>> {
    let path = app_daemon_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)?;
    match serde_json::from_str::<SavedDaemonConfig>(&raw) {
        Ok(saved) => Ok(Some(saved)),
        Err(e) => {
            tracing::warn!("ignoring corrupt daemon.json: {e}");
            Ok(None)
        }
    }
}

fn config_from_saved(saved: SavedDaemonConfig) -> DaemonConfig {
    DaemonConfig {
        datadir: saved.datadir,
        rpc_host: saved.rpc_host,
        rpc_port: saved.rpc_port,
        chain: saved.chain,
        rpc_user: saved.rpc_user,
        rpc_password: None,
        rpc_password_set: false,
        cookie_path: None,
    }
}

fn config_from_wsl_autodetect() -> Option<DaemonConfig> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    let candidates = detect_wsl_datadirs().ok()?;
    let best = candidates.first()?;
    tracing::info!("auto-detected WSL datadir: {}", best.unc_path);
    Some(DaemonConfig {
        datadir: PathBuf::from(&best.unc_path),
        ..DaemonConfig::default()
    })
}

pub fn load_or_default_config() -> AppResult<DaemonConfig> {
    let mut cfg = if let Some(saved) = load_saved_daemon_config()? {
        config_from_saved(saved)
    } else if let Some(auto) = config_from_wsl_autodetect() {
        auto
    } else {
        DaemonConfig::default()
    };
    refresh_config_paths(&mut cfg)?;
    Ok(cfg)
}

/// Ensures the data directory exists and that verium.conf carries an RPC login
/// the desktop app can authenticate with. Safe to call on every launch — only
/// writes when something is missing.
pub fn ensure_first_run_config(cfg: &mut DaemonConfig) -> AppResult<bool> {
    fs::create_dir_all(&cfg.datadir)?;
    refresh_config_paths(cfg)?;

    let diag = rpc_auth_diagnostics(cfg);
    let needs_creds = !diag.rpc_user_in_conf || !diag.rpc_password_in_conf;
    if !needs_creds {
        return Ok(false);
    }

    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "veriumwallet".to_string());
    let password = generate_rpc_password();
    let overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("rpcuser", user.clone()),
        ("rpcpassword", password.clone()),
    ];
    write_verium_conf_overrides(&cfg.datadir, &overrides)?;
    cfg.rpc_user = Some(user);
    cfg.rpc_password = Some(password);
    refresh_config_paths(cfg)?;
    save_app_daemon_config(cfg)?;
    tracing::info!("first-run: wrote rpc credentials to {}", cfg.datadir.display());
    Ok(true)
}

pub fn wallet_dat_path(cfg: &DaemonConfig) -> PathBuf {
    let mut p = cfg.datadir.clone();
    if cfg.chain == "test" {
        p.push("testnet3");
    } else if cfg.chain == "regtest" {
        p.push("regtest");
    }
    p.push("wallet.dat");
    p
}

pub fn wallet_dat_exists(cfg: &DaemonConfig) -> bool {
    wallet_dat_path(cfg).exists()
}

pub fn apply_partial_to_config(base: &DaemonConfig, partial: &PartialDaemonConfig) -> DaemonConfig {
    let mut cfg = base.clone();
    if let Some(d) = partial.datadir.as_ref() {
        cfg.datadir = PathBuf::from(normalize_wsl_unc_path(d));
    }
    if let Some(h) = partial.rpc_host.as_ref() {
        cfg.rpc_host = h.clone();
    }
    if let Some(p) = partial.rpc_port {
        cfg.rpc_port = p;
    }
    if let Some(c) = partial.chain.as_ref() {
        cfg.chain = c.clone();
    }
    if let Some(u) = partial.rpc_user.as_ref() {
        cfg.rpc_user = if u.is_empty() { None } else { Some(u.clone()) };
    }
    if let Some(p) = partial.rpc_password.as_ref().filter(|p| !p.is_empty()) {
        cfg.rpc_password = Some(p.clone());
    }
    cfg
}

#[derive(Debug, Deserialize, Default)]
pub struct PartialDaemonConfig {
    pub datadir: Option<String>,
    pub rpc_host: Option<String>,
    pub rpc_port: Option<u16>,
    pub chain: Option<String>,
    pub rpc_user: Option<String>,
    pub rpc_password: Option<String>,
}

pub fn parse_verium_conf_into(datadir: &Path, cfg: &mut DaemonConfig) -> AppResult<()> {
    let path = datadir.join("verium.conf");
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)?;
    let mut current_section: Option<String> = None;
    let active_chain = cfg.chain.clone();
    for raw in content.lines() {
        let line = strip_comment(raw).trim().to_string();
        if line.is_empty() {
            continue;
        }
        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .map(|s| s.trim().to_string())
        {
            current_section = Some(section);
            continue;
        }
        let in_active_section = match &current_section {
            None => true,
            Some(s) => s == &active_chain,
        };
        if !in_active_section {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "rpcport" => {
                    cfg.rpc_port = value.parse().map_err(|_| {
                        AppError::Config(format!("invalid rpcport: {value}"))
                    })?;
                }
                "rpcbind" => {
                    let host = value.split(':').next().unwrap_or(value).to_string();
                    if !host.is_empty() {
                        cfg.rpc_host = host;
                    }
                }
                "rpcuser" => cfg.rpc_user = Some(value.to_string()),
                "rpcpassword" => cfg.rpc_password = Some(value.to_string()),
                "testnet" if value == "1" => cfg.chain = "test".to_string(),
                _ => {}
            }
        }
    }
    Ok(())
}

fn strip_comment(line: &str) -> &str {
    if let Some(idx) = line.find('#') {
        &line[..idx]
    } else {
        line
    }
}

pub fn refresh_config_paths(cfg: &mut DaemonConfig) -> AppResult<()> {
    let datadir = cfg.datadir.clone();
    parse_verium_conf_into(&datadir, cfg)?;
    let cookie = datadir.join(".cookie");
    if cookie.exists() {
        cfg.cookie_path = Some(cookie);
    } else {
        cfg.cookie_path = None;
    }
    cfg.rpc_password_set = cfg.rpc_password.is_some();
    Ok(())
}

pub fn generate_rpc_password() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcAuthDiagnostics {
    pub conf_path: String,
    pub conf_exists: bool,
    pub rpc_user_in_conf: bool,
    pub rpc_password_in_conf: bool,
    pub cookie_present: bool,
    pub app_auth_method: String,
}

pub fn rpc_auth_diagnostics(cfg: &DaemonConfig) -> RpcAuthDiagnostics {
    let conf_path = cfg.datadir.join("verium.conf");
    let mut rpc_user_in_conf = false;
    let mut rpc_password_in_conf = false;
    if conf_path.exists() {
        if let Ok(content) = fs::read_to_string(&conf_path) {
            for line in content.lines() {
                let line = strip_comment(line).trim();
                if let Some((key, _)) = line.split_once('=') {
                    match key.trim() {
                        "rpcuser" => rpc_user_in_conf = true,
                        "rpcpassword" => rpc_password_in_conf = true,
                        _ => {}
                    }
                }
            }
        }
    }
    let cookie_present = cfg
        .cookie_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let app_auth_method = if rpc_password_in_conf && rpc_user_in_conf {
        "userpass".to_string()
    } else if cookie_present {
        "cookie".to_string()
    } else if cfg.rpc_user.is_some() && cfg.rpc_password.is_some() {
        "userpass".to_string()
    } else {
        "none".to_string()
    };
    RpcAuthDiagnostics {
        conf_path: conf_path.display().to_string(),
        conf_exists: conf_path.exists(),
        rpc_user_in_conf,
        rpc_password_in_conf,
        cookie_present,
        app_auth_method,
    }
}

pub fn write_verium_conf_overrides(
    datadir: &Path,
    overrides: &[(&str, String)],
) -> AppResult<()> {
    let path = datadir.join("verium.conf");
    fs::create_dir_all(datadir)?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let backup = datadir.join("verium.conf.bak");
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }

    let mut lines: Vec<String> = existing.lines().map(|l| l.to_string()).collect();
    for (key, value) in overrides {
        let prefix = format!("{key}=");
        let comment_prefix = format!("#{key}=");
        let mut replaced = false;
        for line in lines.iter_mut() {
            let trimmed = line.trim_start();
            if trimmed.starts_with(&prefix) || trimmed.starts_with(&comment_prefix) {
                *line = format!("{key}={value}");
                replaced = true;
                break;
            }
        }
        if !replaced {
            lines.push(format!("{key}={value}"));
        }
    }
    let joined = lines.join("\n");
    fs::write(&path, joined)?;
    Ok(())
}
