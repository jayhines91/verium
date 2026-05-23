import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Pencil, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExplorerLink } from "@/components/ExplorerLink";
import { rpcGetNewAddress } from "@/lib/rpc/client";
import { cn, formatVrm } from "@/lib/utils";

const STORAGE_KEY = "verium-receive-requests";

export interface ReceiveRequest {
  id: string;
  createdAt: number;
  label: string;
  message: string;
  amount: number | null;
  address: string;
}

function loadRequests(): ReceiveRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReceiveRequest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRequests(requests: ReceiveRequest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

interface ReceivePanelProps {
  className?: string;
}

export function ReceivePanel({ className }: ReceivePanelProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState<ReceiveRequest[]>(() =>
    loadRequests(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    saveRequests(requests);
  }, [requests]);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const clearForm = useCallback(() => {
    setLabel("");
    setAmount("");
    setMessage("");
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      const address = await rpcGetNewAddress(label.trim() || undefined);
      const parsedAmount = amount.trim() ? Number(amount) : null;
      const entry: ReceiveRequest = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        label: label.trim(),
        message: message.trim(),
        amount:
          parsedAmount != null && Number.isFinite(parsedAmount) && parsedAmount > 0
            ? parsedAmount
            : null,
        address,
      };
      return entry;
    },
    onSuccess: (entry) => {
      setRequests((prev) => [entry, ...prev]);
      setSelectedId(entry.id);
      setShowDetail(true);
      clearForm();
    },
  });

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setRequests((prev) => prev.filter((r) => r.id !== selectedId));
    setSelectedId(null);
    setShowDetail(false);
  }, [selectedId]);

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
                defaultValue="VRM"
                aria-label="Coin unit"
              >
                <option value="VRM">VRM</option>
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

        <div className="max-h-[280px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium">Message</th>
                <th className="px-4 py-2 text-right font-medium">
                  Requested (VRM)
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
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-2">
                      {row.label || "—"}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2 text-fg-muted">
                      {row.message || "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {row.amount != null ? formatVrm(row.amount, 8) : "—"}
                    </td>
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-fg-subtle"
                  >
                    No payment requests yet. Create a receiving address above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!selected}
            onClick={() => setShowDetail(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Show
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={!selected}
            onClick={removeSelected}
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </Button>
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
              {formatVrm(selected.amount, 8)}
            </p>
          )}

          <div className="flex items-center gap-2 rounded-md border border-border bg-bg-panel px-3 py-2 font-mono text-xs">
            <span className="min-w-0 flex-1 break-all">{selected.address}</span>
            <button
              type="button"
              aria-label="Copy address"
              onClick={() => void navigator.clipboard.writeText(selected.address)}
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
              Created {new Date(selected.createdAt).toLocaleString()}
            </span>
          </div>

          <p className="mt-3 text-[11px] text-fg-subtle">
            QR code and BIP21 URI generation coming soon — address is live on
            the network via{" "}
            <span className="font-mono">getnewaddress</span>.
          </p>
        </div>
      )}
    </div>
  );
}
