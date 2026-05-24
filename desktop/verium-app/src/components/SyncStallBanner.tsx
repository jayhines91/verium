import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { tauriRebuildWslVeriumdFix } from "@/lib/rpc/client";
import { formatNumber } from "@/lib/utils";

export function SyncStallBanner() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const queryClient = useQueryClient();
  const { data, isLoading } = useDaemonStatus(coin);

  const rebuild = useMutation({
    mutationFn: tauriRebuildWslVeriumdFix,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getblockchaininfo"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getnetworkinfo"),
      });
    },
  });

  if (coin !== "verium" || isLoading || !data?.sync_stalled) {
    return null;
  }

  const blocks = data.blocks ?? 0;
  const headers = data.headers ?? 0;
  const lag = Math.max(0, headers - blocks);

  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
      <div className="font-medium">Sync stalled — outdated WSL veriumd build</div>
      <p className="mt-1 text-xs opacity-90">
        Your node is connected but cannot accept new blocks. Peers are ahead by{" "}
        <strong>{formatNumber(lag)}</strong> blocks while{" "}
        <span className="font-mono">{profile.binaryName}</span> rejects them.
      </p>
      {data.sync_stall_detail && (
        <p className="mt-1 font-mono text-[11px] opacity-80">
          {data.sync_stall_detail}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
          {rebuild.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rebuilding…
            </>
          ) : (
            "Rebuild WSL veriumd"
          )}
        </Button>
        {rebuild.data && (
          <span className="text-xs opacity-90">{rebuild.data.message}</span>
        )}
        {rebuild.error && (
          <span className="text-xs">{String(rebuild.error)}</span>
        )}
      </div>
    </div>
  );
}
