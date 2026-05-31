import { useQuery } from "@tanstack/react-query";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { useNodeStatus } from "@/hooks/useNodeStatus";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { deriveDashboardActivity } from "@/lib/node/dashboard-activity";
import { rpcGetBlockchainInfo } from "@/lib/rpc/client";

/** Shared node + chain activity for dashboard hero and status banner. */
export function useDashboardActivity(coin: CoinId) {
  const node = useNodeStatus(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const visible = useWindowVisible();

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 5_000 : false,
  });

  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: visible ? 30_000 : false,
    enabled: explorerEnabled && node.data?.connected === true,
    retry: 0,
  });

  const activity = deriveDashboardActivity({
    coin,
    status: node.data,
    statusLoading: node.isLoading,
    isConnecting: node.isConnecting,
    blockchain: blockchain.data,
    blockchainLoading: blockchain.isLoading || blockchain.isFetching,
    networkTip: explorer.data?.height,
  });

  return {
    ...node,
    blockchain,
    explorer,
    activity,
  };
}
