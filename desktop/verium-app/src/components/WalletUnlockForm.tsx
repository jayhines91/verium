import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { rpcWalletUnlock } from "@/lib/rpc/client";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  normalizeUnlockDuration,
  UNLOCK_DURATION_OPTIONS,
} from "@/lib/wallet-unlock";
import { cn } from "@/lib/utils";

interface WalletUnlockFormProps {
  title?: string;
  description?: string;
  onUnlocked?: () => void;
  showDurationPicker?: boolean;
  className?: string;
}

export function WalletUnlockForm({
  title = "Unlock wallet",
  description = "Enter your wallet passphrase to continue. Your passphrase is never stored.",
  onUnlocked,
  showDurationPicker = true,
  className,
}: WalletUnlockFormProps) {
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const durationSeconds = normalizeUnlockDuration(
    prefs.wallet_unlock_duration_seconds,
  );

  const unlock = useMutation({
    mutationFn: () => rpcWalletUnlock(passphrase, durationSeconds),
    onSuccess: () => {
      setPassphrase("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["getwalletinfo"] });
      onUnlocked?.();
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
          <Lock className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (passphrase) unlock.mutate();
        }}
      >
        <div className="flex flex-col gap-1 text-sm">
          <label className="text-fg-muted">Passphrase</label>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="h-10 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
            placeholder="Wallet passphrase"
          />
        </div>

        {showDurationPicker && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="text-fg-muted">
              Remember unlock duration after closing the wallet
            </label>
            <div className="flex flex-col gap-1.5">
              {UNLOCK_DURATION_OPTIONS.map((option) => {
                const active = durationSeconds === option.seconds;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
                      active
                        ? "border-accent bg-accent/10"
                        : "border-border bg-bg-subtle hover:border-border-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="wallet-unlock-duration"
                      checked={active}
                      onChange={() =>
                        void updatePrefs({
                          wallet_unlock_duration_seconds: option.seconds,
                        })
                      }
                      className="mt-0.5 accent-accent"
                    />
                    <span
                      className={cn(
                        "text-sm",
                        option.warning ? "text-warning" : "text-fg",
                      )}
                    >
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && <div className="text-xs text-danger">{error}</div>}

        <Button
          type="submit"
          disabled={!passphrase || unlock.isPending}
          className="self-start"
        >
          {unlock.isPending ? "Unlocking…" : "Unlock wallet"}
        </Button>
      </form>
    </div>
  );
}
