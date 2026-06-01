import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ExplorerMarketCard } from "@/components/ExplorerMarketCard";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import { coinQueryKey, getCoinProfile } from "@/lib/coin/profile";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  playStakeRewardSound,
  unlockBlockMinedAudio,
} from "@/lib/block-mined-sound";
import {
  clearStakingStoppedByUser,
  markStakingStoppedByUser,
} from "@/hooks/useAutoStake";
import {
  rpcGetBlockchainInfo,
  rpcGetStakingState,
  rpcGetVericoinMiningInfo,
  rpcGetWalletInfo,
  rpcStakingStart,
  rpcStakingStop,
} from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import {
  formatSessionDuration,
  mergeStakingNetworkKpis,
  networkCoinsStakingPercent,
  walletStakeSharePercent,
} from "@/lib/staking-stats";
import { cn, formatNumber } from "@/lib/utils";

const VERICOIN = "vericoin" as const;
const profile = getCoinProfile(VERICOIN);

function BalanceCard({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <Card className={cn(muted && "opacity-90")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium normal-case text-fg-muted">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export function Staking() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const sessionTick = useRef(0);
  const [, forceTick] = useState(0);

  const visible = useWindowVisible();
  const stakingState = useQuery({
    queryKey: coinQueryKey(VERICOIN, "get_staking_state"),
    queryFn: () => rpcGetStakingState(VERICOIN),
    refetchInterval: visible ? 4_000 : false,
  });
  const miningInfo = useQuery({
    queryKey: coinQueryKey(VERICOIN, "getmininginfo"),
    queryFn: () => rpcGetVericoinMiningInfo(),
    refetchInterval: visible ? 10_000 : false,
  });
  const blockchain = useQuery({
    queryKey: coinQueryKey(VERICOIN, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(VERICOIN),
    refetchInterval: visible ? 10_000 : false,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(VERICOIN, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(VERICOIN),
    refetchInterval: visible ? 10_000 : false,
  });
  const daemonStatus = useDaemonStatus(VERICOIN);
  const explorerEnabled = useExplorerQueriesEnabled();
  const explorerStats = useQuery({
    queryKey: coinQueryKey(VERICOIN, "explorer-stats"),
    queryFn: () => fetchExplorerStats(VERICOIN),
    enabled: explorerEnabled,
    refetchInterval: visible ? 30_000 : false,
    retry: 0,
  });

  useEffect(() => {
    if (!stakingState.data?.active || !visible) return;
    const id = window.setInterval(() => {
      sessionTick.current += 1;
      forceTick(sessionTick.current);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [stakingState.data?.active, visible]);

  const start = useMutation({
    mutationFn: () => rpcStakingStart(VERICOIN),
    onSuccess: (state) => {
      clearStakingStoppedByUser();
      queryClient.setQueryData(
        coinQueryKey(VERICOIN, "get_staking_state"),
        state,
      );
    },
  });
  const stop = useMutation({
    mutationFn: () => rpcStakingStop(VERICOIN),
    onSuccess: (state) => {
      markStakingStoppedByUser();
      queryClient.setQueryData(
        coinQueryKey(VERICOIN, "get_staking_state"),
        state,
      );
    },
  });

  const ibd = blockchain.data?.initialblockdownload;
  const syncStalled = daemonStatus.data?.sync_stalled === true;
  const active = stakingState.data?.active ?? false;
  const stake = wallet.data?.stake ?? 0;
  const newmint = wallet.data?.newmint ?? 0;
  const available = wallet.data?.balance ?? 0;
  const unconfirmed = wallet.data?.unconfirmed_balance ?? 0;
  const immature = wallet.data?.immature_balance ?? 0;
  const total = available + unconfirmed + stake + immature;

  const network = mergeStakingNetworkKpis(miningInfo.data, explorerStats.data);
  const interestRate = network.interestRate;
  const inflationRate = network.inflationRate;
  const networkStakePct = networkCoinsStakingPercent(network.netStakeWeight);
  const walletStakeWeight =
    miningInfo.data?.stakeweight?.combined ?? (stake > 0 ? stake : undefined);
  const stakeShare = walletStakeSharePercent(
    walletStakeWeight,
    network.netStakeWeight,
  );

  return (
    <WalletUnlockGate
      title="Unlock to stake"
      description="Enter your wallet passphrase to enable Vericoin staking."
      mintingOnly
    >
      <div className="flex flex-col gap-4">
        {syncStalled && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            Sync is stalled — check the banner at the top of the app.
          </div>
        )}
        {ibd && !syncStalled && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Staking is disabled while the node is syncing (
            {blockchain.data?.blocks?.toLocaleString() ?? "…"} blocks).
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <BalanceCard
            label="Available"
            value={formatCoinAmount(available, VERICOIN, 4)}
          />
          <BalanceCard
            label="Unconfirmed"
            value={formatCoinAmount(unconfirmed, VERICOIN, 4)}
          />
          <BalanceCard
            label="Staking"
            value={formatCoinAmount(stake, VERICOIN, 4)}
          />
          <BalanceCard
            label="Total"
            value={formatCoinAmount(total, VERICOIN, 4)}
          />
        </div>

        <Card className="relative">
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Staking process
              </CardTitle>
              <CardDescription>
                Proof-of-stake minting for {profile.displayName}. Requires mature
                coins and an unlocked wallet.
              </CardDescription>
            </div>
            {active ? (
              <Badge tone="success">Staking</Badge>
            ) : (
              <Badge tone="neutral">Stopped</Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-[4.75rem]">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={prefs.auto_stake_on_open === true}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked) clearStakingStoppedByUser();
                  void updatePrefs({ auto_stake_on_open: checked });
                }}
                className="h-3.5 w-3.5 rounded accent-accent"
              />
              Auto-stake on open
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={prefs.play_sound_on_stake_reward === true}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void unlockBlockMinedAudio();
                  void updatePrefs({ play_sound_on_stake_reward: checked });
                  if (checked) void playStakeRewardSound();
                }}
                className="h-3.5 w-3.5 rounded accent-accent"
              />
              Play chime on stake reward
            </label>
            {(start.error || stop.error) && (
              <div className="max-w-[calc(100%-12rem)] text-xs text-danger">
                {String(start.error ?? stop.error)}
              </div>
            )}
          </CardContent>
          <div className="absolute bottom-5 right-5">
            {active ? (
              <Button
                variant="danger"
                size="lg"
                onClick={() => stop.mutate()}
                disabled={stop.isPending}
                className="h-12 min-w-[11.5rem] px-8 text-base font-semibold shadow-md"
              >
                {stop.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Stopping…
                  </>
                ) : (
                  "Stop staking"
                )}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => start.mutate()}
                disabled={start.isPending || ibd || syncStalled}
                className="h-12 min-w-[11.5rem] px-8 text-base font-semibold shadow-md"
              >
                {start.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  "Start staking"
                )}
              </Button>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Interest rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {interestRate != null ? `${formatNumber(interestRate, 2)}%` : "—"}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                Current PoS reward rate
                {network.source === "explorer" && " · explorer"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Inflation rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {inflationRate != null
                  ? `${formatNumber(inflationRate, 2)}%`
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                Network staking inflation
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Network coins stake</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {networkStakePct != null
                  ? `${formatNumber(networkStakePct, 2)}%`
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                Of supply actively staking
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your stake weight</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {formatCoinAmount(stake, VERICOIN, 4)}
              </div>
              {newmint > 0 && (
                <div className="mt-1 text-xs text-fg-subtle">
                  New mint {formatCoinAmount(newmint, VERICOIN, 4)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {stakeShare != null && stakeShare > 0 && (
          <div className="rounded-lg border border-border bg-bg-subtle/50 px-4 py-3">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-fg-muted">Your network stake share</span>
              <span className="font-semibold tabular-nums">
                {formatNumber(stakeShare, 4)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-panel">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.min(100, stakeShare)}%` }}
              />
            </div>
          </div>
        )}

        {active && stakingState.data?.started_at && (
          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <div>
                <div className="text-xs text-fg-subtle">Uptime</div>
                <div className="font-semibold tabular-nums">
                  {formatSessionDuration(stakingState.data.started_at)}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle">Status</div>
                <div className="font-semibold text-success">Staking active</div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle">Expected stake time</div>
                <div className="font-semibold tabular-nums">
                  {wallet.data?.staketime != null && wallet.data.staketime > 0
                    ? `~${formatNumber(wallet.data.staketime, 0)}s`
                    : "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {immature > 0 && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            Pending from recent stakes:{" "}
            <strong>{formatCoinAmount(immature, VERICOIN, 4)}</strong> (immature)
          </div>
        )}

        <ExplorerMarketCard coin={VERICOIN} />

        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Network reference
              </CardTitle>
              <CardDescription>
                Live staking stats from your node and the official VRC explorer.
              </CardDescription>
            </div>
            <ExplorerLink
              coin={VERICOIN}
              target={{ kind: "home" }}
              label="Open VRC explorer"
            />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs text-fg-subtle">PoS difficulty</div>
              <div className="font-semibold tabular-nums">
                {network.posDifficulty != null
                  ? formatNumber(network.posDifficulty, 4)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Blocks per hour</div>
              <div className="font-semibold tabular-nums">
                {network.blocksPerHour != null
                  ? formatNumber(network.blocksPerHour, 2)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-subtle">Network staked</div>
              <div className="font-semibold tabular-nums">
                {networkCoinsStakingPercent(network.netStakeWeight) != null
                  ? `${formatNumber(networkCoinsStakingPercent(network.netStakeWeight)!, 2)}%`
                  : "—"}
              </div>
            </div>
            {network.supply != null && (
              <div>
                <div className="text-xs text-fg-subtle">Circulating supply</div>
                <div className="font-semibold tabular-nums">
                  {formatNumber(network.supply, 2)} VRC
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </WalletUnlockGate>
  );
}
