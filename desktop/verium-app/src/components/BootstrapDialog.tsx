import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { BOOTSTRAP_URL_X64 } from "@/lib/verium-links";

interface BootstrapDialogProps {
  open: boolean;
  onClose: () => void;
}

interface BootstrapResult {
  success: boolean;
  message: string;
  restart_hint?: string;
}

export function BootstrapDialog({ open, onClose }: BootstrapDialogProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<string>("");

  const run = useMutation({
    mutationFn: () => invoke<BootstrapResult>("import_bootstrap"),
    onMutate: () => setPhase("Stopping veriumd and downloading the chain snapshot…"),
    onSuccess: () => {
      setPhase("");
      queryClient.invalidateQueries({ queryKey: ["getblockchaininfo"] });
      queryClient.invalidateQueries({ queryKey: ["getnetworkinfo"] });
      queryClient.invalidateQueries({ queryKey: ["daemon-status"] });
    },
    onError: () => setPhase(""),
  });

  useEffect(() => {
    if (!run.isPending) return;
    const timers = [
      setTimeout(
        () => setPhase("Downloading (~480 MB). This can take several minutes…"),
        8_000,
      ),
      setTimeout(
        () => setPhase("Extracting blocks and chainstate into your datadir…"),
        120_000,
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, [run.isPending]);

  if (!open) return null;

  const succeeded = Boolean(run.data && !run.isPending);
  const failed = Boolean(run.error && !run.isPending);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-panel p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Import chain bootstrap</h2>
        <p className="mt-2 text-sm text-fg-muted">
          The desktop app downloads the official snapshot from{" "}
          <span className="font-mono text-xs">files.vericonomy.com</span>,
          extracts it into your data directory, and replaces existing{" "}
          <span className="font-mono text-xs">blocks/</span> and{" "}
          <span className="font-mono text-xs">chainstate/</span>. veriumd is
          stopped first, then restarted automatically when possible.
        </p>
        <p className="mt-2 text-xs text-fg-subtle">
          Source:{" "}
          <a
            href={BOOTSTRAP_URL_X64}
            className="text-accent underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {BOOTSTRAP_URL_X64}
          </a>
        </p>

        {run.isPending && (
          <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
            <div className="text-xs text-fg-muted">
              {phase || "Bootstrap in progress…"}
            </div>
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
                  Automatic restart failed. You can restart manually in Settings
                  or run:
                </div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg">
                  {run.data.restart_hint}
                </pre>
              </div>
            )}
          </div>
        )}

        {run.error && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {String(run.error)}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {succeeded ? (
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={run.isPending}
              >
                {failed ? "Close" : "Cancel"}
              </Button>
              {failed ? (
                <Button
                  size="sm"
                  onClick={() => {
                    run.reset();
                    run.mutate();
                  }}
                >
                  Retry
                </Button>
              ) : (
                <Button
                  onClick={() => run.mutate()}
                  disabled={run.isPending}
                  size="sm"
                >
                  {run.isPending ? "Bootstrapping…" : "Start bootstrap"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
