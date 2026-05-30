import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Users, Wallet } from "lucide-react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { Badge } from "@/components/ui/Badge";
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
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  buildNetworkStats,
  networkHashToKhm,
  networkSharePercent,
  resolveBlockTimeMinutes,
} from "@/lib/mining-revenue";
import {
  networkCoinsStakingPercent,
  mergeStakingNetworkKpis,
} from "@/lib/staking-stats";
import {
  blocksBehindNetwork,
  chainSyncPhase,
  syncTargetHeight,
} from "@/lib/bootstrap-policy";
import { BLOCK_AGE_TICK_MS } from "@/lib/block-tip";
import { cn, formatBlockAge, formatNumber, formatPercent } from "@/lib/utils";

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tone === "success" && "bg-success/12 text-success",
        tone === "accent" && "bg-accent/12 text-accent",
        tone === "neutral" && "bg-bg-subtle text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

function StatBox({
  icon,
  label,
  value,
  sub,
  subClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  subClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className={cn("mt-0.5 text-xs text-fg-subtle", subClassName)}>
          {sub}
        </div>
      )}
    </div>
  );
}

function NetworkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}

function VeriumSummaryCard() {
  const coin = "verium" as const;
  const profile = getCoinProfile(coin);
  const [ageTick, setAgeTick] = useState(0);
  const { data: status } = useDaemonStatus(coin);
  const connected = status?.connected === true;
  const explorerEnabled = useExplorerQueriesEnabled();

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
  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: 5_000,
  });
  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: 5_000,
  });
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: 30_000,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  useEffect(() => {
    const id = window.setInterval(
      () => setAgeTick((n) => n + 1),
      BLOCK_AGE_TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const networkTip = explorer.data?.height;
  const syncCtx = {
    connected,
    syncStalled: status?.sync_stalled === true,
    networkTip,
  };
  const phase = chainSyncPhase(blockchain.data, syncCtx);
  const synced = phase === "synced";
  const localBlocks = blockchain.data?.blocks;
  const syncTarget = syncTargetHeight(blockchain.data, networkTip);
  const behind = blocksBehindNetwork(localBlocks, syncTarget);
  const heightDelta =
    localBlocks != null && networkTip != null
      ? localBlocks - networkTip
      : undefined;
  const matchesExplorer = heightDelta != null && Math.abs(heightDelta) <= 1;

  const localHashrate = mining.data?.hashrate ?? 0;
  const minerActive = minerState.data?.active ?? false;
  const networkStats = buildNetworkStats(explorer.data, mining.data);
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const networkHashKhm =
    explorer.data?.network_hash != null
      ? networkHashToKhm(explorer.data.network_hash)
      : mining.data?.networkhashps != null
        ? networkHashToKhm(mining.data.networkhashps)
        : null;
  const difficulty =
    explorer.data?.difficulty ??
    blockchain.data?.difficulty ??
    mining.data?.difficulty;
  const blockTimeMin = resolveBlockTimeMinutes(explorer.data, mining.data);
  const mempool = mining.data?.pooledtx ?? explorer.data?.pooled_tx;
  const blockHash = blockchain.data?.bestblockhash;
  const blockAge =
    blockchain.data?.mediantime != null
      ? formatBlockAge(blockchain.data.mediantime, ageTick)
      : "—";
  const connections = status?.connections ?? 0;
  const connectionLabel =
    connections === 1
      ? "1 connection"
      : `${formatNumber(connections, 0)} connections`;

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={synced ? "success" : "neutral"}>
          {synced && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {synced
            ? "Fully synced"
            : phase === "offline"
              ? "Offline"
              : blockchain.data?.initialblockdownload
                ? "Syncing"
                : "Catching up"}
        </StatusPill>
        <StatusPill tone="neutral">
          {blockchain.data?.chain === "test" ? "Testnet" : "Mainnet"}
        </StatusPill>
        {explorerEnabled && matchesExplorer && (
          <StatusPill tone="success">Matches explorer</StatusPill>
        )}
        {explorerEnabled && heightDelta != null && !matchesExplorer && (
          <StatusPill tone="neutral">
            {heightDelta >= 0 ? "+" : ""}
            {formatNumber(heightDelta, 0)} vs explorer
          </StatusPill>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Latest Block
          </div>
          <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-fg">
            {connected && localBlocks != null ? formatNumber(localBlocks) : "—"}
          </div>
          {!synced && syncTarget != null && syncTarget > (localBlocks ?? 0) && (
            <div className="mt-1 text-xs text-fg-muted">
              of ~{formatNumber(syncTarget)} network tip
              {behind != null && behind > 0 && (
                <> · ~{formatNumber(behind, 0)} blocks behind</>
              )}
            </div>
          )}
          {blockHash && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-bg-subtle p-2 text-xs text-fg-muted">
                {blockHash.slice(0, 36)}…
              </span>
              <ExplorerLink
                coin={coin}
                target={{ kind: "block", hashOrHeight: blockHash }}
                label="View block"
              />
            </div>
          )}
        </div>

        <div className="grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[420px]">
          <StatBox
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="Mining"
            value={
              localHashrate > 0 ? `${formatNumber(localHashrate, 0)} H/m` : "—"
            }
            sub={minerActive ? "Active" : "Idle"}
            subClassName={
              minerActive ? "font-semibold text-success" : undefined
            }
          />
          <StatBox
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="Available"
            value={
              wallet.data ? formatCoinAmount(wallet.data.balance, coin, 4) : "—"
            }
            sub={
              wallet.data && wallet.data.immature_balance > 0
                ? `${formatCoinAmount(wallet.data.immature_balance, coin, 4)} immature`
                : undefined
            }
          />
          <StatBox
            icon={<Users className="h-3.5 w-3.5" />}
            label="Peers"
            value={formatNumber(connections, 0)}
            sub={connectionLabel}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-6">
        <NetworkMetric
          label="Network hashrate"
          value={
            networkHashKhm != null
              ? `${formatNumber(networkHashKhm, 1)} kH/m`
              : "—"
          }
        />
        <NetworkMetric
          label="Difficulty"
          value={
            difficulty != null
              ? difficulty >= 0.0001
                ? formatNumber(difficulty, 4)
                : formatNumber(difficulty, 6)
              : "—"
          }
        />
        <NetworkMetric
          label="Avg. block time"
          value={
            blockTimeMin != null ? `${formatNumber(blockTimeMin, 1)} min` : "—"
          }
        />
        <NetworkMetric
          label={`${profile.symbol} price`}
          value={
            explorer.data?.price_usd != null
              ? `$${formatNumber(explorer.data.price_usd, 4)}`
              : "—"
          }
        />
        <NetworkMetric
          label="Mempool"
          value={mempool != null ? formatNumber(mempool, 0) : "—"}
        />
        <NetworkMetric
          label="Hashrate share"
          value={share != null ? `${formatNumber(share, 2)}%` : "—"}
        />
      </div>
    </div>
  );
}

function VericoinSummaryCard() {
  const coin = "vericoin" as const;
  const profile = getCoinProfile(coin);
  const { data: status } = useDaemonStatus(coin);
  const connected = status?.connected === true;
  const explorerEnabled = useExplorerQueriesEnabled();

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
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: 30_000,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  const networkTip = explorer.data?.height;
  const syncCtx = {
    connected,
    syncStalled: status?.sync_stalled === true,
    networkTip,
  };
  const phase = chainSyncPhase(blockchain.data, syncCtx);
  const synced = phase === "synced";
  const localBlocks = blockchain.data?.blocks;
  const vrcNetwork = mergeStakingNetworkKpis(vrcMining.data, explorer.data);
  const networkStakePct = networkCoinsStakingPercent(vrcNetwork.netStakeWeight);
  const connections = status?.connections ?? 0;

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={synced ? "success" : "neutral"}>
          {synced && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {synced
            ? "Fully synced"
            : phase === "offline"
              ? "Offline"
              : "Syncing"}
        </StatusPill>
        <StatusPill tone="neutral">
          {blockchain.data?.chain === "test" ? "Testnet" : "Mainnet"}
        </StatusPill>
        {stakingState.data?.active && (
          <Badge tone="success">Staking active</Badge>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Latest block
          </div>
          <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight">
            {connected && localBlocks != null ? formatNumber(localBlocks) : "—"}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4 lg:w-auto">
          <div>
            <div className="text-xs text-fg-subtle">Spendable</div>
            <div className="text-lg font-semibold tabular-nums">
              {wallet.data
                ? formatCoinAmount(wallet.data.balance, coin, 4)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-subtle">Stake weight</div>
            <div className="text-lg font-semibold tabular-nums">
              {wallet.data
                ? formatCoinAmount(wallet.data.stake ?? 0, coin, 4)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-subtle">Interest rate</div>
            <div className="text-lg font-semibold tabular-nums">
              {vrcNetwork.interestRate != null
                ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-subtle">Peers</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatNumber(connections, 0)}
            </div>
          </div>
        </div>
      </div>

      {explorerEnabled && explorer.data && (
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <NetworkMetric
            label={`${profile.symbol} price`}
            value={
              explorer.data.price_usd != null
                ? `$${formatNumber(explorer.data.price_usd, 4)}`
                : "—"
            }
          />
          <NetworkMetric
            label="Network staked"
            value={
              networkStakePct != null
                ? `${formatNumber(networkStakePct, 2)}%`
                : "—"
            }
          />
          <NetworkMetric
            label="Supply"
            value={
              explorer.data.supply != null
                ? formatNumber(explorer.data.supply, 0)
                : "—"
            }
          />
          <NetworkMetric
            label="Block reward"
            value={
              explorer.data.block_reward != null
                ? `${formatNumber(explorer.data.block_reward, 4)} ${profile.symbol}`
                : "—"
            }
          />
        </div>
      )}

      {!synced && blockchain.data && (
        <div className="mt-3 text-xs text-fg-muted">
          {formatPercent(blockchain.data.verificationprogress, 0)} verified
        </div>
      )}
    </div>
  );
}

export function DashboardHero({ coin }: { coin: CoinId }) {
  if (coin === "verium") {
    return <VeriumSummaryCard />;
  }
  return <VericoinSummaryCard />;
}
