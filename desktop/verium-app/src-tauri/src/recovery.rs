//! BIP39 mnemonic generation and BIP32 master key derivation for sethdseed RPC.
//! WIF encoding uses each chain's Base58 secret-key prefix (see chainparams.cpp).

use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Xpriv};
use bitcoin::secp256k1::Secp256k1;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::coin_profile::CoinId;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, ZeroizeOnDrop)]
pub struct RecoveryPhraseBundle {
    pub mnemonic: String,
    pub word_count: u32,
}

/// Secret-key version byte for Base58Check WIF (must match veriumd `base58Prefixes[SECRET_KEY]`).
pub fn secret_key_prefix(coin: CoinId) -> u8 {
    match coin {
        CoinId::Verium => 198,   // 128 + 70
        CoinId::Vericoin => 239, // 128 + 111
    }
}

fn base58check_encode(version: u8, payload: &[u8]) -> String {
    let mut data = Vec::with_capacity(1 + payload.len() + 4);
    data.push(version);
    data.extend_from_slice(payload);
    let hash1 = Sha256::digest(&data);
    let hash2 = Sha256::digest(hash1);
    data.extend_from_slice(&hash2[..4]);
    bs58::encode(data).into_string()
}

/// Encode a compressed secp256k1 secret as chain-correct WIF for `DecodeSecret` / sethdseed.
pub fn secret_bytes_to_wif(coin: CoinId, secret: &[u8; 32]) -> String {
    let mut payload = Vec::with_capacity(33);
    payload.extend_from_slice(secret);
    payload.push(1); // compressed
    base58check_encode(secret_key_prefix(coin), &payload)
}

/// Generate a new 24-word BIP39 mnemonic (256-bit entropy).
pub fn generate_mnemonic() -> AppResult<RecoveryPhraseBundle> {
    let mut entropy = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| AppError::other(format!("mnemonic generation failed: {e}")))?;
    Ok(RecoveryPhraseBundle {
        mnemonic: mnemonic.to_string(),
        word_count: 24,
    })
}

/// Validate a BIP39 mnemonic (checksum included).
pub fn validate_mnemonic(phrase: &str) -> AppResult<bool> {
    match Mnemonic::parse_in(Language::English, phrase.trim()) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Derive the BIP32 master extended private key from a mnemonic + optional BIP39 passphrase.
pub fn derive_master_xpriv(
    phrase: &str,
    bip39_passphrase: Option<&str>,
) -> AppResult<String> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|e| AppError::other(format!("invalid mnemonic: {e}")))?;
    let seed = mnemonic.to_seed(bip39_passphrase.unwrap_or(""));
    let secp = Secp256k1::new();
    let xpriv = Xpriv::new_master(bitcoin::NetworkKind::Main, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    Ok(xpriv.to_string())
}

/// Derive master private key WIF in the chain's native format for sethdseed.
pub fn master_xpriv_to_wif(
    coin: CoinId,
    phrase: &str,
    bip39_passphrase: Option<&str>,
) -> AppResult<String> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|e| AppError::other(format!("invalid mnemonic: {e}")))?;
    let seed = mnemonic.to_seed(bip39_passphrase.unwrap_or(""));
    let secp = Secp256k1::new();
    let xpriv = Xpriv::new_master(bitcoin::NetworkKind::Main, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    Ok(secret_bytes_to_wif(coin, &xpriv.private_key.secret_bytes()))
}

/// Pick random word indices (0-based) for verification challenge.
pub fn verification_indices(word_count: u32, count: usize) -> Vec<usize> {
    use rand::seq::SliceRandom;
    let mut indices: Vec<usize> = (0..word_count as usize).collect();
    let mut rng = rand::thread_rng();
    indices.shuffle(&mut rng);
    indices.truncate(count.min(word_count as usize));
    indices.sort_unstable();
    indices
}

/// Verify user-supplied words at given indices.
pub fn verify_words_at_indices(
    phrase: &str,
    indices: &[usize],
    answers: &[String],
) -> bool {
    let words: Vec<&str> = phrase.split_whitespace().collect();
    if indices.len() != answers.len() {
        return false;
    }
    for (idx, answer) in indices.iter().zip(answers.iter()) {
        if *idx >= words.len() {
            return false;
        }
        if !words[*idx].eq_ignore_ascii_case(answer.trim()) {
            return false;
        }
    }
    true
}

/// Derive a child private key WIF at m/44'/coin_type'/0'/0/0 for address preview.
pub fn derive_account_wif(
    coin: CoinId,
    phrase: &str,
    bip39_passphrase: Option<&str>,
    coin_type: u32,
    index: u32,
) -> AppResult<String> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|e| AppError::other(format!("invalid mnemonic: {e}")))?;
    let seed = mnemonic.to_seed(bip39_passphrase.unwrap_or(""));
    let secp = Secp256k1::new();
    let xpriv = Xpriv::new_master(bitcoin::NetworkKind::Main, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    let path: DerivationPath = format!("m/44'/{coin_type}'/0'/0/{index}")
        .parse()
        .map_err(|e| AppError::other(format!("invalid derivation path: {e}")))?;
    let child = xpriv
        .derive_priv(&secp, &path)
        .map_err(|e| AppError::other(format!("derive failed: {e}")))?;
    Ok(secret_bytes_to_wif(coin, &child.private_key.secret_bytes()))
}

/// Zeroize a string in place (best-effort).
pub fn zeroize_string(s: &mut String) {
    unsafe {
        let bytes = s.as_mut_vec();
        bytes.zeroize();
    }
    s.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verium_wif_uses_198_prefix() {
        let wif = secret_bytes_to_wif(CoinId::Verium, &[1u8; 32]);
        let decoded = bs58::decode(&wif).with_check(None).into_vec().unwrap();
        assert_eq!(decoded[0], 198);
        assert_eq!(decoded.len(), 1 + 32 + 1); // version + secret + compressed flag
        assert_eq!(decoded[33], 1);
    }

    #[test]
    fn vericoin_wif_uses_239_prefix() {
        let wif = secret_bytes_to_wif(CoinId::Vericoin, &[2u8; 32]);
        let decoded = bs58::decode(&wif).with_check(None).into_vec().unwrap();
        assert_eq!(decoded[0], 239);
        assert_eq!(decoded.len(), 34);
    }
}
