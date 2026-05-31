import type { NodeStatus } from "@/lib/rpc/client";

export type NodeState =
  | "initializing"
  | "binary_missing"
  | "config_invalid"
  | "stopped"
  | "starting"
  | "datadir_locked"
  | "port_in_use"
  | "warming_up"
  | "reindexing"
  | "connected_syncing"
  | "connected_ready"
  | "sync_stalled"
  | "auth_mismatch"
  | "chain_corrupt"
  | "failed";

export type RecoveryHint =
  | "restart_node"
  | "repair_chain"
  | "bootstrap_chain"
  | "install_binary"
  | "reset_credentials"
  | "change_datadir"
  | "quit_other_instance"
  | "clear_invalid_block";

const STATE_LABELS: Record<NodeState, string> = {
  initializing: "Initializing",
  binary_missing: "Node software missing",
  config_invalid: "Configuration error",
  stopped: "Stopped",
  starting: "Starting node",
  datadir_locked: "Data directory in use",
  port_in_use: "Port in use",
  warming_up: "Loading blockchain",
  reindexing: "Repairing blockchain",
  connected_syncing: "Syncing",
  connected_ready: "Ready",
  sync_stalled: "Sync stalled",
  auth_mismatch: "Connection error",
  chain_corrupt: "Blockchain needs repair",
  failed: "Node unavailable",
};

export function nodeStateFromStatus(status: NodeStatus | undefined): NodeState {
  const raw = status?.state as NodeState | undefined;
  if (raw && raw in STATE_LABELS) return raw;
  if (status?.chain_corrupt) return "chain_corrupt";
  if (status?.reindex_in_progress) return "reindexing";
  if (status?.warming_up) return "warming_up";
  if (status?.sync_stalled) return "sync_stalled";
  if (status?.connected) {
    if (status.initial_block_download) return "connected_syncing";
    const blocks = status.blocks ?? 0;
    const headers = status.headers ?? 0;
    if (blocks === 0 && headers === 0) return "connected_syncing";
    if (headers > blocks + 2) return "connected_syncing";
    return "connected_ready";
  }
  if (status?.error?.toLowerCase().includes("unauthorized")) return "auth_mismatch";
  return "starting";
}

export function nodeStatusLabel(status: NodeStatus | undefined): string {
  if (status?.user_message) return status.user_message;
  return STATE_LABELS[nodeStateFromStatus(status)];
}

export function isNodeReady(status: NodeStatus | undefined): boolean {
  const state = nodeStateFromStatus(status);
  return state === "connected_ready" || state === "connected_syncing";
}

export function isUnauthorizedError(error?: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes("unauthorized") || lower.includes("invalid rpc credentials");
}

export function recoveryActionLabel(hint: RecoveryHint): string {
  switch (hint) {
    case "restart_node":
      return "Restart node";
    case "repair_chain":
      return "Repair blockchain";
    case "bootstrap_chain":
      return "Download blockchain";
    case "install_binary":
      return "Install node software";
    case "reset_credentials":
      return "Reset node login";
    case "change_datadir":
      return "Change data folder";
    case "quit_other_instance":
      return "Quit other instance";
    case "clear_invalid_block":
      return "Clear invalid block";
    default:
      return "Retry";
  }
}

export function recoveryHintFromStatus(
  status: NodeStatus | undefined,
): RecoveryHint | null {
  const hint = status?.recovery_hint as RecoveryHint | undefined;
  if (hint) return hint;
  if (status?.needs_bootstrap || status?.chain_corrupt) return "bootstrap_chain";
  if (isUnauthorizedError(status?.error)) return "restart_node";
  if (nodeStateFromStatus(status) === "binary_missing") return "install_binary";
  if (nodeStateFromStatus(status) === "datadir_locked") return "quit_other_instance";
  return null;
}
