//! Auto-lock state tracking. The frontend polls and triggers walletlock RPC.

use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

static LAST_ACTIVITY: Lazy<Mutex<i64>> = Lazy::new(|| Mutex::new(now_unix()));

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoLockConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Idle seconds before auto-lock (default 15 minutes).
    #[serde(default = "default_idle_seconds")]
    pub idle_seconds: u32,
    #[serde(default = "default_true")]
    pub lock_on_blur: bool,
    #[serde(default = "default_true")]
    pub lock_on_sleep: bool,
}

fn default_idle_seconds() -> u32 {
    15 * 60
}

fn default_true() -> bool {
    true
}

impl Default for AutoLockConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_seconds: default_idle_seconds(),
            lock_on_blur: true,
            lock_on_sleep: true,
        }
    }
}

pub fn record_activity() {
    if let Ok(mut guard) = LAST_ACTIVITY.lock() {
        *guard = now_unix();
    }
}

pub fn last_activity_unix() -> i64 {
    LAST_ACTIVITY.lock().map(|g| *g).unwrap_or(0)
}

pub fn should_auto_lock(config: &AutoLockConfig) -> bool {
    if !config.enabled {
        return false;
    }
    let idle = now_unix().saturating_sub(last_activity_unix());
    idle >= config.idle_seconds as i64
}

pub fn load_config() -> AppResult<AutoLockConfig> {
    let path = crate::config::app_config_base().join("auto_lock.json");
    if !path.exists() {
        return Ok(AutoLockConfig::default());
    }
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn save_config(config: &AutoLockConfig) -> AppResult<()> {
    let path = crate::config::app_config_base().join("auto_lock.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(path, json)?;
    Ok(())
}
