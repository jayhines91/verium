import { Link } from "react-router-dom";
import { ArrowLeftRight, Coins, Cpu, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useDashboardData } from "@/hooks/useDashboardData";
import { type TransactionItem } from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import {
  networkCoinsStakingPercent,
  mergeStakingNetworkKpis,
} from "@/lib/staking-stats";
import { transactionCategoryLabel } from "@/lib/transaction-category";
import { AnimatedHashrate } from "@/components/AnimatedHashrate";
import { formatNumber } from "@/lib/utils";

function isEarnActivity(tx: TransactionItem, coin: CoinId): boolean {
  if (coin === "verium") {
    return (
      tx.category === "generate" ||
      tx.category === "immature" ||
      (tx.category === "receive" && tx.amount > 0)
    );
  }
  return (
    tx.category === "stake" ||
    tx.category === "stake-mint" ||
    tx.category === "stake-orphan" ||
    (tx.category === "receive" && tx.amount > 0)
  );
}

export function DashboardStrip({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const { data: status } = useDaemonStatus(coin);
  const connected = status?.connected === true;
  const showRpcData = connected;
  const {
    wallet,
    transactions: txs,
    mining: vrmMining,
    minerState: vrmMiner,
    stakingState: vrcStaking,
    vrcMining,
    explorer: stats,
  } = useDashboardData(coin);

  const vrcNetwork =
    coin === "vericoin"
      ? mergeStakingNetworkKpis(vrcMining.data, stats.data)
      : null;
  const vrcNetworkStakePct =
    coin === "vericoin"
      ? networkCoinsStakingPercent(vrcNetwork?.netStakeWeight)
      : null;

  const activity = (txs.data ?? [])
    .filter((tx) => isEarnActivity(tx, coin))
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 8);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-base normal-case">
            {profile.displayName} wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm">
          <div>
            <div className="text-xs text-fg-subtle">Balance</div>
            <div className="font-semibold tabular-nums">
              {showRpcData && wallet.data
                ? formatCoinAmount(wallet.data.balance, coin, 4)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-subtle">Immature</div>
            <div className="font-semibold tabular-nums">
              {showRpcData && wallet.data
                ? formatCoinAmount(wallet.data.immature_balance, coin, 4)
                : "—"}
            </div>
          </div>
          {coin === "vericoin" && (
            <div className="col-span-2">
              <div className="text-xs text-fg-subtle">Stake weight</div>
              <div className="font-semibold tabular-nums">
                {vrcMining.data?.stakeweight?.combined != null
                  ? formatNumber(vrcMining.data.stakeweight.combined, 0)
                  : "—"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {coin === "verium" ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-base normal-case">
              <Cpu className="h-4 w-4" /> Mining
            </CardTitle>
            <Link to="/mining" className="text-xs text-accent underline">
              Open →
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm">
            <div>
              <div className="text-xs text-fg-subtle">Hashrate</div>
              <div className="font-semibold">
                <AnimatedHashrate
                  value={vrmMining.data?.hashrate}
                  fractionDigits={0}
                  className="text-fg"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Miner</div>
              <div className="font-semibold">
                {vrmMiner.data?.active ? "Running" : "Stopped"}
              </div>
            </div>
            {stats.data?.price_usd != null && (
              <div className="col-span-2">
                <div className="flex items-center gap-1 text-xs text-fg-subtle">
                  <TrendingUp className="h-3 w-3" /> VRM price
                </div>
                <div className="font-semibold tabular-nums">
                  ${formatNumber(stats.data.price_usd, 4)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-base normal-case">
              <Coins className="h-4 w-4" /> Staking
            </CardTitle>
            <Link to="/staking" className="text-xs text-accent underline">
              Open →
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pb-4 pt-0 text-sm">
            <div>
              <div className="text-xs text-fg-subtle">Staking</div>
              <div className="font-semibold">
                {vrcStaking.data?.active ? "Active" : "Stopped"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Interest rate</div>
              <div className="font-semibold tabular-nums">
                {vrcNetwork?.interestRate != null
                  ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Network stake</div>
              <div className="font-semibold tabular-nums">
                {vrcNetworkStakePct != null
                  ? `${formatNumber(vrcNetworkStakePct, 2)}%`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Your weight</div>
              <div className="font-semibold tabular-nums">
                {vrcMining.data?.stakeweight?.combined != null
                  ? formatNumber(vrcMining.data.stakeweight.combined, 0)
                  : "—"}
              </div>
            </div>
            {stats.data?.price_usd != null && (
              <div className="col-span-2">
                <div className="flex items-center gap-1 text-xs text-fg-subtle">
                  <TrendingUp className="h-3 w-3" /> VRC price
                </div>
                <div className="font-semibold tabular-nums">
                  ${formatNumber(stats.data.price_usd, 4)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-base normal-case">
            <ArrowLeftRight className="h-4 w-4" /> Recent {profile.symbol}{" "}
            activity
          </CardTitle>
          <Link to="/transactions" className="text-xs text-accent underline">
            All transactions →
          </Link>
        </CardHeader>
        <CardContent className="pb-4 pt-0">
          {activity.length === 0 ? (
            <div className="text-sm text-fg-muted">
              No recent {profile.symbol} activity yet.
            </div>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {activity.map((tx) => (
                <li
                  key={`${coin}-${tx.txid}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {transactionCategoryLabel(tx.category)}
                    </div>
                    <div className="truncate text-xs text-fg-subtle">
                      {tx.txid.slice(0, 16)}…
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums">
                    {formatCoinAmount(tx.amount, coin, 4)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
