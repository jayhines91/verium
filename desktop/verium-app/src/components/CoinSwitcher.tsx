import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { ALL_COINS, COIN_LOGO_URLS, COIN_PROFILES } from "@/lib/coin/profile";
import {
  useActiveCoin,
  useEnabledCoins,
  useSetActiveCoin,
} from "@/lib/coin/context";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/lib/user-preferences";
import { isCoinSetupComplete } from "@/lib/setup";

export function CoinSwitcher() {
  const navigate = useNavigate();
  const activeCoin = useActiveCoin();
  const setActiveCoin = useSetActiveCoin();
  const enabledCoins = useEnabledCoins();
  const prefs = useUserPreferences((s) => s.prefs);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = COIN_PROFILES[activeCoin];
  const options = ALL_COINS.filter((coin) => enabledCoins.includes(coin));

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
          src={COIN_LOGO_URLS[activeCoin]}
          alt={active.displayName}
          className="h-9 w-9 shrink-0 rounded-lg object-contain"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              {active.displayName}
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
          {options.map((coin) => {
            const profile = COIN_PROFILES[coin];
            const isActive = coin === activeCoin;
            return (
              <button
                key={coin}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setActiveCoin(coin);
                  setOpen(false);
                  if (!isCoinSetupComplete(coin, prefs)) {
                    navigate("/setup");
                  }
                }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                  isActive ? "bg-accent/10" : "hover:bg-bg-subtle",
                )}
              >
                <img
                  src={COIN_LOGO_URLS[coin]}
                  alt=""
                  className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-contain"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">
                      {profile.displayName}
                    </span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        profile.accentClass,
                      )}
                    >
                      {profile.symbol}
                    </span>
                  </div>
                  <div className="text-xs text-fg-subtle">
                    {profile.tagline}
                  </div>
                </div>
                {isActive && (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                )}
              </button>
            );
          })}
          <div className="border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
            Switch between Verium and Vericoin wallets
          </div>
        </div>
      )}
    </div>
  );
}
