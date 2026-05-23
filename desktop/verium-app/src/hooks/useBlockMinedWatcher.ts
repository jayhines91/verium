import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpcListTransactions } from "@/lib/rpc/client";

export interface BlockMinedEvent {
  height: number;
  amount?: number;
  txid?: string;
}

type BlockMinedListener = (event: BlockMinedEvent) => void;

const listeners = new Set<BlockMinedListener>();

export function subscribeBlockMined(listener: BlockMinedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitBlockMined(event: BlockMinedEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

const POLL_MS = 10_000;

/**
 * Polls wallet coinbase transactions and emits when a new mined block height
 * appears. Mount once near the app root.
 */
export function useBlockMinedWatcher(): void {
  const seenHeights = useRef<Set<number>>(new Set());
  const initialized = useRef(false);

  const txs = useQuery({
    queryKey: ["listtransactions", "block-mined-watcher"],
    queryFn: () => rpcListTransactions(100, 0),
    refetchInterval: POLL_MS,
    retry: 0,
  });

  useEffect(() => {
    const mined = (txs.data ?? []).filter(
      (tx) =>
        (tx.category === "generate" || tx.category === "immature") &&
        tx.blockheight != null,
    );

    if (!initialized.current) {
      for (const tx of mined) {
        if (tx.blockheight != null) {
          seenHeights.current.add(tx.blockheight);
        }
      }
      initialized.current = true;
      return;
    }

    const sorted = [...mined].sort(
      (a, b) => (b.blockheight ?? 0) - (a.blockheight ?? 0),
    );

    for (const tx of sorted) {
      const height = tx.blockheight;
      if (height == null || seenHeights.current.has(height)) continue;

      seenHeights.current.add(height);
      emitBlockMined({
        height,
        amount: tx.amount,
        txid: tx.txid,
      });
      break;
    }
  }, [txs.data]);
}
