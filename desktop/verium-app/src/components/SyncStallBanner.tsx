import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { useNodeStatus } from "@/hooks/useNodeStatus";
import { tauriRestartDaemon } from "@/lib/rpc/client";
import { formatNumber } from "@/lib/utils";

export function SyncStallBanner() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const queryClient = useQueryClient();
  const { data, isLoading } = useNodeStatus(coin);

  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
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
      <div className="font-medium">Sync stalled</div>
      <p className="mt-1 text-xs opacity-90">
        Your node is connected but cannot accept new blocks. Peers are ahead by{" "}
        <strong>{formatNumber(lag)}</strong> blocks.
      </p>
      {data.sync_stall_detail && (
        <p className="mt-1 text-[11px] opacity-80">{data.sync_stall_detail}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
        >
          {restart.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Restarting…
            </>
          ) : (
            `Restart ${profile.binaryName}`
          )}
        </Button>
      </div>
    </div>
  );
}
