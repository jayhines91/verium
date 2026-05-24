import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { rpcListTransactions, type TransactionItem } from "@/lib/rpc/client";

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
const VERIUM = "verium" as const;

function isMinedCoinbase(tx: TransactionItem): boolean {
  return tx.category === "generate" || tx.category === "immature";
}

function minedSortKey(tx: TransactionItem): number {
  return tx.blockheight ?? tx.blocktime ?? tx.time ?? 0;
}

/** Polls verium wallet coinbase transactions and emits new mined blocks. */
export function useBlockMinedWatcher(): void {
  const { data: status } = useDaemonStatus(VERIUM);
  const seenTxids = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const txs = useQuery({
    queryKey: coinQueryKey(VERIUM, "listtransactions", "block-mined-watcher"),
    queryFn: () => rpcListTransactions(VERIUM, 100, 0),
    refetchInterval: POLL_MS,
    retry: 0,
    enabled: status?.connected === true,
  });

  useEffect(() => {
    if (!txs.isSuccess || txs.data === undefined) return;

    const mined = txs.data.filter(isMinedCoinbase);

    if (!initialized.current) {
      for (const tx of mined) {
        seenTxids.current.add(tx.txid);
      }
      initialized.current = true;
      return;
    }

    const sorted = [...mined].sort((a, b) => minedSortKey(b) - minedSortKey(a));

    for (const tx of sorted) {
      if (seenTxids.current.has(tx.txid)) continue;

      seenTxids.current.add(tx.txid);
      emitBlockMined({
        height: tx.blockheight ?? 0,
        amount: tx.amount,
        txid: tx.txid,
      });
      break;
    }
  }, [txs.data, txs.isSuccess]);
}
