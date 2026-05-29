import type { NodeStatus } from "@/lib/rpc/client";

/** Errors that usually mean veriumd is still starting, not a permanent failure. */
export function isTransientDaemonError(error?: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("error sending request") ||
    lower.includes("connection refused") ||
    lower.includes("actively refused") ||
    lower.includes("failed to connect") ||
    lower.includes("connecterror") ||
    lower.includes("timed out") ||
    lower.includes("daemon unreachable")
  );
}

/** Dev placeholder sidecar or no binary on PATH — not a transient startup state. */
export function isBinaryUnavailableError(error?: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("dev placeholder") ||
    lower.includes("was not found on this system") ||
    lower.includes("could not locate a runnable")
  );
}

export function isDaemonConnectingState(
  status: NodeStatus | undefined,
  opts: {
    isLoading: boolean;
    isFetching: boolean;
    startupGraceActive: boolean;
  },
): boolean {
  if (opts.isLoading) return true;
  if (status?.chain_corrupt) return false;
  if (status?.reindex_in_progress) return true;
  if (isBinaryUnavailableError(status?.error)) return false;
  if (status?.warming_up) return true;
  if (status?.connected) return false;

  const unauthorized =
    status?.error?.includes("unauthorized") ||
    status?.error?.includes("invalid RPC credentials");
  if (unauthorized) return false;

  // Backend-reported startup / index load messages should stay in connecting state.
  if (status?.error?.toLowerCase().includes("reindexing block headers")) {
    return true;
  }

  if (
    status?.error?.toLowerCase().includes("loading the chain index") ||
    status?.error?.toLowerCase().includes("loading imported chain data")
  ) {
    return true;
  }

  if (opts.isFetching && !status) return true;
  if (opts.startupGraceActive && isTransientDaemonError(status?.error)) {
    return true;
  }

  return false;
}
