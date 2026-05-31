import type { BlockchainInfo, NodeStatus } from "@/lib/rpc/client";
import type { CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";
import {
  blocksBehindNetwork,
  chainSyncPhase,
  syncTargetHeight,
  type ChainSyncContext,
} from "@/lib/bootstrap-policy";
import { isBinaryUnavailableError } from "@/lib/daemon-connecting";
import { nodeStateFromStatus } from "@/lib/node/status";
import { formatNumber } from "@/lib/utils";

export type DashboardActivityKind =
  | "starting"
  | "warming_up"
  | "reindexing"
  | "loading_chain"
  | "finding_peers"
  | "syncing"
  | "catching_up"
  | "ready"
  | "unavailable";

export interface DashboardActivity {
  kind: DashboardActivityKind;
  /** Short line for pills and banners */
  title: string;
  /** Extra reassurance — plain language */
  detail?: string;
  showSpinner: boolean;
  /** 0–1 when the node reports verification progress */
  progress?: number;
}

export interface DashboardActivityInput {
  coin: CoinId;
  status?: NodeStatus;
  statusLoading?: boolean;
  isConnecting?: boolean;
  blockchain?: BlockchainInfo;
  blockchainLoading?: boolean;
  networkTip?: number;
}

function coinName(coin: CoinId): string {
  return getCoinProfile(coin).displayName;
}

/** Txindex rebuild progress (0–1), not chain verificationprogress. */
export function txindexBuildProgress(
  txindexHeight: number | undefined,
  chainTip: number | undefined,
): number | undefined {
  if (txindexHeight == null || chainTip == null || chainTip <= 0) {
    return undefined;
  }
  if (txindexHeight >= chainTip) return undefined;
  const ratio = txindexHeight / chainTip;
  if (ratio <= 0) return undefined;
  // Chain verification can read ~100% while txindex lags; never show 100% here.
  return Math.min(ratio, 0.999);
}

/**
 * Single source of truth for dashboard loading/sync copy (Verium + Vericoin).
 */
export function deriveDashboardActivity(
  input: DashboardActivityInput,
): DashboardActivity {
  const {
    coin,
    status,
    statusLoading,
    isConnecting,
    blockchain,
    blockchainLoading,
    networkTip,
  } = input;
  const name = coinName(coin);

  if (statusLoading && !status) {
    return {
      kind: "starting",
      title: `Connecting to ${name}…`,
      detail: "The wallet is checking your node.",
      showSpinner: true,
    };
  }

  if (isBinaryUnavailableError(status?.error)) {
    return {
      kind: "unavailable",
      title: `${name} is not available`,
      detail:
        status?.error ??
        "Install or rebuild the node software, then reopen the wallet.",
      showSpinner: false,
    };
  }

  if (isConnecting || !status?.connected) {
    if (status?.reindex_in_progress) {
      return {
        kind: "reindexing",
        title: `Refreshing ${name} chain index…`,
        detail:
          status.user_message ??
          status.error ??
          "This is normal after repair or import and can take a while.",
        showSpinner: true,
        progress: status.verification_progress,
      };
    }
    if (status?.warming_up) {
      return {
        kind: "warming_up",
        title: `Opening ${name} chain data…`,
        detail:
          status.user_message ??
          status.error ??
          "Your node is reading local block files.",
        showSpinner: true,
        progress: status.verification_progress,
      };
    }
    return {
      kind: "starting",
      title: `Starting ${name}…`,
      detail:
        status?.user_message ??
        status?.error ??
        "Usually takes under a minute while the node wakes up.",
      showSpinner: true,
    };
  }

  if (status.txindex_network_paused && coin === "vericoin") {
    const idx = status.txindex_sync_height;
    const tip = status.blocks ?? blockchain?.blocks;
    // Index build finished but P2P may still be resuming — don't show the txindex banner.
    if (idx != null && tip != null && idx >= tip - 2) {
      // fall through to normal sync / catching-up states
    } else {
    const txProgress = txindexBuildProgress(idx, tip);
    const detail =
      idx != null && tip != null
        ? `Building the transaction index (at block ${formatNumber(idx, 0)} of ${formatNumber(tip, 0)}). Peer downloads are paused so validation can catch up. This may take several minutes.`
        : "Building the transaction index. Peer downloads are paused until the index catches up. This may take several minutes.";
    return {
      kind: "syncing",
      title: "Updating transaction index…",
      detail,
      showSpinner: true,
      progress: txProgress,
    };
    }
  }

  if (status.reindex_in_progress) {
    return {
      kind: "reindexing",
      title: `Refreshing ${name} chain index…`,
      detail:
        status.user_message ??
        status.error ??
        "The wallet is rebuilding the index from your existing block files.",
      showSpinner: true,
      progress:
        status.verification_progress ?? blockchain?.verificationprogress,
    };
  }

  if (status.warming_up) {
    return {
      kind: "warming_up",
      title: `Opening ${name} chain data…`,
      detail:
        status.user_message ??
        status.error ??
        "Almost ready to connect to the network.",
      showSpinner: true,
      progress:
        status.verification_progress ?? blockchain?.verificationprogress,
    };
  }

  const syncCtx: ChainSyncContext = {
    connected: true,
    syncStalled: status.sync_stalled === true,
    networkTip,
  };

  if (blockchainLoading && !blockchain) {
    return {
      kind: "loading_chain",
      title: `Preparing ${name} to sync…`,
      detail:
        "Your node is online — reading the local chain before blocks appear here.",
      showSpinner: true,
      progress: status.verification_progress,
    };
  }

  const blocks = blockchain?.blocks ?? status.blocks;
  const headers = blockchain?.headers ?? status.headers;
  const progress =
    blockchain?.verificationprogress ?? status.verification_progress;

  if (blocks == null || (blocks === 0 && (headers == null || headers === 0))) {
    return {
      kind: "loading_chain",
      title: `Preparing ${name} to sync…`,
      detail:
        status.user_message ??
        "Loading the chain index. Block height will appear when sync begins.",
      showSpinner: true,
      progress,
    };
  }

  const phase = chainSyncPhase(blockchain, syncCtx);
  const syncTarget = syncTargetHeight(blockchain, networkTip);
  const behind = blocksBehindNetwork(blocks, syncTarget);

  if (
    status.connections === 0 &&
    (blocks ?? 0) < 1_000_000 &&
    phase !== "synced"
  ) {
    return {
      kind: "finding_peers",
      title: `Looking for ${name} peers…`,
      detail:
        status.user_message ??
        "Your node is online and will start downloading once it finds other nodes.",
      showSpinner: true,
      progress,
    };
  }

  if (phase === "syncing" || blockchain?.initialblockdownload) {
    const progressPct =
      progress != null && progress > 0 && progress < 1
        ? `${Math.round(progress * 100)}%`
        : undefined;
    const behindLine =
      behind != null && behind > 0
        ? `About ${formatNumber(behind, 0)} blocks remaining.`
        : undefined;
    return {
      kind: "syncing",
      title: `Downloading ${name}…`,
      detail:
        [progressPct && `${progressPct} verified`, behindLine]
          .filter(Boolean)
          .join(" ") ||
        "Stay on this screen — sync continues in the background.",
      showSpinner: true,
      progress,
    };
  }

  if (phase === "catching-up") {
    return {
      kind: "catching_up",
      title: `Almost caught up on ${name}…`,
      detail:
        behind != null && behind > 0
          ? `Roughly ${formatNumber(behind, 0)} blocks behind the network tip.`
          : "Finishing the last stretch of blocks.",
      showSpinner: true,
      progress,
    };
  }

  if (phase === "offline") {
    return {
      kind: "starting",
      title: `Reconnecting to ${name}…`,
      detail: "Waiting for the node to respond.",
      showSpinner: true,
    };
  }

  return {
    kind: "ready",
    title: "Up to date",
    showSpinner: false,
  };
}

/** Whether the dashboard should show the activity banner (not fully ready). */
export function showDashboardActivityBanner(
  activity: DashboardActivity,
): boolean {
  return activity.kind !== "ready" && activity.kind !== "unavailable";
}

/** Status pill label on the hero card when chain metrics are not final yet. */
export function heroStatusPillLabel(
  activity: DashboardActivity,
  synced: boolean,
): string {
  if (activity.kind !== "ready") return activity.title;
  return synced ? "Fully synced" : "Catching up";
}

/** Hero uses activity spinner on the pill when still loading. */
export function heroStatusPillShowsPulse(activity: DashboardActivity): boolean {
  return activity.showSpinner;
}

/** Re-export for components that only have status. */
export function nodeStateIndicatesLoading(
  state: ReturnType<typeof nodeStateFromStatus>,
): boolean {
  return (
    state === "starting" ||
    state === "warming_up" ||
    state === "reindexing" ||
    state === "connected_syncing" ||
    state === "initializing"
  );
}
