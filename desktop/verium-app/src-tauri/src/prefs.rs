use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::fs as async_fs;

use crate::coin_profile::{CoinId, NetworkMode};
use crate::config::app_config_base;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    #[serde(default)]
    pub setup_completed: bool,
    /// First-run wizard finished per chain (`verium`, `vericoin`).
    #[serde(default)]
    pub setup_completed_by_coin: Option<HashMap<String, bool>>,
    #[serde(default)]
    pub bootstrap_dismissed_at: Option<i64>,
    #[serde(default = "default_active_coin")]
    pub active_coin: String,
    #[serde(default = "default_true")]
    pub verium_enabled: bool,
    #[serde(default = "default_true")]
    pub vericoin_enabled: bool,
    #[serde(default)]
    pub explorer_tx_url_template: String,
    #[serde(default)]
    pub explorer_block_url_template: Option<String>,
    #[serde(default)]
    pub explorer_address_url_template: Option<String>,
    /// Start CPU mining automatically when the app opens (requires unlocked wallet).
    #[serde(default)]
    pub auto_mine_on_open: bool,
    /// Start staking automatically when the app opens (Vericoin).
    #[serde(default)]
    pub auto_stake_on_open: bool,
    /// Play a chime when the wallet receives a new coinbase (block found).
    #[serde(default)]
    pub play_sound_on_block_mined: bool,
    /// Toast + chime when incoming VRM is received while the app is open.
    #[serde(default = "default_notify_on_vrm_received")]
    pub notify_on_vrm_received: bool,
    /// Toast + chime when incoming VRC is received while the app is open.
    #[serde(default = "default_notify_on_vrc_received")]
    pub notify_on_vrc_received: bool,
    #[serde(default = "default_auto_mine_threads")]
    pub auto_mine_threads: u32,
    /// When true, thread count follows CPU topology; when false, uses auto_mine_threads.
    #[serde(default = "default_auto_adjust_mine_threads")]
    pub auto_adjust_mine_threads: bool,
    /// "dynamic" (default) or "static" — how block rewards choose a payout address.
    #[serde(default = "default_mining_reward_address_mode")]
    pub mining_reward_address_mode: String,
    /// Wallet address for block rewards when mining_reward_address_mode is "static".
    #[serde(default)]
    pub mining_reward_address: Option<String>,
    #[serde(default)]
    pub pause_mine_on_battery: bool,
    #[serde(default = "default_mine_core_affinity")]
    pub mine_core_affinity: String,
    #[serde(default)]
    pub mining_power_watts: Option<f64>,
    #[serde(default)]
    pub mining_cost_per_kwh: Option<f64>,
    /// Optional VRM/USD price assumption for solo revenue estimates.
    #[serde(default)]
    pub mining_vrm_price_usd: Option<f64>,
    /// "system" (follow OS), "light", or "dark". Defaults to "system".
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    /// Default unlock duration (seconds) when no per-coin override is set.
    #[serde(default = "default_wallet_unlock_duration")]
    pub wallet_unlock_duration_seconds: u32,
    /// Optional per-coin unlock durations keyed by coin id (`verium`, `vericoin`).
    #[serde(default)]
    pub wallet_unlock_duration_by_coin: Option<HashMap<String, u32>>,
    /// Custom on-chain fee rate in VRM/kB. None falls back to the daemon default.
    #[serde(default)]
    pub tx_fee_rate_vrm_per_kb: Option<f64>,
    /// Unix timestamp when bootstrap was last imported, keyed by coin id.
    #[serde(default)]
    pub bootstrap_imported_at_by_coin: Option<HashMap<String, i64>>,
    /// Which physical network the wallet is operating against. Defaults to
    /// Mainnet. BinaryTest is the isolated Binary Chain v3 (DACE) test
    /// network — see vericoin/doc/dace/binarytest-network.md. Switching
    /// modes restarts the daemons and clears RPC URL overrides.
    #[serde(default)]
    pub network_mode: NetworkMode,
}

fn default_active_coin() -> String {
    "verium".to_string()
}

fn default_true() -> bool {
    true
}

fn default_auto_mine_threads() -> u32 {
    2
}

fn default_auto_adjust_mine_threads() -> bool {
    true
}

fn default_mining_reward_address_mode() -> String {
    "dynamic".to_string()
}

fn default_mine_core_affinity() -> String {
    "performance".to_string()
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

fn default_notify_on_vrc_received() -> bool {
    true
}

fn default_tx_template() -> String {
    "https://staging-explorer.vericonomy.com/vrm/tx/%s".to_string()
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            setup_completed: false,
            setup_completed_by_coin: None,
            bootstrap_dismissed_at: None,
            active_coin: default_active_coin(),
            verium_enabled: true,
            vericoin_enabled: true,
            explorer_tx_url_template: default_tx_template(),
            explorer_block_url_template: None,
            explorer_address_url_template: None,
            auto_mine_on_open: false,
            auto_stake_on_open: false,
            play_sound_on_block_mined: false,
            notify_on_vrm_received: default_notify_on_vrm_received(),
            notify_on_vrc_received: default_notify_on_vrc_received(),
            auto_mine_threads: default_auto_mine_threads(),
            auto_adjust_mine_threads: default_auto_adjust_mine_threads(),
            mining_reward_address_mode: default_mining_reward_address_mode(),
            mining_reward_address: None,
            pause_mine_on_battery: false,
            mine_core_affinity: default_mine_core_affinity(),
            mining_power_watts: None,
            mining_cost_per_kwh: None,
            mining_vrm_price_usd: None,
            theme_mode: default_theme_mode(),
            wallet_unlock_duration_seconds: default_wallet_unlock_duration(),
            wallet_unlock_duration_by_coin: None,
            tx_fee_rate_vrm_per_kb: None,
            bootstrap_imported_at_by_coin: None,
            network_mode: NetworkMode::Mainnet,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct PartialUserPreferences {
    pub setup_completed: Option<bool>,
    pub setup_completed_by_coin: Option<HashMap<String, bool>>,
    pub bootstrap_dismissed_at: Option<i64>,
    pub active_coin: Option<String>,
    pub verium_enabled: Option<bool>,
    pub vericoin_enabled: Option<bool>,
    pub explorer_tx_url_template: Option<String>,
    pub explorer_block_url_template: Option<String>,
    pub explorer_address_url_template: Option<String>,
    pub auto_mine_on_open: Option<bool>,
    pub auto_stake_on_open: Option<bool>,
    pub play_sound_on_block_mined: Option<bool>,
    pub notify_on_vrm_received: Option<bool>,
    pub notify_on_vrc_received: Option<bool>,
    pub auto_mine_threads: Option<u32>,
    pub auto_adjust_mine_threads: Option<bool>,
    pub mining_reward_address_mode: Option<String>,
    pub mining_reward_address: Option<String>,
    pub pause_mine_on_battery: Option<bool>,
    pub mine_core_affinity: Option<String>,
    pub mining_power_watts: Option<f64>,
    pub mining_cost_per_kwh: Option<f64>,
    pub mining_vrm_price_usd: Option<f64>,
    pub theme_mode: Option<String>,
    pub wallet_unlock_duration_seconds: Option<u32>,
    pub wallet_unlock_duration_by_coin: Option<HashMap<String, u32>>,
    pub tx_fee_rate_vrm_per_kb: Option<f64>,
    pub bootstrap_imported_at_by_coin: Option<HashMap<String, i64>>,
    pub network_mode: Option<NetworkMode>,
}

pub fn prefs_path() -> PathBuf {
    app_config_base().join("prefs.json")
}

fn legacy_prefs_path() -> PathBuf {
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

pub fn coin_enabled(prefs: &UserPreferences, coin: CoinId) -> bool {
    match coin {
        CoinId::Verium => prefs.verium_enabled,
        CoinId::Vericoin => prefs.vericoin_enabled,
    }
}

pub fn wallet_unlock_duration_for(prefs: &UserPreferences, coin: CoinId) -> u32 {
    prefs
        .wallet_unlock_duration_by_coin
        .as_ref()
        .and_then(|m| m.get(coin.as_str()).copied())
        .unwrap_or(prefs.wallet_unlock_duration_seconds)
}

const PREFS_STORE_LABEL: &str = "user-preferences";

/// Load preferences without blocking on the async runtime (safe from Tauri setup and sync commands).
pub fn load_sync() -> AppResult<UserPreferences> {
    let legacy = legacy_prefs_path();
    let path = prefs_path();
    if legacy.exists() && !crate::secret_store::blob_exists(PREFS_STORE_LABEL) {
        let raw = fs::read_to_string(&legacy)?;
        if let Ok(prefs) = serde_json::from_str::<UserPreferences>(&raw) {
            save_sync(&prefs)?;
            let _ = fs::remove_file(&legacy);
            return Ok(prefs);
        }
    }

    if path.exists() && !crate::secret_store::blob_readable(PREFS_STORE_LABEL) {
        let raw = fs::read_to_string(&path)?;
        if let Ok(prefs) = serde_json::from_str::<UserPreferences>(&raw) {
            save_sync(&prefs)?;
            return Ok(prefs);
        }
    }

    crate::secret_store::migrate_plaintext_json(PREFS_STORE_LABEL, &path)?;
    let mut prefs = crate::secret_store::load_json(
        PREFS_STORE_LABEL,
        &path,
        UserPreferences::default(),
    )?;

    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(plain) = serde_json::from_str::<UserPreferences>(&raw) {
                if plain.network_mode != prefs.network_mode {
                    prefs.network_mode = plain.network_mode;
                }
            }
        }
    }

    if prefs.setup_completed {
        let mut m = prefs.setup_completed_by_coin.clone().unwrap_or_default();
        m.entry(CoinId::Verium.as_str().to_string()).or_insert(true);
        prefs.setup_completed_by_coin = Some(m);
    }

    Ok(prefs)
}

fn save_sync(prefs: &UserPreferences) -> AppResult<()> {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    crate::secret_store::save_json(PREFS_STORE_LABEL, prefs)?;
    let json = serde_json::to_string_pretty(prefs)?;
    fs::write(&path, json)?;
    Ok(())
}

pub async fn load() -> AppResult<UserPreferences> {
    load_sync()
}

pub async fn save(prefs: &UserPreferences) -> AppResult<()> {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        async_fs::create_dir_all(parent).await?;
    }
    crate::secret_store::save_json(PREFS_STORE_LABEL, prefs)?;
    let json = serde_json::to_string_pretty(prefs)?;
    async_fs::write(&path, json).await?;
    Ok(())
}

pub fn merge(current: UserPreferences, partial: PartialUserPreferences) -> UserPreferences {
    UserPreferences {
        setup_completed: partial.setup_completed.unwrap_or(current.setup_completed),
        setup_completed_by_coin: partial
            .setup_completed_by_coin
            .or(current.setup_completed_by_coin),
        bootstrap_dismissed_at: partial
            .bootstrap_dismissed_at
            .or(current.bootstrap_dismissed_at),
        active_coin: partial.active_coin.unwrap_or(current.active_coin),
        verium_enabled: partial.verium_enabled.unwrap_or(current.verium_enabled),
        vericoin_enabled: partial.vericoin_enabled.unwrap_or(current.vericoin_enabled),
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
        auto_stake_on_open: partial.auto_stake_on_open.unwrap_or(current.auto_stake_on_open),
        play_sound_on_block_mined: partial
            .play_sound_on_block_mined
            .unwrap_or(current.play_sound_on_block_mined),
        notify_on_vrm_received: partial
            .notify_on_vrm_received
            .unwrap_or(current.notify_on_vrm_received),
        notify_on_vrc_received: partial
            .notify_on_vrc_received
            .unwrap_or(current.notify_on_vrc_received),
        auto_mine_threads: partial.auto_mine_threads.unwrap_or(current.auto_mine_threads),
        auto_adjust_mine_threads: partial
            .auto_adjust_mine_threads
            .unwrap_or(current.auto_adjust_mine_threads),
        mining_reward_address_mode: partial
            .mining_reward_address_mode
            .unwrap_or(current.mining_reward_address_mode),
        mining_reward_address: partial
            .mining_reward_address
            .or(current.mining_reward_address),
        pause_mine_on_battery: partial
            .pause_mine_on_battery
            .unwrap_or(current.pause_mine_on_battery),
        mine_core_affinity: partial
            .mine_core_affinity
            .unwrap_or(current.mine_core_affinity),
        mining_power_watts: partial.mining_power_watts.or(current.mining_power_watts),
        mining_cost_per_kwh: partial.mining_cost_per_kwh.or(current.mining_cost_per_kwh),
        mining_vrm_price_usd: partial
            .mining_vrm_price_usd
            .or(current.mining_vrm_price_usd),
        theme_mode: partial.theme_mode.unwrap_or(current.theme_mode),
        wallet_unlock_duration_seconds: partial
            .wallet_unlock_duration_seconds
            .unwrap_or(current.wallet_unlock_duration_seconds),
        wallet_unlock_duration_by_coin: {
            let mut merged = current
                .wallet_unlock_duration_by_coin
                .clone()
                .unwrap_or_default();
            if let Some(partial_map) = partial.wallet_unlock_duration_by_coin {
                merged.extend(partial_map);
            }
            if merged.is_empty() {
                None
            } else {
                Some(merged)
            }
        },
        tx_fee_rate_vrm_per_kb: partial
            .tx_fee_rate_vrm_per_kb
            .or(current.tx_fee_rate_vrm_per_kb),
        bootstrap_imported_at_by_coin: {
            let mut merged = current
                .bootstrap_imported_at_by_coin
                .clone()
                .unwrap_or_default();
            if let Some(partial_map) = partial.bootstrap_imported_at_by_coin {
                merged.extend(partial_map);
            }
            if merged.is_empty() {
                None
            } else {
                Some(merged)
            }
        },
        network_mode: partial.network_mode.unwrap_or(current.network_mode),
    }
}
