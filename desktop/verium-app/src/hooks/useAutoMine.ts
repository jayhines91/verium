import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useUserPreferences } from "@/lib/user-preferences";
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
 */
export function useAutoMine() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status } = useDaemonStatus(VERIUM);
  const lastErrorRef = useRef<string | null>(null);

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
      if (blockchain.data?.initialblockdownload) return;
      if (!isWalletUnlocked(wallet.data)) return;

      const threads = Math.max(1, Math.min(64, prefs.auto_mine_threads ?? 2));
      try {
        await rpcMinerStart(VERIUM, threads);
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
    prefs.auto_mine_threads,
    prefs.verium_enabled,
    status?.connected,
    status?.warming_up,
    status?.sync_stalled,
    blockchain.data?.initialblockdownload,
    wallet.data,
    minerState.data?.active,
    queryClient,
  ]);

  return { lastError: lastErrorRef.current };
}
