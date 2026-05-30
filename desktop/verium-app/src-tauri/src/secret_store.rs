//! Encrypted blob storage backed by OS keychain + Argon2id + AES-256-GCM.

use std::path::PathBuf;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroizing;

use crate::config::app_config_base;
use crate::error::{AppError, AppResult};

const KEYCHAIN_SERVICE: &str = "com.vericonomy.wallet.desktop";
const KEYCHAIN_ACCOUNT: &str = "secret-store-master-v1";
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;

fn store_dir() -> PathBuf {
    app_config_base().join("secure")
}

fn blob_path(label: &str) -> PathBuf {
    store_dir().join(format!("{label}.enc"))
}

/// Whether an encrypted blob file exists for `label`.
pub fn blob_exists(label: &str) -> bool {
    blob_path(label).exists()
}

/// Whether the encrypted blob exists and decrypts with the current master key.
pub fn blob_readable(label: &str) -> bool {
    blob_decrypts(label)
}

fn keyring_entry() -> keyring::Entry {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).expect("keyring entry")
}

#[cfg(test)]
fn ensure_master_key() -> AppResult<[u8; 32]> {
    Ok([0xA5; 32])
}

#[cfg(not(test))]
fn ensure_master_key() -> AppResult<[u8; 32]> {
    match keyring_entry().get_password() {
        Ok(hex_key) => {
            let bytes = hex::decode(hex_key.trim()).map_err(|e| {
                AppError::other(format!("invalid master key in keychain: {e}"))
            })?;
            if bytes.len() != 32 {
                return Err(AppError::other("master key has wrong length"));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let hex_key = hex::encode(key);
            keyring_entry()
                .set_password(&hex_key)
                .map_err(|e| AppError::other(format!("could not store master key: {e}")))?;
            Ok(key)
        }
        Err(e) => Err(AppError::other(format!("keychain read failed: {e}"))),
    }
}

fn blob_decrypts(label: &str) -> bool {
    let path = blob_path(label);
    if !path.exists() {
        return false;
    }
    match std::fs::read(path) {
        Ok(blob) => decrypt(&blob).is_ok(),
        Err(_) => false,
    }
}

fn derive_key(master: &[u8; 32], salt: &[u8]) -> AppResult<[u8; 32]> {
    let params = Params::new(19 * 1024, 2, 1, Some(32))
        .map_err(|e| AppError::other(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(master, salt, &mut out)
        .map_err(|e| AppError::other(format!("argon2 derive: {e}")))?;
    Ok(out)
}

fn encrypt(plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let master = ensure_master_key()?;
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(&master, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::other(format!("cipher init: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::other(format!("encrypt failed: {e}")))?;

    let mut out = Vec::with_capacity(SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(blob: &[u8]) -> AppResult<Vec<u8>> {
    if blob.len() < SALT_LEN + NONCE_LEN + 1 {
        return Err(AppError::other("encrypted blob too short"));
    }
    let master = ensure_master_key()?;
    let salt = &blob[..SALT_LEN];
    let nonce_bytes = &blob[SALT_LEN..SALT_LEN + NONCE_LEN];
    let ciphertext = &blob[SALT_LEN + NONCE_LEN..];

    let key = derive_key(&master, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::other(format!("cipher init: {e}")))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::other(format!("decrypt failed: {e}")))
}

/// Seal bytes to an encrypted file. Overwrites any existing blob.
pub fn seal(label: &str, plaintext: &[u8]) -> AppResult<()> {
    let dir = store_dir();
    std::fs::create_dir_all(&dir)?;
    let encrypted = encrypt(plaintext)?;
    std::fs::write(blob_path(label), encrypted)?;
    Ok(())
}

/// Open and decrypt a sealed blob. Returns None if the blob does not exist.
pub fn open(label: &str) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
    open_with_recovery(label, None)
}

/// Like [`open`], but on decrypt failure quarantines the corrupt blob and
/// optionally falls back to a plaintext file (then re-seals with the current
/// master key). This handles Windows Credential Manager resets where the
/// encrypted blob survives but the master key does not.
fn open_with_recovery(
    label: &str,
    plaintext_fallback: Option<&std::path::Path>,
) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
    let path = blob_path(label);
    if !path.exists() {
        return read_plaintext_fallback(plaintext_fallback);
    }
    let blob = std::fs::read(&path)?;
    match decrypt(&blob) {
        Ok(plain) => Ok(Some(Zeroizing::new(plain))),
        Err(e) => {
            tracing::warn!(
                "secret_store: decrypt failed for {label} ({e}); attempting recovery"
            );
            quarantine_corrupt_blob(label)?;
            if let Some(fallback) = plaintext_fallback {
                if migrate_plaintext_json(label, fallback)? {
                    return open_with_recovery(label, Some(fallback));
                }
                if let Some(plain) = read_plaintext_fallback(Some(fallback))? {
                    seal(label, plain.as_ref())?;
                    return Ok(Some(plain));
                }
            }
            Ok(None)
        }
    }
}

fn read_plaintext_fallback(
    path: Option<&std::path::Path>,
) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
    let Some(path) = path else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read(path)?;
    Ok(Some(Zeroizing::new(raw)))
}

fn quarantine_corrupt_blob(label: &str) -> AppResult<()> {
    let path = blob_path(label);
    if !path.exists() {
        return Ok(());
    }
    let mut bak = path.clone();
    bak.set_extension("enc.bak");
    if bak.exists() {
        let _ = std::fs::remove_file(&bak);
    }
    std::fs::rename(&path, &bak)?;
    tracing::warn!(
        "secret_store: quarantined corrupt blob for {label} at {}",
        bak.display()
    );
    Ok(())
}

/// Delete a sealed blob.
pub fn delete(label: &str) -> AppResult<()> {
    let path = blob_path(label);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Migrate plaintext JSON to encrypted storage, then remove the plaintext file.
pub fn migrate_plaintext_json(label: &str, plaintext_path: &std::path::Path) -> AppResult<bool> {
    if !plaintext_path.exists() {
        return Ok(false);
    }
    if blob_path(label).exists() {
        // Only discard plaintext once the encrypted blob is confirmed readable.
        if blob_decrypts(label) {
            let _ = std::fs::remove_file(plaintext_path);
            return Ok(true);
        }
        return Ok(false);
    }
    let raw = std::fs::read_to_string(plaintext_path)?;
    seal(label, raw.as_bytes())?;
    std::fs::remove_file(plaintext_path)?;
    tracing::info!("secret_store: migrated {} to encrypted storage", label);
    Ok(true)
}

fn load_json_from_plaintext<T: serde::de::DeserializeOwned>(
    label: &str,
    plaintext_path: &std::path::Path,
    default: T,
) -> AppResult<T> {
    let Some(bytes) = read_plaintext_fallback(Some(plaintext_path))? else {
        return Ok(default);
    };
    let s = String::from_utf8(bytes.to_vec())
        .map_err(|e| AppError::other(format!("invalid utf8 in {label} plaintext: {e}")))?;
    match serde_json::from_str::<T>(&s) {
        Ok(v) => {
            if let Err(e) = seal(label, bytes.as_ref()) {
                tracing::warn!("secret_store: re-seal {label} from plaintext failed: {e}");
            }
            Ok(v)
        }
        Err(e) => {
            tracing::warn!("secret_store: invalid json in {label} plaintext, using defaults: {e}");
            Ok(default)
        }
    }
}

/// Load JSON from encrypted store, falling back to plaintext migration.
pub fn load_json<T: serde::de::DeserializeOwned>(
    label: &str,
    plaintext_path: &std::path::Path,
    default: T,
) -> AppResult<T> {
    if !blob_path(label).exists() {
        migrate_plaintext_json(label, plaintext_path)?;
    }
    match open_with_recovery(label, Some(plaintext_path))? {
        Some(bytes) => {
            let s = String::from_utf8(bytes.to_vec())
                .map_err(|e| AppError::other(format!("invalid utf8 in {label}: {e}")))?;
            match serde_json::from_str::<T>(&s) {
                Ok(v) => Ok(v),
                Err(e) => {
                    tracing::warn!("secret_store: invalid json in {label}, trying plaintext: {e}");
                    load_json_from_plaintext(label, plaintext_path, default)
                }
            }
        }
        None => load_json_from_plaintext(label, plaintext_path, default),
    }
}

/// Save JSON to encrypted store.
pub fn save_json<T: serde::Serialize + ?Sized>(label: &str, value: &T) -> AppResult<()> {
    let json = serde_json::to_string_pretty(value)?;
    seal(label, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let data = b"hello secure world";
        let enc = encrypt(data).unwrap();
        let dec = decrypt(&enc).unwrap();
        assert_eq!(dec, data);
    }
}
