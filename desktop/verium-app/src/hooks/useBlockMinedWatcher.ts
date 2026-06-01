import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChainSynced } from "@/hooks/useChainSynced";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWalletTransactions } from "@/hooks/useWalletTransactions";
import { subscribeChainTip } from "@/lib/chain-tip-store";
import { walletTransactionsQueryKey } from "@/lib/wallet-transactions-query";
import { type TransactionItem } from "@/lib/rpc/client";

export interface BlockMinedEvent {
  height: number;
  amount?: number;
  txid?: string;
  blockhash?: string;
  blocktime?: number;
  address?: string;
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

/** Fallback wallet poll; new coinbase detection is normally driven by chain tip events. */
const TIP_RECHECK_MS = 2_500;
const VERIUM = "verium" as const;
/** Older mined txs seeded on first poll; fresher ones may still chime. */
const FRESH_MINED_SEED_GRACE_SEC = 180;

function isMinedCoinbase(tx: TransactionItem): boolean {
  return tx.category === "generate" || tx.category === "immature";
}

function minedSortKey(tx: TransactionItem): number {
  return tx.blockheight ?? tx.blocktime ?? tx.time ?? 0;
}

/** Polls verium wallet coinbase transactions and emits new mined blocks. */
export function useBlockMinedWatcher(): void {
  const { data: status } = useDaemonStatus(VERIUM);
  const { synced } = useChainSynced(VERIUM);
  const syncedRef = useRef(synced);
  syncedRef.current = synced;
  const queryClient = useQueryClient();
  const seenTxids = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const txs = useWalletTransactions(VERIUM, {
    enabled: status?.connected === true,
  });

  // A new chain tip means a block was just connected, so the wallet may now
  // hold a fresh coinbase. Re-check immediately (and once more shortly after,
  // since the tip notification can slightly precede the wallet write) so the
  // chime fires on the same instant the block appears.
  useEffect(() => {
    const queryKey = walletTransactionsQueryKey(VERIUM);
    const recheck = () => {
      void queryClient.invalidateQueries({ queryKey });
    };
    return subscribeChainTip(VERIUM, () => {
      recheck();
      window.setTimeout(recheck, TIP_RECHECK_MS);
    });
  }, [queryClient]);

  useEffect(() => {
    if (!txs.isSuccess || txs.data === undefined) return;

    const mined = txs.data.filter(isMinedCoinbase);

    if (!initialized.current) {
      const nowSec = Date.now() / 1000;
      for (const tx of mined) {
        const t = tx.blocktime ?? tx.time ?? 0;
        if (t > 0 && nowSec - t > FRESH_MINED_SEED_GRACE_SEC) {
          seenTxids.current.add(tx.txid);
        }
      }
      initialized.current = true;
    }

    const sorted = [...mined].sort((a, b) => minedSortKey(b) - minedSortKey(a));

    for (const tx of sorted) {
      if (seenTxids.current.has(tx.txid)) continue;

      seenTxids.current.add(tx.txid);
      if (!syncedRef.current) continue;

      emitBlockMined({
        height: tx.blockheight ?? 0,
        amount: tx.amount,
        txid: tx.txid,
        blockhash: tx.blockhash,
        blocktime: tx.blocktime ?? tx.time,
        address: tx.address,
      });
      break;
    }
  }, [txs.data, txs.isSuccess]);
}
