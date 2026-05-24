//! Shamir secret sharing for social recovery of the BIP39 mnemonic.

use serde::{Deserialize, Serialize};
use sharks::{Share, Sharks};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShamirShare {
    pub index: u8,
    pub share_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShamirSplitResult {
    pub threshold: u8,
    pub total: u8,
    pub shares: Vec<ShamirShare>,
}

/// Split a BIP39 mnemonic into M-of-N Shamir shares.
pub fn split_mnemonic(
    mnemonic: &str,
    threshold: u8,
    total: u8,
) -> AppResult<ShamirSplitResult> {
    if threshold < 2 || threshold > total || total > 16 {
        return Err(AppError::other(
            "threshold must be 2..=total and total <= 16",
        ));
    }
    let secret_bytes = mnemonic.as_bytes();
    if secret_bytes.is_empty() || secret_bytes.len() > 256 {
        return Err(AppError::other("mnemonic length out of range"));
    }

    let sharks = Sharks(threshold);
    let dealer = sharks.dealer(secret_bytes);
    let mut result_shares = Vec::new();
    for (idx, share) in dealer.take(total as usize).enumerate() {
        let share_bytes = Vec::from(&share);
        let encoded = format!(
            "VRMSHARE-{}-{}-{}",
            threshold,
            idx + 1,
            hex::encode(&share_bytes)
        );
        result_shares.push(ShamirShare {
            index: (idx + 1) as u8,
            share_text: encoded,
        });
    }

    Ok(ShamirSplitResult {
        threshold,
        total,
        shares: result_shares,
    })
}

fn parse_share(text: &str) -> AppResult<(u8, Share)> {
    let trimmed = text.trim();
    let parts: Vec<&str> = trimmed.splitn(4, '-').collect();
    if parts.len() != 4 || parts[0] != "VRMSHARE" {
        return Err(AppError::other(format!("invalid share format: {trimmed}")));
    }
    let threshold: u8 = parts[1]
        .parse()
        .map_err(|_| AppError::other("invalid threshold in share"))?;
    let hex_data = parts[3];
    let bytes = hex::decode(hex_data)
        .map_err(|e| AppError::other(format!("invalid share hex: {e}")))?;
    let share = Share::try_from(bytes.as_slice())
        .map_err(|e| AppError::other(format!("invalid share bytes: {e}")))?;
    Ok((threshold, share))
}

/// Reconstruct a mnemonic from M Shamir shares.
pub fn combine_shares(share_texts: &[String]) -> AppResult<String> {
    if share_texts.len() < 2 {
        return Err(AppError::other("need at least 2 shares to combine"));
    }
    let mut threshold = 0u8;
    let mut shares = Vec::new();
    for text in share_texts {
        let (t, share) = parse_share(text)?;
        if threshold == 0 {
            threshold = t;
        } else if threshold != t {
            return Err(AppError::other("shares have mismatched thresholds"));
        }
        shares.push(share);
    }
    if shares.len() < threshold as usize {
        return Err(AppError::other(format!(
            "need at least {threshold} shares, got {}",
            shares.len()
        )));
    }
    let sharks = Sharks(threshold);
    let secret = sharks
        .recover(&shares)
        .map_err(|e| AppError::other(format!("Shamir combine failed: {e}")))?;
    String::from_utf8(secret.to_vec())
        .map_err(|e| AppError::other(format!("recovered secret is not valid utf8: {e}")))
}
