import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { BootstrapProgressPanel } from "@/components/BootstrapProgressPanel";
import { useBootstrapProgress } from "@/hooks/useBootstrapProgress";
import {
  bootstrapCanCancel,
  isBootstrapCancelledError,
} from "@/lib/bootstrap-progress";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";
import { tauriCancelBootstrap, tauriImportBootstrap } from "@/lib/rpc/client";
import { resetDaemonEnsureAttempt } from "@/hooks/useDaemonStatus";
import { useUserPreferences } from "@/lib/user-preferences";

interface BootstrapDialogProps {
  coin: CoinId;
  open: boolean;
  onClose: () => void;
}

export function BootstrapDialog({ coin, open, onClose }: BootstrapDialogProps) {
  const queryClient = useQueryClient();
  const loadPrefs = useUserPreferences((s) => s.load);
  const profile = getCoinProfile(coin);

  const run = useMutation({
    mutationFn: (localPath?: string | null) => tauriImportBootstrap(coin, localPath),
    onSuccess: async () => {
      resetDaemonEnsureAttempt(coin);
      await loadPrefs();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "getblockchaininfo"),
        }),
        queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "getnetworkinfo"),
        }),
        queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "daemon-status"),
        }),
        queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "explorer-stats"),
        }),
        queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "getpeerinfo"),
        }),
      ]);
    },
  });

  const progress = useBootstrapProgress(coin, open && run.isPending);
  const canCancel = run.isPending && bootstrapCanCancel(progress);
  const cancelled =
    progress?.phase === "cancelled" ||
    (run.error != null && isBootstrapCancelledError(run.error));
  const selectedLocalPath =
    run.variables != null && typeof run.variables === "string"
      ? run.variables
      : null;

  if (!open) return null;

  const succeeded = Boolean(run.data && !run.isPending);
  const failed = Boolean(run.error && !run.isPending && !cancelled);

  const handleCancel = () => {
    if (canCancel) {
      void tauriCancelBootstrap(coin);
      return;
    }
    if (!run.isPending) {
      onClose();
    }
  };

  const pickLocalZip = async () => {
    const selected = await openDialog({
      title: `Choose ${profile.displayName} bootstrap zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
      multiple: false,
    });
    if (typeof selected === "string" && selected.length > 0) {
      run.mutate(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-panel p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Import chain bootstrap</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Imports the official {profile.displayName} snapshot into your data
          directory, replacing existing{" "}
          <span className="font-mono text-xs">blocks/</span> and{" "}
          <span className="font-mono text-xs">chainstate/</span>. Downloads from{" "}
          <span className="font-mono text-xs">{profile.bootstrapCdn}</span> or
          uses a local{" "}
          <span className="font-mono text-xs">vericoin-bootstrap.zip</span> or{" "}
          <span className="font-mono text-xs">verium-bootstrap.zip</span> if found
          (e.g. in Downloads).
        </p>

        {selectedLocalPath && !run.isPending && !succeeded && (
          <p className="mt-2 truncate font-mono text-[11px] text-fg-subtle">
            Selected: {selectedLocalPath}
          </p>
        )}

        {run.isPending && (
          <BootstrapProgressPanel
            className="mt-4"
            progress={progress}
            fallbackMessage={`Stopping ${profile.binaryName} and preparing bootstrap…`}
          />
        )}

        {cancelled && !run.isPending && (
          <div className="mt-4 rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
            Bootstrap import was cancelled. Your existing chain data was not
            replaced.
          </div>
        )}

        {run.data && !run.isPending && (
          <div className="mt-4 space-y-2">
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {run.data.message}
            </div>
            {run.data.restart_hint && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                <div className="text-xs text-fg-muted">
                  Automatic restart failed. Restart manually in Settings.
                </div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg">
                  {run.data.restart_hint}
                </pre>
              </div>
            )}
          </div>
        )}

        {failed && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {String(run.error)}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {succeeded ? (
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={run.isPending && !canCancel}
              >
                {canCancel ? "Cancel download" : failed || cancelled ? "Close" : "Cancel"}
              </Button>
              {!run.isPending && !cancelled && (
                <Button variant="secondary" size="sm" onClick={() => void pickLocalZip()}>
                  Choose local zip…
                </Button>
              )}
              {failed ? (
                <Button
                  size="sm"
                  onClick={() => run.mutate(selectedLocalPath)}
                >
                  Retry
                </Button>
              ) : (
                !cancelled && (
                  <Button
                    onClick={() => run.mutate(undefined)}
                    disabled={run.isPending}
                    size="sm"
                  >
                    {run.isPending ? "Bootstrapping…" : "Start bootstrap"}
                  </Button>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
