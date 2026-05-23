import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { tauriRepairChain, tauriRestartWslVeriumd } from "@/lib/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { rpcGetConfig } from "@/lib/rpc/client";

export function DaemonConnectionBanner() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useDaemonStatus();
  const config = useQuery({ queryKey: ["daemon-config"], queryFn: rpcGetConfig });

  const repair = useMutation({
    mutationFn: () => tauriRepairChain("bootstrap"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daemon-status"] });
      void queryClient.invalidateQueries({ queryKey: ["getblockchaininfo"] });
    },
  });

  const restart = useMutation({
    mutationFn: () => {
      const datadir = config.data?.datadir;
      if (!datadir) throw new Error("No data directory configured");
      return tauriRestartWslVeriumd(datadir);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daemon-status"] });
    },
  });

  if (isLoading || (data?.connected && !data?.chain_corrupt)) {
    return null;
  }

  const unauthorized =
    data?.error?.includes("unauthorized") ||
    data?.error?.includes("invalid RPC credentials");

  const corrupt = data?.chain_corrupt === true;
  const timestampRules =
    data?.chain_repair_detail?.includes("bad-cb-timestamp") ||
    data?.chain_repair_detail?.includes("bad-tx-timestamp") ||
    data?.error?.includes("timestamp rules");

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        corrupt
          ? "border-danger/40 bg-danger/10 text-danger"
          : unauthorized
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-danger/30 bg-danger/10 text-danger"
      }`}
    >
      <div className="font-medium">
        {corrupt
          ? timestampRules
            ? "Node failed startup verification"
            : "Chain data failed verification"
          : unauthorized
            ? "Daemon reachable but RPC login failed"
            : "Verium daemon not connected"}
      </div>
      <p className="mt-1 text-xs opacity-90">
        {corrupt && timestampRules ? (
          <>
            Your WSL <span className="font-mono">veriumd</span> build applies strict
            timestamp checks that reject valid mainnet blocks from the official
            bootstrap. The wallet now starts the node with{" "}
            <span className="font-mono">-checklevel=0</span> to skip that check.
            Click <strong>Restart node</strong> below — do not use reindex (that
            wipes the bootstrap and re-syncs from genesis).
          </>
        ) : corrupt ? (
          <>
            Re-import the official bootstrap to replace{" "}
            <span className="font-mono">blocks/</span> and{" "}
            <span className="font-mono">chainstate/</span>.
          </>
        ) : unauthorized ? (
          "The app cannot authenticate to veriumd. Use Settings → Daemon connection to create an RPC login or enter the same rpcuser/rpcpassword from your verium.conf."
        ) : (
          "Start veriumd and configure the data directory so Dashboard, Wallet, and Mining can load live data."
        )}
        {(data?.chain_repair_detail || data?.error) && (
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {data.chain_repair_detail ?? data.error}
          </span>
        )}
      </p>

      {corrupt && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {timestampRules ? (
            <Button
              size="sm"
              onClick={() => restart.mutate()}
              disabled={restart.isPending || !config.data?.datadir}
            >
              {restart.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Restarting…
                </>
              ) : (
                "Restart node"
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => repair.mutate()}
              disabled={repair.isPending}
            >
              {repair.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-importing…
                </>
              ) : (
                "Re-import bootstrap"
              )}
            </Button>
          )}
          {(repair.data || restart.isSuccess) && (
            <span className="text-xs opacity-90">
              {repair.data?.message ?? "Node restart requested."}
            </span>
          )}
          {(repair.error || restart.error) && (
            <span className="text-xs">{String(repair.error ?? restart.error)}</span>
          )}
        </div>
      )}

      {!corrupt && (
        <Link
          to="/settings#daemon-connection"
          className="mt-2 inline-block text-xs font-medium underline underline-offset-2"
        >
          Open connection settings →
        </Link>
      )}
    </div>
  );
}
