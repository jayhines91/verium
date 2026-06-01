//! Anti-phishing spending controls and address allowlist.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::secret_store;

const STORE_LABEL: &str = "spending-controls";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpendingControlsConfig {
    #[serde(default)]
    pub daily_spend_cap_vrm: Option<f64>,
    #[serde(default)]
    pub daily_spend_cap_vrc: Option<f64>,
    #[serde(default)]
    pub allowlist_only: bool,
    #[serde(default)]
    pub require_first_send_confirmation: bool,
    #[serde(default)]
    pub clipboard_guard_enabled: bool,
    #[serde(default)]
    pub spent_today_vrm: f64,
    #[serde(default)]
    pub spent_today_vrc: f64,
    #[serde(default)]
    pub spend_day: Option<String>,
    #[serde(default)]
    pub sent_addresses: Vec<String>,
}

impl Default for SpendingControlsConfig {
    fn default() -> Self {
        Self {
            daily_spend_cap_vrm: None,
            daily_spend_cap_vrc: None,
            allowlist_only: false,
            require_first_send_confirmation: true,
            clipboard_guard_enabled: true,
            spent_today_vrm: 0.0,
            spent_today_vrc: 0.0,
            spend_day: None,
            sent_addresses: Vec::new(),
        }
    }
}

fn config_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("spending_controls.json")
}

pub fn load() -> AppResult<SpendingControlsConfig> {
    secret_store::load_json(STORE_LABEL, &config_path(), SpendingControlsConfig::default())
}

pub fn save(config: &SpendingControlsConfig) -> AppResult<()> {
    secret_store::save_json(STORE_LABEL, config)
}

/// Persist Security-page toggles without wiping send history or daily counters.
pub fn save_ui_settings(incoming: &SpendingControlsConfig) -> AppResult<()> {
    let mut config = load()?;
    config.daily_spend_cap_vrm = incoming.daily_spend_cap_vrm;
    config.daily_spend_cap_vrc = incoming.daily_spend_cap_vrc;
    config.allowlist_only = incoming.allowlist_only;
    config.require_first_send_confirmation = incoming.require_first_send_confirmation;
    config.clipboard_guard_enabled = incoming.clipboard_guard_enabled;
    save(&config)
}

fn today_str() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn reset_daily_if_needed(config: &mut SpendingControlsConfig) {
    let today = today_str();
    if config.spend_day.as_deref() != Some(&today) {
        config.spent_today_vrm = 0.0;
        config.spent_today_vrc = 0.0;
        config.spend_day = Some(today);
    }
}

pub fn is_known_send_destination(
    coin: &str,
    address: &str,
    config: &SpendingControlsConfig,
) -> bool {
    let address = address.trim();
    if address.is_empty() {
        return false;
    }
    if config
        .sent_addresses
        .iter()
        .any(|a| a.eq_ignore_ascii_case(address))
    {
        return true;
    }
    if let Ok(coin_id) = crate::coin_profile::parse_coin_id(coin) {
        if let Ok(entries) = crate::addressbook::list_entries(coin_id) {
            return entries.iter().any(|entry| {
                entry.category.eq_ignore_ascii_case("send")
                    && entry.address.eq_ignore_ascii_case(address)
            });
        }
    }
    false
}

pub fn check_spend_allowed(
    amount: f64,
    coin: &str,
    address: &str,
    wallet_already_sent: bool,
) -> AppResult<SpendCheckResult> {
    let mut config = load()?;
    reset_daily_if_needed(&mut config);

    let cap = match coin {
        "vericoin" => config.daily_spend_cap_vrc,
        _ => config.daily_spend_cap_vrm,
    };
    let spent = match coin {
        "vericoin" => config.spent_today_vrc,
        _ => config.spent_today_vrm,
    };

    if let Some(cap_val) = cap {
        if spent + amount > cap_val {
            return Ok(SpendCheckResult {
                allowed: false,
                reason: Some(format!(
                    "Daily spend cap exceeded ({spent:.8} + {amount:.8} > {cap_val:.8})"
                )),
                requires_extra_confirmation: false,
                look_alike_warning: None,
            });
        }
    }

    let is_first_send = !is_known_send_destination(coin, address, &config) && !wallet_already_sent;

    let requires_extra = config.require_first_send_confirmation && is_first_send;

    Ok(SpendCheckResult {
        allowed: true,
        reason: None,
        requires_extra_confirmation: requires_extra,
        look_alike_warning: detect_look_alike(address, &known_addresses_for_lookalike(coin, &config)),
    })
}

fn known_addresses_for_lookalike(coin: &str, config: &SpendingControlsConfig) -> Vec<String> {
    let mut known = config.sent_addresses.clone();
    if let Ok(coin_id) = crate::coin_profile::parse_coin_id(coin) {
        if let Ok(entries) = crate::addressbook::list_entries(coin_id) {
            for entry in entries {
                if entry.category.eq_ignore_ascii_case("send") {
                    known.push(entry.address);
                }
            }
        }
    }
    known
}

pub fn record_spend(amount: f64, coin: &str, address: &str) -> AppResult<()> {
    let mut config = load()?;
    reset_daily_if_needed(&mut config);
    match coin {
        "vericoin" => config.spent_today_vrc += amount,
        _ => config.spent_today_vrm += amount,
    }
    let address = address.trim();
    if !address.is_empty()
        && !config
            .sent_addresses
            .iter()
            .any(|a| a.eq_ignore_ascii_case(address))
    {
        config.sent_addresses.push(address.to_string());
    }
    save(&config)
}

#[derive(Debug, Clone, Serialize)]
pub struct SpendCheckResult {
    pub allowed: bool,
    pub reason: Option<String>,
    pub requires_extra_confirmation: bool,
    pub look_alike_warning: Option<String>,
}

/// Detect addresses that share leading/trailing chars with known addresses but differ.
pub fn detect_look_alike(address: &str, known: &[String]) -> Option<String> {
    for known_addr in known {
        if known_addr.eq_ignore_ascii_case(address) {
            return None;
        }
        let prefix_match = common_prefix_len(address, known_addr) >= 6;
        let suffix_match = common_suffix_len(address, known_addr) >= 6;
        if prefix_match || suffix_match {
            return Some(format!(
                "This address looks similar to a previously used address ({known_addr}). Double-check before sending."
            ));
        }
    }
    None
}

fn common_prefix_len(a: &str, b: &str) -> usize {
    a.chars()
        .zip(b.chars())
        .take_while(|(x, y)| x.eq_ignore_ascii_case(y))
        .count()
}

fn common_suffix_len(a: &str, b: &str) -> usize {
    a.chars()
        .rev()
        .zip(b.chars().rev())
        .take_while(|(x, y)| x.eq_ignore_ascii_case(y))
        .count()
}

pub fn is_address_allowlisted(address: &str, allowlist: &[String]) -> bool {
    allowlist
        .iter()
        .any(|a| a.eq_ignore_ascii_case(address))
}

pub fn check_allowlist(address: &str, allowlist: &[String]) -> bool {
    let config = load().unwrap_or_default();
    if !config.allowlist_only {
        return true;
    }
    is_address_allowlisted(address, allowlist)
}
