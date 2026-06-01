import { useActiveCoin } from "@/lib/coin/context";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  MinerBootBadge,
  MinerHashrateDisplay,
} from "@/components/MinerBootIndicator";
import {
  buildNetworkStats,
  estimateDailyMining,
  estimateHoursPerBlock,
  formatSessionDuration,
  networkSharePercent,
} from "@/lib/mining-revenue";
import { isMinerBooting } from "@/lib/mining-boot";
import { formatNumber, formatVrm } from "@/lib/utils";
import { useDashboardData } from "@/hooks/useDashboardData";

export function YourMiningPanel() {
  const coin = useActiveCoin();
  const {
    mining,
    minerState,
    wallet,
    transactions,
    explorer: explorerStats,
    minerActive,
  } = useDashboardData(coin);

  const localHashrate = mining.data?.hashrate ?? 0;
  const networkStats = buildNetworkStats(explorerStats.data, mining.data);
  const blocksFound =
    transactions.data?.filter(
      (t) => t.category === "generate" || t.category === "immature",
    ).length ?? 0;
  const immature = wallet.data?.immature_balance ?? 0;
  const active = minerActive;
  const minerBooting = isMinerBooting(
    active,
    localHashrate,
    minerState.data?.started_at,
  );
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const estBlockH = estimateHoursPerBlock(localHashrate, networkStats);
  const daily =
    networkStats && localHashrate > 0
      ? estimateDailyMining({
          localHashrateHm: localHashrate,
          networkHashrateHs: networkStats.networkHash!,
          blocksPerHour: networkStats.blocksPerHour!,
          blockReward: networkStats.blockReward!,
          priceUsd: networkStats.priceUsd,
        })
      : null;

  const miningAny =
    minerBooting ||
    active ||
    localHashrate > 0 ||
    blocksFound > 0 ||
    immature > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MiningPickaxeAnimation
              active={active && !minerBooting}
              booting={minerBooting}
            />
            Your mining
          </CardTitle>
          <CardDescription>
            Solo CPU mining activity on this wallet.
          </CardDescription>
        </div>
        <MinerBootBadge booting={minerBooting} active={active} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {minerBooting && (
          <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg-muted">
            Miner is starting — hashrate should appear within a few seconds.
          </div>
        )}
        {!miningAny ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm text-fg-muted">
              No blocks found yet. Start the built-in miner to earn VRM.
            </p>
            <Link to="/mining">
              <Button size="sm">Start mining</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Blocks found" value={formatNumber(blocksFound, 0)} />
            <Stat
              label="Pending (immature)"
              value={formatVrm(immature, 4)}
            />
            <Stat
              label="Hashrate"
              value={
                <MinerHashrateDisplay
                  booting={minerBooting}
                  value={localHashrate > 0 ? localHashrate : undefined}
                  fractionDigits={0}
                  className="font-semibold"
                />
              }
            />
            <Stat
              label="Network share"
              value={share != null ? `${formatNumber(share, 2)}%` : "—"}
            />
            {active && minerState.data?.started_at && (
              <Stat
                label="Session"
                value={formatSessionDuration(minerState.data.started_at)}
              />
            )}
            <Stat
              label="Est. next block"
              value={estBlockH != null ? `${formatNumber(estBlockH, 1)} h` : "—"}
            />
            {daily && (
              <Stat
                label="Est. daily"
                value={`${formatNumber(daily.vrmPerDay, 3)} VRM`}
              />
            )}
          </div>
        )}
        <Link
          to="/mining"
          className="text-xs text-accent underline underline-offset-2"
        >
          Open mining page →
        </Link>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle/50 px-3 py-2">
      <div className="text-xs uppercase text-fg-subtle">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
