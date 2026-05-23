import { useLocation } from "react-router-dom";
import { DaemonStatusBadge } from "./DaemonStatusBadge";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/wallet": "Wallet",
  "/mining": "Mining",
  "/network": "Network",
  "/transactions": "Transactions",
  "/logs": "Logs",
  "/resources": "Resources",
  "/settings": "Settings",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "Verium";
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg-subtle px-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <DaemonStatusBadge />
    </header>
  );
}
