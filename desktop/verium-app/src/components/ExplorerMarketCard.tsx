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
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import { resolveBlockTimeMinutes } from "@/lib/mining-revenue";
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

export function ExplorerMarketCard({ coin: coinProp }: { coin?: CoinId }) {
  const activeCoin = useActiveCoin();
  const coin = coinProp ?? activeCoin;
  const profile = getCoinProfile(coin);
  const visible = useWindowVisible();

  const enabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const stats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: enabled.data === true,
    refetchInterval: visible ? 60_000 : false,
    retry: 0,
  });

  if (enabled.data !== true) return null;

  const blockTimeMin = resolveBlockTimeMinutes(stats.data, null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Market & network</CardTitle>
          <CardDescription>
            Live {profile.symbol} data from the Vericonomy explorer.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {stats.data?.source && (
            <Badge tone="accent">{stats.data.source}</Badge>
          )}
          <ExplorerLink
            coin={coin}
            target={{ kind: "home" }}
            label="Explorer"
          />
        </div>
      </CardHeader>
      <CardContent>
        {stats.isError ? (
          <div className="text-xs text-fg-subtle">Market data unavailable.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat
              label={`${profile.symbol} price`}
              value={formatUsd(stats.data?.price_usd)}
            />
            <Stat
              label="Market cap"
              value={formatUsd(stats.data?.market_cap_usd)}
            />
            <Stat
              label="24h volume"
              value={formatUsd(stats.data?.volume_24h_usd)}
            />
            <Stat
              label={coin === "vericoin" ? "Interest rate" : "Block reward"}
              value={
                coin === "vericoin"
                  ? stats.data?.stake_interest !== undefined
                    ? `${formatNumber(stats.data.stake_interest, 2)}%`
                    : "—"
                  : stats.data?.block_reward !== undefined
                    ? `${formatNumber(stats.data.block_reward, 4)} ${profile.symbol}`
                    : "—"
              }
            />
            <Stat
              label="Supply"
              value={
                stats.data?.supply !== undefined
                  ? `${formatNumber(stats.data.supply, 2)} ${profile.symbol}`
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
                blockTimeMin != null
                  ? `${formatNumber(blockTimeMin, 1)} min`
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
