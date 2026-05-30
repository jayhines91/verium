//! Scheduled wallet backups with hash verification and encrypted cloud export.

use std::path::{Path, PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::coin_profile::CoinId;
use crate::config::{resolve_wallet_dat_path, wallet_backup_dir, DaemonConfig};
use crate::error::{AppError, AppResult};
use crate::secret_store;

const CONFIG_LABEL: &str = "backup-scheduler-config";
const HASHES_LABEL: &str = "backup-hashes";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSchedulerConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_daily_retention")]
    pub daily_retention: u32,
    #[serde(default = "default_monthly_retention")]
    pub monthly_retention: u32,
    #[serde(default = "default_interval_hours", alias = "intervalHours")]
    pub interval_hours: u32,
    #[serde(default, alias = "lastRunAt")]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub cloud_folder: Option<String>,
}

fn default_daily_retention() -> u32 {
    14
}

fn default_monthly_retention() -> u32 {
    12
}

fn default_interval_hours() -> u32 {
    24
}

impl Default for BackupSchedulerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            daily_retention: default_daily_retention(),
            monthly_retention: default_monthly_retention(),
            interval_hours: default_interval_hours(),
            last_run_at: None,
            cloud_folder: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct BackupHashRegistry {
    hashes: Vec<BackupHashEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupHashEntry {
    path: String,
    sha256: String,
    created_at: i64,
}

fn config_path() -> PathBuf {
    crate::config::app_config_base().join("backup_scheduler.json")
}

pub fn load_config() -> AppResult<BackupSchedulerConfig> {
    let path = config_path();
    let mut config =
        secret_store::load_json(CONFIG_LABEL, &path, BackupSchedulerConfig::default())?;
    // Encrypted-store recovery can drop scheduler state; restore from the plaintext sidecar.
    if config.last_run_at.is_none() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(plain) = serde_json::from_str::<BackupSchedulerConfig>(&raw) {
                if plain.last_run_at.is_some() {
                    config.last_run_at = plain.last_run_at;
                    if plain.interval_hours > 0 {
                        config.interval_hours = plain.interval_hours;
                    }
                    config.enabled = plain.enabled;
                    save_config(&config)?;
                }
            }
        }
    }
    // Migrate installs that still carry the old default (scheduler off, never run).
    if !config.enabled
        && config.last_run_at.is_none()
        && config.cloud_folder.is_none()
        && config.interval_hours == default_interval_hours()
    {
        config.enabled = true;
        save_config(&config)?;
    }
    Ok(config)
}

pub fn save_config(config: &BackupSchedulerConfig) -> AppResult<()> {
    secret_store::save_json(CONFIG_LABEL, config)?;
    // Keep plaintext fallback in sync for open_with_recovery.
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(path, json)?;
    Ok(())
}

fn load_hashes() -> AppResult<BackupHashRegistry> {
    let path = crate::config::app_config_base().join("backup_hashes.json");
    secret_store::load_json(HASHES_LABEL, &path, BackupHashRegistry::default())
}

fn save_hashes(reg: &BackupHashRegistry) -> AppResult<()> {
    let path = crate::config::app_config_base().join("backup_hashes.json");
    secret_store::save_json(HASHES_LABEL, reg)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(reg)?;
    std::fs::write(&path, json)?;
    Ok(())
}

fn list_backup_files_on_disk() -> AppResult<Vec<(String, i64)>> {
    use crate::config::load_or_default_config;

    let mut out = Vec::new();
    for coin in CoinId::all() {
        let cfg = match load_or_default_config(*coin) {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!("backup health: skip {}: {e}", coin.as_str());
                continue;
            }
        };
        let dir = match wallet_backup_dir(*coin, &cfg) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if !dir.exists() {
            continue;
        }
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("dat") {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !(name.starts_with("auto-") || name.contains("-wallet-")) {
                continue;
            }
            let modified = entry
                .metadata()?
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            out.push((path.display().to_string(), modified));
        }
    }
    Ok(out)
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

pub fn register_backup_hash(path: &Path) -> AppResult<String> {
    let hash = sha256_file(path)?;
    let mut reg = load_hashes()?;
    reg.hashes.retain(|e| e.path != path.display().to_string());
    reg.hashes.push(BackupHashEntry {
        path: path.display().to_string(),
        sha256: hash.clone(),
        created_at: chrono::Utc::now().timestamp(),
    });
    save_hashes(&reg)?;
    Ok(hash)
}

pub fn verify_backup(path: &Path) -> AppResult<bool> {
    let reg = load_hashes()?;
    let path_str = path.display().to_string();
    let Some(entry) = reg.hashes.iter().find(|e| e.path == path_str) else {
        return Ok(false);
    };
    let current = sha256_file(path)?;
    Ok(current == entry.sha256)
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupHealth {
    pub last_backup_at: Option<i64>,
    pub last_verified_at: Option<i64>,
    pub backup_count: u32,
    pub cloud_configured: bool,
    pub scheduler_enabled: bool,
}

pub fn health_status() -> AppResult<BackupHealth> {
    let config = load_config()?;
    let reg = load_hashes()?;
    let disk_files = list_backup_files_on_disk().unwrap_or_default();
    let last_reg = reg.hashes.iter().map(|e| e.created_at).max();
    let last_disk = disk_files.iter().map(|(_, t)| *t).max();
    let last_backup_at = match (last_reg, last_disk) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };
    Ok(BackupHealth {
        last_backup_at,
        last_verified_at: config.last_run_at,
        backup_count: reg.hashes.len().max(disk_files.len()) as u32,
        cloud_configured: config.cloud_folder.is_some(),
        scheduler_enabled: config.enabled,
    })
}

fn effective_last_run_at(config: &BackupSchedulerConfig) -> Option<i64> {
    config.last_run_at.or_else(|| {
        list_backup_files_on_disk()
            .ok()
            .and_then(|files| files.iter().map(|(_, t)| *t).max())
    })
}

/// Whether a scheduled backup should run now.
pub fn is_backup_due(config: &BackupSchedulerConfig) -> bool {
    if !config.enabled {
        return false;
    }
    let interval_hours = config.interval_hours.max(1);
    let interval_secs = i64::from(interval_hours) * 3600;
    let now = chrono::Utc::now().timestamp();
    match effective_last_run_at(config) {
        None => true,
        Some(last) => now.saturating_sub(last) >= interval_secs,
    }
}

pub fn touch_last_run_at() -> AppResult<()> {
    let mut config = load_config()?;
    config.last_run_at = Some(chrono::Utc::now().timestamp());
    save_config(&config)
}

#[derive(Debug, Clone, Serialize)]
pub struct ScheduledBackupResult {
    pub ran: bool,
    pub paths: Vec<String>,
}

/// Encrypt wallet.dat bytes with a separate backup password (Argon2id + AES-GCM).
pub fn encrypt_for_cloud(plaintext: &[u8], password: &str) -> AppResult<Vec<u8>> {
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

    let params = Params::new(19 * 1024, 2, 1, Some(32))
        .map_err(|e| AppError::other(format!("argon2: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| AppError::other(format!("argon2: {e}")))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::other(format!("cipher: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::other(format!("encrypt: {e}")))?;

    let mut out = Vec::with_capacity(16 + 12 + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn auto_backup_path(cfg: &DaemonConfig, coin: CoinId) -> AppResult<PathBuf> {
    let backup_dir = wallet_backup_dir(coin, cfg)?;
    std::fs::create_dir_all(&backup_dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    Ok(backup_dir.join(format!(
        "auto-{}-{}.dat",
        coin.as_str(),
        stamp
    )))
}

pub fn prune_old_backups(coin: CoinId, cfg: &DaemonConfig, config: &BackupSchedulerConfig) -> AppResult<u32> {
    let backup_dir = wallet_backup_dir(coin, cfg)?;
    if !backup_dir.exists() {
        return Ok(0);
    }
    let mut files: Vec<(PathBuf, i64)> = Vec::new();
    for entry in std::fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("dat") {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("auto-") {
            continue;
        }
        let modified = entry
            .metadata()?
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        files.push((path, modified));
    }
    files.sort_by_key(|(_, t)| *t);
    let keep = (config.daily_retention + config.monthly_retention) as usize;
    let mut removed = 0u32;
    if files.len() > keep {
        for (path, _) in files.iter().take(files.len() - keep) {
            let _ = std::fs::remove_file(path);
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn export_encrypted_cloud(
    cfg: &DaemonConfig,
    coin: CoinId,
    password: &str,
) -> AppResult<String> {
    let config = load_config()?;
    let cloud_dir = config
        .cloud_folder
        .as_ref()
        .ok_or_else(|| AppError::other("cloud backup folder not configured"))?;
    let live = resolve_wallet_dat_path(coin, cfg)
        .ok_or_else(|| AppError::other("no wallet.dat found"))?;
    let bytes = std::fs::read(&live)?;
    let encrypted = encrypt_for_cloud(&bytes, password)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = PathBuf::from(cloud_dir).join(format!(
        "vericonomy-{}-{}.vbackup",
        coin.as_str(),
        stamp
    ));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&dest, encrypted)?;
    Ok(dest.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_last_run(hours_ago: i64, interval_hours: u32) -> BackupSchedulerConfig {
        BackupSchedulerConfig {
            enabled: true,
            interval_hours,
            last_run_at: Some(chrono::Utc::now().timestamp() - hours_ago * 3600),
            ..BackupSchedulerConfig::default()
        }
    }

    #[test]
    fn is_backup_due_respects_daily_interval() {
        let recent = config_with_last_run(1, 24);
        assert!(!is_backup_due(&recent));

        let stale = config_with_last_run(25, 24);
        assert!(is_backup_due(&stale));
    }

    #[test]
    fn is_backup_due_treats_zero_interval_as_one_hour_minimum() {
        let recent = config_with_last_run(0, 0);
        assert!(!is_backup_due(&recent));
    }

    #[test]
    fn is_backup_due_disabled_scheduler() {
        let mut cfg = config_with_last_run(48, 24);
        cfg.enabled = false;
        assert!(!is_backup_due(&cfg));
    }
}
