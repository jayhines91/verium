import { useLocation } from "react-router-dom";
import { DaemonStatusBadge } from "./DaemonStatusBadge";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/mining": "Mining",
  "/staking": "Staking",
  "/network": "Network",
  "/binary-chain": "Binary Chain",
  "/transactions": "Transactions",
  "/addresses": "Address book",
  "/security": "Security",
  "/sign": "Sign & verify",
  "/console": "RPC console",
  "/logs": "Logs",
  "/resources": "Resources",
  "/settings": "Settings",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "Vericonomy Wallet";
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg-subtle px-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <DaemonStatusBadge />
    </header>
  );
}
