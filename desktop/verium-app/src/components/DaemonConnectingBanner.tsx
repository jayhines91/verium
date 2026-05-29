import { Loader2 } from "lucide-react";
import { getCoinProfile, type CoinId } from "@/lib/coin/profile";
import type { NodeStatus } from "@/lib/rpc/client";

export function DaemonConnectingBanner({
  coin,
  status,
}: {
  coin: CoinId;
  status?: NodeStatus;
}) {
  const profile = getCoinProfile(coin);
  const reindexing = status?.reindex_in_progress === true;
  const detail = status?.error?.trim();

  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-sm text-fg">
      <div className="flex items-center gap-2 font-medium">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
        {reindexing
          ? `Rebuilding ${profile.displayName} chain index…`
          : `Starting ${profile.displayName} node…`}
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {reindexing
          ? detail ||
            `${profile.binaryName} is rebuilding the block index after a database error. This can take several minutes.`
          : detail ||
            `Connecting to ${profile.binaryName} on your machine. This can take up to a minute while the chain index loads.`}
      </p>
    </div>
  );
}
