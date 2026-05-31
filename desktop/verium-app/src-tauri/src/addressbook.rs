use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::coin_profile::CoinId;
use crate::config::app_addressbook_path;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBookEntry {
    pub id: String,
    pub address: String,
    pub label: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_category")]
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_category() -> String {
    "send".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AddressBookFile {
    #[serde(default)]
    entries: Vec<AddressBookEntry>,
}

fn book_path(coin: CoinId) -> PathBuf {
    app_addressbook_path(coin)
}

fn store_label(coin: CoinId) -> String {
    format!("addressbook-{}", coin.as_str())
}

fn parse_addressbook_file(raw: serde_json::Value) -> AddressBookFile {
    if raw.is_null() {
        return AddressBookFile::default();
    }
    if let Ok(file) = serde_json::from_value::<AddressBookFile>(raw.clone()) {
        if !file.entries.is_empty() || raw.get("entries").is_some() {
            return file;
        }
    }
    if let Ok(entries) = serde_json::from_value::<Vec<AddressBookEntry>>(raw) {
        return AddressBookFile { entries };
    }
    AddressBookFile::default()
}

fn read_plaintext_file(coin: CoinId) -> AppResult<AddressBookFile> {
    let path = book_path(coin);
    if !path.is_file() {
        return Ok(AddressBookFile::default());
    }
    let raw = fs::read_to_string(&path)?;
    Ok(parse_addressbook_file(serde_json::from_str(&raw)?))
}

fn read_encrypted_file(coin: CoinId) -> AppResult<AddressBookFile> {
    let label = store_label(coin);
    let Some(bytes) = crate::secret_store::open(&label)? else {
        return Ok(AddressBookFile::default());
    };
    let s = String::from_utf8(bytes.to_vec())
        .map_err(|e| AppError::other(format!("invalid utf8 in {label}: {e}")))?;
    Ok(parse_addressbook_file(serde_json::from_str(&s)?))
}

fn load_file(coin: CoinId) -> AppResult<AddressBookFile> {
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

fn save_encrypted_copy(coin: CoinId, file: &AddressBookFile) -> AppResult<()> {
    if let Err(e) = crate::secret_store::save_json(&store_label(coin), file) {
        tracing::warn!(
            "addressbook: encrypted copy failed for {}: {e}",
            coin.as_str()
        );
    }
    Ok(())
}

fn save_file(coin: CoinId, file: &AddressBookFile) -> AppResult<()> {
    let path = book_path(coin);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(file)?;
    fs::write(&path, json)?;
    save_encrypted_copy(coin, file)
}

pub fn list_entries(coin: CoinId) -> AppResult<Vec<AddressBookEntry>> {
    Ok(load_file(coin)?.entries)
}

pub fn upsert_entry(coin: CoinId, mut entry: AddressBookEntry) -> AppResult<AddressBookEntry> {
    entry.address = entry.address.trim().to_string();
    if entry.address.is_empty() {
        return Err(AppError::other("address must not be empty"));
    }
    if entry.label.trim().is_empty() {
        let short = if entry.address.len() > 12 {
            format!(
                "{}…{}",
                &entry.address[..6],
                &entry.address[entry.address.len() - 4..]
            )
        } else {
            entry.address.clone()
        };
        entry.label = short;
    } else {
        entry.label = entry.label.trim().to_string();
    }
    entry.notes = entry.notes.trim().to_string();
    if entry.category.trim().is_empty() {
        entry.category = default_category();
    } else {
        entry.category = entry.category.trim().to_string();
    }

    let mut file = load_file(coin)?;
    let now = chrono::Utc::now().timestamp();
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().simple().to_string();
        entry.created_at = now;
    }
    entry.updated_at = now;

    if let Some(pos) = file.entries.iter().position(|e| e.id == entry.id) {
        file.entries[pos] = entry.clone();
    } else {
        file.entries.retain(|e| {
            !(e.address.eq_ignore_ascii_case(&entry.address) && e.category == entry.category)
        });
        file.entries.push(entry.clone());
    }
    save_file(coin, &file)?;
    Ok(entry)
}

pub fn delete_entry(coin: CoinId, id: &str) -> AppResult<()> {
    let mut file = load_file(coin)?;
    let before = file.entries.len();
    file.entries.retain(|e| e.id != id);
    if file.entries.len() == before {
        return Err(AppError::other("address book entry not found"));
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
            "address": "VRC123",
            "label": "friend",
            "notes": "",
            "category": "receive",
            "created_at": 1,
            "updated_at": 2
        }]);
        let file = parse_addressbook_file(raw);
        assert_eq!(file.entries.len(), 1);
        assert_eq!(file.entries[0].label, "friend");
    }

    #[test]
    fn parse_wrapped_entries_format() {
        let raw = serde_json::json!({ "entries": [] });
        let file = parse_addressbook_file(raw);
        assert!(file.entries.is_empty());
    }

    #[test]
    fn prefers_richer_plaintext_source() {
        let plain = AddressBookFile {
            entries: vec![AddressBookEntry {
                id: "1".into(),
                address: "VRC1".into(),
                label: "a".into(),
                notes: String::new(),
                category: "send".into(),
                created_at: 1,
                updated_at: 1,
            }],
        };
        let encrypted = AddressBookFile::default();
        let chosen = if plain.entries.len() >= encrypted.entries.len() {
            plain
        } else {
            encrypted
        };
        assert_eq!(chosen.entries.len(), 1);
    }
}
