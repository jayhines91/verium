import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import {
  MinerBootBadge,
  MinerHashrateDisplay,
} from "@/components/MinerBootIndicator";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import { EXPLORER_HOME } from "@/lib/verium-links";
import {
  buildNetworkStats,
  estimateDailyMining,
  networkSharePercent,
} from "@/lib/mining-revenue";
import { isMinerBooting, miningInfoRefetchMs } from "@/lib/mining-boot";
import {
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetWalletInfo,
  rpcListTransactions,
} from "@/lib/rpc/client";
import { formatNumber, formatVrm, cn } from "@/lib/utils";

function formatUsd(value?: number): string {
  if (value === undefined || value === null) return "—";
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value / 1_000, 2)}K`;
  return `$${formatNumber(value, 4)}`;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function DashboardStrip() {
  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
    refetchInterval: 10_000,
  });
  const minerState = useQuery({
    queryKey: ["get_miner_state"],
    queryFn: rpcGetMinerState,
    refetchInterval: 5_000,
  });
  const minerActive = minerState.data?.active ?? false;
  const minerStartedAt = minerState.data?.started_at;
  const mining = useQuery({
    queryKey: ["getmininginfo"],
    queryFn: rpcGetMiningInfo,
    refetchInterval: (query) => {
      const hr = query.state.data?.hashrate ?? 0;
      return miningInfoRefetchMs(minerActive, hr, minerStartedAt, 5_000);
    },
  });
  const txs = useQuery({
    queryKey: ["listtransactions", "dashboard-strip"],
    queryFn: () => rpcListTransactions(50, 0),
    refetchInterval: 30_000,
  });
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  const stats = useQuery({
    queryKey: ["explorer-stats"],
    queryFn: fetchExplorerStats,
    enabled: explorerEnabled.data !== false,
    refetchInterval: 60_000,
    retry: 1,
  });

  const localHashrate = mining.data?.hashrate ?? 0;
  const networkStats = buildNetworkStats(stats.data, mining.data);
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const blocksFound =
    txs.data?.filter(
      (t) => t.category === "generate" || t.category === "immature",
    ).length ?? 0;
  const active = minerActive;
  const minerBooting = isMinerBooting(
    active,
    localHashrate,
    minerStartedAt,
  );
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

  const showMarket = explorerEnabled.data !== false;

  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-3",
        showMarket
          ? "md:grid-cols-3"
          : "md:grid-cols-2",
      )}
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-base normal-case">
            <Wallet className="h-4 w-4" /> Wallet
          </CardTitle>
          <Link
            to="/wallet"
            className="text-xs text-accent underline underline-offset-2"
          >
            Open →
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm w-full">
          <MiniStat
            label="Balance"
            value={wallet.data ? formatVrm(wallet.data.balance, 4) : "—"}
          />
          <MiniStat
            label="Immature"
            value={
              wallet.data ? formatVrm(wallet.data.immature_balance, 4) : "—"
            }
          />
          <MiniStat
            label="Unconfirmed"
            value={
              wallet.data ? formatVrm(wallet.data.unconfirmed_balance, 4) : "—"
            }
          />
          <MiniStat
            label="Transactions"
            value={wallet.data ? formatNumber(wallet.data.txcount, 0) : "—"}
          />
        </CardContent>
      </Card>

      {showMarket && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-base normal-case">
              <TrendingUp className="h-4 w-4" /> Market
            </CardTitle>
            <ExplorerLink
              target={{ kind: "raw", url: EXPLORER_HOME }}
              label="Explorer"
            />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm">
            <MiniStat label="VRM" value={formatUsd(stats.data?.price_usd)} />
            <MiniStat
              label="24h vol"
              value={formatUsd(stats.data?.volume_24h_usd)}
            />
            <MiniStat
              label="Reward"
              value={
                stats.data?.block_reward != null
                  ? `${formatNumber(stats.data.block_reward, 4)} VRM`
                  : "—"
              }
            />
            <MiniStat
              label="Supply"
              value={
                stats.data?.supply != null
                  ? formatNumber(stats.data.supply, 0)
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-base normal-case">
            <MiningPickaxeAnimation
              active={active && !minerBooting}
              booting={minerBooting}
            />
            Your mining
          </CardTitle>
          <MinerBootBadge booting={minerBooting} active={active} />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm">
          <MiniStat label="Blocks found" value={formatNumber(blocksFound, 0)} />
          <div>
            <div className="text-xs text-fg-subtle">Hashrate</div>
            <MinerHashrateDisplay
              booting={minerBooting}
              value={
                localHashrate > 0
                  ? `${formatNumber(localHashrate, 0)} H/m`
                  : "—"
              }
              className="font-semibold tabular-nums"
            />
          </div>
          <MiniStat
            label="Network share"
            value={share != null ? `${formatNumber(share, 2)}%` : "—"}
          />
          <MiniStat
            label="Est. daily"
            value={daily ? `${formatNumber(daily.vrmPerDay, 3)} VRM` : "—"}
          />
        </CardContent>
        <div className="border-t border-border px-4 py-2">
          <Link
            to="/mining"
            className="text-xs text-accent underline underline-offset-2"
          >
            Open mining page →
          </Link>
        </div>
      </Card>
    </div>
  );
}
