import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Pickaxe, Users, Wallet } from "lucide-react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { BLOCK_AGE_TICK_MS, resolveTipBlock } from "@/lib/block-tip";
import {
  fetchExplorerBlocks,
  fetchExplorerStats,
  isExplorerApiEnabled,
} from "@/lib/explorer-api";
import {
  averageBlockTimeMinutes,
  buildNetworkStats,
  networkHashToKhm,
  networkSharePercent,
} from "@/lib/mining-revenue";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetNetworkInfo,
  rpcGetPeerInfo,
  rpcGetWalletInfo,
} from "@/lib/rpc/client";
import {
  cn,
  formatBlockAge,
  formatNumber,
  formatPercent,
  formatVrm,
} from "@/lib/utils";

function StatusDot({ synced }: { synced: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-2 w-2 shrink-0 rounded-full",
        synced ? "bg-success" : "bg-warning",
      )}
      aria-hidden
    >
      {synced && (
        <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
      )}
    </span>
  );
}

function MetaDivider() {
  return (
    <span className="hidden h-3 w-px shrink-0 bg-border sm:block" aria-hidden />
  );
}

interface QuickTileProps {
  to: string;
  icon: typeof Pickaxe;
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
}

function QuickTile({
  to,
  icon: Icon,
  label,
  value,
  hint,
  active,
}: QuickTileProps) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex min-w-[7.5rem] flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors",
        active
          ? "border-success/35 bg-success/8 hover:bg-success/12"
          : "border-border/80 bg-bg-panel/60 hover:border-border-strong hover:bg-bg-panel",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          <Icon
            className={cn(
              "h-3.5 w-3.5",
              active ? "text-success" : "text-fg-muted",
            )}
          />
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div
        className={cn(
          "truncate text-sm font-semibold tabular-nums",
          active ? "text-success" : "text-fg",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="truncate text-[11px] text-fg-subtle">{hint}</div>
      )}
    </Link>
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  className?: string;
}

function MetricCell({ label, value, className }: MetricCellProps) {
  return (
    <div className={cn("px-4 py-3", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}

export function DashboardHero() {
  const prevHeight = useRef<number | null>(null);
  const [ageTick, setAgeTick] = useState(0);
  const { data: status } = useDaemonStatus();
  const blockchain = useQuery({
    queryKey: ["getblockchaininfo"],
    queryFn: rpcGetBlockchainInfo,
    refetchInterval: 5_000,
  });
  const network = useQuery({
    queryKey: ["getnetworkinfo"],
    queryFn: rpcGetNetworkInfo,
    refetchInterval: 5_000,
  });
  const peers = useQuery({
    queryKey: ["getpeerinfo"],
    queryFn: rpcGetPeerInfo,
    refetchInterval: 5_000,
  });
  const mining = useQuery({
    queryKey: ["getmininginfo"],
    queryFn: rpcGetMiningInfo,
    refetchInterval: 5_000,
  });
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
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  const explorerStats = useQuery({
    queryKey: ["explorer-stats"],
    queryFn: fetchExplorerStats,
    enabled: explorerEnabled.data === true,
    refetchInterval: 30_000,
    retry: 0,
  });
  const explorerBlocks = useQuery({
    queryKey: ["explorer-blocks", 50],
    queryFn: () => fetchExplorerBlocks(50),
    enabled: explorerEnabled.data !== false,
    refetchInterval: 30_000,
    retry: 1,
  });

  const ibd = blockchain.data?.initialblockdownload;
  const progress = blockchain.data?.verificationprogress ?? 0;
  const blocks = blockchain.data?.blocks;
  const headers = blockchain.data?.headers;
  const lag =
    blocks != null && headers != null ? Math.max(0, headers - blocks) : 0;
  const synced = !ibd && lag === 0 && status?.sync_stalled !== true;
  const peerCount = Math.max(
    network.data?.connections ?? 0,
    peers.data?.length ?? 0,
  );
  const networkStats = buildNetworkStats(explorerStats.data, mining.data);
  const avgBlockTimeMin = averageBlockTimeMinutes(explorerBlocks.data);
  const networkKhm = networkStats?.networkHash
    ? networkHashToKhm(networkStats.networkHash)
    : null;
  const localHash = mining.data?.hashrate ?? 0;
  const share = networkSharePercent(localHash, networkStats?.networkHash);
  const explorerHeight = explorerStats.data?.height;
  const heightDelta =
    blocks != null && explorerHeight != null
      ? blocks - explorerHeight
      : undefined;
  const active = minerState.data?.active ?? false;
  const immature = wallet.data?.immature_balance ?? 0;

  useEffect(() => {
    if (blocks != null) prevHeight.current = blocks;
  }, [blocks]);

  useEffect(() => {
    const id = window.setInterval(
      () => setAgeTick((n) => n + 1),
      BLOCK_AGE_TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const heightTick =
    blocks != null && prevHeight.current != null && blocks > prevHeight.current;

  const tipBlock = resolveTipBlock(explorerBlocks.data, blocks);
  const latestBlockAge =
    tipBlock?.time != null ? formatBlockAge(tipBlock.time, ageTick) : null;

  const syncLabel = synced
    ? "Fully synced"
    : ibd
      ? "Syncing chain"
      : lag > 0
        ? "Catching up"
        : "Syncing";

  const syncDetail = synced
    ? undefined
    : lag > 0
      ? `${formatNumber(lag)} blocks behind headers`
      : `${formatPercent(progress, 0)} verified`;

  const explorerDeltaLabel =
    heightDelta === undefined
      ? null
      : heightDelta === 0
        ? "Matches explorer"
        : heightDelta > 0
          ? `+${heightDelta} vs explorer`
          : `${heightDelta} vs explorer`;

  const miningValue = active
    ? `${formatNumber(localHash, 0)} H/m`
    : localHash > 0
      ? `${formatNumber(localHash, 0)} H/m idle`
      : "Idle";

  const walletHint =
    immature > 0
      ? `${formatVrm(immature, 4)} immature`
      : share != null && localHash > 0
        ? `${formatNumber(share, 2)}% network share`
        : undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-b from-bg-panel/40 to-bg-subtle/80">
      {/* Status ribbon */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2 text-sm">
          <StatusDot synced={synced} />
          <span className="font-medium text-fg">{syncLabel}</span>
          {syncDetail && (
            <span className="text-fg-muted">{syncDetail}</span>
          )}
        </div>

        {!synced && (
          <div className="flex min-w-[8rem] flex-1 items-center gap-2 sm:max-w-xs">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-panel">
              <div
                className="h-full rounded-full bg-warning transition-all duration-500"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-fg-subtle">
              {formatPercent(progress, 0)}
            </span>
          </div>
        )}

        <MetaDivider />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="rounded-md bg-bg-panel/80 px-2 py-0.5 font-medium text-fg">
            Mainnet
          </span>
          {explorerDeltaLabel && (
            <>
              <MetaDivider />
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium",
                  heightDelta === 0 || (heightDelta != null && heightDelta > 0)
                    ? "bg-success/10 text-success"
                    : "bg-warning/10 text-warning",
                )}
              >
                {explorerDeltaLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Hero + quick actions */}
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            <span>Latest block</span>
            {latestBlockAge != null && (
              <span className="normal-case tracking-normal text-fg-muted">
                · {latestBlockAge}
              </span>
            )}
            {heightTick && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                New block
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight text-fg sm:text-[2.75rem] sm:leading-none">
              {blocks != null ? formatNumber(blocks) : "—"}
            </span>
          </div>

          {blockchain.data?.bestblockhash && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded-md border border-border/70 bg-bg-panel/50 px-2.5 py-1 font-mono text-xs text-fg-muted">
                {blockchain.data.bestblockhash.slice(0, 20)}…
              </code>
              <ExplorerLink
                target={{
                  kind: "block",
                  hashOrHeight: blockchain.data.bestblockhash,
                }}
                label="View block"
                className="rounded-md border border-border/70 bg-bg-panel/50 px-2 py-1 hover:border-border-strong hover:bg-bg-panel hover:text-accent"
                showIcon
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:gap-2.5">
          <QuickTile
            to="/mining"
            icon={Pickaxe}
            label="Mining"
            value={miningValue}
            hint={active ? "Active" : undefined}
            active={active}
          />
          <QuickTile
            to="/wallet"
            icon={Wallet}
            label="Available"
            value={wallet.data ? formatVrm(wallet.data.balance, 4) : "—"}
            hint={walletHint}
          />
          <QuickTile
            to="/network"
            icon={Users}
            label="Peers"
            value={formatNumber(peerCount)}
            hint={
              peerCount === 0
                ? "No connections"
                : peerCount === 1
                  ? "1 connection"
                  : `${peerCount} connections`
            }
          />
        </div>
      </div>

      {/* Network metrics */}
      <div className="grid grid-cols-2 divide-y divide-border/70 border-t border-border/70 bg-bg-panel/30 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0 lg:divide-x">
        <MetricCell
          label="Network Hashrate"
          value={
            networkKhm != null ? `${formatNumber(networkKhm, 1)} kH/m` : "—"
          }
        />
        <MetricCell
          label="Difficulty"
          value={mining.data ? formatNumber(mining.data.difficulty, 4) : "—"}
        />
        <MetricCell
          label="Avg. Block time"
          value={
            avgBlockTimeMin != null
              ? `${formatNumber(avgBlockTimeMin, 1)} min`
              : networkStats?.blockTimeMin
                ? `${formatNumber(networkStats.blockTimeMin, 1)} min`
                : "—"
          }
        />
        <MetricCell
          label="VRM price"
          value={
            explorerStats.data?.price_usd != null
              ? `$${formatNumber(explorerStats.data.price_usd, 4)}`
              : "—"
          }
        />
        <MetricCell
          label="Mempool"
          value={
            explorerStats.data?.pooled_tx != null
              ? formatNumber(explorerStats.data.pooled_tx, 0)
              : mining.data
                ? formatNumber(mining.data.pooledtx, 0)
                : "—"
          }
        />
        <MetricCell
          label="Hashrate Share"
          value={
            share != null && localHash > 0
              ? `${formatNumber(share, 2)}%`
              : localHash > 0
                ? "<0.01%"
                : "—"
          }
          className="col-span-2 sm:col-span-1"
        />
      </div>
    </div>
  );
}
