use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::coin_profile::CoinId;
use crate::commands::{
    ensure_daemon_running, startup_prepare_chain_data, wait_for_rpc,
};
use crate::commands::{heal_invalid_blocks_silently, rpc_reachable};
use crate::node::constants::{INVALID_BLOCK_HEAL_TICK, STARTUP_RPC_WAIT, SUPERVISOR_TICK};
use crate::node::state::NodeSnapshot;
use crate::network_mode_commands;
use crate::prefs;
use crate::state::AppState;

static LAST_EMITTED: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn snapshot_key(coin: CoinId, snap: &NodeSnapshot) -> String {
    format!(
        "{}:{}:{}",
        coin.as_str(),
        format!("{:?}", snap.state),
        snap.message
    )
}

pub fn maybe_emit_state(app: &AppHandle, coin: CoinId, snap: &NodeSnapshot) {
    let key = snapshot_key(coin, snap);
    let mut guard = LAST_EMITTED.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    if map.get(coin.as_str()) == Some(&key) {
        return;
    }
    map.insert(coin.as_str().to_string(), key);
    let payload = serde_json::json!({
        "coin": coin.as_str(),
        "snapshot": snap,
    });
    let _ = app.emit("node-state-changed", payload);
}

/// Single entry point for app startup: prepare chain, ensure daemons, start supervisor.
pub async fn startup(app: AppHandle, state: &AppState) {
    if let Err(e) = network_mode_commands::ensure_mainnet_when_binarytest_disabled(state).await
    {
        tracing::warn!("startup: binarytest→mainnet migration failed: {e}");
    }

    let prefs = prefs::load().await.unwrap_or_default();

    for coin in CoinId::all() {
        if !prefs::coin_enabled(&prefs, *coin) {
            continue;
        }
        if let Err(e) = startup_prepare_chain_data(state, *coin).await {
            tracing::warn!(
                "startup ({}): chain data prepare failed: {e}",
                coin.as_str()
            );
        }
    }

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

    sleep(Duration::from_secs(2)).await;
    let wait_secs = STARTUP_RPC_WAIT.as_secs() as u32;
    let enabled: Vec<CoinId> = CoinId::all()
        .iter()
        .copied()
        .filter(|c| prefs::coin_enabled(&prefs, *c))
        .collect();
    let mut wait_tasks = Vec::new();
    for coin in &enabled {
        if !crate::daemon::detect_binary(*coin).manageable {
            tracing::info!(
                "startup ({}): skipping RPC wait — node binary not available",
                coin.as_str()
            );
            continue;
        }
        let state = state.clone();
        let coin = *coin;
        wait_tasks.push(tokio::spawn(async move {
            (coin, wait_for_rpc(&state, coin, wait_secs).await)
        }));
    }
    for task in wait_tasks {
        if let Ok((coin, ok)) = task.await {
            if !ok {
                tracing::warn!(
                    "startup ({}): daemon not reachable after {wait_secs}s — retrying spawn",
                    coin.as_str()
                );
                if let Ok(cfg) = state.config_fresh(coin).await {
                    ensure_daemon_running(&state, coin, &cfg).await;
                }
            }
        }
    }

    let supervisor_state = state.clone();
    let supervisor_app = app.clone();
    tauri::async_runtime::spawn(async move {
        supervisor_loop(&supervisor_app, &supervisor_state).await;
    });

    let heal_state = state.clone();
    tauri::async_runtime::spawn(async move {
        invalid_block_heal_loop(&heal_state).await;
    });
}

/// Proactively clear invalid block flags before status polling can surface a stall banner.
async fn invalid_block_heal_loop(state: &AppState) {
    sleep(Duration::from_secs(8)).await;
    loop {
        let prefs = prefs::load().await.unwrap_or_default();
        for coin in CoinId::all() {
            if !prefs::coin_enabled(&prefs, *coin) {
                continue;
            }
            let cfg = match state.config_fresh(*coin).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            if !rpc_reachable(*coin, &cfg).await {
                continue;
            }
            let _ = heal_invalid_blocks_silently(state, *coin, &cfg).await;
        }
        sleep(INVALID_BLOCK_HEAL_TICK).await;
    }
}

async fn supervisor_loop(app: &AppHandle, state: &AppState) {
    sleep(Duration::from_secs(5)).await;
    loop {
        for coin in CoinId::all() {
            supervise_coin(app, state, *coin).await;
        }
        sleep(SUPERVISOR_TICK).await;
    }
}

async fn supervise_coin(_app: &AppHandle, state: &AppState, coin: CoinId) {
    use crate::commands::{
        bootstrap_suppresses_auto_start, daemon_boot_in_progress, reindex_running_live,
        restart_daemon_full_cycle, rpc_auth_failed, rpc_reachable,
    };
    use crate::config::{ensure_daemon_conf_complete, sync_cfg_rpc_credentials_from_conf};

    let prefs = prefs::load().await.unwrap_or_default();
    if !prefs::coin_enabled(&prefs, coin) {
        return;
    }
    let cfg = match state.config_fresh(coin).await {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!("supervisor ({}): config load failed: {e}", coin.as_str());
            return;
        }
    };

    if state.bootstrap_session_active()
        || bootstrap_suppresses_auto_start(state, coin, &cfg).await
    {
        return;
    }

    if rpc_reachable(coin, &cfg).await {
        let _ = heal_invalid_blocks_silently(state, coin, &cfg).await;
        state.clear_auth_restart_attempts(coin);
        state.set_daemon_phase(coin, "connected");
        return;
    }

    if reindex_running_live(state, coin, &cfg).await {
        state.set_daemon_phase(coin, "reindexing");
        return;
    }

    if daemon_boot_in_progress(state, coin, &cfg).await {
        state.set_daemon_phase(coin, "starting");
        return;
    }

    if !crate::daemon::pids_listening_on_port(cfg.rpc_port).is_empty()
        && rpc_auth_failed(coin, &cfg).await
    {
        if state.pending_reindex_active(coin) || state.bootstrap_loading_active(coin) {
            state.set_daemon_phase(coin, "reindexing");
            return;
        }
        if state.auth_restart_exhausted(coin) {
            tracing::warn!(
                "supervisor ({}): RPC auth rejected — auto-restart budget exhausted; fix credentials in Settings",
                coin.as_str()
            );
            state.set_daemon_phase(coin, "auth_mismatch");
            return;
        }
        tracing::warn!(
            "supervisor ({}): RPC port open but credentials rejected — syncing conf and restarting node",
            coin.as_str()
        );
        state.increment_auth_restart(coin);
        if let Ok(mut fresh) = state.config_fresh(coin).await {
            let _ = sync_cfg_rpc_credentials_from_conf(coin, &mut fresh);
            let _ = ensure_daemon_conf_complete(coin, &mut fresh);
            let _ = state.replace_config(coin, fresh).await;
        }
        if restart_daemon_full_cycle(state, coin).await.is_ok() {
            state.set_daemon_phase(coin, "starting");
        }
        return;
    }

    ensure_daemon_running(state, coin, &cfg).await;
}
