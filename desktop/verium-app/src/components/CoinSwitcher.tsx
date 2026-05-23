import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { EXPLORER_LOGO_URL } from "@/lib/verium-links";
import { cn } from "@/lib/utils";

type CoinId = "verium" | "vericoin";

interface CoinOption {
  id: CoinId;
  name: string;
  tagline: string;
  symbol: string;
  accentClass: string;
}

const COINS: CoinOption[] = [
  {
    id: "verium",
    name: "Verium",
    tagline: "Reserve",
    symbol: "VRM",
    accentClass: "bg-accent/15 text-accent border-accent/30",
  },
  {
    id: "vericoin",
    name: "Vericoin",
    tagline: "Currency",
    symbol: "VRC",
    accentClass: "bg-bg-panel text-fg-muted border-border-strong",
  },
];

export function CoinSwitcher() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CoinId>("verium");
  const rootRef = useRef<HTMLDivElement>(null);

  const active = COINS.find((c) => c.id === selected) ?? COINS[0]!;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border hover:bg-bg-panel/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <img
          src={EXPLORER_LOGO_URL}
          alt={active.name}
          className="h-9 w-9 shrink-0 rounded-lg object-contain"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              {active.name}
            </span>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                active.accentClass,
              )}
            >
              {active.symbol}
            </span>
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {active.tagline}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select coin"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-50 overflow-hidden rounded-lg border border-border bg-bg-panel shadow-lg"
        >
          {COINS.map((coin) => {
            const isActive = coin.id === selected;
            return (
              <button
                key={coin.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setSelected(coin.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                  isActive ? "bg-accent/10" : "hover:bg-bg-subtle",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{coin.name}</span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        coin.accentClass,
                      )}
                    >
                      {coin.symbol}
                    </span>
                  </div>
                  <div className="text-xs text-fg-subtle">{coin.tagline}</div>
                </div>
                {isActive && (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                )}
              </button>
            );
          })}
          <div className="border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
            Switch between the Verium and Vericoin Wallets
          </div>
        </div>
      )}
    </div>
  );
}
