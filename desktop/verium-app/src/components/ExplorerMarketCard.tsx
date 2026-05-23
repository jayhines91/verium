import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import { EXPLORER_HOME } from "@/lib/verium-links";
import { formatNumber } from "@/lib/utils";

function formatUsd(value?: number): string {
  if (value === undefined || value === null) return "—";
  if (value >= 1_000_000) {
    return `$${formatNumber(value / 1_000_000, 2)}M`;
  }
  if (value >= 1_000) {
    return `$${formatNumber(value / 1_000, 2)}K`;
  }
  return `$${formatNumber(value, 4)}`;
}

export function ExplorerMarketCard() {
  const enabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const stats = useQuery({
    queryKey: ["explorer-stats"],
    queryFn: fetchExplorerStats,
    enabled: enabled.data === true,
    refetchInterval: 60_000,
    retry: 0,
  });

  if (enabled.data !== true) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Market & network</CardTitle>
          <CardDescription>
            Live data from the Vericonomy explorer REST API.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {stats.data?.source && (
            <Badge tone="accent">{stats.data.source}</Badge>
          )}
          <ExplorerLink target={{ kind: "raw", url: EXPLORER_HOME }} label="Explorer" />
        </div>
      </CardHeader>
      <CardContent>
        {stats.isError ? (
          <div className="text-xs text-fg-subtle">Market data unavailable.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="VRM price" value={formatUsd(stats.data?.price_usd)} />
            <Stat label="Market cap" value={formatUsd(stats.data?.market_cap_usd)} />
            <Stat label="24h volume" value={formatUsd(stats.data?.volume_24h_usd)} />
            <Stat
              label="Block reward"
              value={
                stats.data?.block_reward !== undefined
                  ? `${formatNumber(stats.data.block_reward, 4)} VRM`
                  : "—"
              }
            />
            <Stat
              label="Supply"
              value={
                stats.data?.supply !== undefined
                  ? `${formatNumber(stats.data.supply, 2)} VRM`
                  : "—"
              }
            />
            <Stat
              label="Difficulty"
              value={
                stats.data?.difficulty !== undefined
                  ? formatNumber(stats.data.difficulty, 6)
                  : "—"
              }
            />
            <Stat
              label="Block time"
              value={
                stats.data?.block_time_min !== undefined
                  ? `${formatNumber(stats.data.block_time_min, 0)} min`
                  : "—"
              }
            />
            <Stat
              label="Blocks / hour"
              value={
                stats.data?.blocks_per_hour !== undefined
                  ? formatNumber(stats.data.blocks_per_hour, 0)
                  : "—"
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase text-fg-subtle">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}
