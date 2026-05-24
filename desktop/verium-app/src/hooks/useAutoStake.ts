import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  rpcGetBlockchainInfo,
  rpcGetStakingState,
  rpcGetWalletInfo,
  rpcStakingStart,
} from "@/lib/rpc/client";
import { isWalletUnlocked } from "@/lib/wallet-unlock";

const RETRY_MS = 10_000;
const VERICOIN = "vericoin" as const;

let stoppedByUser = false;

export function markStakingStoppedByUser(): void {
  stoppedByUser = true;
}

export function clearStakingStoppedByUser(): void {
  stoppedByUser = false;
}

export function wasStakingStoppedByUser(): boolean {
  return stoppedByUser;
}

/**
 * When enabled in Settings, starts vericoin staking once the daemon is synced
 * and the wallet is unlocked for minting.
 */
export function useAutoStake() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status } = useDaemonStatus(VERICOIN);
  const lastErrorRef = useRef<string | null>(null);

  const blockchain = useQuery({
    queryKey: coinQueryKey(VERICOIN, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(VERICOIN),
    refetchInterval: 10_000,
    enabled:
      loaded &&
      prefs.auto_stake_on_open === true &&
      prefs.vericoin_enabled !== false,
  });

  const wallet = useQuery({
    queryKey: coinQueryKey(VERICOIN, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(VERICOIN),
    refetchInterval: 5_000,
    enabled:
      loaded &&
      prefs.auto_stake_on_open === true &&
      prefs.vericoin_enabled !== false,
  });

  const stakingState = useQuery({
    queryKey: coinQueryKey(VERICOIN, "get_staking_state"),
    queryFn: () => rpcGetStakingState(VERICOIN),
    refetchInterval: 5_000,
    enabled:
      loaded &&
      prefs.auto_stake_on_open === true &&
      prefs.vericoin_enabled !== false,
  });

  useEffect(() => {
    if (!loaded || !prefs.auto_stake_on_open || prefs.vericoin_enabled === false) {
      return;
    }

    const tryStart = async () => {
      if (wasStakingStoppedByUser()) return;
      if (stakingState.data?.active) return;
      if (!status?.connected || status.warming_up || status.sync_stalled) return;
      if (blockchain.data?.initialblockdownload) return;
      if (!isWalletUnlocked(wallet.data)) return;

      try {
        await rpcStakingStart(VERICOIN);
        lastErrorRef.current = null;
        void queryClient.invalidateQueries({
          queryKey: coinQueryKey(VERICOIN, "get_staking_state"),
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
    prefs.auto_stake_on_open,
    prefs.vericoin_enabled,
    status?.connected,
    status?.warming_up,
    status?.sync_stalled,
    blockchain.data?.initialblockdownload,
    wallet.data,
    stakingState.data?.active,
    queryClient,
  ]);

  return { lastError: lastErrorRef.current };
}
