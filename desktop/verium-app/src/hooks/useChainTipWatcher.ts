import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import type { ExplorerBlock } from "@/lib/explorer-api";
import { pushChainTip } from "@/lib/chain-tip-store";
import { walletTransactionsQueryKey } from "@/lib/wallet-transactions-query";

interface ChainTipPayload {
  coin: CoinId;
  height: number;
  hash: string;
  time: number;
  block: ExplorerBlock | null;
}

/** Delay before refreshing the explorer feed so it can index the new block. */
const ENRICH_DELAY_MS = 4_000;

/**
 * Listens for `chain-tip-changed` events from the node watcher, pushes them
 * into the shared chain tip store (instant UI updates), and triggers a
 * debounced explorer refetch to enrich the block with miner address/reward.
 */
export function useChainTipWatcher(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let enrichTimer: number | undefined;

    const unlistenPromise = listen<ChainTipPayload>("chain-tip-changed", (event) => {
      if (cancelled) return;
      const payload = event.payload;

      pushChainTip({
        coin: payload.coin,
        height: payload.height,
        hash: payload.hash,
        time: payload.time,
        block: payload.block ?? undefined,
      });

      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(payload.coin, "getblockchaininfo"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(payload.coin, "getwalletinfo"),
      });
      void queryClient.invalidateQueries({
        queryKey: walletTransactionsQueryKey(payload.coin),
      });

      if (enrichTimer != null) window.clearTimeout(enrichTimer);
      enrichTimer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["explorer-blocks"] });
      }, ENRICH_DELAY_MS);
    });

    return () => {
      cancelled = true;
      if (enrichTimer != null) window.clearTimeout(enrichTimer);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [queryClient]);
}
