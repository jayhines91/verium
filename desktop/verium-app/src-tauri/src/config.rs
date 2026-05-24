use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::coin_profile::CoinId;
use crate::daemon;
use crate::error::{AppError, AppResult};
use crate::wsl::{detect_wsl_datadirs, is_wsl_unc_path, normalize_wsl_unc_path};

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
        default_config_for_coin(CoinId::Verium)
    }
}

pub fn default_config_for_coin(coin: CoinId) -> DaemonConfig {
    let datadir = default_datadir(coin);
    let cookie_path = Some(datadir.join(".cookie"));
    DaemonConfig {
        datadir,
        rpc_host: "127.0.0.1".to_string(),
        rpc_port: coin.default_rpc_port(),
        chain: coin.default_network_chain().to_string(),
        rpc_user: None,
        rpc_password: None,
        rpc_password_set: false,
        cookie_path,
    }
}

pub fn default_datadir(coin: CoinId) -> PathBuf {
    coin.default_datadir()
}

pub fn app_config_base() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Vericonomy").join("desktop-app")
}

pub fn migrate_legacy_configs() -> AppResult<()> {
    let legacy_daemon = app_config_base()
        .parent()
        .map(|p| p.join("Verium").join("desktop-app").join("daemon.json"));
    let legacy_addressbook = app_config_base()
        .parent()
        .map(|p| p.join("Verium").join("desktop-app").join("addressbook.json"));
    if let Some(legacy) = legacy_daemon {
        let target = app_daemon_config_path(CoinId::Verium);
        if legacy.exists() && !target.exists() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&legacy, &target)?;
            tracing::info!("migrated legacy daemon.json to {}", target.display());
        }
    }
    if let Some(legacy) = legacy_addressbook {
        let target = app_addressbook_path(CoinId::Verium);
        if legacy.exists() && !target.exists() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&legacy, &target)?;
            tracing::info!("migrated legacy addressbook.json to {}", target.display());
        }
    }
    Ok(())
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

pub fn app_daemon_config_path(coin: CoinId) -> PathBuf {
    app_config_base().join(format!("daemon-{}.json", coin.as_str()))
}

pub fn app_addressbook_path(coin: CoinId) -> PathBuf {
    app_config_base().join(format!("addressbook-{}.json", coin.as_str()))
}

pub fn save_app_daemon_config(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let saved = SavedDaemonConfig {
        datadir: cfg.datadir.clone(),
        rpc_host: cfg.rpc_host.clone(),
        rpc_port: cfg.rpc_port,
        chain: cfg.chain.clone(),
        rpc_user: cfg.rpc_user.clone(),
    };
    let path = app_daemon_config_path(coin);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&saved)?;
    fs::write(&path, json)?;
    tracing::info!("saved daemon config to {}", path.display());
    Ok(())
}

fn load_saved_daemon_config(coin: CoinId) -> AppResult<Option<SavedDaemonConfig>> {
    let path = app_daemon_config_path(coin);
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

fn config_from_wsl_autodetect(coin: CoinId) -> Option<DaemonConfig> {
    if coin != CoinId::Verium {
        return None;
    }
    if !cfg!(target_os = "windows") || daemon::bundled_sidecar_available(coin) {
        return None;
    }
    let candidates = detect_wsl_datadirs().ok()?;
    let best = candidates.first()?;
    tracing::info!("auto-detected WSL datadir: {}", best.unc_path);
    Some(DaemonConfig {
        datadir: PathBuf::from(&best.unc_path),
        ..default_config_for_coin(coin)
    })
}

pub fn load_or_default_config(coin: CoinId) -> AppResult<DaemonConfig> {
    let _ = migrate_legacy_configs();
    let mut cfg = if let Some(saved) = load_saved_daemon_config(coin)? {
        config_from_saved(saved)
    } else if let Some(auto) = config_from_wsl_autodetect(coin) {
        auto
    } else {
        default_config_for_coin(coin)
    };
    // Shipped builds bundle sidecars natively — ignore leftover dev WSL datadir paths.
    if daemon::bundled_sidecar_available(coin) && is_wsl_unc_path(&cfg.datadir) {
        tracing::info!(
            "bundled sidecar: using native datadir instead of {}",
            cfg.datadir.display()
        );
        cfg.datadir = default_datadir(coin);
    }
    refresh_config_paths(coin, &mut cfg)?;
    Ok(cfg)
}

/// Ensures the data directory exists and that verium.conf carries an RPC login
/// the desktop app can authenticate with. Safe to call on every launch — only
/// writes when something is missing.
pub fn ensure_first_run_config(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<bool> {
    fs::create_dir_all(&cfg.datadir)?;
    refresh_config_paths(coin, cfg)?;

    let diag = rpc_auth_diagnostics(coin, cfg);
    let needs_creds = !diag.rpc_user_in_conf || !diag.rpc_password_in_conf;
    if !needs_creds {
        return Ok(false);
    }

    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| coin.default_rpc_user().to_string());
    let password = generate_rpc_password();
    let overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("rpcuser", user.clone()),
        ("rpcpassword", password.clone()),
    ];
    write_node_conf_overrides(coin, &cfg.datadir, &overrides)?;
    cfg.rpc_user = Some(user);
    cfg.rpc_password = Some(password);
    refresh_config_paths(coin, cfg)?;
    save_app_daemon_config(coin, cfg)?;
    tracing::info!("first-run: wrote rpc credentials to {}", cfg.datadir.display());
    Ok(true)
}

fn chain_datadir(cfg: &DaemonConfig) -> PathBuf {
    let mut p = cfg.datadir.clone();
    if cfg.chain == "test" {
        p.push("testnet3");
    } else if cfg.chain == "regtest" {
        p.push("regtest");
    }
    p
}

/// Matches veriumd's `GetWalletDir()` — uses `<datadir>/wallets` when that folder exists.
fn wallet_dir(cfg: &DaemonConfig) -> PathBuf {
    let base = chain_datadir(cfg);
    let wallets = base.join("wallets");
    if wallets.is_dir() {
        wallets
    } else {
        base
    }
}

/// Locate the active wallet file on disk (legacy root or `wallets/` layout).
pub fn resolve_wallet_dat_path(cfg: &DaemonConfig) -> Option<PathBuf> {
    let base = chain_datadir(cfg);
    let candidates = [
        base.join("wallet.dat"),
        base.join("wallets").join("wallet.dat"),
    ];
    for path in candidates {
        if path.is_file() {
            return Some(path);
        }
    }
    let wallets_root = base.join("wallets");
    if wallets_root.is_dir() {
        if let Ok(entries) = fs::read_dir(&wallets_root) {
            for entry in entries.flatten() {
                let candidate = entry.path().join("wallet.dat");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

pub fn wallet_dat_path(cfg: &DaemonConfig) -> PathBuf {
    resolve_wallet_dat_path(cfg).unwrap_or_else(|| wallet_dir(cfg).join("wallet.dat"))
}

pub fn wallet_dat_exists(cfg: &DaemonConfig) -> bool {
    resolve_wallet_dat_path(cfg).is_some()
}

/// `<datadir>/backups` — default folder for wallet exports (never the live wallet path).
pub fn wallet_backup_dir(cfg: &DaemonConfig) -> AppResult<PathBuf> {
    let dir = chain_datadir(cfg).join("backups");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn default_wallet_backup_filename(coin: CoinId) -> String {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    format!("{}-wallet-{stamp}.dat", coin.as_str())
}

pub fn suggested_wallet_backup_path(coin: CoinId, cfg: &DaemonConfig) -> AppResult<PathBuf> {
    Ok(wallet_backup_dir(cfg)?.join(default_wallet_backup_filename(coin)))
}

/// Absolute path string for `backupwallet` (forward slashes work on Windows too).
pub fn path_for_veriumd_rpc(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// True when `dest` would overwrite the loaded wallet file.
pub fn is_live_wallet_destination(cfg: &DaemonConfig, dest: &Path) -> bool {
    let Some(live) = resolve_wallet_dat_path(cfg) else {
        return false;
    };
    let dest_key = dest.to_string_lossy().to_ascii_lowercase();
    let live_key = live.to_string_lossy().to_ascii_lowercase();
    dest_key == live_key
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

pub fn parse_node_conf_into(coin: CoinId, datadir: &Path, cfg: &mut DaemonConfig) -> AppResult<()> {
    let path = datadir.join(coin.conf_filename());
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)?;
    let mut current_section: Option<String> = None;
    let active_section = coin.conf_section().map(str::to_string);
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
        let in_active_section = match (&active_section, &current_section) {
            (None, None) => true,
            (None, Some(s)) => s == &active_chain,
            (Some(expected), Some(s)) => s == expected,
            (Some(_), None) => true,
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

/// Backwards-compatible alias.
pub fn parse_verium_conf_into(datadir: &Path, cfg: &mut DaemonConfig) -> AppResult<()> {
    parse_node_conf_into(CoinId::Verium, datadir, cfg)
}

fn strip_comment(line: &str) -> &str {
    if let Some(idx) = line.find('#') {
        &line[..idx]
    } else {
        line
    }
}

pub fn refresh_config_paths(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<()> {
    let datadir = cfg.datadir.clone();
    parse_node_conf_into(coin, &datadir, cfg)?;
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

pub fn rpc_auth_diagnostics(coin: CoinId, cfg: &DaemonConfig) -> RpcAuthDiagnostics {
    let conf_path = node_conf_path(coin, cfg);
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

pub fn write_node_conf_overrides(
    coin: CoinId,
    datadir: &Path,
    overrides: &[(&str, String)],
) -> AppResult<()> {
    let path = datadir.join(coin.conf_filename());
    fs::create_dir_all(datadir)?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let backup = datadir.join(format!("{}.bak", coin.conf_filename()));
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }

    let mut lines: Vec<String> = existing.lines().map(|l| l.to_string()).collect();
    if coin.conf_section().is_some() && !existing.contains('[') {
        if let Some(section) = coin.conf_section() {
            lines.insert(0, format!("[{section}]"));
        }
    }
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

pub fn write_verium_conf_overrides(
    datadir: &Path,
    overrides: &[(&str, String)],
) -> AppResult<()> {
    write_node_conf_overrides(CoinId::Verium, datadir, overrides)
}

pub fn node_conf_path(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    cfg.datadir.join(coin.conf_filename())
}

pub fn node_conf_backup_path(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    cfg.datadir.join(format!("{}.bak", coin.conf_filename()))
}

pub fn read_node_conf_file(coin: CoinId, cfg: &DaemonConfig) -> AppResult<String> {
    let path = node_conf_path(coin, cfg);
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(&path)?)
}

pub fn write_node_conf_file(coin: CoinId, cfg: &DaemonConfig, content: &str) -> AppResult<()> {
    fs::create_dir_all(&cfg.datadir)?;
    let path = node_conf_path(coin, cfg);
    if path.exists() {
        let _ = fs::copy(&path, node_conf_backup_path(coin, cfg));
    }
    fs::write(&path, content)?;
    Ok(())
}

pub fn verium_conf_path(cfg: &DaemonConfig) -> PathBuf {
    node_conf_path(CoinId::Verium, cfg)
}

pub fn verium_conf_backup_path(cfg: &DaemonConfig) -> PathBuf {
    node_conf_backup_path(CoinId::Verium, cfg)
}

pub fn read_verium_conf_file(cfg: &DaemonConfig) -> AppResult<String> {
    read_node_conf_file(CoinId::Verium, cfg)
}

pub fn write_verium_conf_file(cfg: &DaemonConfig, content: &str) -> AppResult<()> {
    write_node_conf_file(CoinId::Verium, cfg, content)
}

/// Berkeley DB keeps environment files beside `wallet.dat`. After replacing the
/// wallet file, stale log/cache files must be removed or veriumd can load a mix
/// of old and new wallet state (wrong balances vs transaction list).
pub fn clear_wallet_bdb_environment(wallet_dat: &Path) -> AppResult<()> {
    let Some(parent) = wallet_dat.parent() else {
        return Ok(());
    };
    let db_dir = parent.join("database");
    if db_dir.is_dir() {
        fs::remove_dir_all(&db_dir)?;
        tracing::info!(
            "wallet restore: cleared Berkeley DB environment at {}",
            db_dir.display()
        );
    }
    let db_log = parent.join("db.log");
    if db_log.is_file() {
        fs::remove_file(&db_log)?;
        tracing::info!(
            "wallet restore: removed stale db.log at {}",
            db_log.display()
        );
    }
    Ok(())
}
