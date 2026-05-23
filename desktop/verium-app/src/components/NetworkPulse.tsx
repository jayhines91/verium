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
import { networkHashToKhm } from "@/lib/mining-revenue";

interface ComparisonProps {
  localHeight?: number;
  localNetworkHash?: number;
}

export function NetworkPulse({ localHeight, localNetworkHash }: ComparisonProps) {
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

  if (enabled.data !== true) {
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
          <CardTitle>Network pulse</CardTitle>
          <CardDescription>
            Side-by-side comparison of your local node and the official Verium
            explorer.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {stats.data?.source && (
            <Badge tone="accent">via {stats.data.source}</Badge>
          )}
          <ExplorerLink
            target={{ kind: "raw", url: EXPLORER_HOME }}
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
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
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
            <Metric
              label="Net hashrate (local)"
              value={
                localNetworkHash !== undefined
                  ? networkHashToKhm(localNetworkHash)
                  : undefined
              }
              format="decimal"
              suffix="kH/m"
            />
            <Metric
              label="Net hashrate (explorer)"
              value={
                stats.data?.network_hash !== undefined
                  ? networkHashToKhm(stats.data.network_hash)
                  : undefined
              }
              format="decimal"
              suffix="kH/m"
            />
            <Metric
              label="Supply"
              value={stats.data?.supply}
              format="decimal"
              suffix="VRM"
            />
            <Metric
              label="Mempool (explorer)"
              value={stats.data?.pooled_tx}
              format="int"
              suffix="tx"
            />
            <Metric
              label="VRM price"
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
          <span className="ml-1 text-xs font-normal text-fg-subtle">{suffix}</span>
        )}
      </span>
    </div>
  );
}
