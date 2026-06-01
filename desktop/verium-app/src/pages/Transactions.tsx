import { useActiveCoin, useCoinProfile } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { ChevronLeft, ChevronRight, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmationProgress } from "@/components/ConfirmationProgress";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ReceivePanel } from "@/components/ReceivePanel";
import { SendPanel } from "@/components/SendPanel";
import { WalletBalanceSummary } from "@/components/WalletBalanceSummary";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import {
  fetchExplorerTransactions,
  isExplorerApiEnabled,
  type ExplorerTransaction,
} from "@/lib/explorer-api";
import { rpcGetWalletInfo, rpcListTransactions, type TransactionItem } from "@/lib/rpc/client";
import {
  listTransactionsFetchParams,
  paginateItems,
  paginateTransactions,
  sortTransactionsNewestFirst,
  TRANSACTIONS_LIST_CAP,
  TRANSACTIONS_PAGE_SIZE,
  transactionPageCount,
} from "@/lib/transactions-list";
import { formatCoinAmount } from "@/lib/units";
import {
  transactionCategoryLabel,
  transactionCategoryBadgeClass,
} from "@/lib/transaction-category";
import { cn, formatNumber } from "@/lib/utils";
import { consumePendingPaymentUri } from "@/lib/payment-uri-pending";

type TransferMode = "send" | "receive";

const stickyTableHeadClass =
  "sticky top-0 z-10 border-b border-border bg-bg-panel text-xs uppercase text-fg-subtle";
const stickyTableHeadCellClass = "bg-bg-panel px-4 py-2 font-medium";

function TransferModeToggle({
  value,
  onChange,
}: {
  value: TransferMode;
  onChange: (mode: TransferMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Send or receive"
      className="inline-flex rounded-md border border-border bg-bg-subtle p-1"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "send"}
        onClick={() => onChange("send")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors",
          value === "send"
            ? "bg-accent text-accent-fg"
            : "text-fg-muted hover:bg-bg-panel hover:text-fg",
        )}
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
        Send
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "receive"}
        onClick={() => onChange("receive")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors",
          value === "receive"
            ? "bg-accent text-accent-fg"
            : "text-fg-muted hover:bg-bg-panel hover:text-fg",
        )}
      >
        <ArrowDownLeft className="h-3.5 w-3.5" />
        Receive
      </button>
    </div>
  );
}

export function Transactions() {
  const coin = useActiveCoin();
  const profile = useCoinProfile();
  const [mode, setMode] = useState<TransferMode>("send");
  const [prefill, setPrefill] = useState<{
    address?: string;
    amount?: string;
    label?: string;
  }>({});

  useEffect(() => {
    const pending = consumePendingPaymentUri();
    if (!pending) return;
    setMode("send");
    setPrefill({
      address: pending.address,
      amount:
        pending.amount != null && pending.amount > 0
          ? String(pending.amount)
          : undefined,
      label: pending.label ?? undefined,
    });
  }, []);
  const visible = useWindowVisible();
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [coin]);

  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });

  const walletTxCount = wallet.data?.txcount ?? 0;
  const historyCapped = walletTxCount > TRANSACTIONS_LIST_CAP;

  const txs = useQuery({
    queryKey: coinQueryKey(coin, "listtransactions", "history", walletTxCount),
    queryFn: async () => {
      const { count, skip } = listTransactionsFetchParams(walletTxCount);
      if (count <= 0) return [];
      const rows = await rpcListTransactions(coin, count, skip);
      return sortTransactionsNewestFirst(rows);
    },
    enabled: wallet.isSuccess,
    refetchInterval: visible ? 10_000 : false,
    retry: 0,
  });

  const sortedTxs = txs.data ?? [];

  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const explorerTxs = useQuery({
    queryKey: coinQueryKey(coin, "explorer-transactions"),
    queryFn: () => fetchExplorerTransactions(coin, 25),
    enabled:
      explorerEnabled.data === true &&
      (txs.isError || !txs.data || txs.data.length === 0),
    refetchInterval: visible ? 60_000 : false,
    retry: 0,
  });

  const showExplorerFallback =
    explorerEnabled.data === true &&
    (txs.isError || sortedTxs.length === 0) &&
    explorerTxs.data &&
    explorerTxs.data.length > 0;

  const explorerSorted = useMemo(
    () => [...(explorerTxs.data ?? [])].sort((a, b) => b.time - a.time),
    [explorerTxs.data],
  );

  const activeTotalItems = showExplorerFallback
    ? explorerSorted.length
    : sortedTxs.length;
  const activeTotalPages = transactionPageCount(activeTotalItems);
  const effectivePage = Math.min(page, Math.max(0, activeTotalPages - 1));
  const pageRows = useMemo(
    () => paginateTransactions(sortedTxs, effectivePage),
    [sortedTxs, effectivePage],
  );
  const explorerPageRows = useMemo(
    () => paginateItems(explorerSorted, effectivePage),
    [explorerSorted, effectivePage],
  );
  const rangeFrom =
    activeTotalItems === 0 ? 0 : effectivePage * TRANSACTIONS_PAGE_SIZE + 1;
  const rangeTo = Math.min(
    activeTotalItems,
    (effectivePage + 1) * TRANSACTIONS_PAGE_SIZE,
  );

  function renderPagination({
    totalItems,
    totalPages: pages,
    rangeFrom: from,
    rangeTo: to,
    cappedNote,
  }: {
    totalItems: number;
    totalPages: number;
    rangeFrom: number;
    rangeTo: number;
    cappedNote?: string;
  }) {
    if (totalItems === 0) return null;
    return (
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-fg-muted">
          <span>
            Showing {formatNumber(from)}–{formatNumber(to)} of{" "}
            {formatNumber(totalItems)}
          </span>
          {cappedNote ? (
            <span className="mt-1 block text-fg-subtle">{cappedNote}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={effectivePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Button>
          <span className="min-w-28 text-center text-xs tabular-nums text-fg-muted">
            Page {effectivePage + 1} of {pages}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={effectivePage >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <WalletUnlockGate
      title="Unlock to send and view transactions"
      description={`Enter your wallet passphrase to send or receive ${profile.symbol} and view your transaction history.`}
    >
      <div className="flex flex-col gap-6">
        <WalletBalanceSummary />

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>{mode === "send" ? "Send" : "Receive"}</CardTitle>
              <CardDescription>
                {mode === "send"
                  ? `Pay to one or more ${profile.displayName} addresses. Labels are saved locally with the transaction comment.`
                  : `Create ${profile.symbol} receiving addresses with optional label, amount, and message.`}
              </CardDescription>
            </div>
            <TransferModeToggle value={mode} onChange={setMode} />
          </CardHeader>
          <CardContent>
            {mode === "send" ? (
              <SendPanel
                initialAddress={prefill.address}
                initialAmount={prefill.amount}
                initialLabel={prefill.label}
              />
            ) : (
              <ReceivePanel />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>
              {showExplorerFallback
                ? "Wallet RPC unavailable or empty — showing recent network transactions from the explorer."
                : "Newest first."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto">
              {showExplorerFallback ? (
                <table className="w-full border-collapse text-sm">
                  <thead className={stickyTableHeadClass}>
                    <tr>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-left",
                        )}
                      >
                        When
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-left",
                        )}
                      >
                        Txid
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Amount
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Block
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Explorer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {explorerPageRows.map((tx: ExplorerTransaction) => (
                      <tr
                        key={tx.txid}
                        className="border-t border-border odd:bg-bg-subtle/30"
                      >
                        <td className="px-4 py-2 text-xs text-fg-muted">
                          {new Date(tx.time * 1000).toLocaleString()}
                        </td>
                        <td className="truncate px-4 py-2 text-xs">
                          {tx.txid.slice(0, 16)}…
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {tx.output_total ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {tx.block_height !== undefined
                            ? formatNumber(tx.block_height)
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <ExplorerLink
                            coin={coin}
                            target={{ kind: "tx", txid: tx.txid }}
                            label="View"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead className={stickyTableHeadClass}>
                    <tr>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-left",
                        )}
                      >
                        When
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-left",
                        )}
                      >
                        Type
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-left",
                        )}
                      >
                        Address
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Amount
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Confs
                      </th>
                      <th
                        className={cn(
                          stickyTableHeadCellClass,
                          "text-right",
                        )}
                      >
                        Explorer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((tx: TransactionItem) => (
                      <tr
                        key={`${tx.txid}-${tx.category}-${tx.address ?? ""}-${tx.time}`}
                        className="border-t border-border odd:bg-bg-subtle/30"
                      >
                        <td className="px-4 py-2 text-xs text-fg-muted">
                          {new Date(tx.time * 1000).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            className={transactionCategoryBadgeClass(tx.category)}
                          >
                            {transactionCategoryLabel(tx.category)}
                          </Badge>
                        </td>
                        <td className="truncate px-4 py-2 text-xs">
                          {tx.address ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatCoinAmount(tx.amount, coin, 8)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <ConfirmationProgress
                            confirmations={tx.confirmations}
                            category={tx.category}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <ExplorerLink
                            coin={coin}
                            target={{ kind: "tx", txid: tx.txid }}
                            label="View"
                            title={`Open tx ${tx.txid} on the explorer`}
                          />
                        </td>
                      </tr>
                    ))}
                    {!txs.isLoading && sortedTxs.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center text-sm text-fg-subtle"
                        >
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            {showExplorerFallback
              ? renderPagination({
                  totalItems: explorerSorted.length,
                  totalPages: activeTotalPages,
                  rangeFrom,
                  rangeTo,
                })
              : renderPagination({
                  totalItems: sortedTxs.length,
                  totalPages: activeTotalPages,
                  rangeFrom,
                  rangeTo,
                  cappedNote: historyCapped
                    ? `Showing the ${formatNumber(TRANSACTIONS_LIST_CAP)} most recent wallet entries.`
                    : undefined,
                })}
          </CardContent>
        </Card>
      </div>
    </WalletUnlockGate>
  );
}
