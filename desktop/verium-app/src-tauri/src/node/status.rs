use serde::Serialize;

use crate::node::state::NodeSnapshot;

/// RPC / log derived node status (legacy + enriched fields for UI).
#[derive(Debug, Clone, Serialize, Default)]
pub struct NodeStatus {
    pub connected: bool,
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
    pub error: Option<String>,
    pub chain_corrupt: bool,
    pub chain_repair_detail: Option<String>,
    pub reindex_in_progress: bool,
    pub reindex_header: Option<u64>,
    pub daemon_phase: Option<String>,
    pub sync_stalled: bool,
    pub sync_stall_detail: Option<String>,
    /// Authoritative lifecycle state (snake_case string).
    pub state: Option<String>,
    pub recovery_hint: Option<String>,
    /// Block files exist but chainstate is missing — download bootstrap, do not auto-reindex.
    pub needs_bootstrap: bool,
    /// User-facing status line.
    pub user_message: Option<String>,
}

pub fn warming_up(message: String) -> NodeStatus {
    NodeStatus {
        connected: true,
        warming_up: true,
        error: Some(message),
        state: Some("warming_up".into()),
        ..empty_base()
    }
}

pub fn disconnected(error: Option<String>) -> NodeStatus {
    let friendly = error.as_deref().map(friendly_connection_error);
    NodeStatus {
        connected: false,
        error: friendly.clone(),
        state: Some(if friendly.is_some() { "failed" } else { "stopped" }.into()),
        ..empty_base()
    }
}

/// Map low-level HTTP client errors to user-facing copy.
pub fn friendly_connection_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("connection refused")
        || lower.contains("error sending request")
        || lower.contains("connect")
        || lower.contains("timed out")
    {
        "Starting node…".into()
    } else {
        raw.to_string()
    }
}

fn empty_base() -> NodeStatus {
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
        error: None,
        chain_corrupt: false,
        chain_repair_detail: None,
        reindex_in_progress: false,
        reindex_header: None,
        daemon_phase: None,
        sync_stalled: false,
        sync_stall_detail: None,
        state: None,
        recovery_hint: None,
        needs_bootstrap: false,
        user_message: None,
    }
}

pub fn apply_snapshot(status: &mut NodeStatus, snap: &NodeSnapshot) {
    status.state = Some(snap.state.as_str().into());
    status.recovery_hint = snap.recovery_hint.map(|h| h.as_str().into());
    status.user_message = Some(snap.message.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_connection_error_maps_http_failures() {
        assert_eq!(
            friendly_connection_error("error sending request for url (http://127.0.0.1:33987/)"),
            "Starting node…"
        );
    }
}
