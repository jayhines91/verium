use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::addressbook::{self, AddressBookEntry};
use crate::bootstrap::{cancel_bootstrap as request_bootstrap_cancel, import_bootstrap as run_import_bootstrap, BootstrapResult};
use crate::coin_profile::{
    all_profile_summaries, assert_vericoin, assert_verium, parse_coin_id, CoinId,
};
use crate::config::{
    apply_partial_to_config, ensure_first_run_config, generate_rpc_password, refresh_config_paths,
    rpc_auth_diagnostics, save_app_daemon_config, is_live_wallet_destination,
    path_for_veriumd_rpc, resolve_wallet_dat_path, suggested_wallet_backup_path,
    wallet_backup_dir, wallet_dat_exists, wallet_dat_path,
    write_node_conf_overrides, read_node_conf_file, node_conf_backup_path,
    clear_wallet_bdb_environment, node_conf_path, write_node_conf_file, DaemonConfig,
    PartialDaemonConfig, RpcAuthDiagnostics,
};
use crate::daemon::{bundled_sidecar_available, binary_missing_hint, detect_binary, force_stop_native_daemon, DaemonBinaryStatus};
use crate::error::{AppError, AppResult, is_rpc_warmup};
use crate::explorer_api::{
    fetch_blocks, fetch_chain_tips, fetch_extraction, fetch_explorer_peers, fetch_network_stats,
    fetch_transactions, ExplorerBlock, ExplorerChainTip, ExplorerExtractionEntry, ExplorerPeerEntry,
    ExplorerStats, ExplorerTransaction, EXPLORER_API_ENABLED, explorer_logo_url,
};
use crate::logs::{
    detect_chain_corruption, detect_datadir_lock_conflict, detect_sync_stall,
    is_timestamp_rule_failure, tail_debug_log,
};
use crate::prefs::{self, PartialUserPreferences, UserPreferences};
use crate::rpc::RpcClient;
use crate::state::{AppState, EarnLocalState, MinerLocalState};
use crate::updates::{check_for_updates as run_update_check, UpdateInfo};
use crate::wallet_secrets::{
    self, is_forever_unlock_duration, WALLET_UNLOCK_FOREVER_SECONDS,
};
use crate::wsl::{
    detect_wsl_datadirs, find_verium_repo_root, is_wsl_unc_path,
    rebuild_wsl_veriumd_validation_fix as wsl_rebuild_veriumd_validation_fix,
    restart_wsl_veriumd_datadir, start_wsl_veriumd_datadir, unc_to_linux_path, wsl_restart_hint, wsl_rpc_credentials_stale_datadir,
    wsl_start_veriumd_if_stopped_datadir, wsl_stop_veriumd_force_datadir,
    wsl_veriumd_running_datadir, VeriumdStartMode, WslDatadirCandidate, DEFAULT_WSL_REPO_ROOT,
};

async fn stop_inner(state: &AppState, coin: CoinId) -> AppResult<()> {
    let cfg = state.config(coin).await?;
    let binary = coin.binary_base();

    if coin == CoinId::Verium {
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("minerstop", json!([])).await;
        }
    } else if coin == CoinId::Vericoin {
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("stakingstop", json!([])).await;
        }
    }

    if is_wsl_unc_path(&cfg.datadir) {
        wsl_stop_veriumd_force_datadir(&cfg.datadir);
    } else if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("stop", json!([])).await;
        state
            .daemon(coin)?
            .wait_for_child_exit(std::time::Duration::from_secs(30))
            .await;
        wait_for_rpc_down(&cfg, std::time::Duration::from_secs(30)).await;
    }
    state.daemon(coin)?.force_kill_child().await;
    if rpc_reachable(&cfg).await {
        tracing::warn!("stop: {binary} still reachable after graceful stop; forcing exit");
        force_stop_native_daemon(coin);
        wait_for_rpc_down(&cfg, std::time::Duration::from_secs(10)).await;
    }
    state.daemon(coin)?.clear_tracking().await;
    Ok(())
}

/// Stop earn mode and daemons when the wallet UI closes.
pub async fn shutdown_daemon_on_app_exit(state: &AppState) {
    let prefs = prefs::load().await.unwrap_or_default();
    for coin in CoinId::all() {
        if !prefs::coin_enabled(&prefs, *coin) {
            continue;
        }
        let cfg = match state.config_fresh(*coin).await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("shutdown ({}): config load failed: {e}", coin.as_str());
                continue;
            }
        };

        let bundled = bundled_sidecar_available(*coin);
        let wsl = is_wsl_unc_path(&cfg.datadir);
        let managed = match state.daemon(*coin) {
            Ok(d) => d.is_managed().await,
            Err(_) => false,
        };
        let rpc_up = rpc_reachable(&cfg).await;

        let should_stop = if bundled {
            true
        } else {
            managed || rpc_up
        };

        if !should_stop {
            tracing::debug!("shutdown ({}): no managed daemon to stop", coin.as_str());
            continue;
        }

        tracing::info!("shutdown ({}): stopping earn mode and daemon", coin.as_str());
        if let Err(e) = stop_inner(state, *coin).await {
            tracing::warn!("shutdown ({}): stop failed: {e}", coin.as_str());
        }

        if wsl && wsl_veriumd_running_datadir(&cfg.datadir) {
            wsl_stop_veriumd_force_datadir(&cfg.datadir);
        }
    }
}

async fn wait_for_rpc_down(cfg: &DaemonConfig, timeout: std::time::Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if !rpc_reachable(cfg).await {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

async fn rpc_reachable(cfg: &DaemonConfig) -> bool {
    let Ok(client) = crate::rpc::RpcClient::from_config(cfg) else {
        return false;
    };
    match client
        .call::<Value>("getblockchaininfo", json!([]))
        .await
    {
        Ok(_) => true,
        Err(AppError::Rpc { code, .. }) if is_rpc_warmup(code) => true,
        _ => false,
    }
}

async fn start_inner(state: &AppState, coin: CoinId) -> AppResult<()> {
    let cfg = state.config(coin).await?;
    let binary = coin.binary_base();
    if is_wsl_unc_path(&cfg.datadir) {
        if wsl_start_veriumd_if_stopped_datadir(&cfg.datadir, default_wsl_repo_root())? {
            state.daemon(coin)?.mark_managed().await;
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        return Ok(());
    }
    if rpc_reachable(&cfg).await {
        tracing::info!("start: {binary} already running for this datadir");
        return Ok(());
    }
    let daemon = state.daemon(coin)?;
    if daemon.is_managed().await {
        if daemon.child_running().await {
            tracing::debug!("start: {binary} already spawned this session (waiting for RPC)");
            return Ok(());
        }
        tracing::warn!("start: {binary} exited after spawn; retrying");
        daemon.clear_tracking().await;
    }
    let lines = tail_debug_log(&cfg.datadir, 40).await.unwrap_or_default();
    if let Some(message) = detect_datadir_lock_conflict(&lines) {
        return Err(AppError::other(message));
    }
    let _pid = state.daemon(coin)?.start(&cfg, &[]).await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeStatus {
    pub connected: bool,
    /// RPC responds but veriumd is still loading chain index / verifying blocks.
    pub warming_up: bool,
    pub chain: Option<String>,
    pub blocks: Option<u64>,
    pub headers: Option<u64>,
    pub verification_progress: Option<f64>,
    pub initial_block_download: Option<bool>,
    pub connections: Option<u64>,
    pub warnings: Option<String>,
    pub version: Option<i64>,
    pub subversion: Option<String>,
    /// Human-readable connection problem (e.g. unauthorized, connection refused).
    pub error: Option<String>,
    /// Recent debug.log shows chain corruption (bad block / VerifyDB failure).
    pub chain_corrupt: bool,
    pub chain_repair_detail: Option<String>,
    /// Node is connected but cannot accept new blocks (timestamp validation bug in WSL build).
    pub sync_stalled: bool,
    pub sync_stall_detail: Option<String>,
}

#[tauri::command]
pub async fn get_node_status(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<NodeStatus> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config(coin).await?;
    let status = match state.rpc_client(coin).await {
        Ok(client) => match client.call::<Value>("getblockchaininfo", json!([])).await {
            Ok(chain_info) => {
                let network_info: Value = client
                    .call("getnetworkinfo", json!([]))
                    .await
                    .unwrap_or(Value::Null);
                NodeStatus {
                    connected: true,
                    warming_up: false,
                    chain: chain_info
                        .get("chain")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    blocks: chain_info.get("blocks").and_then(Value::as_u64),
                    headers: chain_info.get("headers").and_then(Value::as_u64),
                    verification_progress: chain_info
                        .get("verificationprogress")
                        .and_then(Value::as_f64),
                    initial_block_download: chain_info
                        .get("initialblockdownload")
                        .and_then(Value::as_bool),
                    connections: network_info.get("connections").and_then(Value::as_u64),
                    warnings: chain_info
                        .get("warnings")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    version: network_info.get("version").and_then(Value::as_i64),
                    subversion: network_info
                        .get("subversion")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    error: None,
                    chain_corrupt: false,
                    chain_repair_detail: None,
                    sync_stalled: false,
                    sync_stall_detail: None,
                }
            }
            Err(AppError::DaemonUnreachable(msg)) => {
                let error = binary_missing_hint(coin).or(Some(msg));
                disconnected(error)
            }
            Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => warming_up(message),
            Err(e) => return Err(e),
        },
        Err(AppError::DaemonUnreachable(msg)) => {
            let error = binary_missing_hint(coin).or(Some(msg));
            disconnected(error)
        }
        Err(e) => return Err(e),
    };
    Ok(enrich_status_from_log(status, &cfg.datadir).await)
}

async fn enrich_status_from_log(mut status: NodeStatus, datadir: &std::path::Path) -> NodeStatus {
    let lines = tail_debug_log(datadir, 80).await.unwrap_or_default();

    if !status.connected || status.warming_up {
        if let Some(detail) = detect_chain_corruption(&lines) {
            status.chain_corrupt = true;
            status.chain_repair_detail = Some(detail.clone());
            if is_timestamp_rule_failure(&detail) {
                status.error = Some(
                    "veriumd rejected valid mainnet blocks during startup verification. \
                     Restart the node from Settings (the app passes -checklevel=0)."
                        .into(),
                );
            } else if status.error.is_none() {
                status.error = Some(
                    "Chain data failed verification. Re-import bootstrap in Settings.".into(),
                );
            }
        }
        return status;
    }

    let lag = status
        .headers
        .unwrap_or(0)
        .saturating_sub(status.blocks.unwrap_or(0));
    if lag > 0 {
        if let Some(detail) = detect_sync_stall(&lines) {
            status.sync_stalled = true;
            status.sync_stall_detail = Some(detail);
        }
    }
    status
}

fn warming_up(message: String) -> NodeStatus {
    NodeStatus {
        connected: true,
        warming_up: true,
        chain: None,
        blocks: None,
        headers: None,
        verification_progress: None,
        initial_block_download: None,
        connections: None,
        warnings: None,
        version: None,
        subversion: None,
        error: Some(message),
        chain_corrupt: false,
        chain_repair_detail: None,
        sync_stalled: false,
        sync_stall_detail: None,
    }
}

fn disconnected(error: Option<String>) -> NodeStatus {
    NodeStatus {
        connected: false,
        warming_up: false,
        chain: None,
        blocks: None,
        headers: None,
        verification_progress: None,
        initial_block_download: None,
        connections: None,
        warnings: None,
        version: None,
        subversion: None,
        error,
        chain_corrupt: false,
        chain_repair_detail: None,
        sync_stalled: false,
        sync_stall_detail: None,
    }
}

#[tauri::command]
pub async fn get_blockchain_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("getblockchaininfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_network_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("getnetworkinfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_peer_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("getpeerinfo", json!([]))
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddedNodeInfo {
    pub addednode: String,
    pub connected: bool,
}

#[tauri::command]
pub async fn get_added_node_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Vec<AddedNodeInfo>> {
    let coin = parse_coin_id(&coin)?;
    let raw: Value = state
        .rpc_client(coin)
        .await?
        .call("getaddednodeinfo", json!([]))
        .await?;
    let arr = raw.as_array().cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|item| {
            Some(AddedNodeInfo {
                addednode: item.get("addednode")?.as_str()?.to_string(),
                connected: item.get("connected")?.as_bool()?,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn add_node(
    state: State<'_, AppState>,
    coin: String,
    node: String,
    command: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let cmd = match command.as_str() {
        "add" | "onetry" | "remove" => command,
        _ => {
            return Err(AppError::other(
                "command must be add, onetry, or remove",
            ))
        }
    };
    state
        .rpc_client(coin)
        .await?
        .call_no_result("addnode", json!([node, cmd]))
        .await
}

#[tauri::command]
pub async fn get_mining_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("getmininginfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_wallet_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Option<Value>> {
    let coin = parse_coin_id(&coin)?;
    let client = state.rpc_client(coin).await?;
    match client.call::<Value>("getwalletinfo", json!([])).await {
        Ok(v) => Ok(Some(v)),
        Err(AppError::Rpc { code, .. }) if code == -18 || code == -19 => Ok(None),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_new_address(
    state: State<'_, AppState>,
    coin: String,
    label: Option<String>,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let params = match label {
        Some(l) if !l.is_empty() => json!([l]),
        _ => json!([]),
    };
    state
        .rpc_client(coin)
        .await?
        .call("getnewaddress", params)
        .await
}

#[tauri::command]
pub async fn list_transactions(
    state: State<'_, AppState>,
    coin: String,
    count: Option<u32>,
    skip: Option<u32>,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    let client = state.rpc_client(coin).await?;
    let params = json!(["*", count.unwrap_or(25), skip.unwrap_or(0)]);
    let mut value: Value = client.call("listtransactions", params).await?;
    enrich_transaction_block_heights(&client, &mut value).await?;
    Ok(value)
}

/// Verium `listtransactions` exposes `blockhash` but not `blockheight` (unlike
/// newer Bitcoin Core). The desktop UI keys block-found detection on height.
async fn enrich_transaction_block_heights(
    client: &RpcClient,
    value: &mut Value,
) -> AppResult<()> {
    let Some(rows) = value.as_array_mut() else {
        return Ok(());
    };

    let mut hashes = HashSet::new();
    for tx in rows.iter() {
        if tx.get("blockheight").is_some() {
            continue;
        }
        if let Some(hash) = tx.get("blockhash").and_then(Value::as_str) {
            hashes.insert(hash.to_string());
        }
    }

    let mut height_by_hash: HashMap<String, u64> = HashMap::new();
    for hash in hashes {
        match client
            .call::<Value>("getblock", json!([hash, 1]))
            .await
        {
            Ok(block) => {
                if let Some(height) = block.get("height").and_then(Value::as_u64) {
                    height_by_hash.insert(hash, height);
                }
            }
            Err(e) => tracing::debug!("list_transactions: getblock {hash}: {e}"),
        }
    }

    for tx in rows.iter_mut() {
        if tx.get("blockheight").is_some() {
            continue;
        }
        let Some(hash) = tx.get("blockhash").and_then(Value::as_str) else {
            continue;
        };
        let Some(height) = height_by_hash.get(hash) else {
            continue;
        };
        if let Some(obj) = tx.as_object_mut() {
            obj.insert("blockheight".to_string(), json!(height));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_address_groupings(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Vec<String>> {
    let coin = parse_coin_id(&coin)?;
    let value: Value = state
        .rpc_client(coin)
        .await?
        .call("listaddressgroupings", json!([]))
        .await?;

    let mut addresses = Vec::new();
    if let Some(groups) = value.as_array() {
        for group in groups {
            if let Some(entries) = group.as_array() {
                for entry in entries {
                    if let Some(pair) = entry.as_array() {
                        if let Some(addr) = pair.first().and_then(|v| v.as_str()) {
                            addresses.push(addr.to_string());
                        }
                    }
                }
            }
        }
    }
    addresses.sort();
    addresses.dedup();
    Ok(addresses)
}

#[tauri::command]
pub async fn miner_start(
    state: State<'_, AppState>,
    coin: String,
    threads: u32,
) -> AppResult<MinerLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_verium(coin)?;
    let _: Value = state
        .rpc_client(coin)
        .await?
        .call("minerstart", json!([threads]))
        .await?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .ok();
    let next = EarnLocalState {
        active: true,
        threads,
        started_at: now,
    };
    state.set_earn(coin, next.clone()).await?;
    Ok(next)
}

#[tauri::command]
pub async fn miner_stop(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<MinerLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_verium(coin)?;
    let _: Value = state
        .rpc_client(coin)
        .await?
        .call("minerstop", json!([]))
        .await?;
    let next = EarnLocalState::default();
    state.set_earn(coin, next.clone()).await?;
    Ok(next)
}

#[tauri::command]
pub async fn get_miner_state(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<MinerLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_verium(coin)?;
    Ok(state.earn(coin).await?)
}

#[tauri::command]
pub async fn staking_start(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<EarnLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_vericoin(coin)?;
    let _: Value = state
        .rpc_client(coin)
        .await?
        .call("stakingstart", json!([]))
        .await?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .ok();
    let next = EarnLocalState {
        active: true,
        threads: 0,
        started_at: now,
    };
    state.set_earn(coin, next.clone()).await?;
    Ok(next)
}

#[tauri::command]
pub async fn staking_stop(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<EarnLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_vericoin(coin)?;
    let _: Value = state
        .rpc_client(coin)
        .await?
        .call("stakingstop", json!([]))
        .await?;
    let next = EarnLocalState::default();
    state.set_earn(coin, next.clone()).await?;
    Ok(next)
}

#[tauri::command]
pub async fn get_staking_state(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<EarnLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_vericoin(coin)?;
    Ok(state.earn(coin).await?)
}

#[tauri::command]
pub async fn reserve_balance_set(
    state: State<'_, AppState>,
    coin: String,
    amount: f64,
) -> AppResult<bool> {
    let coin = parse_coin_id(&coin)?;
    assert_vericoin(coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("reservebalance", json!([amount]))
        .await
}

#[tauri::command]
pub async fn wallet_unlock(
    state: State<'_, AppState>,
    coin: String,
    passphrase: String,
    timeout_seconds: i64,
    minting_only: Option<bool>,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    let client = state.rpc_client(coin).await?;
    let params = if minting_only.unwrap_or(false) {
        json!([passphrase, timeout_seconds, true])
    } else {
        json!([passphrase, timeout_seconds])
    };
    client.call_no_result("walletpassphrase", params).await?;

    if is_forever_unlock_duration(timeout_seconds.max(0) as u32) {
        wallet_secrets::store_passphrase(coin, &cfg.datadir, &passphrase)?;
    } else {
        wallet_secrets::clear_passphrase(coin, &cfg.datadir);
    }
    Ok(())
}

#[tauri::command]
pub async fn wallet_lock(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    wallet_secrets::clear_passphrase(coin, &cfg.datadir);
    state
        .rpc_client(coin)
        .await?
        .call_no_result("walletlock", json!([]))
        .await
}

#[tauri::command]
pub async fn try_auto_unlock_wallet(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<bool> {
    let coin = parse_coin_id(&coin)?;
    let prefs = prefs::load().await?;
    let duration = prefs::wallet_unlock_duration_for(&prefs, coin);
    if !is_forever_unlock_duration(duration) {
        return Ok(false);
    }

    let cfg = state.config_fresh(coin).await?;
    let Some(passphrase) = wallet_secrets::load_passphrase(coin, &cfg.datadir)? else {
        tracing::debug!(
            "wallet: no OS keychain entry for {} ({})",
            coin.as_str(),
            cfg.datadir.display()
        );
        return Ok(false);
    };

    let client = state.rpc_client(coin).await?;
    let info: Value = match client.call("getwalletinfo", json!([])).await {
        Ok(v) => v,
        Err(AppError::Rpc { code, .. }) if code == -18 || code == -19 => return Ok(false),
        Err(e) => return Err(e),
    };

    if !wallet_info_is_locked(&info) {
        return Ok(false);
    }

    client
        .call_no_result(
            "walletpassphrase",
            json!([passphrase, WALLET_UNLOCK_FOREVER_SECONDS]),
        )
        .await?;
    tracing::info!("wallet: auto-unlocked from OS secure storage (forever preference)");
    Ok(true)
}

fn wallet_info_is_locked(info: &Value) -> bool {
    let Some(until) = info.get("unlocked_until").and_then(Value::as_i64) else {
        return false;
    };
    if until == 0 {
        return true;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    until <= now
}

#[derive(Debug, Clone, Serialize)]
pub struct WalletCreateResult {
    pub success: bool,
    pub message: String,
    /// True if the daemon shut down after `encryptwallet` (Bitcoin-Core
    /// historical behavior). Callers must restart the daemon and reconnect.
    pub daemon_stopped: bool,
}

#[tauri::command]
pub async fn wallet_create_encrypted(
    state: State<'_, AppState>,
    coin: String,
    passphrase: String,
) -> AppResult<WalletCreateResult> {
    let coin = parse_coin_id(&coin)?;
    if passphrase.is_empty() {
        return Err(AppError::other("passphrase must not be empty"));
    }
    let client = state.rpc_client(coin).await?;
    let result: Result<Value, AppError> =
        client.call("encryptwallet", json!([passphrase])).await;

    let mut daemon_stopped = false;
    let message = match result {
        Ok(v) => v.as_str().unwrap_or("Wallet encrypted.").to_string(),
        Err(AppError::DaemonUnreachable(_)) => {
            // Older daemons (Verium ships with one) terminate after encryptwallet.
            daemon_stopped = true;
            "Wallet encrypted; daemon shut down — restarting.".into()
        }
        Err(AppError::Rpc { code: -15, message }) => return Err(AppError::other(message)),
        Err(e) => return Err(e),
    };

    if daemon_stopped {
        state.daemon(coin)?.record_pid(None).await;
    }

    Ok(WalletCreateResult {
        success: true,
        message,
        daemon_stopped,
    })
}

#[tauri::command]
pub async fn wallet_change_passphrase(
    state: State<'_, AppState>,
    coin: String,
    old_passphrase: String,
    new_passphrase: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    if old_passphrase.is_empty() || new_passphrase.is_empty() {
        return Err(AppError::other("passphrases must not be empty"));
    }
    state
        .rpc_client(coin)
        .await?
        .call_no_result(
            "walletpassphrasechange",
            json!([old_passphrase, new_passphrase]),
        )
        .await?;
    let cfg = state.config(coin).await?;
    wallet_secrets::clear_passphrase(coin, &cfg.datadir);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct WalletBackupResult {
    pub success: bool,
    pub destination: String,
    pub message: String,
}

#[tauri::command]
pub async fn wallet_backup(
    state: State<'_, AppState>,
    coin: String,
    destination_path: String,
) -> AppResult<WalletBackupResult> {
    let coin = parse_coin_id(&coin)?;
    if destination_path.is_empty() {
        return Err(AppError::other("destination_path must not be empty"));
    }
    let cfg = state.config(coin).await?;
    let dest = std::path::PathBuf::from(&destination_path);
    if is_live_wallet_destination(&cfg, &dest) {
        return Err(AppError::other(
            "Cannot save over the live wallet.dat file. Pick a different name — for example verium-wallet-YYYYMMDD-HHMMSS.dat in the backups folder.",
        ));
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let backup_dir = wallet_backup_dir(&cfg)?;
    let snapshot = backup_dir.join(format!(
        ".snapshot-{}.dat",
        uuid::Uuid::new_v4().simple()
    ));
    let snapshot_for_rpc = path_for_veriumd_rpc(&snapshot);
    tracing::info!(
        "wallet backup: snapshot {} -> {}",
        snapshot_for_rpc,
        dest.display()
    );

    let client = state.rpc_client(coin).await?;
    let rpc_result = client
        .call_no_result("backupwallet", json!([snapshot_for_rpc]))
        .await;

    if rpc_result.is_ok() && snapshot.is_file() {
        // Preferred path: veriumd flushed Berkeley DB and wrote the snapshot.
    } else {
        if let Err(AppError::Rpc { message, .. }) = &rpc_result {
            tracing::warn!("wallet backup: backupwallet rpc failed: {message}");
        } else if rpc_result.is_ok() {
            tracing::warn!(
                "wallet backup: backupwallet returned ok but snapshot missing at {}",
                snapshot.display()
            );
        }
        let live = resolve_wallet_dat_path(&cfg).ok_or_else(|| {
            AppError::other("No wallet.dat found on disk to copy.")
        })?;
        std::fs::copy(&live, &dest).map_err(|e| {
            AppError::other(format!(
                "Could not copy wallet.dat to {}: {e}. If the node just started, wait a moment and try again.",
                dest.display()
            ))
        })?;
        let _ = std::fs::remove_file(&snapshot);
        return Ok(WalletBackupResult {
            success: true,
            destination: destination_path,
            message: "Wallet backup saved (live file copy while the node is running).".into(),
        });
    }

    std::fs::copy(&snapshot, &dest).map_err(|e| {
        AppError::other(format!(
            "Could not copy wallet backup to {}: {e}",
            dest.display()
        ))
    })?;
    let _ = std::fs::remove_file(&snapshot);

    Ok(WalletBackupResult {
        success: true,
        destination: destination_path,
        message: "Wallet backup saved.".into(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct WalletRestoreResult {
    pub success: bool,
    pub destination: String,
    pub message: String,
    /// When a live wallet existed, it was copied here before restore.
    pub previous_wallet_backup: Option<String>,
    /// True when a background chain rescan was started for the restored wallet.
    pub rescan_started: bool,
}

#[tauri::command]
pub async fn wallet_restore(
    state: State<'_, AppState>,
    coin: String,
    source_path: String,
) -> AppResult<WalletRestoreResult> {
    let coin = parse_coin_id(&coin)?;
    if source_path.trim().is_empty() {
        return Err(AppError::other("source_path must not be empty"));
    }

    let cfg = state.config_fresh(coin).await?;
    wallet_secrets::clear_passphrase(coin, &cfg.datadir);
    let source = std::path::PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(AppError::other(format!(
            "Backup file not found: {}",
            source.display()
        )));
    }
    let source_len = std::fs::metadata(&source)?.len();
    if source_len < 512 {
        return Err(AppError::other(
            "Selected file is too small to be a valid wallet.dat backup.",
        ));
    }

    let dest = wallet_dat_path(&cfg);
    if is_live_wallet_destination(&cfg, &source) {
        return Err(AppError::other(
            "That file is the live wallet.dat already in use. Pick a backup copy from your backups folder or another location.",
        ));
    }

    stop_inner(state.inner(), coin).await?;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let previous_wallet_backup = if wallet_dat_exists(&cfg) {
        let live = resolve_wallet_dat_path(&cfg).ok_or_else(|| {
            AppError::other("Could not locate the current wallet.dat to back up.")
        })?;
        let backup_dir = wallet_backup_dir(&cfg)?;
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let pre = backup_dir.join(format!("pre-restore-{stamp}.dat"));
        std::fs::copy(&live, &pre).map_err(|e| {
            AppError::other(format!(
                "Could not back up the current wallet before restore: {e}"
            ))
        })?;
        Some(pre.display().to_string())
    } else {
        None
    };

    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    clear_wallet_bdb_environment(&dest)?;
    std::fs::copy(&source, &dest).map_err(|e| {
        AppError::other(format!(
            "Could not restore wallet to {}: {e}",
            dest.display()
        ))
    })?;

    start_inner(state.inner(), coin).await?;
    let rpc_up = wait_for_rpc(state.inner(), coin, 60).await;

    // Rescan in the background so restore returns quickly on large chains.
    let mut rescan_started = false;
    if rpc_up {
        rescan_started = true;
        let bg = state.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(client) = bg.rpc_client(coin).await {
                match client.call::<Value>("rescanblockchain", json!([0])).await {
                    Ok(_) => tracing::info!("wallet restore: rescanblockchain finished"),
                    Err(e) => tracing::warn!("wallet restore: rescanblockchain failed: {e}"),
                }
            }
        });
    }

    let mut message = String::from(
        "Wallet restored from backup. Unlock with the passphrase from when that backup was made.",
    );
    if rescan_started {
        message.push_str(
            " A background chain rescan is running — balances may update over the next few minutes.",
        );
    } else {
        message.push_str(
            " Restart the daemon if the wallet does not load, then unlock it.",
        );
    }
    if previous_wallet_backup.is_some() {
        message.push_str(" Your previous wallet was saved in backups before restore.");
    }

    Ok(WalletRestoreResult {
        success: true,
        destination: dest.display().to_string(),
        message,
        previous_wallet_backup,
        rescan_started,
    })
}

#[tauri::command]
pub async fn wallet_dump_privkey(
    state: State<'_, AppState>,
    coin: String,
    address: String,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("dumpprivkey", json!([address]))
        .await
}

#[tauri::command]
pub async fn wallet_import_privkey(
    state: State<'_, AppState>,
    coin: String,
    privkey: String,
    label: Option<String>,
    rescan: Option<bool>,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let params = json!([
        privkey,
        label.unwrap_or_default(),
        rescan.unwrap_or(true)
    ]);
    state
        .rpc_client(coin)
        .await?
        .call_no_result("importprivkey", params)
        .await
}

#[tauri::command]
pub async fn wallet_sign_message(
    state: State<'_, AppState>,
    coin: String,
    address: String,
    message: String,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("signmessage", json!([address, message]))
        .await
}

#[tauri::command]
pub async fn wallet_verify_message(
    state: State<'_, AppState>,
    coin: String,
    address: String,
    signature: String,
    message: String,
) -> AppResult<bool> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("verifymessage", json!([address, signature, message]))
        .await
}

#[tauri::command]
pub async fn wallet_set_tx_fee(
    state: State<'_, AppState>,
    coin: String,
    fee_rate_vrm_per_kb: f64,
) -> AppResult<bool> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call("settxfee", json!([fee_rate_vrm_per_kb]))
        .await
}

#[tauri::command]
pub async fn wallet_list_unspent(
    state: State<'_, AppState>,
    coin: String,
    minconf: Option<u32>,
    maxconf: Option<u32>,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    state
        .rpc_client(coin)
        .await?
        .call(
            "listunspent",
            json!([minconf.unwrap_or(1), maxconf.unwrap_or(9_999_999)]),
        )
        .await
}

/// Build, fund, sign, and broadcast a transaction with explicit UTXOs (coin
/// control). Outputs is a map of `address -> amount (VRM)`.
#[tauri::command]
pub async fn wallet_send_with_inputs(
    state: State<'_, AppState>,
    coin: String,
    inputs: Vec<Value>,
    outputs: serde_json::Map<String, Value>,
    change_address: Option<String>,
    fee_rate_vrm_per_kb: Option<f64>,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let client = state.rpc_client(coin).await?;
    let raw: String = client
        .call("createrawtransaction", json!([inputs, outputs]))
        .await?;
    let mut fund_options = serde_json::Map::new();
    if let Some(addr) = change_address.filter(|s| !s.is_empty()) {
        fund_options.insert("changeAddress".into(), Value::String(addr));
    }
    if let Some(rate) = fee_rate_vrm_per_kb {
        fund_options.insert("feeRate".into(), json!(rate));
    }
    let funded: Value = client
        .call("fundrawtransaction", json!([raw, fund_options]))
        .await?;
    let funded_hex = funded
        .get("hex")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::other("fundrawtransaction returned no hex"))?
        .to_string();
    let signed: Value = client
        .call("signrawtransactionwithwallet", json!([funded_hex]))
        .await?;
    let signed_hex = signed
        .get("hex")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::other("signrawtransactionwithwallet returned no hex"))?
        .to_string();
    let txid: String = client.call("sendrawtransaction", json!([signed_hex])).await?;
    Ok(txid)
}

#[tauri::command]
pub async fn rpc_raw_call(
    state: State<'_, AppState>,
    coin: String,
    method: String,
    params: Option<Value>,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    if method.is_empty() {
        return Err(AppError::other("method must not be empty"));
    }
    let p = params.unwrap_or(Value::Array(Vec::new()));
    state.rpc_client(coin).await?.call(&method, p).await
}

#[tauri::command]
pub async fn send_to_address(
    state: State<'_, AppState>,
    coin: String,
    address: String,
    amount: f64,
    comment: Option<String>,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let params = json!([address, amount, comment.unwrap_or_default()]);
    state
        .rpc_client(coin)
        .await?
        .call("sendtoaddress", params)
        .await
}

#[tauri::command]
pub async fn get_daemon_config(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<DaemonConfig> {
    let coin = parse_coin_id(&coin)?;
    state.config_fresh(coin).await
}

fn cookie_present(cfg: &DaemonConfig) -> bool {
    cfg.cookie_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false)
}

fn auth_method_label(cfg: &DaemonConfig) -> &'static str {
    if cfg
        .rpc_password
        .as_ref()
        .is_some_and(|p| !p.is_empty())
        && cfg.rpc_user.is_some()
    {
        "userpass"
    } else if cookie_present(cfg) {
        "cookie"
    } else {
        "none"
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcTestResult {
    pub ok: bool,
    pub reachable: bool,
    pub authenticated: bool,
    pub warming_up: bool,
    pub auth_method: String,
    pub cookie_present: bool,
    pub message: String,
    pub chain: Option<String>,
    pub blocks: Option<u64>,
    pub conf_path: String,
    pub creds_in_conf: bool,
    pub likely_datadir_mismatch: bool,
    pub rpc_credentials_stale: bool,
    pub hint: Option<String>,
}

async fn probe_rpc(coin: CoinId, cfg: &DaemonConfig) -> RpcTestResult {
    let diag = rpc_auth_diagnostics(coin, cfg);
    let auth_method = auth_method_label(cfg).to_string();
    let cookie_present = cookie_present(cfg);
    let conf_path = diag.conf_path.clone();
    let creds_in_conf = diag.rpc_user_in_conf && diag.rpc_password_in_conf;
    let rpc_credentials_stale = wsl_credentials_stale(cfg);
    let base_hint = |msg: String| RpcTestResult {
        ok: false,
        reachable: false,
        authenticated: false,
        warming_up: false,
        auth_method: auth_method.clone(),
        cookie_present,
        message: msg,
        chain: None,
        blocks: None,
        conf_path: conf_path.clone(),
        creds_in_conf,
        likely_datadir_mismatch: false,
        rpc_credentials_stale,
        hint: None,
    };

    if auth_method == "none" && !creds_in_conf && !cookie_present {
        return RpcTestResult {
            hint: Some(
                "No RPC login in this data directory. Click Create RPC login, then restart veriumd."
                    .into(),
            ),
            ..base_hint(
                "No RPC credentials loaded for this data directory.".into(),
            )
        };
    }

    let client = match crate::rpc::RpcClient::from_config(cfg) {
        Ok(c) => c,
        Err(e) => {
            return RpcTestResult {
                hint: Some("Check that rpcuser/rpcpassword in verium.conf match what veriumd was started with.".into()),
                ..base_hint(e.to_string())
            };
        }
    };
    match client.call::<Value>("getblockchaininfo", json!([])).await {
        Ok(info) => RpcTestResult {
            ok: true,
            reachable: true,
            authenticated: true,
            warming_up: false,
            auth_method,
            cookie_present,
            message: "Connected to veriumd.".into(),
            chain: info
                .get("chain")
                .and_then(Value::as_str)
                .map(str::to_string),
            blocks: info.get("blocks").and_then(Value::as_u64),
            conf_path,
            creds_in_conf,
            likely_datadir_mismatch: false,
            rpc_credentials_stale: false,
            hint: None,
        },
        Err(AppError::DaemonUnreachable(msg)) => {
            let unauthorized = msg.contains("unauthorized");
            let likely_datadir_mismatch =
                unauthorized && !rpc_credentials_stale && (creds_in_conf || cookie_present);
            let hint = if rpc_credentials_stale {
                Some(
                    "verium.conf was updated after veriumd started. Click Restart veriumd in WSL \
                     (or run the command below) so the daemon loads the new rpcuser/rpcpassword."
                        .into(),
                )
            } else if likely_datadir_mismatch {
                Some(
                    "Something is answering on this RPC port, but it rejects these credentials. \
                     Another veriumd may be running (often in WSL) with a different data directory. \
                     Either point Data directory at that node's folder (e.g. \\\\wsl.localhost\\Ubuntu\\root\\verium-main-dev), \
                     create RPC login there, and restart that veriumd — or stop the other node and start \
                     veriumd using this data directory."
                        .into(),
                )
            } else if unauthorized {
                Some(
                    "Restart veriumd after changing verium.conf so it picks up rpcuser/rpcpassword."
                        .into(),
                )
            } else {
                None
            };
            RpcTestResult {
                ok: false,
                reachable: unauthorized || !msg.contains("connect"),
                authenticated: false,
                warming_up: false,
                auth_method,
                cookie_present,
                message: msg,
                chain: None,
                blocks: None,
                conf_path,
                creds_in_conf,
                likely_datadir_mismatch,
                rpc_credentials_stale,
                hint,
            }
        }
        Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => RpcTestResult {
            ok: true,
            reachable: true,
            authenticated: true,
            warming_up: true,
            auth_method,
            cookie_present,
            message: message.clone(),
            chain: None,
            blocks: None,
            conf_path,
            creds_in_conf,
            likely_datadir_mismatch: false,
            rpc_credentials_stale: false,
            hint: Some(
                "veriumd is running and authenticated. Wait for block index load to finish."
                    .into(),
            ),
        },
        Err(e) => RpcTestResult {
            hint: None,
            likely_datadir_mismatch: false,
            rpc_credentials_stale,
            ..base_hint(e.to_string())
        },
    }
}

#[tauri::command]
pub async fn test_rpc_connection(
    state: State<'_, AppState>,
    coin: String,
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcTestResult> {
    let coin = parse_coin_id(&coin)?;
    let base = state.config(coin).await?;
    let partial = partial.unwrap_or_default();
    let password_override = partial
        .rpc_password
        .as_ref()
        .filter(|p| !p.is_empty());
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(coin, &mut cfg)?;
    if let Some(p) = password_override {
        cfg.rpc_password = Some(p.clone());
    }
    let result = probe_rpc(coin, &cfg).await;
    if result.ok {
        let _ = save_app_daemon_config(coin, &cfg);
        state.replace_config(coin, cfg).await?;
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcCredentialsSetup {
    pub rpc_user: String,
    pub rpc_password: String,
    pub config: DaemonConfig,
}

#[tauri::command]
pub async fn get_rpc_auth_diagnostics(
    state: State<'_, AppState>,
    coin: String,
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcAuthDiagnostics> {
    let coin = parse_coin_id(&coin)?;
    let base = state.config(coin).await?;
    let partial = partial.unwrap_or_default();
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(coin, &mut cfg)?;
    Ok(rpc_auth_diagnostics(coin, &cfg))
}

#[tauri::command]
pub async fn setup_rpc_credentials(
    state: State<'_, AppState>,
    coin: String,
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcCredentialsSetup> {
    let coin = parse_coin_id(&coin)?;
    let base = state.config(coin).await?;
    let partial = partial.unwrap_or_default();
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(coin, &mut cfg)?;
    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| coin.default_rpc_user().to_string());
    let diag = rpc_auth_diagnostics(coin, &cfg);
    let pass = if diag.rpc_password_in_conf {
        cfg.rpc_password
            .clone()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(generate_rpc_password)
    } else {
        generate_rpc_password()
    };
    let overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("checklevel", "0".to_string()),
        ("rpcuser", user.clone()),
        ("rpcpassword", pass.clone()),
    ];
    write_node_conf_overrides(coin, &cfg.datadir, &overrides)?;
    cfg.rpc_user = Some(user.clone());
    cfg.rpc_password = Some(pass.clone());
    refresh_config_paths(coin, &mut cfg)?;
    save_app_daemon_config(coin, &cfg)?;
    state.replace_config(coin, cfg.clone()).await?;

    if is_wsl_unc_path(&cfg.datadir) {
        restart_wsl_veriumd_datadir(&cfg.datadir, default_wsl_repo_root())?;
        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    }

    Ok(RpcCredentialsSetup {
        rpc_user: user,
        rpc_password: pass,
        config: cfg,
    })
}

#[tauri::command]
pub async fn set_daemon_config(
    state: State<'_, AppState>,
    coin: String,
    partial: PartialDaemonConfig,
) -> AppResult<DaemonConfig> {
    let coin = parse_coin_id(&coin)?;
    let mut cfg = apply_partial_to_config(&state.config(coin).await?, &partial);
    let mut overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("checklevel", "0".to_string()),
    ];
    if let Some(u) = cfg.rpc_user.clone() {
        overrides.push(("rpcuser", u));
    }
    if let Some(p) = cfg.rpc_password.clone() {
        overrides.push(("rpcpassword", p));
    }
    write_node_conf_overrides(coin, &cfg.datadir, &overrides)?;
    refresh_config_paths(coin, &mut cfg)?;
    save_app_daemon_config(coin, &cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    Ok(cfg)
}

#[tauri::command]
pub async fn start_daemon(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    start_inner(state.inner(), coin).await
}

#[tauri::command]
pub async fn stop_daemon(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    stop_inner(state.inner(), coin).await
}

#[tauri::command]
pub async fn restart_daemon(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let inner = state.inner();
    let _ = stop_inner(inner, coin).await;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    start_inner(inner, coin).await
}

#[tauri::command]
pub async fn tail_logs(
    state: State<'_, AppState>,
    coin: String,
    lines: Option<u32>,
) -> AppResult<Vec<String>> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config(coin).await?;
    let max = lines.unwrap_or(200) as usize;
    tail_debug_log(&cfg.datadir, max).await
}

#[tauri::command]
pub async fn check_for_updates() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION");
    run_update_check(current).await
}

#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::other("empty url"));
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(AppError::other("only http(s) urls are allowed"));
    }
    match open::that(trimmed) {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::other(format!("failed to open url: {e}"))),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VeriumConfFile {
    pub path: String,
    pub backup_path: String,
    pub content: String,
}

#[tauri::command]
pub async fn read_verium_conf(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<VeriumConfFile> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    let content = read_node_conf_file(coin, &cfg)?;
    Ok(VeriumConfFile {
        path: node_conf_path(coin, &cfg).display().to_string(),
        backup_path: node_conf_backup_path(coin, &cfg).display().to_string(),
        content,
    })
}

#[tauri::command]
pub async fn write_verium_conf(
    state: State<'_, AppState>,
    coin: String,
    content: String,
) -> AppResult<VeriumConfFile> {
    let coin = parse_coin_id(&coin)?;
    let mut cfg = state.config_fresh(coin).await?;
    write_node_conf_file(coin, &cfg, &content)?;
    refresh_config_paths(coin, &mut cfg)?;
    save_app_daemon_config(coin, &cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    Ok(VeriumConfFile {
        path: node_conf_path(coin, &cfg).display().to_string(),
        backup_path: node_conf_backup_path(coin, &cfg).display().to_string(),
        content,
    })
}

#[tauri::command]
pub async fn open_verium_conf(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    let path = node_conf_path(coin, &cfg);
    if !path.exists() {
        write_node_conf_file(
            coin,
            &cfg,
            &format!(
                "# {} node configuration\n# https://github.com/Vericonomy\nserver=1\n",
                coin.display_name()
            ),
        )?;
    }
    open::that(&path).map_err(|e| {
        AppError::other(format!("failed to open {}: {e}", coin.conf_filename()))
    })?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn detect_daemon(coin: String) -> AppResult<DaemonBinaryStatus> {
    let coin = parse_coin_id(&coin)?;
    Ok(detect_binary(coin))
}

#[tauri::command]
pub async fn detect_veriumd() -> AppResult<DaemonBinaryStatus> {
    Ok(detect_binary(CoinId::Verium))
}

#[tauri::command]
pub fn get_coin_profiles() -> Vec<crate::coin_profile::CoinProfileSummary> {
    all_profile_summaries()
}

#[derive(Debug, Clone, Serialize)]
pub struct WalletFileStatus {
    pub exists: bool,
    pub path: String,
    /// When the wallet file lives outside the legacy `<datadir>/wallet.dat` path.
    pub note: Option<String>,
    /// Folder opened by the backup save dialog (`<datadir>/backups`).
    pub backup_folder: String,
    /// Default filename + folder for the save dialog.
    pub suggested_backup_path: String,
}

#[tauri::command]
pub async fn wallet_file_status(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<WalletFileStatus> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    let resolved = resolve_wallet_dat_path(&cfg);
    let default_path = wallet_dat_path(&cfg);
    let exists = wallet_dat_exists(&cfg);
    let path = resolved
        .unwrap_or(default_path)
        .display()
        .to_string();
    let backup_folder = wallet_backup_dir(&cfg)?
        .display()
        .to_string();
    let suggested_backup_path = suggested_wallet_backup_path(coin, &cfg)?
        .display()
        .to_string();
    let binary = coin.binary_base();
    let note = if exists {
        None
    } else {
        Some(format!(
            "No wallet.dat found on disk yet. If the wallet is unlocked in the app, use Back up wallet.dat — {binary} exports the live wallet file."
        ))
    };
    Ok(WalletFileStatus {
        exists,
        path,
        note,
        backup_folder,
        suggested_backup_path,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct FirstRunConfigResult {
    pub bootstrapped: bool,
    pub config: DaemonConfig,
}

#[tauri::command]
pub async fn ensure_first_run(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<FirstRunConfigResult> {
    let coin = parse_coin_id(&coin)?;
    let mut cfg = state.config(coin).await?;
    let bootstrapped = ensure_first_run_config(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    Ok(FirstRunConfigResult {
        bootstrapped,
        config: cfg,
    })
}

/// Restart the daemon and wait for RPC to come back. Used after `encryptwallet`
/// (which shuts the node down) and the new-wallet wizard flow.
#[tauri::command]
pub async fn restart_after_encrypt(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<EnsureConnectResult> {
    let coin = parse_coin_id(&coin)?;
    let inner = state.inner();
    state.daemon(coin)?.record_pid(None).await;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let _ = start_inner(inner, coin).await;
    let connected = wait_for_rpc(inner, coin, 60).await;
    Ok(EnsureConnectResult {
        connected,
        message: if connected {
            "Daemon restarted; wallet is now encrypted.".into()
        } else {
            "Wallet encrypted, but the daemon did not come back online. Try restarting the app."
                .into()
        },
        datadir_locked: false,
        already_running: false,
    })
}

#[tauri::command]
pub async fn get_user_preferences() -> AppResult<UserPreferences> {
    prefs::load().await
}

#[tauri::command]
pub async fn set_user_preferences(
    state: State<'_, AppState>,
    partial: PartialUserPreferences,
) -> AppResult<UserPreferences> {
    let current = prefs::load().await.unwrap_or_default();
    let next = prefs::merge(current.clone(), partial);
    for coin in CoinId::all() {
        let was = prefs::wallet_unlock_duration_for(&current, *coin);
        let now = prefs::wallet_unlock_duration_for(&next, *coin);
        if is_forever_unlock_duration(was) && !is_forever_unlock_duration(now) {
            if let Ok(cfg) = state.config_fresh(*coin).await {
                wallet_secrets::clear_passphrase(*coin, &cfg.datadir);
            }
        }
    }
    prefs::save(&next).await?;
    Ok(next)
}

#[tauri::command]
pub async fn import_bootstrap(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    coin: String,
    local_path: Option<String>,
) -> AppResult<BootstrapResult> {
    let coin = parse_coin_id(&coin)?;
    let local = local_path.map(PathBuf::from);
    let result = run_import_bootstrap(state.inner(), coin, app, local).await?;
    if result.success {
        let mut current = prefs::load().await?;
        let mut imported = current
            .bootstrap_imported_at_by_coin
            .take()
            .unwrap_or_default();
        imported.insert(
            coin.as_str().to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        );
        current.bootstrap_imported_at_by_coin = Some(imported);
        prefs::save(&current).await?;
    }
    Ok(result)
}

#[tauri::command]
pub fn cancel_bootstrap(state: tauri::State<'_, AppState>, coin: String) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    request_bootstrap_cancel(state.inner(), coin);
    Ok(())
}

#[tauri::command]
pub async fn fetch_explorer_stats(coin: String) -> AppResult<ExplorerStats> {
    let coin = parse_coin_id(&coin)?;
    fetch_network_stats(coin).await
}

#[tauri::command]
pub async fn fetch_explorer_blocks(
    coin: String,
    limit: Option<u32>,
) -> AppResult<Vec<ExplorerBlock>> {
    let coin = parse_coin_id(&coin)?;
    fetch_blocks(coin, limit.unwrap_or(10)).await
}

#[tauri::command]
pub async fn fetch_explorer_transactions(
    coin: String,
    limit: Option<u32>,
) -> AppResult<Vec<ExplorerTransaction>> {
    let coin = parse_coin_id(&coin)?;
    fetch_transactions(coin, limit.unwrap_or(25)).await
}

#[tauri::command]
pub async fn fetch_explorer_extraction(
    coin: String,
    limit: Option<u32>,
) -> AppResult<Vec<ExplorerExtractionEntry>> {
    let coin = parse_coin_id(&coin)?;
    fetch_extraction(coin, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn fetch_explorer_chain_tips(coin: String) -> AppResult<Vec<ExplorerChainTip>> {
    let coin = parse_coin_id(&coin)?;
    fetch_chain_tips(coin).await
}

#[tauri::command]
pub async fn fetch_explorer_peers_cmd(coin: String) -> AppResult<Vec<ExplorerPeerEntry>> {
    let coin = parse_coin_id(&coin)?;
    fetch_explorer_peers(coin).await
}

#[tauri::command]
pub fn get_explorer_logo_url(coin: String) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    Ok(explorer_logo_url(coin))
}

#[tauri::command]
pub fn detect_wsl_datadirs_cmd() -> AppResult<Vec<WslDatadirCandidate>> {
    if bundled_sidecar_available(CoinId::Verium) {
        return Ok(vec![]);
    }
    detect_wsl_datadirs()
}

#[tauri::command]
pub fn get_wsl_restart_hint(unc_datadir: String) -> String {
    let linux = unc_to_linux_path(&unc_datadir);
    wsl_restart_hint(&linux, default_wsl_repo_root())
}

#[tauri::command]
pub async fn restart_wsl_veriumd_cmd(unc_datadir: String) -> AppResult<()> {
    let path = std::path::PathBuf::from(unc_datadir);
    restart_wsl_veriumd_datadir(&path, default_wsl_repo_root())?;
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    Ok(())
}

fn wsl_credentials_stale(cfg: &DaemonConfig) -> bool {
    if !is_wsl_unc_path(&cfg.datadir) {
        return false;
    }
    wsl_rpc_credentials_stale_datadir(&cfg.datadir).unwrap_or(false)
}

fn default_wsl_repo_root() -> &'static str {
    DEFAULT_WSL_REPO_ROOT
}

/// Start the daemon when RPC is down: native bundled sidecar on Windows/macOS/Linux,
/// or WSL-managed node for legacy dev datadir paths.
async fn ensure_daemon_running(state: &AppState, coin: CoinId, cfg: &DaemonConfig) {
    if rpc_reachable(cfg).await {
        return;
    }

    if is_wsl_unc_path(&cfg.datadir) && !bundled_sidecar_available(coin) {
        ensure_wsl_veriumd_running(state, coin, cfg).await;
        return;
    }

    if detect_binary(coin).manageable {
        if let Err(e) = start_inner(state, coin).await {
            tracing::warn!("ensure ({}): failed to start daemon: {e}", coin.as_str());
        }
    }
}

async fn ensure_wsl_veriumd_running(state: &AppState, coin: CoinId, cfg: &DaemonConfig) {
    if bundled_sidecar_available(coin) || !is_wsl_unc_path(&cfg.datadir) {
        return;
    }
    let lines = tail_debug_log(&cfg.datadir, 80).await.unwrap_or_default();
    if detect_chain_corruption(&lines).is_some()
        && !lines.iter().rev().any(|l| is_timestamp_rule_failure(l))
        && !wsl_veriumd_running_datadir(&cfg.datadir)
    {
        tracing::warn!("ensure: chain corruption in debug.log — skip auto-start until repaired");
        return;
    }
    let repo = default_wsl_repo_root();
    if wsl_rpc_credentials_stale_datadir(&cfg.datadir).unwrap_or(false) {
        tracing::info!("ensure: restarting WSL veriumd (stale RPC credentials)");
        if restart_wsl_veriumd_datadir(&cfg.datadir, repo).is_ok() {
            if let Ok(d) = state.daemon(coin) {
                d.mark_managed().await;
            }
        } else {
            tracing::warn!("ensure: wsl restart failed");
        }
        return;
    }
    if !wsl_veriumd_running_datadir(&cfg.datadir) {
        tracing::info!("ensure: starting WSL veriumd");
        match wsl_start_veriumd_if_stopped_datadir(&cfg.datadir, repo) {
            Ok(started) if started => {
                if let Ok(d) = state.daemon(coin) {
                    d.mark_managed().await;
                }
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("ensure: wsl start failed: {e}"),
        }
    }
}

async fn wait_for_rpc(state: &AppState, coin: CoinId, max_attempts: u32) -> bool {
    let binary = coin.binary_base();
    for attempt in 0..max_attempts {
        if let Ok(cfg) = state.config_fresh(coin).await {
            if let Ok(client) = crate::rpc::RpcClient::from_config(&cfg) {
                match client.call::<Value>("getblockchaininfo", json!([])).await {
                    Ok(_) => {
                        let _ = save_app_daemon_config(coin, &cfg);
                        tracing::info!(
                            "ensure ({}): connected to {binary} (attempt {})",
                            coin.as_str(),
                            attempt + 1
                        );
                        return true;
                    }
                    Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => {
                        let _ = save_app_daemon_config(coin, &cfg);
                        tracing::info!(
                            "ensure ({}): {binary} warming up (attempt {}): {}",
                            coin.as_str(),
                            attempt + 1,
                            message
                        );
                        return true;
                    }
                    Err(AppError::DaemonUnreachable(_)) => {}
                    Err(e) => tracing::debug!("ensure: rpc attempt {}: {e}", attempt + 1),
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    false
}

#[derive(Debug, Clone, Serialize)]
pub struct EnsureConnectResult {
    pub connected: bool,
    pub message: String,
    pub datadir_locked: bool,
    pub already_running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct VeriumdRuntimeStatus {
    pub rpc_connected: bool,
    pub datadir_locked: bool,
    pub message: String,
    pub hint: Option<String>,
}

#[tauri::command]
pub async fn detect_veriumd_runtime(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<VeriumdRuntimeStatus> {
    let coin = parse_coin_id(&coin)?;
    let binary = coin.binary_base();
    let cfg = state.config_fresh(coin).await?;
    if rpc_reachable(&cfg).await {
        return Ok(VeriumdRuntimeStatus {
            rpc_connected: true,
            datadir_locked: false,
            message: format!("A {binary} node is already running on the configured RPC port."),
            hint: Some(
                "Continue setup to unlock your existing wallet — you do not need to start another node."
                    .into(),
            ),
        });
    }

    let lines = tail_debug_log(&cfg.datadir, 40).await.unwrap_or_default();
    if let Some(message) = detect_datadir_lock_conflict(&lines) {
        return Ok(VeriumdRuntimeStatus {
            rpc_connected: false,
            datadir_locked: true,
            message,
            hint: Some(format!(
                "Quit the legacy wallet or any terminal {binary} using the same data folder."
            )),
        });
    }

    Ok(VeriumdRuntimeStatus {
        rpc_connected: false,
        datadir_locked: false,
        message: format!("No {binary} instance detected."),
        hint: None,
    })
}

#[tauri::command]
pub async fn ensure_daemon_connected(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<EnsureConnectResult> {
    let coin = parse_coin_id(&coin)?;
    let binary = coin.binary_base();
    let cfg = state.config_fresh(coin).await?;
    if rpc_reachable(&cfg).await {
        return Ok(EnsureConnectResult {
            connected: true,
            message: format!("Connected to the running {binary} node."),
            datadir_locked: false,
            already_running: true,
        });
    }

    if !detect_binary(coin).manageable {
        let message = binary_missing_hint(coin).unwrap_or_else(|| {
            format!("Could not locate a runnable {binary} binary on this system.")
        });
        return Ok(EnsureConnectResult {
            connected: false,
            message,
            datadir_locked: false,
            already_running: false,
        });
    }

    ensure_daemon_running(state.inner(), coin, &cfg).await;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let connected = wait_for_rpc(state.inner(), coin, 45).await;
    if connected {
        return Ok(EnsureConnectResult {
            connected: true,
            message: format!("Connected to {binary}."),
            datadir_locked: false,
            already_running: false,
        });
    }

    let lines = tail_debug_log(&cfg.datadir, 40).await.unwrap_or_default();
    let datadir_locked = detect_datadir_lock_conflict(&lines).is_some();
    let message = if datadir_locked {
        detect_datadir_lock_conflict(&lines).unwrap_or_default()
    } else if let Some(hint) = binary_missing_hint(coin) {
        hint
    } else {
        format!("Could not reach {binary}. Check Settings or debug.log in your data directory.")
    };

    Ok(EnsureConnectResult {
        connected: false,
        message,
        datadir_locked,
        already_running: false,
    })
}

/// On wallet launch: start enabled daemons if needed and wait for RPC.
pub async fn startup_daemon_connect(state: &AppState) {
    let prefs = prefs::load().await.unwrap_or_default();
    for coin in CoinId::all() {
        if !prefs::coin_enabled(&prefs, *coin) {
            continue;
        }
        let cfg = match state.config_fresh(*coin).await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("startup ({}): config load failed: {e}", coin.as_str());
                continue;
            }
        };

        ensure_daemon_running(state, *coin, &cfg).await;
    }

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    for coin in CoinId::all() {
        if !prefs::coin_enabled(&prefs, *coin) {
            continue;
        }
        if !wait_for_rpc(state, *coin, 45).await {
            tracing::warn!("startup ({}): daemon not reachable after waiting", coin.as_str());
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChainRepairResult {
    pub success: bool,
    pub message: String,
    pub mode: String,
}

#[tauri::command]
pub async fn repair_chain(
    app: AppHandle,
    state: State<'_, AppState>,
    coin: String,
    mode: String,
) -> AppResult<ChainRepairResult> {
    let coin = parse_coin_id(&coin)?;
    let binary = coin.binary_base();
    let mode_lower = mode.to_ascii_lowercase();
    if mode_lower == "bootstrap" {
        let result = run_import_bootstrap(state.inner(), coin, app, None).await?;
        return Ok(ChainRepairResult {
            success: result.success,
            message: result.message,
            mode: "bootstrap".into(),
        });
    }

    let start_mode = match mode_lower.as_str() {
        "reindex-chainstate" => VeriumdStartMode::ReindexChainstate,
        "reindex" => VeriumdStartMode::Reindex,
        _ => {
            return Err(AppError::other(
                "mode must be bootstrap, reindex-chainstate, or reindex",
            ))
        }
    };

    let cfg = state.config_fresh(coin).await?;
    state.daemon(coin)?.record_pid(None).await;

    if is_wsl_unc_path(&cfg.datadir) {
        start_wsl_veriumd_datadir(&cfg.datadir, default_wsl_repo_root(), start_mode)?;
    } else {
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("stop", json!([])).await;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        state.daemon(coin)?.force_kill_child().await;
        state.daemon(coin)?.clear_tracking().await;
        let flag = start_mode.flag();
        let extra = if flag.is_empty() { &[][..] } else { &[flag][..] };
        state.daemon(coin)?.start(&cfg, extra).await?;
    }

    let label = match start_mode {
        VeriumdStartMode::ReindexChainstate => "reindex-chainstate",
        VeriumdStartMode::Reindex => "reindex",
        VeriumdStartMode::Normal => "normal",
    };

    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    Ok(ChainRepairResult {
        success: true,
        message: format!(
            "{binary} started with -{label}. This can take a long time; watch debug.log for progress."
        ),
        mode: label.to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct RebuildWslResult {
    pub success: bool,
    pub message: String,
    pub log_tail: String,
}

#[tauri::command]
pub async fn rebuild_wsl_veriumd_validation_fix(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<RebuildWslResult> {
    let coin = parse_coin_id(&coin)?;
    assert_verium(coin)?;
    let cfg = state.config_fresh(coin).await?;
    if !is_wsl_unc_path(&cfg.datadir) {
        return Err(AppError::other(
            "Rebuild is only supported for WSL data directories",
        ));
    }
    let repo = find_verium_repo_root().ok_or_else(|| {
        AppError::other(
            "Could not find Verium source on Windows. Set VERIUM_REPO to your repo path.",
        )
    })?;
    let log_tail = tokio::task::spawn_blocking(move || {
        wsl_rebuild_veriumd_validation_fix(
            &cfg.datadir,
            default_wsl_repo_root(),
            &repo,
        )
    })
    .await
    .map_err(|e| AppError::other(format!("rebuild task failed: {e}")))??;
    Ok(RebuildWslResult {
        success: true,
        message: "Rebuilt veriumd in WSL with updated validation rules and restarted the node."
            .into(),
        log_tail,
    })
}

#[tauri::command]
pub fn is_explorer_api_enabled() -> bool {
    EXPLORER_API_ENABLED
}

#[tauri::command]
pub fn address_book_list(coin: String) -> AppResult<Vec<AddressBookEntry>> {
    let coin = parse_coin_id(&coin)?;
    addressbook::list_entries(coin)
}

#[tauri::command]
pub fn address_book_upsert(coin: String, entry: AddressBookEntry) -> AppResult<AddressBookEntry> {
    let coin = parse_coin_id(&coin)?;
    addressbook::upsert_entry(coin, entry)
}

#[tauri::command]
pub fn address_book_delete(coin: String, id: String) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    addressbook::delete_entry(coin, &id)
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticBundle {
    pub app_version: String,
    pub os: String,
    pub timestamp: String,
    pub datadir: String,
    pub daemon_runtime: String,
    pub daemon_path: Option<String>,
    pub log_tail: Vec<String>,
}

#[tauri::command]
pub async fn diagnostic_bundle(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<DiagnosticBundle> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await.unwrap_or_default();
    let bin = detect_binary(coin);
    let log_tail = tail_debug_log(&cfg.datadir, 200).await.unwrap_or_default();
    Ok(DiagnosticBundle {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        timestamp: chrono::Utc::now().to_rfc3339(),
        datadir: cfg.datadir.display().to_string(),
        daemon_runtime: bin.runtime,
        daemon_path: bin.path,
        log_tail,
    })
}
