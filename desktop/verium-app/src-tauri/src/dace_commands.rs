// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

//! Tauri command wrappers for Binary Chain v3 (DACE) JSON-RPC.
//!
//! These commands proxy directly to the underlying `vericoind` / `veriumd`
//! RPC surface implemented in `vericoin/src/rpc/dace.cpp`. The desktop UI
//! never composes DACE logic locally — it always reads from the daemon.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::State;

use crate::coin_profile::parse_coin_id;
use crate::commands::{ensure_daemon_running, wait_for_rpc, rpc_reachable};
use crate::config::chain_datadir;
use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;
use crate::state::AppState;

/// `binarychain_status` — DACE activation status, active anchor, stale-coupling
/// indicator, bonded ticket totals, paired-header lag percentiles.
#[tauri::command]
pub async fn binarychain_status(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("binarychain_status", json!([]))
        .await
}

/// `binarychain_metrics` — threat-model counters and gauges.
#[tauri::command]
pub async fn binarychain_metrics(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("binarychain_metrics", json!([]))
        .await
}

/// `binarychain_anchor` — currently activated Joint Anchor in JSON form.
#[tauri::command]
pub async fn binarychain_anchor(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("binarychain_anchor", json!([]))
        .await
}

/// `binarychain_redeem_claim` — construct, sign, and broadcast a claim
/// redemption transaction for a specific leaf. The underlying RPC composes
/// the witness from the activated JA + paired-header storage.
///
/// Returns: { "txid": "..." } on success.
#[tauri::command]
pub async fn binarychain_redeem_claim(
    state: State<'_, AppState>,
    coin: String,
    leaf_hash: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("binarychain_redeem_claim", json!([leaf_hash]))
        .await
}

/// `binarychain_register_ticket` — register a bonded ticket on VRC. Caller
/// supplies the stake outpoint (must be exactly STAKE_UNIT_VRC) and the
/// operator pubkey that will sign committee duties.
#[tauri::command]
pub async fn binarychain_register_ticket(
    state: State<'_, AppState>,
    coin: String,
    stake_outpoint: String,
    operator_pubkey: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call(
            "binarychain_register_ticket",
            json!([stake_outpoint, operator_pubkey]),
        )
        .await
}

/// `binarychain_unbond_ticket` — initiate unbond of an active ticket. Becomes
/// spendable after `UNBOND_DELAY` epochs (see DACE-3).
#[tauri::command]
pub async fn binarychain_unbond_ticket(
    state: State<'_, AppState>,
    coin: String,
    ticket_id: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("binarychain_unbond_ticket", json!([ticket_id]))
        .await
}

/// `binarychain_fund_wallet` — binarytest-only convenience RPC that mines
/// `nblocks` PoW blocks into the loaded wallet (or to an explicit address) so
/// a fresh wallet on the DACE test network has spendable / stakeable funds.
#[tauri::command]
pub async fn binarychain_fund_wallet(
    state: State<'_, AppState>,
    coin: String,
    nblocks: Option<u32>,
    address: Option<String>,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    let n = nblocks.unwrap_or(10);
    let addr = address.unwrap_or_default();
    let cfg = state.config_fresh(coin).await?;
    if !rpc_reachable(coin, &cfg).await {
        ensure_daemon_running(state.inner(), coin, &cfg).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        if !wait_for_rpc(state.inner(), coin, 45).await {
            return Err(AppError::DaemonUnreachable(format!(
                "Could not reach {} on {}:{} (datadir: {})",
                coin.binary_base(),
                cfg.rpc_host,
                cfg.rpc_port,
                chain_datadir(coin, &cfg).display()
            )));
        }
    }
    // Mining N blocks via RPC can take well over the default 8s client timeout.
    let client = RpcClient::from_config_for_coin_with_timeout(
        coin,
        &cfg,
        Duration::from_secs(120),
    )?;
    client
        .call("binarychain_fund_wallet", json!([n, addr]))
        .await
}
