//! TOTP two-factor authentication for sensitive wallet actions.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm as TotpAlgorithm, Secret, TOTP};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::secret_store;

const STORE_LABEL: &str = "two-factor-config";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwoFactorConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub secret_base32: Option<String>,
    #[serde(default)]
    pub recovery_code_hashes: Vec<String>,
    #[serde(default)]
    pub used_recovery_hashes: Vec<String>,
    #[serde(default = "default_gated_actions")]
    pub gated_actions: Vec<String>,
    #[serde(default)]
    pub send_threshold_vrm: Option<f64>,
    #[serde(default)]
    pub send_threshold_vrc: Option<f64>,
    #[serde(default)]
    pub disabled_at: Option<i64>,
}

fn default_gated_actions() -> Vec<String> {
    vec![
        "send".into(),
        "change_passphrase".into(),
        "show_recovery_phrase".into(),
        "dump_privkey".into(),
        "restore_wallet".into(),
        "edit_conf".into(),
        "disable_2fa".into(),
    ]
}

impl Default for TwoFactorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            secret_base32: None,
            recovery_code_hashes: Vec::new(),
            used_recovery_hashes: Vec::new(),
            gated_actions: default_gated_actions(),
            send_threshold_vrm: Some(0.0),
            send_threshold_vrc: Some(0.0),
            disabled_at: None,
        }
    }
}

fn config_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("two_factor.json")
}

/// Prefer the plaintext mirror so we do not return a stale encrypted blob after confirm.
pub fn load() -> AppResult<TwoFactorConfig> {
    let path = config_path();
    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<TwoFactorConfig>(&raw) {
                Ok(config) => return Ok(config),
                Err(e) => tracing::warn!("two_factor: invalid plaintext config: {e}"),
            }
        }
    }
    secret_store::load_json(STORE_LABEL, &path, TwoFactorConfig::default())
}

pub fn save(config: &TwoFactorConfig) -> AppResult<()> {
    secret_store::save_json(STORE_LABEL, config)?;
    // Plaintext mirror for load_json fallback when the encrypted blob cannot be
    // decrypted (e.g. Windows Credential Manager reset).
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(path, json)?;
    Ok(())
}

fn hash_recovery_code(code: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(code.as_bytes());
    hex::encode(hasher.finalize())
}

fn build_totp(secret_b32: &str) -> AppResult<TOTP> {
    let secret = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|e| AppError::other(format!("invalid TOTP secret: {e}")))?;
    TOTP::new(
        TotpAlgorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("Vericonomy Wallet".to_string()),
        "wallet".to_string(),
    )
    .map_err(|e| AppError::other(format!("TOTP init failed: {e}")))
}

#[derive(Debug, Clone, Serialize)]
pub struct TwoFactorEnrollment {
    pub secret_base32: String,
    pub otpauth_uri: String,
    pub recovery_codes: Vec<String>,
}

pub fn start_enrollment() -> AppResult<TwoFactorEnrollment> {
    let mut secret_bytes = [0u8; 20];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret_bytes);
    let secret_b32 = Secret::Raw(secret_bytes.to_vec())
        .to_encoded()
        .to_string();
    let totp = build_totp(&secret_b32)?;
    let otpauth_uri = totp.get_url();

    let mut recovery_codes = Vec::new();
    let mut hashes = Vec::new();
    for _ in 0..10 {
        let code = format!(
            "{:04}-{:04}-{:04}",
            rand::random::<u16>() % 10_000,
            rand::random::<u16>() % 10_000,
            rand::random::<u16>() % 10_000
        );
        hashes.push(hash_recovery_code(&code));
        recovery_codes.push(code);
    }

    let mut config = load()?;
    config.secret_base32 = Some(secret_b32.clone());
    config.recovery_code_hashes = hashes;
    config.used_recovery_hashes.clear();
    config.enabled = false;
    save(&config)?;

    Ok(TwoFactorEnrollment {
        secret_base32: secret_b32,
        otpauth_uri,
        recovery_codes,
    })
}

fn normalize_totp_code(code: &str) -> Option<String> {
    let digits: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() == 6 {
        Some(digits)
    } else {
        None
    }
}

pub fn confirm_enrollment(code: &str, enrollment_secret: Option<&str>) -> AppResult<()> {
    let code = normalize_totp_code(code)
        .ok_or_else(|| AppError::other("Enter a 6-digit authenticator code"))?;
    let mut config = load()?;
    if config.secret_base32.is_none() {
        let secret = enrollment_secret
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::other(
                    "2FA enrollment not started. Click Start enrollment and scan the QR code again.",
                )
            })?;
        config.secret_base32 = Some(secret.to_string());
        save(&config)?;
    }
    let secret = config
        .secret_base32
        .as_ref()
        .ok_or_else(|| AppError::other("2FA enrollment not started"))?;
    let totp = build_totp(secret)?;
    if totp.check_current(&code).unwrap_or(false) {
        config.enabled = true;
        config.disabled_at = None;
        save(&config)?;
        return Ok(());
    }
    Err(AppError::other(
        "Invalid authenticator code. Check the code and your device clock, then try again.",
    ))
}

/// Rebuild otpauth URI for in-progress enrollment (e.g. after app restart).
pub fn pending_otpauth_uri() -> AppResult<Option<String>> {
    let config = load()?;
    if config.enabled {
        return Ok(None);
    }
    let secret = match &config.secret_base32 {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(None),
    };
    Ok(Some(build_totp(secret)?.get_url()))
}

pub fn verify(code: &str) -> AppResult<bool> {
    let config = load()?;
    if !config.enabled {
        return Ok(true);
    }
    if let Some(disabled_at) = config.disabled_at {
        let now = chrono::Utc::now().timestamp();
        if now - disabled_at < 86_400 {
            return Err(AppError::other(
                "2FA is in 24-hour cooling-off period after disable request",
            ));
        }
    }
    let secret = config
        .secret_base32
        .as_ref()
        .ok_or_else(|| AppError::other("2FA enabled but no secret stored"))?;
    let totp = build_totp(secret)?;
    if let Some(digits) = normalize_totp_code(code) {
        if totp.check_current(&digits).unwrap_or(false) {
            return Ok(true);
        }
    }
    // Try recovery code
    let hash = hash_recovery_code(code.trim());
    if config.recovery_code_hashes.contains(&hash)
        && !config.used_recovery_hashes.contains(&hash)
    {
        let mut updated = config;
        updated.used_recovery_hashes.push(hash);
        save(&updated)?;
        return Ok(true);
    }
    Ok(false)
}

pub fn is_action_gated(action: &str, _amount: Option<f64>, _coin: &str) -> AppResult<bool> {
    let config = load()?;
    if !config.enabled {
        return Ok(false);
    }
    if !config.gated_actions.iter().any(|a| a == action) {
        return Ok(false);
    }
    if action == "send" {
        // All sends require 2FA when enabled (threshold fields reserved for future settings).
        return Ok(true);
    }
    Ok(true)
}

pub fn disable(code: &str) -> AppResult<()> {
    if !verify(code)? {
        return Err(AppError::other("invalid 2FA code"));
    }
    let mut config = load()?;
    config.enabled = false;
    config.disabled_at = Some(chrono::Utc::now().timestamp());
    save(&config)?;
    Ok(())
}

pub fn status() -> AppResult<TwoFactorConfig> {
    let mut config = load()?;
    if config.enabled {
        config.secret_base32 = None;
    }
    Ok(config)
}
