import { useQuery } from "@tanstack/react-query";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { useBlockAgeTick } from "@/hooks/useBlockAgeTick";
import { useNodeStatus } from "@/hooks/useNodeStatus";
import { useWalletTransactions } from "@/hooks/useWalletTransactions";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import {
  blocksBehindNetwork,
  chainSyncPhase,
  syncTargetHeight,
} from "@/lib/bootstrap-policy";
import { useChainTip } from "@/lib/chain-tip-store";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { miningInfoRefetchMs } from "@/lib/mining-boot";
import { deriveDashboardActivity } from "@/lib/node/dashboard-activity";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetStakingState,
  rpcGetVericoinMiningInfo,
  rpcGetWalletInfo,
} from "@/lib/rpc/client";
import { formatBlockAge } from "@/lib/utils";

/** Shared RPC polling for dashboard hero, middle row, and activity banners. */
export function useDashboardData(coin: CoinId) {
  const visible = useWindowVisible();
  const explorerEnabled = useExplorerQueriesEnabled();
  const node = useNodeStatus(coin);
  const chainTip = useChainTip(coin);
  const ageTick = useBlockAgeTick(visible);

  const connected = node.data?.connected === true;

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 5_000 : false,
  });

  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });

  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: visible ? 30_000 : false,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  const transactions = useWalletTransactions(coin, { enabled: connected });

  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: visible ? 5_000 : false,
    enabled: coin === "verium",
  });

  const minerActive = minerState.data?.active ?? false;
  const minerStartedAt = minerState.data?.started_at;

  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: (query) => {
      if (!visible || coin !== "verium") return false;
      const hashrate = query.state.data?.hashrate ?? 0;
      return miningInfoRefetchMs(minerActive, hashrate, minerStartedAt);
    },
    enabled: coin === "verium",
  });

  const stakingState = useQuery({
    queryKey: coinQueryKey(coin, "get_staking_state"),
    queryFn: () => rpcGetStakingState(coin),
    refetchInterval: visible ? 5_000 : false,
    enabled: coin === "vericoin",
  });

  const vrcMining = useQuery({
    queryKey: coinQueryKey("vericoin", "getmininginfo"),
    queryFn: () => rpcGetVericoinMiningInfo(),
    refetchInterval: visible ? 10_000 : false,
    enabled: coin === "vericoin",
  });

  const networkTip = explorer.data?.height;
  const syncCtx = {
    connected,
    syncStalled: node.data?.sync_stalled === true,
    networkTip,
  };
  const phase = chainSyncPhase(blockchain.data, syncCtx);
  const synced = phase === "synced";
  const localBlocks = blockchain.data?.blocks;
  const blockHash = blockchain.data?.bestblockhash;
  const tipHeight = chainTip.tip?.height ?? localBlocks;
  const tipHash = chainTip.tip?.hash ?? blockHash;
  const syncTarget = syncTargetHeight(blockchain.data, networkTip);
  const behind = blocksBehindNetwork(localBlocks, syncTarget);
  const tipTime =
    chainTip.tip?.time != null && chainTip.tip.time > 0
      ? chainTip.tip.time
      : blockchain.data?.mediantime;
  const blockAge = tipTime != null ? formatBlockAge(tipTime, ageTick) : "—";
  const connections = node.data?.connections ?? 0;

  const activity = deriveDashboardActivity({
    coin,
    status: node.data,
    statusLoading: node.isLoading,
    isConnecting: node.isConnecting,
    blockchain: blockchain.data,
    blockchainLoading: blockchain.isLoading || blockchain.isFetching,
    networkTip,
  });

  return {
    node,
    status: node.data,
    activity,
    connected,
    synced,
    phase,
    blockchain,
    wallet,
    explorer,
    transactions,
    mining,
    minerState,
    stakingState,
    vrcMining,
    chainTip,
    localBlocks,
    tipHeight,
    tipHash,
    syncTarget,
    behind,
    blockHash,
    blockAge,
    connections,
    networkTip,
    minerActive,
    minerStartedAt,
  };
}
