import type { CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";
import { BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import type { ExplorerStats } from "@/lib/explorer-api";
import { resolveBlockTimeMinutes } from "@/lib/mining-revenue";
import { formatNumber } from "@/lib/utils";

interface NetworkExplorerOverviewProps {
  coin: CoinId;
  localHeight?: number;
  stats?: ExplorerStats | null;
  isError?: boolean;
}

function formatUsd(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value / 1_000, 2)}K`;
  return `$${formatNumber(value, 4)}`;
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-subtle/40 px-3 py-2.5">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-fg">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-fg-subtle">{sub}</div>}
    </div>
  );
}

export function NetworkExplorerOverview({
  coin,
  localHeight,
  stats,
  isError,
}: NetworkExplorerOverviewProps) {
  const profile = getCoinProfile(coin);
  const heightDelta =
    stats?.height != null && localHeight != null
      ? localHeight - stats.height
      : undefined;
  const blockTimeMin = resolveBlockTimeMinutes(stats, null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 normal-case">
            <BarChart3 className="h-4 w-4 text-fg-subtle" aria-hidden />
            Explorer network snapshot
          </CardTitle>
          <CardDescription>
            Public {profile.symbol} chain data from the Vericonomy explorer API,
            compared with your node.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {stats?.source && <Badge tone="accent">{stats.source}</Badge>}
          <ExplorerLink coin={coin} target={{ kind: "home" }} label="Open explorer" />
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-fg-muted">
            Explorer API unavailable — stats below use your local node only.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <Metric
              label="Height (local)"
              value={
                localHeight != null ? formatNumber(localHeight, 0) : "—"
              }
            />
            <Metric
              label="Height (explorer)"
              value={stats?.height != null ? formatNumber(stats.height, 0) : "—"}
            />
            <Metric
              label="Height delta"
              value={
                heightDelta != null
                  ? `${heightDelta >= 0 ? "+" : ""}${formatNumber(heightDelta, 0)}`
                  : "—"
              }
              sub={heightDelta != null ? "blocks vs explorer" : undefined}
            />
            <Metric
              label="Blocks / hour"
              value={
                stats?.blocks_per_hour != null
                  ? formatNumber(stats.blocks_per_hour, 2)
                  : "—"
              }
            />
            <Metric
              label="Avg block time"
              value={
                blockTimeMin != null ? `${formatNumber(blockTimeMin, 2)} min` : "—"
              }
            />
            <Metric
              label="Mempool (pooled)"
              value={
                stats?.pooled_tx != null ? formatNumber(stats.pooled_tx, 0) : "—"
              }
              sub="transactions"
            />
            <Metric label="Market cap" value={formatUsd(stats?.market_cap_usd)} />
            <Metric label="24h volume" value={formatUsd(stats?.volume_24h_usd)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
