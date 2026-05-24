import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { MiningProfitCard } from "@/components/MiningProfitCard";
import { RevenuePeriodToggle } from "@/components/RevenuePeriodToggle";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import { EXPLORER_PROFITABILITY } from "@/lib/verium-links";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useUserPreferences } from "@/lib/user-preferences";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import {
  buildNetworkStats,
  estimateDailyMining,
  estimateHoursPerBlock,
  formatSessionDuration,
  networkHashToKhm,
  networkSharePercent,
  revenuePeriodLabel,
  scaleDailyValue,
  type RevenuePeriod,
} from "@/lib/mining-revenue";
import {
  fetchCpuTopology,
  maxMiningThreads,
  optimizedMiningThreads,
  resolveMiningThreads,
} from "@/lib/mining-opt";
import { MiningThreadControls } from "@/components/MiningThreadControls";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetWalletInfo,
  rpcMinerStart,
  rpcMinerStop,
} from "@/lib/rpc/client";
import { formatNumber, formatVrm } from "@/lib/utils";
import {
  playBlockMinedSound,
  unlockBlockMinedAudio,
} from "@/lib/block-mined-sound";
import {
  clearMiningStoppedByUser,
  markMiningStoppedByUser,
} from "@/lib/mining-session";
import { isMinerBooting, miningInfoRefetchMs } from "@/lib/mining-boot";
import {
  MinerBootBadge,
  MinerHashrateDisplay,
} from "@/components/MinerBootIndicator";

interface HashSample {
  t: number;
  hashrate: number;
}

const MAX_SAMPLES = 60;
const SAMPLE_MIN_MS = 5_000;

export function Mining() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const topology = useQuery({
    queryKey: ["cpu-topology"],
    queryFn: fetchCpuTopology,
    staleTime: 60_000,
  });
  const autoAdjustThreads = prefs.auto_adjust_mine_threads !== false;
  const miningThreads = resolveMiningThreads(
    topology.data,
    autoAdjustThreads,
    prefs.auto_mine_threads ?? 2,
  );
  const suggestedThreads = optimizedMiningThreads(topology.data);
  const maxThreads = maxMiningThreads(topology.data);
  const logicalCpus = topology.data?.logicalCpus;
  const [samples, setSamples] = useState<HashSample[]>([]);
  const [revenuePeriod, setRevenuePeriod] = useState<RevenuePeriod>("day");
  const lastSampleRef = useRef<{ t: number; hr: number } | null>(null);

  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: 4_000,
  });
  const minerActive = minerState.data?.active ?? false;
  const minerStartedAt = minerState.data?.started_at;

  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: (query) => {
      const hr = query.state.data?.hashrate ?? 0;
      return miningInfoRefetchMs(minerActive, hr, minerStartedAt, 4_000);
    },
  });
  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 10_000,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });
  const daemonStatus = useDaemonStatus(coin);
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  const explorerStats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled.data === true,
    refetchInterval: 30_000,
    retry: 0,
  });

  useEffect(() => {
    if (!mining.data) return;
    const hr = mining.data.hashrate;
    const now = Date.now();
    const last = lastSampleRef.current;
    if (last && hr === last.hr && now - last.t < SAMPLE_MIN_MS) {
      return;
    }
    lastSampleRef.current = { t: now, hr };
    setSamples((prev) =>
      [...prev, { t: now, hashrate: hr }].slice(-MAX_SAMPLES),
    );
  }, [mining.data]);

  useEffect(() => {
    if (!topology.data) return;
    const max = maxMiningThreads(topology.data);
    const current = prefs.auto_mine_threads ?? 2;
    if (current > max) {
      void updatePrefs({ auto_mine_threads: max });
    }
  }, [topology.data, prefs.auto_mine_threads, updatePrefs]);

  const handleAutoAdjustChange = (checked: boolean) => {
    const updates: Partial<typeof prefs> = {
      auto_adjust_mine_threads: checked,
    };
    if (!checked && topology.data) {
      updates.auto_mine_threads = optimizedMiningThreads(topology.data);
    }
    void updatePrefs(updates);
  };

  const start = useMutation({
    mutationFn: () => rpcMinerStart(coin, miningThreads),
    onSuccess: (state) => {
      clearMiningStoppedByUser();
      queryClient.setQueryData(coinQueryKey(coin, "get_miner_state"), state);
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "getmininginfo") });
    },
  });
  const stop = useMutation({
    mutationFn: () => rpcMinerStop(coin),
    onSuccess: (state) => {
      markMiningStoppedByUser();
      queryClient.setQueryData(coinQueryKey(coin, "get_miner_state"), state);
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "getmininginfo") });
    },
  });

  const ibd = blockchain.data?.initialblockdownload;
  const syncStalled = daemonStatus.data?.sync_stalled === true;
  const active = minerActive;
  const localHashrate = mining.data?.hashrate ?? 0;
  const minerBooting = isMinerBooting(
    active,
    localHashrate,
    minerStartedAt,
    start.isPending,
    stop.isPending,
  );
  const displayThreads =
    active && minerState.data ? minerState.data.threads : miningThreads;
  const networkStats = buildNetworkStats(explorerStats.data, mining.data);
  const networkHash = networkStats?.networkHash;
  const networkKhm =
    networkHash != null ? networkHashToKhm(networkHash) : undefined;
  const share = networkSharePercent(localHashrate, networkHash);
  const estBlockRate = estimateHoursPerBlock(localHashrate, networkStats);
  const dailyEstimate =
    networkStats && localHashrate > 0
      ? estimateDailyMining({
          localHashrateHm: localHashrate,
          networkHashrateHs: networkStats.networkHash!,
          blocksPerHour: networkStats.blocksPerHour!,
          blockReward: networkStats.blockReward!,
          priceUsd: networkStats.priceUsd,
          priceBtc: networkStats.priceBtc,
        })
      : null;

  const sessionAvg = useMemo(() => {
    const started = minerState.data?.started_at;
    if (!started) return null;
    const cutoff = started * 1000;
    const relevant = samples.filter((s) => s.t >= cutoff);
    if (relevant.length === 0) return localHashrate;
    return relevant.reduce((a, s) => a + s.hashrate, 0) / relevant.length;
  }, [samples, minerState.data?.started_at, localHashrate]);

  const immature = wallet.data?.immature_balance ?? 0;

  return (
    <WalletUnlockGate
      title="Unlock to mine"
      description="Enter your wallet passphrase to access mining controls and start the built-in CPU miner."
    >
      <div className="flex flex-col gap-4">
        {syncStalled && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            Sync is stalled — rebuild WSL veriumd from the banner at the top.
          </div>
        )}
        {ibd && !syncStalled && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Mining is disabled while the node is syncing (
            {blockchain.data?.blocks?.toLocaleString() ?? "…"} blocks).
          </div>
        )}

        {minerBooting && (
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-fg">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            <span>
              Miner is starting — spinning up {displayThreads} thread
              {displayThreads === 1 ? "" : "s"}. Hashrate should appear within a
              few seconds.
            </span>
          </div>
        )}

        <Card className="relative">
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>CPU miner</CardTitle>
            </div>
            <div className="flex flex-col items-end gap-2">
              {minerBooting || active ? (
                <MinerBootBadge
                  booting={minerBooting}
                  active={active}
                  activeLabel="Running"
                />
              ) : (
                <Badge tone="neutral">Stopped</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-[4.75rem]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={prefs.auto_mine_on_open === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) clearMiningStoppedByUser();
                    void updatePrefs({ auto_mine_on_open: checked });
                  }}
                  className="h-3.5 w-3.5 rounded accent-accent"
                />
                Auto-mine on open
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={prefs.play_sound_on_block_mined === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void unlockBlockMinedAudio();
                    void updatePrefs({ play_sound_on_block_mined: checked });
                    if (checked) void playBlockMinedSound();
                  }}
                  className="h-3.5 w-3.5 rounded accent-accent"
                />
                Play sound when block mined
              </label>
            </div>
            <MiningThreadControls
              autoAdjust={autoAdjustThreads}
              manualThreads={prefs.auto_mine_threads ?? 2}
              suggestedThreads={suggestedThreads}
              maxThreads={maxThreads}
              logicalCpus={logicalCpus}
              disabled={active || start.isPending || stop.isPending}
              onAutoAdjustChange={handleAutoAdjustChange}
              onManualThreadsChange={(threads) =>
                void updatePrefs({ auto_mine_threads: threads })
              }
            />
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
                  "Stop mining"
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
                  "Start mining"
                )}
              </Button>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Hashrate</CardTitle>
            </CardHeader>
            <CardContent>
              {minerBooting ? (
                <MinerHashrateDisplay
                  booting
                  value=""
                  className="text-2xl font-semibold"
                  spinnerClassName="h-6 w-6"
                />
              ) : (
                <div className="text-2xl font-semibold tabular-nums">
                  {mining.data ? formatNumber(mining.data.hashrate, 2) : "—"}{" "}
                  <span className="text-sm font-normal text-fg-subtle">H/m</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Network hashrate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {networkKhm != null ? formatNumber(networkKhm, 2) : "—"}{" "}
                <span className="text-sm font-normal text-fg-subtle">kH/m</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Difficulty</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {networkStats?.blockReward != null && mining.data
                  ? formatNumber(
                      networkStats.source === "explorer"
                        ? (explorerStats.data?.difficulty ??
                            mining.data.difficulty)
                        : mining.data.difficulty,
                      4,
                    )
                  : "—"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Est. next block</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {estBlockRate != null
                  ? `${formatNumber(estBlockRate, 1)} h`
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                reward{" "}
                {networkStats?.blockReward != null
                  ? formatNumber(networkStats.blockReward, 4)
                  : "—"}{" "}
                VRM
              </div>
            </CardContent>
          </Card>
        </div>

        {share != null && localHashrate > 0 && (
          <div className="rounded-lg border border-border bg-bg-subtle/50 px-4 py-3">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-fg-muted">Your network share</span>
              <span className="font-semibold tabular-nums">
                {formatNumber(share, 2)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-panel">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.min(100, share)}%` }}
              />
            </div>
          </div>
        )}

        {dailyEstimate && localHashrate > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-muted">
                Solo revenue estimates by period
              </p>
              <RevenuePeriodToggle
                value={revenuePeriod}
                onChange={setRevenuePeriod}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Estimated revenue (solo)</CardTitle>
                <CardDescription>
                  {networkStats?.source === "explorer"
                    ? "Live network stats from explorer."
                    : "Network stats from local node — USD/BTC need explorer prices."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase text-fg-subtle">
                      VRM / {revenuePeriodLabel(revenuePeriod)}
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {formatNumber(
                        scaleDailyValue(
                          dailyEstimate.vrmPerDay,
                          revenuePeriod,
                        ),
                        4,
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      ~
                      {formatNumber(
                        scaleDailyValue(
                          dailyEstimate.blocksPerDay,
                          revenuePeriod,
                        ),
                        3,
                      )}{" "}
                      blocks
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-fg-subtle">
                      USD / {revenuePeriodLabel(revenuePeriod)}
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {dailyEstimate.usdPerDay != null
                        ? `$${formatNumber(
                            scaleDailyValue(
                              dailyEstimate.usdPerDay,
                              revenuePeriod,
                            ),
                            4,
                          )}`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-fg-subtle">
                      BTC / {revenuePeriodLabel(revenuePeriod)}
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {dailyEstimate.btcPerDay != null
                        ? formatNumber(
                            scaleDailyValue(
                              dailyEstimate.btcPerDay,
                              revenuePeriod,
                            ),
                            8,
                          )
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-fg-subtle">
                      Est. block time
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {dailyEstimate.hoursPerBlock != null
                        ? `${formatNumber(dailyEstimate.hoursPerBlock, 1)} h`
                        : "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <MiningProfitCard
              dailyEstimate={dailyEstimate}
              period={revenuePeriod}
            />
          </>
        )}

        {active && minerState.data?.started_at && (
          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-fg-subtle">Uptime</div>
                <div className="font-semibold tabular-nums">
                  {formatSessionDuration(minerState.data.started_at)}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle">Avg hashrate</div>
                <div className="font-semibold tabular-nums">
                  {sessionAvg != null
                    ? `${formatNumber(sessionAvg, 0)} H/m`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle">Threads</div>
                <div className="font-semibold tabular-nums">
                  {minerState.data.threads}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {immature > 0 && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            Pending from recent blocks:{" "}
            <strong>{formatVrm(immature, 4)}</strong> (immature)
          </div>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Local hashrate over time</CardTitle>
              <CardDescription>Updated every few seconds.</CardDescription>
            </div>
            <ExplorerLink
              target={{ kind: "raw", url: EXPLORER_PROFITABILITY }}
              label="Profitability calculator"
            />
          </CardHeader>
          <CardContent className="h-64">
            {minerBooting && samples.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
                Waiting for first hashrate sample…
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={samples}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgb(var(--border))"
                />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t) => new Date(t).toLocaleTimeString()}
                  stroke="rgb(var(--fg-subtle))"
                  fontSize={11}
                />
                <YAxis stroke="rgb(var(--fg-subtle))" fontSize={11} />
                <Tooltip
                  labelFormatter={(t) =>
                    new Date(t as number).toLocaleTimeString()
                  }
                  contentStyle={{
                    backgroundColor: "rgb(var(--bg-panel))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                {sessionAvg != null && sessionAvg > 0 && (
                  <ReferenceLine
                    y={sessionAvg}
                    stroke="rgb(var(--fg-subtle))"
                    strokeDasharray="4 4"
                    label={{
                      value: "avg",
                      position: "insideTopRight",
                      fontSize: 10,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="hashrate"
                  stroke="rgb(var(--accent))"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </WalletUnlockGate>
  );
}
