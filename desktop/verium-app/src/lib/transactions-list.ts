import type { TransactionItem } from "@/lib/rpc/client";

export const TRANSACTIONS_PAGE_SIZE = 25;
/** Max wallet rows fetched for the history table (newest entries when capped). */
export const TRANSACTIONS_LIST_CAP = 500;

export function sortTransactionsNewestFirst(
  txs: TransactionItem[],
): TransactionItem[] {
  return [...txs].sort((a, b) => {
    const byTime = (b.time ?? 0) - (a.time ?? 0);
    if (byTime !== 0) return byTime;
    return b.txid.localeCompare(a.txid);
  });
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize = TRANSACTIONS_PAGE_SIZE,
): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

export function paginateTransactions(
  txs: TransactionItem[],
  page: number,
  pageSize = TRANSACTIONS_PAGE_SIZE,
): TransactionItem[] {
  return paginateItems(txs, page, pageSize);
}

/** `listtransactions` count/skip to load the newest up-to-cap wallet rows. */
export function listTransactionsFetchParams(totalCount: number): {
  count: number;
  skip: number;
} {
  if (totalCount <= 0) return { count: 0, skip: 0 };
  const count = Math.min(totalCount, TRANSACTIONS_LIST_CAP);
  const skip = Math.max(0, totalCount - count);
  return { count, skip };
}

export function transactionPageCount(
  totalItems: number,
  pageSize = TRANSACTIONS_PAGE_SIZE,
): number {
  if (totalItems <= 0) return 1;
  return Math.ceil(totalItems / pageSize);
}
