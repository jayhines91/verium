import { useQuery } from "@tanstack/react-query";
import type { CoinId } from "@/lib/coin/profile";
import {
  fetchWalletTransactions,
  WALLET_TX_POLL_INTERVAL_MS,
  walletTransactionsQueryKey,
} from "@/lib/wallet-transactions-query";
import { useWindowVisible } from "@/hooks/useWindowVisible";

export function useWalletTransactions(
  coin: CoinId,
  options?: { enabled?: boolean },
) {
  const visible = useWindowVisible();
  return useQuery({
    queryKey: walletTransactionsQueryKey(coin),
    queryFn: () => fetchWalletTransactions(coin),
    refetchInterval: visible ? WALLET_TX_POLL_INTERVAL_MS : false,
    enabled: options?.enabled ?? true,
    retry: 0,
  });
}
