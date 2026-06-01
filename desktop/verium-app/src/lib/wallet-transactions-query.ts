import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { rpcListTransactions } from "@/lib/rpc/client";

/** Max rows needed by dashboard, watchers, and explorer block attribution. */
export const WALLET_TX_POLL_COUNT = 200;

/** Shared wallet transaction poll interval (all consumers dedupe on this key). */
export const WALLET_TX_POLL_INTERVAL_MS = 30_000;

export function walletTransactionsQueryKey(coin: CoinId) {
  return coinQueryKey(coin, "listtransactions", "wallet");
}

export function fetchWalletTransactions(coin: CoinId) {
  return rpcListTransactions(coin, WALLET_TX_POLL_COUNT, 0);
}
