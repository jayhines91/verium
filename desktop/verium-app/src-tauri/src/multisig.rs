//! Multisig wallet configuration and PSBT cosigner routing.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigCosigner {
    pub id: String,
    pub label: String,
    pub xpub: String,
    pub derivation_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigWalletConfig {
    pub id: String,
    pub label: String,
    pub required_sigs: u32,
    pub total_cosigners: u32,
    pub cosigners: Vec<MultisigCosigner>,
    pub multisig_address: Option<String>,
    pub created_at: i64,
}

const STORE_LABEL: &str = "multisig-wallets";

fn store_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("multisig_wallets.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MultisigFile {
    wallets: Vec<MultisigWalletConfig>,
}

pub fn list() -> AppResult<Vec<MultisigWalletConfig>> {
    crate::secret_store::load_json(STORE_LABEL, &store_path(), MultisigFile::default())
        .map(|f| f.wallets)
}

pub fn save_wallet(wallet: MultisigWalletConfig) -> AppResult<MultisigWalletConfig> {
    let mut file: MultisigFile =
        crate::secret_store::load_json(STORE_LABEL, &store_path(), MultisigFile::default())?;
    file.wallets.retain(|w| w.id != wallet.id);
    file.wallets.push(wallet.clone());
    crate::secret_store::save_json(STORE_LABEL, &file)?;
    Ok(wallet)
}

pub fn remove(id: &str) -> AppResult<()> {
    let mut file: MultisigFile =
        crate::secret_store::load_json(STORE_LABEL, &store_path(), MultisigFile::default())?;
    file.wallets.retain(|w| w.id != id);
    crate::secret_store::save_json(STORE_LABEL, &file)
}

/// Create a multisig address via addmultisigaddress RPC.
pub async fn create_multisig_address(
    client: &RpcClient,
    required: u32,
    pubkeys: Vec<String>,
    label: &str,
) -> AppResult<String> {
    let addr: String = client
        .call("addmultisigaddress", json!([required, pubkeys, label]))
        .await?;
    Ok(addr)
}

#[derive(Debug, Clone, Serialize)]
pub struct MultisigPsbtStatus {
    pub psbt_base64: String,
    pub signatures_received: u32,
    pub signatures_required: u32,
    pub complete: bool,
}

pub async fn build_multisig_psbt(
    client: &RpcClient,
    outputs: serde_json::Map<String, serde_json::Value>,
    fee_rate: Option<f64>,
) -> AppResult<String> {
    let mut options = serde_json::Map::new();
    if let Some(rate) = fee_rate {
        options.insert("feeRate".into(), json!(rate));
    }
    let psbt: serde_json::Value = client
        .call("walletcreatefundedpsbt", json!([[], outputs, 0, options, true]))
        .await?;
    psbt.get("psbt")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::other("no psbt returned"))
}

pub async fn add_cosigner_signature(
    client: &RpcClient,
    psbt_base64: &str,
) -> AppResult<MultisigPsbtStatus> {
    let processed: serde_json::Value = client
        .call("walletprocesspsbt", json!([psbt_base64, true, "ALL"]))
        .await?;
    let complete = processed
        .get("complete")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let psbt = processed
        .get("psbt")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(psbt_base64)
        .to_string();
    Ok(MultisigPsbtStatus {
        psbt_base64: psbt,
        signatures_received: if complete { 2 } else { 1 },
        signatures_required: 2,
        complete,
    })
}
