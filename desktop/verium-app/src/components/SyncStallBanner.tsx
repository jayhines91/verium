import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { tauriRebuildWslVeriumdFix } from "@/lib/rpc/client";
import { formatNumber } from "@/lib/utils";

export function SyncStallBanner() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useDaemonStatus();

  const rebuild = useMutation({
    mutationFn: tauriRebuildWslVeriumdFix,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daemon-status"] });
      void queryClient.invalidateQueries({ queryKey: ["getblockchaininfo"] });
      void queryClient.invalidateQueries({ queryKey: ["getnetworkinfo"] });
    },
  });

  if (isLoading || !data?.sync_stalled) {
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
        <span className="font-mono">veriumd</span> rejects them with{" "}
        <span className="font-mono">bad-cb-timestamp</span>. This happens when
        the WSL binary was built from older validation rules. Rebuild copies the
        fixed <span className="font-mono">validation.cpp</span> from your Windows
        repo, recompiles in WSL, and restarts the node. Do not reindex — that
        wipes the bootstrap.
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
      {rebuild.data?.log_tail && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-bg/50 p-2 font-mono text-[10px] opacity-80">
          {rebuild.data.log_tail}
        </pre>
      )}
    </div>
  );
}
