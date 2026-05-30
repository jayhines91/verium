import { useEffect, useState } from "react";
import { Coins, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface FeeRateDialogProps {
  open: boolean;
  current: number;
  symbol: string;
  onClose: () => void;
  onApply: (ratePerKb: number) => void;
}

const PRESETS: { id: string; rate: number; label: string; hint: string }[] = [
  { id: "min", rate: 0.0001, label: "Economy", hint: "Cheapest, may take longer." },
  { id: "default", rate: 0.001, label: "Default", hint: "Recommended for typical sends." },
  { id: "fast", rate: 0.005, label: "Fast", hint: "Prioritized inclusion." },
  { id: "priority", rate: 0.01, label: "Priority", hint: "Heavy fee — for urgent sends." },
];

export function FeeRateDialog({
  open,
  current,
  symbol,
  onClose,
  onApply,
}: FeeRateDialogProps) {
  const [draft, setDraft] = useState(current.toString());

  useEffect(() => {
    if (open) setDraft(current.toString());
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed > 0;

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
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-accent" /> Transaction fee
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

        <div className="flex flex-col gap-4 px-5 py-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => {
              const active = parsed === preset.rate;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDraft(preset.rate.toString())}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-accent bg-accent/10"
                      : "border-border bg-bg-subtle hover:border-border-strong",
                  )}
                >
                  <span className="text-sm font-medium">{preset.label}</span>
                  <span className="text-[11px] tabular-nums text-fg-muted">
                    {preset.rate.toFixed(8)} {symbol}/kB
                  </span>
                  <span className="text-[11px] text-fg-subtle">
                    {preset.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-muted">Custom fee ({symbol}/kB)</label>
            <input
              type="number"
              min={0}
              step="0.00000001"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={cn(
                "h-9 rounded-md border bg-bg-subtle px-3 text-sm tabular-nums outline-none",
                valid
                  ? "border-border focus:border-accent"
                  : "border-danger focus:border-danger",
              )}
            />
          </div>

          <div className="text-[11px] text-fg-subtle">
            Fees are paid per kilobyte of transaction size. Typical sends are
            around 0.2 kB.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => {
              onApply(parsed);
              onClose();
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
