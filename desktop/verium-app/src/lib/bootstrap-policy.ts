import type { BlockchainInfo, PeerInfo } from "@/lib/rpc/client";
import type { CoinId } from "@/lib/coin/profile";

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const HEADER_LAG_THRESHOLD = 1_000;
const NEAR_TIP_PROGRESS = 0.99;
const NEAR_TIP_BLOCKS = 1_000_000;
const NEAR_TIP_HEADER_LAG = 500;
/** Keep bootstrap available while verification is below this threshold. */
export const BOOTSTRAP_SYNC_PROGRESS_THRESHOLD = 0.95;
/** UI + mining gate: within this many blocks of headers/network tip counts as synced. */
export const SYNCED_BLOCK_LAG_THRESHOLD = 2;

export type ChainSyncPhase = "offline" | "syncing" | "catching-up" | "synced";

export interface ChainSyncContext {
  connected?: boolean;
  syncStalled?: boolean;
  networkTip?: number;
}

export function chainSyncPhase(
  info: BlockchainInfo | undefined,
  ctx: ChainSyncContext = {},
): ChainSyncPhase {
  if (!info) {
    return chainSyncPhaseFromCounts(undefined, undefined, undefined, ctx);
  }
  return chainSyncPhaseFromCounts(
    info.blocks,
    info.headers,
    info.initialblockdownload,
    ctx,
  );
}

export function chainSyncPhaseFromCounts(
  blocks: number | undefined,
  headers: number | undefined,
  initialBlockDownload: boolean | undefined,
  ctx: ChainSyncContext = {},
): ChainSyncPhase {
  if (ctx.connected === false) return "offline";
  if (blocks == null || ctx.syncStalled) return "syncing";
  if (initialBlockDownload) return "syncing";
  const localTarget = headers ?? blocks;
  const target =
    ctx.networkTip != null ? Math.max(localTarget, ctx.networkTip) : localTarget;
  const behind = blocksBehindNetwork(blocks, target);
  if (behind != null && behind > SYNCED_BLOCK_LAG_THRESHOLD) {
    return "catching-up";
  }
  return "synced";
}

export function isChainSynced(
  info: BlockchainInfo | undefined,
  ctx: ChainSyncContext = {},
): boolean {
  return chainSyncPhase(info, ctx) === "synced";
}

function headerLag(info: BlockchainInfo): number {
  return Math.max(0, (info.headers ?? info.blocks) - info.blocks);
}

/** Best estimate of how far the node still needs to sync. */
export function syncTargetHeight(
  info: BlockchainInfo | undefined,
  networkTip?: number,
): number | undefined {
  if (!info) return networkTip;
  const localTarget = info.headers ?? info.blocks;
  if (networkTip == null) return localTarget;
  return Math.max(localTarget, networkTip);
}

export function blocksBehindNetwork(
  localBlocks: number | undefined,
  targetHeight: number | undefined,
): number | undefined {
  if (localBlocks == null || targetHeight == null) return undefined;
  return Math.max(0, targetHeight - localBlocks);
}

function isNearNetworkTip(
  info: BlockchainInfo,
  networkTip?: number,
): boolean {
  const progress = info.verificationprogress ?? 0;
  const lag = headerLag(info);
  const target = syncTargetHeight(info, networkTip);
  const behind = blocksBehindNetwork(info.blocks, target);

  if (
    progress >= NEAR_TIP_PROGRESS &&
    info.blocks > NEAR_TIP_BLOCKS &&
    lag < NEAR_TIP_HEADER_LAG
  ) {
    return true;
  }

  if (
    progress >= BOOTSTRAP_SYNC_PROGRESS_THRESHOLD &&
    behind != null &&
    behind < NEAR_TIP_HEADER_LAG
  ) {
    return true;
  }

  return false;
}

/**
 * Mirrors the offer logic in src/qt/modaloverlay.cpp around line 141:
 *
 *   if (bestHeaderDate.secsTo(currentDate) > 60 * 60 * 24 * 7)
 *       ui->bootstrapModal->show();
 *
 * We offer bootstrap when the node is in IBD AND either:
 *   - the tip mediantime is more than a week behind the user's clock, or
 *   - verified blocks are more than 1k behind known headers (header sync ahead of block download), or
 *   - verified blocks are far behind the live network tip (explorer), or
 *   - verification progress is still below 95%.
 */
export function shouldOfferBootstrap(
  info: BlockchainInfo | undefined,
  _peers: PeerInfo[] | undefined,
  dismissedAt?: number,
  networkTip?: number,
): boolean {
  if (!info) return false;
  if (!info.initialblockdownload) return false;
  if (isNearNetworkTip(info, networkTip)) return false;

  // Snooze for 24 hours after the user dismisses it.
  if (dismissedAt && Date.now() / 1000 - dismissedAt < 24 * 60 * 60) {
    return false;
  }

  const progress = info.verificationprogress ?? 0;
  const target = syncTargetHeight(info, networkTip);
  const behind = blocksBehindNetwork(info.blocks, target);

  if (progress < BOOTSTRAP_SYNC_PROGRESS_THRESHOLD) return true;

  const now = Math.floor(Date.now() / 1000);
  const tipBehind = info.mediantime > 0 && now - info.mediantime > ONE_WEEK_SECONDS;
  const headerLagBlocks = headerLag(info) > HEADER_LAG_THRESHOLD;
  const farBehindNetwork = behind != null && behind > HEADER_LAG_THRESHOLD;

  return tipBehind || headerLagBlocks || farBehindNetwork;
}

export function bootstrapImportedAtForCoin(
  importedAtByCoin: Partial<Record<CoinId, number>> | undefined,
  coin: CoinId,
): number | undefined {
  return importedAtByCoin?.[coin];
}

export { headerLag };
