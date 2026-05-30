use std::path::Path;

use crate::coin_profile::CoinId;
use crate::node::status::NodeStatus;
use crate::daemon::{binary_missing_hint, detect_binary, DaemonBinaryStatus};
use crate::node::rpc_auth::is_unauthorized_message;
use crate::node::state::{BinaryInfo, NodeSnapshot, NodeState, RecoveryHint, state_label};

pub fn is_wsl_unc_path(path: &Path) -> bool {
    path.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
        .starts_with(r"\\wsl.localhost\")
}

pub fn snapshot_from_status(coin: CoinId, status: &NodeStatus, binary: &DaemonBinaryStatus) -> NodeSnapshot {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let (state, recovery_hint, message) = classify_status(coin, status, binary);

    let connected = matches!(
        state,
        NodeState::ConnectedSyncing | NodeState::ConnectedReady | NodeState::SyncStalled
    ) || status.connected;

    NodeSnapshot {
        state,
        recovery_hint,
        message: if message.is_empty() {
            state_label(state).to_string()
        } else {
            message
        },
        detail: status
            .error
            .clone()
            .or(status.chain_repair_detail.clone())
            .or(status.sync_stall_detail.clone()),
        progress: status.verification_progress,
        blocks: status.blocks,
        headers: status.headers,
        connections: status.connections,
        managed: true,
        binary: BinaryInfo::from(binary),
        updated_at: now,
        connected,
        warming_up: status.warming_up || state == NodeState::WarmingUp || state == NodeState::Reindexing,
        chain_corrupt: status.chain_corrupt || state == NodeState::ChainCorrupt,
        reindex_in_progress: status.reindex_in_progress || state == NodeState::Reindexing,
        sync_stalled: status.sync_stalled || state == NodeState::SyncStalled,
        error: status.error.clone(),
        daemon_phase: status.daemon_phase.clone().or(Some(format!("{state:?}"))),
        chain: status.chain.clone(),
        verification_progress: status.verification_progress,
        initial_block_download: status.initial_block_download,
        reindex_header: status.reindex_header,
        chain_repair_detail: status.chain_repair_detail.clone(),
        sync_stall_detail: status.sync_stall_detail.clone(),
    }
}

fn classify_status(
    coin: CoinId,
    status: &NodeStatus,
    binary: &DaemonBinaryStatus,
) -> (NodeState, Option<RecoveryHint>, String) {
    if !binary.manageable {
        let hint = binary_missing_hint(coin).unwrap_or_else(|| {
            binary
                .missing_hint
                .clone()
                .unwrap_or_else(|| "Node software is not available.".into())
        });
        return (NodeState::BinaryMissing, Some(RecoveryHint::InstallBinary), hint);
    }

    if let Some(err) = status.error.as_deref() {
        if err.contains("data directory") && err.contains("already") {
            return (
                NodeState::DatadirLocked,
                Some(RecoveryHint::QuitOtherInstance),
                err.to_string(),
            );
        }
        if is_unauthorized_message(err) {
            return (
                NodeState::AuthMismatch,
                Some(RecoveryHint::RestartNode),
                "Could not authenticate with the node. Try Restart node.".into(),
            );
        }
    }

    if status.chain_corrupt {
        let hint = if status.needs_bootstrap {
            RecoveryHint::BootstrapChain
        } else {
            RecoveryHint::RepairChain
        };
        return (
            NodeState::ChainCorrupt,
            Some(hint),
            status
                .error
                .clone()
                .unwrap_or_else(|| "Blockchain data needs repair.".into()),
        );
    }

    if status.reindex_in_progress {
        return (
            NodeState::Reindexing,
            None,
            status
                .error
                .clone()
                .unwrap_or_else(|| "Repairing blockchain index…".into()),
        );
    }

    if status.warming_up && !status.connected {
        return (
            NodeState::WarmingUp,
            None,
            status
                .error
                .clone()
                .unwrap_or_else(|| "Loading blockchain…".into()),
        );
    }

    if status.sync_stalled {
        let hint = if status.invalid_block_hash.is_some() {
            RecoveryHint::ClearInvalidBlock
        } else {
            RecoveryHint::RestartNode
        };
        return (
            NodeState::SyncStalled,
            Some(hint),
            if status.invalid_block_hash.is_some() {
                "Sync is blocked by a block incorrectly marked invalid in the local index."
                    .into()
            } else {
                "Node sync appears stalled. Try restarting the node.".into()
            },
        );
    }

    if status.connected {
        if status.initial_block_download.unwrap_or(false) {
            return (NodeState::ConnectedSyncing, None, "Syncing with the network…".into());
        }
        let lag = status
            .headers
            .unwrap_or(0)
            .saturating_sub(status.blocks.unwrap_or(0));
        if lag > 2 {
            return (NodeState::ConnectedSyncing, None, "Syncing with the network…".into());
        }
        return (NodeState::ConnectedReady, None, "Node is ready.".into());
    }

    if let Some(err) = status.error.clone() {
        if status.warming_up {
            return (NodeState::WarmingUp, None, err);
        }
        let friendly = crate::node::status::friendly_connection_error(&err);
        if friendly != err {
            return (NodeState::Starting, None, friendly);
        }
        return (NodeState::Failed, Some(RecoveryHint::RestartNode), err);
    }

    (
        NodeState::Starting,
        None,
        format!("Starting {}…", coin.binary_base()),
    )
}

pub fn detect_binary_for_coin(coin: CoinId) -> DaemonBinaryStatus {
    detect_binary(coin)
}
