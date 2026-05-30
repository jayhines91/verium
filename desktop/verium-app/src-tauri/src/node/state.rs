use serde::{Deserialize, Serialize};

use crate::daemon::DaemonBinaryStatus;

/// Authoritative lifecycle state for a managed node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Initializing,
    BinaryMissing,
    ConfigInvalid,
    Stopped,
    Starting,
    DatadirLocked,
    PortInUse,
    WarmingUp,
    Reindexing,
    ConnectedSyncing,
    ConnectedReady,
    SyncStalled,
    AuthMismatch,
    ChainCorrupt,
    Failed,
}

/// User-facing recovery action the UI may offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryHint {
    RestartNode,
    RepairChain,
    BootstrapChain,
    InstallBinary,
    ResetCredentials,
    ChangeDatadir,
    QuitOtherInstance,
    ClearInvalidBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshot {
    pub state: NodeState,
    pub recovery_hint: Option<RecoveryHint>,
    /// Primary user-facing status line.
    pub message: String,
    pub detail: Option<String>,
    pub progress: Option<f64>,
    pub blocks: Option<u64>,
    pub headers: Option<u64>,
    pub connections: Option<u64>,
    pub managed: bool,
    pub binary: BinaryInfo,
    pub updated_at: u64,
    // Legacy compatibility fields for existing UI hooks.
    pub connected: bool,
    pub warming_up: bool,
    pub chain_corrupt: bool,
    pub reindex_in_progress: bool,
    pub sync_stalled: bool,
    pub error: Option<String>,
    pub daemon_phase: Option<String>,
    pub chain: Option<String>,
    pub verification_progress: Option<f64>,
    pub initial_block_download: Option<bool>,
    pub reindex_header: Option<u64>,
    pub chain_repair_detail: Option<String>,
    pub sync_stall_detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryInfo {
    pub found: bool,
    pub path: Option<String>,
    pub manageable: bool,
    pub runtime: String,
    pub missing_hint: Option<String>,
}

impl From<&DaemonBinaryStatus> for BinaryInfo {
    fn from(s: &DaemonBinaryStatus) -> Self {
        Self {
            found: s.found,
            path: s.path.clone(),
            manageable: s.manageable,
            runtime: s.runtime.clone(),
            missing_hint: s.missing_hint.clone(),
        }
    }
}

pub fn state_label(state: NodeState) -> &'static str {
    match state {
        NodeState::Initializing => "Initializing",
        NodeState::BinaryMissing => "Node software missing",
        NodeState::ConfigInvalid => "Configuration error",
        NodeState::Stopped => "Stopped",
        NodeState::Starting => "Starting node",
        NodeState::DatadirLocked => "Data directory in use",
        NodeState::PortInUse => "Port in use",
        NodeState::WarmingUp => "Loading blockchain",
        NodeState::Reindexing => "Repairing blockchain",
        NodeState::ConnectedSyncing => "Syncing",
        NodeState::ConnectedReady => "Ready",
        NodeState::SyncStalled => "Sync stalled",
        NodeState::AuthMismatch => "Connection error",
        NodeState::ChainCorrupt => "Blockchain needs repair",
        NodeState::Failed => "Node unavailable",
    }
}

impl NodeState {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeState::Initializing => "initializing",
            NodeState::BinaryMissing => "binary_missing",
            NodeState::ConfigInvalid => "config_invalid",
            NodeState::Stopped => "stopped",
            NodeState::Starting => "starting",
            NodeState::DatadirLocked => "datadir_locked",
            NodeState::PortInUse => "port_in_use",
            NodeState::WarmingUp => "warming_up",
            NodeState::Reindexing => "reindexing",
            NodeState::ConnectedSyncing => "connected_syncing",
            NodeState::ConnectedReady => "connected_ready",
            NodeState::SyncStalled => "sync_stalled",
            NodeState::AuthMismatch => "auth_mismatch",
            NodeState::ChainCorrupt => "chain_corrupt",
            NodeState::Failed => "failed",
        }
    }
}

impl RecoveryHint {
    pub fn as_str(self) -> &'static str {
        match self {
            RecoveryHint::RestartNode => "restart_node",
            RecoveryHint::RepairChain => "repair_chain",
            RecoveryHint::BootstrapChain => "bootstrap_chain",
            RecoveryHint::InstallBinary => "install_binary",
            RecoveryHint::ResetCredentials => "reset_credentials",
            RecoveryHint::ChangeDatadir => "change_datadir",
            RecoveryHint::QuitOtherInstance => "quit_other_instance",
            RecoveryHint::ClearInvalidBlock => "clear_invalid_block",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_labels_are_non_empty() {
        for state in [
            NodeState::Starting,
            NodeState::ConnectedReady,
            NodeState::AuthMismatch,
        ] {
            assert!(!state_label(state).is_empty());
        }
    }
}
