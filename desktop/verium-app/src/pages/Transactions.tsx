import { useActiveCoin, useCoinProfile } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationProgress } from "@/components/ConfirmationProgress";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ReceivePanel } from "@/components/ReceivePanel";
import { SendPanel } from "@/components/SendPanel";
import { WalletBalanceSummary } from "@/components/WalletBalanceSummary";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import {
  fetchExplorerTransactions,
  isExplorerApiEnabled,
} from "@/lib/explorer-api";
import { rpcListTransactions, type TransactionItem } from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
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

function categoryTone(
  category: string,
): "success" | "danger" | "warning" | "neutral" {
  switch (category) {
    case "receive":
    case "generate":
    case "immature":
      return "success";
    case "send":
      return "danger";
    case "stake":
    case "stake-mint":
      return "success";
    case "stake-orphan":
      return "warning";
    default:
      return "neutral";
  }
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
  const txs = useQuery({
    queryKey: coinQueryKey(coin, "listtransactions"),
    queryFn: () => rpcListTransactions(coin, 50, 0),
    refetchInterval: visible ? 10_000 : false,
    retry: 0,
  });

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
    (txs.isError || !txs.data || txs.data.length === 0) &&
    explorerTxs.data &&
    explorerTxs.data.length > 0;

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
            {showExplorerFallback && (
              <CardDescription>
                Wallet RPC unavailable or empty — showing recent network
                transactions from the explorer.
              </CardDescription>
            )}
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
                    {explorerTxs.data!.map((tx) => (
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
                    {(txs.data ?? []).map((tx: TransactionItem) => (
                      <tr
                        key={`${tx.txid}-${tx.category}-${tx.address ?? ""}`}
                        className="border-t border-border odd:bg-bg-subtle/30"
                      >
                        <td className="px-4 py-2 text-xs text-fg-muted">
                          {new Date(tx.time * 1000).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={categoryTone(tx.category)}>
                            {tx.category}
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
                            target={{ kind: "tx", txid: tx.txid }}
                            label="View"
                            title={`Open tx ${tx.txid} on the explorer`}
                          />
                        </td>
                      </tr>
                    ))}
                    {txs.data && txs.data.length === 0 && (
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
          </CardContent>
        </Card>
      </div>
    </WalletUnlockGate>
  );
}
