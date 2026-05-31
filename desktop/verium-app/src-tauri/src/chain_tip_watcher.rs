//! Background per-coin watcher that long-polls the local node for new chain
//! tips and pushes them to the UI via the `chain-tip-changed` event. This
//! replaces explorer polling for live block updates: the desktop app always
//! runs a node, and `waitfornewblock` wakes the moment any block is connected.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::coin_profile::CoinId;
use crate::commands::rpc_reachable;
use crate::explorer_api::{invalidate_blocks_cache, ExplorerBlock};
use crate::rpc::RpcClient;
use crate::state::AppState;

/// Long-poll window passed to `waitfornewblock`. The node returns the current
/// tip on timeout, so we re-evaluate roughly this often even when idle.
const WAIT_TIMEOUT_MS: u64 = 50_000;

/// HTTP timeout for the watcher client. Must comfortably exceed the long-poll
/// window since `waitfornewblock` holds the request open until it fires.
const WATCHER_RPC_TIMEOUT: Duration = Duration::from_secs(70);

/// Backoff while the node is unreachable or a call fails.
const RETRY_BACKOFF: Duration = Duration::from_secs(5);

/// Idle wait when the coin is disabled in preferences.
const DISABLED_BACKOFF: Duration = Duration::from_secs(30);

/// Spawn one watcher task per coin. Each task runs for the app lifetime,
/// reconnecting on its own when the node restarts.
pub fn spawn_chain_tip_watchers(app: AppHandle, state: AppState) {
    for coin in CoinId::all() {
        let app = app.clone();
        let state = state.clone();
        let coin = *coin;
        tauri::async_runtime::spawn(async move {
            watch_loop(app, state, coin).await;
        });
    }
}

async fn watch_loop(app: AppHandle, state: AppState, coin: CoinId) {
    let mut last_hash: Option<String> = None;

    loop {
        let prefs = crate::prefs::load().await.unwrap_or_default();
        if !crate::prefs::coin_enabled(&prefs, coin) {
            sleep(DISABLED_BACKOFF).await;
            continue;
        }

        let cfg = match state.config_fresh(coin).await {
            Ok(c) => c,
            Err(_) => {
                sleep(RETRY_BACKOFF).await;
                continue;
            }
        };

        if !rpc_reachable(coin, &cfg).await {
            sleep(RETRY_BACKOFF).await;
            continue;
        }

        let client = match RpcClient::from_config_for_coin_with_timeout(
            coin,
            &cfg,
            WATCHER_RPC_TIMEOUT,
        ) {
            Ok(c) => c,
            Err(_) => {
                sleep(RETRY_BACKOFF).await;
                continue;
            }
        };

        match current_tip(&client).await {
            Some((height, hash)) if last_hash.as_deref() != Some(hash.as_str()) => {
                emit_tip(&app, &client, coin, height, &hash).await;
                last_hash = Some(hash);
                // Re-evaluate immediately in case several blocks arrived close
                // together (or the explorer is several blocks behind).
                continue;
            }
            Some(_) => {
                // Tip unchanged: block until the node reports a new one.
                wait_for_new_block(&client).await;
            }
            None => {
                sleep(RETRY_BACKOFF).await;
            }
        }
    }
}

/// Fetch the current tip cheaply via `getblockchaininfo`.
async fn current_tip(client: &RpcClient) -> Option<(u64, String)> {
    let info: Value = client.call("getblockchaininfo", json!([])).await.ok()?;
    let height = info.get("blocks").and_then(Value::as_u64)?;
    let hash = info
        .get("bestblockhash")
        .and_then(Value::as_str)?
        .to_string();
    Some((height, hash))
}

/// Block until the node connects a new tip (or the long-poll times out).
async fn wait_for_new_block(client: &RpcClient) {
    let _: Result<Value, _> = client
        .call("waitfornewblock", json!([WAIT_TIMEOUT_MS]))
        .await;
}

async fn emit_tip(
    app: &AppHandle,
    client: &RpcClient,
    coin: CoinId,
    height: u64,
    hash: &str,
) {
    let block = fetch_block_detail(client, height, hash).await;
    let time = block.as_ref().map(|b| b.time).unwrap_or(0);

    // Let the next explorer fetch bypass the 30s cache so enrichment
    // (miner address, reward) lands quickly behind the instant node row.
    invalidate_blocks_cache(coin).await;

    let payload = json!({
        "coin": coin.as_str(),
        "height": height,
        "hash": hash,
        "time": time,
        "block": block,
    });
    let _ = app.emit("chain-tip-changed", payload);
}

/// Build an `ExplorerBlock`-shaped row entirely from the node. Verbosity 2
/// returns full transactions, so we derive the "Out" (total output value) and
/// "Extracted by" (coinbase/coinstake address) columns locally — no waiting on
/// the explorer to index the block. Explorer enrichment still runs behind this
/// to confirm/backfill, but the row is complete the moment the block arrives.
async fn fetch_block_detail(
    client: &RpcClient,
    height: u64,
    hash: &str,
) -> Option<ExplorerBlock> {
    let block: Value = client.call("getblock", json!([hash, 2])).await.ok()?;
    let time = block.get("time").and_then(Value::as_u64).unwrap_or(0);
    let txs = block.get("tx").and_then(Value::as_array);
    let n_tx = block
        .get("nTx")
        .and_then(Value::as_u64)
        .or_else(|| txs.map(|a| a.len() as u64));
    let difficulty = block
        .get("difficulty")
        .and_then(Value::as_f64)
        .map(|d| d.to_string());
    let size = block
        .get("strippedsize")
        .and_then(Value::as_u64)
        .or_else(|| block.get("size").and_then(Value::as_u64));
    let mint = block
        .get("mint")
        .and_then(Value::as_f64)
        .filter(|m| *m > 0.0)
        .map(|m| format!("{m:.8}"));

    let (output_total, output_count, miner_address) = txs
        .map(|t| extract_block_outputs(t))
        .unwrap_or((None, None, None));

    Some(ExplorerBlock {
        id: height,
        hash: hash.to_string(),
        height,
        time,
        mint,
        difficulty,
        n_tx,
        miner_address,
        size,
        output_total,
        output_count,
    })
}

/// Sum every output value in the block (matches the explorer's total-output
/// column) and pick the extraction address: the largest-value output of the
/// first transaction that pays out (coinbase for PoW, coinstake for PoS).
fn extract_block_outputs(txs: &[Value]) -> (Option<String>, Option<u64>, Option<String>) {
    let mut total: f64 = 0.0;
    let mut output_count: u64 = 0;
    let mut miner: Option<String> = None;

    for tx in txs {
        let Some(vout) = tx.get("vout").and_then(Value::as_array) else {
            continue;
        };

        let mut best_value = -1.0_f64;
        let mut best_addr: Option<String> = None;
        for out in vout {
            let value = out.get("value").and_then(Value::as_f64).unwrap_or(0.0);
            total += value;
            output_count += 1;
            if miner.is_none() && value > best_value {
                if let Some(addr) = out
                    .get("scriptPubKey")
                    .and_then(|s| s.get("addresses"))
                    .and_then(Value::as_array)
                    .and_then(|a| a.first())
                    .and_then(Value::as_str)
                    .or_else(|| {
                        out.get("scriptPubKey")
                            .and_then(|s| s.get("address"))
                            .and_then(Value::as_str)
                    })
                {
                    best_value = value;
                    best_addr = Some(addr.to_string());
                }
            }
        }

        if miner.is_none() {
            miner = best_addr;
        }
    }

    let output_total = (total > 0.0).then(|| format!("{total:.8}"));
    let output_count = (output_count > 0).then_some(output_count);
    (output_total, output_count, miner)
}
