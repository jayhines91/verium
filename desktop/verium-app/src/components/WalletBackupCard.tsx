import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, HardDrive } from "lucide-react";
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
  tauriWalletFileStatus,
} from "@/lib/rpc/client";

export function WalletBackupCard() {
  const fileStatus = useQuery({
    queryKey: ["wallet-file-status"],
    queryFn: tauriWalletFileStatus,
  });

  const [showRestoreNote, setShowRestoreNote] = useState(false);
  const [phase, setPhase] = useState<{ old: string; next: string; confirm: string }>(
    { old: "", next: "", confirm: "" },
  );

  const backup = useMutation({
    mutationFn: async () => {
      const defaultPath =
        fileStatus.data?.suggested_backup_path ?? defaultBackupName();
      const dest = await saveDialog({
        defaultPath,
        filters: [{ name: "Wallet file", extensions: ["dat"] }],
      });
      if (!dest) return null;
      return rpcWalletBackup(dest);
    },
  });

  const changePass = useMutation({
    mutationFn: () => rpcWalletChangePassphrase(phase.old, phase.next),
    onSuccess: () => setPhase({ old: "", next: "", confirm: "" }),
  });

  const passphraseValid =
    phase.old.length > 0 && phase.next.length >= 10 && phase.next === phase.confirm;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-accent" /> Wallet backup &amp;
          passphrase
        </CardTitle>
        <CardDescription>
          Your encrypted{" "}
          <span className="font-mono">wallet.dat</span> contains your private
          keys. Back it up to an external drive or password manager. Keep your
          passphrase somewhere safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fileStatus.data && (
          <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
            <div className="text-fg-muted">Current wallet file</div>
            <div className="mt-0.5 break-all font-mono text-[11px]">
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
                <span className="font-mono text-[11px]">
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
            disabled={backup.isPending}
          >
            <Download className="h-3.5 w-3.5" />
            {backup.isPending ? "Saving…" : "Back up wallet.dat"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowRestoreNote((v) => !v)}
          >
            {showRestoreNote ? "Hide" : "Show"} restore instructions
          </Button>
        </div>
        {backup.data && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            Saved to <span className="font-mono">{backup.data.destination}</span>
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
              <li>Close the wallet completely.</li>
              <li>
                Replace the file shown above with your backup (same filename,{" "}
                <span className="font-mono">wallet.dat</span>).
              </li>
              <li>Re-open the wallet and unlock with your original passphrase.</li>
            </ol>
            <p>
              Restoring a backup that contains keys older than your current
              wallet may require a rescan; the daemon does this automatically
              when it loads.
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
              onChange={(e) => setPhase({ ...phase, confirm: e.target.value })}
              autoComplete="new-password"
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
            />
          </div>
          {phase.next.length > 0 && phase.next !== phase.confirm && (
            <div className="text-xs text-danger">New passphrases do not match.</div>
          )}
          <Button
            size="sm"
            onClick={() => changePass.mutate()}
            disabled={!passphraseValid || changePass.isPending}
          >
            {changePass.isPending ? "Updating…" : "Update passphrase"}
          </Button>
          {changePass.error && (
            <div className="text-xs text-danger">{String(changePass.error)}</div>
          )}
          {changePass.isSuccess && (
            <div className="text-xs text-success">Passphrase changed.</div>
          )}
        </div>
      </CardContent>
    </Card>
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
