import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  rpcSetConfig,
  tauriRestartDaemon,
  tauriStartDaemon,
  tauriStopDaemon,
  type DaemonConfig,
} from "@/lib/rpc/client";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { nodeStatusLabel } from "@/lib/node/status";
import { useNodeStatus } from "@/hooks/useNodeStatus";

interface DaemonConnectionPanelProps {
  coin: CoinId;
  config: DaemonConfig | undefined;
  mode?: "settings" | "wizard";
}

/** Advanced node controls — datadir, restart. No RPC wizard. */
export function DaemonConnectionPanel({
  coin,
  config,
  mode = "settings",
}: DaemonConnectionPanelProps) {
  const queryClient = useQueryClient();
  const { data: status } = useNodeStatus(coin);
  const [datadir, setDatadir] = useState(config?.datadir ?? "");

  useEffect(() => {
    if (config?.datadir) setDatadir(config.datadir);
  }, [config?.datadir]);

  const saveDatadir = useMutation({
    mutationFn: () => rpcSetConfig(coin, { datadir }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-config"),
      });
    },
  });

  const start = useMutation({ mutationFn: () => tauriStartDaemon(coin) });
  const stop = useMutation({ mutationFn: () => tauriStopDaemon(coin) });
  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-md border border-border bg-bg-subtle px-3 py-2">
        <div className="text-xs text-fg-muted">Status</div>
        <div className="font-medium text-fg">{nodeStatusLabel(status)}</div>
        {status?.state && (
          <div className="text-[11px] text-fg-subtle">{status.state}</div>
        )}
      </div>

      {mode === "settings" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Data directory</label>
          <div className="flex gap-2">
            <input
              value={datadir}
              onChange={(e) => setDatadir(e.target.value)}
              className="h-9 flex-1 rounded-md border border-border bg-bg-subtle px-3 text-xs outline-none focus:border-accent"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const picked = await openDialog({
                  directory: true,
                  multiple: false,
                });
                if (typeof picked === "string") setDatadir(picked);
              }}
            >
              Browse
            </Button>
            <Button
              size="sm"
              onClick={() => saveDatadir.mutate()}
              disabled={!datadir || saveDatadir.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start node"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => stop.mutate()}
          disabled={stop.isPending}
        >
          Stop
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
        >
          {restart.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Restarting…
            </>
          ) : (
            "Restart node"
          )}
        </Button>
      </div>

      {(start.error || stop.error || restart.error || saveDatadir.error) && (
        <p className="text-xs text-danger">
          {String(
            start.error ?? stop.error ?? restart.error ?? saveDatadir.error,
          )}
        </p>
      )}
    </div>
  );
}
