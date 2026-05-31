import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, QrCode, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QrCodeDisplay } from "@/components/QrCodeDisplay";
import { rpcGetNewAddress } from "@/lib/rpc/client";
import { useActiveCoin, useCoinProfile } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { formatCoinAmount, coinSymbol } from "@/lib/units";
import {
  receiveRequestsAppend,
  receiveRequestsDelete,
  receiveRequestsList,
} from "@/lib/security/client";
import { cn } from "@/lib/utils";

interface ReceivePanelProps {
  className?: string;
}

export function ReceivePanel({ className }: ReceivePanelProps) {
  const coin = useActiveCoin();
  const profile = useCoinProfile();
  const symbol = coinSymbol(coin);
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const requestsQuery = useQuery({
    queryKey: coinQueryKey(coin, "receive-requests"),
    queryFn: () => receiveRequestsList(coin),
  });

  const requests = requestsQuery.data ?? [];

  const create = useMutation({
    mutationFn: async () => {
      const address = await rpcGetNewAddress(coin, label.trim() || undefined);
      const parsedAmount = amount.trim() ? Number(amount) : null;
      return receiveRequestsAppend(coin, {
        label: label.trim(),
        message: message.trim(),
        amount:
          parsedAmount != null &&
          Number.isFinite(parsedAmount) &&
          parsedAmount > 0
            ? parsedAmount
            : null,
        address,
      });
    },
    onSuccess: (entry) => {
      queryClient.setQueryData(
        coinQueryKey(coin, "receive-requests"),
        (prev: typeof requestsQuery.data) => {
          const list = prev ?? [];
          if (list.some((r) => r.id === entry.id)) return list;
          return [entry, ...list];
        },
      );
      setSelectedId(entry.id);
      setShowDetail(true);
      setLabel("");
      setAmount("");
      setMessage("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => receiveRequestsDelete(coin, id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData(
        coinQueryKey(coin, "receive-requests"),
        (prev: typeof requestsQuery.data) =>
          (prev ?? []).filter((r) => r.id !== id),
      );
      setSelectedId(null);
      setShowDetail(false);
      setPendingDeleteId(null);
    },
  });

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const clearForm = () => {
    setLabel("");
    setAmount("");
    setMessage("");
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="rounded-lg border border-border bg-bg-subtle/80 p-4">
        <p className="mb-3 text-sm text-fg-muted">
          Create new receiving address{" "}
          <span className="text-fg-subtle">(All fields are optional)</span>
        </p>

        <div className="grid gap-3">
          <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-center">
            <label
              htmlFor="receive-label"
              className="text-sm font-medium text-fg-muted sm:text-right"
            >
              Label
            </label>
            <input
              id="receive-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label for this address"
              className="h-10 rounded-md border border-border bg-bg-panel px-3 text-sm outline-none focus:border-accent"
            />
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-center">
            <label
              htmlFor="receive-amount"
              className="text-sm font-medium text-fg-muted sm:text-right"
            >
              Amount
            </label>
            <div className="flex items-center gap-2">
              <input
                id="receive-amount"
                type="number"
                min={0}
                step="0.00000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Optional amount to request"
                className="h-10 w-36 rounded-md border border-border bg-bg-panel px-3 text-sm tabular-nums outline-none focus:border-accent"
              />
              <select
                className="h-10 rounded-md border border-border bg-bg-panel px-2 text-sm outline-none focus:border-accent"
                value={symbol}
                disabled
                aria-label="Coin unit"
              >
                <option value={symbol}>{symbol}</option>
              </select>
            </div>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-start">
            <label
              htmlFor="receive-message"
              className="pt-2 text-sm font-medium text-fg-muted sm:text-right"
            >
              Message
            </label>
            <textarea
              id="receive-message"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional message shown when the payment request is opened"
              className="rounded-md border border-border bg-bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-end">
          <Button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="min-w-[12rem]"
          >
            <QrCode className="h-4 w-4" />
            {create.isPending ? "Creating…" : "Create new receiving address"}
          </Button>
          <Button type="button" variant="danger" onClick={clearForm}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>

        {create.error && (
          <div className="mt-3 text-xs text-danger">{String(create.error)}</div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-bg-panel/40">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Requested payments history</h3>
        </div>

        {requestsQuery.error && (
          <div className="border-b border-border px-4 py-2 text-xs text-danger">
            Could not load payment request history:{" "}
            {String(requestsQuery.error)}
          </div>
        )}

        <div className="max-h-[280px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium">Address</th>
                <th className="px-4 py-2 text-left font-medium">Message</th>
                <th className="px-4 py-2 text-right font-medium bg-white dark:bg-slate-900 ">
                  Requested ({profile.symbol})
                </th>
                <th className="px-4 py-2 text-right font-medium bg-white dark:bg-slate-900 ">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => {
                const isSelected = row.id === selectedId;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => {
                      setSelectedId(row.id);
                      setShowDetail(true);
                    }}
                    className={cn(
                      "cursor-pointer border-t border-border transition-colors",
                      isSelected
                        ? "bg-accent/15"
                        : "odd:bg-bg-subtle/30 hover:bg-bg-subtle/60",
                    )}
                  >
                    <td className="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">
                      {new Date(row.created_at * 1000).toLocaleString()}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-2">
                      {row.label || "—"}
                    </td>
                    <td
                      className="max-w-[160px] truncate px-4 py-2 font-mono text-xs text-fg-muted"
                      title={row.address}
                    >
                      {row.address}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2 text-fg-muted">
                      {row.message || "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {row.amount != null
                        ? formatCoinAmount(row.amount, coin, 8)
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Show QR code"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(row.id);
                            setShowDetail(true);
                          }}
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Remove payment request"
                          disabled={remove.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(row.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!requestsQuery.isLoading && requests.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-fg-subtle"
                  >
                    No payment requests yet. Create a receiving address above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showDetail && selected && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">Payment request</h4>
              {selected.label && (
                <p className="text-xs text-fg-muted">{selected.label}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowDetail(false)}
              className="text-fg-subtle hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {selected.message && (
            <p className="mb-3 text-sm text-fg-muted">{selected.message}</p>
          )}

          {selected.amount != null && (
            <p className="mb-3 text-lg font-semibold tabular-nums">
              {formatCoinAmount(selected.amount, coin, 8)}
            </p>
          )}

          <QrCodeDisplay
            coin={coin}
            address={selected.address}
            amount={selected.amount}
            label={selected.label || undefined}
            message={selected.message || undefined}
          />

          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-bg-panel px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 break-all">{selected.address}</span>
            <button
              type="button"
              aria-label="Copy address"
              onClick={() =>
                void navigator.clipboard.writeText(selected.address)
              }
              className="shrink-0 text-fg-muted hover:text-fg"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <ExplorerLink
              target={{ kind: "address", address: selected.address }}
              label="View on explorer"
            />
            <span className="text-fg-subtle">
              Created {new Date(selected.created_at * 1000).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId != null}
        title="Are you sure?"
        message="This payment request will be removed from your history. The address will continue working for this wallet."
        confirmLabel="Remove"
        confirming={remove.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) remove.mutate(pendingDeleteId);
        }}
      />
    </div>
  );
}
