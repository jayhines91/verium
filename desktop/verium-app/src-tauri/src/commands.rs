use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::addressbook::{self, AddressBookEntry};
use crate::bootstrap::{import_bootstrap as run_import_bootstrap, BootstrapResult};
use crate::config::{
    apply_partial_to_config, ensure_first_run_config, generate_rpc_password, refresh_config_paths,
    rpc_auth_diagnostics, save_app_daemon_config, is_live_wallet_destination,
    path_for_veriumd_rpc, resolve_wallet_dat_path, suggested_wallet_backup_path,
    wallet_backup_dir, wallet_dat_exists, wallet_dat_path,
    write_verium_conf_overrides, DaemonConfig, PartialDaemonConfig, RpcAuthDiagnostics,
};
use crate::daemon::{bundled_sidecar_available, detect_binary, DaemonBinaryStatus};
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
use crate::state::{AppState, MinerLocalState};
use crate::updates::{check_for_updates as run_update_check, UpdateInfo};
use crate::wsl::{
    detect_wsl_datadirs, find_verium_repo_root, is_wsl_unc_path,
    rebuild_wsl_veriumd_validation_fix as wsl_rebuild_veriumd_validation_fix,
    restart_wsl_veriumd_datadir, start_wsl_veriumd_datadir, unc_to_linux_path, wsl_restart_hint, wsl_rpc_credentials_stale_datadir,
    wsl_start_veriumd_if_stopped_datadir, wsl_stop_veriumd_force_datadir,
    wsl_veriumd_running_datadir, VeriumdStartMode, WslDatadirCandidate, DEFAULT_WSL_REPO_ROOT,
    MANAGED_VERIUMD_ARGS,
};

async fn stop_inner(state: &AppState) -> AppResult<()> {
    let cfg = state.config().await;
    if is_wsl_unc_path(&cfg.datadir) {
        wsl_stop_veriumd_force_datadir(&cfg.datadir);
    } else if let Ok(client) = state.rpc_client().await {
        let _ = client.call_no_result("stop", json!([])).await;
        state
            .daemon()
            .wait_for_child_exit(std::time::Duration::from_secs(30))
            .await;
    }
    state.daemon().force_kill_child().await;
    state.daemon().clear_tracking().await;
    Ok(())
}

/// Stop veriumd when the wallet exits so the data directory lock is released.
pub async fn shutdown_daemon_on_app_exit(state: &AppState) {
    let cfg = match state.config_fresh().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("shutdown: config load failed: {e}");
            return;
        }
    };

    let managed = state.daemon().is_managed().await;
    let bundled = bundled_sidecar_available();
    let wsl = is_wsl_unc_path(&cfg.datadir);
    let rpc_up = rpc_reachable(&cfg).await;

    let should_stop = if bundled {
        // Shipped wallet owns node lifecycle (Setup: "starts and stops the daemon for you").
        rpc_up || managed
    } else {
        managed
    };

    if !should_stop {
        tracing::debug!("shutdown: leaving veriumd running");
        return;
    }

    tracing::info!("shutdown: stopping veriumd");
    if let Err(e) = stop_inner(state).await {
        tracing::warn!("shutdown: stop failed: {e}");
    }

    if wsl && wsl_veriumd_running_datadir(&cfg.datadir) {
        wsl_stop_veriumd_force_datadir(&cfg.datadir);
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

async fn start_inner(state: &AppState) -> AppResult<()> {
    let cfg = state.config().await;
    if is_wsl_unc_path(&cfg.datadir) {
        if wsl_start_veriumd_if_stopped_datadir(&cfg.datadir, default_wsl_repo_root())? {
            state.daemon().mark_managed().await;
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        return Ok(());
    }
    if rpc_reachable(&cfg).await {
        tracing::info!("start: veriumd already running for this datadir");
        return Ok(());
    }
    let lines = tail_debug_log(&cfg.datadir, 40).await.unwrap_or_default();
    if let Some(message) = detect_datadir_lock_conflict(&lines) {
        return Err(AppError::other(message));
    }
    let _pid = state.daemon().start(&cfg).await?;
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
pub async fn get_node_status(state: State<'_, AppState>) -> AppResult<NodeStatus> {
    let cfg = state.config().await;
    let status = match state.rpc_client().await {
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
            Err(AppError::DaemonUnreachable(msg)) => disconnected(Some(msg)),
            Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => warming_up(message),
            Err(e) => return Err(e),
        },
        Err(AppError::DaemonUnreachable(msg)) => disconnected(Some(msg)),
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
pub async fn get_blockchain_info(state: State<'_, AppState>) -> AppResult<Value> {
    state
        .rpc_client()
        .await?
        .call("getblockchaininfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_network_info(state: State<'_, AppState>) -> AppResult<Value> {
    state
        .rpc_client()
        .await?
        .call("getnetworkinfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_peer_info(state: State<'_, AppState>) -> AppResult<Value> {
    state
        .rpc_client()
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
pub async fn get_added_node_info(state: State<'_, AppState>) -> AppResult<Vec<AddedNodeInfo>> {
    let raw: Value = state
        .rpc_client()
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
    node: String,
    command: String,
) -> AppResult<()> {
    let cmd = match command.as_str() {
        "add" | "onetry" | "remove" => command,
        _ => {
            return Err(AppError::other(
                "command must be add, onetry, or remove",
            ))
        }
    };
    state
        .rpc_client()
        .await?
        .call_no_result("addnode", json!([node, cmd]))
        .await
}

#[tauri::command]
pub async fn get_mining_info(state: State<'_, AppState>) -> AppResult<Value> {
    state
        .rpc_client()
        .await?
        .call("getmininginfo", json!([]))
        .await
}

#[tauri::command]
pub async fn get_wallet_info(state: State<'_, AppState>) -> AppResult<Option<Value>> {
    let client = state.rpc_client().await?;
    match client.call::<Value>("getwalletinfo", json!([])).await {
        Ok(v) => Ok(Some(v)),
        Err(AppError::Rpc { code, .. }) if code == -18 || code == -19 => Ok(None),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_new_address(
    state: State<'_, AppState>,
    label: Option<String>,
) -> AppResult<String> {
    let params = match label {
        Some(l) if !l.is_empty() => json!([l]),
        _ => json!([]),
    };
    state
        .rpc_client()
        .await?
        .call("getnewaddress", params)
        .await
}

#[tauri::command]
pub async fn list_transactions(
    state: State<'_, AppState>,
    count: Option<u32>,
    skip: Option<u32>,
) -> AppResult<Value> {
    let params = json!(["*", count.unwrap_or(25), skip.unwrap_or(0)]);
    state
        .rpc_client()
        .await?
        .call("listtransactions", params)
        .await
}

#[tauri::command]
pub async fn list_address_groupings(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let value: Value = state
        .rpc_client()
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
    threads: u32,
) -> AppResult<MinerLocalState> {
    let _: Value = state
        .rpc_client()
        .await?
        .call("minerstart", json!([threads]))
        .await?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .ok();
    let next = MinerLocalState {
        active: true,
        threads,
        started_at: now,
    };
    state.set_miner(next.clone()).await;
    Ok(next)
}

#[tauri::command]
pub async fn miner_stop(state: State<'_, AppState>) -> AppResult<MinerLocalState> {
    let _: Value = state
        .rpc_client()
        .await?
        .call("minerstop", json!([]))
        .await?;
    let next = MinerLocalState::default();
    state.set_miner(next.clone()).await;
    Ok(next)
}

#[tauri::command]
pub async fn get_miner_state(state: State<'_, AppState>) -> AppResult<MinerLocalState> {
    Ok(state.miner().await)
}

#[tauri::command]
pub async fn wallet_unlock(
    state: State<'_, AppState>,
    passphrase: String,
    timeout_seconds: i64,
) -> AppResult<()> {
    let client = state.rpc_client().await?;
    client
        .call_no_result("walletpassphrase", json!([passphrase, timeout_seconds]))
        .await
}

#[tauri::command]
pub async fn wallet_lock(state: State<'_, AppState>) -> AppResult<()> {
    state
        .rpc_client()
        .await?
        .call_no_result("walletlock", json!([]))
        .await
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
    passphrase: String,
) -> AppResult<WalletCreateResult> {
    if passphrase.is_empty() {
        return Err(AppError::other("passphrase must not be empty"));
    }
    let client = state.rpc_client().await?;
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
        state.daemon().record_pid(None).await;
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
    old_passphrase: String,
    new_passphrase: String,
) -> AppResult<()> {
    if old_passphrase.is_empty() || new_passphrase.is_empty() {
        return Err(AppError::other("passphrases must not be empty"));
    }
    state
        .rpc_client()
        .await?
        .call_no_result(
            "walletpassphrasechange",
            json!([old_passphrase, new_passphrase]),
        )
        .await
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
    destination_path: String,
) -> AppResult<WalletBackupResult> {
    if destination_path.is_empty() {
        return Err(AppError::other("destination_path must not be empty"));
    }
    let cfg = state.config().await;
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

    let client = state.rpc_client().await?;
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

#[tauri::command]
pub async fn wallet_dump_privkey(
    state: State<'_, AppState>,
    address: String,
) -> AppResult<String> {
    state
        .rpc_client()
        .await?
        .call("dumpprivkey", json!([address]))
        .await
}

#[tauri::command]
pub async fn wallet_import_privkey(
    state: State<'_, AppState>,
    privkey: String,
    label: Option<String>,
    rescan: Option<bool>,
) -> AppResult<()> {
    let params = json!([
        privkey,
        label.unwrap_or_default(),
        rescan.unwrap_or(true)
    ]);
    state
        .rpc_client()
        .await?
        .call_no_result("importprivkey", params)
        .await
}

#[tauri::command]
pub async fn wallet_sign_message(
    state: State<'_, AppState>,
    address: String,
    message: String,
) -> AppResult<String> {
    state
        .rpc_client()
        .await?
        .call("signmessage", json!([address, message]))
        .await
}

#[tauri::command]
pub async fn wallet_verify_message(
    state: State<'_, AppState>,
    address: String,
    signature: String,
    message: String,
) -> AppResult<bool> {
    state
        .rpc_client()
        .await?
        .call("verifymessage", json!([address, signature, message]))
        .await
}

#[tauri::command]
pub async fn wallet_set_tx_fee(
    state: State<'_, AppState>,
    fee_rate_vrm_per_kb: f64,
) -> AppResult<bool> {
    state
        .rpc_client()
        .await?
        .call("settxfee", json!([fee_rate_vrm_per_kb]))
        .await
}

#[tauri::command]
pub async fn wallet_list_unspent(
    state: State<'_, AppState>,
    minconf: Option<u32>,
    maxconf: Option<u32>,
) -> AppResult<Value> {
    state
        .rpc_client()
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
    inputs: Vec<Value>,
    outputs: serde_json::Map<String, Value>,
    change_address: Option<String>,
    fee_rate_vrm_per_kb: Option<f64>,
) -> AppResult<String> {
    let client = state.rpc_client().await?;
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
    method: String,
    params: Option<Value>,
) -> AppResult<Value> {
    if method.is_empty() {
        return Err(AppError::other("method must not be empty"));
    }
    let p = params.unwrap_or(Value::Array(Vec::new()));
    state.rpc_client().await?.call(&method, p).await
}

#[tauri::command]
pub async fn send_to_address(
    state: State<'_, AppState>,
    address: String,
    amount: f64,
    comment: Option<String>,
) -> AppResult<String> {
    let params = json!([address, amount, comment.unwrap_or_default()]);
    state
        .rpc_client()
        .await?
        .call("sendtoaddress", params)
        .await
}

#[tauri::command]
pub async fn get_daemon_config(state: State<'_, AppState>) -> AppResult<DaemonConfig> {
    state.config_fresh().await
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

async fn probe_rpc(cfg: &DaemonConfig) -> RpcTestResult {
    let diag = rpc_auth_diagnostics(cfg);
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
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcTestResult> {
    let base = state.config().await;
    let partial = partial.unwrap_or_default();
    let password_override = partial
        .rpc_password
        .as_ref()
        .filter(|p| !p.is_empty());
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(&mut cfg)?;
    if let Some(p) = password_override {
        cfg.rpc_password = Some(p.clone());
    }
    let result = probe_rpc(&cfg).await;
    if result.ok {
        let _ = save_app_daemon_config(&cfg);
        state.replace_config(cfg).await;
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
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcAuthDiagnostics> {
    let base = state.config().await;
    let partial = partial.unwrap_or_default();
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(&mut cfg)?;
    Ok(rpc_auth_diagnostics(&cfg))
}

#[tauri::command]
pub async fn setup_rpc_credentials(
    state: State<'_, AppState>,
    partial: Option<PartialDaemonConfig>,
) -> AppResult<RpcCredentialsSetup> {
    let base = state.config().await;
    let partial = partial.unwrap_or_default();
    let mut cfg = apply_partial_to_config(&base, &partial);
    refresh_config_paths(&mut cfg)?;
    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "verium".to_string());
    let diag = rpc_auth_diagnostics(&cfg);
    // Reuse existing verium.conf credentials when present — regenerating on every
    // click leaves a running veriumd on the old password until restart succeeds.
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
    write_verium_conf_overrides(&cfg.datadir, &overrides)?;
    cfg.rpc_user = Some(user.clone());
    cfg.rpc_password = Some(pass.clone());
    refresh_config_paths(&mut cfg)?;
    save_app_daemon_config(&cfg)?;
    state.replace_config(cfg.clone()).await;

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
    partial: PartialDaemonConfig,
) -> AppResult<DaemonConfig> {
    let mut cfg = apply_partial_to_config(&state.config().await, &partial);
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
    write_verium_conf_overrides(&cfg.datadir, &overrides)?;
    refresh_config_paths(&mut cfg)?;
    save_app_daemon_config(&cfg)?;
    state.replace_config(cfg.clone()).await;
    Ok(cfg)
}

#[tauri::command]
pub async fn start_daemon(state: State<'_, AppState>) -> AppResult<()> {
    start_inner(state.inner()).await
}

#[tauri::command]
pub async fn stop_daemon(state: State<'_, AppState>) -> AppResult<()> {
    stop_inner(state.inner()).await
}

#[tauri::command]
pub async fn restart_daemon(state: State<'_, AppState>) -> AppResult<()> {
    let inner = state.inner();
    let _ = stop_inner(inner).await;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    start_inner(inner).await
}

#[tauri::command]
pub async fn tail_logs(
    state: State<'_, AppState>,
    lines: Option<u32>,
) -> AppResult<Vec<String>> {
    let cfg = state.config().await;
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

#[tauri::command]
pub async fn detect_veriumd() -> AppResult<DaemonBinaryStatus> {
    Ok(detect_binary())
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
pub async fn wallet_file_status(state: State<'_, AppState>) -> AppResult<WalletFileStatus> {
    let cfg = state.config_fresh().await?;
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
    let suggested_backup_path = suggested_wallet_backup_path(&cfg)?
        .display()
        .to_string();
    let note = if exists {
        None
    } else {
        Some(
            "No wallet.dat found on disk yet. If the wallet is unlocked in the app, use Back up wallet.dat — veriumd exports the live wallet file.".into(),
        )
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
pub async fn ensure_first_run(state: State<'_, AppState>) -> AppResult<FirstRunConfigResult> {
    let mut cfg = state.config().await;
    let bootstrapped = ensure_first_run_config(&mut cfg)?;
    state.replace_config(cfg.clone()).await;
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
) -> AppResult<EnsureConnectResult> {
    let inner = state.inner();
    state.daemon().record_pid(None).await;
    // Give the old process a moment to release the RPC port.
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let _ = start_inner(inner).await;
    let connected = wait_for_rpc(inner, 60).await;
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
    partial: PartialUserPreferences,
) -> AppResult<UserPreferences> {
    let current = prefs::load().await.unwrap_or_default();
    let next = prefs::merge(current, partial);
    prefs::save(&next).await?;
    Ok(next)
}

#[tauri::command]
pub async fn import_bootstrap(state: tauri::State<'_, AppState>) -> AppResult<BootstrapResult> {
    run_import_bootstrap(state.inner()).await
}

#[tauri::command]
pub async fn fetch_explorer_stats() -> AppResult<ExplorerStats> {
    fetch_network_stats().await
}

#[tauri::command]
pub async fn fetch_explorer_blocks(limit: Option<u32>) -> AppResult<Vec<ExplorerBlock>> {
    fetch_blocks(limit.unwrap_or(10)).await
}

#[tauri::command]
pub async fn fetch_explorer_transactions(
    limit: Option<u32>,
) -> AppResult<Vec<ExplorerTransaction>> {
    fetch_transactions(limit.unwrap_or(25)).await
}

#[tauri::command]
pub async fn fetch_explorer_extraction(
    limit: Option<u32>,
) -> AppResult<Vec<ExplorerExtractionEntry>> {
    fetch_extraction(limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn fetch_explorer_chain_tips() -> AppResult<Vec<ExplorerChainTip>> {
    fetch_chain_tips().await
}

#[tauri::command]
pub async fn fetch_explorer_peers_cmd() -> AppResult<Vec<ExplorerPeerEntry>> {
    fetch_explorer_peers().await
}

#[tauri::command]
pub fn get_explorer_logo_url() -> String {
    explorer_logo_url()
}

#[tauri::command]
pub fn detect_wsl_datadirs_cmd() -> AppResult<Vec<WslDatadirCandidate>> {
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

async fn ensure_wsl_veriumd_running(state: &AppState, cfg: &DaemonConfig) {
    if bundled_sidecar_available() || !is_wsl_unc_path(&cfg.datadir) {
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
            state.daemon().mark_managed().await;
        } else {
            tracing::warn!("ensure: wsl restart failed");
        }
        return;
    }
    if !wsl_veriumd_running_datadir(&cfg.datadir) {
        tracing::info!("ensure: starting WSL veriumd");
        match wsl_start_veriumd_if_stopped_datadir(&cfg.datadir, repo) {
            Ok(started) if started => state.daemon().mark_managed().await,
            Ok(_) => {}
            Err(e) => tracing::warn!("ensure: wsl start failed: {e}"),
        }
    }
}

async fn wait_for_rpc(state: &AppState, max_attempts: u32) -> bool {
    for attempt in 0..max_attempts {
        if let Ok(cfg) = state.config_fresh().await {
            if let Ok(client) = crate::rpc::RpcClient::from_config(&cfg) {
                match client.call::<Value>("getblockchaininfo", json!([])).await {
                    Ok(_) => {
                        let _ = save_app_daemon_config(&cfg);
                        tracing::info!("ensure: connected to veriumd (attempt {})", attempt + 1);
                        return true;
                    }
                    Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => {
                        let _ = save_app_daemon_config(&cfg);
                        tracing::info!(
                            "ensure: veriumd warming up (attempt {}): {}",
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
) -> AppResult<VeriumdRuntimeStatus> {
    let cfg = state.config_fresh().await?;
    if rpc_reachable(&cfg).await {
        return Ok(VeriumdRuntimeStatus {
            rpc_connected: true,
            datadir_locked: false,
            message: "A veriumd node is already running on the configured RPC port.".into(),
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
            hint: Some(
                "Quit Verium-Qt, the legacy wallet, or any terminal veriumd using the same data folder."
                    .into(),
            ),
        });
    }

    Ok(VeriumdRuntimeStatus {
        rpc_connected: false,
        datadir_locked: false,
        message: "No veriumd instance detected.".into(),
        hint: None,
    })
}

#[tauri::command]
pub async fn ensure_daemon_connected(state: State<'_, AppState>) -> AppResult<EnsureConnectResult> {
    let cfg = state.config_fresh().await?;
    if rpc_reachable(&cfg).await {
        return Ok(EnsureConnectResult {
            connected: true,
            message: "Connected to the running veriumd node.".into(),
            datadir_locked: false,
            already_running: true,
        });
    }
    ensure_wsl_veriumd_running(state.inner(), &cfg).await;
    // veriumd can take 10–30s to open RPC while verifying blocks after start.
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let connected = wait_for_rpc(state.inner(), 45).await;
    if connected {
        return Ok(EnsureConnectResult {
            connected: true,
            message: "Connected to veriumd.".into(),
            datadir_locked: false,
            already_running: false,
        });
    }

    let lines = tail_debug_log(&cfg.datadir, 40).await.unwrap_or_default();
    let datadir_locked = detect_datadir_lock_conflict(&lines).is_some();
    let message = if datadir_locked {
        detect_datadir_lock_conflict(&lines).unwrap_or_default()
    } else {
        "Could not reach veriumd. Check Settings or debug.log in your data directory.".into()
    };

    Ok(EnsureConnectResult {
        connected: false,
        message,
        datadir_locked,
        already_running: false,
    })
}

/// On wallet launch: start WSL veriumd if needed and wait for RPC.
pub async fn startup_daemon_connect(state: &AppState) {
    let cfg = match state.config_fresh().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("startup: config load failed: {e}");
            return;
        }
    };

    ensure_wsl_veriumd_running(state, &cfg).await;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    if !wait_for_rpc(state, 45).await {
        tracing::warn!("startup: veriumd not reachable after waiting");
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
    state: State<'_, AppState>,
    mode: String,
) -> AppResult<ChainRepairResult> {
    let mode_lower = mode.to_ascii_lowercase();
    if mode_lower == "bootstrap" {
        let result = run_import_bootstrap(state.inner()).await?;
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

    let cfg = state.config_fresh().await?;
    state.daemon().record_pid(None).await;

    if is_wsl_unc_path(&cfg.datadir) {
        start_wsl_veriumd_datadir(&cfg.datadir, default_wsl_repo_root(), start_mode)?;
    } else {
        if let Ok(client) = state.rpc_client().await {
            let _ = client.call_no_result("stop", json!([])).await;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        let bin = crate::daemon::detect_binary();
        let bin_path = bin
            .path
            .ok_or_else(|| AppError::other("could not locate veriumd binary"))?;
        let flag = start_mode.flag();
        let mut cmd = std::process::Command::new(&bin_path);
        cmd.arg(format!("-datadir={}", cfg.datadir.display()))
            .arg("-server=1")
            .arg(MANAGED_VERIUMD_ARGS);
        if !flag.is_empty() {
            cmd.arg(flag);
        }
        cmd.arg("-daemon");
        cmd.spawn()
            .map_err(|e| AppError::other(format!("failed to start veriumd: {e}")))?;
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
            "veriumd started with -{label}. This can take a long time; watch debug.log for progress."
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
) -> AppResult<RebuildWslResult> {
    let cfg = state.config_fresh().await?;
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
pub fn address_book_list() -> AppResult<Vec<AddressBookEntry>> {
    addressbook::list_entries()
}

#[tauri::command]
pub fn address_book_upsert(entry: AddressBookEntry) -> AppResult<AddressBookEntry> {
    addressbook::upsert_entry(entry)
}

#[tauri::command]
pub fn address_book_delete(id: String) -> AppResult<()> {
    addressbook::delete_entry(&id)
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
pub async fn diagnostic_bundle(state: State<'_, AppState>) -> AppResult<DiagnosticBundle> {
    let cfg = state.config_fresh().await.unwrap_or_default();
    let bin = detect_binary();
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
