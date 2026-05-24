//! Passkey / PIN gate for app unlock. Uses OS keychain for the unlock secret.

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::secret_store;

const STORE_LABEL: &str = "passkey-config";
const PIN_SALT_LABEL: &str = "passkey-pin-salt";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PasskeyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub use_pin_fallback: bool,
    #[serde(default)]
    pub pin_hash_hex: Option<String>,
    #[serde(default)]
    pub enrolled_at: Option<i64>,
}

fn config_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("passkey.json")
}

pub fn load() -> AppResult<PasskeyConfig> {
    secret_store::load_json(STORE_LABEL, &config_path(), PasskeyConfig::default())
}

pub fn save(config: &PasskeyConfig) -> AppResult<()> {
    secret_store::save_json(STORE_LABEL, config)
}

fn hash_pin(pin: &str, salt: &[u8]) -> AppResult<String> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let params = Params::new(19 * 1024, 2, 1, Some(32))
        .map_err(|e| AppError::other(format!("argon2: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(pin.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::other(format!("pin hash: {e}")))?;
    Ok(hex::encode(out))
}

fn pin_salt() -> AppResult<Vec<u8>> {
    if let Some(s) = secret_store::open(PIN_SALT_LABEL)? {
        return Ok(s.to_vec());
    }
    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    secret_store::seal(PIN_SALT_LABEL, &salt)?;
    Ok(salt.to_vec())
}

pub fn enroll_pin(pin: &str) -> AppResult<()> {
    if pin.len() < 6 {
        return Err(AppError::other("PIN must be at least 6 digits"));
    }
    let salt = pin_salt()?;
    let hash = hash_pin(pin, &salt)?;
    let mut config = load()?;
    config.enabled = true;
    config.use_pin_fallback = true;
    config.pin_hash_hex = Some(hash);
    config.enrolled_at = Some(chrono::Utc::now().timestamp());
    save(&config)
}

pub fn verify_pin(pin: &str) -> AppResult<bool> {
    let config = load()?;
    if !config.enabled {
        return Ok(true);
    }
    let Some(stored) = config.pin_hash_hex else {
        return Ok(false);
    };
    let salt = pin_salt()?;
    let hash = hash_pin(pin, &salt)?;
    Ok(stored == hash)
}

pub fn disable(pin: &str) -> AppResult<()> {
    if !verify_pin(pin)? {
        return Err(AppError::other("invalid PIN"));
    }
    let mut config = load()?;
    config.enabled = false;
    config.pin_hash_hex = None;
    save(&config)
}

pub fn status() -> AppResult<PasskeyConfig> {
    load()
}

/// Check whether the app gate is active (passkey/PIN required before UI).
pub fn gate_required() -> AppResult<bool> {
    Ok(load()?.enabled)
}
