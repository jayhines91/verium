import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChainSynced } from "@/hooks/useChainSynced";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWalletTransactions } from "@/hooks/useWalletTransactions";
import { subscribeChainTip } from "@/lib/chain-tip-store";
import { walletTransactionsQueryKey } from "@/lib/wallet-transactions-query";
import { type TransactionItem } from "@/lib/rpc/client";

export interface StakeRewardEvent {
  height: number;
  amount?: number;
  txid?: string;
  blockhash?: string;
  blocktime?: number;
  address?: string;
}

type StakeRewardListener = (event: StakeRewardEvent) => void;

const listeners = new Set<StakeRewardListener>();

export function subscribeStakeReward(listener: StakeRewardListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitStakeReward(event: StakeRewardEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

const TIP_RECHECK_MS = 2_500;
const VERICOIN = "vericoin" as const;
const FRESH_STAKE_SEED_GRACE_SEC = 180;

function isStakeMintReward(tx: TransactionItem): boolean {
  return tx.category === "stake-mint";
}

function stakeSortKey(tx: TransactionItem): number {
  return tx.blockheight ?? tx.blocktime ?? tx.time ?? 0;
}

/** Polls vericoin wallet for new stake-mint rewards and emits when synced. */
export function useStakeRewardWatcher(): void {
  const { data: status } = useDaemonStatus(VERICOIN);
  const { synced } = useChainSynced(VERICOIN);
  const syncedRef = useRef(synced);
  syncedRef.current = synced;
  const queryClient = useQueryClient();
  const seenTxids = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const txs = useWalletTransactions(VERICOIN, {
    enabled: status?.connected === true,
  });

  useEffect(() => {
    const queryKey = walletTransactionsQueryKey(VERICOIN);
    const recheck = () => {
      void queryClient.invalidateQueries({ queryKey });
    };
    return subscribeChainTip(VERICOIN, () => {
      recheck();
      window.setTimeout(recheck, TIP_RECHECK_MS);
    });
  }, [queryClient]);

  useEffect(() => {
    if (!txs.isSuccess || txs.data === undefined) return;

    const rewards = txs.data.filter(isStakeMintReward);

    if (!initialized.current) {
      const nowSec = Date.now() / 1000;
      for (const tx of rewards) {
        const t = tx.blocktime ?? tx.time ?? 0;
        if (t > 0 && nowSec - t > FRESH_STAKE_SEED_GRACE_SEC) {
          seenTxids.current.add(tx.txid);
        }
      }
      initialized.current = true;
    }

    const sorted = [...rewards].sort((a, b) => stakeSortKey(b) - stakeSortKey(a));

    for (const tx of sorted) {
      if (seenTxids.current.has(tx.txid)) continue;

      seenTxids.current.add(tx.txid);
      if (!syncedRef.current) continue;

      emitStakeReward({
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
