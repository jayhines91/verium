import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useUserPreferences } from "@/lib/user-preferences";
import { isChainSynced } from "@/lib/bootstrap-policy";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  fetchCpuTopology,
  isOnAcPower,
  resolveMiningThreads,
} from "@/lib/mining-opt";
import { miningRewardAddressForStart } from "@/lib/mining-reward-address";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetWalletInfo,
  rpcMinerStart,
} from "@/lib/rpc/client";
import { isWalletUnlocked } from "@/lib/wallet-unlock";
import { wasMiningStoppedByUser } from "@/lib/mining-session";

const RETRY_MS = 10_000;
const VERIUM = "verium" as const;

/**
 * When enabled in Settings, starts the built-in CPU miner once the verium
 * daemon is synced, the wallet is unlocked, and mining is not already active.
 * Thread count follows auto-adjust preference or manual override.
 */
export function useAutoMine() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status } = useDaemonStatus(VERIUM);
  const lastErrorRef = useRef<string | null>(null);

  const topology = useQuery({
    queryKey: ["cpu-topology"],
    queryFn: fetchCpuTopology,
    staleTime: 60_000,
    enabled: loaded && prefs.auto_mine_on_open === true && prefs.verium_enabled !== false,
  });

  const explorerEnabled = useExplorerQueriesEnabled();
  const explorer = useQuery({
    queryKey: coinQueryKey(VERIUM, "explorer-stats"),
    queryFn: () => fetchExplorerStats(VERIUM),
    refetchInterval: 30_000,
    enabled:
      loaded &&
      prefs.auto_mine_on_open === true &&
      prefs.verium_enabled !== false &&
      explorerEnabled,
    retry: 0,
  });

  const blockchain = useQuery({
    queryKey: coinQueryKey(VERIUM, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(VERIUM),
    refetchInterval: 10_000,
    enabled: loaded && prefs.auto_mine_on_open === true && prefs.verium_enabled !== false,
  });

  const wallet = useQuery({
    queryKey: coinQueryKey(VERIUM, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(VERIUM),
    refetchInterval: 5_000,
    enabled: loaded && prefs.auto_mine_on_open === true && prefs.verium_enabled !== false,
  });

  const minerState = useQuery({
    queryKey: coinQueryKey(VERIUM, "get_miner_state"),
    queryFn: () => rpcGetMinerState(VERIUM),
    refetchInterval: 5_000,
    enabled: loaded && prefs.auto_mine_on_open === true && prefs.verium_enabled !== false,
  });

  useEffect(() => {
    if (!loaded || !prefs.auto_mine_on_open || prefs.verium_enabled === false) return;

    const tryStart = async () => {
      if (wasMiningStoppedByUser()) return;
      if (minerState.data?.active) return;
      if (!status?.connected || status.warming_up || status.sync_stalled) return;
      if (
        !isChainSynced(blockchain.data, {
          connected: true,
          syncStalled: false,
          networkTip: explorer.data?.height,
        })
      ) {
        return;
      }
      if (!isWalletUnlocked(wallet.data)) return;
      try {
        const onAc = await isOnAcPower();
        if (!onAc) return;
      } catch {
        /* ignore battery probe errors */
      }

      const threads = resolveMiningThreads(
        topology.data,
        prefs.auto_adjust_mine_threads !== false,
        prefs.auto_mine_threads ?? 2,
      );
      try {
        await rpcMinerStart(VERIUM, threads, miningRewardAddressForStart(prefs));
        lastErrorRef.current = null;
        void queryClient.invalidateQueries({
          queryKey: coinQueryKey(VERIUM, "get_miner_state"),
        });
        void queryClient.invalidateQueries({
          queryKey: coinQueryKey(VERIUM, "getmininginfo"),
        });
      } catch (e) {
        lastErrorRef.current = String(e);
      }
    };

    void tryStart();
    const id = window.setInterval(() => void tryStart(), RETRY_MS);
    return () => window.clearInterval(id);
  }, [
    loaded,
    prefs.auto_mine_on_open,
    prefs.verium_enabled,
    prefs.auto_adjust_mine_threads,
    prefs.auto_mine_threads,
    prefs.mining_reward_address_mode,
    prefs.mining_reward_address,
    topology.data,
    status?.connected,
    status?.warming_up,
    status?.sync_stalled,
    blockchain.data,
    explorer.data?.height,
    wallet.data,
    minerState.data?.active,
    queryClient,
  ]);

  return { lastError: lastErrorRef.current };
}
