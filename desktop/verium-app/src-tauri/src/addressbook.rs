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

fn load_file(coin: CoinId) -> AppResult<AddressBookFile> {
    let path = book_path(coin);
    crate::secret_store::migrate_plaintext_json(&store_label(coin), &path)?;
    crate::secret_store::load_json(&store_label(coin), &path, AddressBookFile::default())
}

fn save_file(coin: CoinId, file: &AddressBookFile) -> AppResult<()> {
    let path = book_path(coin);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    crate::secret_store::save_json(&store_label(coin), file)
}

pub fn list_entries(coin: CoinId) -> AppResult<Vec<AddressBookEntry>> {
    Ok(load_file(coin)?.entries)
}

pub fn upsert_entry(coin: CoinId, mut entry: AddressBookEntry) -> AppResult<AddressBookEntry> {
    if entry.address.trim().is_empty() {
        return Err(AppError::other("address must not be empty"));
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
