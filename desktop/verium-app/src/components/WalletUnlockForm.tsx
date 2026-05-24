import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcWalletUnlock } from "@/lib/rpc/client";
import { passkeyStatus } from "@/lib/security/client";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  isForeverUnlockDuration,
  isNeverUnlockDuration,
  normalizeUnlockDuration,
  patchUnlockDurationPrefs,
  rpcUnlockTimeoutSeconds,
  shouldUnlockMintingOnly,
  unlockDurationForCoin,
  UNLOCK_DURATION_OPTIONS,
} from "@/lib/wallet-unlock";
import { cn } from "@/lib/utils";

interface WalletUnlockFormProps {
  title?: string;
  description?: string;
  onUnlocked?: () => void;
  showDurationPicker?: boolean;
  mintingOnly?: boolean;
  className?: string;
}

export function WalletUnlockForm({
  title = "Unlock wallet",
  description = "Enter your wallet passphrase to continue. Your passphrase is never stored.",
  onUnlocked,
  showDurationPicker = true,
  mintingOnly = false,
  className,
}: WalletUnlockFormProps) {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const passkey = useQuery({ queryKey: ["passkey"], queryFn: passkeyStatus });
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(() =>
    unlockDurationForCoin(prefs, coin),
  );

  useEffect(() => {
    setDurationSeconds(unlockDurationForCoin(prefs, coin));
  }, [coin, prefs]);

  const unlock = useMutation({
    mutationFn: async () => {
      const timeout = rpcUnlockTimeoutSeconds(durationSeconds);
      await rpcWalletUnlock(
        coin,
        passphrase,
        timeout,
        shouldUnlockMintingOnly(coin, mintingOnly) ? true : undefined,
      );
      await updatePrefs(patchUnlockDurationPrefs(prefs, coin, durationSeconds));
    },
    onSuccess: () => {
      setPassphrase("");
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getwalletinfo"),
      });
      onUnlocked?.();
    },
    onError: (e) => setError(String(e)),
  });

  const setDuration = (seconds: number) => {
    setDurationSeconds(seconds);
    void updatePrefs(patchUnlockDurationPrefs(prefs, coin, seconds));
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
          <Lock className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
          {mintingOnly && coin === "vericoin" && (
            <p className="mt-1 text-xs text-fg-subtle">
              Stake-only unlock — coins stay locked for sending until you unlock
              fully.
            </p>
          )}
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (passphrase) unlock.mutate();
        }}
      >
        {passkey.data?.enabled && (
          <p className="text-xs text-fg-subtle">
            App PIN is enrolled — use the PIN gate at launch. Enter your wallet
            passphrase here to unlock signing and sending.
          </p>
        )}

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
            <label className="text-fg-muted">Keep wallet unlocked for</label>
            <div className="flex flex-col gap-1.5">
              {UNLOCK_DURATION_OPTIONS.map((option) => {
                const active =
                  normalizeUnlockDuration(durationSeconds) === option.seconds;
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
                      onChange={() => setDuration(option.seconds)}
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
            {isNeverUnlockDuration(durationSeconds) && (
              <p className="text-xs text-fg-subtle">
                Never keeps the wallet unlocked for about one minute per unlock,
                clears any saved passphrase, and always asks again when you
                reopen the app.
              </p>
            )}
            {isForeverUnlockDuration(durationSeconds) && (
              <p className="text-xs text-fg-subtle">
                Forever stores your passphrase in the OS keychain so the wallet
                can unlock automatically when you reopen the app.
              </p>
            )}
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
