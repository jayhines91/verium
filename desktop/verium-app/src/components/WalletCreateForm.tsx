import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  rpcWalletCreateEncrypted,
  tauriRestartAfterEncrypt,
  type WalletCreateResult,
} from "@/lib/rpc/client";
import { scorePassphrase } from "@/lib/passphrase-strength";
import { cn } from "@/lib/utils";

interface WalletCreateFormProps {
  onCreated?: (result: WalletCreateResult) => void;
  onAlreadyEncrypted?: () => void;
  className?: string;
}

const STRENGTH_BARS: Array<{ label: string; tone: string }> = [
  { label: "Very weak", tone: "bg-danger" },
  { label: "Weak", tone: "bg-danger" },
  { label: "Fair", tone: "bg-warning" },
  { label: "Good", tone: "bg-accent" },
  { label: "Strong", tone: "bg-success" },
];

export function WalletCreateForm({
  onCreated,
  onAlreadyEncrypted,
  className,
}: WalletCreateFormProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<string>("");

  const score = scorePassphrase(passphrase);
  const matches = passphrase.length > 0 && passphrase === confirm;

  const create = useMutation({
    mutationFn: async () => {
      setPhase("Encrypting wallet…");
      const result = await rpcWalletCreateEncrypted(passphrase);
      if (result.daemon_stopped) {
        setPhase("Restarting daemon…");
        await tauriRestartAfterEncrypt();
      }
      return result;
    },
    onSuccess: (result) => {
      setPhase("");
      setPassphrase("");
      setConfirm("");
      onCreated?.(result);
    },
    onError: (err) => {
      setPhase("");
      const message = String(err);
      if (message.toLowerCase().includes("encrypted wallet")) {
        onAlreadyEncrypted?.();
      }
    },
  });

  const disabled =
    !matches ||
    score.score < 2 ||
    !acknowledged ||
    create.isPending;

  return (
    <form
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) create.mutate();
      }}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
          <KeyRound className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Create your wallet</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Choose a passphrase. The wallet file (
            <span className="font-mono text-xs">wallet.dat</span>) is encrypted
            with this passphrase locally. <strong>If you lose it, your VRM
            is gone</strong> — there is no recovery service.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label className="text-fg-muted">Passphrase</label>
        <input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="h-10 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
          placeholder="Choose a strong passphrase"
        />
        <div className="mt-1 flex items-center gap-1.5" aria-hidden>
          {STRENGTH_BARS.map((bar, idx) => (
            <span
              key={bar.label}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                idx <= score.score ? bar.tone : "bg-border",
              )}
            />
          ))}
        </div>
        <div className="text-[11px] text-fg-subtle">{score.hint}</div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label className="text-fg-muted">Confirm passphrase</label>
        <input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={cn(
            "h-10 rounded-md border bg-bg-subtle px-3 text-sm outline-none",
            confirm.length === 0
              ? "border-border focus:border-accent"
              : matches
                ? "border-success focus:border-success"
                : "border-danger focus:border-danger",
          )}
          placeholder="Re-enter passphrase"
        />
        {confirm.length > 0 && !matches && (
          <div className="text-xs text-danger">Passphrases do not match.</div>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-accent"
        />
        <span>
          I understand my passphrase is the only way to spend my coins. If I
          lose it, no one can recover my wallet. I will back up{" "}
          <span className="font-mono">wallet.dat</span> after creation.
        </span>
      </label>

      {create.error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {String(create.error).toLowerCase().includes("encrypted wallet") ? (
            <>
              This wallet is already encrypted. Use the unlock form with your
              existing passphrase instead of creating a new wallet.
            </>
          ) : (
            String(create.error)
          )}
        </div>
      )}

      {create.isPending && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {phase || "Working…"}
        </div>
      )}

      <Button type="submit" disabled={disabled} className="self-start">
        Create encrypted wallet
      </Button>
    </form>
  );
}
