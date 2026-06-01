import { type ReactNode } from "react";
import { Clock3, Coins, Cpu, Loader2, Users, Wallet } from "lucide-react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { AnimatedBlockNumber } from "@/components/AnimatedBlockNumber";
import {
  getCoinProfile,
  type CoinId,
  type CoinProfile,
} from "@/lib/coin/profile";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  heroStatusPillLabel,
  heroStatusPillShowsPulse,
} from "@/lib/node/dashboard-activity";
import {
  networkHashToKhm,
  resolveBlockTimeMinutes,
} from "@/lib/mining-revenue";
import {
  networkCoinsStakingPercent,
  mergeStakingNetworkKpis,
} from "@/lib/staking-stats";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { AnimatedHashrate } from "@/components/AnimatedHashrate";
import { cn, formatNumber } from "@/lib/utils";
import { formatCoinAmount } from "@/lib/units";

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
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm",
        tone === "success" &&
          "border-success/25 bg-success/10 text-success ring-1 ring-success/10",
        tone === "accent" &&
          "border-accent/25 bg-accent/10 text-accent ring-1 ring-accent/10",
        tone === "neutral" && "border-border/80 bg-bg-subtle/80 text-fg-muted",
      )}
    >
      {loading && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      )}
      {children}
    </div>
  );
}

function HeroBlockHeight({
  coin,
  localBlocks,
  blockHashOrHeight,
  activityLoading,
  connected,
}: {
  coin: CoinId;
  localBlocks?: number;
  blockHashOrHeight?: string | number;
  activityLoading: boolean;
  connected: boolean;
}) {
  const showPlaceholder = activityLoading && localBlocks == null;
  const canLink = connected && localBlocks != null && blockHashOrHeight != null;

  return (
    <div
      className={cn(
        "text-[clamp(1.875rem,2.5vw+1rem,3rem)] font-bold tabular-nums tracking-tight",
        showPlaceholder ? "text-fg-muted" : "text-fg",
      )}
    >
      {showPlaceholder ? (
        <span className="inline-flex items-center gap-2">
          <Loader2
            className="h-9 w-9 animate-spin text-accent/80 md:h-10 md:w-10"
            aria-hidden
          />
        </span>
      ) : canLink ? (
        <ExplorerLink
          coin={coin}
          target={{ kind: "block", hashOrHeight: blockHashOrHeight }}
          label={
            <AnimatedBlockNumber
              value={localBlocks}
              className="text-[clamp(1.875rem,2.5vw+1rem,3rem)] font-bold tracking-tight"
            />
          }
          showIcon={false}
          title="View block on explorer"
          className="rounded-sm text-[clamp(1.875rem,2.5vw+1rem,3rem)] font-bold tabular-nums tracking-tight text-fg no-underline transition-colors hover:text-accent hover:underline"
        />
      ) : connected && localBlocks != null ? (
        <AnimatedBlockNumber
          value={localBlocks}
          className="text-[clamp(1.875rem,2.5vw+1rem,3rem)] font-bold tracking-tight"
        />
      ) : (
        "—"
      )}
    </div>
  );
}

function SyncProgressBar({
  localBlocks,
  syncTarget,
  behind,
}: {
  localBlocks?: number;
  syncTarget: number;
  behind?: number | null;
}) {
  const progress =
    localBlocks != null && syncTarget > 0
      ? Math.min(100, Math.round((localBlocks / syncTarget) * 100))
      : 0;

  return (
    <div className="mt-3 w-full max-w-sm min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3 text-[11px] text-fg-muted">
        <span>
          of ~{formatNumber(syncTarget)} network tip
          {behind != null && behind > 0 && (
            <> · ~{formatNumber(behind, 0)} blocks behind</>
          )}
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-fg-muted">
          {progress}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border/80"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Chain sync progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  compactLabel,
  value,
  sub,
  subClassName,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  compactLabel?: string;
  value: ReactNode;
  sub?: string;
  subClassName?: string;
  active?: boolean;
}) {
  const narrowLabel = compactLabel ?? label;

  return (
    <div
      className={cn(
        "@container/stat group flex min-w-0 items-stretch gap-2 overflow-hidden rounded-xl border p-2 transition-all duration-200 @[11rem]/stat:gap-2.5 @[11rem]/stat:p-2.5 sm:p-3",
        active
          ? "border-success/30 bg-gradient-to-br from-success/[0.08] to-bg-subtle/40 shadow-sm shadow-success/5"
          : "border-border/70 bg-gradient-to-br from-bg-subtle/50 to-bg-subtle/20 hover:border-border-strong hover:from-bg-subtle/70",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5 @[11rem]/stat:h-9 @[11rem]/stat:w-9 @[11rem]/stat:[&>svg]:h-4 @[11rem]/stat:[&>svg]:w-4",
          active
            ? "bg-success/15 text-success ring-1 ring-inset ring-success/25"
            : "bg-bg-panel/80 text-fg-muted ring-1 ring-inset ring-border/60 group-hover:ring-border-strong",
        )}
      >
        {icon}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
        <div
          className="truncate text-[9px] font-semibold uppercase leading-none tracking-wide text-fg-subtle @[11rem]/stat:text-[10px] @[14rem]/stat:text-[11px]"
          title={label}
        >
          <span className="@[11rem]/stat:hidden">{narrowLabel}</span>
          <span className="hidden @[11rem]/stat:inline">{label}</span>
        </div>

        <div
          className="truncate font-semibold tabular-nums leading-tight tracking-tight text-[clamp(0.6875rem,5.5cqi,1.0625rem)] text-fg"
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </div>

        {sub ? (
          <div
            className={cn(
              "truncate text-[9px] leading-tight text-fg-subtle @[11rem]/stat:text-[10px]",
              subClassName,
            )}
            title={sub}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NetworkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-1 py-0.5 sm:px-2 lg:border-l lg:border-border/50 lg:first:border-l-0">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}

function HeroSummaryLayout({
  coin,
  profile,
  statusRow,
  tipHeight,
  tipHash,
  localBlocks,
  blockAge,
  activity,
  connected,
  synced,
  syncTarget,
  behind,
  statBoxes,
  networkMetrics,
}: {
  coin: CoinId;
  profile: CoinProfile;
  statusRow: ReactNode;
  tipHeight?: number;
  tipHash?: string;
  localBlocks?: number;
  blockAge: string;
  activity: ReturnType<typeof useDashboardData>["activity"];
  connected: boolean;
  synced: boolean;
  syncTarget?: number;
  behind?: number | null;
  statBoxes: ReactNode;
  networkMetrics: ReactNode;
}) {
  const showSyncProgress =
    !synced &&
    syncTarget != null &&
    syncTarget > (localBlocks ?? 0) &&
    localBlocks != null;

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-bg-panel shadow-sm">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-accent/[0.05] blur-3xl"
        aria-hidden
      />

      <div className="relative min-w-0 p-4 sm:p-5 md:p-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
          {statusRow}
        </div>

        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:mt-5 md:grid-cols-[minmax(0,1.15fr)_minmax(220px,1fr)] md:items-stretch md:gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.95fr)] lg:gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,420px)] xl:gap-8">
          <div className="min-w-0 rounded-xl border border-border/60 bg-gradient-to-br from-bg-subtle/40 via-bg-subtle/20 to-transparent p-3 sm:p-4 md:p-5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Latest block
              </span>
              {synced && connected && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  <span className="truncate">Wallet Synced to Network</span>
                </span>
              )}
            </div>

            <div className="mt-2 min-w-0">
              <HeroBlockHeight
                coin={coin}
                localBlocks={tipHeight}
                blockHashOrHeight={tipHash ?? tipHeight}
                activityLoading={activity.showSpinner}
                connected={connected}
              />
            </div>

            {blockAge !== "—" && (
              <p className="mt-2 inline-flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-fg-muted">
                <Clock3
                  className="h-3.5 w-3.5 shrink-0 opacity-70"
                  aria-hidden
                />
                <span>
                  Mined <span className="font-medium text-fg">{blockAge}</span>{" "}
                  ago
                </span>
              </p>
            )}

            {activity.kind !== "ready" && (
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                {activity.title}
              </p>
            )}

            {showSyncProgress && (
              <SyncProgressBar
                localBlocks={localBlocks}
                syncTarget={syncTarget}
                behind={behind}
              />
            )}
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5 md:grid-cols-1 md:gap-2.5">
            {statBoxes}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-border/60 bg-bg-subtle/25 px-4 py-4 sm:px-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            {profile.displayName} network
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            {networkMetrics}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildHeroStatusRow(
  data: ReturnType<typeof useDashboardData>,
  explorerEnabled: boolean,
): ReactNode {
  const { activity, synced, blockchain, localBlocks, networkTip } = data;
  const heightDelta =
    localBlocks != null && networkTip != null
      ? localBlocks - networkTip
      : undefined;
  const matchesExplorer = heightDelta != null && Math.abs(heightDelta) <= 1;
  const pillLoading = heroStatusPillShowsPulse(activity);
  const pillTone = synced && activity.kind === "ready" ? "success" : "accent";

  return (
    <>
      <StatusPill tone={pillTone} loading={pillLoading}>
        {synced && activity.kind === "ready" && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
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
    </>
  );
}

function VeriumSummaryCard() {
  const coin = "verium" as const;
  const profile = getCoinProfile(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const data = useDashboardData(coin);
  const statusRow = buildHeroStatusRow(data, explorerEnabled);

  const localHashrate = data.mining.data?.hashrate ?? 0;
  const networkHashKhm =
    data.explorer.data?.network_hash != null
      ? networkHashToKhm(data.explorer.data.network_hash)
      : data.mining.data?.networkhashps != null
        ? networkHashToKhm(data.mining.data.networkhashps)
        : null;
  const difficultyValue =
    data.explorer.data?.difficulty ??
    data.blockchain.data?.difficulty ??
    data.mining.data?.difficulty;
  const blockTimeMin = resolveBlockTimeMinutes(
    data.explorer.data,
    data.mining.data,
  );
  const mempool =
    data.mining.data?.pooledtx ?? data.explorer.data?.pooled_tx;

  return (
    <HeroSummaryLayout
      coin={coin}
      profile={profile}
      statusRow={statusRow}
      tipHeight={data.tipHeight}
      tipHash={data.tipHash}
      localBlocks={data.localBlocks}
      blockAge={data.blockAge}
      activity={data.activity}
      connected={data.connected}
      synced={data.synced}
      syncTarget={data.syncTarget}
      behind={data.behind}
      statBoxes={
        <>
          <StatBox
            icon={<Cpu />}
            label="Mining"
            value={
              <AnimatedHashrate
                value={localHashrate > 0 ? localHashrate : undefined}
                fractionDigits={0}
                className="font-semibold text-fg"
              />
            }
            sub={data.minerActive ? "On" : "Off"}
            subClassName={
              data.minerActive ? "font-semibold text-success" : undefined
            }
            active={data.minerActive}
          />
          <StatBox
            icon={<Wallet />}
            label="Available"
            compactLabel="Avail."
            value={
              data.wallet.data
                ? formatCoinAmount(data.wallet.data.balance, coin, 4)
                : "—"
            }
            sub={
              data.wallet.data && data.wallet.data.immature_balance > 0
                ? `${formatCoinAmount(data.wallet.data.immature_balance, coin, 2)} imm.`
                : undefined
            }
          />
          <div className="sm:col-span-2 md:col-span-1">
            <StatBox
              icon={<Users />}
              label="Peers"
              value={formatNumber(data.connections, 0)}
              sub={
                data.connections > 0
                  ? "Online"
                  : data.connected
                    ? "No peers"
                    : "Offline"
              }
            />
          </div>
        </>
      }
      networkMetrics={
        <>
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
              difficultyValue != null
                ? difficultyValue >= 0.0001
                  ? formatNumber(difficultyValue, 4)
                  : formatNumber(difficultyValue, 6)
                : "—"
            }
          />
          <NetworkMetric
            label="Avg. block time"
            value={
              blockTimeMin != null
                ? `${formatNumber(blockTimeMin, 1)} min`
                : "—"
            }
          />
          <NetworkMetric label="Last block" value={data.blockAge} />
          <NetworkMetric
            label={`${profile.symbol} price`}
            value={
              data.explorer.data?.price_usd != null
                ? `$${formatNumber(data.explorer.data.price_usd, 4)}`
                : "—"
            }
          />
          <NetworkMetric
            label="Mempool"
            value={mempool != null ? formatNumber(mempool, 0) : "—"}
          />
        </>
      }
    />
  );
}

function VericoinSummaryCard() {
  const coin = "vericoin" as const;
  const profile = getCoinProfile(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const data = useDashboardData(coin);
  const statusRow = buildHeroStatusRow(data, explorerEnabled);

  const stakingActive = data.stakingState.data?.active ?? false;
  const vrcNetwork = mergeStakingNetworkKpis(
    data.vrcMining.data,
    data.explorer.data,
  );
  const networkStakePct = networkCoinsStakingPercent(vrcNetwork.netStakeWeight);
  const mempool = data.vrcMining.data?.pooledtx ?? data.explorer.data?.pooled_tx;
  const posDifficulty =
    vrcNetwork.posDifficulty ?? data.blockchain.data?.difficulty;

  return (
    <HeroSummaryLayout
      coin={coin}
      profile={profile}
      statusRow={statusRow}
      tipHeight={data.tipHeight}
      tipHash={data.tipHash}
      localBlocks={data.localBlocks}
      blockAge={data.blockAge}
      activity={data.activity}
      connected={data.connected}
      synced={data.synced}
      syncTarget={data.syncTarget}
      behind={data.behind}
      statBoxes={
        <>
          <StatBox
            icon={<Coins />}
            label="Staking"
            value={
              data.wallet.data
                ? formatCoinAmount(data.wallet.data.stake ?? 0, coin, 4)
                : "—"
            }
            sub={stakingActive ? "On" : "Off"}
            subClassName={
              stakingActive ? "font-semibold text-success" : undefined
            }
            active={stakingActive}
          />
          <StatBox
            icon={<Wallet />}
            label="Available"
            compactLabel="Avail."
            value={
              data.wallet.data
                ? formatCoinAmount(data.wallet.data.balance, coin, 4)
                : "—"
            }
            sub={
              data.wallet.data && data.wallet.data.unconfirmed_balance > 0
                ? `${formatCoinAmount(data.wallet.data.unconfirmed_balance, coin, 2)} unconf.`
                : undefined
            }
          />
          <div className="sm:col-span-2 md:col-span-1">
            <StatBox
              icon={<Users />}
              label="Peers"
              value={formatNumber(data.connections, 0)}
              sub={
                data.connections > 0
                  ? "Online"
                  : data.connected
                    ? "No peers"
                    : "Offline"
              }
            />
          </div>
        </>
      }
      networkMetrics={
        <>
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
          <NetworkMetric label="Last block" value={data.blockAge} />
          <NetworkMetric
            label={`${profile.symbol} price`}
            value={
              data.explorer.data?.price_usd != null
                ? `$${formatNumber(data.explorer.data.price_usd, 4)}`
                : "—"
            }
          />
          <NetworkMetric
            label="Mempool"
            value={mempool != null ? formatNumber(mempool, 0) : "—"}
          />
        </>
      }
    />
  );
}

export function DashboardHero({ coin }: { coin: CoinId }) {
  if (coin === "verium") {
    return <VeriumSummaryCard />;
  }
  return <VericoinSummaryCard />;
}
