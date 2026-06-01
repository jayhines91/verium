import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Cpu, Globe, Target } from "lucide-react";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import { MiningControlsCard } from "@/components/MiningControlsCard";
import { MiningEconomicsCard } from "@/components/MiningEconomicsCard";
import {
  MiningHashrateChart,
  type HashSample,
} from "@/components/MiningHashrateChart";
import { MiningHero } from "@/components/MiningHero";
import { MiningStatTile } from "@/components/MiningStatTile";
import { MiningStatusBanner } from "@/components/MiningStatusBanner";
import { MinerHashrateDisplay } from "@/components/MinerBootIndicator";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { useUserPreferences } from "@/lib/user-preferences";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useExplorerQueriesEnabled } from "@/lib/network-mode";
import {
  buildNetworkStats,
  effectiveMiningVrmPriceUsd,
  estimateDailyMining,
  estimateHoursPerBlock,
  networkHashToKhm,
  networkSharePercent,
  type RevenuePeriod,
} from "@/lib/mining-revenue";
import {
  fetchCpuTopology,
  maxMiningThreads,
  optimizedMiningThreads,
  resolveMiningThreads,
} from "@/lib/mining-opt";
import {
  miningRewardAddressForStart,
  staticMiningAddressConfigured,
  type MiningRewardAddressMode,
} from "@/lib/mining-reward-address";
import {
  rpcGetBlockchainInfo,
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetWalletInfo,
  rpcMinerStart,
  rpcMinerStop,
} from "@/lib/rpc/client";
import { formatNumber } from "@/lib/utils";
import {
  clearMiningStoppedByUser,
  markMiningStoppedByUser,
} from "@/lib/mining-session";
import { isChainSynced } from "@/lib/bootstrap-policy";
import {
  isMinerBooting,
  MINING_HASHRATE_POLL_MS,
  miningInfoRefetchMs,
} from "@/lib/mining-boot";

const MAX_SAMPLES = 60;
const SAMPLE_MIN_MS = MINING_HASHRATE_POLL_MS;

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

  const visible = useWindowVisible();
  const minerState = useQuery({
    queryKey: coinQueryKey(coin, "get_miner_state"),
    queryFn: () => rpcGetMinerState(coin),
    refetchInterval: visible ? 4_000 : false,
  });
  const minerActive = minerState.data?.active ?? false;
  const minerStartedAt = minerState.data?.started_at;

  const mining = useQuery({
    queryKey: coinQueryKey(coin, "getmininginfo"),
    queryFn: () => rpcGetMiningInfo(coin),
    refetchInterval: (query) => {
      if (!visible) return false;
      const hr = query.state.data?.hashrate ?? 0;
      return miningInfoRefetchMs(minerActive, hr, minerStartedAt);
    },
  });
  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: visible ? 10_000 : false,
  });
  const daemonStatus = useDaemonStatus(coin);
  const explorerEnabled = useExplorerQueriesEnabled();
  const explorerStats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled,
    refetchInterval: visible ? 30_000 : false,
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
    mutationFn: () => {
      if (
        prefs.mining_reward_address_mode === "static" &&
        !staticMiningAddressConfigured(prefs)
      ) {
        throw new Error(
          "Choose a wallet address for mining rewards before starting in static mode.",
        );
      }
      return rpcMinerStart(
        coin,
        miningThreads,
        miningRewardAddressForStart(prefs),
      );
    },
    onSuccess: (state) => {
      clearMiningStoppedByUser();
      queryClient.setQueryData(coinQueryKey(coin, "get_miner_state"), state);
      queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getmininginfo"),
      });
    },
  });
  const stop = useMutation({
    mutationFn: () => rpcMinerStop(coin),
    onSuccess: (state) => {
      markMiningStoppedByUser();
      queryClient.setQueryData(coinQueryKey(coin, "get_miner_state"), state);
      queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getmininginfo"),
      });
    },
  });

  const ibd = blockchain.data?.initialblockdownload;
  const syncStalled = daemonStatus.data?.sync_stalled === true;
  const networkTip = explorerStats.data?.height;
  const syncCtx = {
    connected: daemonStatus.data?.connected === true,
    syncStalled,
    networkTip,
  };
  const chainSynced = isChainSynced(blockchain.data, syncCtx);
  const syncTarget = blockchain.data
    ? Math.max(
        blockchain.data.headers ?? blockchain.data.blocks,
        networkTip ?? 0,
      )
    : networkTip;
  const blocksBehind =
    blockchain.data?.blocks != null && syncTarget != null
      ? Math.max(0, syncTarget - blockchain.data.blocks)
      : undefined;
  const active = minerActive;
  const localHashrate = mining.data?.hashrate ?? 0;
  const minerBooting = isMinerBooting(
    active,
    localHashrate,
    minerStartedAt,
    start.isPending,
    stop.isPending,
  );
  const live = active || minerBooting;
  const displayThreads =
    active && minerState.data ? minerState.data.threads : miningThreads;
  const networkStats = buildNetworkStats(explorerStats.data, mining.data);
  const networkHash = networkStats?.networkHash;
  const networkKhm =
    networkHash != null ? networkHashToKhm(networkHash) : undefined;
  const share = networkSharePercent(localHashrate, networkHash);
  const estBlockRate = estimateHoursPerBlock(localHashrate, networkStats);
  const marketPriceUsd = networkStats?.priceUsd;
  const revenuePriceUsd = effectiveMiningVrmPriceUsd(
    prefs.mining_vrm_price_usd,
    marketPriceUsd,
  );
  const usingCustomVrmPrice =
    prefs.mining_vrm_price_usd != null &&
    Number.isFinite(prefs.mining_vrm_price_usd) &&
    prefs.mining_vrm_price_usd > 0;
  const dailyEstimate =
    networkStats && localHashrate > 0
      ? estimateDailyMining({
          localHashrateHm: localHashrate,
          networkHashrateHs: networkStats.networkHash!,
          blocksPerHour: networkStats.blocksPerHour!,
          blockReward: networkStats.blockReward!,
          priceUsd: revenuePriceUsd,
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
  const staticAddressMissing =
    prefs.mining_reward_address_mode === "static" &&
    !staticMiningAddressConfigured(prefs);
  const controlsDisabled = active || start.isPending || stop.isPending;

  const difficulty =
    networkStats?.blockReward != null && mining.data
      ? formatNumber(
          networkStats.source === "explorer"
            ? (explorerStats.data?.difficulty ?? mining.data.difficulty)
            : mining.data.difficulty,
          7,
        )
      : "—";

  const chartProps = {
    samples,
    sessionAvg,
    sessionStartedAt: minerState.data?.started_at,
    minerBooting,
    active,
  };

  if (coin !== "verium") {
    return <Navigate to="/staking" replace />;
  }

  return (
    <WalletUnlockGate
      title="Unlock to mine"
      description="Enter your wallet passphrase to access mining controls and start the built-in CPU miner."
    >
      <div className="flex flex-col gap-4">
        <MiningStatusBanner
          syncStalled={syncStalled}
          chainSynced={chainSynced}
          ibd={ibd}
          localBlocks={blockchain.data?.blocks}
          syncTarget={syncTarget}
          blocksBehind={blocksBehind}
          immatureBalance={immature}
        />

        <MiningHero
          active={active}
          minerBooting={minerBooting}
          localHashrate={localHashrate}
          hashrateReady={mining.data != null}
          displayThreads={displayThreads}
          sessionStartedAt={minerState.data?.started_at}
          sessionAvg={sessionAvg}
          chainSynced={chainSynced}
          syncStalled={syncStalled}
          staticAddressMissing={staticAddressMissing}
          blocksBehind={blocksBehind}
          startPending={start.isPending}
          stopPending={stop.isPending}
          startError={start.error}
          stopError={stop.error}
          onStart={() => start.mutate()}
          onStop={() => stop.mutate()}
        />

        {live && <MiningHashrateChart {...chartProps} />}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiningStatTile
            label="Hashrate"
            icon={Cpu}
            highlight={live}
            value={
              <MinerHashrateDisplay
                booting={minerBooting}
                value={mining.data?.hashrate}
                fractionDigits={2}
              />
            }
          />
          <MiningStatTile
            label="Network hashrate"
            icon={Globe}
            value={networkKhm != null ? formatNumber(networkKhm, 2) : "—"}
            unit="kH/m"
          />
          <MiningStatTile label="Difficulty" icon={Target} value={difficulty} />
          <MiningStatTile
            label="Est. next block"
            icon={Clock}
            value={
              estBlockRate != null ? `${formatNumber(estBlockRate, 1)}` : "—"
            }
            unit={estBlockRate != null ? "h" : undefined}
            hint={
              networkStats?.blockReward != null
                ? `reward ${formatNumber(networkStats.blockReward, 4)} VRM`
                : undefined
            }
          />
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

        <MiningControlsCard
          autoAdjustThreads={autoAdjustThreads}
          manualThreads={prefs.auto_mine_threads ?? 2}
          suggestedThreads={suggestedThreads}
          maxThreads={maxThreads}
          topology={topology.data}
          logicalCpus={logicalCpus}
          displayThreads={displayThreads}
          isMining={active}
          controlsDisabled={controlsDisabled}
          rewardMode={
            (prefs.mining_reward_address_mode ??
              "dynamic") as MiningRewardAddressMode
          }
          rewardAddress={prefs.mining_reward_address ?? ""}
          autoMineOnOpen={prefs.auto_mine_on_open === true}
          playSoundOnBlock={prefs.play_sound_on_block_mined === true}
          onAutoAdjustChange={handleAutoAdjustChange}
          onManualThreadsChange={(threads) =>
            void updatePrefs({ auto_mine_threads: threads })
          }
          onRewardModeChange={(mode) =>
            void updatePrefs({ mining_reward_address_mode: mode })
          }
          onRewardAddressChange={(address) =>
            void updatePrefs({ mining_reward_address: address })
          }
          onAutoMineOnOpenChange={(checked) =>
            void updatePrefs({ auto_mine_on_open: checked })
          }
          onPlaySoundChange={(checked) =>
            void updatePrefs({ play_sound_on_block_mined: checked })
          }
        />

        {dailyEstimate && localHashrate > 0 && (
          <MiningEconomicsCard
            dailyEstimate={dailyEstimate}
            period={revenuePeriod}
            onPeriodChange={setRevenuePeriod}
            marketPriceUsd={marketPriceUsd}
            usingCustomVrmPrice={usingCustomVrmPrice}
            statsSource={networkStats?.source}
          />
        )}

        {!live && <MiningHashrateChart {...chartProps} emptyWhenIdle />}
      </div>
    </WalletUnlockGate>
  );
}
