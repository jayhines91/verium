import { useSyncExternalStore } from "react";

import type { CoinId } from "@/lib/coin/profile";
import type { ExplorerBlock } from "@/lib/explorer-api";

/** Latest chain tip pushed from the local node watcher (`chain-tip-changed`). */
export interface ChainTip {
  coin: CoinId;
  height: number;
  hash: string;
  /** Unix seconds of the tip block, or 0 when block detail was unavailable. */
  time: number;
  block?: ExplorerBlock;
}

export interface ChainTipSnapshot {
  tip: ChainTip | null;
  /** Most recent blocks learned from the node, newest first. */
  recentBlocks: ExplorerBlock[];
}

const MAX_RECENT = 12;
const EMPTY: ChainTipSnapshot = { tip: null, recentBlocks: [] };

const snapshots = new Map<CoinId, ChainTipSnapshot>();
const listeners = new Map<CoinId, Set<() => void>>();

function getSnapshot(coin: CoinId): ChainTipSnapshot {
  return snapshots.get(coin) ?? EMPTY;
}

function notify(coin: CoinId): void {
  const set = listeners.get(coin);
  if (!set) return;
  for (const listener of set) listener();
}

/** Record a new tip from the node watcher; ignores duplicate hashes. */
export function pushChainTip(tip: ChainTip): void {
  const prev = snapshots.get(tip.coin) ?? EMPTY;
  if (prev.tip?.hash === tip.hash) return;

  let recentBlocks = prev.recentBlocks;
  if (tip.block) {
    const block = tip.block;
    recentBlocks = [block, ...prev.recentBlocks.filter((b) => b.height !== block.height)]
      .sort((a, b) => b.height - a.height)
      .slice(0, MAX_RECENT);
  }

  snapshots.set(tip.coin, { tip, recentBlocks });
  notify(tip.coin);
}

export function subscribeChainTip(coin: CoinId, listener: () => void): () => void {
  let set = listeners.get(coin);
  if (!set) {
    set = new Set();
    listeners.set(coin, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/** Subscribe a React component to the latest tip + recent blocks for a coin. */
export function useChainTip(coin: CoinId): ChainTipSnapshot {
  return useSyncExternalStore(
    (cb) => subscribeChainTip(coin, cb),
    () => getSnapshot(coin),
  );
}
