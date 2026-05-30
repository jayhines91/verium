import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  ADAPTIVE_MINING_POLL_MS,
  adaptiveMiningCeiling,
  fetchCpuTopology,
  fetchCpuUtilizationSnapshot,
  INITIAL_ADAPTIVE_THREAD_STATE,
  MINING_THREADS_MIN,
  nextAdaptiveMiningThreads,
  type AdaptiveThreadState,
} from "@/lib/mining-opt";
import { miningRewardAddressForStart } from "@/lib/mining-reward-address";
import {
  rpcGetMinerState,
  rpcMinerStart,
  type MinerLocalState,
} from "@/lib/rpc/client";

const VERIUM = "verium" as const;

/**
 * While CPU mining is active and auto-adjust is enabled, polls system CPU
 * every 30s and scales thread count between 1 and the device ceiling.
 */
export function useAdaptiveMiningThreads() {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const autoAdjust = prefs.auto_adjust_mine_threads !== false;
  const enabled =
    loaded && prefs.verium_enabled !== false && autoAdjust;

  const topology = useQuery({
    queryKey: ["cpu-topology"],
    queryFn: fetchCpuTopology,
    staleTime: 60_000,
    enabled,
  });

  const minerState = useQuery({
    queryKey: coinQueryKey(VERIUM, "get_miner_state"),
    queryFn: () => rpcGetMinerState(VERIUM),
    refetchInterval: 5_000,
    enabled,
  });

  const adaptiveStateRef = useRef<AdaptiveThreadState>({
    ...INITIAL_ADAPTIVE_THREAD_STATE,
  });
  const applyingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const minerActive = minerState.data?.active === true;
    if (!minerActive) {
      adaptiveStateRef.current = { ...INITIAL_ADAPTIVE_THREAD_STATE };
      return;
    }

    const tick = async () => {
      if (applyingRef.current) return;
      const live = queryClient.getQueryData<MinerLocalState>(
        coinQueryKey(VERIUM, "get_miner_state"),
      );
      if (!live?.active) return;
      const current = live.threads ?? 0;
      if (current < MINING_THREADS_MIN) return;

      const ceiling = adaptiveMiningCeiling(topology.data);
      if (ceiling < MINING_THREADS_MIN) return;

      let snapshot;
      try {
        snapshot = await fetchCpuUtilizationSnapshot();
      } catch {
        return;
      }

      const { threads: next, state } = nextAdaptiveMiningThreads(
        current,
        ceiling,
        MINING_THREADS_MIN,
        snapshot,
        adaptiveStateRef.current,
      );
      adaptiveStateRef.current = state;

      if (next === current) return;

      applyingRef.current = true;
      try {
        const updated = await rpcMinerStart(
          VERIUM,
          next,
          miningRewardAddressForStart(prefs),
        );
        queryClient.setQueryData(
          coinQueryKey(VERIUM, "get_miner_state"),
          updated,
        );
        void queryClient.invalidateQueries({
          queryKey: coinQueryKey(VERIUM, "getmininginfo"),
        });
      } catch {
        /* keep current threads on RPC failure */
      } finally {
        applyingRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), ADAPTIVE_MINING_POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, minerState.data?.active, topology.data, queryClient, prefs]);
}
