import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import {
  isBinaryUnavailableError,
  isDaemonConnectingState,
} from "@/lib/daemon-connecting";
import {
  rpcGetNodeStatus,
  tauriEnsureDaemonConnected,
  type NodeStatus,
} from "@/lib/rpc/client";

/** How long to treat unreachable RPC as "still starting" after app open. */
const STARTUP_GRACE_MS = 90_000;

const ensureAttempted = new Set<CoinId>();

async function fetchDaemonStatus(coin: CoinId): Promise<NodeStatus> {
  let status = await rpcGetNodeStatus(coin);

  const shouldEnsure =
    !status.connected &&
    !status.warming_up &&
    !isBinaryUnavailableError(status.error) &&
    !ensureAttempted.has(coin);

  if (shouldEnsure) {
    ensureAttempted.add(coin);
    await tauriEnsureDaemonConnected(coin).catch(() => ({
      connected: false,
      message: `Could not reach ${coin} daemon.`,
      datadir_locked: false,
      already_running: false,
    }));
    status = await rpcGetNodeStatus(coin);
  }

  return status;
}

export function resetDaemonEnsureAttempt(coin?: CoinId) {
  if (coin) {
    ensureAttempted.delete(coin);
    return;
  }
  ensureAttempted.clear();
}

export function useDaemonStatus(coin: CoinId) {
  const mountedAt = useRef(Date.now());

  const query = useQuery<NodeStatus>({
    queryKey: coinQueryKey(coin, "daemon-status"),
    queryFn: () => fetchDaemonStatus(coin),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (isBinaryUnavailableError(d?.error)) return false;
      if (d?.warming_up || d?.sync_stalled) return 2_000;
      if (d?.connected) return 10_000;
      return 5_000;
    },
    retry: 1,
    retryDelay: 2_000,
  });

  const startupGraceActive = Date.now() - mountedAt.current < STARTUP_GRACE_MS;

  const isConnecting = useMemo(
    () =>
      isDaemonConnectingState(query.data, {
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        startupGraceActive,
      }),
    [query.data, query.isLoading, query.isFetching, startupGraceActive],
  );

  return { ...query, isConnecting };
}
