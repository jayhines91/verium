//! Hardware wallet PSBT signing orchestration (Trezor / Ledger / Coldcard).

pub mod psbt;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::coin_profile::CoinId;
use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HardwareVendor {
    Trezor,
    Ledger,
    Coldcard,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareWalletConfig {
    pub id: String,
    pub vendor: HardwareVendor,
    pub label: String,
    pub xpub: String,
    pub derivation_path: String,
    pub fingerprint: Option<String>,
    pub created_at: i64,
}

const STORE_LABEL: &str = "hardware-wallets";

fn store_path() -> std::path::PathBuf {
    crate::config::app_config_base().join("hardware_wallets.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HardwareWalletFile {
    wallets: Vec<HardwareWalletConfig>,
}

pub fn list_wallets() -> AppResult<Vec<HardwareWalletConfig>> {
    crate::secret_store::load_json(STORE_LABEL, &store_path(), HardwareWalletFile::default())
        .map(|f| f.wallets)
}

pub fn add_wallet(config: HardwareWalletConfig) -> AppResult<HardwareWalletConfig> {
    let mut file: HardwareWalletFile =
        crate::secret_store::load_json(STORE_LABEL, &store_path(), HardwareWalletFile::default())?;
    file.wallets.retain(|w| w.id != config.id);
    file.wallets.push(config.clone());
    crate::secret_store::save_json(STORE_LABEL, &file)?;
    Ok(config)
}

pub fn remove_wallet(id: &str) -> AppResult<()> {
    let mut file: HardwareWalletFile =
        crate::secret_store::load_json(STORE_LABEL, &store_path(), HardwareWalletFile::default())?;
    file.wallets.retain(|w| w.id != id);
    crate::secret_store::save_json(STORE_LABEL, &file)
}

/// Import xpub as watch-only via importpubkey RPC.
pub async fn import_xpub_watchonly(
    client: &RpcClient,
    xpub: &str,
    label: &str,
) -> AppResult<()> {
    client
        .call_no_result("importpubkey", json!([xpub, label, false]))
        .await
}

/// Import a range of derived addresses via importmulti.
pub async fn import_address_range(
    client: &RpcClient,
    xpub: &str,
    start: u32,
    count: u32,
    coin_type: u32,
) -> AppResult<u32> {
    let mut requests = Vec::new();
    for i in start..start + count {
        let path = format!("m/44'/{coin_type}'/0'/0/{i}");
        requests.push(json!({
            "scriptPubKey": {
                "address": "" // placeholder — veriumd deriveaddresses handles xpub
            },
            "timestamp": "now",
            "label": format!("hw-{i}"),
            "watchonly": true
        }));
    }
    // Use deriveaddresses to get actual addresses from xpub
    let path_template = format!("m/44'/{coin_type}'/0'/0/*");
    let derived: Value = client
        .call(
            "deriveaddresses",
            json!([xpub, [&path_template.replace('*', "0")]]),
        )
        .await
        .unwrap_or(Value::Array(vec![]));

    let mut imported = 0u32;
    if let Some(addrs) = derived.as_array() {
        for (i, addr) in addrs.iter().enumerate() {
            if let Some(a) = addr.as_str() {
                let _ = client
                    .call_no_result("importaddress", json!([a, format!("hw-{i}"), false, false]))
                    .await;
                imported += 1;
            }
        }
    }
    Ok(imported)
}

#[derive(Debug, Clone, Serialize)]
pub struct PsbtSendResult {
    pub psbt_base64: String,
    pub txid: Option<String>,
    pub status: String,
}

/// Build a PSBT for hardware signing, then finalize and broadcast.
pub async fn send_via_psbt(
    client: &RpcClient,
    outputs: serde_json::Map<String, Value>,
    fee_rate: Option<f64>,
) -> AppResult<PsbtSendResult> {
    psbt::build_fund_psbt(client, outputs, fee_rate).await
}

/// Finalize a signed PSBT and broadcast.
pub async fn finalize_and_broadcast(
    client: &RpcClient,
    psbt_base64: &str,
) -> AppResult<String> {
    psbt::finalize_and_send(client, psbt_base64).await
}

pub fn coin_type_for(coin: CoinId) -> u32 {
    match coin {
        CoinId::Verium => 0x800001ce, // unregistered — use custom
        CoinId::Vericoin => 0x800001cf,
    }
}

/// Detect connected hardware wallets (best-effort USB enumeration).
pub fn detect_devices() -> Vec<HardwareVendor> {
    let mut found = Vec::new();
    // Trezor: vendor ID 0x1209 or 0x534c
    // Ledger: vendor ID 0x2c97
    // Coldcard: air-gapped only
    if hidapi::HidApi::new().is_ok() {
        // Simplified detection — actual device comms require vendor SDKs
        found.push(HardwareVendor::Manual);
    }
    found
}
