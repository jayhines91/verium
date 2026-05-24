import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Coins, Cpu, Wallet } from "lucide-react";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetStakingState,
  rpcGetVericoinMiningInfo,
  rpcGetWalletInfo,
} from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { networkCoinsStakingPercent, mergeStakingNetworkKpis } from "@/lib/staking-stats";
import {
  blocksBehindNetwork,
  syncTargetHeight,
} from "@/lib/bootstrap-policy";
import { cn, formatNumber, formatPercent } from "@/lib/utils";

function ChainStatusCard({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const { data: status } = useDaemonStatus(coin);
  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 5_000,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: 30_000,
    enabled: blockchain.data?.initialblockdownload === true,
    retry: 0,
  });

  const ibd = blockchain.data?.initialblockdownload;
  const progress = blockchain.data?.verificationprogress ?? 0;
  const connected = status?.connected === true;
  const synced =
    connected && ibd === false && status?.sync_stalled !== true;
  const localBlocks = blockchain.data?.blocks;
  const networkTip = explorer.data?.height;
  const syncTarget = syncTargetHeight(blockchain.data, networkTip);
  const behind = blocksBehindNetwork(localBlocks, syncTarget);

  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        profile.accentClass,
        "border-border bg-bg-panel/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {profile.displayName} · {profile.symbol}
          </div>
          <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">
            {localBlocks != null ? formatNumber(localBlocks) : "—"}
          </div>
          <div className="text-sm text-fg-muted">block height</div>
          {!synced && syncTarget != null && syncTarget > (localBlocks ?? 0) && (
            <div className="mt-1 font-mono text-xs text-fg-muted">
              of ~{formatNumber(syncTarget)} network tip
            </div>
          )}
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase",
            synced ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {synced ? "Synced" : !connected ? "Offline" : ibd ? "Syncing" : "Catching up"}
        </span>
      </div>
      {!synced && (
        <div className="mt-2 space-y-0.5 text-xs text-fg-muted">
          <div>{formatPercent(progress, 0)} verified</div>
          {behind != null && behind > 0 && (
            <div>~{formatNumber(behind, 0)} blocks behind network</div>
          )}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-fg-subtle">Spendable</div>
          <div className="text-lg font-semibold tabular-nums">
            {wallet.data
              ? formatCoinAmount(wallet.data.balance, coin, 4)
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-subtle">Unconfirmed</div>
          <div className="text-lg font-semibold tabular-nums">
            {wallet.data
              ? formatCoinAmount(wallet.data.unconfirmed_balance, coin, 4)
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-subtle">Immature</div>
          <div className="text-lg font-semibold tabular-nums">
            {wallet.data
              ? formatCoinAmount(wallet.data.immature_balance, coin, 4)
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-subtle">Peers</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatNumber(status?.connections ?? 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

function VeriumMiningCard({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: 5_000,
  });
  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: 5_000,
  });

  return (
    <Link
      to="/mining"
      className="rounded-xl border border-border bg-bg-panel/60 p-4 transition-colors hover:border-border-strong hover:bg-bg-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Cpu className="h-4 w-4 text-accent" />
          CPU mining
        </div>
        <span
          className={cn(
            "text-xs font-semibold",
            minerState.data?.active ? "text-success" : "text-fg-subtle",
          )}
        >
          {minerState.data?.active ? "Active" : "Idle"}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {formatNumber(mining.data?.hashrate ?? 0, 0)} H/m
      </div>
      <div className="mt-1 text-xs text-fg-subtle">
        Local hashrate · {profile.symbol} rewards after 101 confirmations
      </div>
    </Link>
  );
}

function VericoinStakingCard({ coin }: { coin: CoinId }) {
  const stakingState = useQuery({
    queryKey: coinQueryKey(coin, "get_staking_state"),
    queryFn: () => rpcGetStakingState(coin),
    refetchInterval: 5_000,
  });
  const vrcMining = useQuery({
    queryKey: coinQueryKey("vericoin", "getmininginfo"),
    queryFn: () => rpcGetVericoinMiningInfo(),
    refetchInterval: 10_000,
  });
  const vrcExplorer = useQuery({
    queryKey: coinQueryKey("vericoin", "explorer-stats"),
    queryFn: () => fetchExplorerStats("vericoin"),
    refetchInterval: 30_000,
    retry: 0,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });

  const vrcNetwork = mergeStakingNetworkKpis(vrcMining.data, vrcExplorer.data);
  const networkStakePct = networkCoinsStakingPercent(vrcNetwork.netStakeWeight);

  return (
    <Link
      to="/staking"
      className="rounded-xl border border-border bg-bg-panel/60 p-4 transition-colors hover:border-border-strong hover:bg-bg-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Coins className="h-4 w-4 text-accent" />
          PoST staking
        </div>
        <span
          className={cn(
            "text-xs font-semibold",
            stakingState.data?.active ? "text-success" : "text-fg-subtle",
          )}
        >
          {stakingState.data?.active ? "Active" : "Idle"}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {vrcNetwork.interestRate != null
          ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
          : formatCoinAmount(wallet.data?.stake ?? 0, coin, 4)}
      </div>
      <div className="mt-1 text-xs text-fg-subtle">
        {networkStakePct != null
          ? `${formatNumber(networkStakePct, 2)}% network staked · ${formatCoinAmount(wallet.data?.stake ?? 0, coin, 4)} your weight`
          : `Stake weight ${formatCoinAmount(wallet.data?.stake ?? 0, coin, 4)}`}
      </div>
    </Link>
  );
}

export function DashboardHero({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);

  return (
    <div className="flex flex-col gap-4">
      <ChainStatusCard coin={coin} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {coin === "verium" ? (
          <VeriumMiningCard coin={coin} />
        ) : (
          <VericoinStakingCard coin={coin} />
        )}
        <Link
          to="/wallet"
          className="rounded-xl border border-border bg-bg-panel/60 p-4 transition-colors hover:border-border-strong hover:bg-bg-panel"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4 text-accent" />
            {profile.displayName} wallet
          </div>
          <div className="mt-2 text-sm text-fg-muted">
            Balances, unlock, and HD upgrade for {profile.symbol}.
          </div>
        </Link>
        <Link
          to="/transactions"
          className="rounded-xl border border-border bg-bg-panel/60 p-4 transition-colors hover:border-border-strong hover:bg-bg-panel"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <ArrowLeftRight className="h-4 w-4 text-accent" />
            Send &amp; receive
          </div>
          <div className="mt-2 text-sm text-fg-muted">
            Pay {profile.symbol} or create receiving addresses.
          </div>
        </Link>
      </div>
    </div>
  );
}
