use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

static SHUTDOWN_ONCE: AtomicBool = AtomicBool::new(false);

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::addressbook::{self, AddressBookEntry};
use crate::bootstrap::{cancel_bootstrap as request_bootstrap_cancel, import_bootstrap as run_import_bootstrap, BootstrapResult};
use crate::coin_profile::{
    all_profile_summaries, assert_vericoin, assert_verium, parse_coin_id, CoinId,
    CoinTarget, NetworkMode,
};
use crate::config::{
    apply_partial_to_config, chain_datadir, chain_index_needs_rebuild, chain_snapshot_needs_reindex,
    expected_debug_log_path,
    ensure_daemon_conf_complete, ensure_first_run_config, generate_rpc_password, generate_rpc_user,
    effective_chain_datadir, promote_root_chain_data_for_unified,
    promote_subdir_chain_data_for_legacy, resolve_legacy_wallet_outside_cfg,
    verium_uses_legacy_flat,
    prepare_chain_for_reindex, legacy_subdir_chain_ahead,
    clear_stale_datadir_lock_for_spawn,
    node_conf_dir, refresh_config_paths,
    rpc_auth_diagnostics, save_app_daemon_config, is_live_wallet_destination,
    path_for_veriumd_rpc, resolve_wallet_dat_path, suggested_wallet_backup_path,
    wallet_backup_dir, wallet_dat_exists, wallet_dat_path,
    write_node_conf_overrides, read_node_conf_file, node_conf_backup_path,
    clear_wallet_bdb_environment, node_conf_path, write_node_conf_file, DaemonConfig,
    PartialDaemonConfig, RpcAuthDiagnostics,
};
use crate::daemon::{
    apply_wallet_p2p_subversion, binary_supports_unified_chain_selector, bundled_sidecar_available,
    binary_missing_hint, detect_binary, force_stop_native_daemon, free_rpc_port,
    kill_port_listeners, native_daemon_image_running, pids_listening_on_port,
    sidecar_supports_binarytest, wallet_p2p_subversion, wait_for_native_daemon_exit,
    wait_for_rpc_port_free, DaemonBinaryStatus,
};
use crate::error::{AppError, AppResult, is_rpc_warmup};
use crate::explorer_api::{
    fetch_blocks, fetch_chain_tips, fetch_extraction, fetch_explorer_peers, fetch_network_stats,
    fetch_transactions, ExplorerBlock, ExplorerChainTip, ExplorerExtractionEntry, ExplorerPeerEntry,
    ExplorerStats, ExplorerTransaction, EXPLORER_API_ENABLED, explorer_logo_url,
};
use crate::logs::{
    current_log_session, detect_chain_corruption_session,
    detect_datadir_lock_conflict, detect_node_starting, detect_reindex_active_session,
    detect_reindex_file_rebuild_session,
    detect_invalid_block_hashes, detect_recent_coin_age_failure, detect_reindex_progress,
    detect_sync_stall, detect_txindex_complete, detect_txindex_pos_stall, effective_txindex_height,
    parse_txindex_enabled_height, parse_txindex_sync_height, tail_coin_debug_log,
    tail_debug_log,
    rpc_reports_synced,
    is_timestamp_rule_failure, log_recently_modified,
};
use crate::node::orchestrator::maybe_emit_state;
use crate::node::snapshot::{detect_binary_for_coin, snapshot_from_status};
use crate::node::status::{apply_snapshot, disconnected, warming_up, NodeStatus};
use crate::node::constants::{
    REINDEX_LOG_MAX_AGE, REPAIR_BACKOFF, TXINDEX_PAUSE_BLOCK_LAG, vericoin_should_resume_p2p,
};
use crate::prefs::{self, PartialUserPreferences, UserPreferences};
use crate::rpc::RpcClient;
use crate::state::{AppState, EarnLocalState, MinerLocalState};
use crate::updates::{check_for_updates as run_update_check, UpdateInfo};
use crate::wallet_secrets::{
    self, is_forever_unlock_duration, WALLET_UNLOCK_FOREVER_SECONDS,
};

const SHUTDOWN_PROGRESS_EVENT: &str = "shutdown-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownProgress {
    pub step: String,
    pub message: String,
    pub percent: f64,
}

fn emit_shutdown_progress(app: Option<&AppHandle>, step: &str, message: &str, percent: f64) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        SHUTDOWN_PROGRESS_EVENT,
        ShutdownProgress {
            step: step.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

async fn stop_inner(state: &AppState, coin: CoinId) -> AppResult<()> {
    stop_inner_with_policy(None, state, coin, false).await
}

async fn stop_inner_with_policy(
    app: Option<&AppHandle>,
    state: &AppState,
    coin: CoinId,
    fast: bool,
) -> AppResult<()> {
    let cfg = state.config(coin).await?;
    let binary = coin.binary_base();
    let child_wait = if fast {
        Duration::from_secs(3)
    } else {
        Duration::from_secs(30)
    };
    let rpc_wait = if fast {
        Duration::from_secs(3)
    } else {
        Duration::from_secs(30)
    };
    let force_rpc_wait = if fast {
        Duration::from_secs(2)
    } else {
        Duration::from_secs(10)
    };

    if coin == CoinId::Verium {
        emit_shutdown_progress(app, "miner_stop", "Shutting down Verium miner…", 40.0);
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("minerstop", json!([])).await;
        }
    } else if coin == CoinId::Vericoin {
        emit_shutdown_progress(app, "staking_stop", "Shutting down Vericoin staking…", 55.0);
        if let Ok(client) = state.rpc_client(coin).await {
            let _ = client.call_no_result("stakingstop", json!([])).await;
        }
    }

    emit_shutdown_progress(
        app,
        "daemon_stop",
        &format!("Stopping {}…", binary),
        if coin == CoinId::Verium { 50.0 } else { 65.0 },
    );

    if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("stop", json!([])).await;
        state
            .daemon(coin)?
            .wait_for_child_exit(child_wait)
            .await;
        wait_for_rpc_down(coin, &cfg, rpc_wait).await;
    }
    state.daemon(coin)?.force_kill_child().await;
    if !pids_listening_on_port(cfg.rpc_port).is_empty() {
        if rpc_reachable(coin, &cfg).await {
            tracing::warn!("stop: {binary} still reachable after graceful stop; forcing exit");
        } else if rpc_auth_failed(coin, &cfg).await {
            tracing::warn!(
                "stop: {binary} still listening on RPC port {} with rejected credentials; forcing exit",
                cfg.rpc_port
            );
        }
        free_rpc_port(coin, &cfg);
        wait_for_rpc_down(coin, &cfg, force_rpc_wait).await;
    }
    state.daemon(coin)?.clear_tracking().await;
    Ok(())
}

async fn lock_wallet_best_effort(app: Option<&AppHandle>, state: &AppState, coin: CoinId) {
    let percent = if coin == CoinId::Verium { 20.0 } else { 28.0 };
    emit_shutdown_progress(
        app,
        &format!("lock_{}", coin.as_str()),
        &format!("Locking {} wallet…", coin.display_name()),
        percent,
    );
    let Ok(cfg) = state.config_fresh(coin).await else {
        return;
    };
    wallet_secrets::clear_passphrase(coin, &cfg.datadir);
    if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("walletlock", json!([])).await;
    }
}

/// Stop miners, stakers, daemons, and other wallet-managed processes.
///
/// When `stop_all_coins` is true (Quit wallet / window close), every coin is
/// attempted even if disabled in preferences. Otherwise only enabled coins with
/// a bundled, managed, or RPC-reachable daemon are stopped.
pub async fn shutdown_all_vericonomy_processes(
    app: Option<&AppHandle>,
    state: &AppState,
    gpu: Option<&crate::gpu_miner::GpuMinerHandle>,
    stop_all_coins: bool,
) {
    if SHUTDOWN_ONCE.swap(true, Ordering::SeqCst) {
        tracing::debug!("shutdown: already in progress or completed");
        return;
    }

    emit_shutdown_progress(app, "preparing", "Preparing to quit…", 5.0);

    for coin in CoinId::all() {
        request_bootstrap_cancel(state, *coin);
    }

    if let Some(gpu) = gpu {
        emit_shutdown_progress(app, "gpu", "Stopping GPU miner…", 12.0);
        if let Err(e) = gpu.stop().await {
            tracing::warn!("shutdown: GPU miner stop failed: {e}");
        }
    }

    for coin in CoinId::all() {
        lock_wallet_best_effort(app, state, *coin).await;
    }

    let prefs = prefs::load().await.unwrap_or_default();

    for coin in CoinId::all() {
        if !stop_all_coins && !prefs::coin_enabled(&prefs, *coin) {
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
        let managed = match state.daemon(*coin) {
            Ok(d) => d.is_managed().await,
            Err(_) => false,
        };
        let rpc_up = rpc_reachable(*coin, &cfg).await;

        let should_stop = if stop_all_coins {
            true
        } else if bundled {
            true
        } else {
            managed || rpc_up
        };

        if !should_stop {
            tracing::debug!("shutdown ({}): no managed daemon to stop", coin.as_str());
            continue;
        }

        tracing::info!("shutdown ({}): stopping earn mode and daemon", coin.as_str());
        if let Err(e) = stop_inner_with_policy(app, state, *coin, true).await {
            tracing::warn!("shutdown ({}): stop failed: {e}", coin.as_str());
        }
    }

    emit_shutdown_progress(app, "closing", "Closing wallet…", 90.0);
}

/// Stop earn mode and daemons when the wallet UI closes.
pub async fn shutdown_daemon_on_app_exit(state: &AppState) {
    shutdown_all_vericonomy_processes(None, state, None, true).await;
}

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(20);

/// Stop managed processes, then request application exit.
pub async fn graceful_shutdown_and_exit(app: AppHandle) {
    tracing::info!("graceful_shutdown: starting");
    if let Some(state) = app.try_state::<AppState>() {
        let gpu = app.try_state::<crate::gpu_miner::GpuMinerHandle>();
        match tokio::time::timeout(
            SHUTDOWN_TIMEOUT,
            shutdown_all_vericonomy_processes(
                Some(&app),
                state.inner(),
                gpu.as_ref().map(|s| s.inner()),
                true,
            ),
        )
        .await
        {
            Ok(()) => tracing::info!("graceful_shutdown: completed"),
            Err(_) => tracing::warn!("graceful_shutdown: timed out after {}s", SHUTDOWN_TIMEOUT.as_secs()),
        }
    } else {
        tracing::warn!("graceful_shutdown: AppState unavailable");
    }
    app.exit(0);
}

/// Best-effort shutdown when the process is exiting without `graceful_shutdown_and_exit`.
/// Must not block the Exit handler — that freezes the UI on Windows.
pub fn run_shutdown_on_exit(app: &AppHandle) {
    if SHUTDOWN_ONCE.load(Ordering::SeqCst) {
        tracing::debug!("shutdown: skip exit hook, already completed");
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("verium-app-shutdown".into())
        .spawn(move || {
            if let Some(state) = app.try_state::<AppState>() {
                let gpu = app.try_state::<crate::gpu_miner::GpuMinerHandle>();
                let _ = tauri::async_runtime::block_on(async {
                    tokio::time::timeout(
                        Duration::from_secs(15),
                        shutdown_all_vericonomy_processes(
                            Some(&app),
                            state.inner(),
                            gpu.as_ref().map(|s| s.inner()),
                            true,
                        ),
                    )
                    .await
                });
            }
        });
}

#[tauri::command]
pub async fn quit_wallet(app: AppHandle) -> AppResult<()> {
    graceful_shutdown_and_exit(app).await;
    Ok(())
}

async fn wait_for_rpc_down(coin: CoinId, cfg: &DaemonConfig, timeout: std::time::Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if !rpc_reachable(coin, cfg).await {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

pub(crate) async fn rpc_reachable(coin: CoinId, cfg: &DaemonConfig) -> bool {
    rpc_serves_coin(coin, cfg).await.is_ok()
}

/// RPC responds and `getblockchaininfo.chain` matches the requested coin.
pub(crate) async fn rpc_serves_coin(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let expected_port = expected_rpc_port(coin, cfg);
    if cfg.rpc_port != expected_port {
        return Err(AppError::other(format!(
            "{} RPC is configured for port {} but must use {expected_port}",
            coin.display_name(),
            cfg.rpc_port
        )));
    }
    let client = RpcClient::from_config_for_coin(coin, cfg)?;
    let info: Value = match client.call("getblockchaininfo", json!([])).await {
        Ok(v) => v,
        Err(AppError::Rpc { code, .. }) if is_rpc_warmup(code) => {
            return Ok(());
        }
        Err(AppError::DaemonUnreachable(msg)) if msg.contains("unauthorized") => {
            return Err(AppError::DaemonUnreachable(msg));
        }
        Err(AppError::DaemonUnreachable(_)) if !pids_listening_on_port(cfg.rpc_port).is_empty() => {
            return Err(AppError::DaemonUnreachable(
                "node is starting on RPC port".into(),
            ));
        }
        Err(e) => return Err(e),
    };
    let chain = info
        .get("chain")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if coin.rpc_chain_matches(chain, &cfg.chain) {
        return Ok(());
    }
    Err(AppError::other(format!(
        "RPC port {} is serving the \"{chain}\" chain, not {}",
        cfg.rpc_port,
        coin.display_name()
    )))
}

fn expected_rpc_port(coin: CoinId, cfg: &DaemonConfig) -> u16 {
    if cfg.chain.starts_with("binarytest-") {
        CoinTarget::new(coin, NetworkMode::BinaryTest).rpc_port()
    } else {
        coin.default_rpc_port()
    }
}

pub(crate) async fn rpc_auth_failed(coin: CoinId, cfg: &DaemonConfig) -> bool {
    let Ok(client) = RpcClient::from_config_for_coin(coin, cfg) else {
        return false;
    };
    matches!(
        client.call::<Value>("getblockchaininfo", json!([])).await,
        Err(AppError::DaemonUnreachable(msg)) if msg.contains("unauthorized")
    )
}

/// RPC is down but a node is plausibly still booting (port open, managed child, or live reindex).
pub(crate) async fn daemon_boot_in_progress(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> bool {
    if !pids_listening_on_port(cfg.rpc_port).is_empty() {
        if !rpc_auth_failed(coin, cfg).await {
            return true;
        }
        // Auth rejected on an open port — fall through to log checks (reindex can
        // outlive RPC bind failures or stale credentials on a competing process).
    } else if let Ok(daemon) = state.daemon(coin) {
        if daemon.child_running().await {
            return true;
        }
    }
    if native_daemon_image_running(coin) {
        let log_path = expected_debug_log_path(coin, cfg);
        if log_recently_modified(&log_path, Duration::from_secs(120)) {
            let lines = tail_coin_debug_log(coin, cfg, 40)
                .await
                .unwrap_or_default();
            if detect_reindex_active_session(&lines, state.pending_reindex_active(coin))
                || detect_node_starting(&lines)
            {
                return true;
            }
        }
    }
    false
}

/// Log-only hint for warming UX; requires a live process so stale debug.log lines
/// cannot keep the UI in "Opening chain data" after veriumd exits.
pub(crate) async fn daemon_log_suggests_loading(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> bool {
    let process_up = native_daemon_image_running(coin)
        || daemon_process_live(state, coin, cfg).await
        || !pids_listening_on_port(cfg.rpc_port).is_empty();
    if !process_up {
        return false;
    }
    let log_path = expected_debug_log_path(coin, cfg);
    if !log_recently_modified(&log_path, Duration::from_secs(90)) {
        return false;
    }
    let lines = tail_coin_debug_log(coin, cfg, 40)
        .await
        .unwrap_or_default();
    detect_reindex_active_session(&lines, false) || detect_node_starting(&lines)
}

async fn suppress_competing_auto_start(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> bool {
    if state.bootstrap_loading_active(coin) {
        if rpc_reachable(coin, cfg).await {
            return true;
        }
        if let Ok(daemon) = state.daemon(coin) {
            if daemon.child_running().await {
                return true;
            }
        }
        if reindex_running_live(state, coin, cfg).await {
            return true;
        }
    }
    if state.pending_reindex_active(coin) {
        if reindex_running_live(state, coin, cfg).await
            || native_daemon_image_running(coin)
            || daemon_process_live(state, coin, cfg).await
        {
            return true;
        }
    }
    if state.spawn_recent(coin) && !pids_listening_on_port(cfg.rpc_port).is_empty() {
        if !rpc_auth_failed(coin, cfg).await {
            return true;
        }
    }
    daemon_boot_in_progress(state, coin, cfg).await
}

fn daemon_needs_reindex_start(state: &AppState, coin: CoinId, cfg: &DaemonConfig) -> bool {
    if coin == CoinId::Verium && verium_uses_legacy_flat(cfg) {
        return false;
    }
    if state.pending_reindex_active(coin) {
        return true;
    }
    chain_index_needs_rebuild(&effective_chain_datadir(coin, cfg))
}

pub(crate) async fn bootstrap_suppresses_auto_start(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> bool {
    suppress_competing_auto_start(state, coin, cfg).await
}

pub(crate) async fn daemon_process_live(state: &AppState, coin: CoinId, cfg: &DaemonConfig) -> bool {
    if let Ok(d) = state.daemon(coin) {
        if d.child_running().await {
            return true;
        }
    }
    !pids_listening_on_port(cfg.rpc_port).is_empty()
}

pub(crate) async fn reindex_running_live(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> bool {
    let log_path = expected_debug_log_path(coin, cfg);
    let process_up =
        daemon_process_live(state, coin, cfg).await || native_daemon_image_running(coin);

    if state.pending_reindex_active(coin) && process_up {
        return true;
    }

    if !log_recently_modified(&log_path, REINDEX_LOG_MAX_AGE) {
        return false;
    }
    let lines = tail_coin_debug_log(coin, cfg, 120).await.unwrap_or_default();
    let session = current_log_session(&lines);
    if detect_reindex_file_rebuild_session(&session) {
        return process_up;
    }
    if state.pending_reindex_active(coin) && detect_reindex_progress(&session).is_some() {
        return process_up;
    }
    false
}

async fn stop_daemon_fully_for_repair(state: &AppState, coin: CoinId, cfg: &DaemonConfig) {
    if let Ok(client) = state.rpc_client(coin).await {
        let _ = client.call_no_result("stop", json!([])).await;
    }
    if let Ok(daemon) = state.daemon(coin) {
        daemon.wait_for_child_exit(Duration::from_secs(5)).await;
        daemon.force_kill_child().await;
        daemon.clear_tracking().await;
    }
    free_rpc_port(coin, cfg);
    wait_for_rpc_port_free(cfg.rpc_port, Duration::from_secs(30)).await;
    wait_for_native_daemon_exit(coin, Duration::from_secs(15)).await;
}

async fn start_inner(state: &AppState, coin: CoinId) -> AppResult<()> {
    let _guard = state.runtime(coin)?.ensure_lock.lock().await;
    start_inner_impl(state, coin, false).await
}

pub(crate) async fn start_inner_impl(state: &AppState, coin: CoinId, force: bool) -> AppResult<()> {
    let mut cfg = state.config_fresh(coin).await?;
    crate::config::sync_cfg_rpc_credentials_from_conf(coin, &mut cfg)?;
    let _ = promote_root_chain_data_for_unified(coin, &cfg);
    ensure_daemon_conf_complete(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    let binary = coin.binary_base();
    if !force && suppress_competing_auto_start(state, coin, &cfg).await {
        tracing::debug!(
            "start: skipped {binary} — node is already starting or recently spawned"
        );
        return Ok(());
    }
    if rpc_reachable(coin, &cfg).await {
        tracing::info!("start: {binary} already running for this datadir");
        state.daemon(coin)?.mark_managed().await;
        return Ok(());
    }
    if !pids_listening_on_port(cfg.rpc_port).is_empty() {
        if rpc_auth_failed(coin, &cfg).await {
            let datadir = chain_datadir(coin, &cfg);
            let lines = tail_debug_log(&datadir, 80).await.unwrap_or_default();
            if (detect_reindex_active_session(&lines, state.pending_reindex_active(coin))
                || state.pending_reindex_active(coin))
                && native_daemon_image_running(coin)
            {
                tracing::info!(
                    "start: port {} in use during active reindex — waiting for RPC",
                    cfg.rpc_port
                );
                state.daemon(coin)?.mark_managed().await;
                state.mark_spawn(coin);
                state.set_daemon_phase(coin, "reindexing");
                return Ok(());
            }
            tracing::warn!(
                "start: port {} in use with stale RPC credentials — stopping listeners",
                cfg.rpc_port
            );
            kill_port_listeners(cfg.rpc_port);
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        } else {
            tracing::info!(
                "start: port {} in use — {binary} is starting, waiting for RPC",
                cfg.rpc_port
            );
            state.daemon(coin)?.mark_managed().await;
            state.mark_spawn(coin);
            return Ok(());
        }
    }
    let daemon = state.daemon(coin)?;
    if daemon.is_managed().await {
        if daemon.child_running().await {
            tracing::debug!("start: {binary} already spawned this session (waiting for RPC)");
            return Ok(());
        }
        tracing::warn!("start: {binary} exited after spawn; checking whether repair is needed");
        daemon.clear_tracking().await;
    }
    let lines = tail_coin_debug_log(coin, &cfg, 120).await.unwrap_or_default();
    if let Some(message) = detect_datadir_lock_conflict(&lines) {
        return Err(AppError::other(message));
    }
    if reindex_running_live(state, coin, &cfg).await {
        tracing::info!(
            "start: {binary} reindex is in progress — not interrupting"
        );
        state.daemon(coin)?.mark_managed().await;
        state.mark_spawn(coin);
        state.set_daemon_phase(coin, "reindexing");
        return Ok(());
    }
    if let Some(detail) = detect_chain_corruption_session(&lines) {
        if !is_timestamp_rule_failure(&detail) {
            if chain_snapshot_needs_reindex(&chain_datadir(coin, &cfg)) {
                tracing::info!(
                    "start: {binary} has block files but no chainstate — use Download snapshot, not auto-reindex"
                );
            } else if coin == CoinId::Verium && verium_uses_legacy_flat(&cfg) {
                tracing::info!(
                    "start: {binary} chain DB error — use Download snapshot (mainnet does not auto-reindex)"
                );
            } else {
                tracing::info!(
                    "start: {binary} chain DB error in debug.log — repairing with -reindex"
                );
                return start_with_chain_repair(state, coin, &cfg).await;
            }
        }
    }
    if daemon_needs_reindex_start(state, coin, &cfg) {
        tracing::info!(
            "start: {binary} block index needs rebuild — launching with -reindex"
        );
        state.mark_pending_reindex(coin);
        return start_with_chain_repair(state, coin, &cfg).await;
    }
    let _pid = state.daemon(coin)?.start(&cfg, &[]).await?;
    state.mark_spawn(coin);
    Ok(())
}

pub(crate) async fn start_with_chain_repair(state: &AppState, coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let binary = coin.binary_base();
    if coin == CoinId::Verium && verium_uses_legacy_flat(cfg) {
        return Err(AppError::other(format!(
            "{binary} mainnet never uses -reindex. Download the blockchain snapshot instead."
        )));
    }
    if reindex_running_live(state, coin, cfg).await {
        tracing::info!("repair: {binary} reindex already running — not interrupting");
        if let Ok(d) = state.daemon(coin) {
            d.mark_managed().await;
        }
        state.set_daemon_phase(coin, "reindexing");
        return Ok(());
    }
    let datadir = chain_datadir(coin, cfg);
    let lines = tail_debug_log(&datadir, 80).await.unwrap_or_default();
    if detect_reindex_file_rebuild_session(&lines) && native_daemon_image_running(coin) {
        tracing::info!(
            "repair: {binary} reindex active in existing process — not interrupting"
        );
        if let Ok(d) = state.daemon(coin) {
            d.mark_managed().await;
        }
        state.set_daemon_phase(coin, "reindexing");
        return Ok(());
    }
    stop_daemon_fully_for_repair(state, coin, cfg).await;

    if !detect_binary(coin).manageable {
        return Err(AppError::other(format!(
            "could not locate a runnable {binary} binary to rebuild the chain index"
        )));
    }

    prepare_chain_for_reindex(coin, cfg)?;
    state.mark_pending_reindex(coin);
    state.daemon(coin)?.start(cfg, &["-reindex"]).await?;
    state.mark_spawn(coin);
    state.mark_repair_attempt(coin);
    state.set_daemon_phase(coin, "reindexing");
    tracing::info!("start: {binary} launched with -reindex after chain DB repair prep");
    Ok(())
}

async fn start_with_reindex(state: &AppState, coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    start_with_chain_repair(state, coin, cfg).await
}

#[tauri::command]
pub async fn get_node_status(
    app: AppHandle,
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<NodeStatus> {
    let coin = parse_coin_id(&coin)?;
    let mut cfg = state.config_fresh(coin).await?;

    if !state.inner().bootstrap_loading_active(coin)
        && !state.inner().bootstrap_session_active()
        && detect_binary(coin).manageable
    {
        // Observe-only fast path: if this session already manages a live child, status
        // polling must not spawn or probe the process table — the supervisor loop owns
        // recovery. This keeps every status refresh from shelling out to tasklist and
        // flooding the Windows message queue during long-running sessions.
        let child_up = match state.inner().daemon(coin) {
            Ok(d) => d.child_running().await,
            Err(_) => false,
        };
        if !child_up {
            let rpc_up = rpc_reachable(coin, &cfg).await;
            if !rpc_up {
                let booting = daemon_boot_in_progress(state.inner(), coin, &cfg).await;
                let reindexing = reindex_running_live(state.inner(), coin, &cfg).await;
                if !booting && !reindexing {
                    ensure_daemon_running(state.inner(), coin, &cfg).await;
                    cfg = state.config_fresh(coin).await?;
                }
            }
        }
    }
    if state.inner().bootstrap_loading_active(coin) {
        return Ok(warming_up(format!(
            "{} is loading imported chain data after bootstrap. This may take a few minutes.",
            coin.binary_base()
        )));
    }
    let status = match RpcClient::status_client_for_coin(coin, &cfg) {
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
                    network_active: network_info
                        .get("networkactive")
                        .and_then(Value::as_bool),
                    warnings: chain_info
                        .get("warnings")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    version: network_info.get("version").and_then(Value::as_i64),
                    subversion: if state.daemon(coin)?.is_managed().await {
                        Some(wallet_p2p_subversion().to_string())
                    } else {
                        network_info
                            .get("subversion")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    },
                    ..Default::default()
                }
            }
            Err(AppError::DaemonUnreachable(msg)) => {
                if daemon_boot_in_progress(state.inner(), coin, &cfg).await
                    || daemon_log_suggests_loading(state.inner(), coin, &cfg).await
                {
                    warming_up(format!(
                        "{} is loading the chain index. This may take several minutes.",
                        coin.binary_base()
                    ))
                } else {
                    let error = binary_missing_hint(coin)
                        .or(Some(crate::node::status::friendly_connection_error(&msg)));
                    disconnected(error)
                }
            }
            Err(AppError::Rpc { code, message }) if is_rpc_warmup(code) => warming_up(message),
            Err(e) => return Err(e),
        },
        Err(AppError::DaemonUnreachable(msg)) => {
            if daemon_boot_in_progress(state.inner(), coin, &cfg).await
                || daemon_log_suggests_loading(state.inner(), coin, &cfg).await
            {
                warming_up(format!(
                    "{} is loading the chain index. This may take several minutes.",
                    coin.binary_base()
                ))
            } else {
                let error = binary_missing_hint(coin)
                    .or(Some(crate::node::status::friendly_connection_error(&msg)));
                disconnected(error)
            }
        }
        Err(e) => return Err(e),
    };
    let mut status = enrich_status_from_log(
        status,
        state.inner(),
        coin,
        &cfg,
        &effective_chain_datadir(coin, &cfg),
    )
    .await;
    if status.connected {
        if let Some(rpc_chain) = status.chain.as_deref() {
            if !coin.rpc_chain_matches(rpc_chain, &cfg.chain) {
                status.error = Some(format!(
                    "This RPC port is serving the \"{rpc_chain}\" chain, not {}. \
                     Restart the {} node from Settings.",
                    coin.display_name(),
                    coin.binary_base()
                ));
                status.daemon_phase = Some("error".into());
            }
        }
        state.inner().clear_auto_reindex_attempt(coin);
        state.inner().clear_bootstrap_loading(coin);
        if status.blocks.unwrap_or(0) > 10_000 {
            state.inner().clear_pending_reindex(coin);
        }
        state.inner().clear_auth_restart_attempts(coin);
    }
    let binary = detect_binary_for_coin(coin);
    let snap = snapshot_from_status(coin, &status, &binary);
    apply_snapshot(&mut status, &snap);
    maybe_emit_state(&app, coin, &snap);
    Ok(status)
}

async fn enrich_status_from_log(
    mut status: NodeStatus,
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
    datadir: &std::path::Path,
) -> NodeStatus {
    let lines = tail_debug_log(datadir, 120).await.unwrap_or_default();
    let session = current_log_session(&lines);
    let log_path = datadir.join("debug.log");
    let log_live = log_recently_modified(&log_path, Duration::from_secs(45));

    // Vericoin: always run txindex/P2P heal and surface network state — even when
    // the chain header tip is caught up (the early return below used to skip this).
    if status.connected && !status.warming_up && coin == CoinId::Vericoin {
        status = enrich_vericoin_connected_status(status, state, coin, cfg).await;
    }

    if rpc_reports_synced(
        status.connected,
        status.initial_block_download,
        status.blocks,
        status.headers,
    ) {
        return status;
    }

    if let Some(progress) = detect_reindex_progress(&session) {
        let process_up = daemon_process_live(state, coin, cfg).await;
        let pending = state.pending_reindex_active(coin);
        let rebuilding = detect_reindex_file_rebuild_session(&session);
        if (rebuilding || pending) && process_up && log_live {
            status.reindex_header = Some(progress.header);
            status.reindex_in_progress = true;
            status.warming_up = true;
            status.connected = true;
            status.chain_corrupt = false;
            status.needs_bootstrap = false;
            status.daemon_phase = Some("reindexing".into());
            status.error = Some(progress.message);
            return status;
        }
    }

    if crate::config::chain_snapshot_needs_reindex(datadir) {
        status.chain_corrupt = true;
        status.needs_bootstrap = true;
        status.reindex_in_progress = if coin == CoinId::Verium && verium_uses_legacy_flat(cfg) {
            false
        } else {
            reindex_running_live(state, coin, cfg).await
        };
        status.error = Some(
            "Blockchain snapshot is incomplete (chainstate missing). \
             Download blockchain snapshot to sync quickly — do not use Repair unless bootstrap fails."
                .into(),
        );
    }

    if !status.connected || status.warming_up {
        if let Some(detail) = detect_chain_corruption_session(&lines) {
            if is_timestamp_rule_failure(&detail) {
                status.error = Some(
                    "veriumd rejected valid mainnet blocks during startup verification. \
                     Restart the node from Settings (the app passes -checklevel=0)."
                        .into(),
                );
            } else {
                status.chain_corrupt = true;
                status.chain_repair_detail = Some(detail.clone());
                status.daemon_phase = Some("error".into());
                if status.error.is_none() {
                    status.error = Some(
                        "Chain database needs repair. The wallet will rebuild the index automatically."
                            .into(),
                    );
                }
            }
        }
        return status;
    }

    if status.connected {
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
    }
    status
}

async fn enrich_vericoin_connected_status(
    mut status: NodeStatus,
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> NodeStatus {
    let lines = tail_coin_debug_log(coin, cfg, 200).await.unwrap_or_default();
    if detect_txindex_pos_stall(&lines) || detect_txindex_complete(&lines) {
        status.txindex_sync_height = effective_txindex_height(&lines);
    }
    if status.network_active.is_none() {
        status.network_active = rpc_network_active(state, coin).await;
    }
    let _ = heal_invalid_blocks_silently(state, coin, cfg).await;
    status.txindex_network_paused = state.txindex_network_paused(coin);
    if status.network_active == Some(false) {
        status.txindex_network_paused = true;
    }
    status
}

async fn rpc_network_active(state: &AppState, coin: CoinId) -> Option<bool> {
    state
        .rpc_client(coin)
        .await
        .ok()?
        .call::<Value>("getnetworkinfo", json!([]))
        .await
        .ok()?
        .get("networkactive")
        .and_then(Value::as_bool)
}

async fn set_network_active(state: &AppState, coin: CoinId, active: bool) -> AppResult<()> {
    state
        .rpc_client(coin)
        .await?
        .call_no_result("setnetworkactive", json!([active]))
        .await
}

/// Clears incorrectly invalid-marked blocks via RPC without updating UI status fields.
pub(crate) async fn heal_invalid_blocks_silently(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> AppResult<()> {
    let paused = state.txindex_network_paused(coin);
    if state.invalid_clear_backoff_active(coin) && !paused {
        return Ok(());
    }

    let lines = tail_coin_debug_log(coin, cfg, 200).await?;

    if coin == CoinId::Vericoin && detect_txindex_complete(&lines) {
        return resume_vericoin_after_txindex(state, coin, &lines).await;
    }

    if coin == CoinId::Vericoin && detect_txindex_pos_stall(&lines) {
        return heal_vericoin_txindex_stall(state, coin, &lines).await;
    }

    if coin == CoinId::Vericoin {
        let _ = ensure_vericoin_p2p_live(state, coin, cfg).await;
    }

    let hashes = detect_invalid_block_hashes(&lines);
    if hashes.is_empty() {
        return Ok(());
    }
    if detect_recent_coin_age_failure(&lines) {
        tracing::debug!(
            "heal (vericoin): skipping reconsiderblock — txindex not ready for PoS blocks"
        );
        return Ok(());
    }
    match clear_invalid_blocks_via_rpc(state, coin, &hashes).await {
        Ok(_) => {
            state.mark_invalid_clear_attempt(coin);
            tracing::info!(
                "heal ({}): cleared invalid flag on {} block(s) in background",
                coin.as_str(),
                hashes.len()
            );
        }
        Err(e) => {
            tracing::debug!(
                "heal ({}): reconsiderblock will retry ({e})",
                coin.as_str()
            );
        }
    }
    Ok(())
}

/// After txindex finishes: turn P2P back on and clear bogus invalid flags from the lag window.
async fn resume_vericoin_after_txindex(
    state: &AppState,
    coin: CoinId,
    lines: &[String],
) -> AppResult<()> {
    let hashes = detect_invalid_block_hashes(lines);
    let txindex_h = effective_txindex_height(lines);
    let chain_blocks: Option<u64> = state
        .rpc_client(coin)
        .await?
        .call::<serde_json::Value>("getblockchaininfo", json!([]))
        .await
        .ok()
        .and_then(|v| v.get("blocks").and_then(|b| b.as_u64()));

    if state.txindex_network_paused(coin) {
        if let Err(e) = set_network_active(state, coin, true).await {
            tracing::warn!("heal (vericoin): setnetworkactive true after txindex done failed: {e}");
        } else {
            state.set_txindex_network_paused(coin, false);
            tracing::info!(
                "heal (vericoin): resumed P2P — txindex finished (chain ~{}, index ~{:?})",
                chain_blocks.unwrap_or(0),
                txindex_h
            );
        }
    }

    if !hashes.is_empty() && !detect_recent_coin_age_failure(lines) {
        match clear_invalid_blocks_via_rpc(state, coin, &hashes).await {
            Ok(_) => tracing::info!(
                "heal (vericoin): cleared invalid flag on {} block(s) after txindex ready",
                hashes.len()
            ),
            Err(e) => tracing::debug!("heal (vericoin): reconsiderblock after txindex ({e})"),
        }
    }
    state.mark_invalid_clear_attempt(coin);
    Ok(())
}

/// Pause P2P while txindex catches up; `reconsiderblock` alone retriggers failed ConnectTip.
async fn heal_vericoin_txindex_stall(
    state: &AppState,
    coin: CoinId,
    lines: &[String],
) -> AppResult<()> {
    let hashes = detect_invalid_block_hashes(lines);
    let txindex_h = effective_txindex_height(lines);
    let chain_info: Option<Value> = state
        .rpc_client(coin)
        .await?
        .call("getblockchaininfo", json!([]))
        .await
        .ok();
    let chain_blocks = chain_info
        .as_ref()
        .and_then(|v| v.get("blocks").and_then(|b| b.as_u64()));
    let chain_headers = chain_info
        .as_ref()
        .and_then(|v| v.get("headers").and_then(|b| b.as_u64()));
    let chain_ibd = chain_info
        .as_ref()
        .and_then(|v| v.get("initialblockdownload").and_then(|b| b.as_bool()));

    let block_lag = match (chain_blocks, txindex_h) {
        (Some(b), Some(t)) => b.saturating_sub(t),
        _ => u64::MAX,
    };

    let coin_age_fail = detect_recent_coin_age_failure(lines);
    let stall_active = detect_txindex_pos_stall(lines);
    let txindex_done = detect_txindex_complete(lines);
    let synced_at_tip = rpc_reports_synced(true, chain_ibd, chain_blocks, chain_headers);

    let should_pause = coin_age_fail
        || (!hashes.is_empty() && block_lag > TXINDEX_PAUSE_BLOCK_LAG)
        || block_lag == u64::MAX && coin_age_fail;

    if should_pause && !state.txindex_network_paused(coin) {
        if let Err(e) = set_network_active(state, coin, false).await {
            tracing::warn!("heal (vericoin): setnetworkactive false failed: {e}");
        } else {
            state.set_txindex_network_paused(coin, true);
            tracing::info!(
                "heal (vericoin): paused P2P while txindex catches up (chain ~{}, txindex ~{:?}, lag {})",
                chain_blocks.unwrap_or(0),
                txindex_h,
                block_lag
            );
        }
        state.mark_invalid_clear_attempt(coin);
        return Ok(());
    }

    let rpc_inactive = rpc_network_active(state, coin).await == Some(false);
    if state.txindex_network_paused(coin) || rpc_inactive {
        let index_at_tip = match (chain_blocks, txindex_h) {
            (Some(b), Some(t)) => t >= b.saturating_sub(2),
            _ => false,
        };
        let can_resume = vericoin_should_resume_p2p(
            coin_age_fail,
            stall_active,
            txindex_done,
            index_at_tip,
            block_lag,
            synced_at_tip,
        );

        if can_resume {
            if let Err(e) = set_network_active(state, coin, true).await {
                tracing::warn!("heal (vericoin): setnetworkactive true failed: {e}");
                return Ok(());
            }
            state.set_txindex_network_paused(coin, false);
            if !hashes.is_empty() {
                let _ = clear_invalid_blocks_via_rpc(state, coin, &hashes).await;
            }
            tracing::info!(
                "heal (vericoin): resumed P2P after txindex caught up (lag {block_lag} blocks)"
            );
        }
        state.mark_invalid_clear_attempt(coin);
        return Ok(());
    }

    // Txindex stall detected but lag not huge — do not reconsider if coin-age is failing.
    if coin_age_fail || !hashes.is_empty() {
        state.mark_invalid_clear_attempt(coin);
        return Ok(());
    }
    Ok(())
}

/// Re-enable P2P when the node is caught up but networkactive is still false without
/// a matching in-app pause flag (e.g. after a crash or external RPC change).
async fn ensure_vericoin_p2p_live(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> AppResult<()> {
    if rpc_network_active(state, coin).await != Some(false) {
        if state.txindex_network_paused(coin) {
            state.set_txindex_network_paused(coin, false);
        }
        return Ok(());
    }

    let lines = tail_coin_debug_log(coin, cfg, 200).await?;
    let stall_active = detect_txindex_pos_stall(&lines);
    if stall_active {
        return Ok(());
    }

    let chain_info: Option<Value> = state
        .rpc_client(coin)
        .await?
        .call("getblockchaininfo", json!([]))
        .await
        .ok();
    let chain_blocks = chain_info
        .as_ref()
        .and_then(|v| v.get("blocks").and_then(|b| b.as_u64()));
    let chain_headers = chain_info
        .as_ref()
        .and_then(|v| v.get("headers").and_then(|b| b.as_u64()));
    let chain_ibd = chain_info
        .as_ref()
        .and_then(|v| v.get("initialblockdownload").and_then(|b| b.as_bool()));
    let txindex_h = effective_txindex_height(&lines);
    let block_lag = match (chain_blocks, txindex_h) {
        (Some(b), Some(t)) => b.saturating_sub(t),
        _ => u64::MAX,
    };
    let coin_age_fail = detect_recent_coin_age_failure(&lines);
    let txindex_done = detect_txindex_complete(&lines);
    let synced_at_tip = rpc_reports_synced(true, chain_ibd, chain_blocks, chain_headers);
    let index_at_tip = match (chain_blocks, txindex_h) {
        (Some(b), Some(t)) => t >= b.saturating_sub(2),
        _ => false,
    };

    if !vericoin_should_resume_p2p(
        coin_age_fail,
        stall_active,
        txindex_done,
        index_at_tip,
        block_lag,
        synced_at_tip,
    ) {
        return Ok(());
    }

    if let Err(e) = set_network_active(state, coin, true).await {
        tracing::warn!("heal (vericoin): setnetworkactive true (orphan pause) failed: {e}");
    } else {
        state.set_txindex_network_paused(coin, false);
        tracing::info!("heal (vericoin): re-enabled P2P — node was synced but network was inactive");
    }
    Ok(())
}

async fn clear_invalid_blocks_via_rpc(
    state: &AppState,
    coin: CoinId,
    hashes: &[String],
) -> AppResult<String> {
    if hashes.is_empty() {
        return Err(AppError::other("No invalid block hashes to clear"));
    }
    let client = state.rpc_client(coin).await?;
    for hash in hashes {
        client
            .call_no_result("reconsiderblock", json!([hash]))
            .await?;
    }
    let primary = &hashes[0];
    let extra = hashes.len().saturating_sub(1);
    Ok(if extra == 0 {
        format!(
            "Cleared invalid flag on block {primary}. Sync should resume once the chain can validate the next block."
        )
    } else {
        format!(
            "Cleared invalid flags on {primary} and {extra} other block(s). Sync should resume once validation succeeds."
        )
    })
}

async fn clear_invalid_block_via_rpc(
    state: &AppState,
    coin: CoinId,
    hash: &str,
) -> AppResult<String> {
    clear_invalid_blocks_via_rpc(state, coin, &[hash.to_string()]).await
}

#[tauri::command]
pub async fn node_retry(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    if heal_invalid_blocks_silently(state.inner(), coin, &cfg).await.is_ok() {
        let lines = tail_coin_debug_log(coin, &cfg, 120).await.unwrap_or_default();
        if detect_invalid_block_hashes(&lines).is_empty() {
            return Ok(());
        }
    }
    restart_daemon_full_cycle(state.inner(), coin).await?;
    Ok(())
}

#[tauri::command]
pub async fn node_clear_invalid_block(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    let datadir = chain_datadir(coin, &cfg);
    let lines = tail_debug_log(&datadir, 120).await.unwrap_or_default();
    let hashes = detect_invalid_block_hashes(&lines);
    if hashes.is_empty() {
        return Err(AppError::other(
            "No invalid-block sync stall detected in debug.log",
        ));
    }
    clear_invalid_blocks_via_rpc(state.inner(), coin, &hashes).await
}

#[tauri::command]
pub async fn node_reset_credentials(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<()> {
    let coin = parse_coin_id(&coin)?;
    let mut cfg = state.config_fresh(coin).await?;
    sync_rpc_daemon_config(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    restart_managed_daemon(state.inner(), coin, &cfg).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_blockchain_info(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<Value> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await?;
    if detect_binary(coin).manageable
        && !state.inner().bootstrap_session_active()
        && !rpc_reachable(coin, &cfg).await
        && !daemon_boot_in_progress(state.inner(), coin, &cfg).await
    {
        ensure_daemon_running(state.inner(), coin, &cfg).await;
    }
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
    let mut info = state
        .rpc_client(coin)
        .await?
        .call("getnetworkinfo", json!([]))
        .await?;
    if state.daemon(coin)?.is_managed().await {
        apply_wallet_p2p_subversion(&mut info);
    }
    Ok(info)
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
    let cfg = state.config_fresh(coin).await?;
    let client = state.rpc_client(coin).await?;
    assert_rpc_matches_coin(&client, coin, &cfg).await?;
    let params = match label {
        Some(l) if !l.is_empty() => json!([l]),
        _ => json!([]),
    };
    let address: String = client.call("getnewaddress", params).await?;
    assert_address_in_wallet(&client, coin, &address).await?;
    Ok(address)
}

async fn assert_address_in_wallet(
    client: &RpcClient,
    coin: CoinId,
    address: &str,
) -> AppResult<()> {
    // getaddressinfo rejects invalid addresses at the RPC layer; unlike validateaddress
    // it does not include an "isvalid" field — only ismine / solvable / script metadata.
    let info: Value = client
        .call("getaddressinfo", json!([address]))
        .await
        .map_err(|e| {
            AppError::other(format!(
                "Could not verify {} address ownership ({e})",
                coin.symbol()
            ))
        })?;
    if info.get("ismine").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::other(format!(
            "Generated address is not in the {} wallet — the RPC node may be on the wrong chain",
            coin.display_name()
        )));
    }
    Ok(())
}

async fn assert_rpc_matches_coin(
    client: &RpcClient,
    coin: CoinId,
    cfg: &DaemonConfig,
) -> AppResult<()> {
    let expected_port = expected_rpc_port(coin, cfg);
    if cfg.rpc_port != expected_port {
        return Err(AppError::other(format!(
            "The {} wallet is pointed at RPC port {} but must use port {expected_port}. \
             Open Settings and restart the {} node.",
            coin.display_name(),
            cfg.rpc_port,
            coin.binary_base()
        )));
    }
    let info: Value = client.call("getblockchaininfo", json!([])).await?;
    let chain = info
        .get("chain")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if coin.rpc_chain_matches(chain, &cfg.chain) {
        return Ok(());
    }
    Err(AppError::other(format!(
        "The {} node RPC is serving the \"{chain}\" chain instead of {}. \
         Restart the {} node from Settings so it starts with the correct chain \
         (unified veriumd must run with -vericoin for Vericoin).",
        coin.display_name(),
        coin.display_name(),
        coin.binary_base(),
    )))
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
    reward_address: Option<String>,
) -> AppResult<MinerLocalState> {
    let coin = parse_coin_id(&coin)?;
    assert_verium(coin)?;
    let mut params = vec![json!(threads)];
    if let Some(addr) = reward_address.and_then(|a| {
        let trimmed = a.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        params.push(json!(addr));
    }
    let _: Value = state
        .rpc_client(coin)
        .await?
        .call("minerstart", json!(params))
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

/// Flush and copy wallet.dat to `dest` via backupwallet RPC when the node is running.
pub async fn backup_wallet_to_path(
    state: &AppState,
    coin: CoinId,
    cfg: &DaemonConfig,
    dest: &Path,
) -> AppResult<()> {
    if is_live_wallet_destination(coin, cfg, dest) {
        return Err(AppError::other(
            "Cannot save over the live wallet.dat file. Pick a different name — for example verium-wallet-YYYYMMDD-HHMMSS.dat in the backups folder.",
        ));
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let backup_dir = wallet_backup_dir(coin, cfg)?;
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
        std::fs::copy(&snapshot, dest).map_err(|e| {
            AppError::other(format!(
                "Could not copy wallet backup to {}: {e}",
                dest.display()
            ))
        })?;
        let _ = std::fs::remove_file(&snapshot);
        return Ok(());
    }

    if let Err(AppError::Rpc { message, .. }) = &rpc_result {
        tracing::warn!("wallet backup: backupwallet rpc failed: {message}");
    } else if rpc_result.is_ok() {
        tracing::warn!(
            "wallet backup: backupwallet returned ok but snapshot missing at {}",
            snapshot.display()
        );
    }
    let live = resolve_wallet_dat_path(coin, cfg).ok_or_else(|| {
        AppError::other("No wallet.dat found on disk to copy.")
    })?;
    std::fs::copy(&live, dest).map_err(|e| {
        AppError::other(format!(
            "Could not copy wallet.dat to {}: {e}. If the node just started, wait a moment and try again.",
            dest.display()
        ))
    })?;
    let _ = std::fs::remove_file(&snapshot);
    Ok(())
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
    backup_wallet_to_path(state.inner(), coin, &cfg, &dest).await?;
    if let Err(e) = crate::backup_scheduler::register_backup_hash(&dest) {
        tracing::warn!("wallet backup: hash register failed: {e}");
    }
    Ok(WalletBackupResult {
        success: true,
        destination: destination_path,
        message: "Wallet backup saved.".into(),
    })
}

#[tauri::command]
pub async fn open_wallet_backup_folder(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<String> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config(coin).await?;
    let dir = wallet_backup_dir(coin, &cfg)?;
    std::fs::create_dir_all(&dir)?;
    open::that(&dir).map_err(|e| {
        AppError::other(format!("failed to open backup folder: {e}"))
    })?;
    Ok(dir.display().to_string())
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

    let dest = wallet_dat_path(coin, &cfg);
    if is_live_wallet_destination(coin, &cfg, &source) {
        return Err(AppError::other(
            "That file is the live wallet.dat already in use. Pick a backup copy from your backups folder or another location.",
        ));
    }

    stop_inner(state.inner(), coin).await?;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let previous_wallet_backup = if wallet_dat_exists(coin, &cfg) {
        let live = resolve_wallet_dat_path(coin, &cfg).ok_or_else(|| {
            AppError::other("Could not locate the current wallet.dat to back up.")
        })?;
        let backup_dir = wallet_backup_dir(coin, &cfg)?;
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
    let inner = state.inner();
    let mut cfg = state.config_fresh(coin).await?;

    if !inner.bootstrap_loading_active(coin)
        && !inner.bootstrap_session_active()
        && detect_binary(coin).manageable
        && !rpc_reachable(coin, &cfg).await
    {
        ensure_daemon_running(inner, coin, &cfg).await;
        cfg = state.config_fresh(coin).await?;
        if !wait_for_rpc(inner, coin, 45).await {
            return Err(AppError::DaemonUnreachable(format!(
                "{} is not responding on http://{}:{}/. Start the node from Settings → Daemon (or wait if it is still loading after bootstrap).",
                coin.binary_base(),
                cfg.rpc_host,
                cfg.rpc_port
            )));
        }
    }

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
        .map(|p| p.is_file())
        .unwrap_or(false)
}

fn auth_method_label(coin: CoinId, cfg: &DaemonConfig) -> String {
    let diag = rpc_auth_diagnostics(coin, cfg);
    let cookie = cookie_present(cfg);
    if diag.app_auth_method == "userpass" && cookie {
        "userpass+cookie".to_string()
    } else {
        diag.app_auth_method
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
    let auth_method = auth_method_label(coin, cfg);
    let cookie_present = cookie_present(cfg);
    let conf_path = diag.conf_path.clone();
    let creds_in_conf = diag.rpc_user_in_conf && diag.rpc_password_in_conf;
    let rpc_credentials_stale = false;
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

    let client = match crate::rpc::RpcClient::from_config_for_coin(coin, cfg) {
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
            let likely_datadir_mismatch = unauthorized;
            let hint = if unauthorized {
                Some(
                    "Something is answering on this RPC port but rejected authentication. \
                     Restart the node from Settings, or check that the data directory matches the running node."
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

/// Write server/RPC settings to verium.conf and persist app config (Settings → Apply).
fn sync_rpc_daemon_config(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<(String, String)> {
    refresh_config_paths(coin, cfg)?;
    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(generate_rpc_user);
    let diag = rpc_auth_diagnostics(coin, cfg);
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
    write_node_conf_overrides(coin, &node_conf_dir(cfg), cfg, &overrides)?;
    cfg.rpc_user = Some(user.clone());
    cfg.rpc_password = Some(pass.clone());
    refresh_config_paths(coin, cfg)?;
    save_app_daemon_config(coin, cfg)?;
    Ok((user, pass))
}

async fn restart_managed_daemon(state: &AppState, coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    if detect_binary(coin).manageable {
        let _ = stop_inner(state, coin).await;
        tokio::time::sleep(Duration::from_millis(1500)).await;
        start_inner(state, coin).await?;
    }
    Ok(())
}

/// Settings → Restart daemon (force stop then start).
pub(crate) async fn restart_daemon_full_cycle(state: &AppState, coin: CoinId) -> AppResult<()> {
    let _guard = state.runtime(coin)?.ensure_lock.lock().await;
    state.clear_bootstrap_loading(coin);
    state.clear_spawn(coin);
    state.clear_auto_reindex_attempt(coin);
    let mut cfg = state.config_fresh(coin).await?;
    if reindex_running_live(state, coin, &cfg).await {
        tracing::info!(
            "restart ({}): reindex in progress — not interrupting",
            coin.as_str()
        );
        state.set_daemon_phase(coin, "reindexing");
        return Ok(());
    }
    crate::config::sync_cfg_rpc_credentials_from_conf(coin, &mut cfg)?;
    ensure_daemon_conf_complete(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    let lines = tail_coin_debug_log(coin, &cfg, 80)
        .await
        .unwrap_or_default();
    let needs_reindex = detect_chain_corruption_session(&lines).is_some()
        || daemon_needs_reindex_start(state, coin, &cfg);
    stop_daemon_fully_for_repair(state, coin, &cfg).await;
    if needs_reindex {
        tracing::info!(
            "restart ({}): chain index rebuild required — repairing with -reindex",
            coin.as_str()
        );
        start_with_chain_repair(state, coin, &cfg).await
    } else {
        start_inner_impl(state, coin, true).await
    }
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
    let (user, _) = sync_rpc_daemon_config(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;
    restart_managed_daemon(state.inner(), coin, &cfg).await?;

    Ok(RpcCredentialsSetup {
        rpc_user: user,
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
    write_node_conf_overrides(coin, &node_conf_dir(&cfg), &cfg, &overrides)?;
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
    restart_daemon_full_cycle(state.inner(), coin).await
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugLogStatus {
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
pub async fn debug_log_status(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<DebugLogStatus> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config(coin).await?;
    let path = expected_debug_log_path(coin, &cfg);
    Ok(DebugLogStatus {
        path: path.display().to_string(),
        exists: path.is_file(),
    })
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
    tail_coin_debug_log(coin, &cfg, max).await
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
    /// `true` when no wallet is in the configured datadir and none was found in legacy Qt folders.
    pub is_new_install: bool,
    /// `true` when a wallet.dat exists under a different legacy data folder (e.g. old Vericoin-Qt).
    pub legacy_wallet_detected: bool,
    pub legacy_wallet_path: Option<String>,
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
    let resolved = resolve_wallet_dat_path(coin, &cfg);
    let default_path = wallet_dat_path(coin, &cfg);
    let exists = wallet_dat_exists(coin, &cfg);
    let legacy_wallet = resolve_legacy_wallet_outside_cfg(coin, &cfg);
    let legacy_wallet_detected = legacy_wallet.is_some();
    let legacy_wallet_path = legacy_wallet.as_ref().map(|p| p.display().to_string());
    let is_new_install = !exists && !legacy_wallet_detected;
    let path = resolved
        .unwrap_or(default_path)
        .display()
        .to_string();
    let backup_folder = wallet_backup_dir(coin, &cfg)?
        .display()
        .to_string();
    let suggested_backup_path = suggested_wallet_backup_path(coin, &cfg)?
        .display()
        .to_string();
    let binary = coin.binary_base();
    let note = if exists {
        None
    } else if let Some(ref legacy) = legacy_wallet_path {
        Some(format!(
            "Found an existing {name} wallet at {legacy}. Use Import wallet.dat, set your data directory to that folder in Advanced setup, or create a new wallet for a fresh start.",
            name = coin.display_name()
        ))
    } else if is_new_install {
        Some(format!(
            "No {name} wallet on this machine yet — create a new encrypted wallet or restore from a backup / recovery phrase.",
            name = coin.display_name()
        ))
    } else {
        Some(format!(
            "No wallet.dat found on disk yet. If the wallet is unlocked in the app, use Back up wallet.dat — {binary} exports the live wallet file."
        ))
    };
    Ok(WalletFileStatus {
        exists,
        path,
        note,
        is_new_install,
        legacy_wallet_detected,
        legacy_wallet_path,
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
    period: Option<String>,
) -> AppResult<Vec<ExplorerExtractionEntry>> {
    let coin = parse_coin_id(&coin)?;
    fetch_extraction(
        coin,
        limit.unwrap_or(20),
        period.as_deref().unwrap_or("month"),
    )
    .await
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

/// Start the managed daemon when RPC is down.
pub(crate) async fn ensure_daemon_running(state: &AppState, coin: CoinId, cfg: &DaemonConfig) {
    let Ok(runtime) = state.runtime(coin) else {
        return;
    };
    let _guard = runtime.ensure_lock.lock().await;
    ensure_daemon_running_locked(state, coin, cfg).await;
}

async fn ensure_daemon_running_locked(state: &AppState, coin: CoinId, cfg: &DaemonConfig) {
    if state.bootstrap_session_active() {
        tracing::debug!(
            "ensure ({}): skipped while bootstrap import is running",
            coin.as_str()
        );
        return;
    }
    if state.bootstrap_loading_active(coin) {
        let child_up = match state.daemon(coin) {
            Ok(d) => d.child_running().await,
            Err(_) => false,
        };
        if reindex_running_live(state, coin, cfg).await || rpc_reachable(coin, cfg).await || child_up
        {
            tracing::debug!(
                "ensure ({}): skipped while post-bootstrap chain is loading",
                coin.as_str()
            );
            return;
        }
    }
    if bootstrap_suppresses_auto_start(state, coin, cfg).await {
        tracing::debug!(
            "ensure ({}): skipped while post-bootstrap node is already starting",
            coin.as_str()
        );
        return;
    }

    if rpc_reachable(coin, cfg).await {
        if let Err(e) = rpc_serves_coin(coin, cfg).await {
            if !state.wrong_chain_restart_exhausted(coin) && detect_binary(coin).manageable {
                state.increment_wrong_chain_restart(coin);
                tracing::warn!(
                    "ensure ({}): {} — restarting node with correct chain selector",
                    coin.as_str(),
                    e
                );
                let _ = restart_daemon_full_cycle(state, coin).await;
                return;
            }
            state.set_daemon_phase(coin, "error");
            tracing::warn!("ensure ({}): RPC chain mismatch: {e}", coin.as_str());
            return;
        }
        state.clear_wrong_chain_restart_attempts(coin);
        let _ = heal_invalid_blocks_silently(state, coin, cfg).await;
        state.set_daemon_phase(coin, "connected");
        return;
    }

    if reindex_running_live(state, coin, cfg).await {
        state.set_daemon_phase(coin, "reindexing");
        tracing::debug!(
            "ensure ({}): reindex in progress — not interrupting",
            coin.as_str()
        );
        return;
    }

    if native_daemon_image_running(coin) && pids_listening_on_port(cfg.rpc_port).is_empty() {
        if reindex_running_live(state, coin, cfg).await || state.pending_reindex_active(coin) {
            state.set_daemon_phase(coin, "reindexing");
            tracing::debug!(
                "ensure ({}): native {} reindex in progress without RPC — not interrupting",
                coin.as_str(),
                coin.binary_base()
            );
            return;
        }
        let ours = match state.daemon(coin) {
            Ok(d) => d.child_running().await,
            Err(_) => false,
        };
        if !ours {
            tracing::warn!(
                "ensure ({}): {} running without RPC on port {} — stopping orphan",
                coin.as_str(),
                coin.binary_base(),
                cfg.rpc_port
            );
            force_stop_native_daemon(coin);
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
    }

    if daemon_boot_in_progress(state, coin, cfg).await {
        state.set_daemon_phase(coin, "starting");
        tracing::debug!(
            "ensure ({}): node likely starting — waiting",
            coin.as_str()
        );
        return;
    }

    if cfg.chain.starts_with("binarytest") && !sidecar_supports_binarytest(coin) {
        tracing::warn!(
            "ensure ({}): skipping auto-start — sidecar lacks -binarytest (run vericoin/build-dace.ps1)",
            coin.as_str()
        );
        return;
    }

    let lines = tail_coin_debug_log(coin, cfg, 120).await.unwrap_or_default();
    if let Some(detail) = detect_chain_corruption_session(&lines) {
        if is_timestamp_rule_failure(&detail) {
            state.set_daemon_phase(coin, "error");
            tracing::warn!(
                "ensure ({}): timestamp rule failure in debug.log — skip auto-start until node is restarted from Settings",
                coin.as_str()
            );
            return;
        }
        if state.repair_backoff_active(coin) {
            tracing::debug!(
                "ensure ({}): chain repair backoff active ({REPAIR_BACKOFF:?})",
                coin.as_str()
            );
            return;
        }
        if chain_snapshot_needs_reindex(&effective_chain_datadir(coin, cfg)) {
            tracing::info!(
                "ensure ({}): incomplete snapshot — use Download snapshot, not auto-reindex",
                coin.as_str()
            );
            return;
        }
        if coin == CoinId::Verium && verium_uses_legacy_flat(cfg) {
            tracing::info!(
                "ensure ({}): chain DB error — use Download snapshot (mainnet does not auto-reindex)",
                coin.as_str()
            );
            return;
        }
        tracing::info!(
            "ensure ({}): chain DB error in current session — repairing with -reindex",
            coin.as_str()
        );
        state.mark_repair_attempt(coin);
        if let Err(e) = start_with_chain_repair(state, coin, cfg).await {
            tracing::warn!("ensure ({}): chain repair start failed: {e}", coin.as_str());
        }
        return;
    }

    if daemon_needs_reindex_start(state, coin, cfg) {
        if state.repair_backoff_active(coin) {
            tracing::debug!(
                "ensure ({}): index rebuild backoff active ({REPAIR_BACKOFF:?})",
                coin.as_str()
            );
            return;
        }
        tracing::info!(
            "ensure ({}): block index needs rebuild — launching with -reindex",
            coin.as_str()
        );
        state.mark_repair_attempt(coin);
        if let Err(e) = start_with_chain_repair(state, coin, cfg).await {
            tracing::warn!("ensure ({}): index rebuild start failed: {e}", coin.as_str());
        }
        return;
    }

    if detect_binary(coin).manageable {
        if !native_daemon_image_running(coin) && !pids_listening_on_port(cfg.rpc_port).is_empty() {
            kill_port_listeners(cfg.rpc_port);
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if !native_daemon_image_running(coin) {
            clear_stale_datadir_lock_for_spawn(coin, cfg);
        }
        state.set_daemon_phase(coin, "starting");
        if let Err(e) = start_inner_impl(state, coin, false).await {
            tracing::warn!("ensure ({}): failed to start daemon: {e}", coin.as_str());
        }
    } else {
        state.set_daemon_phase(coin, "binary_missing");
        tracing::warn!(
            "ensure ({}): cannot auto-start — {}",
            coin.as_str(),
            binary_missing_hint(coin).unwrap_or_else(|| {
                format!("no runnable {} binary found", coin.binary_base())
            })
        );
    }
}

pub(crate) async fn wait_for_rpc(state: &AppState, coin: CoinId, max_attempts: u32) -> bool {
    let binary = coin.binary_base();
    for attempt in 0..max_attempts {
        if let Ok(cfg) = state.config_fresh(coin).await {
            if let Ok(client) = crate::rpc::RpcClient::from_config_for_coin(coin, &cfg) {
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
    if rpc_reachable(coin, &cfg).await {
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

    let lines = tail_coin_debug_log(coin, &cfg, 40).await.unwrap_or_default();
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
    if state.inner().bootstrap_session_active() {
        return Ok(EnsureConnectResult {
            connected: false,
            message: "Bootstrap import in progress — daemon start paused until it finishes.".to_string(),
            datadir_locked: false,
            already_running: false,
        });
    }
    if state.inner().bootstrap_loading_active(coin) {
        let cfg = state.config(coin).await?;
        if bootstrap_suppresses_auto_start(state.inner(), coin, &cfg).await {
            return Ok(EnsureConnectResult {
                connected: false,
                message: format!(
                    "{} is loading imported chain data after bootstrap. Please wait a few minutes.",
                    binary
                ),
                datadir_locked: false,
                already_running: true,
            });
        }
    }
    if rpc_reachable(coin, &cfg).await {
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

    {
        let _guard = state.inner().runtime(coin)?.ensure_lock.lock().await;
        ensure_daemon_running(state.inner(), coin, &cfg).await;
    }
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

    let lines = tail_coin_debug_log(coin, &cfg, 40).await.unwrap_or_default();
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

pub(crate) async fn startup_prepare_chain_data(state: &AppState, coin: CoinId) -> AppResult<()> {
    let mut cfg = state.config_fresh(coin).await?;

    if coin == CoinId::Verium && verium_uses_legacy_flat(&cfg) && legacy_subdir_chain_ahead(coin, &cfg)
    {
        tracing::info!(
            "startup ({}): promoting unified subdir chain data to legacy flat layout",
            coin.as_str()
        );
        if let Ok(daemon) = state.daemon(coin) {
            if let Ok(client) = RpcClient::from_config_for_coin(coin, &cfg) {
                let _ = client.call_no_result("stop", json!([])).await;
            }
            daemon.wait_for_child_exit(Duration::from_secs(3)).await;
            daemon.force_kill_child().await;
            daemon.clear_tracking().await;
        }
        kill_port_listeners(cfg.rpc_port);
        force_stop_native_daemon(coin);
        tokio::time::sleep(Duration::from_millis(2000)).await;
        let _ = promote_subdir_chain_data_for_legacy(coin, &cfg)?;
    }

    ensure_first_run_config(coin, &mut cfg)?;
    ensure_daemon_conf_complete(coin, &mut cfg)?;
    state.replace_config(coin, cfg).await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct ChainRepairResult {
    pub success: bool,
    pub message: String,
    pub mode: String,
}

#[derive(Copy, Clone)]
enum ChainRepairStartMode {
    Reindex,
    ReindexChainstate,
}

impl ChainRepairStartMode {
    fn flag(self) -> &'static str {
        match self {
            Self::Reindex => "-reindex",
            Self::ReindexChainstate => "-reindex-chainstate",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Reindex => "reindex",
            Self::ReindexChainstate => "reindex-chainstate",
        }
    }
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

    if coin == CoinId::Verium {
        let cfg = state.config_fresh(coin).await?;
        if verium_uses_legacy_flat(&cfg) {
            return Err(AppError::other(format!(
                "{binary} mainnet does not support -reindex or -reindex-chainstate. \
                 Use mode=bootstrap to install the official snapshot."
            )));
        }
    }

    let start_mode = match mode_lower.as_str() {
        "reindex-chainstate" => ChainRepairStartMode::ReindexChainstate,
        "reindex" => ChainRepairStartMode::Reindex,
        _ => {
            return Err(AppError::other(
                "mode must be bootstrap, reindex-chainstate, or reindex",
            ))
        }
    };

    state.inner().try_mark_auto_reindex(coin);

    let _guard = state.runtime(coin)?.ensure_lock.lock().await;
    let mut cfg = state.config_fresh(coin).await?;
    crate::config::sync_cfg_rpc_credentials_from_conf(coin, &mut cfg)?;
    ensure_daemon_conf_complete(coin, &mut cfg)?;
    state.replace_config(coin, cfg.clone()).await?;

    if matches!(start_mode, ChainRepairStartMode::Reindex)
        && reindex_running_live(state.inner(), coin, &cfg).await
    {
        return Ok(ChainRepairResult {
            success: true,
            message: format!(
                "{binary} is already rebuilding the blockchain index. This may take a while."
            ),
            mode: "reindex".into(),
        });
    }

    state.daemon(coin)?.record_pid(None).await;
    stop_daemon_fully_for_repair(state.inner(), coin, &cfg).await;
    prepare_chain_for_reindex(coin, &cfg)?;
    let flag = start_mode.flag();
    state.daemon(coin)?.start(&cfg, &[flag]).await?;
    state.inner().mark_spawn(coin);

    let label = start_mode.label();

    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    Ok(ChainRepairResult {
        success: true,
        message: format!(
            "{binary} started with -{label}. This can take a long time; watch debug.log for progress."
        ),
        mode: label.to_string(),
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

/// System chime when Web Audio is blocked (common in macOS WKWebView after async RPC).
#[tauri::command]
pub fn play_block_chime() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        const SOUND: &str = "/System/Library/Sounds/Glass.aiff";
        if Path::new(SOUND).is_file() {
            std::process::Command::new("/usr/bin/afplay")
                .arg(SOUND)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| AppError::other(format!("afplay failed: {e}")))?;
            return Ok(());
        }
        return Err(AppError::other("system chime file missing"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::other("system chime unavailable on this platform"))
    }
}

#[tauri::command]
pub async fn diagnostic_bundle(
    state: State<'_, AppState>,
    coin: String,
) -> AppResult<DiagnosticBundle> {
    let coin = parse_coin_id(&coin)?;
    let cfg = state.config_fresh(coin).await.unwrap_or_default();
    let bin = detect_binary(coin);
    let log_tail = tail_coin_debug_log(coin, &cfg, 200).await.unwrap_or_default();
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
