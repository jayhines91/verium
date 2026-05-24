//! BIP39 mnemonic generation and BIP32 master key derivation for sethdseed RPC.

use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Xpriv};
use bitcoin::Network;
use bitcoin::secp256k1::Secp256k1;
use bitcoin::PrivateKey;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, ZeroizeOnDrop)]
pub struct RecoveryPhraseBundle {
    pub mnemonic: String,
    pub word_count: u32,
}

/// Generate a new 24-word BIP39 mnemonic (256-bit entropy).
pub fn generate_mnemonic() -> AppResult<RecoveryPhraseBundle> {
    let mut entropy = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut entropy);
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
    let xpriv = Xpriv::new_master(Network::Bitcoin, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    Ok(xpriv.to_string())
}

/// Convert master xpriv to WIF for sethdseed RPC (uses mainnet format).
pub fn master_xpriv_to_wif(phrase: &str, bip39_passphrase: Option<&str>) -> AppResult<String> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|e| AppError::other(format!("invalid mnemonic: {e}")))?;
    let seed = mnemonic.to_seed(bip39_passphrase.unwrap_or(""));
    let secp = Secp256k1::new();
    let xpriv = Xpriv::new_master(Network::Bitcoin, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    let pk = PrivateKey {
        compressed: true,
        network: Network::Bitcoin.into(),
        inner: xpriv.private_key,
    };
    Ok(pk.to_wif())
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
        if words[*idx].eq_ignore_ascii_case(answer.trim()) {
            continue;
        }
        return false;
    }
    true
}

/// Derive a child private key WIF at m/44'/coin_type'/0'/0/0 for address preview.
pub fn derive_account_wif(
    phrase: &str,
    bip39_passphrase: Option<&str>,
    coin_type: u32,
    index: u32,
) -> AppResult<String> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|e| AppError::other(format!("invalid mnemonic: {e}")))?;
    let seed = mnemonic.to_seed(bip39_passphrase.unwrap_or(""));
    let secp = Secp256k1::new();
    let xpriv = Xpriv::new_master(Network::Bitcoin, &seed)
        .map_err(|e| AppError::other(format!("master key derivation failed: {e}")))?;
    let path: DerivationPath = format!("m/44'/{coin_type}'/0'/0/{index}")
        .parse()
        .map_err(|e| AppError::other(format!("invalid derivation path: {e}")))?;
    let child = xpriv
        .derive_priv(&secp, &path)
        .map_err(|e| AppError::other(format!("derive failed: {e}")))?;
    let pk = PrivateKey {
        compressed: true,
        network: Network::Bitcoin.into(),
        inner: child.private_key,
    };
    Ok(pk.to_wif())
}

/// Zeroize a string in place (best-effort).
pub fn zeroize_string(s: &mut String) {
    unsafe {
        let bytes = s.as_mut_vec();
        bytes.zeroize();
    }
    s.clear();
}
