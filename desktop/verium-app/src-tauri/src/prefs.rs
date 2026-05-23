use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    #[serde(default)]
    pub setup_completed: bool,
    #[serde(default)]
    pub bootstrap_dismissed_at: Option<i64>,
    #[serde(default = "default_tx_template")]
    pub explorer_tx_url_template: String,
    #[serde(default)]
    pub explorer_block_url_template: Option<String>,
    #[serde(default)]
    pub explorer_address_url_template: Option<String>,
  /// Start CPU mining automatically when the app opens (requires unlocked wallet).
  #[serde(default)]
  pub auto_mine_on_open: bool,
  /// Play a chime when the wallet receives a new coinbase (block found).
  #[serde(default)]
  pub play_sound_on_block_mined: bool,
  /// Toast + chime when incoming VRM is received while the app is open.
  #[serde(default = "default_notify_on_vrm_received")]
  pub notify_on_vrm_received: bool,
  #[serde(default = "default_auto_mine_threads")]
    pub auto_mine_threads: u32,
    #[serde(default)]
    pub mining_power_watts: Option<f64>,
    #[serde(default)]
    pub mining_cost_per_kwh: Option<f64>,
    /// "system" (follow OS), "light", or "dark". Defaults to "system".
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    /// How long to keep the wallet unlocked after entering the passphrase (seconds).
    #[serde(default = "default_wallet_unlock_duration")]
    pub wallet_unlock_duration_seconds: u32,
    /// Custom on-chain fee rate in VRM/kB. None falls back to the daemon default.
    #[serde(default)]
    pub tx_fee_rate_vrm_per_kb: Option<f64>,
}

fn default_auto_mine_threads() -> u32 {
    2
}

fn default_theme_mode() -> String {
    "system".to_string()
}

fn default_wallet_unlock_duration() -> u32 {
    4 * 60 * 60
}

fn default_notify_on_vrm_received() -> bool {
    true
}

fn default_tx_template() -> String {
    "https://explorer-vrm.vericonomy.com/#tx/%s".to_string()
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            setup_completed: false,
            bootstrap_dismissed_at: None,
            explorer_tx_url_template: default_tx_template(),
            explorer_block_url_template: None,
            explorer_address_url_template: None,
            auto_mine_on_open: false,
            play_sound_on_block_mined: false,
            notify_on_vrm_received: default_notify_on_vrm_received(),
            auto_mine_threads: default_auto_mine_threads(),
            mining_power_watts: None,
            mining_cost_per_kwh: None,
            theme_mode: default_theme_mode(),
            wallet_unlock_duration_seconds: default_wallet_unlock_duration(),
            tx_fee_rate_vrm_per_kb: None,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct PartialUserPreferences {
    pub setup_completed: Option<bool>,
    pub bootstrap_dismissed_at: Option<i64>,
    pub explorer_tx_url_template: Option<String>,
    pub explorer_block_url_template: Option<String>,
    pub explorer_address_url_template: Option<String>,
    pub auto_mine_on_open: Option<bool>,
    pub play_sound_on_block_mined: Option<bool>,
    pub notify_on_vrm_received: Option<bool>,
    pub auto_mine_threads: Option<u32>,
    pub mining_power_watts: Option<f64>,
    pub mining_cost_per_kwh: Option<f64>,
    pub theme_mode: Option<String>,
    pub wallet_unlock_duration_seconds: Option<u32>,
    pub tx_fee_rate_vrm_per_kb: Option<f64>,
}

pub fn prefs_path() -> PathBuf {
    let base = if let Some(d) = dirs::config_dir() {
        d
    } else if let Some(d) = dirs::data_dir() {
        d
    } else if let Some(d) = dirs::home_dir() {
        d
    } else {
        PathBuf::from(".")
    };
    base.join("Verium").join("desktop-app").join("prefs.json")
}

pub async fn load() -> AppResult<UserPreferences> {
    let path = prefs_path();
    if !path.exists() {
        return Ok(UserPreferences::default());
    }
    let raw = fs::read_to_string(&path).await?;
    match serde_json::from_str::<UserPreferences>(&raw) {
        Ok(p) => Ok(p),
        Err(_) => Ok(UserPreferences::default()),
    }
}

pub async fn save(prefs: &UserPreferences) -> AppResult<()> {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(prefs)?;
    fs::write(&path, json).await?;
    Ok(())
}

pub fn merge(current: UserPreferences, partial: PartialUserPreferences) -> UserPreferences {
    UserPreferences {
        setup_completed: partial.setup_completed.unwrap_or(current.setup_completed),
        bootstrap_dismissed_at: partial
            .bootstrap_dismissed_at
            .or(current.bootstrap_dismissed_at),
        explorer_tx_url_template: partial
            .explorer_tx_url_template
            .unwrap_or(current.explorer_tx_url_template),
        explorer_block_url_template: partial
            .explorer_block_url_template
            .or(current.explorer_block_url_template),
        explorer_address_url_template: partial
            .explorer_address_url_template
            .or(current.explorer_address_url_template),
        auto_mine_on_open: partial.auto_mine_on_open.unwrap_or(current.auto_mine_on_open),
        play_sound_on_block_mined: partial
            .play_sound_on_block_mined
            .unwrap_or(current.play_sound_on_block_mined),
        notify_on_vrm_received: partial
            .notify_on_vrm_received
            .unwrap_or(current.notify_on_vrm_received),
        auto_mine_threads: partial.auto_mine_threads.unwrap_or(current.auto_mine_threads),
        mining_power_watts: partial.mining_power_watts.or(current.mining_power_watts),
        mining_cost_per_kwh: partial.mining_cost_per_kwh.or(current.mining_cost_per_kwh),
        theme_mode: partial.theme_mode.unwrap_or(current.theme_mode),
        wallet_unlock_duration_seconds: partial
            .wallet_unlock_duration_seconds
            .unwrap_or(current.wallet_unlock_duration_seconds),
        tx_fee_rate_vrm_per_kb: partial
            .tx_fee_rate_vrm_per_kb
            .or(current.tx_fee_rate_vrm_per_kb),
    }
}
