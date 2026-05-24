//! PSBT build / sign / broadcast helpers using existing veriumd RPC.

use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};
use crate::hardware_wallet::PsbtSendResult;
use crate::rpc::RpcClient;

pub async fn build_fund_psbt(
    client: &RpcClient,
    outputs: Map<String, Value>,
    fee_rate: Option<f64>,
) -> AppResult<PsbtSendResult> {
    let mut options = Map::new();
    if let Some(rate) = fee_rate {
        options.insert("feeRate".into(), json!(rate));
    }
    let psbt: Value = client
        .call("walletcreatefundedpsbt", json!([[], outputs, 0, options, true]))
        .await?;
    let psbt_base64 = psbt
        .get("psbt")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::other("walletcreatefundedpsbt returned no psbt"))?
        .to_string();
    Ok(PsbtSendResult {
        psbt_base64,
        txid: None,
        status: "awaiting_signature".into(),
    })
}

pub async fn sign_with_wallet(client: &RpcClient, psbt_base64: &str) -> AppResult<String> {
    let signed: Value = client
        .call("walletprocesspsbt", json!([psbt_base64, true, "ALL"]))
        .await?;
    signed
        .get("psbt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::other("walletprocesspsbt returned no psbt"))
}

pub async fn finalize_and_send(client: &RpcClient, psbt_base64: &str) -> AppResult<String> {
    let finalized: Value = client
        .call("finalizepsbt", json!([psbt_base64, true]))
        .await?;
    let complete = finalized
        .get("complete")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !complete {
        return Err(AppError::other(
            "PSBT is not fully signed — import signed PSBT from hardware device",
        ));
    }
    let hex = finalized
        .get("hex")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::other("finalizepsbt returned no hex"))?;
    let txid: String = client.call("sendrawtransaction", json!([hex])).await?;
    Ok(txid)
}

pub async fn combine_psbts(client: &RpcClient, psbts: &[String]) -> AppResult<String> {
    let combined: Value = client.call("combinepsbt", json!([psbts])).await?;
    combined
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::other("combinepsbt returned invalid result"))
}

pub async fn decode_psbt(client: &RpcClient, psbt_base64: &str) -> AppResult<Value> {
    client.call("decodepsbt", json!([psbt_base64])).await
}
