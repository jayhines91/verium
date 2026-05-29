import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import { MinerBootBadge } from "@/components/MinerBootIndicator";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  buildNetworkStats,
  estimateDailyMining,
  networkSharePercent,
} from "@/lib/mining-revenue";
import { isMinerBooting } from "@/lib/mining-boot";
import {
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetWalletInfo,
  rpcListTransactions,
} from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import { formatNumber } from "@/lib/utils";

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

export function DashboardMiddleRow({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const explorerEnabled = useExplorerQueriesEnabled();

  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });
  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: 5_000,
    enabled: coin === "verium",
  });
  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: 5_000,
    enabled: coin === "verium",
  });
  const txs = useQuery({
    queryKey: coinQueryKey(coin, "listtransactions", "dashboard-middle"),
    queryFn: () => rpcListTransactions(coin, 50, 0),
    refetchInterval: 30_000,
  });
  const stats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled,
    refetchInterval: 60_000,
    retry: 0,
  });

  const localHashrate = mining.data?.hashrate ?? 0;
  const minerActive = minerState.data?.active ?? false;
  const minerBooting = isMinerBooting(
    minerActive,
    localHashrate,
    minerState.data?.started_at,
  );
  const networkStats = buildNetworkStats(stats.data, mining.data);
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const blocksFound =
    txs.data?.filter(
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base normal-case tracking-normal text-fg">
            <Wallet className="h-4 w-4 text-accent" />
            Wallet
          </CardTitle>
          <Link
            to="/wallet"
            className="text-xs font-medium text-accent hover:underline"
          >
            Open →
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-5 pt-0 text-sm">
          <MiniStat
            label="Balance"
            value={
              wallet.data
                ? formatCoinAmount(wallet.data.balance, coin, 4)
                : "—"
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
          <MiniStat
            label="Unconfirmed"
            value={
              wallet.data
                ? formatCoinAmount(wallet.data.unconfirmed_balance, coin, 4)
                : "—"
            }
          />
          <MiniStat
            label="Transactions"
            value={
              wallet.data ? formatNumber(wallet.data.txcount, 0) : "—"
            }
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
            <ExplorerLink coin={coin} target={{ kind: "home" }} label="Explorer" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pb-5 pt-0 text-sm">
            <MiniStat label="VRM" value={formatUsd(stats.data?.price_usd)} />
            <MiniStat
              label="24h vol"
              value={formatUsd(stats.data?.volume_24h_usd)}
            />
            <MiniStat
              label="Reward"
              value={
                stats.data?.block_reward != null
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

      {coin === "verium" && (
        <Card className="flex flex-col">
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
          <CardContent className="grid flex-1 grid-cols-2 gap-3 pb-3 pt-0 text-sm">
            <MiniStat
              label="Blocks found"
              value={formatNumber(blocksFound, 0)}
            />
            <MiniStat
              label="Hashrate"
              value={
                minerBooting
                  ? "Starting…"
                  : localHashrate > 0
                    ? `${formatNumber(localHashrate, 0)} H/m`
                    : "—"
              }
            />
            <MiniStat
              label="Network share"
              value={share != null ? `${formatNumber(share, 2)}%` : "—"}
            />
            <MiniStat
              label="Est. daily"
              value={
                daily ? `${formatNumber(daily.vrmPerDay, 3)} VRM` : "—"
              }
            />
          </CardContent>
          <div className="border-t border-border px-5 py-2.5">
            <Link
              to="/mining"
              className="text-xs font-medium text-accent hover:underline"
            >
              Open mining page →
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
