//! Append-only Ed25519-signed audit log of sensitive operations.

use ed25519_dalek::{Signer, Verifier};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::secret_store;

const STORE_LABEL: &str = "audit-log";
const KEY_LABEL: &str = "audit-log-signing-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: i64,
    pub action: String,
    pub detail: String,
    pub coin: Option<String>,
    pub signature_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AuditLogFile {
    entries: Vec<AuditEntry>,
}

fn log_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("audit_log.json")
}

fn signing_key() -> AppResult<ed25519_dalek::SigningKey> {
    if let Some(bytes) = secret_store::open(KEY_LABEL)? {
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return Ok(ed25519_dalek::SigningKey::from_bytes(&arr));
        }
    }
    let key = ed25519_dalek::SigningKey::generate(&mut rand::thread_rng());
    secret_store::seal(KEY_LABEL, key.to_bytes().as_slice())?;
    Ok(key)
}

fn load_file() -> AppResult<AuditLogFile> {
    secret_store::load_json(STORE_LABEL, &log_path(), AuditLogFile::default())
}

fn save_file(file: &AuditLogFile) -> AppResult<()> {
    secret_store::save_json(STORE_LABEL, file)
}

pub fn append(action: &str, detail: &str, coin: Option<&str>) -> AppResult<AuditEntry> {
    let key = signing_key()?;
    let entry = AuditEntry {
        id: uuid::Uuid::new_v4().simple().to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        action: action.to_string(),
        detail: detail.to_string(),
        coin: coin.map(str::to_string),
        signature_hex: None,
    };
    let payload = format!(
        "{}|{}|{}|{}|{}",
        entry.id,
        entry.timestamp,
        entry.action,
        entry.detail,
        entry.coin.as_deref().unwrap_or("")
    );
    let sig = key.sign(payload.as_bytes());
    let mut signed = entry;
    signed.signature_hex = Some(hex::encode(sig.to_bytes()));

    let mut file = load_file()?;
    file.entries.push(signed.clone());
    // Keep last 10_000 entries
    if file.entries.len() > 10_000 {
        file.entries.drain(0..file.entries.len() - 10_000);
    }
    save_file(&file)?;
    tracing::info!("audit: {} — {}", action, detail);
    Ok(signed)
}

pub fn list(limit: Option<usize>) -> AppResult<Vec<AuditEntry>> {
    let file = load_file()?;
    let lim = limit.unwrap_or(100);
    let start = file.entries.len().saturating_sub(lim);
    Ok(file.entries[start..].to_vec())
}

pub fn verify_entry(entry: &AuditEntry) -> AppResult<bool> {
    let Some(sig_hex) = &entry.signature_hex else {
        return Ok(false);
    };
    let sig_bytes = hex::decode(sig_hex)
        .map_err(|e| AppError::other(format!("invalid signature hex: {e}")))?;
    if sig_bytes.len() != 64 {
        return Ok(false);
    }
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&sig_bytes);
    let sig = ed25519_dalek::Signature::from_bytes(&arr);

    let key_bytes = secret_store::open(KEY_LABEL)?
        .ok_or_else(|| AppError::other("no signing key"))?;
    if key_bytes.len() != 32 {
        return Ok(false);
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&key_bytes);
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&key_arr)
        .map_err(|e| AppError::other(format!("invalid verifying key: {e}")))?;

    let payload = format!(
        "{}|{}|{}|{}|{}",
        entry.id,
        entry.timestamp,
        entry.action,
        entry.detail,
        entry.coin.as_deref().unwrap_or("")
    );
    Ok(verifying_key.verify(payload.as_bytes(), &sig).is_ok())
}

pub fn export_json() -> AppResult<String> {
    let file = load_file()?;
    Ok(serde_json::to_string_pretty(&file.entries)?)
}
