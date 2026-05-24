import type { QueryClient } from "@tanstack/react-query";
import type { CoinId } from "@/lib/coin/profile";
import { coinQueryKey } from "@/lib/coin/profile";

/** Refresh wallet, transaction, and node queries after restore or unlock. */
export async function invalidateWalletQueries(
  queryClient: QueryClient,
  coin: CoinId,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "wallet-file-status"),
    }),
    queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "getwalletinfo"),
    }),
    queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "wallet-info"),
    }),
    queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "daemon-status"),
    }),
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === coin &&
        q.queryKey[1] === "listtransactions",
    }),
  ]);
}
