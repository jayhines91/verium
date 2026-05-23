import type { BlockchainInfo, PeerInfo } from "@/lib/rpc/client";

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const HEADER_LAG_THRESHOLD = 1_000;
const NEAR_TIP_PROGRESS = 0.99;
const NEAR_TIP_BLOCKS = 1_000_000;
const NEAR_TIP_HEADER_LAG = 500;

function headerLag(info: BlockchainInfo): number {
  return Math.max(0, (info.headers ?? info.blocks) - info.blocks);
}

/**
 * Mirrors the offer logic in src/qt/modaloverlay.cpp around line 141:
 *
 *   if (bestHeaderDate.secsTo(currentDate) > 60 * 60 * 24 * 7)
 *       ui->bootstrapModal->show();
 *
 * We offer bootstrap when the node is in IBD AND either:
 *   - the tip mediantime is more than a week behind the user's clock, or
 *   - verified blocks are more than 1k behind known headers (header sync ahead of block download).
 */
export function shouldOfferBootstrap(
  info: BlockchainInfo | undefined,
  _peers: PeerInfo[] | undefined,
  dismissedAt?: number,
): boolean {
  if (!info) return false;
  if (!info.initialblockdownload) return false;

  const progress = info.verificationprogress ?? 0;
  const lag = headerLag(info);
  if (
    progress > NEAR_TIP_PROGRESS &&
    info.blocks > NEAR_TIP_BLOCKS &&
    lag < NEAR_TIP_HEADER_LAG
  ) {
    return false;
  }

  // Snooze for 24 hours after the user dismisses it.
  if (dismissedAt && Date.now() / 1000 - dismissedAt < 24 * 60 * 60) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const tipBehind = info.mediantime > 0 && now - info.mediantime > ONE_WEEK_SECONDS;
  const headerLagBlocks = headerLag(info) > HEADER_LAG_THRESHOLD;

  return tipBehind || headerLagBlocks;
}

export { headerLag };
