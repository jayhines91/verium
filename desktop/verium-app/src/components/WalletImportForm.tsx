import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HardDriveUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  rpcWalletRestore,
  tauriWalletFileStatus,
} from "@/lib/rpc/client";
import { invalidateWalletQueries } from "@/lib/invalidate-wallet-queries";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";
import { cn } from "@/lib/utils";

interface WalletImportFormProps {
  onRestored?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function WalletImportForm({
  onRestored,
  onCancel,
  className,
}: WalletImportFormProps) {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const twoFa = useTwoFactorGate(coin);
  const fileStatus = useQuery({
    queryKey: coinQueryKey(coin, "wallet-file-status"),
    queryFn: () => tauriWalletFileStatus(coin),
  });

  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const restore = useMutation({
    mutationFn: (sourcePath: string) => rpcWalletRestore(coin, sourcePath),
    onSuccess: async () => {
      setPendingPath(null);
      await invalidateWalletQueries(queryClient, coin);
      onRestored?.();
    },
  });

  const pickFile = async () => {
    const picked = await openDialog({
      defaultPath: fileStatus.data?.backup_folder,
      filters: [{ name: "Wallet file", extensions: ["dat"] }],
      multiple: false,
    });
    if (!picked || Array.isArray(picked)) return;
    setPendingPath(picked);
    restore.reset();
  };

  return (
    <>
      <TwoFactorPrompt
        open={twoFa.open}
        title={twoFa.title}
        onVerified={twoFa.verified}
        onCancel={twoFa.cancel}
      />
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
          <HardDriveUpload className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Import existing wallet</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Choose a <span className="font-mono text-xs">wallet.dat</span> backup
            from Verium-Qt, this app, or another machine. Your current wallet file
            is saved to backups before it is replaced.
          </p>
        </div>
      </div>

      {!pendingPath ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void pickFile()} disabled={restore.isPending}>
            Choose wallet.dat…
          </Button>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Back
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-xs">
          <p className="font-medium text-fg">Restore this wallet backup?</p>
          <p className="break-all font-mono text-[11px] text-fg-muted">
            {pendingPath}
          </p>
          <p className="text-fg-muted">
            The node restarts and swaps in this backup. Unlock afterward with the
            passphrase from when that backup was made.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void twoFa.gate(
                  "restore_wallet",
                  () => restore.mutate(pendingPath),
                  { title: "Confirm wallet import with 2FA" },
                )
              }
              disabled={restore.isPending}
            >
              {restore.isPending ? "Importing…" : "Import wallet"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPendingPath(null);
                restore.reset();
              }}
              disabled={restore.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {restore.isPending && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Stopping node, restoring wallet, and restarting…
        </div>
      )}

      {restore.data && (
        <div className="space-y-1 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          <p>{restore.data.message}</p>
          {restore.data.previous_wallet_backup && (
            <p>
              Previous wallet saved to{" "}
              <span className="font-mono">{restore.data.previous_wallet_backup}</span>
            </p>
          )}
        </div>
      )}

      {restore.error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {String(restore.error)}
        </div>
      )}
    </div>
    </>
  );
}
