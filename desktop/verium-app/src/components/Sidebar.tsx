import { NavLink } from "react-router-dom";
import {
  ArrowLeftRight,
  BookOpen,
  BookUser,
  Coins,
  Cpu,
  Gauge,
  Lock,
  Network as NetworkIcon,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
  Wallet as WalletIcon,
} from "lucide-react";
import { CoinSwitcher } from "@/components/CoinSwitcher";
import { useActiveCoin, useEnabledCoins } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  coins?: ("verium" | "vericoin")[];
}

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
  { to: "/mining", label: "Mining", icon: Cpu, coins: ["verium"] },
  { to: "/staking", label: "Staking", icon: Coins, coins: ["vericoin"] },
  { to: "/network", label: "Network", icon: NetworkIcon },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/addresses", label: "Address book", icon: BookUser },
  { to: "/security", label: "Security", icon: Lock },
  { to: "/sign", label: "Sign & verify", icon: ShieldCheck },
  { to: "/console", label: "RPC console", icon: Terminal },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/resources", label: "Resources", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const APP_VERSION =
  (import.meta as unknown as { env: Record<string, string> }).env
    ?.VITE_APP_VERSION || "1.0.0";

export function Sidebar() {
  const activeCoin = useActiveCoin();
  const enabledCoins = useEnabledCoins();
  const profile = getCoinProfile(activeCoin);

  const visibleItems = items.filter((item) => {
    if (!item.coins) return true;
    return item.coins.some(
      (coin) => enabledCoins.includes(coin) && coin === activeCoin,
    );
  });

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="px-3 py-4">
        <CoinSwitcher />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {visibleItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-bg-panel text-fg"
                  : "text-fg-muted hover:bg-bg-panel hover:text-fg",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
        Vericonomy Wallet v{APP_VERSION}
        <div className="mt-0.5 text-[10px] uppercase tracking-wider">
          {profile.symbol} · {profile.displayName}
        </div>
      </div>
    </aside>
  );
}
