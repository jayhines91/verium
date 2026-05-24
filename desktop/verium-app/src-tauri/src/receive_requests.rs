//! Encrypted receive-request history (replaces browser localStorage).

use serde::{Deserialize, Serialize};

use crate::coin_profile::CoinId;
use crate::config::app_config_base;
use crate::error::AppResult;
use crate::secret_store;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiveRequest {
    pub id: String,
    pub created_at: i64,
    pub label: String,
    pub message: String,
    pub amount: Option<f64>,
    pub address: String,
}

fn label_for(coin: CoinId) -> String {
    format!("receive-requests-{}", coin.as_str())
}

fn legacy_path(coin: CoinId) -> std::path::PathBuf {
    app_config_base().join(format!("receive-requests-{}.json", coin.as_str()))
}

pub fn list(coin: CoinId) -> AppResult<Vec<ReceiveRequest>> {
    secret_store::load_json(&label_for(coin), &legacy_path(coin), Vec::new())
}

pub fn save_all(coin: CoinId, requests: &[ReceiveRequest]) -> AppResult<()> {
    secret_store::save_json(&label_for(coin), requests)
}
