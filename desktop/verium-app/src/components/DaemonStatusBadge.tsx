import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "./ui/Badge";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { nodeStatusLabel, nodeStateFromStatus } from "@/lib/node/status";
import {
  blocksBehindNetwork,
  chainSyncPhaseFromCounts,
  syncTargetHeight,
} from "@/lib/bootstrap-policy";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useIsTestNetwork } from "@/lib/network-mode";
import { formatNumber } from "@/lib/utils";
import { useWindowVisible } from "@/hooks/useWindowVisible";

export function DaemonStatusBadge() {
  const coin = useActiveCoin();
  const isTestNetwork = useIsTestNetwork();
  const { data, isConnecting } = useDaemonStatus(coin);
  const nodeState = nodeStateFromStatus(data);
  const visible = useWindowVisible();
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: data?.connected === true && !isTestNetwork,
    refetchInterval: visible ? 30_000 : false,
    retry: 0,
  });

  if (isConnecting) {
    return (
      <Badge tone="neutral">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {nodeStatusLabel(data) || "Starting node…"}
        </span>
      </Badge>
    );
  }

  if (data?.warming_up) {
    const label = nodeStatusLabel(data);
    return (
      <Badge tone="warning" title={data.error ?? undefined}>
        {label.length > 40 ? `${label.slice(0, 37)}…` : label}
      </Badge>
    );
  }

  if (!data?.connected) {
    const authMismatch = nodeState === "auth_mismatch";
    return (
      <Link to="/settings#daemon-connection" className="hover:opacity-90">
        <Badge tone={authMismatch ? "warning" : "danger"}>
          {data?.user_message ??
            (authMismatch ? "Node login mismatch" : "Node disconnected")}
        </Badge>
      </Link>
    );
  }

  const chain = data.chain ? `${data.chain}` : "main";
  const chainLabel = chain.charAt(0).toUpperCase() + chain.slice(1);
  const blocks = data.blocks;
  const headers = data.headers ?? blocks;
  const networkTip = explorer.data?.height;
  const syncCtx = {
    connected: true as const,
    syncStalled: data.sync_stalled === true,
    networkTip,
  };
  const phase = chainSyncPhaseFromCounts(
    blocks,
    headers,
    data.initial_block_download,
    syncCtx,
  );
  const target =
    blocks != null
      ? syncTargetHeight(
          {
            chain,
            blocks,
            headers: headers ?? blocks,
            bestblockhash: "",
            difficulty: 0,
            mediantime: 0,
            verificationprogress: data.verification_progress ?? 0,
            initialblockdownload: data.initial_block_download === true,
            size_on_disk: 0,
            pruned: false,
            warnings: "",
          },
          networkTip,
        )
      : networkTip;
  const behind = blocksBehindNetwork(blocks, target);

  if (phase === "syncing" || phase === "catching-up") {
    return (
      <Badge tone="warning">
        {phase === "syncing" ? "Syncing" : "Catching up"} ({chainLabel}) · #
        {formatNumber(blocks ?? 0, 0)}
        {target != null && target > (blocks ?? 0) && (
          <> / ~#{formatNumber(target, 0)}</>
        )}
        {behind != null && behind > 0 && (
          <span className="hidden sm:inline">
            {" "}
            ({formatNumber(behind, 0)} behind)
          </span>
        )}
      </Badge>
    );
  }

  return <Badge tone="success">Connected To Network ({chainLabel})</Badge>;
}
