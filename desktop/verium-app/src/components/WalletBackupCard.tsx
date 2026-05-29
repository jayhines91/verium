import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { Download, HardDrive, Upload } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  rpcWalletBackup,
  rpcWalletChangePassphrase,
  rpcWalletRestore,
  tauriWalletFileStatus,
} from "@/lib/rpc/client";
import { invalidateWalletQueries } from "@/lib/invalidate-wallet-queries";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";

export function WalletBackupCard() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const twoFa = useTwoFactorGate(coin);
  const fileStatus = useQuery({
    queryKey: coinQueryKey(coin, "wallet-file-status"),
    queryFn: () => tauriWalletFileStatus(coin),
  });

  const [showRestoreNote, setShowRestoreNote] = useState(false);
  const [pendingRestorePath, setPendingRestorePath] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<{
    old: string;
    next: string;
    confirm: string;
  }>({ old: "", next: "", confirm: "" });

  const backup = useMutation({
    mutationFn: async () => {
      const defaultPath =
        fileStatus.data?.suggested_backup_path ?? defaultBackupName();
      const dest = await saveDialog({
        defaultPath,
        filters: [{ name: "Wallet file", extensions: ["dat"] }],
      });
      if (!dest) return null;
      return rpcWalletBackup(coin, dest);
    },
  });

  const changePass = useMutation({
    mutationFn: () => rpcWalletChangePassphrase(coin, phase.old, phase.next),
    onSuccess: () => setPhase({ old: "", next: "", confirm: "" }),
  });

  const restore = useMutation({
    mutationFn: (sourcePath: string) => rpcWalletRestore(coin, sourcePath),
    onSuccess: async () => {
      setPendingRestorePath(null);
      await invalidateWalletQueries(queryClient, coin);
    },
  });

  const pickRestoreFile = async () => {
    const picked = await openDialog({
      defaultPath: fileStatus.data?.backup_folder,
      filters: [{ name: "Wallet file", extensions: ["dat"] }],
      multiple: false,
    });
    if (!picked || Array.isArray(picked)) return;
    setPendingRestorePath(picked);
    restore.reset();
  };

  const passphraseValid =
    phase.old.length > 0 &&
    phase.next.length >= 10 &&
    phase.next === phase.confirm;

  return (
    <>
      <TwoFactorPrompt
        open={twoFa.open}
        title={twoFa.title}
        onVerified={twoFa.verified}
        onCancel={twoFa.cancel}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-accent" /> Wallet backup &amp;
            passphrase
          </CardTitle>
          <CardDescription>
            Your encrypted <span className="font-mono">wallet.dat</span>{" "}
            contains your private keys. Back it up to an external drive or
            password manager. Keep your passphrase somewhere safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fileStatus.data && (
            <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
              <div className="text-fg-muted">Current wallet file</div>
              <div className="mt-0.5 break-all text-[11px]">
                {fileStatus.data.exists
                  ? fileStatus.data.path
                  : `${fileStatus.data.path} (not present)`}
              </div>
              {fileStatus.data.note && (
                <p className="mt-1.5 text-fg-muted">{fileStatus.data.note}</p>
              )}
              {fileStatus.data.backup_folder && (
                <p className="mt-1.5 text-fg-muted">
                  Backups save to{" "}
                  <span className="text-[11px]">
                    {fileStatus.data.backup_folder}
                  </span>{" "}
                  by default — use a new filename, not{" "}
                  <span className="font-mono">wallet.dat</span>.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => backup.mutate()}
              disabled={backup.isPending || restore.isPending}
            >
              <Download className="h-3.5 w-3.5" />
              {backup.isPending ? "Saving…" : "Back up wallet.dat"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void pickRestoreFile()}
              disabled={backup.isPending || restore.isPending}
            >
              <Upload className="h-3.5 w-3.5" />
              Restore from backup
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowRestoreNote((v) => !v)}
            >
              {showRestoreNote ? "Hide" : "Show"} restore instructions
            </Button>
          </div>
          {pendingRestorePath && (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-xs">
              <p className="font-medium text-fg">Restore this wallet backup?</p>
              <p className="break-all text-[11px] text-fg-muted">
                {pendingRestorePath}
              </p>
              <p className="text-fg-muted">
                Restore{" "}
                <span className="font-medium text-fg">
                  replaces the entire wallet
                </span>{" "}
                — your current keys, addresses, and transaction history are
                swapped for the backup snapshot. The app stops the node, saves
                your current <span className="font-mono">wallet.dat</span> to
                the backups folder (if one exists), clears stale wallet cache
                files, copies the backup in, restarts veriumd, and starts a
                background chain rescan.
              </p>
              <p className="text-fg-muted">
                Unlock afterward with the passphrase from when that backup was
                made — not your current passphrase unless they match.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void twoFa.gate(
                      "restore_wallet",
                      () => restore.mutate(pendingRestorePath),
                      { title: "Confirm wallet restore with 2FA" },
                    )
                  }
                  disabled={restore.isPending}
                >
                  {restore.isPending ? "Restoring…" : "Restore wallet"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPendingRestorePath(null);
                    restore.reset();
                  }}
                  disabled={restore.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {restore.data && (
            <div className="space-y-1 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              <p>{restore.data.message}</p>
              {restore.data.previous_wallet_backup && (
                <p>
                  Previous wallet saved to{" "}
                  <span className="font-mono">
                    {restore.data.previous_wallet_backup}
                  </span>
                </p>
              )}
              {restore.data.rescan_started && (
                <p className="text-fg-muted">
                  Background rescan in progress — balances may update over the
                  next few minutes.
                </p>
              )}
            </div>
          )}
          {restore.error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {String(restore.error)}
            </div>
          )}
          {backup.data && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              Saved to{" "}
              <span className="font-mono">{backup.data.destination}</span>
            </div>
          )}
          {backup.error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {String(backup.error)}
            </div>
          )}

          {showRestoreNote && (
            <div className="space-y-2 rounded-md border border-border bg-bg-subtle px-3 py-3 text-xs text-fg-muted">
              <p className="font-medium text-fg">
                How to restore a wallet.dat backup
              </p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>
                  Use{" "}
                  <span className="font-medium text-fg">
                    Restore from backup
                  </span>{" "}
                  above, or close the wallet completely and replace the file
                  shown above manually (same filename,{" "}
                  <span className="font-mono">wallet.dat</span>).
                </li>
                <li>
                  Re-open the wallet and unlock with your original passphrase.
                </li>
              </ol>
              <p>
                Restoring replaces your entire wallet with the backup snapshot.
                Transaction history in the list is not a running balance — sends
                spend earlier receives, and mined rewards stay immature until
                101 confirmations. After restore, unlock with the backup&apos;s
                passphrase; a background rescan reconciles UTXOs with the chain.
              </p>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-sm font-medium text-fg">Change passphrase</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="password"
                placeholder="Current passphrase"
                value={phase.old}
                onChange={(e) => setPhase({ ...phase, old: e.target.value })}
                autoComplete="current-password"
                className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
              />
              <input
                type="password"
                placeholder="New passphrase"
                value={phase.next}
                onChange={(e) => setPhase({ ...phase, next: e.target.value })}
                autoComplete="new-password"
                className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
              />
              <input
                type="password"
                placeholder="Confirm new"
                value={phase.confirm}
                onChange={(e) =>
                  setPhase({ ...phase, confirm: e.target.value })
                }
                autoComplete="new-password"
                className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
              />
            </div>
            {phase.next.length > 0 && phase.next !== phase.confirm && (
              <div className="text-xs text-danger">
                New passphrases do not match.
              </div>
            )}
            <Button
              size="sm"
              onClick={() =>
                void twoFa.gate(
                  "change_passphrase",
                  () => changePass.mutate(),
                  { title: "Confirm passphrase change with 2FA" },
                )
              }
              disabled={!passphraseValid || changePass.isPending}
            >
              {changePass.isPending ? "Updating…" : "Update passphrase"}
            </Button>
            {changePass.error && (
              <div className="text-xs text-danger">
                {String(changePass.error)}
              </div>
            )}
            {changePass.isSuccess && (
              <div className="text-xs text-success">Passphrase changed.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function defaultBackupName(): string {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `verium-wallet-${yyyy}${mm}${dd}-${hh}${min}${ss}.dat`;
}
