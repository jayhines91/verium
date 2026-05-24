use std::path::Path;

use crate::coin_profile::CoinId;
use crate::error::{AppError, AppResult};

/// Matches `WALLET_UNLOCK_FOREVER_SECONDS` in the frontend.
pub const WALLET_UNLOCK_FOREVER_SECONDS: u32 = 100_000_000;

pub fn is_forever_unlock_duration(seconds: u32) -> bool {
    seconds >= WALLET_UNLOCK_FOREVER_SECONDS.saturating_sub(86_400)
}

fn keychain_account_for_datadir(datadir: &Path) -> String {
    let path = std::fs::canonicalize(datadir).unwrap_or_else(|_| datadir.to_path_buf());
    format!("wallet-passphrase:{}", path.display())
}

fn entry_for_datadir(coin: CoinId, datadir: &Path) -> keyring::Entry {
    let service = coin.keychain_service();
    let account = keychain_account_for_datadir(datadir);
    keyring::Entry::new(&service, &account).expect("keyring entry")
}

pub fn store_passphrase(coin: CoinId, datadir: &Path, passphrase: &str) -> AppResult<()> {
    entry_for_datadir(coin, datadir)
        .set_password(passphrase)
        .map_err(|e| AppError::other(format!("could not store wallet passphrase: {e}")))
}

pub fn load_passphrase(coin: CoinId, datadir: &Path) -> AppResult<Option<String>> {
    match entry_for_datadir(coin, datadir).get_password() {
        Ok(passphrase) => Ok(Some(passphrase)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::other(format!(
            "could not read stored wallet passphrase: {e}"
        ))),
    }
}

pub fn clear_passphrase(coin: CoinId, datadir: &Path) {
    if let Err(e) = entry_for_datadir(coin, datadir).delete_credential() {
        tracing::debug!(
            "wallet secrets: clear skipped for {} {}: {e}",
            coin.as_str(),
            datadir.display()
        );
    }
}
