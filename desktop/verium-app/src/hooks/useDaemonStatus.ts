import { useQuery } from "@tanstack/react-query";
import {
  rpcGetNodeStatus,
  tauriEnsureDaemonConnected,
  type NodeStatus,
} from "@/lib/rpc/client";

let ensureStarted = false;

async function fetchDaemonStatus(): Promise<NodeStatus> {
  if (!ensureStarted) {
    ensureStarted = true;
    void tauriEnsureDaemonConnected().catch(() => {});
  }
  return rpcGetNodeStatus();
}

export function useDaemonStatus() {
  return useQuery<NodeStatus>({
    queryKey: ["daemon-status"],
    queryFn: fetchDaemonStatus,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.warming_up || d?.sync_stalled) return 2_000;
      if (d?.connected) return 10_000;
      return 3_000;
    },
    retry: 2,
    retryDelay: 2_000,
  });
}
