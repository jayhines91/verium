import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { rpcWalletListUnspent } from "@/lib/rpc/client";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { formatCoinAmount } from "@/lib/units";
import { cn } from "@/lib/utils";

interface CoinControlDialogProps {
  open: boolean;
  selected: SelectedUtxoSet;
  onClose: () => void;
  onApply: (selection: SelectedUtxoSet) => void;
}

export interface SelectedUtxo {
  txid: string;
  vout: number;
  amount: number;
  address?: string;
}

export type SelectedUtxoSet = SelectedUtxo[];

function keyOf(u: { txid: string; vout: number }): string {
  return `${u.txid}:${u.vout}`;
}

export function CoinControlDialog({
  open,
  selected,
  onClose,
  onApply,
}: CoinControlDialogProps) {
  const coin = useActiveCoin();
  const utxos = useQuery({
    queryKey: coinQueryKey(coin, "listunspent"),
    queryFn: () => rpcWalletListUnspent(coin, 1, 9_999_999),
    enabled: open,
  });

  const [picked, setPicked] = useState<Set<string>>(
    new Set(selected.map(keyOf)),
  );

  useEffect(() => {
    if (open) setPicked(new Set(selected.map(keyOf)));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rows = utxos.data ?? [];
  const totalSelected = useMemo(() => {
    let sum = 0;
    for (const u of rows) {
      if (picked.has(keyOf(u))) sum += u.amount;
    }
    return sum;
  }, [rows, picked]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-accent" /> Coin control
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {utxos.isLoading ? (
            <div className="px-5 py-8 text-center text-xs text-fg-muted">
              Loading UTXOs…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-fg-muted">
              No spendable UTXOs.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left font-medium">Address</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Confs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const k = keyOf(u);
                  const checked = picked.has(k);
                  return (
                    <tr
                      key={k}
                      className={cn(
                        "cursor-pointer border-t border-border hover:bg-bg-subtle/60",
                        checked && "bg-accent/5",
                      )}
                      onClick={() => {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        });
                      }}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                      </td>
                      <td className="break-all px-3 py-2 text-[11px]">
                        {u.address ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCoinAmount(u.amount, coin, 8)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {u.confirmations}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
          <div className="text-fg-muted">
            Selected{" "}
            <span className="font-semibold tabular-nums text-fg">
              {picked.size}
            </span>{" "}
            UTXOs ·{" "}
            <span className="font-semibold tabular-nums text-fg">
              {formatCoinAmount(totalSelected, coin, 8)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onApply([]);
                onClose();
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const next: SelectedUtxoSet = rows
                  .filter((u) => picked.has(keyOf(u)))
                  .map((u) => ({
                    txid: u.txid,
                    vout: u.vout,
                    amount: u.amount,
                    address: u.address,
                  }));
                onApply(next);
                onClose();
              }}
            >
              Use selected
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
