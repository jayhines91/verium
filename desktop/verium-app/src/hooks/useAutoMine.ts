import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * When enabled in Settings, starts the built-in CPU miner once the daemon is
 * synced, the wallet is unlocked, and mining is not already active.
 * Retries every 10s (e.g. after the user unlocks the wallet) unless the user
 * manually stopped mining this session.
 */
export function useAutoMine() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status } = useDaemonStatus();
  const lastErrorRef = useRef<string | null>(null);

  const blockchain = useQuery({
    queryKey: ["getblockchaininfo"],
    queryFn: rpcGetBlockchainInfo,
    refetchInterval: 10_000,
    enabled: loaded && prefs.auto_mine_on_open === true,
  });

  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
    refetchInterval: 5_000,
    enabled: loaded && prefs.auto_mine_on_open === true,
  });

  const minerState = useQuery({
    queryKey: ["get_miner_state"],
    queryFn: rpcGetMinerState,
    refetchInterval: 5_000,
    enabled: loaded && prefs.auto_mine_on_open === true,
  });

  useEffect(() => {
    if (!loaded || !prefs.auto_mine_on_open) return;

    const tryStart = async () => {
      if (wasMiningStoppedByUser()) return;
      if (minerState.data?.active) return;
      if (!status?.connected || status.warming_up || status.sync_stalled) return;
      if (blockchain.data?.initialblockdownload) return;
      if (!isWalletUnlocked(wallet.data)) return;

      const threads = Math.max(1, Math.min(64, prefs.auto_mine_threads ?? 2));
      try {
        await rpcMinerStart(threads);
        lastErrorRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ["get_miner_state"] });
        void queryClient.invalidateQueries({ queryKey: ["getmininginfo"] });
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
