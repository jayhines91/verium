import { useQuery } from "@tanstack/react-query";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { chainSyncPhase, type ChainSyncPhase } from "@/lib/bootstrap-policy";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { rpcGetBlockchainInfo } from "@/lib/rpc/client";

/** True when the local node is caught up to headers / network tip (within lag threshold). */
export function useChainSynced(coin: CoinId): {
  synced: boolean;
  phase: ChainSyncPhase;
} {
  const visible = useWindowVisible();
  const { data: status } = useDaemonStatus(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const connected = status?.connected === true;

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 10_000 : false,
    enabled: connected,
  });

  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: visible ? 30_000 : false,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  const phase = chainSyncPhase(blockchain.data, {
    connected,
    syncStalled: status?.sync_stalled === true,
    networkTip: explorer.data?.height,
  });

  return { synced: phase === "synced", phase };
}
