use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBookEntry {
    pub id: String,
    pub address: String,
    pub label: String,
    #[serde(default)]
    pub notes: String,
    /// "send" or "receive"
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

fn book_path() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Verium")
        .join("desktop-app")
        .join("addressbook.json")
}

fn load_file() -> AppResult<AddressBookFile> {
    let path = book_path();
    if !path.exists() {
        return Ok(AddressBookFile::default());
    }
    let raw = fs::read_to_string(&path)?;
    match serde_json::from_str::<AddressBookFile>(&raw) {
        Ok(f) => Ok(f),
        Err(_) => Ok(AddressBookFile::default()),
    }
}

fn save_file(file: &AddressBookFile) -> AppResult<()> {
    let path = book_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(file)?;
    fs::write(&path, json)?;
    Ok(())
}

pub fn list_entries() -> AppResult<Vec<AddressBookEntry>> {
    Ok(load_file()?.entries)
}

pub fn upsert_entry(mut entry: AddressBookEntry) -> AppResult<AddressBookEntry> {
    if entry.address.trim().is_empty() {
        return Err(AppError::other("address must not be empty"));
    }
    let mut file = load_file()?;
    let now = chrono::Utc::now().timestamp();
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().simple().to_string();
        entry.created_at = now;
    }
    entry.updated_at = now;

    if let Some(pos) = file.entries.iter().position(|e| e.id == entry.id) {
        file.entries[pos] = entry.clone();
    } else {
        // De-dupe by address+category to avoid accidental duplicates
        file.entries.retain(|e| {
            !(e.address.eq_ignore_ascii_case(&entry.address)
                && e.category == entry.category)
        });
        file.entries.push(entry.clone());
    }
    save_file(&file)?;
    Ok(entry)
}

pub fn delete_entry(id: &str) -> AppResult<()> {
    let mut file = load_file()?;
    let before = file.entries.len();
    file.entries.retain(|e| e.id != id);
    if file.entries.len() == before {
        return Err(AppError::other("address book entry not found"));
    }
    save_file(&file)?;
    Ok(())
}
