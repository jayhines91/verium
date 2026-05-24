import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "./ui/Badge";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { formatNumber } from "@/lib/utils";

export function DaemonStatusBadge() {
  const coin = useActiveCoin();
  const { data, isConnecting } = useDaemonStatus(coin);
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: data?.initial_block_download === true,
    refetchInterval: 30_000,
    retry: 0,
  });

  if (isConnecting) {
    return (
      <Badge tone="neutral">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Connecting…
        </span>
      </Badge>
    );
  }

  if (data?.warming_up) {
    const label =
      data.error?.replace(/^rpc error -?\d+:\s*/i, "") ?? "Starting up…";
    return (
      <Badge tone="warning" title={data.error ?? undefined}>
        {label.length > 40 ? `${label.slice(0, 37)}…` : label}
      </Badge>
    );
  }

  if (!data?.connected) {
    const unauthorized =
      data?.error?.includes("unauthorized") ||
      data?.error?.includes("invalid RPC credentials");
    return (
      <Link to="/settings#daemon-connection" className="hover:opacity-90">
        <Badge tone={unauthorized ? "warning" : "danger"}>
          {unauthorized ? "RPC login required" : "Daemon disconnected"}
        </Badge>
      </Link>
    );
  }

  const chain = data.chain ? `${data.chain}` : "main";
  const blocks = data.blocks;
  const syncing = data.initial_block_download === true;
  const headers = data.headers ?? blocks;
  const networkTip = explorer.data?.height;
  const target =
    headers != null && networkTip != null
      ? Math.max(headers, networkTip)
      : headers ?? networkTip;

  if (syncing && blocks != null && target != null && target > blocks) {
    return (
      <Badge tone="warning">
        Syncing ({chain}) · #{formatNumber(blocks, 0)} / ~#
        {formatNumber(target, 0)}
      </Badge>
    );
  }

  return (
    <Badge tone="success">
      Connected ({chain}) - Latest Block: #{blocks ?? "?"}
    </Badge>
  );
}
