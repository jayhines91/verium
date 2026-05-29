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
import { useNodeStatus } from "@/hooks/useNodeStatus";
import {
  nodeStateFromStatus,
  recoveryActionLabel,
  recoveryHintFromStatus,
} from "@/lib/node/status";
import {
  tauriCancelBootstrap,
  tauriNodeRetry,
  tauriRepairChain,
  tauriRestartDaemon,
} from "@/lib/rpc/client";

export function NodeRecoveryBanner() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const queryClient = useQueryClient();
  const { data, isConnecting } = useNodeStatus(coin);

  const reindex = useMutation({
    mutationFn: () => tauriRepairChain(coin, "reindex"),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
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
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getblockchaininfo"),
      });
    },
  });

  const retry = useMutation({
    mutationFn: () => tauriNodeRetry(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  const state = nodeStateFromStatus(data);
  const recoveryHint = recoveryHintFromStatus(data);

  if (isConnecting && !data?.chain_corrupt && !data?.error) {
    return <DaemonConnectingBanner coin={coin} status={data} />;
  }

  if (data?.connected && !data.chain_corrupt && !data.sync_stalled && state !== "auth_mismatch") {
    return null;
  }

  if (isBinaryUnavailableError(data?.error)) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        <div className="font-medium">Node software not available</div>
        <p className="mt-1 text-fg-muted">
          {data?.error ?? "Reinstall the wallet from the official release."}
        </p>
      </div>
    );
  }

  if (repair.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <BootstrapProgressPanel progress={bootstrapProgress} />
        {canCancelBootstrap && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void tauriCancelBootstrap(coin).then(() => repair.reset());
            }}
          >
            Cancel bootstrap
          </Button>
        )}
      </div>
    );
  }

  if (reindex.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Repairing blockchain index…
      </div>
    );
  }

  const showBanner =
    data?.chain_corrupt ||
    data?.sync_stalled ||
    state === "auth_mismatch" ||
    state === "datadir_locked" ||
    state === "failed" ||
    Boolean(data?.error);

  if (!showBanner) return null;

  const action =
    recoveryHint === "repair_chain"
      ? () => reindex.mutate()
      : recoveryHint === "bootstrap_chain"
        ? () => repair.mutate()
        : recoveryHint === "restart_node" || state === "auth_mismatch"
          ? () => restart.mutate()
          : () => retry.mutate();

  const actionLabel = recoveryHint
    ? recoveryActionLabel(recoveryHint)
    : "Restart node";

  const pending =
    restart.isPending || reindex.isPending || repair.isPending || retry.isPending;

  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <div className="font-medium text-fg">
        {data?.user_message ?? data?.error ?? "Node needs attention"}
      </div>
      {data?.chain_repair_detail && (
        <p className="mt-1 text-xs text-fg-muted">{data.chain_repair_detail}</p>
      )}
      {data?.sync_stall_detail && (
        <p className="mt-1 text-xs text-fg-muted">{data.sync_stall_detail}</p>
      )}
      {(reindex.error || repair.error || restart.error) && (
        <p className="mt-1 text-xs text-danger">
          {String(reindex.error ?? repair.error ?? restart.error)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={action}>
          {pending ? "Working…" : actionLabel}
        </Button>
        {data?.chain_corrupt && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => repair.mutate()}
          >
            Download snapshot
          </Button>
        )}
        <Button size="sm" variant="ghost">
          <Link to="/settings#daemon-connection">Advanced</Link>
        </Button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        {profile.symbol} node · port {profile.defaultRpcPort}
      </p>
    </div>
  );
}

/** @deprecated Use NodeRecoveryBanner */
export const DaemonConnectionBanner = NodeRecoveryBanner;
