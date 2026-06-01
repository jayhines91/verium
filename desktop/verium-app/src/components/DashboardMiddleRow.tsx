import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Coins, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import { MinerBootBadge } from "@/components/MinerBootIndicator";
import { getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  buildNetworkStats,
  estimateDailyMining,
  networkSharePercent,
} from "@/lib/mining-revenue";
import { isMinerBooting } from "@/lib/mining-boot";
import { AnimatedHashrate } from "@/components/AnimatedHashrate";
import { formatCoinAmount } from "@/lib/units";
import {
  mergeStakingNetworkKpis,
  networkCoinsStakingPercent,
  walletStakeSharePercent,
} from "@/lib/staking-stats";
import { cn, formatNumber } from "@/lib/utils";
import { useDashboardData } from "@/hooks/useDashboardData";

function formatUsd(value?: number): string {
  if (value === undefined || value === null) return "—";
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value / 1_000, 2)}K`;
  return `$${formatNumber(value, 4)}`;
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function DashboardMiddleRow({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const {
    wallet,
    mining,
    minerState,
    stakingState,
    vrcMining,
    transactions,
    explorer: stats,
    minerActive,
  } = useDashboardData(coin);

  const localHashrate = mining.data?.hashrate ?? 0;
  const minerBooting = isMinerBooting(
    minerActive,
    localHashrate,
    minerState.data?.started_at,
  );
  const networkStats = buildNetworkStats(stats.data, mining.data);
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const blocksFound =
    transactions.data?.filter(
      (t) => t.category === "generate" || t.category === "immature",
    ).length ?? 0;
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

  const vrcNetwork =
    coin === "vericoin"
      ? mergeStakingNetworkKpis(vrcMining.data, stats.data)
      : null;
  const vrcNetworkStakePct =
    coin === "vericoin"
      ? networkCoinsStakingPercent(vrcNetwork?.netStakeWeight)
      : null;
  const vrcStakeShare =
    coin === "vericoin"
      ? walletStakeSharePercent(wallet.data?.stake, vrcNetwork?.netStakeWeight)
      : null;
  const stakingActive = stakingState.data?.active ?? false;
  const stakeTxCount =
    transactions.data?.filter(
      (t) =>
        t.category === "stake" ||
        t.category === "stake-mint" ||
        t.category === "stake-orphan",
    ).length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base normal-case tracking-normal text-fg">
            <Wallet className="h-4 w-4 text-accent" />
            Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-5 pt-0 text-sm">
          <MiniStat
            label="Balance"
            value={
              wallet.data ? formatCoinAmount(wallet.data.balance, coin, 4) : "—"
            }
          />
          <MiniStat
            label="Immature"
            value={
              wallet.data
                ? formatCoinAmount(wallet.data.immature_balance, coin, 4)
                : "—"
            }
          />
          {coin === "vericoin" ? (
            <MiniStat
              label="Stake weight"
              value={
                wallet.data
                  ? formatCoinAmount(wallet.data.stake ?? 0, coin, 4)
                  : "—"
              }
            />
          ) : (
            <MiniStat
              label="Unconfirmed"
              value={
                wallet.data
                  ? formatCoinAmount(wallet.data.unconfirmed_balance, coin, 4)
                  : "—"
              }
            />
          )}
          <MiniStat
            label="Transactions"
            value={wallet.data ? formatNumber(wallet.data.txcount, 0) : "—"}
          />
        </CardContent>
      </Card>

      {explorerEnabled && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-base normal-case tracking-normal text-fg">
              <TrendingUp className="h-4 w-4 text-accent" />
              Market
            </CardTitle>
            <ExplorerLink
              coin={coin}
              target={{ kind: "home" }}
              label="Explorer"
            />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pb-5 pt-0 text-sm">
            <MiniStat
              label={profile.symbol}
              value={formatUsd(stats.data?.price_usd)}
            />
            <MiniStat
              label="24h vol"
              value={formatUsd(stats.data?.volume_24h_usd)}
            />
            <MiniStat
              label={coin === "vericoin" ? "Interest rate" : "Block reward"}
              value={
                coin === "vericoin"
                  ? vrcNetwork?.interestRate != null
                    ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
                    : stats.data?.stake_interest != null
                      ? `${formatNumber(stats.data.stake_interest, 2)}%`
                      : "—"
                  : stats.data?.block_reward != null
                    ? `${formatNumber(stats.data.block_reward, 4)} ${profile.symbol}`
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

      {coin === "verium" ? (
        <Link
          to="/mining"
          aria-label="Open mining page"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <Card className="flex h-full flex-col transition-colors group-hover:border-accent/40 group-hover:bg-bg-subtle/20">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base normal-case tracking-normal text-fg">
                <MiningPickaxeAnimation
                  active={minerActive && !minerBooting}
                  booting={minerBooting}
                />
                Your mining
              </CardTitle>
              <MinerBootBadge booting={minerBooting} active={minerActive} />
            </CardHeader>
            <CardContent className="grid flex-1 grid-cols-2 gap-3 pb-5 pt-0 text-sm">
              <MiniStat
                label="Blocks found"
                value={formatNumber(blocksFound, 0)}
              />
              <MiniStat
                label="Hashrate"
                value={
                  <AnimatedHashrate
                    booting={minerBooting}
                    value={localHashrate > 0 ? localHashrate : undefined}
                    fractionDigits={0}
                    className="font-semibold text-fg"
                  />
                }
              />
              <MiniStat
                label="Network share"
                value={share != null ? `${formatNumber(share, 2)}%` : "—"}
              />
              <MiniStat
                label="Est. daily"
                value={
                  daily
                    ? `${formatNumber(daily.vrmPerDay, 3)} ${profile.symbol}`
                    : "—"
                }
              />
            </CardContent>
          </Card>
        </Link>
      ) : (
        <Link
          to="/staking"
          aria-label="Open staking page"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <Card className="flex h-full flex-col transition-colors group-hover:border-accent/40 group-hover:bg-bg-subtle/20">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base normal-case tracking-normal text-fg">
                <Coins
                  className={cn(
                    "h-4 w-4",
                    stakingActive ? "text-success" : "text-accent",
                  )}
                />
                Your staking
              </CardTitle>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  stakingActive
                    ? "bg-success/12 text-success"
                    : "bg-bg-subtle text-fg-muted",
                )}
              >
                {stakingActive ? "Active" : "Inactive"}
              </span>
            </CardHeader>
            <CardContent className="grid flex-1 grid-cols-2 gap-3 pb-5 pt-0 text-sm">
              <MiniStat
                label="Stake rewards"
                value={formatNumber(stakeTxCount, 0)}
              />
              <MiniStat
                label="Interest rate"
                value={
                  vrcNetwork?.interestRate != null
                    ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
                    : "—"
                }
              />
              <MiniStat
                label="Network staked"
                value={
                  vrcNetworkStakePct != null
                    ? `${formatNumber(vrcNetworkStakePct, 2)}%`
                    : "—"
                }
              />
              <MiniStat
                label="Stake share"
                value={
                  vrcStakeShare != null
                    ? `${formatNumber(vrcStakeShare, 2)}%`
                    : "—"
                }
              />
            </CardContent>
          </Card>
        </Link>
      )}
    </div>
  );
}
