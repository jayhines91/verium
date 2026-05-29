// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

//! Tauri commands for switching between mainnet and the isolated Binary
//! Chain v3 (DACE) test network ("binarytest"). See
//! vericoin/doc/dace/binarytest-network.md for the network spec.

use serde::Serialize;
use tauri::State;

use crate::coin_profile::{CoinId, CoinTarget, NetworkMode};
use crate::config::{default_config_for_target, ensure_first_run_config, save_app_daemon_config};
use crate::daemon::{dace_missing_hint, dace_sidecars_ready};
use crate::error::{AppError, AppResult};
use crate::prefs;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct NetworkModeInfo {
    pub mode: NetworkMode,
    pub is_test: bool,
    /// Both sidecars advertise `-binarytest` (required for Binarytest mode).
    pub dace_ready: bool,
    /// Set when `dace_ready` is false — explains how to build/install DACE daemons.
    pub dace_missing_hint: Option<String>,
    /// Per-coin RPC endpoint and datadir, useful for the Settings UI to
    /// display "the wallet will connect to ..." before the user confirms.
    pub coin_endpoints: Vec<CoinEndpoint>,
    /// Warning text to show before switching modes.
    pub warning: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CoinEndpoint {
    pub coin: String,
    pub rpc_url: String,
    pub datadir: String,
}

#[tauri::command]
pub async fn network_mode_get(_state: State<'_, AppState>) -> AppResult<NetworkModeInfo> {
    let prefs = prefs::load().await?;
    Ok(build_network_mode_info(prefs.network_mode))
}

#[tauri::command]
pub async fn network_mode_preview(
    _state: State<'_, AppState>,
    mode: String,
) -> AppResult<NetworkModeInfo> {
    let mode = parse_mode(&mode)?;
    Ok(build_network_mode_info(mode))
}

/// Switch the wallet's active network. Persists `network_mode` in prefs before
/// rewriting daemon configs so a partial failure cannot leave prefs on mainnet
/// while datadirs point at binarytest.
#[tauri::command]
pub async fn network_mode_set(
    state: State<'_, AppState>,
    mode: String,
) -> AppResult<NetworkModeInfo> {
    let mode = parse_mode(&mode)?;
    let mut prefs = prefs::load().await?;
    if prefs.network_mode == mode {
        return Ok(build_network_mode_info(mode));
    }

    if mode.is_test() && !dace_sidecars_ready() {
        return Err(AppError::other(
            dace_missing_hint().unwrap_or_else(|| {
                "DACE-capable veriumd and vericoind are required for Binarytest mode.".into()
            }),
        ));
    }

    prefs.network_mode = mode;
    prefs::save(&prefs).await?;

    for coin in CoinId::all().iter().copied() {
        let target = CoinTarget::new(coin, mode);
        let mut cfg = default_config_for_target(target);
        ensure_first_run_config(coin, &mut cfg)?;
        save_app_daemon_config(coin, &cfg)?;
        state.replace_config(coin, cfg).await?;
    }

    tracing::info!("network_mode switched to {}", mode.as_str());
    Ok(build_network_mode_info(mode))
}

fn parse_mode(s: &str) -> AppResult<NetworkMode> {
    match s.trim().to_ascii_lowercase().as_str() {
        "mainnet" => Ok(NetworkMode::Mainnet),
        "binarytest" | "binary-test" | "test" => Ok(NetworkMode::BinaryTest),
        other => Err(AppError::other(format!("unknown network mode: {other}"))),
    }
}

fn warning_for(mode: NetworkMode) -> Option<String> {
    match mode {
        NetworkMode::Mainnet => None,
        NetworkMode::BinaryTest => Some(
            "Binary Chain v3 (DACE) test network. Funds on this network have \
             no real value. The wallet will use distinct datadirs and ports \
             that cannot collide with mainnet. Mining, staking, and sends all \
             behave normally, but balances are play money.".to_string(),
        ),
    }
}

fn coin_endpoints_for(mode: NetworkMode) -> Vec<CoinEndpoint> {
    CoinId::all()
        .iter()
        .copied()
        .map(|c| {
            let target = CoinTarget::new(c, mode);
            CoinEndpoint {
                coin: c.as_str().to_string(),
                rpc_url: format!("http://127.0.0.1:{}", target.rpc_port()),
                datadir: target.datadir().display().to_string(),
            }
        })
        .collect()
}

fn build_network_mode_info(mode: NetworkMode) -> NetworkModeInfo {
    NetworkModeInfo {
        mode,
        is_test: mode.is_test(),
        dace_ready: dace_sidecars_ready(),
        dace_missing_hint: dace_missing_hint(),
        coin_endpoints: coin_endpoints_for(mode),
        warning: warning_for(mode),
    }
}
