import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BootstrapProgressPanel } from "@/components/BootstrapProgressPanel";
import { DaemonConnectingBanner } from "@/components/DaemonConnectingBanner";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { isBinaryUnavailableError } from "@/lib/daemon-connecting";
import { bootstrapCanCancel } from "@/lib/bootstrap-progress";
import { useBootstrapProgress } from "@/hooks/useBootstrapProgress";
import { resetDaemonEnsureAttempt, useDaemonStatus } from "@/hooks/useDaemonStatus";
import { tauriCancelBootstrap, tauriRepairChain, tauriRestartWslVeriumd } from "@/lib/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { rpcGetConfig } from "@/lib/rpc/client";

export function DaemonConnectionBanner() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const queryClient = useQueryClient();
  const { data, isConnecting } = useDaemonStatus(coin);
  const config = useQuery({
    queryKey: coinQueryKey(coin, "daemon-config"),
    queryFn: () => rpcGetConfig(coin),
  });

  const repair = useMutation({
    mutationFn: () => tauriRepairChain(coin, "bootstrap"),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getblockchaininfo"),
      });
    },
  });

  const bootstrapProgress = useBootstrapProgress(coin, repair.isPending);
  const canCancelBootstrap =
    repair.isPending && bootstrapCanCancel(bootstrapProgress);

  const restart = useMutation({
    mutationFn: () => {
      const datadir = config.data?.datadir;
      if (!datadir) throw new Error("No data directory configured");
      return tauriRestartWslVeriumd(datadir);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  if (isConnecting) {
    return <DaemonConnectingBanner coin={coin} />;
  }

  if (data?.connected && !data?.chain_corrupt) {
    return null;
  }

  const unauthorized =
    data?.error?.includes("unauthorized") ||
    data?.error?.includes("invalid RPC credentials");

  const corrupt = data?.chain_corrupt === true;
  const binaryMissing = isBinaryUnavailableError(data?.error);
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
            : binaryMissing
              ? `${profile.displayName} node binary not available`
              : `${profile.displayName} daemon not connected`}
      </div>
      <p className="mt-1 text-xs opacity-90">
        {corrupt && timestampRules ? (
          <>
            Your WSL <span className="font-mono">{profile.binaryName}</span> build
            applies strict timestamp checks. Click <strong>Restart node</strong>{" "}
            below.
          </>
        ) : corrupt ? (
          <>Re-import the official bootstrap to replace chain data.</>
        ) : unauthorized ? (
          "Use Settings → Daemon connection to configure RPC credentials."
        ) : binaryMissing && coin === "vericoin" ? (
          <>
            The app cannot start <span className="font-mono">{profile.binaryName}</span>{" "}
            on this machine yet. Build or install a real binary, then set{" "}
            <span className="font-mono">VERICOIND_LOCAL</span> /{" "}
            <span className="font-mono">VERICOIND_PATH</span> and run{" "}
            <span className="font-mono">npm run fetch:vericoind</span>, or disable
            Vericoin in Settings → Chains until CDN packages ship.
          </>
        ) : binaryMissing ? (
          <>
            Install <span className="font-mono">{profile.binaryName}</span> or set{" "}
            <span className="font-mono">VERIUMD_PATH</span> /{" "}
            <span className="font-mono">VERIUMD_LOCAL</span>.
          </>
        ) : (
          `Start ${profile.binaryName} and configure the data directory.`
        )}
        {(data?.chain_repair_detail || data?.error) && (
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {data.chain_repair_detail ?? data.error}
          </span>
        )}
      </p>

      {corrupt && (
        <div className="mt-3 space-y-3">
          {repair.isPending && (
            <BootstrapProgressPanel
              progress={bootstrapProgress}
              fallbackMessage={`Re-importing ${profile.displayName} bootstrap…`}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
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
            <>
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
              {canCancelBootstrap && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void tauriCancelBootstrap(coin)}
                >
                  Cancel download
                </Button>
              )}
            </>
          )}
          </div>
        </div>
      )}

      {!corrupt && !binaryMissing && (
        <Link
          to="/settings#daemon-connection"
          className="mt-2 inline-block text-xs font-medium underline underline-offset-2"
        >
          Open connection settings →
        </Link>
      )}

      {binaryMissing && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => {
            resetDaemonEnsureAttempt(coin);
            void queryClient.invalidateQueries({
              queryKey: coinQueryKey(coin, "daemon-status"),
            });
          }}
        >
          Retry detection
        </Button>
      )}
    </div>
  );
}
