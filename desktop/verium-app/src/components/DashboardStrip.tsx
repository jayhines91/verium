import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Coins, Cpu, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import {
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetStakingState,
  rpcGetVericoinMiningInfo,
  rpcGetWalletInfo,
  rpcListTransactions,
  type TransactionItem,
} from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import {
  networkCoinsStakingPercent,
  mergeStakingNetworkKpis,
} from "@/lib/staking-stats";
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

function activityLabel(tx: TransactionItem): string {
  switch (tx.category) {
    case "generate":
    case "immature":
      return "Mined";
    case "stake":
    case "stake-mint":
      return "Staked";
    case "stake-orphan":
      return "Stake orphan";
    case "receive":
      return "Received";
    case "send":
      return "Sent";
    default:
      return tx.category;
  }
}

export function DashboardStrip({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const { data: status } = useDaemonStatus(coin);
  const connected = status?.connected === true;
  const showRpcData = connected;

  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });
  const txs = useQuery({
    queryKey: coinQueryKey(coin, "listtransactions", "dashboard-strip"),
    queryFn: () => rpcListTransactions(coin, 30, 0),
    refetchInterval: 30_000,
  });
  const vrmMining = useQuery({
    queryKey: coinQueryKey("verium", "getmininginfo"),
    queryFn: () => rpcGetMiningInfo("verium"),
    refetchInterval: 5_000,
    enabled: coin === "verium",
  });
  const vrmMiner = useQuery({
    queryKey: coinQueryKey("verium", "get_miner_state"),
    queryFn: () => rpcGetMinerState("verium"),
    refetchInterval: 5_000,
    enabled: coin === "verium",
  });
  const vrcStaking = useQuery({
    queryKey: coinQueryKey("vericoin", "get_staking_state"),
    queryFn: () => rpcGetStakingState("vericoin"),
    refetchInterval: 5_000,
    enabled: coin === "vericoin",
  });
  const vrcMining = useQuery({
    queryKey: coinQueryKey("vericoin", "getmininginfo"),
    queryFn: () => rpcGetVericoinMiningInfo(),
    refetchInterval: 10_000,
    enabled: coin === "vericoin",
  });
  const explorerEnabled = useExplorerQueriesEnabled();
  const stats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled,
    refetchInterval: 60_000,
  });

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
                {wallet.data
                  ? formatCoinAmount(wallet.data.stake ?? 0, coin, 4)
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
              <div className="font-semibold tabular-nums">
                {formatNumber(vrmMining.data?.hashrate ?? 0, 0)} H/m
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
                {wallet.data
                  ? formatCoinAmount(wallet.data.stake ?? 0, coin, 2)
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
                    <div className="font-medium">{activityLabel(tx)}</div>
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
