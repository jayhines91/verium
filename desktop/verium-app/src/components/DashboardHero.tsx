import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Cpu, Loader2, Users, Wallet } from "lucide-react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useDashboardActivity } from "@/hooks/useDashboardActivity";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import {
  heroStatusPillLabel,
  heroStatusPillShowsPulse,
} from "@/lib/node/dashboard-activity";
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
  networkHashToKhm,
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
import { miningInfoRefetchMs } from "@/lib/mining-boot";
import { cn, formatBlockAge, formatNumber } from "@/lib/utils";

function StatusPill({
  children,
  tone = "neutral",
  loading = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "accent";
  loading?: boolean;
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
      {loading && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      )}
      {children}
    </span>
  );
}

function HeroBlockHeight({
  localBlocks,
  activityLoading,
  connected,
}: {
  localBlocks?: number;
  activityLoading: boolean;
  connected: boolean;
}) {
  const showPlaceholder = activityLoading && localBlocks == null;
  return (
    <>
      <div
        className={cn(
          "mt-1 text-4xl font-bold tabular-nums tracking-tight",
          showPlaceholder ? "text-fg-muted" : "text-fg",
        )}
      >
        {showPlaceholder ? (
          <span className="inline-flex items-center gap-2">
            <Loader2
              className="h-9 w-9 animate-spin text-accent/80"
              aria-hidden
            />
          </span>
        ) : connected && localBlocks != null ? (
          formatNumber(localBlocks)
        ) : (
          "—"
        )}
      </div>
    </>
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
  const { data: status, activity } = useDashboardActivity(coin);
  const connected = status?.connected === true;
  const explorerEnabled = useExplorerQueriesEnabled();
  const visible = useWindowVisible();

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 5_000 : false,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });
  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: visible ? 5_000 : false,
  });
  const minerActive = minerState.data?.active ?? false;
  const minerStartedAt = minerState.data?.started_at;
  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: (query) => {
      if (!visible) return false;
      const hashrate = query.state.data?.hashrate ?? 0;
      return miningInfoRefetchMs(
        minerActive,
        hashrate,
        minerStartedAt,
        5_000,
        500,
      );
    },
  });
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: visible ? 30_000 : false,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(
      () => setAgeTick((n) => n + 1),
      BLOCK_AGE_TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [visible]);

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

  const pillLoading = heroStatusPillShowsPulse(activity);
  const pillTone = synced && activity.kind === "ready" ? "success" : "accent";

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pillTone} loading={pillLoading}>
          {synced && activity.kind === "ready" && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {heroStatusPillLabel(activity, synced)}
        </StatusPill>
        <StatusPill tone="neutral">
          {blockchain.data?.chain === "test" ? "Testnet" : "Mainnet"}
        </StatusPill>

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
          <HeroBlockHeight
            localBlocks={localBlocks}
            activityLoading={activity.showSpinner}
            connected={connected}
          />
          {activity.kind !== "ready" && (
            <p className="mt-1 text-xs text-fg-muted">{activity.title}</p>
          )}
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
            sub={minerActive ? "Active" : "Inactive"}
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
        <NetworkMetric label="Last block" value={blockAge} />
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
      </div>
    </div>
  );
}

function VericoinSummaryCard() {
  const coin = "vericoin" as const;
  const profile = getCoinProfile(coin);
  const [ageTick, setAgeTick] = useState(0);
  const { data: status, activity } = useDashboardActivity(coin);
  const connected = status?.connected === true;
  const explorerEnabled = useExplorerQueriesEnabled();
  const visible = useWindowVisible();

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 5_000 : false,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });
  const stakingState = useQuery({
    queryKey: coinQueryKey(coin, "get_staking_state"),
    queryFn: () => rpcGetStakingState(coin),
    refetchInterval: visible ? 5_000 : false,
  });
  const vrcMining = useQuery({
    queryKey: coinQueryKey("vericoin", "getmininginfo"),
    queryFn: () => rpcGetVericoinMiningInfo(),
    refetchInterval: visible ? 10_000 : false,
  });
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: visible ? 30_000 : false,
    enabled: explorerEnabled && connected,
    retry: 0,
  });

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(
      () => setAgeTick((n) => n + 1),
      BLOCK_AGE_TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [visible]);

  const stakingActive = stakingState.data?.active ?? false;
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

  const vrcNetwork = mergeStakingNetworkKpis(vrcMining.data, explorer.data);
  const networkStakePct = networkCoinsStakingPercent(vrcNetwork.netStakeWeight);

  const connections = status?.connections ?? 0;
  const connectionLabel =
    connections === 1
      ? "1 connection"
      : `${formatNumber(connections, 0)} connections`;
  const blockHash = blockchain.data?.bestblockhash;
  const blockAge =
    blockchain.data?.mediantime != null
      ? formatBlockAge(blockchain.data.mediantime, ageTick)
      : "—";
  const mempool = vrcMining.data?.pooledtx ?? explorer.data?.pooled_tx;
  const posDifficulty = vrcNetwork.posDifficulty ?? blockchain.data?.difficulty;

  const pillLoading = heroStatusPillShowsPulse(activity);
  const pillTone = synced && activity.kind === "ready" ? "success" : "accent";

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pillTone} loading={pillLoading}>
          {synced && activity.kind === "ready" && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {heroStatusPillLabel(activity, synced)}
        </StatusPill>
        <StatusPill tone="neutral">
          {blockchain.data?.chain === "test" ? "Testnet" : "Mainnet"}
        </StatusPill>

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
          <HeroBlockHeight
            localBlocks={localBlocks}
            activityLoading={activity.showSpinner}
            connected={connected}
          />
          {activity.kind !== "ready" && (
            <p className="mt-1 text-xs text-fg-muted">{activity.title}</p>
          )}
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
            icon={<Coins className="h-3.5 w-3.5" />}
            label="Staking"
            value={
              wallet.data
                ? formatCoinAmount(wallet.data.stake ?? 0, coin, 4)
                : "—"
            }
            sub={stakingActive ? "Active" : "Inactive"}
            subClassName={
              stakingActive ? "font-semibold text-success" : undefined
            }
          />
          <StatBox
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="Available"
            value={
              wallet.data ? formatCoinAmount(wallet.data.balance, coin, 4) : "—"
            }
            sub={
              wallet.data && wallet.data.unconfirmed_balance > 0
                ? `${formatCoinAmount(wallet.data.unconfirmed_balance, coin, 4)} unconfirmed`
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
          label="PoS difficulty"
          value={
            posDifficulty != null
              ? posDifficulty >= 0.0001
                ? formatNumber(posDifficulty, 4)
                : formatNumber(posDifficulty, 6)
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
          label="Interest rate"
          value={
            vrcNetwork.interestRate != null
              ? `${formatNumber(vrcNetwork.interestRate, 2)}%`
              : "—"
          }
        />
        <NetworkMetric label="Last block" value={blockAge} />
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
      </div>
    </div>
  );
}

export function DashboardHero({ coin }: { coin: CoinId }) {
  if (coin === "verium") {
    return <VeriumSummaryCard />;
  }
  return <VericoinSummaryCard />;
}
