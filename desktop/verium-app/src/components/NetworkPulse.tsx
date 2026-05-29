import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { networkHashToKhm } from "@/lib/mining-revenue";
import { formatNumber } from "@/lib/utils";

interface NetworkPulseProps {
  coin: CoinId;
  localHeight?: number;
  localNetworkHash?: number;
}

export function NetworkPulse({
  coin,
  localHeight,
  localNetworkHash,
}: NetworkPulseProps) {
  const profile = getCoinProfile(coin);
  const explorerEnabled = useExplorerQueriesEnabled();

  const stats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled,
    refetchInterval: 60_000,
    retry: 0,
  });

  if (!explorerEnabled) {
    return null;
  }

  const heightDelta =
    stats.data?.height !== undefined && localHeight !== undefined
      ? localHeight - stats.data.height
      : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{profile.displayName} info</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {stats.data?.source && (
            <Badge tone="accent">via {stats.data.source}</Badge>
          )}
          <ExplorerLink
            target={{ kind: "raw", url: profile.explorerBase }}
            label="Open explorer"
          />
        </div>
      </CardHeader>
      <CardContent>
        {stats.isError ? (
          <div className="text-xs text-fg-subtle">
            Explorer API unavailable; using local data only.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Metric label="Height (local)" value={localHeight} format="int" />
            <Metric
              label="Height (explorer)"
              value={stats.data?.height}
              format="int"
            />
            <Metric
              label="Height delta"
              value={heightDelta}
              format="int"
              suffix={heightDelta !== undefined ? "blocks" : undefined}
            />
            {coin === "verium" && localNetworkHash !== undefined && (
              <Metric
                label="Net hashrate (local)"
                value={networkHashToKhm(localNetworkHash)}
                format="decimal"
                suffix="kH/m"
              />
            )}
            {coin === "verium" && stats.data?.network_hash !== undefined && (
              <Metric
                label="Net hashrate (explorer)"
                value={networkHashToKhm(stats.data.network_hash)}
                format="decimal"
                suffix="kH/m"
              />
            )}
            <Metric
              label="Supply"
              value={stats.data?.supply}
              format="decimal"
              suffix={profile.symbol}
            />
            <Metric
              label={`${profile.symbol} price`}
              value={stats.data?.price_usd}
              format="usd"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MetricProps {
  label: string;
  value?: number;
  format: "int" | "decimal" | "usd";
  suffix?: string;
}

function Metric({ label, value, format, suffix }: MetricProps) {
  const text =
    value === undefined || value === null
      ? "—"
      : format === "int"
        ? formatNumber(value, 0)
        : format === "usd"
          ? `$${formatNumber(value, 4)}`
          : formatNumber(value, 4);
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase text-fg-subtle">{label}</span>
      <span className="text-base font-semibold tabular-nums">
        {text}
        {suffix && value !== undefined && value !== null && (
          <span className="ml-1 text-xs font-normal text-fg-subtle">
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}
