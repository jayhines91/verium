import { Link } from "react-router-dom";
import { Badge } from "./ui/Badge";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";

export function DaemonStatusBadge() {
  const { data, isLoading, isError, isFetching } = useDaemonStatus();

  if (data?.warming_up) {
    const label =
      data.error?.replace(/^rpc error -?\d+:\s*/i, "") ?? "Starting up…";
    return (
      <Badge tone="warning" title={data.error ?? undefined}>
        {label.length > 40 ? `${label.slice(0, 37)}…` : label}
      </Badge>
    );
  }

  if ((isLoading || isFetching) && !data) {
    return <Badge tone="neutral">Connecting…</Badge>;
  }

  if (isError || !data?.connected) {
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
  return (
    <Badge tone="success">
      Connected ({chain}) - Latest Block: #{data.blocks ?? "?"}
    </Badge>
  );
}
