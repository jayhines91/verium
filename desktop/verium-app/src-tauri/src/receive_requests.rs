//! Encrypted receive-request history (replaces browser localStorage).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::coin_profile::CoinId;
use crate::config::app_config_base;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiveRequest {
    pub id: String,
    pub created_at: i64,
    pub label: String,
    pub message: String,
    pub amount: Option<f64>,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ReceiveRequestFile {
    #[serde(default)]
    entries: Vec<ReceiveRequest>,
}

fn legacy_path(coin: CoinId) -> PathBuf {
    app_config_base().join(format!("receive-requests-{}.json", coin.as_str()))
}

fn store_label(coin: CoinId) -> String {
    format!("receive-requests-{}", coin.as_str())
}

fn parse_receive_request_file(raw: serde_json::Value) -> ReceiveRequestFile {
    if raw.is_null() {
        return ReceiveRequestFile::default();
    }
    if let Ok(file) = serde_json::from_value::<ReceiveRequestFile>(raw.clone()) {
        if !file.entries.is_empty() || raw.get("entries").is_some() {
            return file;
        }
    }
    if let Ok(entries) = serde_json::from_value::<Vec<ReceiveRequest>>(raw) {
        return ReceiveRequestFile { entries };
    }
    ReceiveRequestFile::default()
}

fn read_plaintext_file(coin: CoinId) -> AppResult<ReceiveRequestFile> {
    let path = legacy_path(coin);
    if !path.is_file() {
        return Ok(ReceiveRequestFile::default());
    }
    let raw = fs::read_to_string(&path)?;
    Ok(parse_receive_request_file(serde_json::from_str(&raw)?))
}

fn read_encrypted_file(coin: CoinId) -> AppResult<ReceiveRequestFile> {
    let label = store_label(coin);
    let Some(bytes) = crate::secret_store::open(&label)? else {
        return Ok(ReceiveRequestFile::default());
    };
    let s = String::from_utf8(bytes.to_vec())
        .map_err(|e| AppError::other(format!("invalid utf8 in {label}: {e}")))?;
    Ok(parse_receive_request_file(serde_json::from_str(&s)?))
}

fn load_file(coin: CoinId) -> AppResult<ReceiveRequestFile> {
    let plaintext = read_plaintext_file(coin).unwrap_or_default();
    let encrypted = read_encrypted_file(coin).unwrap_or_default();
    let encrypted_len = encrypted.entries.len();
    let file = if plaintext.entries.len() >= encrypted_len {
        plaintext
    } else {
        encrypted
    };
    if !file.entries.is_empty() && file.entries.len() > encrypted_len {
        let _ = save_encrypted_copy(coin, &file);
    }
    Ok(file)
}

fn save_encrypted_copy(coin: CoinId, file: &ReceiveRequestFile) -> AppResult<()> {
    if let Err(e) = crate::secret_store::save_json(&store_label(coin), file) {
        tracing::warn!(
            "receive_requests: encrypted copy failed for {}: {e}",
            coin.as_str()
        );
    }
    Ok(())
}

fn save_file(coin: CoinId, file: &ReceiveRequestFile) -> AppResult<()> {
    let path = legacy_path(coin);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(file)?;
    fs::write(&path, json)?;
    save_encrypted_copy(coin, file)
}

pub fn list(coin: CoinId) -> AppResult<Vec<ReceiveRequest>> {
    Ok(load_file(coin)?.entries)
}

pub fn append(coin: CoinId, mut entry: ReceiveRequest) -> AppResult<ReceiveRequest> {
    entry.address = entry.address.trim().to_string();
    if entry.address.is_empty() {
        return Err(AppError::other("address must not be empty"));
    }
    entry.label = entry.label.trim().to_string();
    entry.message = entry.message.trim().to_string();

    let mut file = load_file(coin)?;
    let now = chrono::Utc::now().timestamp();
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().simple().to_string();
    }
    if entry.created_at <= 0 {
        entry.created_at = now;
    }

    file.entries.retain(|e| e.id != entry.id);
    file.entries.insert(0, entry.clone());
    save_file(coin, &file)?;
    Ok(entry)
}

pub fn delete_entry(coin: CoinId, id: &str) -> AppResult<()> {
    let mut file = load_file(coin)?;
    let before = file.entries.len();
    file.entries.retain(|e| e.id != id);
    if file.entries.len() == before {
        return Err(AppError::other("receive request not found"));
    }
    save_file(coin, &file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_legacy_array_format() {
        let raw = serde_json::json!([{
            "id": "abc",
            "created_at": 1,
            "label": "tip jar",
            "message": "thanks",
            "amount": 1.5,
            "address": "VRM123"
        }]);
        let file = parse_receive_request_file(raw);
        assert_eq!(file.entries.len(), 1);
        assert_eq!(file.entries[0].label, "tip jar");
    }

    #[test]
    fn parse_wrapped_entries_format() {
        let raw = serde_json::json!({ "entries": [] });
        let file = parse_receive_request_file(raw);
        assert!(file.entries.is_empty());
    }
}
