import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BookOpen,
  BookUser,
  Coins,
  Cpu,
  Gauge,
  Link2,
  Lock,
  Network as NetworkIcon,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { CoinSwitcher } from "@/components/CoinSwitcher";
import { QuitWalletButton } from "@/components/QuitWalletButton";
import { useActiveCoin, useEnabledCoins } from "@/lib/coin/context";
import { coinQueryKey, getCoinProfile } from "@/lib/coin/profile";
import { BINARYTEST_ENABLED } from "@/lib/features";
import { useIsTestNetwork } from "@/lib/network-mode";
import { rpcGetWalletInfo } from "@/lib/rpc/client";
import { cn } from "@/lib/utils";
import { isWalletLocked } from "@/lib/wallet-unlock";
import { useWindowVisible } from "@/hooks/useWindowVisible";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  coins?: ("verium" | "vericoin")[];
  /** Shown only while the wallet is in binarytest (DACE) mode. */
  testNetworkOnly?: boolean;
  /** Page is gated by WalletUnlockGate and needs the wallet passphrase. */
  requiresPassphrase?: boolean;
}

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  {
    to: "/mining",
    label: "Mining",
    icon: Cpu,
    coins: ["verium"],
    requiresPassphrase: true,
  },
  {
    to: "/staking",
    label: "Staking",
    icon: Coins,
    coins: ["vericoin"],
    requiresPassphrase: true,
  },
  { to: "/network", label: "Network", icon: NetworkIcon },
  {
    to: "/binary-chain",
    label: "Binary Chain",
    icon: Link2,
    testNetworkOnly: true,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: ArrowLeftRight,
    requiresPassphrase: true,
  },
  { to: "/addresses", label: "Address book", icon: BookUser },
  { to: "/security", label: "Security", icon: Lock, requiresPassphrase: true },
  {
    to: "/sign",
    label: "Sign & verify",
    icon: ShieldCheck,
    requiresPassphrase: true,
  },
  {
    to: "/console",
    label: "RPC console",
    icon: Terminal,
    requiresPassphrase: true,
  },
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
  const isTestNetwork = useIsTestNetwork();
  const visible = useWindowVisible();

  // Shared with WalletUnlockGate (same query key) so the indicator stays in
  // sync without an extra fetch. Locked == encrypted AND currently locked;
  // unencrypted or unlocked wallets report false, so no icon is shown.
  const wallet = useQuery({
    queryKey: coinQueryKey(activeCoin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(activeCoin),
    refetchInterval: visible ? 5_000 : false,
  });
  const walletLocked = isWalletLocked(wallet.data);

  const visibleItems = items.filter((item) => {
    if (item.testNetworkOnly && (!BINARYTEST_ENABLED || !isTestNetwork)) {
      return false;
    }
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
        {visibleItems.map(({ to, label, icon: Icon, requiresPassphrase }) => {
          const showLock = Boolean(requiresPassphrase) && walletLocked;
          return (
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
              <span className="flex-1 truncate">{label}</span>
              {showLock && (
                <Lock
                  className="h-3.5 w-3.5 shrink-0 text-amber-400"
                  aria-label="Locked — passphrase required"
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
        <QuitWalletButton />
        Vericonomy Wallet v{APP_VERSION}
        <div className="mt-0.5 text-[10px] uppercase tracking-wider flex items-center gap-2">
          <span>
            {profile.symbol} · {profile.displayName}
          </span>
          <NetworkBadge />
        </div>
      </div>
    </aside>
  );
}

/** Small inline badge that appears in the sidebar footer when the wallet
 *  is pointed at the binarytest (DACE) network. Mirrors the persistent
 *  banner at the top of AppShell. */
function NetworkBadge() {
  const isTest = useIsTestNetwork();
  if (!BINARYTEST_ENABLED || !isTest) return null;
  return (
    <span className="rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 px-1.5 py-[1px] text-[9px] font-semibold normal-case">
      binarytest
    </span>
  );
}
