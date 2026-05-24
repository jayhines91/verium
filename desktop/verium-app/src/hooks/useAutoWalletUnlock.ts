import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { rpcGetWalletInfo, tauriTryAutoUnlockWallet } from "@/lib/rpc/client";
import type { UserPreferences } from "@/lib/user-preferences";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  isForeverUnlockDuration,
  isWalletLocked,
  unlockDurationForCoin,
} from "@/lib/wallet-unlock";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";

const RETRY_MS = 10_000;

function coinEnabled(prefs: UserPreferences, coin: CoinId): boolean {
  if (coin === "verium") return prefs.verium_enabled !== false;
  return prefs.vericoin_enabled !== false;
}

function useAutoWalletUnlockForCoin(coin: CoinId) {
  const queryClient = useQueryClient();
  const loaded = useUserPreferences((s) => s.loaded);
  const prefs = useUserPreferences((s) => s.prefs);
  const { data: status, isConnecting } = useDaemonStatus(coin);
  const duration = unlockDurationForCoin(prefs, coin);
  const forever = isForeverUnlockDuration(duration);
  const enabled = loaded && forever && coinEnabled(prefs, coin);

  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 5_000,
    enabled: enabled && status?.connected === true,
  });

  useEffect(() => {
    if (!enabled || isConnecting || !status?.connected) return;
    if (wallet.data && !isWalletLocked(wallet.data)) return;

    const tryUnlock = async () => {
      try {
        const unlocked = await tauriTryAutoUnlockWallet(coin);
        if (unlocked) {
          await queryClient.invalidateQueries({
            queryKey: coinQueryKey(coin, "getwalletinfo"),
          });
        }
      } catch {
        // Wrong stored passphrase — user unlocks manually.
      }
    };

    void tryUnlock();
    const id = window.setInterval(() => void tryUnlock(), RETRY_MS);
    return () => window.clearInterval(id);
  }, [
    coin,
    enabled,
    isConnecting,
    status?.connected,
    wallet.data,
    queryClient,
  ]);
}

/**
 * When "Forever" unlock is enabled, re-unlock each enabled coin wallet on app
 * launch using the passphrase stored in the OS keychain.
 */
export function useAutoWalletUnlock(): void {
  useAutoWalletUnlockForCoin("verium");
  useAutoWalletUnlockForCoin("vericoin");
}
